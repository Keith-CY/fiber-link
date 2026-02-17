#!/usr/bin/env python3
"""Hourly task 1 helper for Fiber Link.

Modes:
- scan: gather findings and persist state JSON for later reporting.
- report: summarize persisted findings from the last 60 minutes.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import time
from dataclasses import dataclass
from typing import Dict, List, Tuple

REPO = "Keith-CY/fiber-link"
STATE_FILE = "/root/.openclaw/workspace/memory/fiber-link-task1-state.json"


def run_gh(args: List[str]) -> str:
    proc = subprocess.run(
        ["gh", "-R", REPO, *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return proc.stdout.strip()


def list_json(resource: str, assignee: str | None = None, label: str | None = None) -> List[dict]:
    if resource == "issue":
        args = ["issue", "list", "--state", "open", "--json", "number,title,url,body,labels,assignees"]
    elif resource == "pr":
        args = ["pr", "list", "--state", "open", "--json", "number,title,url,reviewDecision,body,headRefName"]
    else:
        raise ValueError(resource)

    if assignee:
        args.extend(["--assignee", assignee])
    if label:
        args.extend(["--label", label])

    raw = run_gh(args)
    return json.loads(raw or "[]")


def source_pr_from_issue_body(body: str) -> int | None:
    m = re.search(r"Source PR:\s*https://github.com/[^/]+/[^/]+/pull/(\\d+)", body or "")
    if not m:
        return None
    return int(m.group(1))


def pr_state(pr_num: int, cache: Dict[int, str]) -> str:
    if pr_num in cache:
        return cache[pr_num]
    state = run_gh(["pr", "view", str(pr_num), "--json", "state", "--jq", ".state"]).strip()
    cache[pr_num] = state
    return state


def analyze() -> dict:
    assigned = list_json("issue", assignee="@me")
    nbs = list_json("issue", label="nbs")
    change_requests = [
        item for item in list_json("pr") if item.get("reviewDecision") == "CHANGES_REQUESTED"
    ]

    pr_state_cache: Dict[int, str] = {}
    unbound_nbs = []
    for issue in nbs:
        pr_num = source_pr_from_issue_body(issue.get("body", "") or "")
        if not pr_num:
            unbound_nbs.append({"issue": issue, "reason": "missing-source-pr"})
            continue
        state = pr_state(pr_num, pr_state_cache)
        if state != "OPEN":
            unbound_nbs.append({"issue": issue, "reason": f"source-pr-{state.lower()}"})

    return {
        "assigned": assigned,
        "nbs": nbs,
        "changeRequests": change_requests,
        "unboundNbs": unbound_nbs,
        "counts": {
            "assigned": len(assigned),
            "nbs": len(nbs),
            "unboundNbs": len(unbound_nbs),
            "changeRequests": len(change_requests),
        },
        "ts": int(time.time()),
        "runAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def load_state() -> dict:
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {"runs": []}


def save_state(snapshot: dict) -> None:
    payload = load_state()
    runs = payload.get("runs", [])
    runs.append(snapshot)
    # keep last 300 entries as a bounded buffer (~24h for 20m cadence)
    payload["runs"] = runs[-300:]
    payload["latestRun"] = snapshot
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def summarize(snapshot: dict) -> str:
    lines = [
        f"Scan at {snapshot['runAt']}",
        f"Assigned issues: {snapshot['counts']['assigned']}",
        f"Open nbs issues: {snapshot['counts']['nbs']} (unbound/non-open-source PR: {snapshot['counts']['unboundNbs']})",
        f"PRs with CHANGES_REQUESTED: {snapshot['counts']['changeRequests']}",
    ]

    if snapshot["counts"]["assigned"]:
        lines.append("- Assigned issues:")
        for i in snapshot["assigned"]:
            lines.append(f"  - #{i['number']} {i['title']} ({i['url']})")

    if snapshot["counts"]["unboundNbs"]:
        lines.append("- Unbound nbs issues:")
        for u in snapshot["unboundNbs"]:
            issue = u["issue"]
            lines.append(f"  - #{issue['number']} {issue['title']} [{u['reason']}] ({issue['url']})")

    if snapshot["counts"]["changeRequests"]:
        lines.append("- PRs blocked by change request:")
        for p in snapshot["changeRequests"]:
            lines.append(f"  - #{p['number']} {p['title']} ({p['url']})")

    if not any([
        snapshot["counts"]["assigned"],
        snapshot["counts"]["unboundNbs"],
        snapshot["counts"]["changeRequests"],
    ]):
        lines.append("- No actionable items.")
    return "\n".join(lines)


def run_report(hours: int = 1) -> str:
    state = load_state()
    runs = state.get("runs", [])
    if not runs:
        return "No task-1 runs recorded yet."
    now = int(time.time())
    cutoff = now - hours * 3600
    recent = [r for r in runs if r.get("ts", 0) >= cutoff]

    summary = {
        "runs": len(recent),
        "totalAssigned": sum(r["counts"]["assigned"] for r in recent),
        "totalNbs": sum(r["counts"]["nbs"] for r in recent),
        "totalUnboundNbs": sum(r["counts"]["unboundNbs"] for r in recent),
        "totalChangeRequests": sum(r["counts"]["changeRequests"] for r in recent),
        "latest": summarize(recent[-1]) if recent else "No data",
        "windowFrom": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(cutoff)),
        "windowTo": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
    }

    if not recent:
        return f"No task-1 scans in the last {hours}h."

    lines = [
        f"Task-1 report ({hours}h): {summary['runs']} scan runs",
        f"Total assigned open issues: {summary['totalAssigned']}",
        f"Total open nbs: {summary['totalNbs']} (unbound/non-open-source-PR: {summary['totalUnboundNbs']})",
        f"Total PRs with CHANGES_REQUESTED: {summary['totalChangeRequests']}",
        "",
        "Latest run:",
        summarize(recent[-1]),
    ]
    return "\n".join(lines)


@dataclass
class Args:
    mode: str


def parse_args() -> Args:
    p = argparse.ArgumentParser(description="Fiber Link hourly task 1 monitor")
    p.add_argument("--mode", choices=["scan", "report", "scan-and-report"], default="scan")
    p.add_argument("--hours", type=int, default=1, help="Report lookback window hours")
    return p.parse_args(namespace=Args("scan"))


def main() -> int:
    args = parse_args()
    if args.mode == "scan":
        snapshot = analyze()
        save_state(snapshot)
        print(summarize(snapshot))
        return 0

    if args.mode == "scan-and-report":
        snapshot = analyze()
        save_state(snapshot)
        print(run_report(hours=args.hours))
        return 0

    print(run_report(hours=args.hours))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
