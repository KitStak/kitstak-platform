# KitStak | Crew: reference

Status: reference (2026-11-27). The approved build spec is [`SPEC.md`](SPEC.md); where the two differ, the spec wins. It records what Crew is for, where its
edges are, and how it would fit the apps that already exist, so a later spec starts from settled ground. Read it with
[`docs/ledger/REFERENCE.md`](../ledger/REFERENCE.md), its sibling.

---

## 1. In one line

**Crew is the people app.** People, shifts, the time clock, attendance, skills and labor planning, for kitting, 3PL and contract
packaging floors.

Working tagline (draft): *Staff it. Clock it. Plan it.*

## 2. Why it belongs in the suite

Labor is the biggest cost on a kitting floor, and the suite already prices it. It does not yet know who showed up.

- **Pulse** prices every labor hour with a loaded rate per labor class (`docs/pulse/SPEC.md` 4.3), runs a payroll check against paid hours
  (4.5), and treats temp agency classes as their own kind. Today paid hours arrive as a typed number or a time punch file from payroll.
- **WMS** has Labor Analytics (average task, associate task, performance quadrant, receiving performance), so it already tracks associates
  doing tasks. It does not schedule them.
- **Projects** has workload and time tracking, and Programs know planned units per run. Nothing turns "1,200 kits on Tuesday" into
  "we need 9 packers and a lead."

Crew makes the floor's people a first class record: they get scheduled, they clock in, the hours flow into Pulse as paid hours, and the
plan says how many people tomorrow needs.

## 3. Scope

