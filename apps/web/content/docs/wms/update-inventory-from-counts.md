---
title: Update inventory from counts
description: Review count variances in KitStak WMS, post them to inventory with Update Inv., create recounts, and cancel count lines or plans.
section: Counts
order: 60
---

A submitted count does not change stock by itself. You review the differences between counted and system quantities, then post them with **Update Inv.**, recount the lines you doubt, or cancel what you don't want to post. Every posting writes Count transactions to the ledger with a reason.

## Before you start

- **Update Inv.** needs the **Update Inv.** permission on **Count Plans**, or on **Count Location Details** or **Count SKU Details** for single lines.
- **Create Recount** needs the **Create Recount** permission on **Count Location Details** or **Count SKU Details**.
- Adjustment reasons come from your company's adjustment reason list.

## Review the variance

1. Go to **Inventory > Count Plan** and open the plan.
2. Read the summary: **Counted**, **Counted vs system**, **Unit variance** and **Exact lines**.
3. On the **Lines** tab, compare **System**, **Counted** and **Diff** for each line.

Across plans, **Inventory > Count Location Details** and **Inventory > Count SKU Details** show **Initial Stock Qty**, **Counted Qty**, **Approved Count Qty** and **% Difference** per line.

## Post the counts

1. Open the plan and select **Update Inv.** Or select lines in **Count Completed** status on the **Lines** tab or a details page and select **Update Inv.**
2. In **Update inventory from counts**, check the units added, the units removed and the lines with no difference, plus each line's **System**, **Counted** and **Difference**.
3. Choose the **Adjustment reason**.
4. Add a **Note** if you want. It is shown on the Count transactions.
5. Select **Proceed**.

Posted lines become **Inventory Updated**. When every line is posted, the plan becomes **Inventory Updated** and is locked for the audit trail. Lines with no difference are marked **Inventory Updated** without stock changes.

## When a count is below allocated stock

- **Committed to orders.** The ledger never takes stock below what is picked, in a pick job or reserved for a work order. Such lines can't post. Tick **Close this line without posting**, or **Close these 3 lines without posting** with your count, to close them with your reason on the timeline, or short the order first and recount. If nothing else can post, the button reads **Close without posting** and the plan closes as **Cancelled**.
- **Allocated but not picked.** When the count found less than is allocated, unpicked allocations are released first, re-allocated from other locations where stock allows, and an allocation exception is logged on each order.

## Rules the app enforces

| Message | Cause |
| --- | --- |
| **A count variance requires a reason. Choose an adjustment reason.** | Any line with a difference needs a reason. |
| **This warehouse requires a reason for cycle count updates** | The warehouse has **Count difference reason required** on. |
| **Nothing is counted yet. Count at least one line first, or use Cancel to close the plan** | No line is counted. |
| **No counted lines are waiting for an inventory update** | Every counted line is already posted or cancelled. |
| **Inventory has already been updated for this count** | The plan is already posted. |
| **Only counted lines can update inventory** | The selected line is not **Count Completed**. |

## Create a recount

A recount sends a counted line back to the floor before you post it. Recounts are only for Cycle Count plans.

1. Select lines in **Count Completed** status on the **Lines** tab or a details page.
2. Select **Create Recount**.
3. Choose who to **Assign the recount to**, or leave it in the job pool.
4. Select **Create recount**.

Each line gets a new **Ready to Count** line marked as a recount line, in a new job. The original line becomes **Recount Created** and no longer updates inventory. If the recount is cancelled, the original line goes back to **Count Completed** and its result can still be posted.

You can also select completed count tasks in **Fulfillment > Count Task Details** and select **Recount**. See [Task details](/docs/wms/task-details).

Recounts are refused when:

- The plan is an Instant Count: **Recounts are only for Cycle Count plans. Quick (Instant Count) lines can't be recounted; run a new quick count instead**.
- A recount already exists: **A recount already exists for this line**.
- The line is not counted: **Only counted lines can be recounted**.

## Cancel lines or a plan

1. Select lines and select **Cancel**, or select **Cancel** on the plan.
2. Enter a **Reason**. It is required when counted results would be discarded, and is kept on the plan timeline.
3. Confirm.

Pending count tasks for those lines are cancelled. When every line of a plan is cancelled, the plan is cancelled and its locations unlock. Counted results that were never posted are discarded, so stock stays as it is. A plan that is already **Inventory Updated** can't be cancelled.

## Related pages

- [Count plans](/docs/wms/count-plans)
- [Enter counts on the count sheet](/docs/wms/count-sheet)
- [Run a quick count](/docs/wms/quick-count)
