# Local Playwright Workflow Demo

This runbook packages the local end-to-end demo flow into repeatable scripts:

1. launch Discourse + Fiber Link services
2. open browser flow at step 4: author checks balance, then tipper pays
3. continue backend workflow for tip settlement + balance verification
4. open browser flow: author checks balance again and initiates withdrawal
5. switch to admin view and observe withdrawal state

## Scripts

- `scripts/local-workflow-automation.sh`
- `scripts/discourse-seed-fiber-link.rb`
- `scripts/playwright-workflow-step4.sh`
- `scripts/playwright-workflow-postcheck.sh`
- `scripts/playwright-demo-local-workflow.sh`

## Prerequisites

- `docker` + `docker compose` v2
- `bash`, `expect`, `jq`, `curl`, `openssl`, `python3`
- Playwright CLI wrapper: `~/.codex/skills/playwright/scripts/playwright_cli.sh`
- `npx` available on `PATH` (the wrapper depends on it)

## Required env

Default mode (`browser` initiates withdrawal) does not require a private key.

If you use backend withdrawal mode:

```bash
export FIBER_WITHDRAWAL_CKB_PRIVATE_KEY=0x<ckb_private_key_hex>
# legacy alias is also accepted:
export FIBER_WITHDRAW_CKB_PRIVATE_KEY=0x<ckb_private_key_hex>
```

If you skip discourse bootstrap, these IDs are required:

```bash
export WORKFLOW_TIPPER_USER_ID=1
export WORKFLOW_AUTHOR_USER_ID=2
export WORKFLOW_TOPIC_POST_ID=11
export WORKFLOW_REPLY_POST_ID=12
```

## One-command demo (recommended, browser initiates withdrawal)

Fresh environment:

```bash
scripts/playwright-demo-local-workflow.sh
```

Reuse existing local services/discourse seed:

```bash
scripts/playwright-demo-local-workflow.sh --skip-services --skip-discourse
```

Run browser in headless mode:

```bash
scripts/playwright-demo-local-workflow.sh --headless --skip-services --skip-discourse
```

Legacy mode (backend step6 initiates withdrawal):

```bash
scripts/playwright-demo-local-workflow.sh --backend-withdrawal --skip-services --skip-discourse
```

## Credentials and topic defaults

Defaults come from `scripts/discourse-seed-fiber-link.rb`:

- tipper: `fiber_tipper` / `fiber-local-pass-1`
- author: `fiber_author` / `fiber-local-pass-1`
- topic title: `Fiber Link Local Workflow Topic`

Override via environment variables:

- `PW_DEMO_TIPPER_USERNAME`
- `PW_DEMO_TIPPER_PASSWORD`
- `PW_DEMO_AUTHOR_USERNAME`
- `PW_DEMO_AUTHOR_PASSWORD`
- `PW_DEMO_ADMIN_USERNAME`
- `PW_DEMO_ADMIN_PASSWORD`
- `PW_DEMO_TOPIC_TITLE`
- `PW_DEMO_TOPIC_PATH`
- `PW_DEMO_TIP_AMOUNT`
- `PW_DEMO_URL`

## Artifacts

Artifacts are written to:

- Playwright demo artifacts:
  - `.tmp/playwright-workflow-demo/<UTC_TIMESTAMP>/`
- Backend workflow artifacts:
  - `.tmp/local-workflow-automation/<UTC_TIMESTAMP>/`

Typical files:

- `playwright-step4-author-balance-before.png`
- `playwright-step4-tipper-tip-modal.png`
- `workflow.pause.log`
- `workflow.complete.log`
- `postcheck/playwright-step5-author-dashboard.png`
- `postcheck/playwright-step6-author-withdrawal.png`
- `postcheck/playwright-step7-admin-withdrawal.png`

## Behavior notes

- The wrapper runs in two phases:
  - phase 1 pauses at step 4 and performs browser demo (author balance -> tipper pay)
  - phase 2 reruns backend workflow without pause for settlement + author balance checks
- By default, browser post-check initiates withdrawal as author.
- Use `--backend-withdrawal` to keep the previous backend step6 withdrawal behavior.
- When discourse bootstrap is enabled, wrapper auto-generates an isolated `FIBER_LINK_APP_ID` if not provided, so stale historical withdrawals from other demo runs do not pollute current run.
- Post-check returns structured output even when dashboard route has local rendering issues.

## Troubleshooting

- `Ember CLI is Required in Development Mode`
  - ensure workflow is started with `--with-ember-cli` (already enabled in demo wrapper)
- `npx` runtime error
  - verify `node -v` and `npx -v`
  - script prepends common Node install paths automatically, but local shell overrides can still break it
- tip/create returns `Unauthorized`
  - ensure `FIBER_LINK_HMAC_SECRET` and app ID/secret pairing are consistent with current compose env
- `/fiber-link` page shows `Action Controller: Exception caught`
  - review plugin/service logs first (`docker logs discourse_dev`, `docker logs fiber-link-rpc`)
