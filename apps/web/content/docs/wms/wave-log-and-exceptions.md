---
title: Wave log and allocation exceptions
description: Check what each wave run selected, allocated and created in the Wave Log Report, find why orders were not allocated, and retry allocation for them.
section: Automation
order: 30
---

Every wave run leaves a record. The **Wave Log Report** shows one row per run with how many orders met the rule, how many were allocated or short, and how many jobs it created. **Allocation exceptions** shows one row per order line that was not allocated or not put into a job, with the reason, so you can fix the cause and retry.

## Before you start

- You need the Wave Log Report and Allocation Exceptions view permissions.
- Both pages are tabs on **Fulfillment > Job Management**, and items under **Reports**.

## Read the Wave Log Report

1. Go to **Reports > Wave Log Report**.
2. Search by wave number, or filter by **Rule set**, **Run date**, **Status**, **Warehouse** or **Run by**.

| Column | What it shows |
| --- | --- |
| **Rule set** | The wave rule that ran. |
| **Wave no** | Select it to see the wave's jobs. |
| **Wave status** | The run status. |
| **Message** | Why a failed wave failed. |
| **Run date** | When the wave ran. |
| **# met** | Orders that met the rule set criteria. |
| **# allocated** | Orders allocated. |
| **# shortage** | Orders left short. |
| **# eliminated** | Orders no job type matched. # met equals # allocated plus # shortage plus # eliminated. |
| **# jobs** | Jobs created. |
| **# merged** | Merged orders created, for order merge waves. |
| **Run by** | The user, or "Integration" for scheduled runs. |

## Wave statuses

| Status | Meaning |
| --- | --- |
| **Pending** | The wave is queued. |
| **Preparing For Optimization**, **Optimizing**, **Optimization Completed** | AI job waves only, while the jobs are regrouped and routed. |
| **Started** and **In Progress** | The wave is running. |
| **Completed** | The wave finished. |
| **Failed** | The wave stopped. See **Message**. |

## Read Allocation exceptions

1. Go to **Reports > Allocation Exceptions**.
2. Search by wave number, or filter by order, client, warehouse or run date.

| Column | What it shows |
| --- | --- |
| **Order code** | The order that was not allocated. |
| **Wave no** | The wave ID, or "Manual Allocation" when allocated from the order screens. |
| **Explanation** | Why the order was not allocated or put into a job. |
| **Shortage SKU** | The SKU that could not be allocated. |
| **Inventory UOM qty** | Free stock found for the SKU when the wave ran. |
| **Order line qty (UOM)** | Quantity the order line asked for. |
| **Wave rule set name** and **Allocation algorithm rule name** | The rule set and the algorithm rule that applied. |
| **Allocation algorithm** | The algorithm used. |
| **Is rollbacked?** | The allocation was rolled back after the wave. |

Common explanations:

| Explanation | What to do |
| --- | --- |
| **Shortage** | Not enough eligible stock. Receive or move stock, then retry. |
| **Order bypassed: All items are currently out of stock** | Nothing was allocated. Wait for stock. |
| **Eliminated by** followed by rule names and **Condition(s)** | The named conditions excluded the order. Check those rules in the algorithm or job types. |

## Retry allocation

1. Select the rows.
2. Select **Retry allocation**. The button shows how many orders it will try.

Orders that now find stock are allocated. When nothing is listed, the page reads **No allocation exceptions**: every order your waves selected was allocated and put into a job.

## Related pages

- [Create and run wave rules](/docs/wms/wave-rules)
- [Allocation algorithms and dry run](/docs/wms/allocation-algorithms)
- [Shortages and backorders](/docs/wms/order-shortages-and-backorders)
