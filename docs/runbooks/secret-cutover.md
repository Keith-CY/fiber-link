# RPC Secret Cutover Runbook

## Scope

Move app HMAC secret source of truth from environment variables to DB (`apps` table) without auth outage.

## Phase A: Dual-Read + Observability

1. Deploy code with dual-read behavior:
   `secret = dbSecret ?? envMapSecret ?? envFallbackSecret`
2. Monitor logs for fallback usage:
   entries with `RPC secret resolved by fallback source`.
3. Confirm RPC traffic is healthy and unauthorized rate is stable.

## Phase B: Backfill and Verify Coverage

1. Prepare env map:
   ensure `FIBER_LINK_HMAC_SECRET_MAP` includes all active app ids.
2. Dry run:
   `cd fiber-link-service/apps/rpc && bun src/scripts/backfill-app-secrets.ts --dry-run`
3. Validate output:
   `missing` and `updates` match expectations.
4. Apply backfill:
   `cd fiber-link-service/apps/rpc && bun src/scripts/backfill-app-secrets.ts --apply`
5. Re-run dry run to confirm `missing` and `updates` are empty.

## Phase C: Disable Env Fallback

1. Verify fallback logs are zero for at least one full traffic cycle.
2. Remove `FIBER_LINK_HMAC_SECRET_MAP` and `FIBER_LINK_HMAC_SECRET` from runtime env.
3. Deploy.
4. Confirm all secret resolution is DB-sourced and RPC auth remains healthy.

## Rollback

1. Re-enable env secret variables.
2. Redeploy previous dual-read build if needed.
3. Investigate missing/incorrect `apps.hmac_secret` records before retrying cutover.
