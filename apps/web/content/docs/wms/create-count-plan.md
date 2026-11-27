---
title: Create a count plan
description: Create a location, SKU or LP count plan in KitStak WMS, pick what to count, lock the locations and let AI suggest the riskiest stock.
section: Counts
order: 20
---

A count plan has two steps: **General**, where you name it and choose the warehouse and date, and **Tasks**, where you pick the locations, SKUs or license plates to count. You can also import count plans from Excel.

## Before you start

- You need the **Create** permission on **Count Plans**.
- Decide whether stock must freeze during the count. If so, turn on **Lock Locations**. See [Count plans](/docs/wms/count-plans).

## Create a count plan

1. Go to **Inventory > Count Plan**.
2. Select **Create New Count**.
3. Fill in the **General** step and select **Next**.
4. On **Tasks**, pick the count type and add what to count.
5. Select **Save**.

The plan is saved as **Pending**. Next, create count jobs. See [Create count jobs](/docs/wms/count-jobs).

## General step

| Field | What it does | Required |
| --- | --- | --- |
| **Name** | The count code, up to 50 characters. Unique in the warehouse. | Yes |
| **Warehouse** | The warehouse to count in. | Yes |
| **Description** | What, where and why this count runs. Up to 400 characters. | No |
| **Scheduled Count Date** | When the count should run. Starts at now. | Yes |
| **Lock Locations** | While the count is open, stock can't be moved in or out of its locations. The lock lifts when the count is cancelled or inventory is updated. Off by default. | No |

## Tasks step

1. Pick the count type: **Location Count**, **SKU Count** or **LP Count**.
2. Select **Add**. The **Add Location**, **Add Product** or **Add License Plate** picker opens.
3. Filter the picker, tick the rows and confirm.
4. To take rows out, tick them and select **Remove**.

**Location Count** counts everything in chosen locations. **SKU Count** counts chosen SKUs wherever they are stocked. **LP Count** counts the contents of chosen license plates.

If you switch the count type after adding rows, you are asked first, because the rows are cleared.

What the pickers show:

| Picker | Columns |
| --- | --- |
| **Add Location** | **Location**, **Loc Type**, **Loc Group**, **Zone**, **ABC Code**, **Aisle**, **Rack**, **Level**, **Locked**, **Prevent Allocation**, **Last Counted**, **Num. of SKU**, **On hand** |
| **Add Product** | **Product Code**, **Client**, **Item Type**, **Item Group**, **Kit**, **Lot / Serial / Expiry tracking**, **Status**, **Last Counted**, **On hand** |
| **Add License Plate** | **LP Number**, **LP Type**, **Location**, **Client**, **Num. of SKU**, **On hand** |

Locations and SKUs already in this plan, or in another open count, are greyed out. Only license plates placed in a location are listed.

## Let AI suggest what to count

1. On **Tasks**, select **Suggest**.
2. Review the suggested locations or SKUs. Each has a **Count risk score (0 to 100)**.
3. Tick the ones you want, or **Select all suggestions**, and add them.

A plan built this way is saved as an AI Count Plan and shows **Yes** in the **AI Count Plan** column.

## Validation messages

| Message | What to do |
| --- | --- |
| **Name is required** | Enter a name. |
| **Warehouse is required** | Pick a warehouse. |
| **Scheduled count date is required** | Pick a date. |
| **Choose a warehouse in step 1 first** | Go back to **General** and pick the warehouse before adding rows. |
| **Add at least one location** | **Save** stays disabled until the plan has a row. |
| **A count plan named CNT-001 already exists in this warehouse** | Use another name. The message names yours. |

## Edit a count plan

- A **Pending** plan can be edited in full with **Edit**.
- After jobs exist, only the name and description can change.
- Once inventory is updated, only the description can change, and the name is locked because ledger postings reference it.

## Import count plans

1. On **Inventory > Count Plan**, select **Import > Import location count plan** or **Import SKU count plan**.
2. Download the template and add one row per location or SKU. Rows with the same `Count Plan Name` in one warehouse form one plan.
3. Drop the file on the page.

Lines can only be added to pending plans, and a row must match the plan's count type. See [Import data from Excel](/docs/wms/excel-imports).

## Recurring counts

To create cycle counts on a schedule, select **Recurring counts** on the Count Plan page. It opens the Cycle Count wave rules.

## Related pages

- [Count plans](/docs/wms/count-plans)
- [Create count jobs](/docs/wms/count-jobs)
- [Run a quick count](/docs/wms/quick-count)
