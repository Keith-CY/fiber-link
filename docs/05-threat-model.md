# Threat Model & Risk Controls (MVP)

> Scope: Hosted/custodial “hub” model + Discourse plugin integration.
> Goal: identify credible threats, define controls, and make explicit residual risks.

## 0) System summary (MVP)
**Actors**
- Tipper (pays an invoice)
- Creator/Recipient (earns tips, later withdraws)
- Discourse admin (installs plugin)
- Fiber Link operator (runs hub node + service)
- External API client (attempting forged/replayed RPC calls)
- Network attacker (MITM/replay/traffic manipulation attempts)
- Compromised worker runtime (can attempt duplicate/malformed writes)
- Stale or byzantine FNN node view (returns delayed or inconsistent state)
- Attacker (external) / malicious user (insider-ish)

**Components**
- Discourse Plugin (UI + server side integration)
- Fiber Link Service (API + internal ledger + withdrawal worker)
- Hub Fiber Node (FNN) holding channel liquidity / receiving payments
- On-chain withdrawal wallet (keys) used by service/operator to send UDT to recipients
- Database + logs + monitoring

**Core assets to protect**
- Funds: hub/channel liquidity + withdrawal wallet funds
- Ledger integrity: balances, credits, debits
- User identity mapping: Discourse user → Fiber Link user
- Privacy: user payment history
- Availability: ability to tip + withdraw

## 0.1 Current implementation posture

- `POST /rpc` uses HMAC auth with headers `x-app-id`, `x-ts`, `x-nonce`, and `x-signature`.
- Replay defense uses both bounded timestamp validation and nonce tracking (5-minute TTL).
- `x-nonce` replay storage is in-memory by default and can use Redis when `FIBER_LINK_NONCE_REDIS_URL` is set.
- Secret resolution is DB-first for app-level secrets with env fallback.

## 0.2 Sync with issue #25
- Verify this threat model stays aligned with `docs/02-architecture.md`:
  - boundary updates
  - auth contract and replay protection
  - settlement and withdrawal execution flow
  - reconciliation and evidence requirements

## 0.3 Security assumptions and limits register
- Canonical operational assumptions and explicit limits are tracked in:
  - `docs/runbooks/security-assumptions.md` (versioned matrix + owner contacts + verification mapping)

## 0.4 W1.2 explicit actor set (required coverage)

The following actor set is mandatory for payment-path threat coverage:

- External API client
- Discourse admin/operator
- Network attacker
- Compromised worker process
- Stale/inconsistent Fiber node
- Malicious end user
- Internal operator with excessive privilege


## 1) Trust boundaries
### TB1: User browser ↔ Discourse
- Threats: XSS, CSRF, session theft
- Controls: standard Discourse security posture, CSP, CSRF protections

### TB2: Discourse Plugin ↔ Fiber Link Service
- Threats: request forgery, replay, privilege escalation, rate abuse
- Controls: strong auth between Discourse and service (see §6)

### TB3: Fiber Link Service ↔ Hub Fiber Node (FNN)
- Threats: forged settlement, incorrect invoice state, DoS, misreporting
- Controls: verify payment states with multiple sources where possible; reconciliation

### TB4: Fiber Link Service ↔ Database
- Threats: SQLi, credential leak, unauthorized reads/writes, data corruption
- Controls: least privilege DB user, migrations, backups, encryption at rest (optional)

### TB5: Withdrawal signing environment ↔ Internet
- Threats: key exfiltration, unauthorized withdrawals
- Controls: isolate signing key, strict access, allowlist rules, monitoring

### TB6: Worker queue ↔ Execution state
- Threats: replayed or stalled withdrawal jobs, inconsistent completion state
- Controls: idempotent claiming, state-machine transitions in DB transactions, bounded retry rules

## 1.1 W1.2 trust-boundary coverage checklist

| Boundary | Critical payment-path coverage | Primary owner |
|---|---|---|
| Frontend/browser ↔ plugin server | Input tampering, session abuse, CSRF/XSS assumptions | Plugin owner |
| Plugin server ↔ RPC API (`/rpc`) | HMAC auth, timestamp freshness, nonce replay lockout | RPC service owner |
| RPC/Worker ↔ Postgres | State transition guards, idempotency constraints, durable evidence writes | DB + backend owner |
| RPC/Worker ↔ Redis (nonce store) | Replay-protection durability and TTL enforcement | RPC service owner |
| RPC/Worker ↔ Hub FNN RPC | Invoice/settlement truth source, timeout/error classification, stale-node handling | Worker/integration owner |
| Worker runtime ↔ withdrawal execution | Retry policy, terminal-state routing, tx evidence persistence | Worker owner |

## 2) Top 8 payment-path attack scenarios (W1.2 acceptance matrix)

