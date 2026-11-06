CREATE TABLE "auto_spend_ledger" (
	"day" text NOT NULL,
	"asset_key" text NOT NULL,
	"units" numeric(40, 0) NOT NULL,
	CONSTRAINT "auto_spend_ledger_day_asset_key_pk" PRIMARY KEY("day","asset_key")
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" bigint NOT NULL,
	"input_kind" text NOT NULL,
	"input_text" text,
	"payee" text,
	"resource" text,
	"amount" jsonb,
	"verdict" jsonb,
	"verdict_hash" text,
	"decision" jsonb,
	"transaction_id" text,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_approvals" (
	"attempt_id" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"nonce" text NOT NULL,
	"action" jsonb NOT NULL,
	"action_hash" text NOT NULL,
	"tier" text NOT NULL,
	"required_acr" jsonb,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"subject_binding" jsonb,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "used_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"used_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pending_approvals_state_uq" ON "pending_approvals" USING btree ("state");--> statement-breakpoint
CREATE INDEX "pending_approvals_status_idx" ON "pending_approvals" USING btree ("status");