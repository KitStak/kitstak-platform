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
  rest: the Pulse spec states no price and no unit, so both need the owner's sign-off.
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
  `src/app/pulse/page.tsx`. Swap a slot's contents for the light and dark captures when they exist.
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
