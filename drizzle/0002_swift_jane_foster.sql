CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"worker_id" text NOT NULL,
	"prompt" text NOT NULL,
	"max_price_tinybars" numeric(40, 0) NOT NULL,
	"status" text NOT NULL,
	"check_id" text,
	"approval_url" text,
	"output" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "skills" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_token_hash_uq" ON "accounts" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "tasks_account_created_idx" ON "tasks" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_check_idx" ON "tasks" USING btree ("check_id");