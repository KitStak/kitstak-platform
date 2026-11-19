-- The off switch for the warehouse contract rate rule.
--
-- Until now a job linked to a warehouse work order always took its price from the client's
-- approved warehouse contract. Some workspaces set prices in Pulse and do not want that.
-- This adds one workspace setting, shown on Connected apps as
-- "Let warehouse contract rates set job prices".
--
-- It is ON by default, so nothing changes for a workspace until someone turns it off.
-- Safe to run again.
ALTER TABLE "pulse"."settings" ADD COLUMN IF NOT EXISTS "wms_contract_prices" boolean NOT NULL DEFAULT true;
