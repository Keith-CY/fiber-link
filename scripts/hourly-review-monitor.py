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
from datetime import datetime, timezone
from typing import Dict, List, Set, Tuple

REPO = "Keith-CY/fiber-link"
STATE_FILE = "/root/.openclaw/workspace/memory/fiber-link-task1-state.json"
CHECK_INTERVAL_MINUTES = 20
NO_UPDATE_ESCALATION_THRESHOLD = 3
MERGE_READY_STREAK_THRESHOLD = 3
MAX_UNCHANGED_ALERTS_PER_DAY = 3
STALE_OPEN_PR_HOURS = 24.0


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
        args = [
            "pr",
            "list",
            "--state",
            "open",
            "--json",
            "number,title,url,reviewDecision,body,headRefName,headRefOid,updatedAt,author",
        ]
    else:
        raise ValueError(resource)

    if assignee:
        args.extend(["--assignee", assignee])
    if label:
        args.extend(["--label", label])

    raw = run_gh(args)
    return json.loads(raw or "[]")


def iso_utc(ts: int) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def parse_iso_utc(ts: str | None) -> int | None:
    if not ts:
        return None
    try:
        return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def source_pr_from_issue_body(body: str) -> int | None:
    m = re.search(r"Source PR:\s*https://github.com/[^/]+/[^/]+/pull/(\d+)", body or "")
    if not m:
        return None
    return int(m.group(1))


def has_label(issue: dict, label_name: str) -> bool:
    return any((label.get("name") or "").lower() == label_name.lower() for label in issue.get("labels", []))


def pr_state(pr_num: int, cache: Dict[int, str]) -> str:
    if pr_num in cache:
        return cache[pr_num]
    state = run_gh(["pr", "view", str(pr_num), "--json", "state", "--jq", ".state"]).strip()
    cache[pr_num] = state
    return state


def normalize_pr(pr: dict, now_ts: int) -> dict:
    updated_at = pr.get("updatedAt")
    updated_ts = parse_iso_utc(updated_at)
    unchanged_hours = None
    if updated_ts is not None:
        unchanged_hours = round(max(0, now_ts - updated_ts) / 3600, 2)
    author = pr.get("author") if isinstance(pr.get("author"), dict) else {}
    return {
        "number": pr.get("number"),
        "title": pr.get("title"),
        "url": pr.get("url"),
        "headSha": pr.get("headRefOid") or "",
        "headRefName": pr.get("headRefName"),
        "reviewDecision": pr.get("reviewDecision"),
        "updatedAt": updated_at,
        "author": author.get("login"),
        "unchangedHours": unchanged_hours,
    }


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


def metric_value(snapshot: dict, key: str, default: float | int | None = None):
    return snapshot.get("metrics", {}).get(key, default)


def snapshot_items(snapshot: dict, key: str, *fallback_keys: str) -> List[dict]:
    items = snapshot.get(key)
    if isinstance(items, list):
        return items
    for fallback in fallback_keys:
        items = snapshot.get(fallback)
        if isinstance(items, list):
            return items
    return []


def pr_head_map(snapshot: dict) -> Dict[int, str]:
    heads: Dict[int, str] = {}
    for pr in snapshot_items(snapshot, "openPrs"):
        number = pr.get("number")
        if isinstance(number, int):
            heads[number] = pr.get("headSha") or ""
    return heads


def pr_review_decision_map(snapshot: dict) -> Dict[int, str]:
    decisions: Dict[int, str] = {}
    for pr in snapshot_items(snapshot, "openPrs"):
        number = pr.get("number")
        if isinstance(number, int):
            decisions[number] = pr.get("reviewDecision") or ""
    return decisions


def format_head_sha_pairs(previous: Dict[int, str], current: Dict[int, str]) -> str:
    pr_numbers = sorted(set(previous.keys()) | set(current.keys()))
    if not pr_numbers:
        return "none"
    rendered = []
    for pr_num in pr_numbers:
        prev_sha = previous.get(pr_num, "-")
        cur_sha = current.get(pr_num, "-")
        rendered.append(f"#{pr_num} {prev_sha[:7]}/{cur_sha[:7]}")
    return ", ".join(rendered)


