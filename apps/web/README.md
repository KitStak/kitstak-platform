# kitstak-web

Marketing site for the KitStak platform, served at **https://kitstak.com**
(`www.kitstak.com` redirects to the apex). The portal is at `kitstak.app` and the product apps are on
`crm.` / `wms.` / `projects.` / `pulse.kitstak.app`. See `src/components/site-links.ts`.

- Next.js 16 (App Router), fully static, no runtime dependencies beyond React.
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
| `/products`    | All four products, the comparison, and the bundle price calculator (`#pricing`)                                        |
| `/wms`, `/crm` | In-depth product pages. Copy lives in `src/components/{wms,crm}/*-content.ts`                                          |
| `/projects`    | KitStak Projects. Copy in `src/components/projects/projects-content.ts`; lists and counts come from the app (below)    |
| `/pulse`       | KitStak Pulse. Copy in `src/components/pulse/pulse-content.ts`, visuals in `src/components/pulse/` (see "Pulse" below) |
| `/get-started` | The "Set up your Stak" wizard (`src/components/wizard`, model in `src/lib/stak.ts`)                                    |
| `/contact`     | Contact and "talk to the founder" (`?topic=founder\|demo\|projects\|pulse\|sales`)                                     |

Every internal link goes through `ROUTES` in `src/components/site-links.ts`; the header menu, the
mobile drawer and the footer all read `src/components/nav/nav-data.ts`.

## Placeholders to replace before launch

- **Pricing**. `src/lib/pricing.ts` (`PRICING`, `PRICING_IS_PLACEHOLDER`). Every page and the wizard read
  from here. The CRM, WMS and Projects numbers are stand-ins and print "Preliminary pricing, shown for
  planning." The Pulse price is confirmed by the owner and carries `isConfirmed: true`, so it is never
  called preliminary (see "Pulse price" below).
- **Contact details**. `CONTACT` in `src/components/site-links.ts`. The contact form has no backend:
  it opens the visitor's email app (`buildMailto`).
- **Account creation**. The wizard's last step collects name, email and company in memory only, then
  links to the portal's `/signup` with the non-personal answers (`focus`, `products`, `businessType`,
  `teamSize`, `startMode`) in the query string. `focus` keeps the portal's `crm | wms | both` shape;
  `products` carries the full set, including `projects`, and `pulse` only once `PULSE_IS_LIVE` is true. The
  portal does not read them yet.

- **Pulse screenshots**. The `/pulse` page shows real product screenshots: Home in the hero, then Profit
  by job, Jobs, Log work, Plan vs actual, the rate builder, the import Check step and Connected apps.
  They come straight from the running Pulse app with its demo data. They are cropped, scaled and
  compressed, and never retouched. Each one exists in a light and a dark theme and in up to three window
  sizes (desktop, tablet, phone). `PulseShot` (`src/components/pulse/pulse-shot.tsx`) picks the file by
  screen width and system theme. The slots, alt text and retake steps are in
  `src/components/pulse/pulse-shots.ts`. To retake, run
  `node scripts/capture-pulse-shots.mjs <rawDir> <importBatchId>` against a running Pulse app (it needs
  Playwright), then `node scripts/prepare-pulse-shots.mjs <rawDir>`, which writes `public/pulse/shots`.
  Retake every slot
  together so the numbers agree, then check the alt text and the page copy against the new screens. The
  demo data is built from the day it is seeded, so the numbers move. A slot set to `ready: false` falls
  back to its coded illustration in `src/components/pulse/pulse-visuals.tsx`. The worked job, the "How we
  got this" panel and the home page card have no screenshot and stay coded illustrations with sample
  numbers.
- **Pulse sign-in link**. The footer links to `LINKS.pulse` (`https://pulse.kitstak.app`) only when
  `PULSE_IS_LIVE` is true. Check that origin answers before you flip the flag.

Product page copy describes only what `apps/wms`, `apps/crm` and `apps/projects` do today. Keep it that way.

## Pulse

### Pulse price

Pulse costs $29 per organization per month, and that covers up to 5 seats. It is one flat price for the
organization, not a price per user. The owner confirmed it and it is final.

- In `PRICING` each product has a billing basis. The CRM, WMS and Projects are `per_unit` (multiplied by
  seats or warehouses, see `quantityFrom`). Pulse is `flat_per_org`: one quote line, quantity 1, never
  multiplied by seats or warehouses.
- The bundle discount and the yearly discount apply to the Pulse line the same way as to every other line.
- The owner gave no price above 5 seats, so the site quotes none. It says "Need more than 5 seats? Talk
  to us." and links to `/contact`. Do not add a higher tier without the owner.

### Pulse is "Coming soon"

`PULSE_IS_LIVE` in `src/components/site-links.ts` is false until customers can open the Pulse app. While
it is false:

- The site says exactly "Coming soon" (`COMING_SOON`) on the `/products` Pulse card, in the Products menu
  and the mobile drawer, on the calculator switch, on the `/pulse` price card, in the wizard's Pulse row,
  and in the `/pulse` FAQ "How do I start?" answer and closing note.
- No link leads toward an account for Pulse. `startLink('pulse')` gives "Book a walkthrough" to
  `ROUTES.demo`. `getStartedHref` and `wizardHref` leave Pulse out of the stack they carry, and send a
  Pulse only stack to the walkthrough form. The wizard shows Pulse as a labeled row with no box to tick,
  drops it from links and saved answers, and never hands it to sign-up.
- The calculator on `/products` still prices Pulse. When Pulse is switched on, a line under the button
  says it is coming soon and that the button sets up the rest of the stack.

Set `PULSE_IS_LIVE` to true and all of this goes back to the normal start flow with no other change.
`src/lib/pulse-availability.test.ts` fails if a Pulse start link is live while the flag is false.

The Pulse app is built on its own branch, so `apps/pulse` may not be in this tree. Until it is, every
claim about Pulse on this site follows `docs/pulse/SPEC.md` and `docs/pulse/CONTRACTS.md`: if the spec
does not say the product does it, the site does not say it either. No customer names, results or numbers.

- The official Pulse artwork is in `public/brand` (`apps/kitstak-icon-pulse.svg`, `loaders/`, `logos/`),
  copied byte for byte. Never redraw, recolor or re-export it.
- Pulse is the fourth bar of the stack. Its bar color is `--stak-pulse` in `src/styles/globals.css`, with
  navy ink on it (`--stak-pulse-ink`).
- Placements read shared data, so most follow on their own: `PRODUCT_NAV` (header menu, mobile drawer,
  footer, 404), `PRODUCT_IDS` and `PRICING` (calculator, wizard, home "Run all four" switches, price
  band). `src/lib/pulse-placements.test.ts` fails if one falls out of step.
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
- [ ] `PULSE_IS_LIVE` is set to true in `src/components/site-links.ts` on the day the app opens.

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
pnpm --filter kitstak-web dev     # http://localhost:3400
pnpm --filter kitstak-web build
pnpm --filter kitstak-web test    # pricing, wizard, contact, quick-add demo, Projects snapshot, Pulse placements and start links
pnpm --filter kitstak-web sync:projects   # refresh src/generated/projects from apps/projects
```

Vercel project: `kitstak-website`, Root Directory `apps/web`.
