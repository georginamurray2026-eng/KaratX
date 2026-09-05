CREATE TABLE "data_quality_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" integer NOT NULL,
	"provider_id" integer NOT NULL,
	"timeframe" text NOT NULL,
	"open_time" timestamp with time zone NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"payload_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"event_type" text NOT NULL,
	"severity" text NOT NULL,
	CONSTRAINT "data_quality_events_event_type_check" CHECK ("data_quality_events"."event_type" IN (
        'missing_bar', 'unexpected_bar', 'stale_feed', 'implausible_gap',
        'revision_narrowed', 'revision_restated',
        'negative_price', 'high_below_low', 'close_outside_range'
      )),
	CONSTRAINT "data_quality_events_severity_check" CHECK ("data_quality_events"."severity" IN ('info', 'warn', 'error')),
	CONSTRAINT "data_quality_events_occurrences_check" CHECK ("data_quality_events"."occurrences" >= 1),
	CONSTRAINT "data_quality_events_seen_order_check" CHECK ("data_quality_events"."last_seen_at" >= "data_quality_events"."confirmed_at")
);
--> statement-breakpoint
ALTER TABLE "data_quality_events" ADD CONSTRAINT "data_quality_events_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_quality_events" ADD CONSTRAINT "data_quality_events_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "data_quality_events_condition_idx" ON "data_quality_events" USING btree ("instrument_id","provider_id","timeframe","open_time","event_type","payload_hash");--> statement-breakpoint
CREATE INDEX "data_quality_events_confirmed_at_idx" ON "data_quality_events" USING btree ("confirmed_at" DESC NULLS LAST);