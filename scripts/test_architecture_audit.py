from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "architecture_audit.py"


class ArchitectureAuditScriptTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.run_cmd(["git", "init"])
        self.run_cmd(["git", "config", "user.email", "test@example.com"])
        self.run_cmd(["git", "config", "user.name", "Test User"])
        self.run_cmd(["git", "config", "commit.gpgsign", "false"])

        (self.root / ".github").mkdir(parents=True, exist_ok=True)
        (self.root / "docs").mkdir(parents=True, exist_ok=True)
        (self.root / "src").mkdir(parents=True, exist_ok=True)

        (self.root / "README.md").write_text("test repository\n", encoding="utf-8")
        (self.root / ".github" / "architecture-audit-state.json").write_text(
            "{\n  \"version\": 1,\n  \"runs\": [],\n  \"latest\": null,\n  \"note\": \"TODO: ignore state token\"\n}\n",
            encoding="utf-8",
        )
        (self.root / "docs" / "current-architecture.md").write_text(
            "# Canonical\n\nThis is canonical.\n",
            encoding="utf-8",
        )
        (self.root / "docs" / "audit-snapshot.md").write_text(
            "# Generated\n\nTODO/TBD/FIXME markers in this generated doc must be ignored.\n",
            encoding="utf-8",
        )
        (self.root / "docs" / "legacy-plan.md").write_text(
            "# Legacy Plan\n\nStatus: Superseded historical snapshot.\n",
            encoding="utf-8",
        )
        (self.root / "docs" / "notes.md").write_text(
            "TODO: capture migration references.\nFIXME: resolve link targets.\n",
            encoding="utf-8",
        )
        (self.root / "scripts").mkdir(parents=True, exist_ok=True)
        (self.root / "scripts" / "architecture_audit.py").write_text(
            "print('TODO: this internal script marker must be ignored')\n",
            encoding="utf-8",
        )
        (self.root / "scripts" / "test_architecture_audit.py").write_text(
            "print('FIXME: this internal test marker must be ignored')\n",
            encoding="utf-8",
        )
        (self.root / "src" / "app.ts").write_text(
            "export const value = 1; // TODO remove after migration\n",
            encoding="utf-8",
        )
        (self.root / "src" / "app.test.ts").write_text(
            "export const a = 1;\n",
            encoding="utf-8",
        )
        (self.root / "src" / "router.spec.ts").write_text(
            "export const b = 2;\n",
            encoding="utf-8",
        )

        self.run_cmd(["git", "add", "."])
        self.run_cmd(["git", "-c", "commit.gpgsign=false", "commit", "-m", "init"])

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def run_cmd(self, cmd: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            cmd,
            cwd=self.root,
            check=True,
            capture_output=True,
            text=True,
        )

    def run_audit(self, *args: str) -> dict:
        proc = self.run_cmd([sys.executable, str(SCRIPT), *args])
        return json.loads(proc.stdout)

    def test_run_generates_metrics_and_hit_details(self) -> None:
        report_path = self.root / "report.json"
        self.run_audit(
            "run",
            "--state-file",
            ".github/architecture-audit-state.json",
            "--snapshot-file",
            "docs/audit-snapshot.md",
            "--report-file",
            str(report_path),
        )

        report = json.loads(report_path.read_text(encoding="utf-8"))
        self.assertEqual(report["metrics"]["docs_superseded"], 1)
        self.assertEqual(report["metrics"]["docs_todo"], 2)
        self.assertEqual(report["metrics"]["core_todo"], 1)
        self.assertEqual(report["metrics"]["test_files"], 2)

        docs_hits = report["todo_hits"]["docs"]["items"]
        self.assertGreaterEqual(len(docs_hits), 2)
        self.assertIn(
            {"path": "docs/notes.md", "line": 1, "token": "TODO"},
            docs_hits,
        )
        self.assertIn(
            {"path": "docs/notes.md", "line": 2, "token": "FIXME"},
            docs_hits,
        )
        self.assertNotIn(
            {"path": "docs/audit-snapshot.md", "line": 3, "token": "TODO"},
            docs_hits,
        )

        core_hits = report["todo_hits"]["core"]["items"]
        self.assertNotIn(
            {"path": "scripts/architecture_audit.py", "line": 1, "token": "TODO"},
            core_hits,
        )
        self.assertNotIn(
            {"path": "scripts/test_architecture_audit.py", "line": 1, "token": "FIXME"},
            core_hits,
        )

        snapshot_text = (self.root / "docs" / "audit-snapshot.md").read_text(encoding="utf-8")
        self.assertIn("docs/current-architecture.md", snapshot_text)

    def test_second_run_reports_test_file_delta(self) -> None:
        self.run_audit(
            "run",
            "--state-file",
            ".github/architecture-audit-state.json",
            "--snapshot-file",
            "docs/audit-snapshot.md",
            "--report-file",
            str(self.root / "report-first.json"),
        )

        (self.root / "src" / "new-flow.spec.ts").write_text("export const n = 3;\n", encoding="utf-8")
        self.run_cmd(["git", "add", "src/new-flow.spec.ts"])
        self.run_cmd(["git", "-c", "commit.gpgsign=false", "commit", "-m", "add new test"])

        self.run_audit(
            "run",
            "--state-file",
            ".github/architecture-audit-state.json",
            "--snapshot-file",
            "docs/audit-snapshot.md",
            "--report-file",
            str(self.root / "report-second.json"),
        )
        report_second = json.loads((self.root / "report-second.json").read_text(encoding="utf-8"))

        self.assertEqual(report_second["deltas"]["test_files"], 1)
        self.assertEqual(report_second["test_files"]["delta"], 1)
        self.assertIn("src/new-flow.spec.ts", report_second["test_files"]["added"])

    def test_dirty_gate_blocks_unexpected_paths(self) -> None:
        self.run_audit(
            "run",
            "--state-file",
            ".github/architecture-audit-state.json",
            "--snapshot-file",
            "docs/audit-snapshot.md",
        )

        (self.root / "README.md").write_text("changed\n", encoding="utf-8")
        (self.root / "docs" / "audit-snapshot.md").write_text("changed\n", encoding="utf-8")

        gate = self.run_audit(
            "dirty-gate",
            "--state-file",
            ".github/architecture-audit-state.json",
            "--stage",
            "pre-pr-create",
            "--expected-path",
            "docs/audit-snapshot.md",
            "--expected-path",
            ".github/architecture-audit-state.json",
        )

        self.assertTrue(gate["blocked"])
        self.assertEqual(gate["reason_code"], "DIRTY_TREE_BLOCKED")
        self.assertIn("README.md", gate["unexpected_paths"])


if __name__ == "__main__":
    unittest.main()
