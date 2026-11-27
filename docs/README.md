# KitStak docs

Every doc in this folder, what it is for, and whether it still describes the code. Site docs for customers live
elsewhere, in `apps/web/content/docs/`. App-only notes live in each app, for example `apps/wms/docs/`.

**Status words**

- **Live**: describes how the code works today. When the code and the doc disagree, fix one of them.
- **Built**: the spec the code was built from. Still the best map of the app, but newer changes may not be in it.
- **Approved**: agreed and ready to build, or being built.
- **Plan**: an idea written down. Nothing is agreed yet.
- **Reference**: background for a future decision. Not a spec.
- **Historical**: kept for the reasoning. Parts are out of date.

## Platform

| Doc                                                                        | What it is                                                                                   | Status     |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------- |
| [`DEPLOYMENT.md`](DEPLOYMENT.md)                                           | The six Vercel projects, domains, env vars and how to deploy                                 | Live       |
| [`integration/BLUEPRINT.md`](integration/BLUEPRINT.md)                     | The original plan to merge CRM and WMS: shared auth, the `core` schema, entitlements         | Historical |
| [`integration/ONBOARDING.md`](integration/ONBOARDING.md)                   | Guided onboarding across Portal, CRM and WMS, backed by `core.onboarding_progress`           | Live       |
| [`design/UI-CLEANUP.md`](design/UI-CLEANUP.md)                             | One dashboard layout and set of pieces for every app's home screen (`@kitstak/ui/dashboard`) | Live       |
| [`security/auth-review-2026-11-11.md`](security/auth-review-2026-11-11.md) | Auth security review of the merge, phases 3 and 4                                            | Historical |

## Signup and billing

Read in this order: `DECISIONS.md`, `SPEC.md`, `CONTRACTS.md`.

| Doc                                                                  | What it is                                                              | Status     |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------- |
| [`billing/DECISIONS.md`](billing/DECISIONS.md)                       | Owner decisions on pricing and billing. They override everything else   | Live       |
| [`billing/SPEC.md`](billing/SPEC.md)                                 | Signup, trials, billing and plan state: what a person sees              | Built      |
| [`billing/CONTRACTS.md`](billing/CONTRACTS.md)                       | Names, types, routes and tables every part of billing shares            | Built      |
| [`billing/DEV.md`](billing/DEV.md)                                   | Run signup and billing locally and take screenshots                     | Live       |
| [`billing/TESTING.md`](billing/TESTING.md)                           | How billing is tested: unit, database and browser                       | Live       |
| [`billing/GO-LIVE.md`](billing/GO-LIVE.md)                           | Runbook for turning on real billing, step by step                       | Live       |
| [`billing/STRIPE-SANDBOX-RUN.md`](billing/STRIPE-SANDBOX-RUN.md)     | Record of the first run against real Stripe (2026-11-24) and what broke | Historical |
| [`billing/research/CODEMAP.md`](billing/research/CODEMAP.md)         | Map of the code before the billing work (commit `31058fe`)              | Historical |
| [`billing/research/COMPETITORS.md`](billing/research/COMPETITORS.md) | Teardown of the best signup and billing flows                           | Reference  |

## Apps

| Doc                                                                                | What it is                                                                                 | Status    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------- |
| [`projects/SPEC.md`](projects/SPEC.md)                                             | Projects: product and build spec                                                           | Built     |
| [`projects/CONTRACTS.md`](projects/CONTRACTS.md)                                   | Projects: team contracts                                                                   | Built     |
| [`pulse/SPEC.md`](pulse/SPEC.md)                                                   | Pulse: product and build spec, including the cost model                                    | Built     |
| [`pulse/CONTRACTS.md`](pulse/CONTRACTS.md)                                         | Pulse: team contracts and the fix rounds                                                   | Built     |
| [`pulse/research/competitors.md`](pulse/research/competitors.md)                   | Pulse competitive research                                                                 | Reference |
| [`programs/SPEC.md`](programs/SPEC.md)                                             | Programs (recurring work under one price card) across Projects, Pulse, CRM, WMS and Portal | Built     |
| [`programs/PULSE_PROGRAMS_SPEC.md`](programs/PULSE_PROGRAMS_SPEC.md)               | How Pulse tracks programs. Wins over `programs/SPEC.md` for Pulse                          | Built     |
| [`programs/PROGRAM_TYPES_SPEC.md`](programs/PROGRAM_TYPES_SPEC.md)                 | Program types: kitting, ecommerce, production and other                                    | Approved  |
| [`programs/pulse-tracker-money-check.sql`](programs/pulse-tracker-money-check.sql) | Read only SQL to compare program money before and after a deploy                           | Live      |

## Plans and future apps

| Doc                                                                            | What it is                                                                                 | Status    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------- |
| [`onboarding/SHARED-ONBOARDING-PLAN.md`](onboarding/SHARED-ONBOARDING-PLAN.md) | One onboarding engine for CRM, WMS and Pulse, modeled on Projects                          | Plan      |
| [`search/MASTER-SEARCH-PLAN.md`](search/MASTER-SEARCH-PLAN.md)                 | One Portal search across every app                                                         | Plan      |
| [`ledger/REFERENCE.md`](ledger/REFERENCE.md)                                   | KitStak \| Ledger: invoices, collections, bills, expenses, reconciliation, month-end close | Reference |
| [`crew/REFERENCE.md`](crew/REFERENCE.md)                                       | KitStak \| Crew: people, shifts, time clock, attendance, skills, labor planning            | Reference |

## Archive

Raw reviewer output from the build rounds. The findings are already folded into the specs and contracts above.

| Folder                                                 | What it is                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [`archive/pulse-reviews/`](archive/pulse-reviews/)     | Pulse critic rounds 1 to 5 (JSON)                                               |
| [`archive/billing-reviews/`](archive/billing-reviews/) | Billing critic rounds 1 to 5, reviewer verdicts and the round 4 security review |
