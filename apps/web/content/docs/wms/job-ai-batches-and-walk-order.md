---
title: AI job batches and walk ordering
description: How AI Job waves sort orders into single-item batches, identical-order batches and pick-and-pack jobs, and order each job's stops for a shorter walk.
section: Outbound
order: 80
---

An **AI job** wave allocates orders like a picking wave, then regroups them by shape and plans the route for each job. Single-unit orders are batched by where their stock sits, orders with the same content are picked together, and everything else is picked and packed one order per job. Each job's stops are then put in the order that keeps the walk short.

## Before you start

- At least one picking job type must exist in the warehouse. See [Picking job types and batch templates](/docs/wms/job-types-for-picking).
- Locations should have aisle, rack and bay values. Locations without them are placed by their walking path priority.

## Create an AI job wave

1. Go to **Automation > Wave Rules** and select **Create a new wave rule**.
2. Choose **AI job** (Jobs created by an AI Wave are optimized by AI).
3. Fill in the general settings, filters and order by as for any wave. See [Create and run wave rules](/docs/wms/wave-rules).
4. Under **Select job types**, check at least one picking job type. Orders are matched to the checked types from top to bottom and allocated with that type's algorithm.
5. Schedule the rule or select **Run**.

## How orders are grouped

| AI job type | Which orders | How many per job |
| --- | --- | --- |
| `AI-SingleItemBatchPick` | Orders with exactly one unit. | Batched by how close their pick locations are, up to the max per job. |
| `AI-IdenticalOrderBatchPick` | Orders with identical content: the same SKUs and quantities. | At least 2 identical orders, up to the max per job. |
| `AI-OrderBasedPickPack` | Every other order, including identical orders that end up alone. | One order per job, picked and packed together. |

The maximum per job comes from **Max orders per AI job** in the AI Jobs app under **Settings > Apps**. It accepts 1 to 500. When it is not set, the wave uses 20.

## How the walk is ordered

For each job, KitStak plans the pick stops on a walking distance model of the warehouse:

- Aisles are parallel. Moving between aisles goes through the front or back of the aisle, whichever is shorter.
- The route starts and ends at the front of the first aisle, where the pack and induction area sits.
- The stops are ordered nearest first, then improved by swapping legs that cross.
- The planned route is never longer than the plain walking path order it replaces.

## See the result

- While the wave works, its status moves through **Preparing For Optimization**, **Optimizing** and **Optimization Completed**. A toast reads **Still optimizing** if it takes a while, with a **View log** link.
- In **Job Management**, AI jobs show a sparkle icon next to the job type.
- Open a job and choose the **Pick path** tab. An **AI-optimized route** banner shows the number of stops, the walk in meters and the **Walking-path order** distance for comparison. When nothing could be shortened it reads **Already the shortest route**.

> **Note:** The pick path on non-AI jobs follows the job type's **Order by picking method**, usually **Walking path priority**.

## Related pages

- [Manage jobs in Job Management](/docs/wms/job-management)
- [Wave log and allocation exceptions](/docs/wms/wave-log-and-exceptions)
- [Create picking jobs from orders](/docs/wms/job-create-picking-jobs)
