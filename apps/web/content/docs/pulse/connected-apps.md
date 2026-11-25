---
title: Connect CRM, WMS and Projects
description: See what Pulse reads from KitStak CRM, WMS and Projects, turn each feed on or off, run Sync now, and know that Pulse never changes their data.
section: Connected apps
order: 10
---

Pulse works on its own. If your workspace also runs KitStak CRM, WMS or Projects, Pulse reads what they know: won deals, work orders, kits built, parts used, warehouse bills and project time. Pulse only reads. It never changes your CRM, WMS or Projects data, and it keeps working if one of them is switched off.

## Before you start

- Connected apps are set up in the KitStak Portal. Pulse shows an app as connected when your plan includes it and it has data for this workspace. See [Getting started](/docs/getting-started).
- Changing the switches needs an admin or the owner.

## Open Connected apps

Go to **More > Settings** and open the **Connected apps** tab. Each app shows one status:

| Status | What it means |
| --- | --- |
| **Connected** | Pulse reads this app for your workspace. |
| **Not set up yet** | Your plan includes it, but it has no data for this workspace yet. Nothing is needed from you. |
| **Not on your plan** | Your workspace does not have this app. |

Under each app, **Comes into Pulse** lists what Pulse reads, with a switch where you can turn a feed off. The card also shows how many jobs are linked and what the last sync brought in.

## What Pulse reads from each app

### KitStak CRM

| What comes in | Switch |
| --- | --- |
| A won deal can become a job. Its name, account and value fill in the new job, and the value becomes the quote. | **Suggest jobs from won deals** |
| The stage of a linked deal shows on its job. | |

The **Won deal with no job** alert rule tells you about won deals that have no job yet. See [Set alert rules](/docs/pulse/alert-rules).

### KitStak WMS

| What comes in | Switch |
| --- | --- |
| Kits built on a linked work order come in as units for that day. You add the people and the hours. | |
| Parts a linked work order used come in as materials, at the cost the warehouse has for one part. | **Pull parts used** |
| Warehouse bills come in as billed amounts for each client. They show what was invoiced and never change profit. | **Pull warehouse bills** |
| The work order rate on the client's approved warehouse contract becomes the price of a linked job. | **Let warehouse contract rates set job prices** |
| A work order that is short of parts marks its job, so it shows up as at risk. | |

When a price is typed in Pulse, the job stops following the contract until the contract's rates change in the warehouse. Parts the client owns cost nothing in Pulse. Their use and scrap are still tracked.

### KitStak Projects

| What comes in | Switch |
| --- | --- |
| Time logged on a linked project comes in as labor hours for that day, costed with your own labor rate. | **Pull project time** |
| The status and progress of a linked project show on its job. | |

Project time costs money but stays out of pace, because it is not tied to units.

## When Pulse syncs

- A sync runs by itself every few minutes while Pulse is in use.
- Select **Sync now** to run it at once.
- A sync only adds what is new, so running it again never counts anything twice.
- Rows that would land in a closed month are left out and counted, for example "3 left out because the month is closed".

## Without connected apps

Nothing has to be connected. Every kind of data can come in from a spreadsheet instead. See [Import a CSV file](/docs/pulse/import-csv).

## Related

- [Link a job to a deal, work order or project](/docs/pulse/link-a-job)
- [Add a job](/docs/pulse/add-a-job)
- [Track materials and scrap](/docs/pulse/materials)
