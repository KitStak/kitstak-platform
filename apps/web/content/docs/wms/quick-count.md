---
title: Run a quick count
description: Count one location right now in KitStak WMS with a quick count, and post the difference to inventory straight away or leave it for review.
section: Counts
order: 50
---

A quick count checks one location without planning a count first. You scan the location, enter what you find, and submit. KitStak WMS creates an Instant Count plan with a code made of `IC` and a timestamp, runs the count, and closes it in one step.

## Before you start

- You need the **Create** permission on **Count Plans**, or the instant count permission under **Mobile > Instant Count**.
- If the warehouse requires a count difference reason, have the reason ready.

## Run a quick count

1. Go to **Inventory > Count Plan**.
2. Select **Quick count**. The **Quick count** dialog opens.
3. Pick the **Warehouse**, then scan or type the **Location** and select **Find**.
4. For each SKU and lot, enter the **Counted** quantity. The **System** and **Difference** columns update as you type. You can also mark units as **Damaged**.
5. Leave **Update inventory now** on to post differences right away, or turn it off to leave them on the plan for **Update Inv.**
6. When a quantity differs, choose an **Adjustment reason**.
7. Select **Submit count**. With **Update inventory now** on and differences found, select **Review and submit**, check the units added and removed, then select **Post to inventory**.

When it is done, select **Open count** in the message to see the plan.

## What happens to the plan

| Case | Result |
| --- | --- |
| No difference | The plan closes as **Inventory Updated** with no stock change. |
| Differences and **Update inventory now** on | The differences post as Count transactions and the plan closes as **Inventory Updated**. |
| Differences and **Update inventory now** off | The differences wait on the plan. Post them later with **Update Inv.** See [Update inventory from counts](/docs/wms/update-inventory-from-counts). |

Quick count lines can't be recounted. Run a new quick count instead.

## When the location is in another count

- If an open count plan with **Lock Locations** holds the location, the dialog shows **Locked by count plan** with the plan code. A quick count can't change its stock. Count it on that plan's count sheet, or finish or cancel the plan first.
- If the location is in an open count without a lock, the dialog shows **This location is already in an open count**. A quick count still works, but the other count will compare against the new quantity.

## On a handheld

On the handheld count screen, select **Instant** to run the same flow for a location that is not on any plan. See [Enter counts on the count sheet](/docs/wms/count-sheet).

## Related pages

- [Count plans](/docs/wms/count-plans)
- [Update inventory from counts](/docs/wms/update-inventory-from-counts)
- [Add, adjust and remove inventory](/docs/wms/adjust-inventory)
