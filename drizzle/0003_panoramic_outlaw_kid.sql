ALTER TABLE "tasks" ALTER COLUMN "worker_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "skill" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "requested_agent_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "candidates" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "excluded" jsonb DEFAULT '[]'::jsonb NOT NULL;