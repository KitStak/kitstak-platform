-- KitStak copy never shows en or em dashes. Seed data and record titles cached from CRM/WMS did
-- ("Beacon Pharma — Fleet orchestration software", "Third shift (10pm–6am)"). Same rules as
-- src/lib/undash.ts: ranges read "to", every other dash becomes a middle dot. New caches are
-- cleaned in the app before they are written; the append-only activity log is cleaned on display.
CREATE OR REPLACE FUNCTION pm.undash(value text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN CASE WHEN value IS NULL OR value !~ '[–—]' THEN value ELSE
    regexp_replace(
      regexp_replace(
        regexp_replace(value, '(\S)–(?=\S)', '\1 to ', 'g'),
        '(\d)\s+–\s+(?=\w)', '\1 to ', 'g'),
      '\s*[–—]\s*', ' · ', 'g')
  END;
--> statement-breakpoint
UPDATE pm.tasks SET title = pm.undash(title) WHERE title ~ '[–—]';
--> statement-breakpoint
UPDATE pm.tasks SET description = pm.undash(description) WHERE description ~ '[–—]';
--> statement-breakpoint
UPDATE pm.time_entries SET note = pm.undash(note) WHERE note ~ '[–—]';
--> statement-breakpoint
UPDATE pm.integration_links SET cached_title = pm.undash(cached_title) WHERE cached_title ~ '[–—]';
--> statement-breakpoint
UPDATE pm.notifications SET title = pm.undash(title), body = pm.undash(body) WHERE title ~ '[–—]' OR body ~ '[–—]';
