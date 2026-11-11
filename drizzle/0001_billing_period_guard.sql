-- One Successful, non-Canceled bill per contract and day (organization-billing R2-16).
-- Postgres port of the SQLite BEFORE INSERT/UPDATE triggers: the guard raises
-- KS_BILL_PERIOD_OVERLAP (billing-engine BILL_PERIOD_GUARD), which callers match on.
CREATE OR REPLACE FUNCTION public.billing_reports_period_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.bill_status <> 'Canceled' AND NEW.calc_status = 'Successful' AND EXISTS (
    SELECT 1 FROM public.billing_reports b
    WHERE b.contract_id = NEW.contract_id AND b.id <> NEW.id
      AND b.bill_status <> 'Canceled' AND b.calc_status = 'Successful'
      AND substr(b.period_start, 1, 10) <= substr(NEW.period_end, 1, 10)
      AND substr(b.period_end, 1, 10) >= substr(NEW.period_start, 1, 10)
  ) THEN
    RAISE EXCEPTION 'KS_BILL_PERIOD_OVERLAP';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER billing_reports_period_guard_ins BEFORE INSERT ON public.billing_reports
  FOR EACH ROW EXECUTE FUNCTION public.billing_reports_period_guard();
--> statement-breakpoint
CREATE TRIGGER billing_reports_period_guard_upd BEFORE UPDATE OF bill_status, calc_status, period_start, period_end, contract_id ON public.billing_reports
  FOR EACH ROW EXECUTE FUNCTION public.billing_reports_period_guard();
