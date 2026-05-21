# Telegram Bot + Mini App Integration Design (Issue #383, Phase 1)

_This is a design document only. It does not include bot service or Mini App implementation._

Last updated: 2026-05-21

## Context

Issue `#383` defines Telegram as a **user-facing** tipping surface, not operator notification plumbing:

- Existing operator notification work is covered by `#215` (operator channels, alerts, admin workflows).
- This issue must remain focused on community tipping, dashboard, and withdrawals from Telegram.

Design goal: add Telegram as a new Fiber Link channel adapter that reuses the existing service contracts (`tip.create`, `tip.status`, `tip.get`, `tip.settled_feed`, `dashboard.summary`, `withdrawal.quote`, `withdrawal.request`) without introducing a separate Telegram ledger.

## Non-goals

MVP excludes:

- Telegram Stars / Telegram Payments for CKB / USDI settlement.
- Telegram-native custody or independent balance semantics.
- Replacing Discourse plugin behavior.
- Passive mining of every group message.
- Cross-identity merge between Telegram and Discourse users.
- Full parity with operator-dispatch notification code paths.
- `/withdraw` bot command in MVP.

## Architecture

### Surface responsibilities

- **Existing Fiber Link service**: identity provider (`appId`, `userId`, `postId`), balances, tip creation, settlement discovery, and withdrawal policy.
- **Telegram Adapter (new backend service, Phase 2)**:
  - Telegram webhook receiver.
  - Mini App auth and context validation.
  - Server-side RPC signing and call orchestration.
  - Telegram status-message delivery and idempotent update processing.
  - Operational state only (no financial ledger storage).
- **Telegram Mini App (Phase 3)**:
  - User experience for tip creation, invoice/payment display, dashboard, and withdrawal.
  - Owns only presentation and user interactions, not signing credentials.

```text
Telegram User
   |
   |  Telegram webhook + callback query
   v
Telegram Bot/Adapter  ---->  Fiber Link Service RPC  ----> Ledger / Settlement / Withdrawal
   |
   |  HTTPS Mini App token/command API
   v
Telegram Mini App UI
```

### Core assumptions

- Production entry point for Telegram must be **HTTPS webhook**, not long polling.
- Default `allowed_updates` is: `message`, `callback_query`.
- `web_app_data` is not included by default; include it only if `sendData` is explicitly adopted later.
- The same RPC/RPC-signing surface is reused; no new settlement semantics for Telegram.
- A single bot uses `appId = telegram:<bot_username>` by default.
- Configuration remains forward-compatible with future `appId` values such as `telegram:<community_slug>`.

## User flows

### /start

1. User opens chat with bot and sends `/start`.
2. Bot introduces Fiber Link and shows a dashboard Mini App button.
3. On first open, users can be shown existing balance for `tg:<id>` if credits already exist.

### /tip as reply message

1. Sender runs `/tip` as a reply to a user message.
2. Adapter validates that the update has a resolvable recipient identity.
3. Adapter creates context and returns Mini App launch context.
4. User opens Mini App and confirms:
   - asset
   - amount
   - optional note
5. Mini App calls `tip.create` via adapter after validating `initData` and context token.
6. Adapter sends invoice/payment request into Mini App.
7. Adapter tracks tip state with `tip.status` / `tip.settled_feed`.
8. User and sender receive payment status messages on paid / failed / expired states.

### Dashboard

1. User opens dashboard via bot command or button.
2. Mini App queries `dashboard.summary`.
3. UI shows available/pending/locked balances and recent activity.

### Withdrawal

- Withdrawal is **Mini App-only** in MVP.
- Mini App flow:
  1. `dashboard.summary`
  2. `withdrawal.quote`
  3. `withdrawal.request`
- No `/withdraw` command in MVP.

### Fast path (non-blocking)

Inline format `/tip <amount> <asset> [note]` may be implemented as a convenience fast path after core reply flow is stable.

## Identity mapping

- `appId`:
  - MVP default: `telegram:<bot_username>`
  - Future: keep compatibility with `telegram:<community_slug>` or similar multi-app configs.
- `userId`: `tg:<telegram_user_id>`.
- `postId`: `tg:<chat_id>:<message_id>` for message/reply-based tips.

Rules:

- IDs from Telegram are authoritative; the Mini App must not override or mint identities.
- `fromUserId` and `toUserId` are derived server-side from Telegram context.
- Chat IDs may be negative and must be treated as opaque strings.
- Recipient onboarding should not block tipping: users can already accrue `tg:<id>` balance before `/start`.

## Security

Mandatory controls:

- Validate `X-Telegram-Bot-Api-Secret-Token` on every webhook request using constant-time comparison.
- Validate Mini App `initData` server-side (HMAC/signature, required user payload, `auth_date` freshness).
- Use cryptographically random mini-app context tokens.
- Context token expiry is bounded by invoice/payment context lifetime and short-lived by design.
- Never trust client-submitted `userId`, `postId`, or `appId` fields.
- Never expose or log:
  - Telegram bot token
  - Telegram webhook secret
  - Fiber Link signing secret
  - raw `initData` payload
- No RPC signing credentials or Fiber Link secrets in Mini App bundle.
- Self-tip rejection before `tip.create`.
- Generic user-facing messages when RPC is degraded; avoid exposing internals.
- No replayed side effects for stale or repeated update data.

## Persistence / idempotency

Adapter state is operational, not ledger state.

Recommended minimum tables:

- `telegram_updates`
  - `bot_app_id`, `update_id` unique
  - `update_type`, `telegram_user_id`, `chat_id`
  - `status` (`PROCESSING` / `PROCESSED` / `FAILED`)
  - `retry_count`, `last_error_code`, `last_error_message` (redacted), timestamps
