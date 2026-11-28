/*
 * 0001_crew_user_delete: let a person be deleted after they used Crew (the Ledger 0002 fix).
 *
 * `crew.activity.actor_id` points at core."user" with ON DELETE SET NULL, so deleting a person
 * blanks their name on the rows they made. The append only trigger (KC002) refused that UPDATE,
 * so deleting any person who ever did anything in Crew failed, in every app. Now the trigger lets
 * through exactly one kind of change: a person column going from a person to null, with every other
 * column unchanged. Everything else is still refused with KC002.
 *
 * `crew.activity` is the only Crew table under an append only trigger today. Later append only
 * tables (punches and punch edits in the clock phases) get the same rule in their own migration.
 *
 * Safe to run again: CREATE OR REPLACE.
 */
CREATE OR REPLACE FUNCTION "crew"."activity_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  -- The person columns that ON DELETE SET NULL may blank. Only these may change, and only to null.
  person_cols constant text[] := ARRAY['actor_id'];
  col text;
  blanked boolean := false;
BEGIN
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
  RAISE EXCEPTION 'crew.activity is append only' USING ERRCODE = 'KC002';
END $$;
