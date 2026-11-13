<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## KitStak Projects rules

- Read `docs/projects/SPEC.md` and `docs/projects/CONTRACTS.md` first. Contracts are authoritative for folder ownership.
- Data access goes through `src/server/domain/*` (permission checks + activity log + notifications). Never query `pm.*` from components or routes directly.
- Mutations: server actions in `src/server/actions/*` (return `ActionResult`). Reads for client components: `/api/v1/*` via hooks in `src/lib/hooks/use-data.ts`.
- Schema changes: add a new `drizzle/000N_*.sql` + journal entry + mirror in `src/server/db/schema`. Applied migrations are immutable. Never `drizzle-kit push`.
- Visual language = Portal/CRM: tokens from `@kitstak/ui`, primitives from `@/components/ui`, Projects building blocks from `@/components/pm`.
- Client components import other client components by file path, not through a feature `index.ts` (indexes may export server pages).
- Plain language everywhere (8th-grade reading level). No placeholders, TODOs or dead buttons.