- `telegram_tip_contexts`
  - `context_token` (opaque, random)
  - `from_telegram_user_id`, `to_telegram_user_id`, `chat_id`, `message_id`
  - `app_id`, `post_id`, `tip_reference`, `status_message_id`
  - `expires_at`, `created_at`, `updated_at`

Acceptance requirements:

- Duplicate `update_id` must be acknowledged safely with no side effect.
- Retry behavior must be explicit and visible in adapter metadata.
- Callback/query operations are idempotent.
- `telegram_tip_contexts.expires_at` is never longer than the active tip/invoice/payment context.
- Stale updates beyond context/invoice lifetime are safe-acked, not replayed.

## API contract outline (Phase 2, must be explicit before UI work)

### Inbound Telegram webhook API

- `POST /api/telegram/webhook`
  - Input: raw Telegram update
  - Validates secret + dedupe + recipient mapping
  - Outputs: HTTP 200 for accepted/known updates, 4xx/5xx as needed

### Mini App API (all calls require validated initData)

- `POST /api/telegram/context`
  - Input: reply-derived context (`chat_id`, `message_id`) + session identity
  - Output: context token + Mini App route
- `POST /api/miniapp/tips`
  - Input: context token + amount + asset + note
  - Output: Fiber Link tip/invoice payload
- `GET /api/miniapp/tips/:tipId`
  - Output: status summary via `tip.get` / `tip.status` (or mapped settled-feed cursor)
- `GET /api/miniapp/dashboard`
  - Output: `dashboard.summary` mapping
- `POST /api/miniapp/withdraw/quote`
  - Output: fee + net receive plan
- `POST /api/miniapp/withdraw/request`
  - Output: withdrawal request status

### Error contract

- Return generic, non-sensitive messages for upstream Fiber Link failures.
- Include machine-readable error category codes for operator visibility.
- Never return raw secrets or implementation internals to the Mini App.

## Rate limits / abuse

- Per-user and per-chat command quotas.
- Shared-store limiter for production (Redis/db-backed); local-in-memory for development only.
- Optional pilot allowlist for first rollout communities.
- Validate limits on callback/query endpoints and Mini App API calls.
- Keep rejected attempts deterministic and non-disclosive about existence of identities/balances.
- Reject invalid context, unsupported recipient mode, and anonymous/bot/channel-only recipients.

## Observability / ops

- Health and readiness endpoints for the adapter.
- Structured logs with correlation IDs:
  - `update_id`
  - tip/invoice id
  - app/user context (redacted as policy requires)
- Retry/error metadata for `telegram_updates`.
- Dashboard metrics:
  - webhook requests by update type/status
  - webhook secret failures
  - Mini App auth failures
- Alerts:
  - webhook outages
  - high duplicate update rate
  - high RPC failure rate
  - high auth failure rate
- Operational requirements:
  - public HTTPS webhook URL in production
  - documented tunnel-based local flow (for example ngrok/cloudflared)
  - bot command registration via `setMyCommands` for `/start`, `/tip`, `/dashboard`

## Phased implementation

### Phase 1 (this doc)

- Complete design for appId/userId/postId mapping, security model, operational behavior, and contract.
- Resolve open questions and defaults.

### Phase 2 (backend adapter)

- Implement Telegram adapter service and persistence.
- Implement webhook ingestion, idempotent update handling, and stale-update safe-ack.
- Implement Mini App auth flow and context/token issuance.
- Register bot commands via `setMyCommands`.
- Add shared-store production rate limits.
- Add `telegram_updates` retry/error metadata and operator diagnostics.
- Expose generic user-facing degraded-RPC message behavior.
- Keep withdrawal command surface off in MVP.

### Phase 3 (Mini App)

- Implement reply-tip and dashboard screens.
- Implement withdrawal quote/request flow with fee breakdown visibility.
- Ensure all RPC calls go through adapter backend only.

### Phase 4+

- Add non-MVP accelerators and controls (inline mode, richer onboarding, per-community appId rollout, etc.) after API and risk acceptance.

## Acceptance criteria

- [ ] `docs/telegram-integration.md` exists and is linked from docs index / architecture truth sources.
- [ ] Architecture treats Telegram as user-facing adapter, not operator notification reuse.
- [ ] Default ID strategy is `telegram:<bot_username>` and supports future per-community `appId`.
- [ ] `tg:<id>` balances can exist before `/start`; first `/start` surfaces existing balance.
- [ ] MVP does not include `/withdraw` command.
- [ ] Context token is random and expires no later than invoice/payment context lifetime.
- [ ] Stale pending Telegram updates are safe-acked and not replayed.
- [ ] MVP `allowed_updates` is `message, callback_query`.
- [ ] Phase 2 includes `setMyCommands`, shared rate-limit store, update retry/error metadata, generic RPC-down messaging, and webhook/tunnel ops notes.
- [ ] `/tip <amount> <asset> [note]` remains optional/not required for MVP launch.

## Open questions and answered defaults

Answered defaults:

- MVP: one bot maps to one `appId` by default (`telegram:<bot_username>`).
- Future: per-community/per-chat `appId` remains config-compatible but not required for launch.
- Users can receive credited `tg:<id>` balances before first `/start`; onboarding should explain it.
- Withdrawal remains Mini App-only in MVP.
- `allowed_updates` in MVP: `message`, `callback_query`.

Open questions:

- What is Phase 2 rollout scope for per-community `appId` and migration behavior?
- What exact data redaction strategy is required for logs in regulated environments?
- Which wallet UX (copy/QR/deeplink) should be primary in invoice display?
- What onboarding nudge text best explains pre-existing balance for first-time users?
