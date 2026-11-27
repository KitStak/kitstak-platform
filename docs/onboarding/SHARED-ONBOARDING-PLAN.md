# Shared onboarding engine (CRM, WMS, Pulse)

## Note

Projects has the onboarding we want everywhere: a welcome dialog (logo, "Welcome to {App}, {name}!",
one line on what the app does, three highlight cards, and three choices: "I'll look around myself",
"Try a sample ...", "Show me around"), then a 4-step spotlight tour, plus a "Get started" checklist
on Home that checks itself off from real data. It shows once per person and can be replayed from Help.

Goal: give CRM, WMS and Pulse the same experience by pulling it into one shared engine in
`@kitstak/ui`, with each app only supplying its content.

## Two kinds of onboarding (do not merge them)

KitStak already has **org setup**: the cross-app guided onboarding in
[`docs/integration/ONBOARDING.md`](../integration/ONBOARDING.md). That document is the binding
contract. It covers getting the organization ready (create a workspace, add the first deal,
create a warehouse, invite the team, pick a plan...). Its durable state lives at org level in
`core.onboarding_progress`; everything else is detected live from real rows.

This plan adds **personal onboarding**: each person's first time in an app (welcome dialog,
tour, and a short "learn the app" checklist like the one on Projects Home: add a dated task,
try search, open My work). It is per person and stored in that person's prefs.

| | Org setup (exists) | Personal onboarding (this plan) |
| --- | --- | --- |
| Who | Owners and admins set up the org once | Every person, the first time in each app |
| State | `core.onboarding_progress`, org-level rows | Per-user prefs (`prefs.onboarding`) |
| Steps | Canonical keys in ONBOARDING.md (`crm_first_deal`, `wms_warehouse`, `pulse_first_job`...) | Per-app "learn the app" steps |
| Rules | Done > skipped > locked > ready, celebration only when all done, seen-marker guard | This plan |

Rule: a personal checklist never repeats an org setup step. Where the org is not set up yet,
the personal checklist links to the org setup guide instead of copying its steps.

## What exists today

| App | Org setup (ONBOARDING.md) | Personal onboarding |
| --- | --- | --- |
| Portal | Welcome wizard, then the SetupGuide in Organization settings (`apps/portal/src/features/setup/setup-guide.tsx`, `/settings/organization#setup`) | None (the wizard is org setup) |
| Projects | `projects_*` steps appear in the Portal guide | Welcome dialog, guided tour, sample project, Home "Get started" checklist, Help replay (`apps/projects/src/features/onboarding/*`, `apps/projects/src/features/home/getting-started.tsx`) |
| CRM | Pre-org setup at `/welcome` (`apps/crm/src/app/(auth)/welcome`, `apps/crm/src/features/wizards/onboarding`), then the Home Getting started card (`apps/crm/src/features/home/setup-guide-card.tsx`, REST `/api/v1/setup-guide`) | None |
| WMS | `/setup-warehouse`, then the dashboard Get set up panel (`apps/wms/src/components/dashboard/setup-guide-panel.tsx`, `/api/setup-guide`) | None |
| Pulse | `/welcome` getting-started page (`apps/pulse/src/features/welcome`); `pulse_*` steps in the Portal guide | None |

The org setup surfaces stay as they are. The new engine runs after setup, the first time a
person lands in the app, and sits next to the CRM card and WMS panel rather than replacing them.

## Engine design

New export: `@kitstak/ui/onboarding`.

**Components (app agnostic, no data fetching)**
- `WelcomeDialog`: mark, title, description, highlights[], and up to 3 actions (skip, secondary, primary).
- `GuidedTour`: spotlight + card, keyboard nav, phone fallback targets. Lifted from Projects as is.
- `GettingStartedChecklist`: progress ring, steps with done state, CTA per step, dismiss (x).
  Visual rules follow ONBOARDING.md (ring in `--dash-data`, never crimson; strikethrough only
  for skipped; celebration only when every step is done), so both kinds look the same.
- `OnboardingHost`: wires the three together and decides when to show what.

**Shared primitives.** The progress ring, confetti, arrival callout and step model are copied
today in Portal, CRM and WMS (the deferred "extract the triplicated primitives" item from the
org setup build). Phase 1 moves them into `packages/ui` and points all three org setup surfaces
at them, so org setup and personal onboarding share one implementation.

**State**
- `createOnboardingStore()`: zustand store (welcomeOpen, tourOpen, step), one per app.
- Persistence through an adapter the app passes in, so the engine never touches a database:
  ```ts
  interface OnboardingAdapter {
    load(): Promise<OnboardingPrefs | undefined>;
    save(patch: Partial<OnboardingPrefs>): Promise<void>;
  }
  interface OnboardingPrefs {
    welcomeSeen?: boolean;
    tourSeen?: boolean;
    tourStep?: number;
    checklistHidden?: boolean; // the personal checklist only; org setup dismiss stays in core.onboarding_progress
  }
  ```
  Each app keeps storing this in its own per-user prefs under `prefs.onboarding`. Nothing here
  writes `core.onboarding_progress`.

