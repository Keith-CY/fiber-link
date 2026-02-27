import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["SUPER_ADMIN", "COMMUNITY_ADMIN"]);
export type UserRole = (typeof userRoleEnum.enumValues)[number];

export const assetEnum = pgEnum("asset", ["CKB", "USDI"]);
export type Asset = (typeof assetEnum.enumValues)[number];

export const invoiceStateEnum = pgEnum("invoice_state", ["UNPAID", "SETTLED", "FAILED"]);
export type InvoiceState = (typeof invoiceStateEnum.enumValues)[number];

export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", ["credit", "debit"]);

export const tipIntentEventSourceEnum = pgEnum("tip_intent_event_source", [
  "TIP_CREATE",
  "TIP_STATUS",
  "SETTLEMENT_DISCOVERY",
]);
export type TipIntentEventSource = (typeof tipIntentEventSourceEnum.enumValues)[number];

export const tipIntentEventTypeEnum = pgEnum("tip_intent_event_type", [
  "TIP_CREATED",
  "TIP_STATUS_UNPAID_OBSERVED",
  "TIP_STATUS_SETTLED",
  "TIP_STATUS_FAILED",
  "SETTLEMENT_NO_CHANGE",
  "SETTLEMENT_SETTLED_CREDIT_APPLIED",
  "SETTLEMENT_SETTLED_DUPLICATE",
  "SETTLEMENT_FAILED_UPSTREAM_REPORTED",
  "SETTLEMENT_RETRY_SCHEDULED",
  "SETTLEMENT_FAILED_PENDING_TIMEOUT",
  "SETTLEMENT_FAILED_CONTRACT_MISMATCH",
  "SETTLEMENT_FAILED_RETRY_EXHAUSTED",
  "SETTLEMENT_FAILED_TERMINAL_ERROR",
]);
export type TipIntentEventType = (typeof tipIntentEventTypeEnum.enumValues)[number];

export const withdrawalStateEnum = pgEnum("withdrawal_state", [
  "PENDING",
  "PROCESSING",
  "RETRY_PENDING",
  "COMPLETED",
  "FAILED",
]);
export type WithdrawalState = (typeof withdrawalStateEnum.enumValues)[number];

export const notificationChannelKindEnum = pgEnum("notification_channel_kind", ["WEBHOOK"]);
export type NotificationChannelKind = (typeof notificationChannelKindEnum.enumValues)[number];

export const notificationEventEnum = pgEnum("notification_event", [
  "WITHDRAWAL_RETRY_PENDING",
  "WITHDRAWAL_FAILED",
  "WITHDRAWAL_COMPLETED",
]);
export type NotificationEvent = (typeof notificationEventEnum.enumValues)[number];

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

export const withdrawalPolicies = pgTable(
  "withdrawal_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: text("app_id").notNull(),
    allowedAssets: jsonb("allowed_assets").$type<Asset[]>().notNull(),
    maxPerRequest: numeric("max_per_request").notNull(),
    perUserDailyMax: numeric("per_user_daily_max").notNull(),
    perAppDailyMax: numeric("per_app_daily_max").notNull(),
    cooldownSeconds: integer("cooldown_seconds").notNull().default(0),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    appIdUnique: uniqueIndex("withdrawal_policies_app_id_unique").on(table.appId),
    byAppId: index("withdrawal_policies_app_id_idx").on(table.appId),
  }),
);

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
    settlementRetryCount: integer("settlement_retry_count").notNull().default(0),
    settlementNextRetryAt: timestamp("settlement_next_retry_at"),
    settlementLastError: text("settlement_last_error"),
    settlementFailureReason: text("settlement_failure_reason"),
    settlementLastCheckedAt: timestamp("settlement_last_checked_at"),
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

export const tipIntentEvents = pgTable(
  "tip_intent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tipIntentId: uuid("tip_intent_id")
      .notNull()
      .references(() => tipIntents.id),
    invoice: text("invoice").notNull(),
    source: tipIntentEventSourceEnum("source").notNull(),
    type: tipIntentEventTypeEnum("type").notNull(),
    previousInvoiceState: invoiceStateEnum("previous_invoice_state"),
    nextInvoiceState: invoiceStateEnum("next_invoice_state"),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    byTipIntentCreatedAt: index("tip_intent_events_tip_intent_created_at_idx").on(table.tipIntentId, table.createdAt, table.id),
    byInvoiceCreatedAt: index("tip_intent_events_invoice_created_at_idx").on(table.invoice, table.createdAt, table.id),
    bySourceCreatedAt: index("tip_intent_events_source_created_at_idx").on(table.source, table.createdAt, table.id),
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

export const notificationChannels = pgTable(
  "notification_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: text("app_id").notNull(),
    name: text("name").notNull(),
    kind: notificationChannelKindEnum("kind").notNull(),
    target: text("target").notNull(),
    secret: text("secret"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    appNameUnique: uniqueIndex("notification_channels_app_name_unique").on(table.appId, table.name),
    byAppEnabled: index("notification_channels_app_enabled_idx").on(table.appId, table.enabled, table.id),
  }),
);

export const notificationRules = pgTable(
  "notification_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: text("app_id").notNull(),
    channelId: uuid("channel_id").notNull(),
    event: notificationEventEnum("event").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    channelEventUnique: uniqueIndex("notification_rules_channel_event_unique").on(table.channelId, table.event),
    byAppEventEnabled: index("notification_rules_app_event_enabled_idx").on(table.appId, table.event, table.enabled, table.id),
    byChannelEnabled: index("notification_rules_channel_enabled_idx").on(table.channelId, table.enabled, table.id),
  }),
);
