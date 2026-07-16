# Multi-Asset Support

_How assets are modeled across Fiber Link, and the checklist for adding a new one._

Fiber Link currently supports two assets end to end:

| Asset | Kind | Fiber invoice currency | On-chain form |
|---|---|---|---|
| `CKB` | Native | `Fibb` / `Fibt` / `Fibd` (per network, via `FIBER_INVOICE_CURRENCY_CKB`) | Plain capacity transfer |
| `USDI` | UDT (stablecoin) | `FIBER_INVOICE_CURRENCY_USDI` | `udt_type_script`-scoped cells |

## Where the asset type lives

- **Database** — the `asset` Postgres enum (`packages/db/src/schema.ts`, `assetEnum`) is the single registry. Every financial table carries it: `tip_intents`, `ledger_entries`, `withdrawals`, and `withdrawal_policies.allowed_assets` (jsonb list).
- **Ledger** — balances are computed per `(app_id, user_id, asset)`; credits and debits never mix assets.
- **RPC contracts** — `tip.create`, `tip.status`, `withdrawal.quote`, and `withdrawal.request` accept/return `asset` (`apps/rpc/src/contracts.ts`); `dashboard.summary` returns per-asset `assetBalances`.
- **Fiber adapter** — `createInvoice({ amount, asset })` maps the asset to a Fiber invoice currency and, for UDT assets, attaches the `udt_type_script` (`packages/fiber-adapter/src/rpc-adapter/invoice-ops.ts`); `executeWithdrawal` does the same for payments (`withdrawal-ops.ts`). The UDT script resolves from `FIBER_USDI_UDT_TYPE_SCRIPT_JSON` or the node's `node_info` (`FIBER_USDI_UDT_NAME` picks the entry).
- **Simulation adapter** — asset-aware invoice/withdrawal simulation for tests and demos (`simulation-adapter.ts`).
- **Policy** — `withdrawal_policies.allowed_assets` gates which assets an app may withdraw; per-asset withdrawal minimums come from the destination kind (CKB address minimum cell capacity applies to `CKB` only).
- **Surfaces** — the creator dashboard shows per-asset balance cards and an asset selector in the withdrawal form when more than one asset has balance; the admin withdrawal list has an `Asset` column.

## Adding a new asset (checklist)

1. **DB enum**: add the value to `assetEnum` in `packages/db/src/schema.ts` and generate a migration (`bun run db:generate`). `ALTER TYPE ... ADD VALUE` must follow the idempotency convention (`packages/db/README.md`) — wrap it in a `duplicate_object` guard.
2. **Contracts**: extend the `z.enum(["CKB", "USDI", ...])` asset literals in `apps/rpc/src/contracts.ts` and regenerate `docs/rpc-schema.json` (`bun run schema:generate` in `apps/rpc`; the drift test enforces this).
3. **Adapter mapping**: add the invoice currency env (`FIBER_INVOICE_CURRENCY_<ASSET>`) and, for UDT assets, the `udt_type_script` resolution (mirror the `USDI` handling in `invoice-ops.ts` / `withdrawal-ops.ts`).
4. **Simulation adapter**: extend the asset union so tests and demo flows can settle the new asset offline.
5. **Policy defaults**: decide whether existing apps' `allowed_assets` should include it (no automatic backfill).
6. **Surfaces**: the dashboard's per-asset cards and the withdrawal asset selector pick the new asset up automatically from `assetBalances`; check the admin policy form's allowed-assets editor.
7. **Tests**: extend `apps/worker/src/settlement.multi-asset.test.ts` (ledger credit + notification carry the asset) and the adapter's invoice tests (correct currency / `udt_type_script`).

## Environment reference

| Variable | Purpose |
|---|---|
| `FIBER_INVOICE_CURRENCY_CKB` | Fiber invoice currency code for CKB (`Fibb` mainnet, `Fibt` testnet, `Fibd` dev) |
| `FIBER_INVOICE_CURRENCY_USDI` | Fiber invoice currency code for USDI |
| `FIBER_USDI_UDT_TYPE_SCRIPT_JSON` | Explicit UDT type script (`{code_hash, hash_type, args}`); overrides node discovery |
| `FIBER_USDI_UDT_NAME` | Name to select the UDT entry from `node_info` when the script isn't pinned |

## Boundaries

- Withdrawals to raw CKB addresses (`CKB_ADDRESS` destinations) support only `CKB` today; UDT assets withdraw over Fiber payment requests.
- Zero-balance assets are hidden from the creator dashboard (cards and selector render only assets with entries).
