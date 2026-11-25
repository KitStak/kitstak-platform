# Shared onboarding engine (CRM, WMS, Pulse)

## Note

Projects has the onboarding we want everywhere: a welcome dialog (logo, "Welcome to {App}, {name}!",
one line on what the app does, three highlight cards, and three choices: "I'll look around myself",
"Try a sample ...", "Show me around"), then a 4-step spotlight tour, plus a "Get started" checklist
on Home that checks itself off from real data. It shows once per person and can be replayed from Help.

Goal: give CRM, WMS and Pulse the same experience by pulling it into one shared engine in
`@kitstak/ui`, with each app only supplying its content.

## What exists today

| App | Today | Location |
| --- | --- | --- |
| Projects | Welcome dialog, guided tour, sample project, Home checklist, Help replay | `apps/projects/src/features/onboarding/*`, `apps/projects/src/features/home/getting-started.tsx` |
| CRM | Pre-org setup wizard at `/welcome` (pick starter boards). No in-app welcome or tour | `apps/crm/src/app/(auth)/welcome`, `apps/crm/src/features/wizards/onboarding` |
| Pulse | `/welcome` getting-started page (5 data-driven steps). No welcome dialog or tour | `apps/pulse/src/features/welcome` |
| WMS | `/setup-warehouse` only. Nothing in-app | `apps/wms/src/app/setup-warehouse` |

The existing setup wizards (CRM org setup, WMS warehouse setup) stay. The new engine runs after
setup, the first time a person lands in the app.

## Engine design

New export: `@kitstak/ui/onboarding`.

**Components (app agnostic, no data fetching)**
- `WelcomeDialog`: mark, title, description, highlights[], and up to 3 actions (skip, secondary, primary).
- `GuidedTour`: spotlight + card, keyboard nav, phone fallback targets. Lifted from Projects as is.
- `GettingStartedChecklist`: progress ring, steps with done state, CTA per step, dismiss (x).
- `OnboardingHost`: wires the three together and decides when to show what.

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
    checklistHidden?: boolean;
    dismissed?: boolean;
  }
  ```
  Each app keeps storing this in its own per-user prefs under `prefs.onboarding`.

**Per-app config (the only thing each app writes)**
```ts
interface OnboardingConfig {
  appName: string;            // "CRM"
  mark: ReactNode;            // app logo
  description: string;
  highlights: [Highlight, Highlight, Highlight];
  sample?: { label: string; run(): Promise<{ href: string }> };
  tourSteps: TourStep[];      // targets use data-testid selectors
  checklist?: ChecklistStep[]; // done state computed by the app from real data
}
```

**Shared rules**
- Show the welcome ~700ms after prefs load, once per person.
- Wait for the dialog to close before starting the tour.
- Help menu gets "Take the tour" and "Getting started" in every app.
- Analytics events with the same names everywhere: `onboarding_welcome_shown`, `onboarding_choice`,
  `onboarding_tour_step`, `onboarding_tour_done`, `onboarding_checklist_step_done`.

## Per-app content (first draft)

**CRM**
- Highlights: Track every deal / Never miss a follow-up / Start from a template.
- Sample: "Try a sample pipeline" (seeded contacts, deals, a few tasks for you).
- Tour: Boards nav, Quick add, Search, Inbox / My tasks.
- Checklist: add a contact, create a deal, move a deal stage, log an activity, invite a teammate.

**WMS**
- Highlights: See every bin and SKU / Pick, pack, ship faster / Bill clients automatically.
- Sample: "Load sample warehouse data" (client, SKUs, stock, one open order).
- Tour: Inventory nav, Jobs, Search / scan, Clients.
- Checklist: add a client, add a SKU, receive stock, complete a job, connect an integration.

**Pulse**
- Highlights: Know your real profit / Every job, every day / Plug in your data.
- Sample: reuse the existing sample data card.
- Tour: Dashboard, Production entry, Rates, Import.
- Checklist: fold the current 5 `/welcome` steps into the shared checklist component.

Copy to be reviewed per app before shipping.

## Plan

1. **Extract** (Projects only, no visual change)
   - Move `GuidedTour`, welcome dialog layout and checklist UI into `packages/ui/src/onboarding`.
   - Add `createOnboardingStore`, adapter and config types. Export from `@kitstak/ui/onboarding`.
   - Point Projects at the package. Its existing e2e tests (`welcome-dialog`, `welcome-tour`,
     `welcome-skip`, `create-sample-project`) must pass unchanged.
2. **CRM**
   - Add `onboarding` to CRM user prefs + server action, CRM config, sample pipeline seeder,
     `data-testid` hooks on tour targets, Help menu entries, checklist on the home view.
3. **Pulse**
   - Same wiring. Migrate the `/welcome` steps into the shared checklist; keep `/welcome` as a route
     that renders it so existing links still work.
4. **WMS**
   - Same wiring, plus a sample data seeder (WMS has none today). Runs after `/setup-warehouse`.
5. **Polish**
   - Shared analytics events, a11y pass (focus, reduced motion, Esc), phone layout check in all four apps.
   - Unit tests for the engine in `packages/ui`; one e2e per app covering welcome, skip, tour, replay.

## Open questions

- Should a person who already saw onboarding in one app see a shorter version in the next one?
- Does the portal (`apps/portal/src/features/welcome`) join the engine later?
- Sample data: per app seeders, or one cross-app "demo company" that fills CRM, WMS and Projects together?
