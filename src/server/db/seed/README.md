# Seed data

`npm run db:seed` runs `index.ts`. It refuses to run when `NODE_ENV=production`.

- **Idempotent:** each run deletes the demo org (`northwind-robotics`) and the eight demo users,
  then recreates them. Other organizations are never touched.
- **Deterministic:** content comes from a fixed-seed RNG (`rng.ts`). Dates are relative to the
  day the seed runs, so "This quarter", upcoming activities and renewals stay realistic.

## Demo login (development only)

All demo users share the password `Northwind-Demo-2026!` (defined as `DEMO_PASSWORD` in `index.ts`).

Demo admin (used by the e2e and screenshot harness):

- Email: `maya@northwind-robotics.example`
- Password: `Northwind-Demo-2026!`

| User                   | Email                               | Org role | Notes                                              |
| ---------------------- | ----------------------------------- | -------- | -------------------------------------------------- |
| Maya Chen (demo admin) | `maya@northwind-robotics.example`   | owner    | VP of Sales; has notifications, favorites, recents |
| Daniel Okafor          | `daniel@northwind-robotics.example` | admin    | Enterprise AE                                      |
| Sofia Ramirez          | `sofia@northwind-robotics.example`  | member   | Mid-Market AE                                      |
| Liam Patel             | `liam@northwind-robotics.example`   | member   | SDR (owns most leads)                              |
| Hannah Müller          | `hannah@northwind-robotics.example` | member   | Customer Success Manager                           |
| Ethan Brooks           | `ethan@northwind-robotics.example`  | member   | Solutions Engineer                                 |
| Aisha Rahman           | `aisha@northwind-robotics.example`  | viewer   | RevOps (read and comment only)                     |
| Lucas Silva            | `lucas@northwind-robotics.example`  | guest    | Channel partner; sees the Leads board only         |

These credentials must never appear in UI code.

## What gets created

- **Teams:** Enterprise Sales, Mid-Market Sales, Customer Success, Revenue Operations.
- **Workspace "Sales CRM"**, with a Sales Dashboard of 9 widgets:
  - Folder **Pipeline**:
    - **Leads**: 220 leads.
    - **Deals**: 164 deals across the stages Lead, Discovery, Proposal, Negotiation, Won and Lost. Each has a weighted forecast formula, a timeline, and connected account and contacts.
  - Folder **Relationships**:
    - **Accounts**: 60 accounts with ARR, region and health, plus a mirror column summing their pipeline value.
    - **Contacts**: 120 contacts.
  - At the workspace root, **Activities**: 180 calls, meetings, emails and demos, connected to deals and contacts.
- **Workspace "Customer Success"**:
  - **Customer onboarding**: 24 projects with 132 subitem tasks.
  - **Renewals**: 35 renewals.
- **Views per board** come from the templates (`src/server/services/templates/crm.ts`). The Deals board, for example, has a Main table, a Pipeline kanban, a Close dates calendar, a Pipeline by stage chart, a Forecast table and a Deal timeline.
- **Collaboration:**
  - About 200 update threads with replies, reactions, read receipts and @mentions.
  - An activity-log history that includes deal stage changes.
  - 45 notifications.
  - 6 automations, with run history for "Celebrate and file won deals".
  - One pending invitation.

The counts above come from the current seed and change only if the generator changes.
