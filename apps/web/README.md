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

| Route | What it is |
| --- | --- |
| `/` | Home |
| `/products` | All four products, the comparison, and the bundle price calculator (`#pricing`) |
| `/wms`, `/crm` | In-depth product pages. Copy lives in `src/components/{wms,crm}/*-content.ts` |
| `/projects` | KitStak Projects. Copy in `src/components/projects/projects-content.ts`; lists and counts come from the app (below) |
| `/pulse` | KitStak Pulse. Copy in `src/components/pulse/pulse-content.ts`, visuals in `src/components/pulse/` (see "Pulse" below) |
| `/get-started` | The "Set up your Stak" wizard (`src/components/wizard`, model in `src/lib/stak.ts`) |
| `/contact` | Contact and "talk to the founder" (`?topic=founder\|demo\|projects\|pulse\|sales`) |

Every internal link goes through `ROUTES` in `src/components/site-links.ts`; the header menu, the
mobile drawer and the footer all read `src/components/nav/nav-data.ts`.

## Placeholders to replace before launch

- **Pricing** — `src/lib/pricing.ts` (`PRICING`, `PRICING_IS_PLACEHOLDER`). Stand-in numbers; every
  page and the wizard read from here. The Pulse line (`PRICING.pulse`, per user) is a stand-in like the
  rest: the Pulse spec states no price and no unit, so both need the owner's sign-off. While it carries
  `isUnconfirmed: true`, the `/pulse` price band and every quote that includes Pulse print "Pulse pricing
  is not final" beside the number, and the `/products` FAQ says Pulse pricing is being set. When the
  owner confirms the price and unit, set them, remove the flag and update that FAQ answer.
- **Contact details** — `CONTACT` in `src/components/site-links.ts`. The contact form has no backend:
  it opens the visitor's email app (`buildMailto`).
- **Account creation** — the wizard's last step collects name, email and company in memory only, then
  links to the portal's `/signup` with the non-personal answers (`focus`, `products`, `businessType`,
  `teamSize`, `startMode`) in the query string. `focus` keeps the portal's `crm | wms | both` shape;
  `products` carries the full set, including `projects` and `pulse`. The portal does not read them yet.

- **Pulse screenshots**. Real product screenshots are pending until the Pulse app is finished. Until
  then the `/pulse` visuals are coded illustrations with sample data, like the other product pages. The
  slots are the visual components exported from `src/components/pulse/pulse-visuals.tsx`
  (`PulseHeroVisual`, `ProfitByJobVisual`, `DailyEntryVisual`, `PlanVsActualVisual`, `CostRatesVisual`,
  `RiskVisual`, `CsvVisual`, `PulseStackVisual`, `PulseBundleVisual`), each placed by
  `src/app/pulse/page.tsx`. When the captures exist, put them at the paths in
  `src/components/pulse/pulse-shots.ts` and set `ready: true` on that slot. `PulseShot` then shows the
  screenshot in place of the coded visual. The sample numbers in the coded visuals are illustrations, so
  check each screenshot against the copy beside it.
- **Pulse sign-in link**. The footer links to `LINKS.pulse` (`https://pulse.kitstak.app`). Check that
  origin answers before the site ships.

Product page copy describes only what `apps/wms`, `apps/crm` and `apps/projects` do today. Keep it that way.

## Pulse

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
- [ ] The owner has confirmed the Pulse price and unit (see "Placeholders to replace before launch").

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
pnpm --filter kitstak-web test    # pricing, wizard, contact, quick-add demo, Projects snapshot, Pulse placements
pnpm --filter kitstak-web sync:projects   # refresh src/generated/projects from apps/projects
```

Vercel project: `kitstak-website`, Root Directory `apps/web`.
