# Issue Triage Skill (Fiber Link)

## Purpose
Guide agents to periodically check open issues and pick up work that can be started quickly.

## Triage Process
1. List open issues:
   `gh issue list --repo "$GITHUB_REPOSITORY" --state open --json number,title,assignees,labels,createdAt`
2. Categorize each issue:
   - **Assigned to me**: check if work already started.
   - **Unassigned**: decide if the issue is lightweight and safe to self-assign.

## Lightweight vs Heavy
**Lightweight (auto-handle):**
- Documentation updates
- Issue template or test/readme tweaks
- Small bug fixes with clear scope
- Configuration-only changes
- Adding/adjusting tests for existing behavior

**Heavy (report only, don’t auto-handle):**
- New feature design
- Cross-module refactors
- Security-critical or data-path changes without clear spec

## Handling Lightweight Issues
1. Self-assign: `gh issue edit <number> --repo "$GITHUB_REPOSITORY" --add-assignee "$(gh api user --jq .login)`
2. Create worktree: `git worktree add /tmp/fiber-link-issue-<number> -b codex/issue-<number>-<slug> origin/main`
3. Implement changes, commit, and push.
4. Open PR: `gh pr create --repo "$GITHUB_REPOSITORY" --base main`
5. Prefer merge queue for final merge after CI passes.
6. **Never push directly to main**
7. **Never self-merge** — wait for maintainer/reviewer merge

## Automation Trigger
This skill is intended to be used by periodic automation. Keep cadence details in the scheduler/cron source of truth.
