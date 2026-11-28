/*
 * 0002_ledger_user_delete: let a person be deleted after they used Ledger.
 *
 * `journal_entries.posted_by` and `activity.actor_id` point at core."user" with ON DELETE SET NULL,
 * so deleting a person blanks their name on the rows they made. The append only trigger (KL002)
 * refused that UPDATE, so deleting any person who ever posted or did anything in Ledger failed,
 * in every app. Now the trigger lets through exactly one kind of change: a person column going
 * from a person to null, with every other column unchanged. Everything else is still refused.
 *
 * Safe to run again: CREATE OR REPLACE.
 */
CREATE OR REPLACE FUNCTION "ledger"."append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  -- The person columns that ON DELETE SET NULL may blank. Only these may change, and only to null.
  person_cols constant text[] := ARRAY['posted_by', 'actor_id'];
  col text;
  blanked boolean := false;
BEGIN
  IF current_setting('ledger.allow_purge', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "core"."organization" WHERE "id" = OLD."org_id") THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - person_cols) = (to_jsonb(OLD) - person_cols) THEN
    FOREACH col IN ARRAY person_cols LOOP
      IF to_jsonb(OLD) ? col AND (to_jsonb(NEW) -> col) IS DISTINCT FROM (to_jsonb(OLD) -> col) THEN
        IF jsonb_typeof(to_jsonb(NEW) -> col) <> 'null' THEN
          blanked := false;
          EXIT;
        END IF;
        blanked := true;
      END IF;
    END LOOP;
    IF blanked THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'append_only:ledger.% rows cannot be changed or removed. Post a reversing entry instead.', TG_TABLE_NAME USING ERRCODE = 'KL002';
END $$;
