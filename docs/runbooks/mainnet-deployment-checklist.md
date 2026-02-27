# Mainnet Deployment Checklist

Last updated: 2026-02-27
Owner: Fiber Link ops (`@Keith-CY`)

This checklist is the required preflight and release gate before any mainnet rollout.

## 1. Preflight Inputs

- [ ] Release commit is pinned (`git rev-parse HEAD`) and tagged.
- [ ] `deploy/compose/.env` is populated from `.env.example` with production secrets (no default placeholder values).
- [ ] `FNN_ASSET_SHA256` is verified against the selected upstream release artifact.
- [ ] `POSTGRES_PASSWORD`, `FIBER_LINK_HMAC_SECRET`, `FIBER_SECRET_KEY_PASSWORD` are rotated for production.
- [ ] Withdrawal signer material (`FIBER_WITHDRAWAL_CKB_PRIVATE_KEY`) is sourced from approved key custody flow.

## 2. Runtime Policy Controls

- [ ] RPC rate limit values are explicitly configured:
  - `RPC_RATE_LIMIT_ENABLED`
  - `RPC_RATE_LIMIT_WINDOW_MS`
  - `RPC_RATE_LIMIT_MAX_REQUESTS`
- [ ] Withdrawal baseline policy env defaults are explicitly configured:
  - `FIBER_WITHDRAWAL_POLICY_ALLOWED_ASSETS`
  - `FIBER_WITHDRAWAL_POLICY_MAX_PER_REQUEST`
  - `FIBER_WITHDRAWAL_POLICY_PER_USER_DAILY_MAX`
  - `FIBER_WITHDRAWAL_POLICY_PER_APP_DAILY_MAX`
  - `FIBER_WITHDRAWAL_POLICY_COOLDOWN_SECONDS`
- [ ] Per-app production policy rows exist in `withdrawal_policies` for all onboarded `app_id`.

Verification query:

```bash
docker exec -i fiber-link-postgres psql \
  -U "${POSTGRES_USER:-fiber}" \
  -d "${POSTGRES_DB:-fiber_link}" \
  -c "select app_id, allowed_assets, max_per_request, per_user_daily_max, per_app_daily_max, cooldown_seconds, updated_at from withdrawal_policies order by app_id;"
```

## 3. Data Safety and Backups

- [ ] Pre-deploy backup snapshot is created and stored with immutable timestamp.
- [ ] Restore rehearsal has succeeded in the current release window.
- [ ] `deploy/compose/evidence/` retention policy is set and documented for this release.

## 4. Deploy Procedure

```bash
cd deploy/compose
docker compose pull || true
docker compose up -d --build postgres redis fnn rpc worker
```

- [ ] All services become healthy (`postgres`, `redis`, `fnn`, `rpc`, `worker`).
- [ ] No crash-loop/restart storm in first 10 minutes.

## 5. Post-Deploy Verification

- [ ] Liveness: `GET /healthz/live` returns `{"status":"alive"}`.
- [ ] Readiness: `GET /healthz/ready` returns `status=ready` and all checks `ok`.
- [ ] RPC auth and replay protections pass:
  - HMAC valid request returns result.
  - invalid signature returns unauthorized.
  - replay nonce returns unauthorized.
- [ ] Settlement replay command runs cleanly on bounded window (`errors=0`).
- [ ] Withdrawal flow evidence contains at least one completed tx with `txHash` persisted.

## 6. Rollback Gate

- [ ] Rollback command tested in staging for this release image set.
- [ ] Rollback trigger criteria are documented and acknowledged by on-call owner.
- [ ] Recovery point objective and communication channel are confirmed.

## 7. Release Sign-Off

- [ ] Ops owner sign-off
- [ ] Security owner sign-off
- [ ] Product owner sign-off
- [ ] Evidence bundle link attached in release ticket
