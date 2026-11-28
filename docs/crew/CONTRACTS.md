# KitStak Crew: contracts

What exists, who owns it and what each phase added, so nobody builds a thing twice. Read [`SPEC.md`](SPEC.md) for what to build and
`apps/crew/AGENTS.md` for the house rules. When you need something outside your folders, add it in a backwards compatible way and say so.

## 1. Folder ownership

| Folder | Owner |
|---|---|
| `apps/crew/**` | Crew |
| `packages/crew-bridge/**` | Crew (read by Pulse, Ledger, WMS, Projects, Portal) |
| `core.vendors` (`packages/db/drizzle/0012_core_vendors.sql`, `src/schema/core/vendors.ts`) | `@kitstak/db`. Crew writes only through `upsertVendorKind` in `apps/crew/src/server/domain/vendors.ts`, adds the `temp_agency` kind, and never archives a vendor that has any other kind. Ledger writes the same table. |
| Preview gate (`previewAccess` in `@kitstak/entitlements`) | `@kitstak/entitlements`. Crew calls it only from `apps/crew/src/server/entitlements.ts`; the layout, `pageFor`, API routes and actions all go through that file (a test enforces it). |
| App switcher row (`@kitstak/ui/app-switcher`) | `@kitstak/ui`. Crew is a preview app: listed only when a host passes `urls.crew`, no plan badge or add to plan link. |

## 2. Database

- Schema `crew`, migrations in `apps/crew/drizzle`, runner `scripts/db-migrate.ts`, table `drizzle.__kitstak_crew_migrations`,
  advisory lock key `7_202_611_506`. A fresh database migrates `@kitstak/db`, CRM, WMS, Projects, Pulse, then Crew.
- Every table has `org_id`, `UNIQUE (org_id, id)`, RLS policy `crew_org_isolation`, and composite foreign keys between Crew tables.
  The app role is `crew_app`; it reads its own org's rows of `core.organization`, `core.member` and `core."user"`, and reads and writes
  its own org's `core.vendors`.
- `crew` is not in the `core.entitlements.module` CHECK until launch.

| Migration | Phase | Contents |
|---|---|---|
| `0000_crew_init` | 0 | 24 tables of spec 5.1, 5.2 and 5.8; append only `activity` (KC002); agency org guard trigger; `crew_app` role and grants |
| `0001_crew_user_delete` | 1 | `crew.activity_immutable` lets `actor_id` go to null (ON DELETE SET NULL of a deleted person), nothing else |
| `0002_crew_schedule` onward | 2 to 7 | as spec section 12, one number higher than first planned |

## 3. `@kitstak/crew-bridge`

Raw SQL over the host's Drizzle executor. Reads never throw; with no `crew` schema they answer empty, null or role `none`.

| Export | Since | Use |
|---|---|---|
| `crewAvailability`, `resetAvailabilityCache` | 0 | Is the `crew` schema there |
| `resolveCrewAccess`, `resolveRole`, `crewRoleFromOrgRole`, `crewRoleAtLeast`, `canSeePay`, `canSeePrivate`, `isCrewRole`, `parseOrgRole` | 0 | A person's Crew role and sight |
| `getSetupSignals` | 0 | Onboarding step signals (spec 9); null when Crew is absent |
| `crewUrls` | 0 | Deep links into Crew |
| `countBillablePeople` | 1 | Active people that count toward the per person price |
| `getPeopleForWmsUsers` | 1 | Names, numbers and site only (`CrewPersonRef`), never pay or private fields |

## 4. Phase log

**Phase 0: scaffold.** Shell from Pulse, preview gate and locked screen (pages render nothing when locked, not only the layout),
every spec 6.1 route with its empty state, welcome claim step, search and palette, kiosk and agency links answering "not active",
`/api/health`, `/api/v1/me`. Seed: sites MLT1 and KS2 with areas for `kitstak`.

**Phase 1: people and import.** Settings (general, sites and areas, labor classes, people and roles with site scope), people list,
form and detail (Overview, Pay, Activity) with pay and private fields removed on the server by role, agencies and agency links with
public submissions (`/join/a/[token]`), the People import (check, errors per row, skip bad rows, commit, 7 day undo, PIN slips) and
export, PIN and badge reset. Seed: 48 people (30 employees, 14 temps from "Brightway Staffing", 4 seasonal), 3 leads, roles.
Differences from the spec, confirmed by the coordinator: People pages need `crew:read` (leads and viewers can open them, without pay
or private fields); email, phone and notes count as private; a look-alike import row is skipped; labor classes have no Pulse mirror
until Phase 8; sample data is not built yet.
