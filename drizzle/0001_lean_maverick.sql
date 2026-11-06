CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"endpoint" text NOT NULL,
	"input" text,
	"pay_to" text NOT NULL,
	"price_tinybars" numeric(40, 0) NOT NULL,
	"evidence_source" text NOT NULL,
	"status" text NOT NULL,
	"built_in" boolean NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agents_evidence_source_uq" ON "agents" USING btree ("evidence_source");--> statement-breakpoint
CREATE INDEX "agents_role_status_idx" ON "agents" USING btree ("role","status");