#!/usr/bin/env python3
"""Hourly task 1 helper for Fiber Link.

Modes:
- scan: gather findings and persist state JSON for later reporting.
- report: summarize persisted findings from the last 60 minutes.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Set, Tuple

REPO = "Keith-CY/fiber-link"
STATE_FILE = "/root/.openclaw/workspace/memory/fiber-link-task1-state.json"
REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_ARCH_INDEX_FILE = REPO_ROOT / "docs/current-architecture.md"
CHECK_INTERVAL_MINUTES = 20
NO_UPDATE_ESCALATION_THRESHOLD = 3
MERGE_READY_STREAK_THRESHOLD = 3
MAX_UNCHANGED_ALERTS_PER_DAY = 3
STALE_OPEN_PR_HOURS = 24.0
OWNER_PING_THRESHOLD_HOURS = 72.0
TEST_FILES_DRIFT_ALERT_THRESHOLD = 5
AUDIT_DELTA_MARKER = "<!-- fiber-link-hourly-audit-delta -->"
DIGEST_MARKER = "<!-- fiber-link-unchanged-digest -->"


def run_gh(args: List[str]) -> str:
    proc = subprocess.run(
        ["gh", "-R", REPO, *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return proc.stdout.strip()


def parse_positive_int_env(var_name: str) -> int | None:
    raw = os.environ.get(var_name)
    if not raw:
        return None
    try:
        parsed = int(raw)
    except ValueError:
        return None
    return parsed if parsed > 0 else None


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


def count_test_files() -> int:
    ignored_dirs = {".git", "node_modules", "__pycache__", "vendor", "tmp"}
    total = 0
    for root, dirs, files in os.walk(REPO_ROOT):
        dirs[:] = [d for d in dirs if d not in ignored_dirs]
        for file_name in files:
            lowered = file_name.lower()
            if ".test." in lowered or "_test." in lowered or lowered.endswith("_spec.rb"):
                total += 1
    return total


def read_docs_superseded_count() -> int | None:
    try:
        content = DOCS_ARCH_INDEX_FILE.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    match = re.search(r"Historical/superseded docs tracked with explicit redirect:\s*(\d+)", content)
    if not match:
        return None
    return int(match.group(1))


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


def split_stale_open_prs(stale_open_prs: List[dict]) -> Tuple[List[dict], List[dict], List[dict]]:
    watchdog: List[dict] = []
    digest: List[dict] = []
    owner_ping_candidates: List[dict] = []

    for pr in stale_open_prs:
        unchanged_hours = pr.get("unchangedHours")
        review_decision = (pr.get("reviewDecision") or "").upper()
        owner = pr.get("author")
        needs_owner_ping = (
            isinstance(unchanged_hours, (int, float))
            and unchanged_hours >= OWNER_PING_THRESHOLD_HOURS
            and isinstance(owner, str)
            and bool(owner.strip())
        )
        immediate_watchdog = review_decision == "CHANGES_REQUESTED" or needs_owner_ping
        if needs_owner_ping:
            owner_ping_candidates.append(pr)
        if immediate_watchdog:
            watchdog.append(pr)
        else:
            digest.append(pr)

    return watchdog, digest, owner_ping_candidates


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
        for key, fallback_keys in [
            ("open", ("assigned",)),
            ("nbsUnbound", ()),
            ("changeRequests", ()),
            ("staleOpenPrs", ()),
            ("staleOpenPrsDigest", ()),
            ("ownerPingCandidates", ()),
        ]
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
    stale_open_prs_all = [
        pr for pr in open_prs if (pr.get("unchangedHours") is not None and pr.get("unchangedHours", 0) >= STALE_OPEN_PR_HOURS)
    ]
    stale_open_prs, stale_open_prs_digest, owner_ping_candidates = split_stale_open_prs(stale_open_prs_all)
    test_files_count = count_test_files()
    docs_superseded_count = read_docs_superseded_count()

    pr208 = next((pr for pr in open_prs if pr.get("number") == 208), None)
    pr208_unchanged_hours = pr208.get("unchangedHours") if pr208 else None

    signals: List[str] = []
    if len(actionable_open_with_reason) == 0 and len(open_prs) > 0:
        signals.append("stagnation_signal")
    if stale_open_prs:
        signals.append("stale_open_pr_watchdog")
    if owner_ping_candidates:
        signals.append("owner_ping_policy")

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
        "staleOpenPrsDigest": stale_open_prs_digest,
        "staleOpenPrsAll": stale_open_prs_all,
        "ownerPingCandidates": owner_ping_candidates,
        "signals": signals,
        "metrics": {
            "candidateIssues": len(actionable_open_with_reason),
            "openPrCount": len(open_prs),
            "staleOpenPrCount": len(stale_open_prs),
            "staleOpenPrDigestCount": len(stale_open_prs_digest),
            "staleOpenPrTotalCount": len(stale_open_prs_all),
            "ownerPingCandidateCount": len(owner_ping_candidates),
            "oldestOpenPrUnchangedHours": oldest_unchanged_hours,
            "pr208UnchangedHours": pr208_unchanged_hours,
            "testFiles": test_files_count,
            "docsSuperseded": docs_superseded_count,
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
            "staleOpenPrsDigest": len(stale_open_prs_digest),
            "staleOpenPrsAll": len(stale_open_prs_all),
            "ownerPingCandidates": len(owner_ping_candidates),
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
    snapshot.setdefault("signals", [])

    runs = state.get("runs", [])
    if runs:
        previous = runs[-1]
        previous_test_files = metric_value(previous, "testFiles")
        current_test_files = metric_value(snapshot, "testFiles")
        if isinstance(previous_test_files, (int, float)) and isinstance(current_test_files, (int, float)):
            test_files_delta = int(current_test_files - previous_test_files)
            snapshot["metrics"]["testFilesDelta"] = test_files_delta
            if abs(test_files_delta) >= TEST_FILES_DRIFT_ALERT_THRESHOLD:
                snapshot["signals"].append("test_files_drift")

        previous_docs_superseded = metric_value(previous, "docsSuperseded")
        current_docs_superseded = metric_value(snapshot, "docsSuperseded")
        if isinstance(previous_docs_superseded, (int, float)) and isinstance(current_docs_superseded, (int, float)):
            docs_superseded_delta = int(current_docs_superseded - previous_docs_superseded)
            snapshot["metrics"]["docsSupersededDelta"] = docs_superseded_delta
            if docs_superseded_delta > 0:
                # Regression-only alert.
                snapshot["signals"].append("docs_superseded_regression")

    if snapshot["signals"]:
        snapshot["signals"] = sorted(set(snapshot["signals"]))

    previous_clean_streak = int(state.get("cleanRunStreak", 0))
    clean_streak = 0 if has_actionable(snapshot) else previous_clean_streak + 1
    snapshot["cleanRunStreak"] = clean_streak
    snapshot["mergeReady"] = clean_streak >= MERGE_READY_STREAK_THRESHOLD
    return change


def summarize(snapshot: dict) -> str:
    open_count = count_metric(snapshot, "open", "assigned")
    open_pr_count = count_metric(snapshot, "openPrs")
    stale_open_pr_count = count_metric(snapshot, "staleOpenPrs")
    stale_open_pr_digest_count = count_metric(snapshot, "staleOpenPrsDigest")
    owner_ping_count = count_metric(snapshot, "ownerPingCandidates")

    lines = [
        f"Scan at {snapshot['runAt']}",
        f"Open issues requiring handling: {open_count}",
        f"Open nbs issues: {count_metric(snapshot, 'nbs')} (unbound/non-open-source PR: {count_metric(snapshot, 'nbsUnbound')})",
        f"PRs with CHANGES_REQUESTED: {count_metric(snapshot, 'changeRequests')}",
        (
            f"Open PRs (watchdog): {open_pr_count} "
            f"(stale >= {int(STALE_OPEN_PR_HOURS)}h immediate: {stale_open_pr_count}, digest: {stale_open_pr_digest_count})"
        ),
        f"Owner ping candidates (>= {int(OWNER_PING_THRESHOLD_HOURS)}h): {owner_ping_count}",
        f"changeDetectionSource: {snapshot.get('changeDetectionSource', 'unknown')}",
        f"nextActionAt: {snapshot.get('nextActionAt', 'n/a')}",
    ]

    pr208_unchanged_hours = metric_value(snapshot, "pr208UnchangedHours")
    if isinstance(pr208_unchanged_hours, (int, float)):
        lines.append(f"pr208UnchangedHours: {pr208_unchanged_hours:.2f}")

    test_files = metric_value(snapshot, "testFiles")
    if isinstance(test_files, (int, float)):
        test_files_delta = metric_value(snapshot, "testFilesDelta")
        if isinstance(test_files_delta, (int, float)):
            lines.append(f"test_files: {int(test_files)} (delta: {int(test_files_delta):+d})")
        else:
            lines.append(f"test_files: {int(test_files)}")

    docs_superseded = metric_value(snapshot, "docsSuperseded")
    if isinstance(docs_superseded, (int, float)):
        docs_superseded_delta = metric_value(snapshot, "docsSupersededDelta")
        if isinstance(docs_superseded_delta, (int, float)):
            lines.append(f"docs_superseded: {int(docs_superseded)} (delta: {int(docs_superseded_delta):+d})")
        else:
            lines.append(f"docs_superseded: {int(docs_superseded)}")

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

    if stale_open_pr_digest_count:
        lines.append("- Low-priority unchanged PR digest candidates:")
        for p in snapshot_items(snapshot, "staleOpenPrsDigest"):
            owner = p.get("author") or "unknown-owner"
            unchanged_hours = p.get("unchangedHours")
            if isinstance(unchanged_hours, (int, float)):
                lines.append(
                    f"  - #{p['number']} {p['title']} ({p['url']}) owner={owner} unchangedHours={unchanged_hours:.2f}"
                )
            else:
                lines.append(f"  - #{p['number']} {p['title']} ({p['url']}) owner={owner}")

    if owner_ping_count:
        lines.append("- Owner ping policy candidates:")
        for p in snapshot_items(snapshot, "ownerPingCandidates"):
            owner = p.get("author") or "unknown-owner"
            unchanged_hours = p.get("unchangedHours")
            if isinstance(unchanged_hours, (int, float)):
                lines.append(
                    f"  - #{p['number']} {p['title']} ({p['url']}) ping=@{owner} unchangedHours={unchanged_hours:.2f}"
                )
            else:
                lines.append(f"  - #{p['number']} {p['title']} ({p['url']}) ping=@{owner}")

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


def format_count_delta(current: int, previous: int) -> str:
    return f"{current} (delta {current - previous:+d})"


def build_audit_delta_comment(pr_number: int, snapshot: dict, previous_snapshot: dict | None) -> str:
    previous = previous_snapshot or {}
    open_current = count_metric(snapshot, "open", "assigned")
    open_previous = count_metric(previous, "open", "assigned")
    nbs_unbound_current = count_metric(snapshot, "nbsUnbound")
    nbs_unbound_previous = count_metric(previous, "nbsUnbound")
    change_requests_current = count_metric(snapshot, "changeRequests")
    change_requests_previous = count_metric(previous, "changeRequests")
    stale_watchdog_current = count_metric(snapshot, "staleOpenPrs")
    stale_watchdog_previous = count_metric(previous, "staleOpenPrs")
    stale_digest_current = count_metric(snapshot, "staleOpenPrsDigest")
    stale_digest_previous = count_metric(previous, "staleOpenPrsDigest")
    owner_ping_current = count_metric(snapshot, "ownerPingCandidates")
    owner_ping_previous = count_metric(previous, "ownerPingCandidates")
    previous_heads = pr_head_map(previous)
    current_heads = pr_head_map(snapshot)

    lines = [
        AUDIT_DELTA_MARKER,
        f"Hourly audit delta for PR #{pr_number} at {snapshot.get('runAt', 'n/a')}",
        "",
        f"Open issues requiring handling: {format_count_delta(open_current, open_previous)}",
        f"Unbound nbs issues: {format_count_delta(nbs_unbound_current, nbs_unbound_previous)}",
        f"PRs with CHANGES_REQUESTED: {format_count_delta(change_requests_current, change_requests_previous)}",
        f"Stale open PR watchdog: {format_count_delta(stale_watchdog_current, stale_watchdog_previous)}",
        f"Low-priority digest candidates: {format_count_delta(stale_digest_current, stale_digest_previous)}",
        f"Owner ping candidates: {format_count_delta(owner_ping_current, owner_ping_previous)}",
        f"headSha previous/current: {format_head_sha_pairs(previous_heads, current_heads)}",
        f"nextActionAt: {snapshot.get('nextActionAt', 'n/a')}",
    ]

    if snapshot.get("signals"):
        lines.append(f"signals: {', '.join(snapshot.get('signals', []))}")
    return "\n".join(lines)


def build_low_priority_digest_comment(snapshot: dict) -> str:
    digest_candidates = snapshot_items(snapshot, "staleOpenPrsDigest")
    lines = [
        DIGEST_MARKER,
        f"Low-priority unchanged PR digest at {snapshot.get('runAt', 'n/a')}",
        f"Candidate count: {len(digest_candidates)}",
        "",
    ]
    if digest_candidates:
        for pr in digest_candidates:
            owner = pr.get("author") or "unknown-owner"
            unchanged_hours = pr.get("unchangedHours")
            if isinstance(unchanged_hours, (int, float)):
                lines.append(
                    f"- #{pr.get('number')} {pr.get('title')} ({pr.get('url')}) owner={owner} unchangedHours={unchanged_hours:.2f}"
                )
            else:
                lines.append(f"- #{pr.get('number')} {pr.get('title')} ({pr.get('url')}) owner={owner}")
    else:
        lines.append("- No low-priority unchanged PRs in this run.")
    lines.append(f"nextActionAt: {snapshot.get('nextActionAt', 'n/a')}")
    return "\n".join(lines)


def upsert_issue_comment(issue_number: int, marker: str, body: str) -> None:
    raw = run_gh(["api", f"repos/{REPO}/issues/{issue_number}/comments?per_page=100"])
    comments = json.loads(raw or "[]")
    existing_comment_id = None
    for comment in comments:
        if marker in (comment.get("body") or ""):
            existing_comment_id = comment.get("id")
            break

    if existing_comment_id:
        run_gh(["api", "-X", "PATCH", f"repos/{REPO}/issues/comments/{existing_comment_id}", "-f", f"body={body}"])
        return

    run_gh(["api", f"repos/{REPO}/issues/{issue_number}/comments", "-f", f"body={body}"])


def maybe_publish_audit_delta_comment(snapshot: dict, previous_snapshot: dict | None, comment_pr: int | None) -> None:
    if not comment_pr:
        return
    body = build_audit_delta_comment(comment_pr, snapshot, previous_snapshot)
    upsert_issue_comment(comment_pr, AUDIT_DELTA_MARKER, body)


def maybe_publish_digest_comment(snapshot: dict, digest_issue: int | None) -> None:
    if not digest_issue:
        return
    if count_metric(snapshot, "staleOpenPrsDigest") == 0:
        return
    body = build_low_priority_digest_comment(snapshot)
    upsert_issue_comment(digest_issue, DIGEST_MARKER, body)


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
        "totalStaleOpenPrDigest": sum(count_metric(r, "staleOpenPrsDigest") for r in recent),
        "totalOwnerPingCandidates": sum(count_metric(r, "ownerPingCandidates") for r in recent),
        "totalSignals": sum(len(r.get("signals", [])) for r in recent),
        "lastTestFiles": metric_value(recent[-1], "testFiles") if recent else None,
        "lastDocsSuperseded": metric_value(recent[-1], "docsSuperseded") if recent else None,
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
        f"Total low-priority digest candidates: {summary['totalStaleOpenPrDigest']}",
        f"Total owner ping candidates: {summary['totalOwnerPingCandidates']}",
        f"Total signals emitted: {summary['totalSignals']}",
    ]
    if isinstance(summary["lastTestFiles"], (int, float)):
        lines.append(f"Latest test_files: {int(summary['lastTestFiles'])}")
    if isinstance(summary["lastDocsSuperseded"], (int, float)):
        lines.append(f"Latest docs_superseded: {int(summary['lastDocsSuperseded'])}")
    lines.extend(
        [
            "",
            "Latest run:",
            summarize(recent[-1]),
        ]
    )
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    default_comment_pr = parse_positive_int_env("TASK1_AUDIT_DELTA_PR")
    default_digest_issue = parse_positive_int_env("TASK1_DIGEST_ISSUE")
    p = argparse.ArgumentParser(description="Fiber Link hourly task 1 monitor")
    p.add_argument("--mode", choices=["scan", "report", "scan-and-report"], default="scan")
    p.add_argument("--hours", type=int, default=1, help="Report lookback window hours")
    p.add_argument(
        "--only-changes",
        action="store_true",
        help="For report mode, suppress output when totals are unchanged and no actionables exist",
    )
    p.add_argument(
        "--comment-pr",
        type=int,
        default=default_comment_pr,
        help="Upsert hourly audit delta comment into this PR number",
    )
    p.add_argument(
        "--digest-issue",
        type=int,
        default=default_digest_issue,
        help="Upsert low-priority unchanged PR digest comment into this issue number",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    state = load_state()

    if args.mode == "scan":
        snapshot = analyze()
        change = enrich_snapshot(snapshot, state)
        metadata = {
            "cleanRunStreak": snapshot.get("cleanRunStreak", 0),
            "consecutiveNoUpdateSkips": 0,
            "unchangedAlertDay": iso_utc(int(time.time()))[:10],
            "unchangedAlertCount": 0,
            "nextActionAt": snapshot.get("nextActionAt"),
        }
        previous = state.get("runs", [])[-1] if state.get("runs") else {}
        if change.get("changed"):
            maybe_publish_audit_delta_comment(snapshot, previous, args.comment_pr)
            maybe_publish_digest_comment(snapshot, args.digest_issue)
        save_state(snapshot, metadata)
        if has_actionable(snapshot):
            print(summarize(snapshot))
        return 0

    if args.mode == "scan-and-report":
        snapshot = analyze()
        change = enrich_snapshot(snapshot, state)
        previous = state.get("runs", [])[-1] if state.get("runs") else {}

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

        if change.get("changed"):
            maybe_publish_audit_delta_comment(snapshot, previous, args.comment_pr)
            maybe_publish_digest_comment(snapshot, args.digest_issue)

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
