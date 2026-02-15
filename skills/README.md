# Skills Directory

This directory stores automation playbooks for project-management workflows.

## Available Skills

| Skill | Description | Path |
|-------|-------------|------|
| [PR Review](pr-review/SKILL.md) | Review PRs with explicit blocking/non-blocking rules, then submit GitHub reviews | `skills/pr-review/` |
| [Issue Triage](issue-triage/SKILL.md) | Periodically triage open issues and take low-risk items | `skills/issue-triage/` |
| [Review Follow-up](review-followup/SKILL.md) | Convert `NBS:` review suggestions into follow-up issues automatically | `skills/review-followup/` |

## Adding a New Skill

Create a subdirectory under `skills/` with a `SKILL.md` file that defines:

- trigger conditions
- required tools/commands
- output and safety rules
