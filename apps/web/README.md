# kitstak-web

Marketing site for the KitStak platform, served at **https://kitstak.com**
(`www.kitstak.com` redirects to the apex). The portal is at `kitstak.app` and the product apps are on
`crm.` / `wms.` / `projects.` / `pulse.kitstak.app`. See `src/components/site-links.ts`.

- Next.js 16 (App Router), fully static. Beyond React it depends only on two workspace packages:
  `@kitstak/ui` (design tokens) and `@kitstak/billing` (the pure price catalog, quote and sign-up link).
- Design tokens come from `@kitstak/ui/styles/tokens.css` (shared with the apps).
- Logos in `public/brand` are the supplied artwork, with transparent padding trimmed by
  `scripts/prepare-brand.mjs`. Do not redraw them.
- Product pages for each app belong here as routes (`/wms`, `/crm`, `/projects`, `/pulse`), not as separate sites.
- The stack is four licensable products: CRM, WMS, Projects and Pulse, in that order (`PRODUCT_IDS` in
  `site-links.ts`, matching `@kitstak/entitlements`). A stack is any non-empty set of them; two or more take
  the bundle discount.

## Pages

| Route          | What it is                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/`            | Home                                                                                                                   |
| `/products`    | All four products, the comparison, and the price calculator (`#pricing`), with a link to `/pricing`                    |
| `/pricing`     | Prices: the monthly and yearly switch, one card per app, the calculator, "How billing works" and the price questions   |
| `/wms`, `/crm` | In-depth product pages. Copy lives in `src/components/{wms,crm}/*-content.ts`                                          |
| `/projects`    | KitStak Projects. Copy in `src/components/projects/projects-content.ts`; lists and counts come from the app (below)    |
| `/pulse`       | KitStak Pulse. Copy in `src/components/pulse/pulse-content.ts`, visuals in `src/components/pulse/` (see "Pulse" below) |
| `/get-started` | The "Set up your Stak" wizard (`src/components/wizard`, model in `src/lib/stak.ts`). Its last step opens portal sign-up |
| `/contact`     | Contact and "talk to the founder" (`?topic=founder\|demo\|projects\|pulse\|sales`). `&product=pulse` on a walkthrough link starts the message with that product (`walkthroughHref`)                                     |

Every internal link goes through `ROUTES` in `src/components/site-links.ts`; the header menu, the
mobile drawer and the footer all read `src/components/nav/nav-data.ts`.

## Prices, sign-up and the free trial

Read `docs/billing/SPEC.md` section 4 and `docs/billing/CONTRACTS.md` sections 4, 6 and 19 first.

- **One catalog.** The site holds no price. `src/lib/pricing.ts` re-exports the shared catalog and quote
  from `@kitstak/billing` (`packages/billing/src/catalog.ts` and `quote.ts`), the same ones portal sign-up,
  billing and the payment gateway read. It adds only phrases built from them ("$29 per user each month").
  To change a price, change the catalog. `src/lib/pricing.test.ts` fails if a price is written anywhere in
  `src`, and it checks the nine reference carts to the cent.
- **Same lines as the portal.** The calculator (`src/components/stak/bundle-calculator.tsx`) and the wizard
  summary show what the portal picker shows: one math line per app, each discount as its own dollar line,
  the total, and for yearly the per month view. Money always shows its cents. Nothing is rounded.
- **Straight to sign-up.** "Start my free trial" on the calculator, "Start free" on a pricing card and the
  button on each product page's price band open the portal's `/signup` with the cart in the link
  (`trialUrl` in `src/lib/stak.ts`). "Help me choose" opens the wizard with the same cart.
- **The wizard hand-off.** The last wizard step asks for name, work email and company. "Create my account"
  opens `signupUrl(LINKS.portal, handoff, identity)` from `@kitstak/billing/handoff` (`handoffUrl` in
  `src/lib/stak.ts`): apps, seats, warehouses, period, business type, team size, start mode and the guided
  setup flag in the query, and name, email and company after the `#`, where no server and no log sees
  them. The link holds no price. The portal checks every value and prices the cart itself.
