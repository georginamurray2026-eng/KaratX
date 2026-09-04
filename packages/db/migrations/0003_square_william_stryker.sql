CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"requests_made" integer DEFAULT 0 NOT NULL,
	"bars_inserted" integer DEFAULT 0 NOT NULL,
	"bars_applied" integer DEFAULT 0 NOT NULL,
	"bars_noop" integer DEFAULT 0 NOT NULL,
	"bars_enriched" integer DEFAULT 0 NOT NULL,
	"bars_conflict" integer DEFAULT 0 NOT NULL,
	"bars_rejected" integer DEFAULT 0 NOT NULL,
	"capture_dir" text,
	"error" text,
	"context" jsonb,
	CONSTRAINT "job_runs_status_check" CHECK ("job_runs"."status" IN ('running','succeeded','failed','interrupted')),
	CONSTRAINT "job_runs_finished_at_check" CHECK (("job_runs"."status" = 'running' AND "job_runs"."finished_at" IS NULL) OR ("job_runs"."status" <> 'running' AND "job_runs"."finished_at" IS NOT NULL)),
	CONSTRAINT "job_runs_counts_check" CHECK ("job_runs"."requests_made" >= 0 AND "job_runs"."bars_inserted" >= 0 AND "job_runs"."bars_applied" >= 0 AND "job_runs"."bars_noop" >= 0 AND "job_runs"."bars_enriched" >= 0 AND "job_runs"."bars_conflict" >= 0 AND "job_runs"."bars_rejected" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_runs_one_running_idx" ON "job_runs" USING btree ("job_name") WHERE "job_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "job_runs_job_name_started_at_idx" ON "job_runs" USING btree ("job_name","started_at" DESC NULLS LAST);