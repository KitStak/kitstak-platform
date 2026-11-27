<p align="center">
  <a href="https://kitstak.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/brand/kitstak-lockup-cream.png">
      <img src="apps/web/public/brand/kitstak-lockup-navy.png" alt="KitStak" width="280">
    </picture>
  </a>
</p>

<h3 align="center">Put the whole operation on one stack.</h3>

<p align="center">
  CRM, WMS, Projects and Pulse for kitting, 3PL and contract packaging shops.<br>
  One database, one sign-in, and you only pay for the apps you use.
</p>

<p align="center">
  <a href="https://kitstak.com"><b>Website</b></a> ·
  <a href="https://kitstak.com/products">Products</a> ·
  <a href="https://kitstak.com/pricing">Pricing</a> ·
  <a href="https://kitstak.com/get-started">Get started</a> ·
  <a href="https://kitstak.com/contact">Contact</a>
</p>

<p align="center">
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-149ECA?style=flat-square&logo=react&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-Supabase-4169E1?style=flat-square&logo=postgresql&logoColor=white">
  <img alt="Turborepo" src="https://img.shields.io/badge/Turborepo-pnpm-EF4444?style=flat-square&logo=turborepo&logoColor=white">
  <img alt="Deployed on Vercel" src="https://img.shields.io/badge/Deployed%20on-Vercel-000000?style=flat-square&logo=vercel&logoColor=white">
</p>

<p align="center">
  <a href="https://kitstak.com">
    <img src=".github/assets/hero.webp" alt="The KitStak home page: a won deal in the CRM becomes an order the warehouse allocates, picks, packs and ships" width="100%">
  </a>
</p>

## Why KitStak

Sales is in one tool, the floor in another, and project work in a spreadsheet. In most kitting and
3PL shops nobody knows which jobs made money until the books close.

KitStak keeps all of it in one place. A won deal turns into the order, the project and the job, and
nobody types a customer, an item or an order number twice.

Each app also works on its own. Start with the WMS, add the CRM next quarter, and your clients are
already there.

## The apps

| App                                                                                                                           | What it does                                                                                                                                                                                         | Lives in                         |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| <img src="apps/web/public/brand/apps/kitstak-icon-warehouse.svg" width="32" height="32" alt="" align="absmiddle"> **WMS**     | Receiving, inventory, orders, picking, packing, shipping and returns. Per-client catalogs, kits, work orders, cycle counts and billing. Every organization gets its own warehouse in its own schema. | [`apps/wms`](apps/wms)           |
| <img src="apps/web/public/brand/apps/kitstak-icon-crm.svg" width="32" height="32" alt="" align="absmiddle"> **CRM**           | Accounts, leads and deals on boards your team shapes. Automations for the follow-ups, dashboards for the reporting.                                                                                  | [`apps/crm`](apps/crm)           |
| <img src="apps/web/public/brand/apps/kitstak-icon-projects.svg" width="32" height="32" alt="" align="absmiddle"> **Projects** | Tasks, timelines and workload for the work between a deal and a delivery. Six views, cycles, goals and templates.                                                                                    | [`apps/projects`](apps/projects) |
| <img src="apps/web/public/brand/apps/kitstak-icon-pulse.svg" width="32" height="32" alt="" align="absmiddle"> **Pulse**       | Profit by job, job type, client and extra service. Log units and hours each day and see which open jobs are losing money, and why.                                                                   | [`apps/pulse`](apps/pulse)       |
| <img src="apps/web/public/brand/apps/kitstak-icon-portal.svg" width="32" height="32" alt="" align="absmiddle"> **Portal**     | The front door: sign-in, the app launcher, billing and organization settings.                                                                                                                        | [`apps/portal`](apps/portal)     |

