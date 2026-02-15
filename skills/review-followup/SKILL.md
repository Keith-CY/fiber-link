# Review Follow-up Skill (Fiber Link)

## Purpose
Standardize non-blocking review comments so they can be converted into follow-up issues automatically.

## Fixed keyword
Use exact prefix for each non-blocking suggestion:

`NBS:`

NBS = Non-Blocking Suggestion.

## Format rules
- Put one suggestion per line.
- Each suggestion line must start with `NBS:`.
- Keep suggestions actionable and specific.
- Use one `NBS:` line per issue.

## Example
```text
NBS: Add focused unit tests for error branch of fallback token parser.
NBS: Document the API timeout behavior in docs/overview.md.
```

## Blocking vs non-blocking
- Use normal review comment for blocking issues.
- Use `NBS:` for non-blocking follow-ups.

## Automation contract
When PR is merged, an automation script reads comments/reviews for `NBS:` lines and creates one issue per unique suggestion.