| Area | What it covers |
|---|---|
| **People** | Everyone who works the floor, including people who never sign in: employees, temps from an agency, seasonal hires. Site, labor class, pay type, agency, start date, status, emergency contact. |
| **Shifts** | Shift templates (first, second, weekend), a weekly schedule by site and area, open shifts, swaps and pickups, publish and notify. |
| **Time clock** | A shared kiosk on the floor (badge or PIN, optional photo), phone clock in with a site fence, breaks, job and area switches during the shift, supervisor edits with a reason. |
| **Attendance** | Late, early out, no call no show, a points or occurrence policy, time off requests and balances, the daily "who is here" board. |
| **Skills** | Certifications with expiry (forklift, reach truck, hazmat), trained on (a kit, a line, a client's program), skill level. Warns before scheduling someone who is not cleared. |
| **Labor planning** | Hours needed per day from planned work and target pace, compared with hours scheduled. Shows the gap in people, and what calling in temps would cost. |

### 3.1 Not in Crew (first pass)

- **Running payroll.** Crew approves hours and exports them to the payroll provider (Gusto, ADP, Paychex, QuickBooks Payroll). Ledger books
  the payroll journal.
- **Recruiting and applicant tracking.** A hire starts in Crew once they are hired.
- **Benefits enrollment and HR case files.** Keep personnel records light: Crew is a floor tool, not an HR suite.
- **Pay rates as a second source.** Loaded rates and labor classes stay in Pulse (see 5.3), so a rate never lives in two places.

## 4. People are not the same as users

`core.user` is a login identity. Many floor workers, temps most of all, never sign in to anything. So:

- A Crew **person** is its own record, with an optional link to a `core.user` when that person also signs in (a lead who uses the WMS
  scanner, a supervisor who approves time).
- A person clocks in at the kiosk without being a user. Kiosk access is a device credential for the site, not a person's session.
- WMS associates in Labor Analytics should resolve to Crew people, so task performance and attendance sit on one record.

## 5. How Crew fits the other apps

### 5.1 Flows out

| To | What goes across | Notes |
|---|---|---|
| **Pulse** | Approved paid hours per person, day, site and labor class, with overtime split per person per week | Replaces the time punch file. Fills `paid_hours`, `paid_cents` and overtime, which Pulse says "a time punch file from payroll" is the way to get today (4.4, 4.5). The payroll check and "paid time not on any job" then work without typing. |
| **Pulse** | Job and area switches during a shift | Optional. When people clock onto a job, Pulse can draft production entries' labor hours instead of a supervisor typing people times hours each. |
| **Ledger** | Approved hours per temp agency and week | Ledger checks the agency's bill against them. "Agency billed 412 hours. Crew recorded 396." |
| **WMS** | Who is on site and cleared for what | Task assignment can skip people who are not here or not certified (no forklift putaway for someone whose card expired). |
| **Projects** | Time off and availability | Workload shows who is out. |

### 5.2 Flows in

| From | What comes across | Used for |
|---|---|---|
| **Projects** Programs and builds | Planned units per run and due dates | Labor planning: units divided by target pace gives hours needed. |
| **Pulse** | Target pace per job type and actual units per person per hour (4.12) | The pace that turns units into hours, and a check on whether the plan is realistic. |
| **WMS** | Work orders, inbound receipts and order volume due | Hours needed for receiving, pick and pack, and kit builds on the warehouse side. |
| **CRM** | Won deals with a start date | An early warning: "3 new programs start in January and need about 14 more people per day." |

### 5.3 Who owns the rate

Pulse already holds labor classes and dated loaded rate rows, and stamps cost on every entry from them. Crew assigns each person a
labor class and reads the rate from Pulse when it needs a cost (labor planning, temp cost estimates). Without Pulse, Crew keeps a plain
wage per person for its own estimates only, and that wage moves into Pulse the day Pulse is added.

### 5.4 The labor plan in one line

```
hours_needed  = planned_units / target_units_per_labor_hour + setup_hours + indirect_allowance
people_needed = ceil(hours_needed / shift_length)
gap           = people_needed - people_scheduled
```

`setup_hours` and the idea of time not on a job come straight from Pulse (4.4, 4.5), so the plan and the cost model count the same way.

## 6. Shape in the platform (if it is built)

Follows the existing pattern from `docs/integration/BLUEPRINT.md` and the Pulse spec. Nothing here is decided.

| Piece | Proposal |
|---|---|
| App | `apps/crew`, package `kitstak-crew`, own Vercel project, dev port 3800 |
| Schema | `crew`. Temp agencies are vendors, which is a `core` candidate shared with Ledger and WMS |
| Entitlement | New module key `crew` in `packages/entitlements/src/modules.ts`, counts toward the bundle discount |
| Bridge | `@kitstak/crew-bridge`: who is on site, approved hours, certifications, read by Pulse, WMS, Projects and Ledger without HTTP |
| Kiosk | A locked down route that runs on a shared tablet at the door, works through short network drops and syncs punches when back |
| Roles | Wages, attendance points and personal details are sensitive. A lead sees their crew's schedule and punches, not pay. Admins and payroll see pay |

## 7. Works on its own

A shop with only Crew gets scheduling, a time clock, attendance and skills, and exports hours to payroll. Adding Pulse later turns those
hours into job cost and a payroll check with no file in between. Adding Projects or WMS later feeds the labor plan.

## 8. Hard parts to plan for

- **Labor law.** Overtime rules differ by state (daily overtime in California), and so do meal and rest breaks, rounding, split shifts and
  rules for minors. Keep the rules as data per site, not code, and never round in the shop's favor by default.
- **Buddy punching.** Badge plus PIN, an optional photo at punch, and a site fence for phone punches. Each one has a privacy cost, so each
  is a per org setting.
- **The floor is not a desk.** Big targets, gloves, bad Wi-Fi, a tablet bolted by the door, English and Spanish from the start.
- **Temps come and go fast.** Adding 30 agency people for peak season has to take minutes, by a CSV or a link the agency fills in.
- **Edits to time are evidence.** Every change to a punch keeps the original, who changed it, when and why. Approved weeks lock, the same
  way Pulse locks a closed month.

## 9. Open questions

1. Does Crew own people records, or do they live in `core` so WMS, Pulse and Projects can name a person without Crew?
2. Which payroll providers to export to first?
3. Kiosk hardware: any tablet in a browser, or a supported device list?
4. Should clocking onto a job in Crew write Pulse labor hours directly, or only suggest them for a supervisor to approve?
5. Is a per org attendance points policy in the first pass, or only the raw late and absent record?
6. Spanish at launch for the kiosk and the phone clock, or the whole app?

## 10. Brand and website

**Icon and loader (in the repo, 2026-11-27).** The brand pack calls this icon **People**: a pink head over red shoulders. Its loader pops
the head in as the shoulders rise. In code it is named `crew`.

- Shared icon: `AppIcon app="crew"` in `packages/ui/src/app-icon/app-icon.tsx`. It is not in any app list, launcher or switcher yet.
- Files: `apps/web/public/brand/apps/kitstak-icon-crew.svg` and `apps/web/public/brand/loaders/kitstak-loader-crew.svg`.
- The icon was resized on 2026-11-27 to the same artwork box as the live icons (y 50 to 150), so it lines up in menus and lockups.
- Still to do when the app is real: copies in `apps/crew/public/brand/`, `src/app/icon.*`, a `brand-loader.tsx`, the Portal launcher
  mark, and PNG exports at 512 and 1024.

**On kitstak.com (2026-11-27).** A full product page at `/crew` ("Coming soon", screenshot placeholders in
`ShotPlaceholder`), a "Coming soon" row in the Products menu, the drawer and the footer, cards on the home, products and pricing pages,
and a "Tell me when it's ready" contact topic. The planned price is $4 per person each month, held in `PLANNED_PRODUCTS` in
`packages/billing/src/catalog.ts`, which is outside `PRODUCT_IDS`, so sign-up, the calculator, Stripe and entitlements never see it.
Site docs are in `apps/web/content/docs/crew/`, written as planned. When the app ships: move its price into `CATALOG.products`, swap
the placeholders for real screenshots, and rewrite the docs against the real screens.

## 11. Go-live on kitstak.com

The website is ready to sell Crew the moment two things are done. Everything else (product page,
menus, footer, pricing card, calculator, wizard, sign-up links, search data, llms.txt) already
follows one switch: `CREW_IS_LIVE` in `apps/web/src/components/site-links.ts`, set to `false`.

**Blocker 1: billing in the portal.**

- Move Crew from `PLANNED_PRODUCTS` into `PRODUCT_IDS` and `CATALOG.products` in
  `packages/billing/src/catalog.ts`. The price is $4 per person each month, with the same four columns.
- Add the module key `crew` to `packages/entitlements/src/modules.ts` and the
  `core.entitlements.module` CHECK constraint in `@kitstak/db` (a migration).
- Create the Stripe prices: `pnpm -F @kitstak/billing stripe:setup check` lists what Stripe needs.
- Portal sign-up and the app picker read `PRODUCT_IDS`, so they pick Crew up from the catalog. Check
  the portal typecheck for any per-product table that needs a Crew row.
- The app itself must exist at `crew.kitstak.app` (`NEXT_PUBLIC_CREW_URL`, local port 3800).

**Blocker 2: screenshots.**

- Fill every slot in `apps/web/src/components/crew/crew-shots.ts`: `file`
  (`/crew/shots/<slot>.webp` under `apps/web/public`), `width`, `height` and `alt`.
- Capture real screens of the running app with demo data, light theme, 1440 wide at 2x, cropped and
  compressed to WebP under 200 KB. Each placeholder turns into the picture on its own.

**Then flip it.** Set `CREW_IS_LIVE = true`. `apps/web/src/lib/go-live.test.ts` fails if either blocker
is not done, and its "two blockers today" test must be updated to the new state. Rewrite the site
docs in `apps/web/content/docs/crew/` against the real screens and drop the planned note.

