# KitStak dashboard cleanup

One layout and one set of pieces for every app's home screen, from `@kitstak/ui/dashboard`.
The apps should look like one product and still feel like five different tools.

This file is the contract. When an app drifts from it, the app is wrong.

Audit date: 2026-11-25, local dev, `admin@kitstak.io` on org `kitstak`, 1440 px wide, light and dark.

## 1. The rules

### Color is meaning, never decoration

| Color | Means | Used for | Never used for |
| --- | --- | --- | --- |
| Crimson (`--primary`) | KitStak, "do this" | Logo, the one primary button, active nav underline | Data bars, progress, meters, bad news |
| Danger (`--danger`) | Losing, broken, late | Critical pills, a negative number that matters | Brand, buttons that are not destructive |
| Warning (`--warning`) | Might go wrong | Caution pills | Highlighted bands, whole rows |
| Success (`--success`) | Done, healthy | Positive pills, a good delta | Times, plain counts |
| Info (`--info`) | Neutral news | Info pills | Focus rings in one app only |
| App data color (`--dash-data`) | "This is a quantity" | Bars, meters, sparklines, first chart series | Status |
| Neutral text and surfaces | Everything else | Labels, numbers, icons, cards | |

Crimson and danger are nearly the same red. That is why data must never be crimson: a crimson
progress bar reads as an error. WMS does this today on every progress bar and rank bar.

### Pills

There are two shapes, each with one job.

- **Pill** (fully round): a state. "Losing money", "At risk", "Running", "On track".
- **Tag** (4 px corners, neutral only): an identity. Job keys, program codes, types ("TEES", "Q4M-1", "Planned").

The pill recipe, with no exceptions:

