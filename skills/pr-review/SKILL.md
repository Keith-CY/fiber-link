# PR Review Skill (Fiber Link)

## Purpose
Guide agents to review pull requests like a collaborator: check CI first, use inline comments, distinguish blocking vs non-blocking issues.

## Review Process
1. Check CI first via `gh pr checks <number> --repo "$GITHUB_REPOSITORY"`.
2. **Only do formal review after required checks are green.**
3. If CI is pending/failing:
   - Leave only a short status comment.
   - Re-check when CI completes.
4. Fetch PR diff: `gh pr diff <number> --repo "$GITHUB_REPOSITORY"`.
5. Read full diff before commenting.
6. Submit review with inline `comments` body where possible.
7. Decision rules:
   - Any **BS** (Blocking Suggestion) => **Request Changes**.
   - Only **NBS** (Non-Blocking Suggestions) => keep review non-blocking.
   - No blocking problems => **Approve**.

## What to Check
- Security: command injection, credential leakage, unsafe file ops.
- Error handling: missing error checks, silent failure paths.
- Naming/style consistency with existing codebase.
- Test coverage: new paths should have tests.
- Dependency hygiene: avoid adding build artifacts or generated files.

## Comment Style
- **BS**:
  - Clear blocking language with actionable fix.
  - If any BS exists, final decision is **Request Changes**.
- **NBS**:
  - Prefix each non-blocking suggestion with `NBS:` exactly as defined in `skills/review-followup/SKILL.md`.
  - One suggestion per line.
- If no BS exists, final decision should be **Approve**.

## Build Verification
CI is a gate for decisions:
- Check CI first: `gh pr checks <number> --repo "$GITHUB_REPOSITORY"`.
- Do not finalize without green checks.

Optional local verification if needed:
- `cd ...` to changed area and run relevant project commands.
