---
title: Task details
description: Follow every picking, packing, sorting, count and replenishment task in KitStak WMS, with its status, assignee, source and target.
section: Tasks
order: 10
---

A task is one step of work: pick this SKU from this location, count this location, move this replenishment. Jobs group tasks, and counters, pickers and replenishers work through them on the floor. The **Task Details** pages show every task in real time: who has it, where it picks from and where it goes. Select tasks to execute, re-route or reassign them.

## Before you start

- You need the **View** permission on **Task Details**.
- To act on tasks you need **Execute Task**, **Update Task** or **Cancel Task** on **Task Details**. See [Execute, update and reassign tasks](/docs/wms/execute-tasks).

## Open task details

1. Go to **Fulfillment > Order Operations Task Details**, **Count Task Details** or **Replenishment Task Details**.
2. Or open any of them and switch tabs: **Order Operations**, **Count** and **Replenishment**.

Each page opens filtered to tasks whose job status is **Pending** or **Started**. Remove the filter chip to see closed tasks too.

## The three pages

| Page | What it lists | Actions |
| --- | --- | --- |
| **Order Operations** | Picking, packing, sorting and loading tasks of shipment orders and work orders. | **Task operations** (**Execute**, **Update**, **Cancel**) and **User actions** (**Assign**, **Unassign**) |
| **Count** | One row per location and SKU of each count task. A row opens its count plan. | **Cancel**, **Assign**, **Unassign** and **Recount** |
| **Replenishment** | Replenishment tasks with their phase, such as **Replenishment Pick Phase**, **Replenishment Put Phase** or **Direct Put**. | **Cancel task** |

Tasks of an AI job show an AI marker next to the job code with the AI job description.

## Task statuses

| Status | Meaning |
| --- | --- |
| **Pending** | Not started. Can be updated, assigned or cancelled. |
| **Started** | A user is working on it. Can still be executed or assigned. |
| **Completed** | Done. Can't change. |
| **Cancelled** | Stopped. Can't change. |

Task types are **Picking**, **Packing**, **Sorting**, **Loading**, **Count**, **Replenishment** and **Kitting**.

## Useful columns

| Page | Columns |
| --- | --- |
| **Order Operations** | **Wave ID**, **Task ID**, **Job code**, **Job type**, **Order code**, **PO number**, **Store order number**, **Task type**, **Task status**, **Pick short status**, **Pack short status**, **Task priority**, **Work order code**, **Task UOM qty**, **Actual qty**, **Planned qty**, **Channel**, **Carrier** and **Customer** |
| **Count** | **Task ID**, **Count plan**, **Source location**, **Task status**, **Job code**, **Job type**, **Initial task pack qty**, **Initial task UOM qty**, **Approved task UOM qty** and **Approved pack qty** |
| **Replenishment** | **Task ID**, **Job code**, **Task type**, **Task status**, **Replenishment phase**, **LP swap**, **Pack type conversion applied**, **Task qty**, **Task UOM qty**, **Target location**, **Target LPN** and **LP auto removed** |

Use **Columns** to show more, and **Export As Excel** to download the grid.

## When the page is empty

Tasks appear when a wave or a manual allocation creates jobs. The empty page offers **Run a wave rule** to create jobs and their tasks from open orders. Count tasks appear when you create count jobs. See [Create count jobs](/docs/wms/count-jobs).

## Related pages

- [Execute, update and reassign tasks](/docs/wms/execute-tasks)
- [Create count jobs](/docs/wms/count-jobs)
- [Update inventory from counts](/docs/wms/update-inventory-from-counts)
- [Use the dashboard](/docs/wms/dashboard)
