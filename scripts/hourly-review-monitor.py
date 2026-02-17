#!/usr/bin/env python3
"""Hourly check for assigned issues / nbs follow-ups and open PRs needing changes."""

from __future__ import annotations

import json
import re
import subprocess
from typing import Dict, List, Tuple

REPO = "Keith-CY/fiber-link"


def run_gh(args: List[str]) -> str:
    proc = subprocess.run(["gh", "-R", REPO, *args], check=True, capture_output=True, text=True)
    return proc.stdout.strip()


def list_json(resource: str, **kwargs) -> List[dict]:
    fields = "\n".join([f"--{k}" for k in []])
    args = [resource, "list", "--state", "open", "--json"]
    if resource == "pr":
        args.append("number,title,reviewDecision,headRefName,mergeStateStatus,url")
    elif resource == "issue":
        args.append("number,title,body,labels,assignees,url")
    else:
        raise ValueError(resource)

    if "limit" in kwargs:
        args += ["--limit", str(kwargs["limit"])]
    if "assignee" in kwargs:
        args += ["--assignee", kwargs["assignee"]]
    if "label" in kwargs and kwargs["label"]:
        args += ["--label", kwargs["label"]]

    raw = run_gh(args)
    return json.loads(raw or "[]")


def get_assigned_issues() -> List[dict]:
    return list_json("issue", assignee="@me")


def get_open_nbs_issues() -> List[dict]:
    return list_json("issue", label="nbs")


def get_open_change_request_prs() -> List[dict]:
    return [item for item in list_json("pr") if item.get("reviewDecision") == "CHANGES_REQUESTED"]


def nbs_issue_source_pr(state: str) -> int | None:
    m = re.search(r"Source PR:\s*https://github.com/[^/]+/[^/]+/pull/(\\d+)", state or "")
    if not m:
        return None
    return int(m.group(1))


def pr_state(pr_num: int, cache: Dict[int, str]) -> str:
    if pr_num in cache:
        return cache[pr_num]
    # gh allows numeric PR identifier directly in --repo queries
    out = run_gh(["pr", "view", str(pr_num), "--json", "state", "--jq", ".state"]).strip()
    cache[pr_num] = out
    return out


def analyze_nbs_issues(nbs_issues: List[dict]) -> Tuple[List[dict], List[dict], List[dict]]:
    unbound: List[dict] = []
    assigned_to_me: List[dict] = []
    still_bound_to_open_pr: List[dict] = []

    pr_state_cache: Dict[int, str] = {}

    for issue in nbs_issues:
        if any(a.get("login") == "Keith-CY" for a in issue.get("assignees", [])):
            assigned_to_me.append(issue)

        pr_num = nbs_issue_source_pr(issue.get("body", "") or "")
        if not pr_num:
            unbound.append({"issue": issue, "reason": "missing-source-pr"})
            continue

        state = pr_state(pr_num, pr_state_cache)
        if state != "OPEN":
            unbound.append({"issue": issue, "reason": f"source-pr-{state.lower()}"})
            continue

        still_bound_to_open_pr.append(issue)

    return unbound, assigned_to_me, still_bound_to_open_pr


def main() -> int:
    assigned_issues = get_assigned_issues()
    nbs_issues = get_open_nbs_issues()
    change_request_prs = get_open_change_request_prs()

    unbound, assigned_nbs_to_me, _ = analyze_nbs_issues(nbs_issues)

    print(f"Open issues assigned to @me: {len(assigned_issues)}")
    for issue in assigned_issues:
        print(f"- #{issue['number']} {issue['title']} ({issue['url']})")

    print(f"Open nbs issues: {len(nbs_issues)}")
    print(f"- Unbound nbs issues (not linked to OPEN source PR): {len(unbound)}")
    for item in unbound:
        issue = item["issue"]
        print(f"  - #{issue['number']} {issue['title']} [{item['reason']}] ({issue['url']})")

    if assigned_nbs_to_me:
        print("- nbs issues assigned to @Keith-CY:")
        for issue in assigned_nbs_to_me:
            print(f"  - #{issue['number']} {issue['title']} ({issue['url']})")

    print(f"Open PRs with CHANGES_REQUESTED: {len(change_request_prs)}")
    for pr in change_request_prs:
        print(f"- #{pr['number']} {pr['title']} ({pr['url']})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