The marketing site at [kitstak.com](https://kitstak.com) lives in [`apps/web`](apps/web).

## How the apps work together

When two or more apps are on the same account they link up on their own:

- **A won deal can become an order.** The account and the items come across from the CRM to the WMS.
- **The delivery project starts itself.** Winning a deal can open a project, and order numbers in a task turn into links.
- **Problems on the floor become tasks.** Each one gets an owner and a due date, and links back to the receipt, order or count it came from.
- **Work orders feed job profit.** Kits built on a work order land in Pulse as units for that day, and time logged in Projects can count as labor hours.
- **Job profit shows up everywhere.** The deal, the work order and the project each show what the job earned.

Under the hood it looks like this:

```mermaid
flowchart TB
  subgraph apps [Five apps, each deployed on its own]
    direction LR
    portal[Portal] ~~~ crm[CRM] ~~~ wms[WMS] ~~~ projects[Projects] ~~~ pulse[Pulse]
  end

  subgraph shared [Shared packages]
    direction LR
    auth["auth<br/>one session"] ~~~ ent["entitlements<br/>who has which app"] ~~~ bridges["pm-bridge, pulse-bridge<br/>reads across apps"] ~~~ ui["ui<br/>tokens, icons, switcher"]
  end

  subgraph db [One Postgres database]
    direction LR
    core[(core)] ~~~ crmdb[(crm)] ~~~ wmsdb[(wms, one per org)] ~~~ pm[(pm)] ~~~ pulsedb[(pulse)]
  end

  apps --> shared
  shared -->|"core, pm, pulse"| db
  apps -->|"each app's own schema"| db
```

Sign-in is [Better Auth](https://www.better-auth.com), with one session cookie shared by every app.

`core` holds organizations, users, customers, items and entitlements. Each app keeps its own data in
its own schema, and the WMS goes a step further and gives every organization a schema of its own.

`@kitstak/entitlements` decides which organization can open which app. Billing runs through Stripe in
`@kitstak/billing`, and two or more apps get the bundle discount.

Apps read each other's tables through two small bridge packages, so no app calls another over HTTP.

## A look inside

<table>
  <tr>
    <td width="50%"><a href="https://kitstak.com/wms"><img src=".github/assets/wms.webp" alt="KitStak WMS"></a><p align="center"><b>WMS</b> · Dock. Shelf. Door.</p></td>
    <td width="50%"><a href="https://kitstak.com/crm"><img src=".github/assets/crm.webp" alt="KitStak CRM"></a><p align="center"><b>CRM</b> · Track it. Chase it. Close it.</p></td>
  </tr>
  <tr>
    <td width="50%"><a href="https://kitstak.com/projects"><img src=".github/assets/projects.webp" alt="KitStak Projects"></a><p align="center"><b>Projects</b> · Plan it. Run it. Land it.</p></td>
    <td width="50%">
      <a href="https://kitstak.com/pulse">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/pulse/shots/home-desktop-dark-1200.webp">
          <img src="apps/web/public/pulse/shots/home-desktop-light-1200.webp" alt="The KitStak Pulse home screen: revenue, cost and profit on jobs this month">
        </picture>
      </a>
      <p align="center"><b>Pulse</b> · Know which jobs make money.</p>
    </td>
  </tr>
</table>

## Built with

| Layer         | What we use                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| App framework | [Next.js 16](https://nextjs.org) (App Router, Turbopack) and React 19                                       |
| Language      | TypeScript, strict everywhere                                                                               |
| Data          | PostgreSQL on [Supabase](https://supabase.com), [Drizzle ORM](https://orm.drizzle.team), Zod for validation |
| Auth          | [Better Auth](https://www.better-auth.com), one session across all apps                                     |
| Billing       | [Stripe](https://stripe.com) subscriptions, one price catalog shared by the site, sign-up and billing       |
| Email         | [Resend](https://resend.com) through `@kitstak/mail`                                                        |
| UI            | Tailwind CSS 4, Radix, TanStack Table and Query, Recharts                                                   |
| Testing       | Vitest and Playwright, plus axe accessibility checks in the WMS                                             |
| Monorepo      | [Turborepo](https://turborepo.com) and pnpm workspaces                                                      |
| Hosting       | [Vercel](https://vercel.com), one project per app                                                           |

## Running it locally

You need **Node 22.12 or newer** (see `.nvmrc`) and **pnpm 10**. You don't need Docker. The CRM ships
an embedded Postgres that every app can share in development.

```bash
git clone https://github.com/KitStak/kitstak-platform.git
cd kitstak-platform
pnpm install
```

Copy the example env files for the apps that have one. Then set two variables in your shell, which
every migration, seed and dev server reads. `BETTER_AUTH_SECRET` has to be the same for every app,
because they share one session cookie.

```bash
cp apps/crm/.env.example apps/crm/.env.local
cp apps/portal/.env.example apps/portal/.env.local
cp apps/wms/.env.example apps/wms/.env.local

export DATABASE_URL=postgres://postgres:postgres@localhost:5544/kitstak
export BETTER_AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
```

On Windows PowerShell, use `$env:DATABASE_URL = "..."` and `$env:BETTER_AUTH_SECRET = "..."` instead.
If you'd rather not export them each time, put both lines in each app's `.env.local`.

Start the database, then migrate in this order. `core` comes first and Pulse comes last, because
the later apps read tables the earlier ones create.

```bash
pnpm --filter kitstak-crm db:start         # embedded Postgres on :5544, safe to run twice

pnpm --filter @kitstak/db db:migrate       # core: orgs, users, customers, items, entitlements
pnpm --filter kitstak-crm db:migrate
pnpm --filter kitstak-wms db:migrate
pnpm --filter kitstak-projects db:migrate
pnpm --filter kitstak-pulse db:migrate
```

Seed whichever apps you want to click around in, then start them:

```bash
pnpm --filter kitstak-crm db:seed
pnpm --filter kitstak-wms db:seed
pnpm --filter kitstak-projects db:seed
pnpm --filter kitstak-pulse db:seed        # the biggest demo, give it a moment

pnpm dev                                   # every app at once
```

| App      | Command             | URL                   |
| -------- | ------------------- | --------------------- |
| Portal   | `pnpm dev:portal`   | http://localhost:3300 |
| CRM      | `pnpm dev:crm`      | http://localhost:3100 |
| WMS      | `pnpm dev:wms`      | http://localhost:3000 |
| Projects | `pnpm dev:projects` | http://localhost:3400 |
| Pulse    | `pnpm dev:pulse`    | http://localhost:3500 |
| Website  | `pnpm dev:web`      | http://localhost:3600 |

Most app READMEs list their demo logins and the scripts only that app has.

### Everyday commands

```bash
pnpm typecheck      # tsc in every app and package
pnpm lint           # ESLint
pnpm test           # Vitest
pnpm build          # production builds
pnpm format         # Prettier
```

To run one app's checks, filter by its package name, for example `pnpm --filter kitstak-wms test`.

## What's in the repo

```
apps/
  portal/          sign-in, launcher, billing, organization settings
  crm/             accounts, deals, boards, automations
  wms/             receiving, inventory, orders, shipping, returns
  projects/        tasks, timelines, workload
  pulse/           profit by job, client and service
  web/             kitstak.com
packages/
  auth/            Better Auth setup shared by every app
  billing/         price catalog, quotes, Stripe, plan state, billing email
  db/              the core schema and its migrations
  entitlements/    which organization has which app
  mail/            platform email through Resend
  pm-bridge/       read and link Projects data from the other apps
  pulse-bridge/    read and link Pulse job profit from the other apps
  ui/              design tokens, logos, app icons, the app switcher
  config/          shared tsconfig and Vitest presets
docs/              specs, contracts and runbooks (see below)
deploy/            env sync and deploy helpers
```

More on each package in [`packages/README.md`](packages/README.md).

## Docs

| Topic                                       | Where                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| How the apps share auth, data and licensing | [`docs/integration/BLUEPRINT.md`](docs/integration/BLUEPRINT.md)                                         |
| Onboarding and demo workspaces              | [`docs/integration/ONBOARDING.md`](docs/integration/ONBOARDING.md)                                       |
| Sign-up, trials and billing                 | [`docs/billing/SPEC.md`](docs/billing/SPEC.md), [`docs/billing/CONTRACTS.md`](docs/billing/CONTRACTS.md) |
| Projects                                    | [`docs/projects/SPEC.md`](docs/projects/SPEC.md)                                                         |
| Pulse                                       | [`docs/pulse/SPEC.md`](docs/pulse/SPEC.md)                                                               |
| WMS multi-tenancy                           | [`apps/wms/docs/MULTI_TENANCY.md`](apps/wms/docs/MULTI_TENANCY.md)                                       |
| Deploying to Vercel                         | [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)                                                               |

## Security

If you find a security problem, please email **hello@kitstak.com** with "Security" in the subject
instead of opening a public issue. See [`SECURITY.md`](SECURITY.md) for what to include and what
happens next.

## History

The CRM and the WMS started as separate repos, [KitStak/KitStakCRM](https://github.com/KitStak/KitStakCRM)
and [KitStak/KitStakWMS](https://github.com/KitStak/KitStakWMS). Both were brought in with
`git subtree`, so their full commit history is still here.

## License

Copyright © 2026 KitStak. All rights reserved.

The code is public so you can read it. It isn't open source, and no license to use, copy, modify or
redistribute it is granted. If you'd like to run KitStak, [start a free trial](https://kitstak.com/get-started)
or [get in touch](https://kitstak.com/contact).
