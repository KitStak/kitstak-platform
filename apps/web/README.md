# kitstak-web

Marketing site for the KitStak platform, served at **https://kitstak.com**
(`www.kitstak.com` redirects to the apex). The product apps stay on
`app.` / `crm.` / `wms.kitstak.app` — see `src/components/site-links.ts`.

- Next.js 16 (App Router), fully static, no runtime dependencies beyond React.
- Design tokens come from `@kitstak/ui/styles/tokens.css` (shared with the apps).
- Logos in `public/brand` are the supplied artwork, with transparent padding trimmed by
  `scripts/prepare-brand.mjs`. Do not redraw them.
- Product pages for each app belong here as routes (`/wms`, `/crm`), not as separate sites.

```bash
pnpm --filter kitstak-web dev     # http://localhost:3400
pnpm --filter kitstak-web build
```

Vercel project: `kitstak-website`, Root Directory `apps/web`.
