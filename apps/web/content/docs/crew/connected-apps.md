---
title: How Crew connects to the other apps
description: What Crew is planned to send to and read from Pulse, Ledger, WMS, Projects and CRM, and who owns labor rates when you use Crew and Pulse together.
section: Connected apps
order: 10
---

> **Note:** Crew is planned and not available yet. This page describes how it is planned to work, and details may change before launch.

Crew is planned to work on its own, and to get more useful with each KitStak app you add. The apps share one account, so nothing moves by file between them.

## What Crew sends

| To | What goes across | What it does there |
| --- | --- | --- |
| [Pulse](/docs/pulse) | Approved paid hours per person, day, site and labor class, with overtime split per person per week | Replaces the time punch file. The payroll check and paid time not on any job fill in without typing. |
| [Pulse](/docs/pulse) | Job and area switches during a shift | Optional. Pulse can draft a day's labor hours from them. |
| [Ledger](/docs/ledger) | Approved hours per temp agency and week | Ledger checks the agency's bill. Agency billed 412 hours, Crew recorded 396. |
| [WMS](/docs/wms) | Who is on site and cleared for what | Task assignment can skip people who are not here or not certified. |
| [Projects](/docs/projects) | Time off and availability | Workload shows who is out. |

## What Crew reads

| From | What comes across | What Crew uses it for |
| --- | --- | --- |
| [Projects](/docs/projects) | Planned units per run and due dates from programs and builds | The labor plan: units divided by target pace gives hours needed. |
| [Pulse](/docs/pulse) | Target pace per job type and actual units per person per hour | The pace in the labor plan, and a check that the plan is realistic. |
| [WMS](/docs/wms) | Work orders, inbound receipts and order volume due | Hours needed for receiving, pick and pack and kit builds. |
| [CRM](/docs/crm) | Won deals with a start date | An early warning about people you will need. |

## Who owns the rate

Pulse already holds labor classes and the real cost of an hour for each one. With Crew and Pulse together:

- Crew gives each person a labor class.
- Crew reads the rate from Pulse when it needs a cost, like a temp estimate in the labor plan.
- Crew never keeps its own copy of the rate.

Without Pulse, Crew keeps a plain wage per person for its own estimates only. When you add Pulse, that wage moves into Pulse.

## Pulse hours from job switches

Whether a job switch in Crew writes labor hours into Pulse on its own, or only suggests them for a supervisor to approve, is still being decided.

## Related

- [Labor planning](/docs/crew/labor-planning)
- [Approve hours and send them to payroll](/docs/crew/approve-hours)
