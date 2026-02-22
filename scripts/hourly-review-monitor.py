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


def parse_positive_int_env_value(var_name: str, default: int) -> int:
    raw = os.environ.get(var_name)
    if not raw:
        return default
    try:
        parsed = int(raw)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def parse_positive_float_env_value(var_name: str, default: float) -> float:
    raw = os.environ.get(var_name)
    if not raw:
        return default
    try:
        parsed = float(raw)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


# Runtime knobs (env-overridable for different repo/watch cadences):
# keep defaults conservative and backward-compatible for existing CRON scheduling.
CHECK_INTERVAL_MINUTES = parse_positive_int_env_value("TASK1_CHECK_INTERVAL_MINUTES", 20)
MERGE_READY_STREAK_THRESHOLD = parse_positive_int_env_value("TASK1_MERGE_READY_STREAK_THRESHOLD", 3)
NO_UPDATE_ESCALATION_THRESHOLD = parse_positive_int_env_value("TASK1_NO_UPDATE_ESCALATION_THRESHOLD", 3)
MAX_UNCHANGED_ALERTS_PER_DAY = parse_positive_int_env_value("TASK1_MAX_UNCHANGED_ALERTS_PER_DAY", 3)
STALE_OPEN_PR_HOURS = parse_positive_float_env_value("TASK1_STALE_OPEN_PR_HOURS", 24.0)
OWNER_PING_THRESHOLD_HOURS = parse_positive_float_env_value("TASK1_OWNER_PING_THRESHOLD_HOURS", 72.0)

# Stable-terminal/no-update tuning knobs used by the adaptive poller.
TASK1_STABLE_NO_UPDATE_STREAK_THRESHOLD = parse_positive_int_env_value(
    "TASK1_STABLE_NO_UPDATE_STREAK_THRESHOLD", 3
)
TASK1_STABLE_POLL_INTERVAL_MINUTES = parse_positive_int_env_value("TASK1_STABLE_POLL_INTERVAL_MINUTES", 120)
TASK1_STABLE_NO_UPDATE_HOURS_THRESHOLD = parse_positive_float_env_value("TASK1_STABLE_NO_UPDATE_HOURS_THRESHOLD", 24.0)

# Approved-but-unmerged escalation timers.
TASK1_APPROVED_BUT_UNMERGED_REMINDER_HOURS = parse_positive_float_env_value("TASK1_APPROVED_BUT_UNMERGED_REMINDER_HOURS", 48.0)
TASK1_APPROVED_BUT_UNMERGED_ESCALATION_HOURS = parse_positive_float_env_value("TASK1_APPROVED_BUT_UNMERGED_ESCALATION_HOURS", 96.0)

# Repo noise budget thresholds.
TEST_FILES_DRIFT_ALERT_THRESHOLD = parse_positive_int_env_value("TASK1_TEST_FILES_DRIFT_ALERT_THRESHOLD", 5)

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


def pr_state_map(snapshot: dict) -> Dict[int, dict]:
    raw = snapshot.get("prState")
    if isinstance(raw, dict):
        parsed: Dict[int, dict] = {}
        for pr_number, details in raw.items():
            try:
                number = int(pr_number)
            except (TypeError, ValueError):
                continue
            if isinstance(details, dict):
                parsed[number] = details
        if parsed:
            return parsed

    latest_run = snapshot.get("latestRun")
    if isinstance(latest_run, dict):
        raw = latest_run.get("openPrs", [])
        if isinstance(raw, list):
            parsed: Dict[int, dict] = {}
            for pr in raw:
                if not isinstance(pr, dict):
                    continue
                number = pr.get("number")
                if not isinstance(number, int):
                    continue
                parsed[number] = {
                    "headSha": pr.get("headSha") or "",
                    "reviewDecision": pr.get("reviewDecision"),
                    "noUpdateStreak": pr.get("noUpdateStreak", 0),
                    "noUpdateHours": pr.get("noUpdateHours", 0),
                    "approvedAt": pr.get("approvedAt"),
                }
            if parsed:
                return parsed

    runs = snapshot.get("runs")
    if isinstance(runs, list) and runs:
        previous = runs[-1]
        if isinstance(previous, dict):
            raw = previous.get("openPrs", [])
            if isinstance(raw, list):
                parsed = {}
                for pr in raw:
                    if not isinstance(pr, dict):
                        continue
                    number = pr.get("number")
                    if not isinstance(number, int):
                        continue
                    parsed[number] = {
                        "headSha": pr.get("headSha") or "",
                        "reviewDecision": pr.get("reviewDecision"),
                        "noUpdateStreak": pr.get("noUpdateStreak", 0),
                        "noUpdateHours": pr.get("noUpdateHours", 0),
                        "approvedAt": pr.get("approvedAt"),
                    }
                if parsed:
                    return parsed
    return {}


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


