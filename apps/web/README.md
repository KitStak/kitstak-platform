# kitstak-web

Marketing site for the KitStak platform, served at **https://kitstak.com**
(`www.kitstak.com` redirects to the apex). The portal is at `kitstak.app` and the product apps are on
`crm.` / `wms.kitstak.app` — see `src/components/site-links.ts`.

- Next.js 16 (App Router), fully static, no runtime dependencies beyond React.
- Design tokens come from `@kitstak/ui/styles/tokens.css` (shared with the apps).
- Logos in `public/brand` are the supplied artwork, with transparent padding trimmed by
  `scripts/prepare-brand.mjs`. Do not redraw them.
- Product pages for each app belong here as routes (`/wms`, `/crm`), not as separate sites.

## Pages

| Route | What it is |
| --- | --- |
| `/` | Home |
| `/products` | Both products, the comparison, and the bundle price calculator (`#pricing`) |
| `/wms`, `/crm` | In-depth product pages. Copy lives in `src/components/{wms,crm}/*-content.ts` |
| `/projects` | Preview page for KitStak Projects, which is in development. Copy in `src/components/projects/projects-content.ts` |
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
  links to the portal's `/signup` with the non-personal answers (`focus`, `businessType`, `teamSize`,
  `startMode`) in the query string. The portal does not read them yet.

Product page copy describes only what `apps/wms` and `apps/crm` do today. Keep it that way.

```bash
pnpm --filter kitstak-web dev     # http://localhost:3400
pnpm --filter kitstak-web build
pnpm --filter kitstak-web test    # pricing, wizard and contact models
```

Vercel project: `kitstak-website`, Root Directory `apps/web`.