| ID | Scenario | Trust boundary | Owner | Impact | Mitigation | Residual risk |
|---|---|---|---|---|---|---|
| T1 | Forged `tip.create` or `tip.status` RPC request | Plugin ↔ RPC | RPC service owner | Unauthorized invoice creation or status probing | HMAC signature, app-scoped secret resolution, strict param validation | Secret compromise still enables abuse until rotation |
| T2 | Replay of previously valid signed RPC request | Plugin ↔ RPC, RPC ↔ Redis | RPC service owner | Duplicate operations and noisy side effects | Timestamp freshness window + per-app nonce replay cache | Redis outage can degrade replay guarantees if fallback is in-memory only |
| T3 | Duplicate settlement notification creates multiple credits | Worker ↔ DB | Worker + DB owner | Ledger inflation and balance corruption | `ledger_entries.idempotency_key` uniqueness + `creditOnce` write-once semantics | Manual reconciliation still required after major incidents |
| T4 | Withdrawal completion recorded without durable tx evidence | Worker ↔ DB, Worker ↔ FNN | Worker owner | False completion, user balance drift | `markCompletedWithDebit` requires tx hash + transactional debit/write coupling | Upstream may provide malformed evidence fields requiring defensive parsing updates |
| T5 | Transient FNN errors misclassified as terminal failures | Worker ↔ FNN | Worker owner | Premature failed withdrawals and stuck funds UX | Error classification matrix + bounded retries + retry delay | Unknown vendor error strings can still be misclassified until observed and patched |
| T6 | Stale/inconsistent FNN state prevents deterministic settlement | Worker ↔ FNN | Integration owner | Settlement lag, reconciliation mismatches | Polling with backfill cursor, repeated verification, mismatch reporting runbook | Eventual consistency can still delay balance updates |
| T7 | Compromised worker attempts invalid state transitions | Worker ↔ DB | DB + backend owner | Partial writes or inconsistent workflow state | Guarded transition methods (`WHERE state=...`) + explicit conflict errors | Insider with DB superuser bypass could still mutate directly |
| T8 | Privileged admin/operator executes unauthorized withdrawals | Admin/op boundary ↔ Worker/signing context | Ops owner | Fund loss | Environment secret controls, least privilege, audit logging, manual review policy | Custodial model retains key-management concentration risk |

Coverage statement:

- Each critical invoice -> payment -> settlement abuse case above has an explicit owner, impact statement, mitigation, and residual risk.
- No unowned critical-path risk remains in this W1.2 matrix; newly observed threats must be appended to this table with owner assignment.

## 3) STRIDE threat analysis (expanded)
Below is a practical MVP-focused threat list. “Severity” is relative (H/M/L).

### S — Spoofing identity
1. **Spoof Discourse server calling Fiber Link Service** (H)
   - Attack: attacker calls `POST /tips` or admin endpoints as if they are Discourse.
   - Controls:
     - Service requires **server-to-server authentication** (API key or signed requests)
     - Validate `app_id/community_id` and enforce per-community limits
     - Rate limiting by app_id + IP allowlist (optional)

2. **Spoof recipient identity** (H)
   - Attack: set recipient_id to another user or tamper mapping.
   - Controls:
     - Recipient derived server-side from Discourse post author (not client-supplied)
     - Signed mapping table with immutable `discourse_user_id`

3. **Spoof settlement signals from hub node** (H)
   - Attack: fake “settled” events to mint balance.
   - Controls:
     - Treat hub callbacks/events as untrusted; verify via hub query API
     - Store authoritative invoice/payment hash and verify status transitions
     - Reconciliation job to compare ledger credits vs settled invoices

### T — Tampering
4. **Ledger tampering / double-credit** (H)
   - Attack: replay settlement event, race conditions, or duplicate processing.
   - Controls:
     - Idempotency key per invoice settlement → single ledger credit
     - Transactional state machine: `invoice_settled` + `ledger_credit` in one DB tx
     - Unique DB constraints (invoice_id unique in credits)

5. **Withdrawal address tampering** (H)
   - Attack: modify withdrawal destination address.
   - Controls:
     - Require user confirmation step; store address changes with cooldown
     - 2-step withdrawal: request → execute (queue)
     - Optional: email/2FA/Discourse confirmation for address changes

6. **Plugin UI tampering (amount/asset)** (M→H)
   - Attack: user alters amount or asset in client.
   - Controls:
     - Server validates allowed assets and min/max amounts
     - Server computes canonical amount and creates invoice accordingly

### R — Repudiation
7. **User disputes ("I didn’t request a withdrawal")** (M)
   - Controls:
     - Audit log of withdrawal requests (who/when/IP/user agent)
     - Immutable event log for balance changes

8. **Operator disputes ("service didn’t credit")** (M)
   - Controls:
     - Reconciliation report (settled invoices not credited + credited without settlement)

