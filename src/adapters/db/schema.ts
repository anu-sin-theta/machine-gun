import {
  bigint,
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
