---
title: Enter counts on the count sheet
description: Count locations on the KitStak WMS count sheet on a desktop or a handheld, with found stock, damaged units, skips, resets and blind counts.
section: Counts
order: 40
---

The count sheet is where counters enter what they find. It lists the plan's lines in walking order. You scan a location, enter the counted quantity per SKU, lot and LP, and submit. The next uncounted line opens on its own. The same sheet runs on the desktop and, in a handheld layout, on a scanner.

## Before you start

- To enter counts you need the **Edit** or **Update Inv.** permission on **Count Plans**, or the **View Count** permission under **Mobile > Cycle Count**. The **Handheld** button needs **View Count**.
- The plan must have count jobs and be **Ready to Count** or **Count Started**. See [Create count jobs](/docs/wms/count-jobs).

## Count on the desktop

1. Go to **Inventory > Count Plan** and open the plan.
2. Open the **Count sheet** tab. **Lines to count** lists each line in walking order.
3. Scan the location into **Scan location**, or pick a line on the left.
4. For each row, enter the **Counted qty**. Rows show **System qty** and the **Difference** as you type.
5. Add a **Note** if you want, such as damaged boxes or mislabeled bins.
6. Select **Submit count**.

If the plan is still **Pending**, the sheet offers **Create Job** first.

## Entry shortcuts

| Control | What it does |
| --- | --- |
| **Use system qty** | Fills one row with the system quantity. |
| **Fill blanks with system qty** | Fills every empty row with the system quantity. |
| **Found product** and **Found lot** | Adds stock you found that the system doesn't expect. The row is marked **Found**. |
| Mark damaged | Splits off damaged units of a row with a **Damage reason**. The new row is marked **Damaged**. |
| Remove | Removes a found or damaged row you added. |
| **Reset count** | Clears what you entered for the location. |
| **Skip location** | Parks the line at the end of the walk. It shows **Skipped**. |

Rows also show how many units are allocated. Counting below the allocated quantity shorts orders that are not picked yet, and stock that is already picked or in a pick job can't be posted.

## Blind counts

When the count job's job type is set as a blind count, counters never see the system quantity. The sheet hides **System qty** and **Difference**, and the use and fill system quantity shortcuts are not shown. A location with nothing expected reads **Nothing listed to count here**.

## Count on a handheld

1. On the handheld, open **Handheld** from the Count Plan page, or go to `/counts/scan`.
2. Choose a tab: **Your jobs** lists the count jobs assigned to you, **Job pool** lists unassigned jobs, and **Plans** lists plans that are ready to count.
3. In **Job pool**, select **Take job** to take one. In **Plans**, scan the plan into **Scan count plan code** or tap it under **Ready to count**.
4. The count sheet opens in the handheld layout. Scan the location, enter the quantity per SKU and lot, and submit. The next location is then ready.

Select **Instant** to count a location that is not on any plan. See [Run a quick count](/docs/wms/quick-count). Select **Desktop view** to switch back to the full layout. **Nothing to count right now** means no job or plan is waiting for you.

Users without permission to count see **View only**.

## Rules the app enforces

- A location locked by another count plan can't be counted here: **A0102 is locked by count plan CNT-002. Count it on that plan's count sheet, or finish or cancel CNT-002 first.**, with your codes.
- A line whose count job was cancelled can't be counted until a job is created again. The sheet shows **This line's count job was cancelled**.
- A recount line is marked **Recount** and labelled **Recount line**.
- A counted quantity must be a whole number of 0 or more. Otherwise the row reads **Enter a whole number** or **Counted qty can't be negative**.

## Related pages

- [Count plans](/docs/wms/count-plans)
- [Update inventory from counts](/docs/wms/update-inventory-from-counts)
- [Run a quick count](/docs/wms/quick-count)
- [Task details](/docs/wms/task-details)
