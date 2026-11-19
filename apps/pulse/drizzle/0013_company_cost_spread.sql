-- How company costs are shared out over part of a month.
--
-- Company costs (rent, utilities, salaried staff) are typed in by month. A range that is only
-- part of a month, like a work week or month to date, gets a share of them. Until now that
-- share was by calendar day, so a weekend carried 2 of every 7 days of rent with no work.
-- This adds one workspace setting, shown in Settings as "Spread company costs by":
--   'calendar'  every day of the month carries the same share (what Pulse did before)
--   'work_days' only the working days in Settings carry a share
--
-- It is 'calendar' by default, so nothing changes for a workspace until someone picks work days.
-- A whole month is the same either way, so month close and closed months never change.
-- Safe to run again.
ALTER TABLE "pulse"."settings" ADD COLUMN IF NOT EXISTS "company_cost_spread" text NOT NULL DEFAULT 'calendar';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_company_cost_spread_check') THEN
    ALTER TABLE "pulse"."settings" ADD CONSTRAINT "settings_company_cost_spread_check" CHECK ("company_cost_spread" IN ('calendar', 'work_days'));
  END IF;
END $$;
