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
    m = re.search(r"Source PR:\\s*https://github.com/[^/]+/[^/]+/pull/(\\d+)", body or "")
    if not m:
        return None
    return int(m.group(1))


def pr_state(pr_num: int, cache: Dict[int, str]) -> str:
    if pr_num in cache:
        return cache[pr_num]
    state = run_gh(["pr", "view", str(pr_num), "--json", "state", "--jq", ".state"]).strip()
    cache[pr_num] = state
    return state


def classify_with_source_pr(issues: List[dict], pr_state_cache: Dict[int, str]) -> Tuple[List[dict], List[dict], List[dict]]:
    """
    Returns:
      actionable_issues: no source PR or source PR is not OPEN
      bound_issues: source PR exists and is OPEN (skip handling)
      unbound_issues: actionable list with reason
    """
    actionable: List[dict] = []
    bound: List[dict] = []
    unbound: List[dict] = []

    for issue in issues:
        pr_num = source_pr_from_issue_body(issue.get("body", "") or "")
        if not pr_num:
            reason = {"issue": issue, "reason": "missing-source-pr"}
            actionable.append(reason)
            unbound.append(reason)
            continue

        state = pr_state(pr_num, pr_state_cache)
        if state == "OPEN":
            bound.append(issue)
            continue

        reason = {"issue": issue, "reason": f"source-pr-{state.lower()}"}
        actionable.append(reason)
        unbound.append(reason)

    return actionable, bound, unbound


def count_metric(snapshot: dict, key: str, *fallback_keys: str) -> int:
    counts = snapshot.get("counts", {})
    if key in counts:
        return counts[key]
    for fallback in fallback_keys:
        if fallback in counts:
            return counts[fallback]
    return 0


def snapshot_items(snapshot: dict, key: str, *fallback_keys: str) -> List[dict]:
    items = snapshot.get(key)
    if isinstance(items, list):
        return items
    for fallback in fallback_keys:
        items = snapshot.get(fallback)
        if isinstance(items, list):
            return items
    return []


def analyze() -> dict:
    state_cache: Dict[int, str] = {}

    open_issues = list_json("issue")
    nbs_issues = list_json("issue", label="nbs")

    actionable_open_with_reason, _, _ = classify_with_source_pr(open_issues, state_cache)
    actionable_nbs_with_reason, _, unbound_nbs = classify_with_source_pr(nbs_issues, state_cache)
    open_actionable_issues = [item["issue"] for item in actionable_open_with_reason]

    change_requests = [
        item for item in list_json("pr") if item.get("reviewDecision") == "CHANGES_REQUESTED"
    ]

    return {
        "open": open_actionable_issues,
        "openUnbound": actionable_open_with_reason,
        # Backward compatibility for historical state consumers.
        "assigned": open_actionable_issues,
        "assignedUnbound": actionable_open_with_reason,
        "nbs": nbs_issues,
        "nbsUnbound": unbound_nbs,
        "changeRequests": change_requests,
        "counts": {
            "open": len(actionable_open_with_reason),
            # Backward compatibility for historical state consumers.
            "assigned": len(actionable_open_with_reason),
            "nbs": len(nbs_issues),
            "nbsUnbound": len(unbound_nbs),
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
    open_count = count_metric(snapshot, "open", "assigned")
    lines = [
        f"Scan at {snapshot['runAt']}",
        f"Open issues requiring handling: {open_count}",
        f"Open nbs issues: {count_metric(snapshot, 'nbs')} (unbound/non-open-source PR: {count_metric(snapshot, 'nbsUnbound')})",
        f"PRs with CHANGES_REQUESTED: {count_metric(snapshot, 'changeRequests')}",
    ]

    if open_count:
        lines.append("- Open issues to handle:")
        for i in snapshot_items(snapshot, "open", "assigned"):
            lines.append(f"  - #{i['number']} {i['title']} ({i['url']})")

    if count_metric(snapshot, "nbsUnbound"):
        lines.append("- Unbound nbs issues:")
        for u in snapshot_items(snapshot, "nbsUnbound"):
            issue = u["issue"]
            lines.append(f"  - #{issue['number']} {issue['title']} [{u['reason']}] ({issue['url']})")

    if count_metric(snapshot, "changeRequests"):
        lines.append("- PRs blocked by change request:")
        for p in snapshot_items(snapshot, "changeRequests"):
            lines.append(f"  - #{p['number']} {p['title']} ({p['url']})")

    if not any([
        open_count,
        count_metric(snapshot, "nbsUnbound"),
        count_metric(snapshot, "changeRequests"),
    ]):
        lines.append("- No actionable items.")
    return "\n".join(lines)


def changed_since_last(snapshot: dict, state: dict) -> bool:
    runs = state.get("runs", [])
    if not runs:
        return True
    last = runs[-1]
    # report when actionable counts change
    return any(
        count_metric(last, key, *fallback_keys) != count_metric(snapshot, key, *fallback_keys)
        for key, fallback_keys in [("open", ("assigned",)), ("nbsUnbound", ()), ("changeRequests", ())]
    )


def has_actionable(snapshot: dict) -> bool:
    return any(
        [
            count_metric(snapshot, "open", "assigned") > 0,
            count_metric(snapshot, "nbsUnbound") > 0,
            count_metric(snapshot, "changeRequests") > 0,
        ]
    )


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
        "totalOpen": sum(count_metric(r, "open", "assigned") for r in recent),
        "totalNbs": sum(count_metric(r, "nbs") for r in recent),
        "totalUnboundNbs": sum(count_metric(r, "nbsUnbound") for r in recent),
        "totalChangeRequests": sum(count_metric(r, "changeRequests") for r in recent),
        "latest": summarize(recent[-1]) if recent else "No data",
        "windowFrom": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(cutoff)),
        "windowTo": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
    }

    if not recent:
        return f"No task-1 scans in the last {hours}h."

    if summary["totalOpen"] == 0 and summary["totalUnboundNbs"] == 0 and summary["totalChangeRequests"] == 0:
        return ""

    lines = [
        f"Task-1 report ({hours}h): {summary['runs']} scan runs",
        f"Total open issues requiring handling: {summary['totalOpen']}",
        f"Total open nbs: {summary['totalNbs']} (unbound/non-open-source PR: {summary['totalUnboundNbs']})",
        f"Total PRs with CHANGES_REQUESTED: {summary['totalChangeRequests']}",
        "",
        "Latest run:",
        summarize(recent[-1]),
    ]
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fiber Link hourly task 1 monitor")
    p.add_argument("--mode", choices=["scan", "report", "scan-and-report"], default="scan")
    p.add_argument("--hours", type=int, default=1, help="Report lookback window hours")
    p.add_argument(
        "--only-changes",
        action="store_true",
        help="For report mode, suppress output when totals are unchanged and no actionables exist",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if args.mode == "scan":
        snapshot = analyze()
        save_state(snapshot)
        if has_actionable(snapshot):
            print(summarize(snapshot))
        return 0

    if args.mode == "scan-and-report":
        snapshot = analyze()
        state = load_state()
        if args.only_changes and not changed_since_last(snapshot, state):
            return 0
        save_state(snapshot)
        output = run_report(hours=args.hours)
        if output:
            print(output)
        return 0

    output = run_report(hours=args.hours)
    if output:
        print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