def primary_change_source(sources: List[str]) -> str:
    for source in ["sha", "reviewDecision", "ci"]:
        if source in sources:
            return source
    return "none"


def detect_change(snapshot: dict, state: dict) -> dict:
    runs = state.get("runs", [])
    if not runs:
        return {"changed": True, "sources": ["ci"], "details": {}}

    last = runs[-1]
    sources: Set[str] = set()
    details: Dict[str, object] = {}

    previous_heads = pr_head_map(last)
    current_heads = pr_head_map(snapshot)
    if previous_heads != current_heads:
        sources.add("sha")
        details["headSha"] = {
            "previous": previous_heads,
            "current": current_heads,
        }

    previous_review = pr_review_decision_map(last)
    current_review = pr_review_decision_map(snapshot)
    if previous_review != current_review:
        sources.add("reviewDecision")
        details["reviewDecision"] = {
            "previous": previous_review,
            "current": current_review,
        }

    if any(
        count_metric(last, key, *fallback_keys) != count_metric(snapshot, key, *fallback_keys)
        for key, fallback_keys in [("open", ("assigned",)), ("nbsUnbound", ()), ("changeRequests", ())]
    ):
        sources.add("ci")

    source_list = sorted(sources)
    return {
        "changed": bool(source_list),
        "sources": source_list,
        "details": details,
    }


def analyze() -> dict:
    state_cache: Dict[int, str] = {}
    now_ts = int(time.time())

    open_issues = list_json("issue")
    actionable_open_with_reason, _, _ = classify_with_source_pr(open_issues, state_cache)
    open_actionable_issues = [item["issue"] for item in actionable_open_with_reason]
    nbs_issues = [issue for issue in open_issues if has_label(issue, "nbs")]
    unbound_nbs = [item for item in actionable_open_with_reason if has_label(item["issue"], "nbs")]

    raw_open_prs = list_json("pr")
    open_prs = [normalize_pr(pr, now_ts) for pr in raw_open_prs]
    change_requests = [pr for pr in open_prs if pr.get("reviewDecision") == "CHANGES_REQUESTED"]
    stale_open_prs = [
        pr for pr in open_prs if (pr.get("unchangedHours") is not None and pr.get("unchangedHours", 0) >= STALE_OPEN_PR_HOURS)
    ]

    pr208 = next((pr for pr in open_prs if pr.get("number") == 208), None)
    pr208_unchanged_hours = pr208.get("unchangedHours") if pr208 else None

    signals: List[str] = []
    if len(actionable_open_with_reason) == 0 and len(open_prs) > 0:
        signals.append("stagnation_signal")
    if stale_open_prs:
        signals.append("stale_open_pr_watchdog")

    oldest_unchanged_hours = max((pr.get("unchangedHours", 0) for pr in stale_open_prs), default=0)

    return {
        "open": open_actionable_issues,
        "openUnbound": actionable_open_with_reason,
        # Backward compatibility for historical state consumers.
        "assigned": open_actionable_issues,
        "assignedUnbound": actionable_open_with_reason,
        "nbs": nbs_issues,
        "nbsUnbound": unbound_nbs,
        "changeRequests": change_requests,
        "openPrs": open_prs,
        "staleOpenPrs": stale_open_prs,
        "signals": signals,
        "metrics": {
            "candidateIssues": len(actionable_open_with_reason),
            "openPrCount": len(open_prs),
            "staleOpenPrCount": len(stale_open_prs),
            "oldestOpenPrUnchangedHours": oldest_unchanged_hours,
            "pr208UnchangedHours": pr208_unchanged_hours,
        },
        "counts": {
            "open": len(actionable_open_with_reason),
            # Backward compatibility for historical state consumers.
            "assigned": len(actionable_open_with_reason),
            "nbs": len(nbs_issues),
            "nbsUnbound": len(unbound_nbs),
            "changeRequests": len(change_requests),
            "openPrs": len(open_prs),
            "staleOpenPrs": len(stale_open_prs),
        },
        "changeDetectionSource": "ci",
        "changeDetectionSources": ["ci"],
        "ts": now_ts,
        "runAt": iso_utc(now_ts),
        "nextActionAt": iso_utc(now_ts + CHECK_INTERVAL_MINUTES * 60),
    }


