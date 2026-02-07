import { pgTable, pgEnum, text, timestamp, uuid, numeric, integer } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["SUPER_ADMIN", "COMMUNITY_ADMIN"]);
export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", ["credit", "debit"]);
export const withdrawalStateEnum = pgEnum("withdrawal_state", [
  "PENDING",
  "PROCESSING",
  "RETRY_PENDING",
  "COMPLETED",
  "FAILED",
]);

export const apps = pgTable("apps", {
  id: uuid("id").primaryKey().defaultRandom(),
  appId: text("app_id").notNull().unique(),
  hmacSecret: text("hmac_secret").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  role: userRoleEnum("role").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const appAdmins = pgTable("app_admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  appId: text("app_id").notNull(),
  adminUserId: text("admin_user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tipIntents = pgTable("tip_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  appId: text("app_id").notNull(),
  postId: text("post_id").notNull(),
  fromUserId: text("from_user_id").notNull(),
  toUserId: text("to_user_id").notNull(),
  asset: text("asset").notNull(),
  amount: numeric("amount").notNull(),
  invoice: text("invoice").notNull().unique(),
  invoiceState: text("invoice_state").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  settledAt: timestamp("settled_at"),
});

export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  appId: text("app_id").notNull(),
  userId: text("user_id").notNull(),
  asset: text("asset").notNull(),
  amount: numeric("amount").notNull(),
  type: ledgerEntryTypeEnum("type").notNull(),
  refId: text("ref_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const withdrawals = pgTable("withdrawals", {
  id: uuid("id").primaryKey().defaultRandom(),
  appId: text("app_id").notNull(),
  userId: text("user_id").notNull(),
  asset: text("asset").notNull(),
  amount: numeric("amount").notNull(),
  toAddress: text("to_address").notNull(),
  state: withdrawalStateEnum("state").notNull(),
  retryCount: integer("retry_count").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});
