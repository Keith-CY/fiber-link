import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("hourly-review-monitor.py")
SPEC = importlib.util.spec_from_file_location("hourly_review_monitor", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC is not None and SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class HourlyReviewMonitorTests(unittest.TestCase):
    def test_analyze_fetches_all_open_issues_without_assignee_filter(self) -> None:
        open_issue = {
            "number": 1,
            "title": "Open issue",
            "url": "https://example.com/1",
            "body": "",
            "labels": [],
        }
        nbs_issue = {
            "number": 2,
            "title": "NBS issue",
            "url": "https://example.com/2",
            "body": "",
            "labels": [{"name": "nbs"}],
        }

        with (
            patch.object(MODULE, "list_json") as list_json_mock,
            patch.object(MODULE, "count_test_files", return_value=10),
            patch.object(MODULE, "read_docs_superseded_count", return_value=1),
        ):
            list_json_mock.side_effect = [
                [open_issue, nbs_issue],  # list_json("issue")
                [],  # list_json("pr")
            ]

            snapshot = MODULE.analyze()

        self.assertEqual(list_json_mock.call_count, 2)
        self.assertEqual(list_json_mock.call_args_list[0].args, ("issue",))
        self.assertEqual(list_json_mock.call_args_list[0].kwargs, {})
        self.assertEqual(list_json_mock.call_args_list[1].args, ("pr",))
        self.assertEqual(list_json_mock.call_args_list[1].kwargs, {})
        self.assertEqual(snapshot["counts"]["open"], 2)
        self.assertEqual(snapshot["counts"]["assigned"], 2)
        self.assertEqual(len(snapshot["open"]), 2)
        self.assertEqual(len(snapshot["assigned"]), 2)
        self.assertEqual(snapshot["counts"]["nbs"], 1)
        self.assertEqual(snapshot["counts"]["nbsUnbound"], 1)

    def test_summarize_supports_legacy_assigned_only_snapshot(self) -> None:
        legacy_snapshot = {
            "runAt": "2026-02-22T00:00:00Z",
            "assigned": [{"number": 12, "title": "Legacy item", "url": "https://example.com/12"}],
            "counts": {"assigned": 1, "nbs": 0, "nbsUnbound": 0, "changeRequests": 0},
            "nbsUnbound": [],
            "changeRequests": [],
        }

        rendered = MODULE.summarize(legacy_snapshot)

        self.assertIn("Open issues requiring handling: 1", rendered)
        self.assertIn("#12 Legacy item", rendered)

    def test_analyze_emits_stagnation_signal_and_pr208_metric(self) -> None:
        source_bound_issue = {
            "number": 3,
            "title": "Bound issue",
            "url": "https://example.com/3",
            "body": "Source PR: https://github.com/Keith-CY/fiber-link/pull/208",
            "labels": [],
        }
        pr_208 = {
            "number": 208,
            "title": "Open tracking PR",
            "url": "https://example.com/pr/208",
            "reviewDecision": "APPROVED",
            "headRefName": "main",
            "headRefOid": "abcdef1234567890",
            "updatedAt": "2026-02-22T00:00:00Z",
            "author": {"login": "owner"},
        }

        with (
            patch.object(MODULE, "list_json") as list_json_mock,
            patch.object(MODULE, "classify_with_source_pr", return_value=([], [source_bound_issue], [])),
            patch.object(MODULE, "count_test_files", return_value=10),
            patch.object(MODULE, "read_docs_superseded_count", return_value=1),
            patch.object(MODULE.time, "time", return_value=1700000000),
        ):
            list_json_mock.side_effect = [
                [source_bound_issue],  # list_json("issue")
                [pr_208],  # list_json("pr")
            ]
            snapshot = MODULE.analyze()

        self.assertIn("stagnation_signal", snapshot["signals"])
        self.assertEqual(snapshot["counts"]["open"], 0)
        self.assertEqual(snapshot["counts"]["openPrs"], 1)
        self.assertIsInstance(snapshot["metrics"]["pr208UnchangedHours"], float)

    def test_detect_change_reports_sha_and_review_decision(self) -> None:
        state = {
            "runs": [
                {
                    "openPrs": [
                        {
                            "number": 208,
                            "headSha": "aaaaaa111111",
                            "reviewDecision": "APPROVED",
                        }
                    ],
                    "counts": {"open": 1, "nbsUnbound": 0, "changeRequests": 0},
                }
            ]
        }
        snapshot = {
            "openPrs": [
                {
                    "number": 208,
                    "headSha": "bbbbbb222222",
                    "reviewDecision": "CHANGES_REQUESTED",
                }
            ],
            "counts": {"open": 1, "nbsUnbound": 0, "changeRequests": 1},
        }

        detected = MODULE.detect_change(snapshot, state)

        self.assertTrue(detected["changed"])
        self.assertIn("sha", detected["sources"])
        self.assertIn("reviewDecision", detected["sources"])

    def test_build_skip_summary_contains_previous_and_current_head_sha(self) -> None:
        last_snapshot = {
            "openPrs": [{"number": 208, "headSha": "aaaaaa111111"}],
            "nextActionAt": "2026-02-22T00:20:00Z",
        }
        current_snapshot = {
            "openPrs": [{"number": 208, "headSha": "aaaaaa111111"}],
            "nextActionAt": "2026-02-22T00:40:00Z",
        }

        rendered = MODULE.build_skip_summary(last_snapshot, current_snapshot, skips=2, escalated=False)

        self.assertIn("headSha previous/current", rendered)
        self.assertIn("#208 aaaaaa1/aaaaaa1", rendered)
        self.assertIn("consecutiveNoUpdateSkips: 2", rendered)

    def test_enrich_snapshot_adds_regression_signals(self) -> None:
        state = {
            "runs": [
                {
                    "metrics": {"testFiles": 20, "docsSuperseded": 1},
                    "counts": {"open": 0, "nbsUnbound": 0, "changeRequests": 0, "staleOpenPrs": 0},
                    "openPrs": [],
                }
            ],
            "cleanRunStreak": 0,
        }
        snapshot = {
            "metrics": {"testFiles": 12, "docsSuperseded": 3},
            "counts": {"open": 0, "nbsUnbound": 0, "changeRequests": 0, "staleOpenPrs": 0},
            "openPrs": [],
            "signals": [],
        }

        with patch.object(MODULE.time, "time", return_value=1700000000):
            MODULE.enrich_snapshot(snapshot, state)

        self.assertEqual(snapshot["metrics"]["testFilesDelta"], -8)
        self.assertEqual(snapshot["metrics"]["docsSupersededDelta"], 2)
        self.assertIn("test_files_drift", snapshot["signals"])
        self.assertIn("docs_superseded_regression", snapshot["signals"])

    def test_analyze_splits_stale_pr_watchdog_digest_and_owner_ping(self) -> None:
        stale_digest = {
            "number": 301,
            "title": "digest candidate",
            "url": "https://example.com/pr/301",
            "reviewDecision": "APPROVED",
            "headRefName": "branch-1",
            "headRefOid": "a" * 40,
            "updatedAt": "2023-11-13T20:13:20Z",  # ~30h before mocked now
            "author": {"login": "alice"},
        }
        stale_watchdog = {
            "number": 302,
            "title": "watchdog + owner ping",
            "url": "https://example.com/pr/302",
            "reviewDecision": "APPROVED",
            "headRefName": "branch-2",
            "headRefOid": "b" * 40,
            "updatedAt": "2023-11-11T18:13:20Z",  # ~80h before mocked now
            "author": {"login": "bob"},
        }
        stale_change_requested = {
            "number": 303,
            "title": "changes requested stays immediate",
            "url": "https://example.com/pr/303",
            "reviewDecision": "CHANGES_REQUESTED",
            "headRefName": "branch-3",
            "headRefOid": "c" * 40,
            "updatedAt": "2023-11-13T20:13:20Z",  # ~30h before mocked now
            "author": {"login": "carol"},
        }

        with (
            patch.object(MODULE, "list_json") as list_json_mock,
            patch.object(MODULE, "classify_with_source_pr", return_value=([], [], [])),
            patch.object(MODULE, "count_test_files", return_value=10),
            patch.object(MODULE, "read_docs_superseded_count", return_value=1),
            patch.object(MODULE.time, "time", return_value=1700000000),
        ):
            list_json_mock.side_effect = [
                [],  # list_json("issue")
                [stale_digest, stale_watchdog, stale_change_requested],  # list_json("pr")
            ]

            snapshot = MODULE.analyze()

        self.assertEqual(snapshot["counts"]["staleOpenPrs"], 2)
        self.assertEqual(snapshot["counts"]["staleOpenPrsDigest"], 1)
        self.assertEqual(snapshot["counts"]["ownerPingCandidates"], 1)
        self.assertEqual([p["number"] for p in snapshot["staleOpenPrsDigest"]], [301])
        self.assertEqual([p["number"] for p in snapshot["ownerPingCandidates"]], [302])
        self.assertIn("owner_ping_policy", snapshot["signals"])

    def test_upsert_issue_comment_creates_new_comment_when_marker_missing(self) -> None:
        marker = "<!-- marker -->"
        body = "comment body"
        with patch.object(MODULE, "run_gh") as run_gh_mock:
            run_gh_mock.side_effect = ["[]", ""]
            MODULE.upsert_issue_comment(208, marker, body)

        self.assertEqual(
            run_gh_mock.call_args_list[0].args[0],
            ["api", f"repos/{MODULE.REPO}/issues/208/comments?per_page=100"],
        )
        self.assertEqual(
            run_gh_mock.call_args_list[1].args[0],
            ["api", f"repos/{MODULE.REPO}/issues/208/comments", "-f", f"body={body}"],
        )

    def test_upsert_issue_comment_updates_existing_marker_comment(self) -> None:
        marker = "<!-- marker -->"
        body = "fresh body"
        existing = [{"id": 77, "body": f"old\n{marker}"}]
        with patch.object(MODULE, "run_gh") as run_gh_mock:
            run_gh_mock.side_effect = [json.dumps(existing), ""]
            MODULE.upsert_issue_comment(208, marker, body)

        self.assertEqual(
            run_gh_mock.call_args_list[0].args[0],
            ["api", f"repos/{MODULE.REPO}/issues/208/comments?per_page=100"],
        )
        self.assertEqual(
            run_gh_mock.call_args_list[1].args[0],
            ["api", "-X", "PATCH", f"repos/{MODULE.REPO}/issues/comments/77", "-f", f"body={body}"],
        )

    def test_build_audit_delta_comment_includes_key_counts(self) -> None:
        previous = {
            "runAt": "2026-02-22T06:00:00Z",
            "counts": {"open": 5, "nbsUnbound": 1, "changeRequests": 2, "staleOpenPrs": 2, "staleOpenPrsDigest": 0},
            "signals": [],
        }
        current = {
            "runAt": "2026-02-22T06:20:00Z",
            "nextActionAt": "2026-02-22T06:40:00Z",
            "counts": {"open": 3, "nbsUnbound": 1, "changeRequests": 1, "staleOpenPrs": 1, "staleOpenPrsDigest": 2},
            "signals": ["owner_ping_policy"],
            "openPrs": [{"number": 208, "headSha": "abc1234"}],
        }

        rendered = MODULE.build_audit_delta_comment(208, current, previous)

        self.assertIn("fiber-link-hourly-audit-delta", rendered)
        self.assertIn("Open issues requiring handling: 3 (delta -2)", rendered)
        self.assertIn("Stale open PR watchdog: 1 (delta -1)", rendered)
        self.assertIn("Low-priority digest candidates: 2 (delta +2)", rendered)
        self.assertIn("nextActionAt: 2026-02-22T06:40:00Z", rendered)


if __name__ == "__main__":
    unittest.main()
