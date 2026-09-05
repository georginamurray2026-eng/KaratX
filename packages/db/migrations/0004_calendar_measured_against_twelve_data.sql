-- T1.5 — the trading calendar, corrected against the feed we actually ingest.
--
-- THE SEED WAS NOT A MISTAKE. T1.2 measured these boundaries correctly, against
-- MASSIVE, on 2026-08-27. What changed is the use: ADR-008 made Twelve Data the
-- ingestion feed, and this calendar's job in T1.5 is to answer "how many bars
-- should have arrived?" about THAT feed. Massive's boundaries answer a question
-- we do not ask. Nobody made an error; the calendar outlived the reason its
-- values were chosen.
--
-- ADR-008 ALREADY RECORDED THE DIFFERENCE: "Massive reopens the week at 17:00
-- NY; Twelve Data's 2024 data reopened at 18:00 NY - they agree on the daily
-- boundary, differ by an hour on the weekly restart." Six years of stored bars
-- show the same hour applies to the daily break's END.
--
-- MEASURED FROM 166,344 STORED 15-MINUTE BARS, 2020-01-24 to 2026-09-05:
--
--   daily break   1,026 clean gaps of exactly 1h15m following a bar opening
--                 16:45 New York. That bar covers 16:45-17:00, and the next
--                 opens 18:00 - so the break runs 17:00 to 18:00, SIXTY
--                 minutes, not the seeded forty-five.
--
--   weekly open   Sunday 18:00 New York, 46-52 occurrences a year across
--                 2020-2024, dominant in every one of those years.
--
--   weekly close  Friday 17:00 New York. UNCHANGED - the seed was already
--                 right, and it is restated here only so one migration holds
--                 the whole calendar rather than half of it.
--
-- THESE ARE ONE PROVIDER'S REPRESENTATION AND ARE LABELLED AS SUCH. There is
-- deliberately NO venue column: OANDA and Twelve Data have never been compared
-- (obligation 43), and adding a column to express a difference nobody has
-- measured is designing for a guess. When 43 is measured, that is the evidence
-- that would justify one.
--
-- THE BREAK IS DOMINANT, NOT UNIVERSAL, and the rule should not be read as
-- absolute. Against roughly 208 break opportunities a year, clean breaks number
-- 167-200 in 2020-2024 - so the provider omitted the break on something like a
-- fifth of weekdays even in the era it honoured it. 816 stored bars sit inside
-- the 17:00-18:00 window before 2026-04-05. T1.5's detector will see them, and
-- they are real observations rather than detector faults.
--
-- NO ERA ROWS FOR THE 2025 CHANGE, AND THAT IS THE POINT OF THE TABLE.
-- Twelve Data began emitting Saturday bars on 2025-04-26 and ran continuously
-- through weekends from 2026-01-04. It would be easy to add effective_to dates
-- and new rules describing that - and it would DEFEAT THE CALENDAR. The schema
-- comment says so directly: the calendar is per-instrument rather than
-- per-provider "precisely so a provider's representation can be checked AGAINST
-- it. A provider-scoped calendar could never detect a provider changing its
-- representation - which is exactly what Twelve Data did in 2025 when weekend
-- bars appeared." Encoding the change into the calendar makes the change
-- undetectable. The market's session did not move; the provider's rendering of
-- it did, and 9,645 bars in the weekly-closure window are a FINDING, not a
-- calendar gap.
--
-- ADR-003: migrations are immutable, so 0001's rows are superseded by an
-- UPDATE here rather than edited there. Applying this twice is a no-op.

-- Daily break: 17:00-17:45 (Massive) becomes 17:00-18:00 (Twelve Data).
UPDATE "market_hours"
   SET "local_end" = '18:00:00'
 WHERE "rule_type" = 'daily_break'
   AND "local_start" = '17:00:00'
   AND "local_end" = '17:45:00'
   AND "timezone" = 'America/New_York';

--> statement-breakpoint

-- Weekly open: Sunday 17:00 (Massive) becomes Sunday 18:00 (Twelve Data).
UPDATE "market_hours"
   SET "local_start" = '18:00:00'
 WHERE "rule_type" = 'weekly_open'
   AND "day_of_week" = 7
   AND "local_start" = '17:00:00'
   AND "timezone" = 'America/New_York';
