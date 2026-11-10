# M06 inventory — shared-change requests

## REQ-1 — Seed the M06 acceptance fixtures
- **File:** `src/server/db/seed/**` (foundation seed for MLT1).
- **Change:** add, in warehouse MLT1 for client ACME (or the seed's MLT1 demo client):
  - products `MLT-WIDGET-01` and `MLT-WIDGET-02` (Each, untracked);
  - locations `MLT1-A-01` (`only_one_sku = 1`, Storage, Stock) and `MLT1-B-01` (Storage);
  - stock via `ledger.add`: 20 × `MLT-WIDGET-01` @ `MLT1-A-01`, and 4 × `MLT-WIDGET-02` @ `MLT1-C-01` (a third,
    normal location) so a transfer of WIDGET-02 into `MLT1-A-01` hits the rule;
  - one open shipment order with a line for 2 × `MLT-WIDGET-01` (so Open SO Qty and the deep link have data);
  - lookup values `adjustment_reason` "Import" (used by the Import Inventory handler) and `damage_reason` "Damaged".
- **Reason:** BUILD_PLAN M06 acceptance ("Adjust MLT-WIDGET-01 @ MLT1-A-01 from 20 to 18…", "Transfer Product 5 to MLT1-B-01",
  "a transfer into an Only-1-SKU location… is blocked", "Change Damage Reason → Damaged"). The live DB has none of these
  (no `only_one_sku` location at all, no "Import" / "Damaged" reasons). The same flows are covered by
  `tests/unit/inventory/*.test.ts` on an in-memory DB; M06 cannot write products/locations (M09/M10) or the seed.
  Until it lands, the Import handler falls back to no reason id with the note "Import (row n)".
- **status:** applied (F-patch 2026-11-06): idempotent `src/server/db/seed/acceptance-fixtures.ts` + `npm run db:fixtures` (also chained in `db:reset`), run against the live DB. Client APX (the MLT1 demo client; there is no ACME). Created MLT-WIDGET-01/02, locations MLT1-A-01 (Only 1 SKU, Reserve/Storage), MLT1-B-01 (Reserve/Storage), MLT1-C-01 (Picking), stock 20 × WIDGET-01 @ A-01 and 4 × WIDGET-02 @ C-01 via `ledger.add`, open order SO010856 (2 × WIDGET-01, client ref KS-FIXTURE-M06), lookups adjustment_reason "Import" and damage_reason "Damaged".

## REQ-2 — Orders grid: line-wise SKU filter
- **File:** `src/server/repositories/orders-grid.ts` (`ORDER_SQL.sku`, M01).
- **Change:** compile `f.sku` as `EXISTS (SELECT 1 FROM order_lines l JOIN products p … WHERE l.order_id = so.id AND <op on p.sku>)`
  instead of comparing against the `' / '`-joined SKU list.
- **Reason:** `f.sku=eq:MLT-WIDGET-01` misses every multi-line order. M06 works around it: the Open SO Qty links go
  through `GET /api/inventory/open-orders`, which resolves the exact open orders and redirects to `/orders?f.code=in:…`.
  With this change the fallback (`f.sku=ct:` for more than 400 orders) becomes exact as well.
- **status:** applied (F-patch 2026-11-06): `f.sku` is compiled line-wise in `orders-grid.ts` (`EXISTS` over order_lines/products for eq/ct/sw/ew/in/…; `nin` = no line matches; `ex`/`empty` = has / has no lines). Sort and column display still use the joined SKU list.

## REQ-3 — Shared shell / grid contrast and accessible names (axe "serious")
- **Files:** `src/components/grid/data-grid.tsx` (header cells), `src/components/layout/page-header.tsx` (breadcrumb),
  the route tab strip, `src/components/layout/app-shell.tsx` (header search placeholder, context switcher,
  notifications and account buttons).
- **Change:**
  - grid header labels and page tabs/breadcrumbs use `#98a2b3` on `#fff`/`#f6f7f9` (2.4–2.57:1): darken to at least
    `#667085` (4.5:1+);
  - header search placeholder `#bfc2d0` on `#49517a` (4.32:1): lighten to `#d0d3de`;
  - `label-content-name-mismatch`: the context switcher ("All WH · All"), Notifications (badge "1") and Account
    buttons have an `aria-label` that does not contain their visible text; start each label with the visible text
    (e.g. "All WH · All — change working context").
- **Reason:** A0.5 requires axe with no serious issues on every M06 page; these are the only remaining violations on
  `/inventory`, `/inventory/by-location` and `/inventory/atp` and none is in M06's paths. The M06 e2e a11y test excludes
  `header`, `nav` and `thead` until this lands.
- **status:** applied (F-patch 2026-11-06): grid header labels, inactive page tabs (+ counts) and breadcrumbs now use `text-secondary` (#667085, hover `text-foreground`); header search trigger text white/65 -> white/80 and its kbd white/55 -> white/75; context switcher, account and HeaderIconButton (Notifications, Help, Printers) are named by content (visible text first or sr-only label + visible badge) instead of a mismatching `aria-label`. M06 e2e can stop excluding `header`, `nav`, `thead` (re-run axe to confirm).
