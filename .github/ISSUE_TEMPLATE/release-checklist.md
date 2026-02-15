---
name: Release Checklist
about: Verify release readiness across command paths and environments
title: "release: <version> checklist"
labels: release
assignees: ""
---

## Release Checklist

- [ ] Deployment path verification
  - [ ] Verify end-to-end smoke path for target environment.
  - [ ] Confirm rollback and rollback-criteria documentation.

- [ ] Regression scope
  - [ ] Confirm changed modules are covered by checks.
  - [ ] Confirm smoke path passed after dependency updates.

- [ ] Known environment matrix
  - [ ] Validate on Linux CI runner.
  - [ ] Validate Node/Bun/runtime versions used in CI.
  - [ ] Validate plugin/runtime integration path.

- [ ] Follow-up tracking
  - [ ] Confirm non-blocking review suggestions (`NBS:`) are extracted and tracked.