def is_terminal_review_state(pr: dict) -> bool:
    return (pr.get("reviewDecision") or "").upper() == "APPROVED"


def is_stable_terminal_pr(pr: dict) -> bool:
    if not is_terminal_review_state(pr):
        return False

    unchanged_hours = pr.get("noUpdateHours")
    streak = pr.get("noUpdateStreak")
    if not isinstance(unchanged_hours, (int, float)) or streak is None:
        return False

    try:
        streak_int = int(streak)
    except (TypeError, ValueError):
        return False

    return (
        unchanged_hours >= TASK1_STABLE_NO_UPDATE_HOURS_THRESHOLD
        and streak_int >= TASK1_STABLE_NO_UPDATE_STREAK_THRESHOLD
    )


def split_stale_open_prs(stale_open_prs: List[dict]) -> Tuple[List[dict], List[dict], List[dict], List[dict]]:
    watchdog: List[dict] = []
    digest: List[dict] = []
    owner_ping_candidates: List[dict] = []
    stable_terminal_prs: List[dict] = []

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
            if is_stable_terminal_pr(pr):
                stable_terminal_prs.append(pr)

    return watchdog, digest, owner_ping_candidates, stable_terminal_prs


def build_pr_runtime_state(
    open_prs: List[dict], prior_state: Dict[int, dict], now_ts: int
) -> Tuple[List[dict], Dict[int, dict], List[dict], List[dict], List[dict], List[dict]]:
    tracked_prs = []
    previous_prs_map = prior_state
    next_state: Dict[int, dict] = {}
    new_prs: list[dict] = []
    sha_changed_prs: list[dict] = []
    approved_but_unmerged: list[dict] = []
    stable_terminal_candidates: list[dict] = []

    for pr in open_prs:
        number = pr.get("number")
        if not isinstance(number, int):
            continue

        previous = previous_prs_map.get(number, {})
        previous_head = previous.get("headSha", "")
        previous_decision = (previous.get("reviewDecision") or "").upper()

        head_sha = pr.get("headSha") or ""
        review_decision = (pr.get("reviewDecision") or "").upper()
        head_changed = previous_head != head_sha
        decision_changed = previous_decision != review_decision
        stale = bool(previous)
        changed = head_changed or decision_changed

        no_update_streak = 1
        if stale and not changed:
            no_update_streak = int(previous.get("noUpdateStreak", 0)) + 1

        if changed:
            sha_changed_prs.append(pr)
            no_update_hours = 0.0
            approved_at = now_ts if review_decision == "APPROVED" else None
        else:
            unchanged_hours = pr.get("unchangedHours")
            no_update_hours = (
                round(float(unchanged_hours), 2)
                if isinstance(unchanged_hours, (int, float))
                else round(float(previous.get("noUpdateHours", 0)), 2)
            )
            if review_decision == "APPROVED":
                approved_at = previous.get("approvedAt")
                if not isinstance(approved_at, (int, float)):
                    approved_at = now_ts
            else:
                approved_at = None

        approved_hours = 0.0
        if approved_at is not None:
            approved_hours = round(max(0, (now_ts - int(approved_at)) / 3600), 2)

        pr["noUpdateStreak"] = no_update_streak
        pr["noUpdateHours"] = no_update_hours
        pr["approvedButUnmergedHours"] = approved_hours

        if review_decision == "APPROVED":
            approved_but_unmerged.append(pr)
            if is_stable_terminal_pr(pr):
                stable_terminal_candidates.append(pr)

        tracked_prs.append(pr)
        next_state[number] = {
            "headSha": head_sha,
            "reviewDecision": review_decision,
            "noUpdateStreak": no_update_streak,
            "noUpdateHours": no_update_hours,
            "approvedAt": approved_at,
        }

        if not stale:
            new_prs.append(pr)

    return tracked_prs, next_state, new_prs, sha_changed_prs, approved_but_unmerged, stable_terminal_candidates


