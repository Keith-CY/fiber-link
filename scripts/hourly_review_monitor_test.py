import importlib.util
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

        with patch.object(MODULE, "list_json") as list_json_mock:
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


if __name__ == "__main__":
    unittest.main()
