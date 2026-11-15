# kitstak-web

Marketing site for the KitStak platform, served at **https://kitstak.com**
(`www.kitstak.com` redirects to the apex). The portal is at `kitstak.app` and the product apps are on
`crm.` / `wms.` / `projects.kitstak.app` — see `src/components/site-links.ts`.

- Next.js 16 (App Router), fully static, no runtime dependencies beyond React.
- Design tokens come from `@kitstak/ui/styles/tokens.css` (shared with the apps).
- Logos in `public/brand` are the supplied artwork, with transparent padding trimmed by
  `scripts/prepare-brand.mjs`. Do not redraw them.
- Product pages for each app belong here as routes (`/wms`, `/crm`, `/projects`), not as separate sites.
- The stack is three licensable products (`PRODUCT_IDS` in `site-links.ts`, matching `@kitstak/entitlements`).
  A stack is any non-empty set of them; two or more take the bundle discount.

## Pages

| Route | What it is |
| --- | --- |
| `/` | Home |
| `/products` | Both products, the comparison, and the bundle price calculator (`#pricing`) |
| `/wms`, `/crm` | In-depth product pages. Copy lives in `src/components/{wms,crm}/*-content.ts` |
| `/projects` | KitStak Projects. Copy in `src/components/projects/projects-content.ts`; lists and counts come from the app (below) |
| `/get-started` | The "Set up your Stak" wizard (`src/components/wizard`, model in `src/lib/stak.ts`) |
| `/contact` | Contact and "talk to the founder" (`?topic=founder\|demo\|sales`) |

Every internal link goes through `ROUTES` in `src/components/site-links.ts`; the header menu, the
mobile drawer and the footer all read `src/components/nav/nav-data.ts`.

## Placeholders to replace before launch

- **Pricing** — `src/lib/pricing.ts` (`PRICING`, `PRICING_IS_PLACEHOLDER`). Stand-in numbers; every
  page and the wizard read from here.
- **Contact details** — `CONTACT` in `src/components/site-links.ts`. The contact form has no backend:
  it opens the visitor's email app (`buildMailto`).
- **Account creation** — the wizard's last step collects name, email and company in memory only, then
  links to the portal's `/signup` with the non-personal answers (`focus`, `products`, `businessType`,
  `teamSize`, `startMode`) in the query string. `focus` keeps the portal's `crm | wms | both` shape;
  `products` carries the full set, including `projects`. The portal does not read them yet.

Product page copy describes only what `apps/wms`, `apps/crm` and `apps/projects` do today. Keep it that way.

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
pnpm --filter kitstak-web test    # pricing, wizard, contact, quick-add demo, Projects snapshot
pnpm --filter kitstak-web sync:projects   # refresh src/generated/projects from apps/projects
```

Vercel project: `kitstak-website`, Root Directory `apps/web`.