- **Where the portal is.** `LINKS` in `src/components/site-links.ts` reads `NEXT_PUBLIC_PORTAL_URL` (and
  `NEXT_PUBLIC_CRM_URL`, `NEXT_PUBLIC_WMS_URL`, `NEXT_PUBLIC_PROJECTS_URL`, `NEXT_PUBLIC_PULSE_URL`). With
  none set, a production build uses the real domains and `next dev` uses the local dev ports from
  `docs/billing/DEV.md`, so a wizard run on a local site lands on the local portal with no setup.
- **Words.** On the pricing surfaces a product is an "app", and the rules in `docs/billing/SPEC.md`
  section 0 apply: plain words, sentences of 20 words at most, no em dash, no double dash.
  `src/lib/pricing-page.test.ts` checks them.

## Placeholders to replace before launch

- **Contact details**. `CONTACT` in `src/components/site-links.ts`. The contact form has no backend:
  it opens the visitor's email app (`buildMailto`).
- **Guided setup**. The wizard's "Guided setup with the founder" box rides to the portal as `guided=1`.
  Nothing books a time yet, so the copy sends the visitor to the contact page to pick one.

- **Pulse screenshots**. The `/pulse` page shows real product screenshots: Home in the hero, then Profit
  by job, Jobs, a "How we got this" panel, Log work, Plan vs actual, the rate builder, the import Check
  step and Connected apps.
  They come straight from the running Pulse app with its demo data. They are cropped, scaled and
  compressed, and never retouched. Each one exists in a light and a dark theme and in up to three window
  sizes (desktop, tablet, phone). `PulseShot` (`src/components/pulse/pulse-shot.tsx`) picks the file by
  screen width and system theme. The slots, alt text and retake steps are in
  `src/components/pulse/pulse-shots.ts`. To retake, run
  `node scripts/capture-pulse-shots.mjs <rawDir> <importBatchId>` against a running Pulse app (it needs
  Playwright), then `node scripts/prepare-pulse-shots.mjs <rawDir>`, which writes `public/pulse/shots`.
  Retake every slot
  together so the numbers agree, then check the alt text and the page copy against the new screens. One
  picture has one alt text for every size, so each alt first says what all sizes show and then names what
  only a wide screen adds. Check it against the phone picture too. A picture never ends in the middle of a
  line of text: a view with a `clip` in the capture script opens a tall window and saves it down to the
  edge of a table row or a card. So heights come from the screens. The prepare script prints them, and
  they go into `pulse-shots.ts`. Jobs is scrolled so the status chips sit under the top bar and the list
  starts high. Plan vs actual on a wide screen is the whole page in one tall picture: the job, the Quote
  vs actual table with its column headings, and "Why profit changed". On a phone it leaves out the job
  header and runs from the Quote vs actual card, with every row, to the three cards under the chart. On
  the desktop Profit picture the Units per hour column is hidden with the app's own Columns button, so
  the table ends on a whole column. The "How we got this" panel is the panel alone, taken at three device
  pixels to one because it is small. The phone capture is used up to 760 pixels and held to 440 pixels
  wide. Every picture links to its widest desktop file, so a visitor can open it at full size. The rate
  builder is a dialog on a wide screen. On a phone the picture is the Rates tab behind
  it, scrolled to the Packer card. Connected apps is scrolled to the WMS card, which has linked jobs. Home
  is taken on a 430 pixel phone, because at 390 the change chip on the Cost tile runs past its tile (a
  product glitch the Pulse team needs to fix). The home page column shows `jobs-close`, the Jobs table
  cut at the right edge of its Units done column, because a tablet window cuts that table through a
  column. The demo data calls the day it was seeded "today". To retake one slot on a later day, run the
  Pulse app with its clock set back and pass the same shift as `PULSE_CLOCK_SHIFT_MINUTES`. The caption
  under every
  picture says the clients and jobs are made up. The
  demo data is built from the day it is seeded, so the numbers move. A slot set to `ready: false` falls
  back to its coded illustration in `src/components/pulse/pulse-visuals.tsx`. The home page Pulse section
  shows the Jobs screenshot. The worked job has no screenshot. It is a coded example from the spec and is
  labeled "a worked example".