def load_state() -> dict:
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {"runs": []}


def write_state(payload: dict) -> None:
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def save_state(snapshot: dict, metadata: dict | None = None) -> None:
    payload = load_state()
    runs = payload.get("runs", [])
    runs.append(snapshot)
    # keep last 300 entries as a bounded buffer (~24h for 20m cadence)
    payload["runs"] = runs[-300:]
    payload["latestRun"] = snapshot
    if metadata:
        payload.update(metadata)
    write_state(payload)


def save_metadata(metadata: dict) -> None:
    payload = load_state()
    payload.update(metadata)
    write_state(payload)


def enrich_snapshot(snapshot: dict, state: dict) -> dict:
    change = detect_change(snapshot, state)
    sources = change["sources"]
    snapshot["changeDetectionSources"] = sources
    snapshot["changeDetectionSource"] = primary_change_source(sources)
    snapshot["changeDetectionDetails"] = change["details"]
    snapshot["nextActionAt"] = iso_utc(int(time.time()) + CHECK_INTERVAL_MINUTES * 60)

    previous_clean_streak = int(state.get("cleanRunStreak", 0))
    clean_streak = 0 if has_actionable(snapshot) else previous_clean_streak + 1
    snapshot["cleanRunStreak"] = clean_streak
    snapshot["mergeReady"] = clean_streak >= MERGE_READY_STREAK_THRESHOLD
    return change


def summarize(snapshot: dict) -> str:
    open_count = count_metric(snapshot, "open", "assigned")
    open_pr_count = count_metric(snapshot, "openPrs")
    stale_open_pr_count = count_metric(snapshot, "staleOpenPrs")

    lines = [
        f"Scan at {snapshot['runAt']}",
        f"Open issues requiring handling: {open_count}",
        f"Open nbs issues: {count_metric(snapshot, 'nbs')} (unbound/non-open-source PR: {count_metric(snapshot, 'nbsUnbound')})",
        f"PRs with CHANGES_REQUESTED: {count_metric(snapshot, 'changeRequests')}",
        f"Open PRs (watchdog): {open_pr_count} (stale >= {int(STALE_OPEN_PR_HOURS)}h: {stale_open_pr_count})",
        f"changeDetectionSource: {snapshot.get('changeDetectionSource', 'unknown')}",
        f"nextActionAt: {snapshot.get('nextActionAt', 'n/a')}",
    ]

    pr208_unchanged_hours = metric_value(snapshot, "pr208UnchangedHours")
    if isinstance(pr208_unchanged_hours, (int, float)):
        lines.append(f"pr208UnchangedHours: {pr208_unchanged_hours:.2f}")

    if snapshot.get("signals"):
        lines.append(f"signals: {', '.join(snapshot.get('signals', []))}")

    if snapshot.get("mergeReady"):
        lines.append(f"mergeReadiness: ready (clean streak: {snapshot.get('cleanRunStreak', 0)})")
    else:
        lines.append(f"mergeReadiness: waiting (clean streak: {snapshot.get('cleanRunStreak', 0)})")

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

    if stale_open_pr_count:
        lines.append("- Stale open PR watchdog candidates:")
        for p in snapshot_items(snapshot, "staleOpenPrs"):
            owner = p.get("author") or "unknown-owner"
            unchanged_hours = p.get("unchangedHours")
            if isinstance(unchanged_hours, (int, float)):
                lines.append(
                    f"  - #{p['number']} {p['title']} ({p['url']}) owner={owner} unchangedHours={unchanged_hours:.2f}"
                )
            else:
                lines.append(f"  - #{p['number']} {p['title']} ({p['url']}) owner={owner}")

    if not any(
        [
            open_count,
            count_metric(snapshot, "nbsUnbound"),
            count_metric(snapshot, "changeRequests"),
            stale_open_pr_count,
            bool(snapshot.get("signals")),
        ]
    ):
        lines.append("- No actionable items.")
    return "\n".join(lines)


