---
title: Count plans
description: How counting works in KitStak WMS, from count plan types and statuses to location locks, the count plan pages and count accuracy.
section: Counts
order: 10
---

A count plan lists what to count: locations, SKUs or license plates in one warehouse. You turn it into count jobs, counters count on the count sheet or a handheld, and then you post the differences to inventory. This page explains the kinds of count, the statuses, location locks and the pages you use.

## Before you start

- You need the **View** permission on **Count Plans**. Creating, editing, deleting, importing, cancelling, **Update Inv.** and **Create Job** each have their own permission.
- **Count Location Details** and **Count SKU Details** have their own permissions, including **Create Recount** and **Update Inv.**
- The warehouse needs at least one active Count job type before you can create count jobs.

## The counting flow

1. Create a count plan with the locations, SKUs or LPs to count. See [Create a count plan](/docs/wms/create-count-plan).
2. Create count jobs and assign counters. The plan moves to **Ready to Count**. See [Create count jobs](/docs/wms/count-jobs).
3. Counters count on the count sheet or a handheld. See [Enter counts on the count sheet](/docs/wms/count-sheet).
4. Review the differences and post them with **Update Inv.**, or create a recount. See [Update inventory from counts](/docs/wms/update-inventory-from-counts).

For one location you need to check right now, use **Quick count**. See [Run a quick count](/docs/wms/quick-count).

## Kinds of count

| Kind | What it counts |
| --- | --- |
| **Location Count** | Everything in the chosen locations. |
| **SKU Count** | The chosen SKUs wherever they are stocked. Each SKU expands to one line per stocked location when the job is created. |
| **LP Count** | The contents of the chosen license plates. |

Each plan also has a **Count Operation Type**: **Cycle Count** for planned counts, or **Instant Count** for quick counts. Only Cycle Count plans can be recounted.

A count job whose job type is set as a blind count hides the system quantity from counters. See [Enter counts on the count sheet](/docs/wms/count-sheet).

## Count plan statuses

| Status | Meaning | What moves it |
| --- | --- | --- |
| **Pending** | Created, no job yet. Only pending plans can be edited or deleted. | Saving the plan. |
| **Ready to Count** | Jobs exist. Counters can start. | **Create Job**. |
| **Count Started** | At least one line is counted. | The first submitted count. |
| **Count Completed** | Every line is counted. | The last submitted count. |
| **Inventory Updated** | Differences are posted. The plan is locked for the audit trail. | **Update Inv.**, or automatically for lines with no difference when the count job type is set to auto-update them. |
| **Cancelled** | Stopped. | **Cancel**. |

Lines have the same statuses, plus **Recount Created** for a line replaced by a recount.

## Location locks

Turn on **Lock Locations** on a plan to freeze stock while you count. While the plan is open, stock can't be moved into or out of its locations. Receiving, putaway, transfers, adjustments and packing that touch a locked location are refused, with a message that names the location and the count plan, such as **Location A0102 is locked by count plan CNT-001. Finish, update or cancel the count first.** The lock lifts by itself when the line or plan is cancelled, posted, or replaced by a recount.

The plan detail page shows **Stock in these locations is frozen** while a lock is active.

## The Count Plan page

1. Go to **Inventory > Count Plan**.
2. Search with **Search by count code**, or add filters.
3. Select a row to open the plan.

The page has three tabs: **Count Plan**, **Location Details** and **SKU Details**.

Header buttons: **Create New Count**, **Quick count**, **Import** (**Import location count plan**, **Import SKU count plan**), **Accuracy**, **Recurring counts** and **Handheld**.

Row actions include **Cancel**, **Update Inv.**, **Create Job**, **Quick view**, **Open count details**, **Show Details (read-only)**, **Change log** and **Delete**.

Main columns: **Count Code**, **Status**, **Warehouse**, **Job Code**, **Count Started Time**, **Count Completed Time**, **Number of SKU**, **Counted SKU**, **Number of Location**, **Counted Locations**, **Cancelled Lines**, **Count Type**, **AI Count Plan**, **Count Operation Type**, **Created By**, **Inventory Updated Date Time** and **Inventory Update User**.

## The count plan detail page

The header shows the status, the schedule and buttons for **Edit**, **Cancel** and **Update Inv.** Under **More plan actions** you can delete a pending plan that has no jobs.

Summary figures: **Counted**, **Counted vs system**, **Unit variance** and **Exact lines**.

| Tab | What it shows |
| --- | --- |
| **Lines** | Each line with **SKU**, **Location**, **Lot / LP**, **System**, **Counted**, **Diff** and **Counted by**. |
| **Count sheet** | The web count entry. See [Enter counts on the count sheet](/docs/wms/count-sheet). |
| **Jobs** | Count jobs with **Job code**, **Job type**, **Status**, **Assignee**, **Tasks** and **Created**. |
| **Timeline** | Every event on the plan. |

## Location Details and SKU Details

**Inventory > Count Location Details** and **Inventory > Count SKU Details** list count lines across all plans, one row per location or SKU. Columns include **Initial Stock Qty**, **Counted Qty**, **Approved Count Qty**, **% Difference**, **Recount Line** and **Count User**. Bulk actions: **Cancel**, **Update Inv.** and **Create Recount**. Row actions add **Show count plan** and **Delete**.

## Count accuracy

Select **Accuracy** on the Count Plan page. The **Count accuracy** drawer shows, for the **Period** you pick, **Record accuracy**, **Counted**, **Unit accuracy** and **Net variance** (counted minus system units), the **SKUs with the largest variance**, the **Locations with the largest variance**, **Counters**, and **Weekly record accuracy**. Accuracy is worked out from posted counts.

## Related pages

- [Create a count plan](/docs/wms/create-count-plan)
- [Create count jobs](/docs/wms/count-jobs)
- [Enter counts on the count sheet](/docs/wms/count-sheet)
- [Update inventory from counts](/docs/wms/update-inventory-from-counts)
