-- 0011_change_log_arrows: brand rule for change-log text (no em dashes, no double dashes).
--
-- Writers now store "<Label> is modified. <from> → <to>" with "None" for an empty side
-- (src/lib/change-log-text.ts). This rewrites rows written in the old Logiwa wire form
-- ("Status is modified. — --> Ready") the same way. Readers still accept the old form, so a
-- seed snapshot restored after this migration keeps rendering correctly. Data only; idempotent.
UPDATE "wms"."change_log" SET "message" =
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace("message", ' is modified\.\s+-->', ' is modified. None -->', 'g'),
        '(^|\s)[—–](\s*-->)', '\1None\2', 'g'),
      '(-->\s*)[—–](\s|$|[.,;)])', '\1None\2', 'g'),
    '-->\s*$', '--> None'),
  '\s*-->\s*', ' → ', 'g')
WHERE "message" LIKE '%-->%';--> statement-breakpoint
UPDATE "wms"."change_log" SET "from_value" = 'None' WHERE "from_value" IN ('—', '–');--> statement-breakpoint
UPDATE "wms"."change_log" SET "to_value" = 'None' WHERE "to_value" IN ('—', '–');