def build_skip_summary(last_snapshot: dict, current_snapshot: dict, skips: int, escalated: bool) -> str:
    previous_heads = pr_head_map(last_snapshot)
    current_heads = pr_head_map(current_snapshot)
    head_pairs = format_head_sha_pairs(previous_heads, current_heads)
    level = "ESCALATED" if escalated else "INFO"
    return "\n".join(
        [
            f"Skip summary ({level}): no meaningful change detected.",
            f"headSha previous/current: {head_pairs}",
            f"consecutiveNoUpdateSkips: {skips}",
            f"nextActionAt: {current_snapshot.get('nextActionAt', 'n/a')}",
        ]
    )


def changed_since_last(snapshot: dict, state: dict) -> bool:
    return detect_change(snapshot, state)["changed"]


def has_actionable(snapshot: dict) -> bool:
    return (
        count_metric(snapshot, "open", "assigned") > 0
        or count_metric(snapshot, "nbsUnbound") > 0
        or count_metric(snapshot, "changeRequests") > 0
        or count_metric(snapshot, "staleOpenPrs") > 0
        or bool(snapshot.get("signals"))
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
        "totalStaleOpenPrs": sum(count_metric(r, "staleOpenPrs") for r in recent),
        "totalSignals": sum(len(r.get("signals", [])) for r in recent),
        "latest": summarize(recent[-1]) if recent else "No data",
        "windowFrom": iso_utc(cutoff),
        "windowTo": iso_utc(now),
    }

    if not recent:
        return f"No task-1 scans in the last {hours}h."

    if (
        summary["totalOpen"] == 0
        and summary["totalUnboundNbs"] == 0
        and summary["totalChangeRequests"] == 0
        and summary["totalStaleOpenPrs"] == 0
        and summary["totalSignals"] == 0
    ):
        return ""

    lines = [
        f"Task-1 report ({hours}h): {summary['runs']} scan runs",
        f"Total open issues requiring handling: {summary['totalOpen']}",
        f"Total open nbs: {summary['totalNbs']} (unbound/non-open-source PR: {summary['totalUnboundNbs']})",
        f"Total PRs with CHANGES_REQUESTED: {summary['totalChangeRequests']}",
        f"Total stale open PR watchdog hits: {summary['totalStaleOpenPrs']}",
        f"Total signals emitted: {summary['totalSignals']}",
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
    state = load_state()

    if args.mode == "scan":
        snapshot = analyze()
        enrich_snapshot(snapshot, state)
        metadata = {
            "cleanRunStreak": snapshot.get("cleanRunStreak", 0),
            "consecutiveNoUpdateSkips": 0,
            "unchangedAlertDay": iso_utc(int(time.time()))[:10],
            "unchangedAlertCount": 0,
            "nextActionAt": snapshot.get("nextActionAt"),
        }
        save_state(snapshot, metadata)
        if has_actionable(snapshot):
            print(summarize(snapshot))
        return 0

    if args.mode == "scan-and-report":
        snapshot = analyze()
        change = enrich_snapshot(snapshot, state)

        if args.only_changes and not change["changed"]:
            runs = state.get("runs", [])
            last_snapshot = runs[-1] if runs else {}
            skips = int(state.get("consecutiveNoUpdateSkips", 0)) + 1
            escalated = skips >= NO_UPDATE_ESCALATION_THRESHOLD

            today = iso_utc(int(time.time()))[:10]
            alert_day = state.get("unchangedAlertDay")
            alert_count = int(state.get("unchangedAlertCount", 0)) if alert_day == today else 0
            can_alert = alert_count < MAX_UNCHANGED_ALERTS_PER_DAY or escalated

            if can_alert:
                print(build_skip_summary(last_snapshot, snapshot, skips, escalated))
                alert_count += 1

            save_metadata(
                {
                    "consecutiveNoUpdateSkips": skips,
                    "unchangedAlertDay": today,
                    "unchangedAlertCount": alert_count,
                    "nextActionAt": snapshot.get("nextActionAt"),
                    "lastSkipAt": iso_utc(int(time.time())),
                }
            )
            return 0

        metadata = {
            "cleanRunStreak": snapshot.get("cleanRunStreak", 0),
            "consecutiveNoUpdateSkips": 0,
            "unchangedAlertDay": iso_utc(int(time.time()))[:10],
            "unchangedAlertCount": 0,
            "nextActionAt": snapshot.get("nextActionAt"),
        }
        save_state(snapshot, metadata)
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
