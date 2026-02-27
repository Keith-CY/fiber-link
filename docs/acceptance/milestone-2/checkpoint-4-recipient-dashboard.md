# M2 Checkpoint 4: Recipient Dashboard (Balance + Tip History)

## Goal

Provide recipient-facing dashboard visibility for balance and tip history.

## Collected evidence

- Scope requirement:
  - `docs/01-scope-mvp.md` (creator dashboard includes balance + tip history)
- Progress references:
  - `docs/06-development-progress.md` (plugin tip UI documented; dashboard completion not stated as final)
- Open optional dashboard follow-ups in tracker:
  - GitHub issues `#39`, `#45`

## Current status

`DONE`

Dashboard implementation and verification are complete.

Latest verification evidence (2026-02-27):

- `PLUGIN_SMOKE_SKIP_FETCH=1 PLUGIN_SMOKE_EXTRA_SPECS='plugins/fiber-link/spec/system/fiber_link_dashboard_spec.rb plugins/fiber-link/spec/system/fiber_link_tip_spec.rb' scripts/plugin-smoke.sh`
  - Result: `14 examples, 0 failures` (includes dashboard + tip system specs).
- Published evidence index:
  - `docs/runbooks/acceptance-evidence/milestone-2/index.md`

## Exit criteria

- Dashboard page shows recipient balance and tip history in testnet demo.
- Acceptance evidence includes at least one reproducible dashboard verification run.
