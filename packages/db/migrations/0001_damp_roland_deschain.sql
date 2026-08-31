CREATE TABLE "instruments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "instruments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"symbol" text NOT NULL,
	"display_name" text NOT NULL,
	"tick_size" numeric(12, 5) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_holidays" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "market_holidays_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"instrument_id" integer NOT NULL,
	"holiday_date" date NOT NULL,
	"closure_type" text NOT NULL,
	"local_close" time,
	"source" text NOT NULL,
	"description" text,
	CONSTRAINT "market_holidays_closure_type_check" CHECK ("market_holidays"."closure_type" IN ('full', 'early_close')),
	CONSTRAINT "market_holidays_close_check" CHECK (("market_holidays"."closure_type" = 'early_close') = ("market_holidays"."local_close" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "market_hours" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "market_hours_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"instrument_id" integer NOT NULL,
	"rule_type" text NOT NULL,
	"day_of_week" integer NOT NULL,
	"local_start" time NOT NULL,
	"local_end" time,
	"timezone" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	CONSTRAINT "market_hours_rule_type_check" CHECK ("market_hours"."rule_type" IN ('weekly_open', 'weekly_close', 'daily_break')),
	CONSTRAINT "market_hours_day_of_week_check" CHECK ("market_hours"."day_of_week" BETWEEN 1 AND 7),
	CONSTRAINT "market_hours_span_check" CHECK (("market_hours"."rule_type" = 'daily_break') = ("market_hours"."local_end" IS NOT NULL)),
	CONSTRAINT "market_hours_effective_range_check" CHECK ("market_hours"."effective_to" IS NULL OR "market_hours"."effective_to" > "market_hours"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "provider_instruments" (
	"provider_id" integer NOT NULL,
	"instrument_id" integer NOT NULL,
	"provider_symbol" text NOT NULL,
	CONSTRAINT "provider_instruments_provider_id_instrument_id_pk" PRIMARY KEY("provider_id","instrument_id")
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "providers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"display_name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_holidays" ADD CONSTRAINT "market_holidays_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_hours" ADD CONSTRAINT "market_hours_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_instruments" ADD CONSTRAINT "provider_instruments_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_instruments" ADD CONSTRAINT "provider_instruments_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instruments_symbol_key" ON "instruments" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "market_holidays_lookup_idx" ON "market_holidays" USING btree ("instrument_id","holiday_date");--> statement-breakpoint
CREATE INDEX "market_hours_lookup_idx" ON "market_hours" USING btree ("instrument_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_instruments_symbol_key" ON "provider_instruments" USING btree ("provider_id","provider_symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_key_key" ON "providers" USING btree ("key");--> statement-breakpoint
-- ===========================================================================
-- SEED. This is not optional data.
--
-- market_hours is the trading-calendar authority. T1.5 asks it how many bars
-- should exist on a date and compares that to what arrived. AN EMPTY TABLE
-- ANSWERS "NOTHING EXPECTED" TO EVERY QUESTION: weekend detection finds
-- nothing and reports success, every assertion passes, and there is no error
-- and no symptom. Seeding here makes the table non-empty by construction -
-- you cannot apply this migration and end up with an empty calendar.
--
-- PROVENANCE OF THE RULES. Measured against Massive on 2026-08-27: Friday's
-- last bar opens 20:45 UTC (closing 21:00 = 17:00 EDT), Sunday opens 21:00 UTC
-- = 17:00 EDT, and weekdays carry 93 of 96 possible 15-minute bars - the
-- missing 45 minutes being the daily rollover. The break is 45 MINUTES, not
-- the 60 of the CME futures convention.
--
-- effective_from = 2020-01-24 is the earliest 15min data Twelve Data holds,
-- NOT the date the rules were verified. The rules were measured in 2026 and
-- corroborated against Massive only back to ~2024. Applying them to 2020-2024
-- is an ASSUMPTION, made so the calendar can speak to the backfill Phase 9
-- needs; T1.5 should test it against Massive where depth allows. The
-- alternative - effective_from 2026-08-27 - would be strictly honest and would
-- make every backfilled bar UNKNOWN, leaving T1.5 nothing to validate.
-- ===========================================================================

INSERT INTO "instruments" ("symbol", "display_name", "tick_size")
VALUES ('XAU/USD', 'Gold Spot / US Dollar', '0.01000');
--> statement-breakpoint

INSERT INTO "providers" ("key", "display_name") VALUES
  ('twelve_data', 'Twelve Data'),
  ('massive', 'Massive');
--> statement-breakpoint

INSERT INTO "provider_instruments" ("provider_id", "instrument_id", "provider_symbol")
SELECT p."id", i."id", v."provider_symbol"
FROM (VALUES
  ('twelve_data', 'XAU/USD', 'XAU/USD'),
  ('massive', 'XAU/USD', 'C:XAUUSD')
) AS v("provider_key", "symbol", "provider_symbol")
JOIN "providers" p ON p."key" = v."provider_key"
JOIN "instruments" i ON i."symbol" = v."symbol";
--> statement-breakpoint

INSERT INTO "market_hours"
  ("instrument_id", "rule_type", "day_of_week", "local_start", "local_end", "timezone", "effective_from")
SELECT i."id", v."rule_type", v."day_of_week", v."local_start"::time, v."local_end"::time,
       'America/New_York', DATE '2020-01-24'
FROM (VALUES
  ('weekly_open',  7, '17:00', NULL),
  ('daily_break',  1, '17:00', '17:45'),
  ('daily_break',  2, '17:00', '17:45'),
  ('daily_break',  3, '17:00', '17:45'),
  ('daily_break',  4, '17:00', '17:45'),
  ('weekly_close', 5, '17:00', NULL)
) AS v("rule_type", "day_of_week", "local_start", "local_end")
CROSS JOIN "instruments" i
WHERE i."symbol" = 'XAU/USD';