def compute_next_action_interval(snapshot: dict) -> tuple[int, str]:
    signals = set(snapshot.get("signals", []))
    if count_metric(snapshot, "shaChangedPrCount") > 0:
        return CHECK_INTERVAL_MINUTES, "resume"

    if (
        count_metric(snapshot, "open", "assigned") > 0
        or count_metric(snapshot, "nbsUnbound") > 0
        or count_metric(snapshot, "changeRequests") > 0
        or count_metric(snapshot, "ownerPingCandidates") > 0
        or count_metric(snapshot, "newOpenPrs") > 0
        or "approved_but_unmerged_escalation" in signals
        or "approved_but_unmerged_reminder" in signals
    ):
        return CHECK_INTERVAL_MINUTES, "normal"

    if count_metric(snapshot, "stableTerminalPrs") <= 0:
        return CHECK_INTERVAL_MINUTES, "normal"

    return TASK1_STABLE_POLL_INTERVAL_MINUTES, "downshift-stable-terminal-prs"


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
            ("stableTerminalPrs", ()),
            ("newOpenPrs", ()),
            ("approvedButUnmerged", ()),
            ("shaChangedPrCount", ()),
        ]
    ):
        sources.add("ci")

    source_list = sorted(sources)
    return {
        "changed": bool(source_list),
        "sources": source_list,
        "details": details,
    }