- **Pulse copy next to a screenshot**. Words for a screen are the words on that screen: Revenue and Cost,
  Quote vs actual, Extra services, the six import counters, and the five statuses in the order of the
  Jobs page (Losing money, At risk, Not enough data, Heads up, On track). Copy beside a screenshot
  describes it and quotes no sample figure, because the demo numbers move with every retake. The only
  dollar figures on `/pulse` are in the worked job. `src/lib/pulse-claims.test.ts` checks all of this.
- **Pulse sign-in link**. The footer links to `LINKS.pulse` (`https://pulse.kitstak.app`) only when
  `PULSE_IS_LIVE` is true. Check that origin answers before you flip the flag.

Product page copy describes only what `apps/wms`, `apps/crm` and `apps/projects` do today. Keep it that way.

## Pulse

### Pulse price

Pulse costs $29 per organization per month, and that covers up to 5 seats. It is one flat price for the
organization, not a price per user. The owner confirmed it and it is final.

- The price lives in the shared catalog (`CATALOG.products.pulse`), like the other three. Its
  `quantityFrom` is `flat`: one quote line, quantity 1, never multiplied by seats or warehouses.
- The bundle discount and the yearly discount apply to the Pulse line the same way as to every other line.
- The owner gave no price above 5 seats, so the site quotes none. It says "Need more than 5 seats? Talk
  to us." and links to `/contact`. With Pulse on and a bigger team, the quote says "The Pulse price covers
  up to 5 seats. For a bigger team, talk to us." (`pulseSeatNote` on the shared quote), so the total never
  reads as a Pulse price for a bigger team. Do not add a higher tier without the owner.

### Pulse availability (`PULSE_IS_LIVE`)

Pulse is live. `PULSE_IS_LIVE` in `src/components/site-links.ts` is true: Pulse is sold through the same
sign-up as the other three apps (docs/billing/DECISIONS.md, CONTRACTS.md section 19). Pulse has "Start with
Pulse", a wizard row, the footer link to the Pulse sign-in and no "Coming soon" label. Every Pulse button
starts a trial or opens the wizard.

The flag stays as the one switch for a product whose app is closed, so the site can be switched back if
the Pulse app ever has to close to new customers. Set it to false and the site labels Pulse as not open, every start link leaves Pulse out (`startLink`, `getStartedHref`, `pricingHref`,
`wizardHref`, `trialUrl`, `handoffUrl`), a Pulse only stack goes to the walkthrough form, and the wizard
shows Pulse as a labeled row with no box to tick. `src/lib/pulse-availability.test.ts` holds the checks for
both positions of the switch. The checks for the closed position are skipped while the flag is true.

The Pulse app is built on its own branch, so `apps/pulse` may not be in this tree. Until it is, every
claim about Pulse on this site follows `docs/pulse/SPEC.md` and `docs/pulse/CONTRACTS.md`: if the spec
does not say the product does it, the site does not say it either. No customer names, results or numbers.

- The official Pulse artwork is in `public/brand` (`apps/kitstak-icon-pulse.svg`, `loaders/`, `logos/`),
  copied byte for byte. Never redraw, recolor or re-export it.
- Pulse is the fourth bar of the stack. Its bar color is `--stak-pulse` in `src/styles/globals.css`, with
  navy ink on it (`--stak-pulse-ink`).
