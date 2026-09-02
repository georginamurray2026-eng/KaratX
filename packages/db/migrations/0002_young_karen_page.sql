CREATE TABLE "candles" (
	"instrument_id" integer NOT NULL,
	"provider_id" integer NOT NULL,
	"timeframe" text NOT NULL,
	"open_time" timestamp with time zone NOT NULL,
	"open" numeric(12, 5) NOT NULL,
	"high" numeric(12, 5) NOT NULL,
	"low" numeric(12, 5) NOT NULL,
	"close" numeric(12, 5) NOT NULL,
	"volume" numeric(20, 0),
	"bid" numeric(12, 5),
	"ask" numeric(12, 5),
	"raw_datetime" text NOT NULL,
	"is_final" boolean NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candles_pk" PRIMARY KEY("instrument_id","provider_id","timeframe","open_time"),
	CONSTRAINT "candles_timeframe_check" CHECK ("candles"."timeframe" IN ('1min','15min','1h','4h','1D')),
	CONSTRAINT "candles_positive_check" CHECK ("candles"."open" > 0 AND "candles"."high" > 0 AND "candles"."low" > 0 AND "candles"."close" > 0),
	CONSTRAINT "candles_high_check" CHECK ("candles"."high" >= "candles"."low" AND "candles"."high" >= "candles"."open" AND "candles"."high" >= "candles"."close"),
	CONSTRAINT "candles_low_check" CHECK ("candles"."low" <= "candles"."open" AND "candles"."low" <= "candles"."close"),
	CONSTRAINT "candles_spread_check" CHECK ("candles"."bid" IS NULL OR "candles"."ask" IS NULL OR "candles"."ask" >= "candles"."bid")
);
--> statement-breakpoint
ALTER TABLE "candles" ADD CONSTRAINT "candles_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candles" ADD CONSTRAINT "candles_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candles_one_forming_idx" ON "candles" USING btree ("instrument_id","provider_id","timeframe") WHERE NOT "candles"."is_final";