### I — Information disclosure
9. **Leak of payment history / balances** (M)
   - Controls:
     - Authorization checks for all reads
     - Encrypt sensitive data at rest if required
     - Avoid storing raw invoices beyond what is needed

10. **Secrets leakage (API keys, DB creds, signing keys)** (H)
   - Controls:
     - Secrets in env/secret manager; never in logs
     - Rotate keys; per-environment separation
     - Limit staff access; use short-lived credentials where possible

### D — Denial of service
11. **Tip endpoint spam** (M)
   - Controls:
     - Rate limit by user + community + IP
     - Require user to be logged-in on Discourse to generate invoice

12. **Hub node liquidity exhaustion** (M→H)
   - Controls:
     - Operational monitoring on channels and inbound capacity
     - Tip amount caps; degrade gracefully (“temporarily unavailable”)

13. **Database overload / queue backlog** (M)
   - Controls:
     - Background workers; bounded queues; timeouts
     - Separate read/write DB or caching if needed later

### E — Elevation of privilege
14. **Discourse admin endpoint abuse** (H)
   - Attack: attacker finds admin-only endpoints and uses them.
   - Controls:
     - Separate admin API auth (different credentials)
     - IP allowlist for admin operations
     - RBAC scopes: read-only vs ops vs withdrawals

15. **Withdrawal execution privilege escalation** (H)
   - Controls:
     - Withdrawal execution requires separate service account + isolated runtime
     - Strict policy checks (limits, allowlists) before signing/broadcasting

16. **Withdrawal execution replay** (H)
   - Attack: crash/retry behavior causes duplicate execution attempts and stale completions.
   - Controls:
     - Idempotent completion writes and status transitions (`PENDING` → `PROCESSING` → `COMPLETED`/`FAILED`)
     - Worker claims that serialize per withdrawal
     - Persist completion evidence with unique references for reconciliation


## 4) Highest-risk items (what to get right first)
1. **Key security (withdrawal + hub node keys)**
2. **Ledger correctness (exactly-once crediting + reconciliation)**
3. **Auth between Discourse and service (prevent forged tips/admin calls)**
4. **Withdrawal controls (limits, address change protections, monitoring)**


## 5) Risk control table (MVP)
| Risk | Severity | Primary control(s) | Detection | Response |
|---|---:|---|---|---|
| Hub keys compromised | H | isolate keys; least access; rotation; cold storage for excess | abnormal withdrawal alerts | halt withdrawals; rotate keys; incident response |
| Duplicate credits | H | idempotency + unique constraints + transactional state machine | reconciliation job | correct ledger; postmortem |
| Forged service calls | H | signed requests or API key + IP allowlist | request anomaly monitoring | revoke key; block IP |
| Duplicate execution attempts | H | idempotent state transitions + tx evidence idempotency | worker retry telemetry | stop worker; reconcile by tx hash + manual review |
| User address hijack | H | address-change cooldown; confirmation; limits | alerts on address change + withdrawals | freeze account; manual review |
| Liquidity exhaustion | M/H | caps; monitoring; operational playbook | channel capacity metrics | pause tips; rebalance channels |
| PII leakage | M | access control; redaction; least privilege | audit logs | rotate secrets; notify |


## 6) Recommended MVP controls (concrete)

### 6.1 Auth between Discourse and Fiber Link Service
- **HMAC signed requests** (implemented):
  - headers: `x-app-id`, `x-ts`, `x-nonce`, `x-signature` over the raw request payload and timestamp/nonce
  - replay protection:
    - reject stale/invalid timestamps (5-minute window),
    - reject duplicate nonce within TTL per `app_id`
  - secret resolution:
    - DB-stored app secret first, then env fallback map, then env fallback single secret
- **Static API key only** is a fallback risk posture only if HMAC is not used for an endpoint, and requires strict IP scope.

### 6.2 Ledger invariants
- A settled invoice can produce **at most one** credit entry.
- Internal balance = sum(credits) − sum(debits) per user/asset.
- Withdrawal must have a corresponding debit entry.

### 6.3 Reconciliation
- Periodic job:
  - list settled invoices from hub
  - compare with credited tip_intents
  - emit a report + alert on mismatch

### 6.4 Withdrawal policy
- Per-user balance cap and withdrawal cap
- Minimum withdrawal threshold
- Address change cooldown (e.g., 24h) and manual review on first withdrawal
- Queue withdrawals; execute with separate worker identity


## 7) Residual risks (explicitly accept or mitigate later)
- Custodial model implies operator trust and key management burden.
- Some disputes will require manual support until more automation exists.
- Fiber network operational risks (routing failures, channel issues) affect UX.


## 8) Next research items to finalize this doc
- Exact Fiber invoice API and settlement semantics
- Best practices for Discourse plugin secret storage and server-side hooks
- Recommended key management approach for CKB/Fiber (HSM feasibility)