- Placements read shared data, so most follow on their own: `PRODUCT_NAV` (header menu, mobile drawer,
  footer, 404), `PRODUCT_IDS` and the shared `CATALOG` (calculator, pricing cards, wizard, home "Run all
  four" switches, price band). `src/lib/pulse-placements.test.ts` fails if one falls out of step.
- Home "Run all four" plans: the plans without Pulse are written out in
  `src/components/licensing/licensing-plans.ts`; the plans with Pulse are composed from them.

### Pulse release checklist

The `/pulse` page describes the finished product in the present tense. `docs/pulse/CONTRACTS.md`
section 13 lists parts of it that were not built yet when this page was written. Do not deploy `/pulse`,
the Pulse entry in the Products menu or the footer sign-in link to production until every line below is
ticked. Each one is a click through on the Pulse demo workspace, signed off by the Pulse team.

- [ ] Import: upload a CSV, match the columns, see the check step, save, then undo the import.
- [ ] Export: download one kind of data as CSV, then "Download everything".
- [ ] Floor tablet and wall display: open a kiosk link, enter a 4 digit PIN, log a row. No money shows.
- [ ] Sync with each app: a won CRM deal becomes a job, a WMS work order becomes a job with its units,
      and time from a linked Projects project counts as labor hours.
- [ ] Pulse numbers in the other apps: the Profit tab on a CRM deal, the Job profit card on a WMS work
      order, the Job profit strip on a project and the Pulse tile in Portal.
- [ ] Alerts: the inbox (snooze, assign, dismiss), the rules tab with its twelve rules, and "Create a
      task in Projects".
- [ ] Quote calculator: cost per unit, the price for the target margin and the lowest price worth taking.
- [ ] Month close: close a month, see its rows lock, reopen it with a reason.
- [ ] Reports: all 19 open, and each one exports CSV.
- [ ] "How we got this" opens on a money figure, a margin and a status.
- [ ] Settings: change a risk limit and see "this would flag N jobs" before saving.
- [ ] `https://pulse.kitstak.app` answers and shows the sign-in page.
- [x] The owner has confirmed the Pulse price and unit: $29 per organization per month, up to 5 seats.
- [x] `PULSE_IS_LIVE` is set to true in `src/components/site-links.ts`. Done on 2026-11-23, when the owner
      opened self serve sign-up for all four apps (docs/billing/DECISIONS.md). The open lines above still
      need their sign off from the Pulse team.

If a feature is cut or changes, change the copy in `src/components/pulse/pulse-content.ts` to match
before the page ships.

## Social preview images

Every indexable page has an Open Graph and a Twitter image, drawn at build time by
`src/lib/og-image.tsx` through Next's `opengraph-image.tsx` and `twitter-image.tsx` files (one pair per
route folder). They use the supplied brand files unchanged and Bebas Neue from `src/assets/fonts` (SIL
Open Font License). To change a card, edit the promise line in that route's `opengraph-image.tsx`.

## Projects content comes from the Projects app

`scripts/sync-projects.ts` reads `apps/projects` and writes `src/generated/projects/`:

- `catalog.ts`: views, custom field types, roles, link targets, automation triggers/actions/conditions and
  recipes, the cross-app record triggers, and the built-in templates with their task counts.
- `nl-parse.ts`, `dates.ts`, `wms-codes.ts`, `constants.ts`: verbatim copies of the app's pure parsers, so
  the quick-add demo on `/projects` runs the app's own code.

It runs on `prebuild`, so each deploy matches the Projects code it was built from. The output is committed
so dev and tests work without it, and `src/lib/projects-sync.test.ts` fails when the snapshot is stale.
`projects-content.ts` types its notes against the app's enums, so a new view or link type in Projects
fails the typecheck here until it has copy. Never edit `src/generated/` by hand.

```bash
pnpm --filter kitstak-web dev     # http://localhost:3600 (Projects owns 3400)
pnpm --filter kitstak-web build
pnpm --filter kitstak-web test    # shared catalog and reference carts, pricing page, calculator, wizard hand-off, contact, quick-add demo, Projects snapshot, Pulse placements and start links
pnpm --filter kitstak-web sync:projects   # refresh src/generated/projects from apps/projects
```

Vercel project: `kitstak-website`, Root Directory `apps/web`.

## Deploys

Vercel skips the build for any commit whose message contains the skip deploy tag in square brackets, anywhere in the title or body. Leave the tag out of a merge commit that should go live.