**Per-app config (the only thing each app writes)**
```ts
interface OnboardingConfig {
  appName: string;            // "CRM"
  mark: ReactNode;            // app logo
  description: string;
  highlights: [Highlight, Highlight, Highlight];
  sample?: { label: string; run(): Promise<{ href: string }> };
  tourSteps: TourStep[];      // targets use data-testid selectors
  checklist?: ChecklistStep[]; // personal steps; done state computed by the app from the person's own data
  setupGuideHref?: string;    // where org setup lives in this app, linked while it is incomplete
}
```

**Shared rules**
- Show the welcome ~700ms after prefs load, once per person.
- Wait for the dialog to close before starting the tour.
- Do not open the welcome on top of a `?setup=<key>` arrival: the org setup callout wins, and the
  welcome waits for the next visit.
- Help menu gets "Take the tour" and "Getting started" in every app.
- Analytics events with the same names everywhere: `onboarding_welcome_shown`, `onboarding_choice`,
  `onboarding_tour_step`, `onboarding_tour_done`, `onboarding_checklist_step_done`.

## Per-app content (first draft)

**CRM**
- Highlights: Track every deal / Never miss a follow-up / Start from a template.
- Sample: "Try a sample pipeline" (seeded contacts, deals, a few tasks for you).
- Tour: Boards nav, Quick add, Search, Inbox / My tasks.
- Personal checklist: move a deal to another stage, log an activity, assign yourself a follow-up,
  try search. Not "create a board", "add your first deal", "set up a dashboard" or "invite a
  teammate": those are org setup steps (`crm_workspace`, `crm_first_deal`, `crm_dashboard`,
  `invite_team`) on the Home card.

**WMS**
- Highlights: See every bin and SKU / Pick, pack, ship faster / Bill clients automatically.
- Sample: "Load sample warehouse data" (client, SKUs, stock, one open order).
- Tour: Inventory nav, Jobs, Search / scan, Clients.
- Personal checklist: find a SKU's stock, open an order, complete a job, scan or search by barcode.
  Not warehouse, locations, client, catalog or first order: those are the dashboard panel's org
  setup steps (`wms_*`).

**Pulse**
- Highlights: Know your real profit / Every job, every day / Plug in your data.
- Sample: reuse the existing sample data card.
- Tour: Dashboard, Production entry, Rates, Import.
- `/welcome` today mixes org setup (labor rate, first job, first entry, links) with app
  orientation. Line its org steps up with the contract's `pulse_*` keys and detection predicates
  (ONBOARDING.md), render them with the shared checklist component, and keep `/welcome` as a route
  so existing links work. Anything left over that is about learning the app moves to the personal
  checklist.

Copy to be reviewed per app before shipping.

## Plan

1. **Extract** (no visual change)
   - Move `GuidedTour`, welcome dialog layout and checklist UI from Projects into
     `packages/ui/src/onboarding`.
   - Move the shared org setup primitives (progress ring, confetti, arrival callout, step model)
     from Portal, CRM and WMS into the same package and point those three at it.
   - Add `createOnboardingStore`, adapter and config types. Export from `@kitstak/ui/onboarding`.
   - First add e2e tests for the Projects onboarding as it is today (welcome dialog, tour, skip,
     sample project). Projects has none yet (`apps/projects/e2e` holds only smoke and view
     tests), so without them the extraction is unchecked.
   - Point Projects at the package. Those new e2e tests and the CRM/WMS setup guide model tests
     (`setup-guide-model.test.ts`) must pass unchanged.
2. **CRM**
   - Add `onboarding` to CRM user prefs + server action, CRM config, sample pipeline seeder,
     `data-testid` hooks on tour targets, Help menu entries, personal checklist on Home under the
     existing Getting started card.
3. **Pulse**
   - Same wiring. Move the `/welcome` org steps onto the contract keys (above).
4. **WMS**
   - Same wiring, plus a sample data seeder (WMS has none today). Runs after `/setup-warehouse`,
     next to the Get set up panel.
5. **Polish**
   - Shared analytics events, a11y pass (focus, reduced motion, Esc), phone layout check in all four apps.
   - Unit tests for the engine in `packages/ui`; one e2e per app covering welcome, skip, tour, replay,
     and one that checks a `?setup=` arrival does not open the welcome.

## Open questions

- Should a person who already saw onboarding in one app see a shorter version in the next one?
- Sample data: per app seeders, or one cross-app "demo company" that fills CRM, WMS and Projects together?
- Should CRM and WMS show the personal checklist only after the org setup guide is complete, or
  both at once for people who are not owners or admins (they get a read-only setup guide)?
