import {
  bigint,
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Epoch milliseconds fit in a JS number, so mode "number" is safe. */
const epochMs = (name: string) => bigint(name, { mode: "number" });

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    role: text("role").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    endpoint: text("endpoint").notNull(),
    input: text("input"),
    payTo: text("pay_to").notNull(),
    priceTinybars: numeric("price_tinybars", {
      precision: 40,
      scale: 0,
    }).notNull(),
    evidenceSource: text("evidence_source").notNull(),
    model: text("model"),
    /** string[] */
    skills: jsonb("skills").notNull().default([]),
    status: text("status").notNull(),
    builtIn: boolean("built_in").notNull(),
    createdAt: epochMs("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("agents_evidence_source_uq").on(t.evidenceSource),
    index("agents_role_status_idx").on(t.role, t.status),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull(),
    createdAt: epochMs("created_at").notNull(),
  },
  (t) => [uniqueIndex("accounts_token_hash_uq").on(t.tokenHash)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    workerId: text("worker_id").notNull(),
    prompt: text("prompt").notNull(),
    maxPriceTinybars: numeric("max_price_tinybars", {
      precision: 40,
      scale: 0,
    }).notNull(),
    status: text("status").notNull(),
    checkId: text("check_id"),
    approvalUrl: text("approval_url"),
    output: text("output"),
    /** OutputWarning[] */
    warnings: jsonb("warnings").notNull().default([]),
    /** TaskEvent[] */
    events: jsonb("events").notNull().default([]),
    createdAt: epochMs("created_at").notNull(),
    updatedAt: epochMs("updated_at").notNull(),
  },
  (t) => [
    index("tasks_account_created_idx").on(t.accountId, t.createdAt),
    index("tasks_check_idx").on(t.checkId),
  ],
);

export const checks = pgTable("checks", {
  id: text("id").primaryKey(),
  createdAt: epochMs("created_at").notNull(),
  inputKind: text("input_kind").notNull(),
  inputText: text("input_text"),
  payee: text("payee"),
  resource: text("resource"),
  /** { asset, units: "<decimal string>" } so bigint survives JSON. */
  amount: jsonb("amount"),
  verdict: jsonb("verdict"),
  verdictHash: text("verdict_hash"),
  decision: jsonb("decision"),
  transactionId: text("transaction_id"),
  status: text("status").notNull(),
});

export const pendingApprovals = pgTable(
  "pending_approvals",
  {
    attemptId: text("attempt_id").primaryKey(),
    state: text("state").notNull(),
    nonce: text("nonce").notNull(),
    action: jsonb("action").notNull(),
    actionHash: text("action_hash").notNull(),
    tier: text("tier").notNull(),
    requiredAcr: jsonb("required_acr"),
    createdAt: epochMs("created_at").notNull(),
    expiresAt: epochMs("expires_at").notNull(),
    subjectBinding: jsonb("subject_binding"),
    status: text("status").notNull(),
  },
  (t) => [
    uniqueIndex("pending_approvals_state_uq").on(t.state),
    index("pending_approvals_status_idx").on(t.status),
  ],
);

export const autoSpendLedger = pgTable(
  "auto_spend_ledger",
  {
    day: text("day").notNull(),
    assetKey: text("asset_key").notNull(),
    units: numeric("units", { precision: 40, scale: 0 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.assetKey] })],
);

export const usedNonces = pgTable("used_nonces", {
  nonce: text("nonce").primaryKey(),
  usedAt: epochMs("used_at").notNull(),
});
