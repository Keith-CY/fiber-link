#!/usr/bin/env python3
"""Architecture audit automation runner.

Contract:
- The canonical architecture index is `docs/current-architecture.md`.
- This generator must write snapshot output to `docs/audit-snapshot.md` only.
- Persistent automation state is stored in `.github/architecture-audit-state.json`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TOKEN_RE = re.compile(r"\b(TODO|TBD|FIXME)\b(?=(?::|\s+[A-Za-z0-9]))")
SUPERSEDED_RE = re.compile(r"^Status:\s*(superseded|diverged)\b", re.IGNORECASE | re.MULTILINE)
MAX_STATE_RUNS = 200
DEFAULT_STATE_FILE = ".github/architecture-audit-state.json"
DEFAULT_SNAPSHOT_FILE = "docs/audit-snapshot.md"
TOKEN_SCAN_EXCLUDED_PATHS = {
    "docs/audit-snapshot.md",
    ".github/architecture-audit-state.json",
    "scripts/architecture_audit.py",
    "scripts/test_architecture_audit.py",
}
SUPERSEDED_EXCLUDED_PATHS = {"docs/current-architecture.md", "docs/audit-snapshot.md"}
SUPERSEDED_FALLBACK_TEXT = "superseded historical snapshot"


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def normalize_path(path: str) -> str:
    return Path(path).as_posix()


def stable_hash(items: list[str], empty_value: str = "0", length: int = 16) -> str:
    if not items:
        return empty_value
    digest = hashlib.sha256("\n".join(items).encode("utf-8")).hexdigest()
    return digest[:length]


def run_cmd(args: list[str], check: bool = True) -> str:
    proc = subprocess.run(args, check=check, capture_output=True, text=True)
    return proc.stdout.strip()


def parse_git_status_line(line: str) -> dict[str, str]:
    match = re.match(r"^(..)\s+(.*)$", line)
    if match:
        status = match.group(1).strip() or "?"
        raw_path = match.group(2)
    else:
        parts = line.split(maxsplit=1)
        status = (parts[0] if parts else "?").strip() or "?"
        raw_path = parts[1] if len(parts) > 1 else ""
    if " -> " in raw_path:
        raw_path = raw_path.split(" -> ", 1)[1]
    return {"status": status, "path": normalize_path(raw_path.strip())}


def git_status_entries() -> list[dict[str, str]]:
    out = run_cmd(["git", "status", "--porcelain"], check=True)
    entries: list[dict[str, str]] = []
    for line in out.splitlines():
        if not line:
            continue
        entries.append(parse_git_status_line(line))
    return entries


def list_repo_files() -> list[str]:
    out = run_cmd(["git", "ls-files"], check=True)
    return sorted(normalize_path(p) for p in out.splitlines() if p.strip())


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "runs": []}
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        return {"version": 1, "runs": []}
    raw.setdefault("version", 1)
    raw.setdefault("runs", [])
    return raw


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, sort_keys=False) + "\n", encoding="utf-8")


def is_text_path(path: str) -> bool:
    # Keep this conservative to avoid trying to decode binaries.
    binary_suffixes = (
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".pdf",
        ".zip",
        ".gz",
        ".tar",
        ".woff",
        ".woff2",
        ".ttf",
        ".ico",
        ".bin",
    )
    lower = path.lower()
    return not lower.endswith(binary_suffixes)


def is_test_file(path: str) -> bool:
    base = os.path.basename(path).lower()
    return (
        ".test." in base
        or ".spec." in base
        or base.endswith("_test.go")
        or base.endswith("_test.py")
        or base.endswith("_spec.rb")
    )


def is_token_scan_excluded(path: str) -> bool:
    return normalize_path(path) in TOKEN_SCAN_EXCLUDED_PATHS


def collect_token_hits(paths: list[str], max_hits: int) -> tuple[list[dict[str, Any]], int]:
    hits: list[dict[str, Any]] = []
    total = 0
    for path in paths:
        if is_token_scan_excluded(path):
            continue
        if not is_text_path(path):
            continue
        try:
            content = Path(path).read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
        for idx, line in enumerate(content, start=1):
            for match in TOKEN_RE.finditer(line):
                total += 1
                if len(hits) >= max_hits:
                    continue
                hits.append(
                    {
                        "path": normalize_path(path),
                        "line": idx,
                        "token": match.group(1).upper(),
                    }
                )
    return hits, total


def collect_superseded_docs(paths: list[str], max_hits: int) -> tuple[list[dict[str, str]], int]:
    records: list[dict[str, str]] = []
    total = 0
    for path in paths:
        if normalize_path(path) in SUPERSEDED_EXCLUDED_PATHS:
            continue
        if not path.endswith(".md"):
            continue
        try:
            text = Path(path).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        status_match = SUPERSEDED_RE.search(text)
        status = status_match.group(1).lower() if status_match else ""
        if not status and SUPERSEDED_FALLBACK_TEXT in text.lower():
            status = "superseded"
        if not status:
            continue
        total += 1
        if len(records) >= max_hits:
            continue
        records.append({"path": normalize_path(path), "status": status})
    return records, total


def signed(num: int) -> str:
    return f"{num:+d}"


def build_dirty_diagnostics(
    entries: list[dict[str, str]],
    stage: str,
    max_paths: int,
    expected_paths: set[str] | None = None,
) -> dict[str, Any]:
    expected = expected_paths or set()
    normalized_entries = sorted(entries, key=lambda item: (item["path"], item["status"]))
    paths = [item["path"] for item in normalized_entries]
    fingerprint_input = [f"{item['status']} {item['path']}" for item in normalized_entries]

    if expected:
        unexpected = [p for p in paths if normalize_path(p) not in expected]
        blocked = bool(unexpected)
    else:
        unexpected = []
        blocked = bool(paths)

    reason_code = "DIRTY_TREE_BLOCKED" if blocked else "CLEAN_TREE"
    return {
        "runAt": now_utc_iso(),
        "stage": stage,
        "source": "git_status_porcelain",
        "reason_code": reason_code,
        "blocked": blocked,
        "dirty_count": len(paths),
        "dirty_fingerprint": stable_hash(fingerprint_input),
        "representative_paths": paths[:max_paths],
        "unexpected_paths": unexpected[:max_paths],
    }


def append_diagnostic_to_state(state_path: Path, diagnostic: dict[str, Any]) -> None:
    state = load_state(state_path)
    latest = state.get("latest")
    if not isinstance(latest, dict):
        return
    latest.setdefault("diagnostics", [])
    latest["diagnostics"].append(diagnostic)
    if diagnostic.get("blocked"):
        latest["reason_code"] = diagnostic.get("reason_code", latest.get("reason_code", "UNKNOWN"))

    state["latest"] = latest
    runs = state.get("runs", [])
    if runs and isinstance(runs[-1], dict) and runs[-1].get("runAt") == latest.get("runAt"):
        runs[-1] = latest
        state["runs"] = runs
    save_state(state_path, state)


def collect_metrics(max_todo_hits: int, max_superseded_hits: int) -> dict[str, Any]:
    repo_files = list_repo_files()
    docs_files = [p for p in repo_files if p.startswith("docs/") and p.endswith(".md")]
    core_files = [p for p in repo_files if not p.startswith("docs/")]

    superseded_docs, superseded_total = collect_superseded_docs(docs_files, max_superseded_hits)
    docs_hits, docs_total = collect_token_hits(docs_files, max_todo_hits)
    core_hits, core_total = collect_token_hits(core_files, max_todo_hits)
    test_files = sorted(p for p in repo_files if is_test_file(p))

    return {
        "metrics": {
            "docs_superseded": superseded_total,
            "docs_todo": docs_total,
            "core_todo": core_total,
            "test_files": len(test_files),
        },
        "superseded_docs": {
            "items": superseded_docs,
            "truncated": max(0, superseded_total - len(superseded_docs)),
        },
        "todo_hits": {
            "docs": {
                "items": docs_hits,
                "truncated": max(0, docs_total - len(docs_hits)),
                "total": docs_total,
            },
            "core": {
                "items": core_hits,
                "truncated": max(0, core_total - len(core_hits)),
                "total": core_total,
            },
        },
        "test_files": test_files,
    }


def compute_metric_deltas(
    current_metrics: dict[str, int], previous_metrics: dict[str, int] | None
) -> tuple[dict[str, int], bool]:
    keys = ["docs_superseded", "docs_todo", "core_todo", "test_files"]
    if not previous_metrics:
        return {key: 0 for key in keys}, False
    return ({key: current_metrics[key] - previous_metrics.get(key, 0) for key in keys}, True)


def compute_test_file_delta(
    current_test_files: list[str], previous_test_files: list[str] | None
) -> dict[str, Any]:
    current_set = set(current_test_files)
    if previous_test_files is None:
        return {
            "previous": len(current_test_files),
            "current": len(current_test_files),
            "delta": 0,
            "added": [],
            "removed": [],
            "current_hash": stable_hash(current_test_files),
            "previous_hash": stable_hash(current_test_files),
            "paths": current_test_files,
        }

    previous_set = set(previous_test_files)
    added = sorted(current_set - previous_set)
    removed = sorted(previous_set - current_set)
    return {
        "previous": len(previous_test_files),
        "current": len(current_test_files),
        "delta": len(current_test_files) - len(previous_test_files),
        "added": added,
        "removed": removed,
        "current_hash": stable_hash(current_test_files),
        "previous_hash": stable_hash(previous_test_files),
        "paths": current_test_files,
    }


def append_hits(lines: list[str], title: str, hits: list[dict[str, Any]], truncated: int) -> None:
    lines.append(f"### {title}")
    if not hits:
        lines.append("- none")
        return
    for hit in hits:
        lines.append(f"- `{hit['path']}:{hit['line']}` (`{hit['token']}`)")
    if truncated > 0:
        lines.append(f"- +{truncated} more")


def render_snapshot(report: dict[str, Any], compact_no_change: bool) -> str:
    metrics = report["metrics"]
    deltas = report["deltas"]
    test_delta = report["test_files"]
    superseded = report["superseded_docs"]
    todo_docs = report["todo_hits"]["docs"]
    todo_core = report["todo_hits"]["core"]

    lines: list[str] = [
        "# Architecture Audit Snapshot",
        "",
        "> Generated by `scripts/architecture_audit.py`.",
        "> Contract: this generator writes only `docs/audit-snapshot.md` and `.github/architecture-audit-state.json`.",
        "> Canonical architecture index: `docs/current-architecture.md`.",
        "",
    ]

    if compact_no_change and report["no_change"]:
        lines.extend(
            [
                "## No-Change Summary",
                "",
                "No metric changes were detected since the previous recorded run.",
                "",
                f"- `docs_superseded`: {metrics['docs_superseded']} (delta `{signed(deltas['docs_superseded'])}`)",
                f"- `docs_todo`: {metrics['docs_todo']} (delta `{signed(deltas['docs_todo'])}`)",
                f"- `core_todo`: {metrics['core_todo']} (delta `{signed(deltas['core_todo'])}`)",
                f"- `test_files`: {metrics['test_files']} (delta `{signed(deltas['test_files'])}`)",
            ]
        )
        return "\n".join(lines) + "\n"

    lines.extend(
        [
            f"Run timestamp (UTC): `{report['runAt']}`",
            "",
            "## Metric Summary",
            "",
            "| Metric | Current | Delta |",
            "| --- | ---: | ---: |",
            f"| `docs_superseded` | {metrics['docs_superseded']} | {signed(deltas['docs_superseded'])} |",
            f"| `docs_todo` | {metrics['docs_todo']} | {signed(deltas['docs_todo'])} |",
            f"| `core_todo` | {metrics['core_todo']} | {signed(deltas['core_todo'])} |",
            f"| `test_files` | {metrics['test_files']} | {signed(deltas['test_files'])} |",
            "",
            "## Superseded/Diverged Docs",
        ]
    )
    if superseded["items"]:
        for item in superseded["items"]:
            lines.append(f"- `{item['path']}` (`{item['status']}`)")
        if superseded["truncated"] > 0:
            lines.append(f"- +{superseded['truncated']} more")
    else:
        lines.append("- none")
    lines.extend([""])

    append_hits(lines, "TODO/TBD/FIXME Hits (Docs)", todo_docs["items"], todo_docs["truncated"])
    lines.extend([""])
    append_hits(lines, "TODO/TBD/FIXME Hits (Core)", todo_core["items"], todo_core["truncated"])
    lines.extend(["", "## Test File Delta", ""])
    lines.extend(
        [
            f"- previous: `{test_delta['previous']}`",
            f"- current: `{test_delta['current']}`",
            f"- signed delta: `{signed(test_delta['delta'])}`",
            f"- previous hash: `{test_delta['previous_hash']}`",
            f"- current hash: `{test_delta['current_hash']}`",
        ]
    )
    if test_delta["added"]:
        lines.append("- added:")
        for path in test_delta["added"][:20]:
            lines.append(f"  - `{path}`")
        if len(test_delta["added"]) > 20:
            lines.append(f"  - +{len(test_delta['added']) - 20} more")
    if test_delta["removed"]:
        lines.append("- removed:")
        for path in test_delta["removed"][:20]:
            lines.append(f"  - `{path}`")
        if len(test_delta["removed"]) > 20:
            lines.append(f"  - +{len(test_delta['removed']) - 20} more")

    lines.extend(["", "## Diagnostics", ""])
    for diag in report.get("diagnostics", []):
        lines.append(
            f"- `{diag['stage']}` `{diag['reason_code']}` "
            f"(dirty_count={diag['dirty_count']}, fingerprint={diag['dirty_fingerprint']})"
        )
        if diag.get("representative_paths"):
            lines.append(f"  - representative paths: {', '.join(diag['representative_paths'])}")

    return "\n".join(lines) + "\n"


def build_pr_body(report: dict[str, Any]) -> str:
    metrics = report["metrics"]
    deltas = report["deltas"]
    test_delta = report["test_files"]
    docs_hits = report["todo_hits"]["docs"]
    core_hits = report["todo_hits"]["core"]
    superseded = report["superseded_docs"]

    lines: list[str] = [
        "## Architecture Audit Update",
        "",
        "- Snapshot path: `docs/audit-snapshot.md`",
        "- Canonical architecture index remains: `docs/current-architecture.md`",
        "",
        "### Metrics",
        "",
        f"- `docs_superseded`: {metrics['docs_superseded']} (delta `{signed(deltas['docs_superseded'])}`)",
        f"- `docs_todo`: {metrics['docs_todo']} (delta `{signed(deltas['docs_todo'])}`)",
        f"- `core_todo`: {metrics['core_todo']} (delta `{signed(deltas['core_todo'])}`)",
        f"- `test_files`: {metrics['test_files']} (delta `{signed(deltas['test_files'])}`)",
        "",
        "### Superseded/Diverged Docs",
    ]

    if superseded["items"]:
        for item in superseded["items"]:
            lines.append(f"- `{item['path']}` (`{item['status']}`)")
        if superseded["truncated"] > 0:
            lines.append(f"- +{superseded['truncated']} more")
    else:
        lines.append("- none")

    lines.extend(["", "### TODO/TBD/FIXME Hit Details", ""])
    append_hits(lines, "Docs", docs_hits["items"], docs_hits["truncated"])
    lines.extend([""])
    append_hits(lines, "Core", core_hits["items"], core_hits["truncated"])
    lines.extend(
        [
            "",
            "### Test File Delta",
            "",
            f"- previous: `{test_delta['previous']}`",
            f"- current: `{test_delta['current']}`",
            f"- signed delta: `{signed(test_delta['delta'])}`",
        ]
    )
    if test_delta["added"]:
        lines.append("- added:")
        for path in test_delta["added"][:20]:
            lines.append(f"  - `{path}`")
        if len(test_delta["added"]) > 20:
            lines.append(f"  - +{len(test_delta['added']) - 20} more")
    if test_delta["removed"]:
        lines.append("- removed:")
        for path in test_delta["removed"][:20]:
            lines.append(f"  - `{path}`")
        if len(test_delta["removed"]) > 20:
            lines.append(f"  - +{len(test_delta['removed']) - 20} more")

    lines.extend(["", f"- reason_code: `{report['reason_code']}`"])
    return "\n".join(lines) + "\n"


def parse_iso_utc(value: str) -> datetime:
    # GitHub returns timestamps like 2026-02-23T01:23:45Z.
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def update_latest_run(state_path: Path, updater: dict[str, Any]) -> None:
    state = load_state(state_path)
    latest = state.get("latest")
    if not isinstance(latest, dict):
        return

    payload = dict(updater)
    diagnostic = payload.pop("diagnostic", None)
    latest.update(payload)
    if diagnostic is not None:
        latest.setdefault("diagnostics", [])
        latest["diagnostics"].append(diagnostic)

    state["latest"] = latest
    runs = state.get("runs", [])
    if runs and isinstance(runs[-1], dict) and runs[-1].get("runAt") == latest.get("runAt"):
        runs[-1] = latest
        state["runs"] = runs
    save_state(state_path, state)


def cmd_run(args: argparse.Namespace) -> int:
    state_path = Path(args.state_file)
    snapshot_path = Path(args.snapshot_file)
    report_path = Path(args.report_file) if args.report_file else None
    pr_body_path = Path(args.pr_body_file) if args.pr_body_file else None

    state = load_state(state_path)
    previous = state.get("latest") if isinstance(state.get("latest"), dict) else None
    previous_metrics = previous.get("metrics") if previous else None
    previous_test_files = previous.get("test_files", {}).get("paths") if previous else None

    prewrite_diag = build_dirty_diagnostics(
        entries=git_status_entries(),
        stage="scan-prewrite",
        max_paths=args.max_representative_paths,
    )
    if prewrite_diag["reason_code"] == "CLEAN_TREE":
        prewrite_diag["reason_code"] = "SCAN_PREWRITE_CLEAN"
    else:
        prewrite_diag["reason_code"] = "SCAN_PREWRITE_DIRTY"

    metrics_bundle = collect_metrics(
        max_todo_hits=args.max_todo_hits,
        max_superseded_hits=args.max_superseded_hits,
    )
    metrics = metrics_bundle["metrics"]
    deltas, has_previous = compute_metric_deltas(metrics, previous_metrics)
    test_delta = compute_test_file_delta(metrics_bundle["test_files"], previous_test_files)
    no_change = has_previous and all(v == 0 for v in deltas.values())

    run_record: dict[str, Any] = {
        "runAt": now_utc_iso(),
        "ts": int(time.time()),
        "reason_code": "SCAN_OK",
        "metrics": metrics,
        "deltas": deltas,
        "has_previous": has_previous,
        "no_change": no_change,
        "superseded_docs": metrics_bundle["superseded_docs"],
        "todo_hits": metrics_bundle["todo_hits"],
        "test_files": test_delta,
        "diagnostics": [prewrite_diag],
    }

    snapshot_content = render_snapshot(run_record, compact_no_change=args.compact_no_change)
    pr_body_content = build_pr_body(run_record)

    state_written = False
    snapshot_written = False
    no_change_compacted = bool(args.compact_no_change and no_change and has_previous)

    if not no_change_compacted:
        snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        previous_snapshot = snapshot_path.read_text(encoding="utf-8") if snapshot_path.exists() else ""
        if previous_snapshot != snapshot_content:
            snapshot_path.write_text(snapshot_content, encoding="utf-8")
            snapshot_written = True

        runs = state.get("runs", [])
        runs.append(run_record)
        state["runs"] = runs[-MAX_STATE_RUNS:]
        state["latest"] = run_record
        state["updatedAt"] = run_record["runAt"]
        save_state(state_path, state)
        state_written = True

    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(run_record, indent=2) + "\n", encoding="utf-8")

    if pr_body_path:
        pr_body_path.parent.mkdir(parents=True, exist_ok=True)
        pr_body_path.write_text(pr_body_content, encoding="utf-8")

    output = {
        "report": run_record,
        "state_file": normalize_path(str(state_path)),
        "snapshot_file": normalize_path(str(snapshot_path)),
        "state_written": state_written,
        "snapshot_written": snapshot_written,
        "no_change_compacted": no_change_compacted,
    }
    print(json.dumps(output, indent=2))
    return 0


def cmd_dirty_gate(args: argparse.Namespace) -> int:
    state_path = Path(args.state_file)
    expected = {normalize_path(path) for path in args.expected_path}

    diagnostics = build_dirty_diagnostics(
        entries=git_status_entries(),
        stage=args.stage,
        expected_paths=expected,
        max_paths=args.max_representative_paths,
    )

    auto_stash_flag = (os.getenv(args.auto_stash_env, "") if args.auto_stash_env else "").lower()
    auto_stash = auto_stash_flag in {"1", "true", "yes", "on"}
    if diagnostics["blocked"] and auto_stash and diagnostics["unexpected_paths"]:
        stash_msg = f"architecture-audit-{args.stage}-{int(time.time())}"
        subprocess.run(
            ["git", "stash", "push", "--include-untracked", "--message", stash_msg, "--", *diagnostics["unexpected_paths"]],
            check=False,
            capture_output=True,
            text=True,
        )
        diagnostics = build_dirty_diagnostics(
            entries=git_status_entries(),
            stage=args.stage,
            expected_paths=expected,
            max_paths=args.max_representative_paths,
        )
        if not diagnostics["blocked"]:
            diagnostics["reason_code"] = "DIRTY_TREE_AUTOSTASHED"

    append_diagnostic_to_state(state_path, diagnostics)

    if args.write_json:
        out_path = Path(args.write_json)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(diagnostics, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(diagnostics, indent=2))
    return 0


def cmd_record_open_pr_block(args: argparse.Namespace) -> int:
    state_path = Path(args.state_file)
    created_at = parse_iso_utc(args.pr_created_at)
    now = datetime.now(timezone.utc)
    hours_blocked = max(0.0, (now - created_at).total_seconds() / 3600.0)

    if hours_blocked >= args.critical_hours:
        level = "critical"
    elif hours_blocked >= args.warning_hours:
        level = "warning"
    else:
        level = "info"

    escalation = {
        "runAt": now_utc_iso(),
        "stage": "open-pr-gate",
        "source": "gh_pr_list",
        "reason_code": "OPEN_PR_BLOCKED",
        "blocked": True,
        "pr_url": args.pr_url,
        "pr_owner": args.pr_owner,
        "hoursBlockedByOpenPr": round(hours_blocked, 2),
        "thresholdHours": {
            "warning": args.warning_hours,
            "critical": args.critical_hours,
        },
        "level": level,
        "requiredNextAction": args.required_next_action,
    }

    message = (
        f"Open architecture-audit PR has blocked new PR creation for "
        f"{hours_blocked:.2f} hours ({args.pr_url}, owner: {args.pr_owner}). "
        f"Required action: {args.required_next_action}"
    )
    if level in {"warning", "critical"}:
        message = f"[{level.upper()}] {message}"

    update_latest_run(
        state_path,
        {
            "reason_code": "OPEN_PR_BLOCKED",
            "blocking": escalation,
            "diagnostic": escalation,
        },
    )

    payload = {"reason_code": "OPEN_PR_BLOCKED", "message": message, "blocking": escalation}
    if args.write_json:
        out_path = Path(args.write_json)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(payload, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Architecture audit automation helper")
    sub = parser.add_subparsers(dest="command", required=True)

    run_parser = sub.add_parser("run", help="Scan repository and generate snapshot/state")
    run_parser.add_argument("--state-file", default=DEFAULT_STATE_FILE)
    run_parser.add_argument("--snapshot-file", default=DEFAULT_SNAPSHOT_FILE)
    run_parser.add_argument("--report-file", default="")
    run_parser.add_argument("--pr-body-file", default="")
    run_parser.add_argument("--max-todo-hits", type=int, default=20)
    run_parser.add_argument("--max-superseded-hits", type=int, default=20)
    run_parser.add_argument("--max-representative-paths", type=int, default=8)
    run_parser.add_argument("--compact-no-change", action="store_true")
    run_parser.set_defaults(func=cmd_run)

    dirty_parser = sub.add_parser(
        "dirty-gate",
        help="Evaluate dirty tree diagnostics before PR creation and persist diagnostics",
    )
    dirty_parser.add_argument("--state-file", default=DEFAULT_STATE_FILE)
    dirty_parser.add_argument("--stage", default="pre-pr-create")
    dirty_parser.add_argument("--expected-path", action="append", default=[])
    dirty_parser.add_argument("--max-representative-paths", type=int, default=8)
    dirty_parser.add_argument("--auto-stash-env", default="")
    dirty_parser.add_argument("--write-json", default="")
    dirty_parser.set_defaults(func=cmd_dirty_gate)

    pr_block_parser = sub.add_parser(
        "record-open-pr-block",
        help="Record blocked-by-open-pr duration and escalation metadata",
    )
    pr_block_parser.add_argument("--state-file", default=DEFAULT_STATE_FILE)
    pr_block_parser.add_argument("--pr-url", required=True)
    pr_block_parser.add_argument("--pr-owner", required=True)
    pr_block_parser.add_argument("--pr-created-at", required=True)
    pr_block_parser.add_argument("--warning-hours", type=float, default=6.0)
    pr_block_parser.add_argument("--critical-hours", type=float, default=24.0)
    pr_block_parser.add_argument(
        "--required-next-action",
        default="Review and merge or close the existing architecture-audit PR.",
    )
    pr_block_parser.add_argument("--write-json", default="")
    pr_block_parser.set_defaults(func=cmd_record_open_pr_block)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
