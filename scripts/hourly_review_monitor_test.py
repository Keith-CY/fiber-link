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
        open_issue = {"number": 1, "title": "Open issue", "url": "https://example.com/1", "body": ""}
        nbs_issue = {"number": 2, "title": "NBS issue", "url": "https://example.com/2", "body": ""}

        with patch.object(MODULE, "list_json") as list_json_mock:
            list_json_mock.side_effect = [
                [open_issue, nbs_issue],  # list_json("issue")
                [nbs_issue],  # list_json("issue", label="nbs")
                [],  # list_json("pr")
            ]

            snapshot = MODULE.analyze()

        self.assertEqual(list_json_mock.call_count, 3)
        self.assertEqual(list_json_mock.call_args_list[0].args, ("issue",))
        self.assertEqual(list_json_mock.call_args_list[0].kwargs, {})
        self.assertEqual(list_json_mock.call_args_list[1].args, ("issue",))
        self.assertEqual(list_json_mock.call_args_list[1].kwargs, {"label": "nbs"})
        self.assertEqual(snapshot["counts"]["open"], 2)
        self.assertEqual(snapshot["counts"]["assigned"], 2)
        self.assertEqual(len(snapshot["open"]), 2)
        self.assertEqual(len(snapshot["assigned"]), 2)

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


if __name__ == "__main__":
    unittest.main()