1. Flat fill of `--{tone}-subtle` with `--{tone}-text`. Five tones: neutral, positive, caution, critical, info.
2. No border, no ring, no shadow, no inset highlight, no gradient, no glow.
3. Sentence case, 12 px, weight 500, 20 px tall, 8 px side padding. The same size everywhere on a page.
4. At most one marker: a leading icon or a dot, never both.
5. Nothing rides on top of a pill. A second signal (Projects' amber "numbers disagree" dot) goes into
   the words ("On track, check") or the tooltip.
6. Numbers are not pills. A change is colored text with an arrow. A count in a tab or nav is plain text
   in a neutral tag; only a count of things that are overdue or broken gets the critical tone.
7. Legends are not pills. A legend is a dot and a word.

### Surfaces

- Depth comes from the surface steps and 1 px borders (tokens.css rule). Cards get `shadow-xs` at most.
- No tinted icon squares. Icons are `--icon-muted`. A KPI tile does not need an icon.
- No highlighted bands. A warning inside a card is a row with a caution icon or pill, not a brown or
  pink strip across the card. Tinted surfaces are reserved for a page-level callout that blocks work.
- Sentence case for every heading. ("Unfulfilled orders", not "Unfulfilled Orders".)

### No dead ends

- Every headline number links to the list it counts, already filtered.
- Every row in a list links to its record.
- Every section has at most one header action, and it is a real link ("All open jobs").
- Every empty state names the next step and links to it. "You're all caught up" gets a link to where
  new work shows up.
- Hover shows the link; there is no second "view" button next to it.
- Info icons are not stamped on every card. The label carries a tooltip; a section that needs a long
  explanation gets a "How we count this" link in its footer.

### Say it once

- A fact appears once per screen. A summary sentence does not repeat the tiles under it.
- One attention list per app home. Alerts that are also "jobs that need you" are merged into it.
- A row does not repeat its own number in a sentence. The number sits in the value column; the
  sentence explains why.
- "vs before" says what "before" is, once, in the header ("Compared with Oct 1 to 25").

## 2. The layout

Every app home uses the same frame, top to bottom:

1. **Header.** An optional eyebrow (date, org), the title, one line under it, then actions on the
   right: one primary button at most, one secondary. Period pickers and filters sit in the header
   row, not inside a card.
2. **Stat row.** Up to four tiles. Each tile is a link. A tile has a label, a value, an optional
   change, and an optional sparkline in the app's data color.
3. **Attention.** One list, worst first by money or time, not by badge type. Each row has a title,
   a reason, a value column and a pill column. The value and pill columns have fixed widths so the
   numbers line up.
4. **Work.** The app's main sections, two thirds wide, with a rail of small cards on the right.
5. **Everything else** below, never above the attention list.

## 3. Same look, different feel

The frame, pieces, type and spacing are shared. Each app changes three things through
`<DashboardFrame app="...">`:

| App | Data color | Density | Voice of the header |
| --- | --- | --- | --- |
| Portal | Neutral gray (`--chart-5`) | Roomy | "Your apps" |
| CRM | Indigo (`--label-indigo`) | Roomy | Greeting, people first |
| WMS | Teal (`--chart-2`) | Compact | "Dashboard", the shift and the clock |
| Projects | Violet (`--chart-4`) | Comfortable | Greeting, "your work today" |
| Pulse | Blue (`--pulse-series-1`, the first hue of its own chart palette) | Comfortable | Money first: the two line answer |

Ochre (`--chart-3`) and terracotta (`--chart-6`) are left out as app colors because they read as
warning and danger.

## 4. What the audit found

### All apps

- Each app has its own copy of Badge, Card, PageHeader, KPI tile and status pill. CRM, Projects and
  Pulse share byte-identical `badge.tsx` and `card.tsx`; Portal and WMS have their own versions.
- Four different KPI tiles: WMS `StatTile`, Projects local `StatTile`, Pulse `KpiTile`, CRM `MetricTile`.
- Three pill recipes: Portal (uppercase, tinted border), WMS (inline styles from `status-colors.ts`),
  CRM/Projects/Pulse (`StatusPill`).

### Portal (`apps/portal/src/app/(app)/page.tsx`)

- Clean. App tiles are links, the page has one job.
- Its Badge is the odd one out: uppercase, letter-spaced, tinted border. Move it to the shared Pill.

### CRM (`apps/crm/src/features/home/home-page.tsx`)

- The first setup step is drawn as a highlighted band, and its button is a small solid crimson
  button inside a card, a second primary action next to "New board".
- "Done, detected" is loose green text, not a pill.
- Empty states ("You're all caught up") stop there. They need a next step.

### WMS (`apps/wms/src/components/dashboard/widgets.tsx`)

- Every progress bar, shift bar and rank bar is crimson. These are quantities, not errors.
- The "7+ days old" bar is terracotta and the donut is gold and blue: three unrelated palettes in one row.
- Shift times are green text for no reason. "72 waiting 7+ days" is red text with no pill.
- The legend above the donut is drawn as bordered pills.
- Headings are in Title Case; every other app uses sentence case.
- Each rank card has a tinted icon square in its corner.
- The total in the donut (72) is not a link.
- Top bar: the icon cluster overlaps the notification badge and the avatar at 1440 px.

### Projects (`apps/projects/src/features/home/home-view.tsx`)

- KPI tiles have tinted icon squares in four different colors.
- Health pills carry an amber dot drawn half off the pill's corner.
- At-risk projects get amber progress bars, the rest white. Goals do the same. Progress is a
  quantity; the pill already says the state.
- "Mismatches" is a brown band across the whole card.
- Customer rows mix red text, amber text and colored icons in one line.

### Pulse (`apps/pulse/src/features/home/home-view.tsx`)

- None of the six KPI tiles link anywhere, and neither do the banner figures, "Not billed yet" or
  "Paid time not on any job". These are dead ends.
- The banner repeats the tiles under it (profit, margin, company margin).
- "Alerts" repeats rows from "Jobs that need you".
- Each delta is a tinted chip showing dollars and percent; "vs before" is printed six times.
- Six info icons, one per tile.
- Two crimson primary buttons: "Log work" in the top bar and "New job" on the page.
- The `watch` margin state uses the yellow label color, a sixth tone.

## 5. Rollout

1. Ship `@kitstak/ui/dashboard` with tests: `DashboardFrame`, `DashboardHeader`, `StatRow`,
   `StatTile`, `Delta`, `Pill`, `Tag`, `Meter`, `DashSection`, `ActionList`, `ActionRow`, `EmptyNote`.
2. Move each app home onto it, one app per change, with before and after screenshots in light and dark.
3. Then retire the duplicated `badge.tsx`, `card.tsx` and KPI tiles inside each app, list pages first.

### Status (2026-11-25)

Steps 1 and 2 are done: all five homes use the module, checked at 1440 px in light and dark.
A headline-number scan finds no unlinked numbers on Portal, CRM, WMS or Projects. On Pulse
the only ones left are the figures inside the two line answer, which the tiles under it link,
and the donut total.

Left for step 3 and beyond:

- Shared pieces outside the homes still break the rules: Projects `TaskRow` priority bars,
  the tinted inbox `NotificationAvatar`, the crimson-outlined timer in the Projects top bar,
  and the Portal SetupGuide's crimson current-step button (ONBOARDING.md now forbids it).
- WMS status names come from the server in Title Case ("Ready to Pick").
- CRM `routes.templates()` points at a page that does not exist.
- Module asks from the rollout: a count next to a section title, a button action for
  `EmptyNote`, a tooltip on `DashSection`, `Legend` toggles and a thicker `Meter` for WMS tables.
- Pulse's two line answer repeats two tiles. It is in the Pulse spec, so it stays until the
  spec changes.
