# Ledger migrations (`ledger` schema)

Hand written SQL with `--> statement-breakpoint`, applied by `pnpm -F kitstak-ledger db:migrate` (`scripts/db-migrate.ts`) in journal order under advisory
lock `7_202_611_507`, bookkept in `drizzle.__kitstak_ledger_migrations`. Applied files are immutable (hash checked): add a new file. Never `drizzle-kit push`.
Ledger migrates last: `@kitstak/db`, CRM, WMS, Projects, Pulse, then Ledger. Mirrored for types in `src/server/db/schema/*.ts`.

| File | What |
|-|-|
| `0000_ledger_init.sql` | Every table of docs/ledger/SPEC.md section 5; the `ledger.cents`, `ledger.qty`, `ledger.price` domains; SD, V and SRC columns; `UNIQUE (org_id, id)` and composite FKs; triggers: balanced journal at commit (KL001), append only journal and activity (KL002), closed month on new entries (KL003), customer and vendor org guard (KL004), system accounts (KL005), tax rate in use (KL006), document lines and bank matches add up at commit (KL007), `account_month_totals` kept per line; RLS policy `ledger_org_isolation` on every table; the guard role `ledger_app` with its grants and read policies on core. Does not touch the `core.entitlements` module CHECK (that is the launch migration, Phase 12). |
| `0001_ledger_setup_lists.sql` | Phase 1: `vendor_profiles.ledger_kinds` (the kinds of a shared `core.vendors` row that Ledger added, so Ledger never drops a kind Crew or the WMS added unless the person says so); unique live tax rate name `tax_rates_name_key`; `items_name_idx`. |
