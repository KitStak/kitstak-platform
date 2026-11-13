-- Brand rule: no em dashes in UI copy. Rewrites the demo data that CRM and WMS seeded before the
-- seeds switched to " · " (apps/crm/src/server/db/seed, apps/wms/src/server/db/seed-data.ts).
-- Idempotent. WMS change log messages keep their Logiwa parity format and are not touched.
-- Run: psql "$DATABASE_URL" -f deploy/data-fixes/2026-11-13-no-em-dashes.sql
begin;

-- Prose in CRM updates and their rich text bodies.
create temporary table undash_prose (old_text text, new_text text) on commit drop;
insert into undash_prose values
  ('Drafting it now — will share by Friday.', 'Drafting it now and will share it by Friday.'),
  ('changing roles next month — we need to', 'changing roles next month, so we need to'),
  ('Nice work — let me know', 'Nice work! Let me know'),
  ('last year — happy to make an intro.', 'last year and am happy to make an intro.');

do $$
declare p record;
begin
  for p in select * from undash_prose loop
    update crm.updates set body_text = replace(body_text, p.old_text, p.new_text) where body_text like '%' || p.old_text || '%';
    update crm.updates set body = replace(body::text, p.old_text, p.new_text)::jsonb where body::text like '%' || p.old_text || '%';
  end loop;
end $$;

-- Record names: " — " separators become " · ".
update crm.items set name = replace(name, ' — ', ' · ') where name like '% — %';
update crm.activity_log set after = replace(after::text, ' — ', ' · ')::jsonb where after::text like '% — %';
update crm.notifications set payload = replace(payload::text, ' — ', ' · ')::jsonb where payload::text like '% — %';
update crm.automations set actions = replace(actions::text, ' — ', ' · ')::jsonb where actions::text like '% — %';
update crm.updates set body_text = replace(body_text, ' — ', ' · '), body = replace(body::text, ' — ', ' · ')::jsonb
  where body_text like '% — %';

update core.items set name = replace(name, ' — ', ' · ') where name like '% — %';
update wms.products set name = replace(name, ' — ', ' · ') where name like '% — %';
update wms.products set description = replace(description, ' — ', ' · ') where description like '% — %';
update wms.product_listings set name = replace(name, ' — ', ' · ') where name like '% — %';

-- Cached record titles on Projects links (Projects also cleans these at display time; pm.activity is
-- append-only and keeps its history, Projects renders it through displayText).
do $$
begin
  if to_regclass('pm.integration_links') is not null then
    execute $q$update pm.integration_links set cached_title = replace(cached_title, ' — ', ' · ') where cached_title like '% — %'$q$;
  end if;
exception when undefined_column then null;
end $$;

commit;