def analyze(state: dict | None = None) -> dict:
    state_cache: Dict[int, str] = {}
    now_ts = int(time.time())
    if state is None:
        state = load_state()

    prior_pr_state = pr_state_map(state)

    open_issues = list_json("issue")
    actionable_open_with_reason, _, _ = classify_with_source_pr(open_issues, state_cache)
    open_actionable_issues = [item["issue"] for item in actionable_open_with_reason]
    nbs_issues = [issue for issue in open_issues if has_label(issue, "nbs")]
    unbound_nbs = [item for item in actionable_open_with_reason if has_label(item["issue"], "nbs")]

    raw_open_prs = list_json("pr")
    open_prs = [normalize_pr(pr, now_ts) for pr in raw_open_prs]
    open_prs, pr_state, new_open_prs, sha_changed_prs, approved_but_unmerged, _stable_terminal_candidates = build_pr_runtime_state(
        open_prs, prior_pr_state, now_ts
    )
    if not prior_pr_state:
        new_open_prs = []
    change_requests = [pr for pr in open_prs if pr.get("reviewDecision") == "CHANGES_REQUESTED"]
    stale_open_prs_all = [
        pr for pr in open_prs if (pr.get("unchangedHours") is not None and pr.get("unchangedHours", 0) >= STALE_OPEN_PR_HOURS)
    ]
    stale_open_prs, stale_open_prs_digest, owner_ping_candidates, stable_terminal_prs = split_stale_open_prs(stale_open_prs_all)
    test_files_count = count_test_files()
    docs_superseded_count = read_docs_superseded_count()

    pr208 = next((pr for pr in open_prs if pr.get("number") == 208), None)
    pr208_unchanged_hours = pr208.get("unchangedHours") if pr208 else None

    approved_but_unmerged_hours = [
        pr.get("approvedButUnmergedHours", 0.0) for pr in approved_but_unmerged if isinstance(pr.get("approvedButUnmergedHours"), (int, float))
    ]
    approved_but_unmerged_reminder = [
        pr
        for pr in approved_but_unmerged
        if isinstance(pr.get("approvedButUnmergedHours"), (int, float))
        and pr["approvedButUnmergedHours"] >= TASK1_APPROVED_BUT_UNMERGED_REMINDER_HOURS
    ]
    approved_but_unmerged_escalation = [
        pr
        for pr in approved_but_unmerged
        if isinstance(pr.get("approvedButUnmergedHours"), (int, float))
        and pr["approvedButUnmergedHours"] >= TASK1_APPROVED_BUT_UNMERGED_ESCALATION_HOURS
    ]
    approved_but_unmerged_max_hours = max(approved_but_unmerged_hours, default=0.0)
    max_no_update_streak = max((pr.get("noUpdateStreak", 0) for pr in open_prs), default=0)
    max_no_update_hours = max((pr.get("noUpdateHours", 0.0) for pr in open_prs), default=0.0)

    signals: List[str] = []
    if len(actionable_open_with_reason) == 0 and len(open_prs) > 0:
        signals.append("stagnation_signal")
    if stale_open_prs:
        signals.append("stale_open_pr_watchdog")
    if owner_ping_candidates:
        signals.append("owner_ping_policy")
    if new_open_prs:
        signals.append("new_pr_detected")
    if stable_terminal_prs:
        signals.append("stable_terminal_pr_digest")
    if approved_but_unmerged_escalation:
        signals.append("approved_but_unmerged_escalation")
    elif approved_but_unmerged_reminder:
        signals.append("approved_but_unmerged_reminder")

    oldest_unchanged_hours = max((pr.get("unchangedHours", 0) for pr in stale_open_prs), default=0)
    snapshot: dict = {
        "open": open_actionable_issues,
        "openUnbound": actionable_open_with_reason,
        # Backward compatibility for historical state consumers.
        "assigned": open_actionable_issues,
        "assignedUnbound": actionable_open_with_reason,
        "nbs": nbs_issues,
        "nbsUnbound": unbound_nbs,
        "changeRequests": change_requests,
        "newOpenPrs": new_open_prs,
        "openPrs": open_prs,
        "shaChangedPrs": sha_changed_prs,
        "staleOpenPrs": stale_open_prs,
        "staleOpenPrsDigest": stale_open_prs_digest,
        "staleOpenPrsAll": stale_open_prs_all,
        "ownerPingCandidates": owner_ping_candidates,
        "approvedButUnmerged": approved_but_unmerged,
        "stableTerminalPrs": stable_terminal_prs,
        "signals": signals,
        "prState": pr_state,
        "metrics": {
            "candidateIssues": len(actionable_open_with_reason),
            "openPrCount": len(open_prs),
            "staleOpenPrCount": len(stale_open_prs),
            "staleOpenPrDigestCount": len(stale_open_prs_digest),
            "staleOpenPrTotalCount": len(stale_open_prs_all),
            "ownerPingCandidateCount": len(owner_ping_candidates),
            "oldestOpenPrUnchangedHours": oldest_unchanged_hours,
            "maxNoUpdateStreak": max_no_update_streak,
            "maxNoUpdateHours": max_no_update_hours,
            "approvedButUnmergedCount": len(approved_but_unmerged),
            "approvedButUnmergedMaxHours": approved_but_unmerged_max_hours,
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
            "newOpenPrs": len(new_open_prs),
            "stableTerminalPrs": len(stable_terminal_prs),
            "shaChangedPrCount": len(sha_changed_prs),
            "approvedButUnmerged": len(approved_but_unmerged),
        },
        "changeDetectionSource": "ci",
        "changeDetectionSources": ["ci"],
        "ts": now_ts,
        "runAt": iso_utc(now_ts),
        "nextActionAt": iso_utc(now_ts + CHECK_INTERVAL_MINUTES * 60),
    }

    next_interval, polling_mode = compute_next_action_interval(snapshot)
    snapshot["nextActionAt"] = iso_utc(now_ts + next_interval * 60)
    snapshot["pollingMode"] = polling_mode
    snapshot["pollingIntervalMinutes"] = next_interval
    return snapshot


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
    poll_interval = int(snapshot.get("pollingIntervalMinutes") or CHECK_INTERVAL_MINUTES)
    snapshot["nextActionAt"] = iso_utc(int(time.time()) + poll_interval * 60)
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
    stable_terminal_pr_count = count_metric(snapshot, "stableTerminalPrs")
    new_pr_count = count_metric(snapshot, "newOpenPrs")
    approved_but_unmerged_count = count_metric(snapshot, "approvedButUnmerged")

    lines = [
        f"Scan at {snapshot['runAt']}",
        f"Open issues requiring handling: {open_count}",
        f"Open nbs issues: {count_metric(snapshot, 'nbs')} (unbound/non-open-source PR: {count_metric(snapshot, 'nbsUnbound')})",
        f"PRs with CHANGES_REQUESTED: {count_metric(snapshot, 'changeRequests')}",
        (
            f"Open PRs (watchdog): {open_pr_count} "
            f"(stale >= {int(STALE_OPEN_PR_HOURS)}h immediate: {stale_open_pr_count}, digest: {stale_open_pr_digest_count})"
        ),
        f"Stable terminal PR candidates: {stable_terminal_pr_count}",
        f"New PRs detected: {new_pr_count}",
        f"Approved-but-unmerged PRs: {approved_but_unmerged_count}",
        f"Polling mode: {snapshot.get('pollingMode', 'normal')} (interval: {snapshot.get('pollingIntervalMinutes', CHECK_INTERVAL_MINUTES)}m)",
        f"Owner ping candidates (>= {int(OWNER_PING_THRESHOLD_HOURS)}h): {owner_ping_count}",
        f"changeDetectionSource: {snapshot.get('changeDetectionSource', 'unknown')}",
        f"nextActionAt: {snapshot.get('nextActionAt', 'n/a')}",
    ]

    max_no_update_streak = metric_value(snapshot, "maxNoUpdateStreak")
    if isinstance(max_no_update_streak, int):
        lines.append(f"maxNoUpdateStreak: {max_no_update_streak}")
    max_no_update_hours = metric_value(snapshot, "maxNoUpdateHours")
    if isinstance(max_no_update_hours, (int, float)):
        lines.append(f"maxNoUpdateHours: {max_no_update_hours:.2f}")

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

    if new_pr_count:
        lines.append("- New open PRs:")
        for p in snapshot_items(snapshot, "newOpenPrs"):
            lines.append(format_pr_candidate_line(p, prefix="  - "))

    if stale_open_pr_count:
        lines.append("- Stale open PR watchdog candidates:")
        for p in snapshot_items(snapshot, "staleOpenPrs"):
            lines.append(format_pr_candidate_line(p))

    if stale_open_pr_digest_count:
        lines.append("- Low-priority unchanged PR digest candidates:")
        for p in snapshot_items(snapshot, "staleOpenPrsDigest"):
            lines.append(format_pr_candidate_line(p))

    if stable_terminal_pr_count:
        lines.append("- Stable terminal PR digest candidates:")
        for p in snapshot_items(snapshot, "stableTerminalPrs"):
            lines.append(format_pr_candidate_line(p))

    if owner_ping_count:
        lines.append("- Owner ping policy candidates:")
        for p in snapshot_items(snapshot, "ownerPingCandidates"):
            lines.append(format_pr_candidate_line(p, ping_owner=True))

    if not any(
        [
            open_count,
            count_metric(snapshot, "nbsUnbound"),
            count_metric(snapshot, "changeRequests"),
            count_metric(snapshot, "newOpenPrs"),
            stable_terminal_pr_count,
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


def format_pr_candidate_line(pr: dict, prefix: str = "  - ", ping_owner: bool = False) -> str:
    owner = pr.get("author") or "unknown-owner"
    owner_part = f"ping=@{owner}" if ping_owner else f"owner={owner}"
    line = f"{prefix}#{pr.get('number')} {pr.get('title')} ({pr.get('url')}) {owner_part}"
    unchanged_hours = pr.get("unchangedHours")
    if isinstance(unchanged_hours, (int, float)):
        line += f" unchangedHours={unchanged_hours:.2f}"
    return line


def build_scan_metadata(snapshot: dict) -> dict:
    return {
        "cleanRunStreak": snapshot.get("cleanRunStreak", 0),
        "consecutiveNoUpdateSkips": 0,
        "unchangedAlertDay": iso_utc(int(time.time()))[:10],
        "unchangedAlertCount": 0,
        "nextActionAt": snapshot.get("nextActionAt"),
    }


def get_previous_snapshot(state: dict) -> dict:
    runs = state.get("runs", [])
    return runs[-1] if runs else {}


def maybe_publish_scan_comments(snapshot: dict, previous_snapshot: dict, change: dict, comment_pr: int | None, digest_issue: int | None) -> None:
    if not change.get("changed"):
        return
    maybe_publish_audit_delta_comment(snapshot, previous_snapshot, comment_pr)
    maybe_publish_digest_comment(snapshot, digest_issue)


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
    stable_terminal_current = count_metric(snapshot, "stableTerminalPrs")
    stable_terminal_previous = count_metric(previous, "stableTerminalPrs")
    approved_unmerged_current = count_metric(snapshot, "approvedButUnmerged")
    approved_unmerged_previous = count_metric(previous, "approvedButUnmerged")
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
        f"Stable terminal PR digest candidates: {format_count_delta(stable_terminal_current, stable_terminal_previous)}",
        f"Owner ping candidates: {format_count_delta(owner_ping_current, owner_ping_previous)}",
        f"Approved-but-unmerged PRs: {format_count_delta(approved_unmerged_current, approved_unmerged_previous)}",
        f"headSha previous/current: {format_head_sha_pairs(previous_heads, current_heads)}",
        f"nextActionAt: {snapshot.get('nextActionAt', 'n/a')}",
    ]

    if snapshot.get("signals"):
        lines.append(f"signals: {', '.join(snapshot.get('signals', []))}")
    return "\n".join(lines)


def build_low_priority_digest_comment(snapshot: dict) -> str:
    digest_candidates = snapshot_items(snapshot, "stableTerminalPrs", "staleOpenPrsDigest")
    lines = [
        DIGEST_MARKER,
        f"Stable terminal PR digest at {snapshot.get('runAt', 'n/a')}",
        f"Candidate count: {len(digest_candidates)}",
        "",
    ]
    if digest_candidates:
        for pr in digest_candidates:
            lines.append(format_pr_candidate_line(pr, prefix="- "))
    else:
        lines.append("- No stable terminal PRs in this run.")
    lines.append(f"nextActionAt: {snapshot.get('nextActionAt', 'n/a')}")
    return "\n".join(lines)


def list_issue_comments(issue_number: int) -> List[dict]:
    raw = run_gh(["api", "--paginate", "--slurp", f"repos/{REPO}/issues/{issue_number}/comments?per_page=100"])
    pages = json.loads(raw or "[]")
    comments: List[dict] = []
    if isinstance(pages, list):
        for page in pages:
            if isinstance(page, list):
                comments.extend(page)
            elif isinstance(page, dict):
                comments.append(page)
    return comments


def upsert_issue_comment(issue_number: int, marker: str, body: str) -> None:
    comments = list_issue_comments(issue_number)
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
    if count_metric(snapshot, "stableTerminalPrs") == 0:
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
        "totalStableTerminalPrs": sum(count_metric(r, "stableTerminalPrs") for r in recent),
        "totalStaleOpenPrDigest": sum(count_metric(r, "staleOpenPrsDigest") for r in recent),
        "totalOwnerPingCandidates": sum(count_metric(r, "ownerPingCandidates") for r in recent),
        "totalNewOpenPrs": sum(count_metric(r, "newOpenPrs") for r in recent),
        "totalApprovedButUnmerged": sum(count_metric(r, "approvedButUnmerged") for r in recent),
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
        f"Total stable terminal PR digest candidates: {summary['totalStableTerminalPrs']}",
        f"Total new PR detections: {summary['totalNewOpenPrs']}",
        f"Total approved-but-unmerged PRs: {summary['totalApprovedButUnmerged']}",
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
        previous = get_previous_snapshot(state)
        maybe_publish_scan_comments(snapshot, previous, change, args.comment_pr, args.digest_issue)
        save_state(snapshot, build_scan_metadata(snapshot))
        if has_actionable(snapshot):
            print(summarize(snapshot))
        return 0

    if args.mode == "scan-and-report":
        snapshot = analyze()
        change = enrich_snapshot(snapshot, state)
        previous = get_previous_snapshot(state)

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

        maybe_publish_scan_comments(snapshot, previous, change, args.comment_pr, args.digest_issue)
        save_state(snapshot, build_scan_metadata(snapshot))
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
