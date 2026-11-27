---
title: How records link across apps
description: Link CRM deals, WMS orders and work orders, Projects work, Programs and Pulse jobs, so each app shows what the others know.
section: How the apps connect
order: 10
---

Every KitStak app works on its own. When your plan has more than one, their records can link, so the same customer, deal or order is not typed twice and each app shows what the others know. A link never moves or copies the other record. Each app keeps its own data and reads the linked record from the app that owns it.

## Before you start

- Both apps are on your plan. If one is not, the place to link it shows a way to add it, or who to ask. See [App access](/docs/getting-started/app-access).
- You are in the same organization in both apps. Links only reach records of your own organization.

## What can link to what

| From | To | What you get |
| --- | --- | --- |
| CRM deal | Projects | Start a project from a deal, link tasks and projects to deals and accounts, and see the deal's stage on the task. |
| CRM deal | Projects program | A won deal can start a program for recurring work for one customer. |
| CRM deal | Pulse job | A won deal can become a job. Its name, account and value fill in the job, and the value becomes the quote. |
| WMS order and work order | Projects | Link tasks to orders, work orders, receipts and counts, and see order status on the task. |
| WMS work order | Pulse job | Kits built on a linked work order come in as units for that day. Parts it used come in as materials. |
| Projects project | Pulse job | Time logged on a linked project comes in as labor hours for that day. |
| Projects program | Pulse job | A program can bill to one Pulse job, so its output and fees show up in Pulse. |

## Projects and the CRM

In Projects, the CRM card in the integrations settings lists what the link does:

- **Link tasks and projects to deals and accounts**
- **Start a project from a deal with one click**
- **See the deal’s stage right on the task**
- **Automations that run when a deal changes stage**

Projects automations include **Start a project when a deal is won** and **Start a program when a deal is won**. See the [Projects docs](/docs/projects).

## Projects and the WMS

The WMS card in Projects lists:

- **Link tasks to orders, work orders, receipts and counts**
- **See order status on the task**
- **Automations that run when an order ships**
- **Warehouse go-live and client onboarding templates**

The card counts **Linked orders**, **Linked work orders**, **Linked receipts** and **Linked counts**.

## Pulse and the other apps

Pulse reads the apps you connect and turns their records into job profit. Its connected apps screen shows each app as **Connected**, **Not set up yet** or **Not on your plan**.

- Deals and accounts get a **Profit** tab with the revenue, cost, profit and margin of their jobs.
- Work orders get a **Job profit** card, and WMS clients get a **Client profit** line.
- A project's overview shows **Job profit** for the jobs linked to it.
- The stage of a linked deal shows on its job. When the deal value changes in the CRM, the job tells you the quote is different.
- A work order that is short of parts marks its job, so it shows up as at risk.

Pulse only reads connected apps for your own workspace, and keeps working if one of them is switched off. A sync also runs by itself every few minutes while Pulse is in use, and **Sync now** runs one at once. Running it again never counts anything twice. See the [Pulse docs](/docs/pulse).

## Programs

A program is ongoing work for one customer under one price card, kept in Projects. For example, a kitting program builds a set of kits every weekday. Each day's builds roll up into the one program.

- A program can belong to a customer or a CRM account, and can start from a won CRM deal.
- A program can bill to one Pulse job, and a Pulse job takes revenue from at most one program. Pulse then shows labor, cost and margin for the program.
- A program's kits can link to WMS kit products. The WMS stays read only: a build never creates a WMS work order or moves stock.

## Set up links with the setup guide

The Portal setup guide has steps that lead to the right screen:

| Step | What it asks |
| --- | --- |
| **Connect work to a deal or order** | Link a project or task to a CRM deal or WMS order. |
| **Link a job to a deal or work order** | Link a Pulse job to a CRM deal or WMS work order. Offered when CRM or WMS is also on your plan. |

See [Welcome screen and setup guide](/docs/getting-started/welcome-and-setup-guide).

## Rules for links

- Each record works alone. A project with no deal, or a Pulse job with no program, is fine.
- Deleting a record in one app never deletes the record it links to.
- If a linked record is deleted in its own app, Projects shows **This record is no longer available** on the link.
- Each person still sees only what their role allows in each app.

## Related pages

- [What KitStak is and how the apps fit together](/docs/getting-started/what-is-kitstak)
- [Switch between apps with one sign in](/docs/getting-started/switch-apps)
- [App access: not in your plan and view only](/docs/getting-started/app-access)
