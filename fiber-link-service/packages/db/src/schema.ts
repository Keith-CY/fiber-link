import { index, integer, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["SUPER_ADMIN", "COMMUNITY_ADMIN"]);
export type UserRole = (typeof userRoleEnum.enumValues)[number];

export const assetEnum = pgEnum("asset", ["CKB", "USDI"]);
export type Asset = (typeof assetEnum.enumValues)[number];

export const invoiceStateEnum = pgEnum("invoice_state", ["UNPAID", "SETTLED", "FAILED"]);
export type InvoiceState = (typeof invoiceStateEnum.enumValues)[number];

export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", ["credit", "debit"]);

export const withdrawalStateEnum = pgEnum("withdrawal_state", [
  "PENDING",
  "PROCESSING",
  "RETRY_PENDING",
  "COMPLETED",
  "FAILED",
]);

export const apps = pgTable(
  "apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: text("app_id").notNull(),
    hmacSecret: text("hmac_secret").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    appIdUnique: uniqueIndex("apps_app_id_unique").on(table.appId),
  }),
);

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    role: userRoleEnum("role").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    emailUnique: uniqueIndex("admin_users_email_unique").on(table.email),
  }),
);

export const appAdmins = pgTable("app_admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  appId: text("app_id").notNull(),
  adminUserId: text("admin_user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tipIntents = pgTable(
  "tip_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: text("app_id").notNull(),
    postId: text("post_id").notNull(),
    fromUserId: text("from_user_id").notNull(),
    toUserId: text("to_user_id").notNull(),
    asset: assetEnum("asset").notNull(),
    amount: numeric("amount").notNull(),
    invoice: text("invoice").notNull(),
    invoiceState: invoiceStateEnum("invoice_state").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    settledAt: timestamp("settled_at"),
  },
  (table) => ({
    invoiceUnique: uniqueIndex("tip_intents_invoice_unique").on(table.invoice),
    byStateCreatedAt: index("tip_intents_state_created_at_idx").on(table.invoiceState, table.createdAt, table.id),
    byAppStateCreatedAt: index("tip_intents_app_state_created_at_idx").on(
      table.appId,
      table.invoiceState,
      table.createdAt,
      table.id,
    ),
  }),
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: text("app_id").notNull(),
    userId: text("user_id").notNull(),
    asset: assetEnum("asset").notNull(),
    amount: numeric("amount").notNull(),
    type: ledgerEntryTypeEnum("type").notNull(),
    refId: text("ref_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    idempotencyUnique: uniqueIndex("ledger_entries_idempotency_key_unique").on(table.idempotencyKey),
    byAccountAssetCreatedAt: index("ledger_entries_account_asset_created_at_idx").on(
      table.appId,
      table.userId,
      table.asset,
      table.createdAt,
    ),
    byReference: index("ledger_entries_ref_id_idx").on(table.refId),
  }),
);

export const withdrawals = pgTable(
  "withdrawals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: text("app_id").notNull(),
    userId: text("user_id").notNull(),
    asset: assetEnum("asset").notNull(),
    amount: numeric("amount").notNull(),
    toAddress: text("to_address").notNull(),
    state: withdrawalStateEnum("state").notNull(),
    retryCount: integer("retry_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    txHash: text("tx_hash"),
  },
  (table) => ({
    byStateRetryAt: index("withdrawals_state_next_retry_at_idx").on(table.state, table.nextRetryAt, table.createdAt),
    byAccountAssetState: index("withdrawals_account_asset_state_idx").on(table.appId, table.userId, table.asset, table.state),
  }),
);
