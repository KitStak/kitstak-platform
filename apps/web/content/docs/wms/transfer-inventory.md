---
title: Move and transfer inventory
description: Move stock between locations and license plates in KitStak WMS by product, by whole LP or by whole location, and change lots, dates and damage reasons.
section: Inventory and locations
order: 70
---

KitStak WMS moves stock in three ways. **Transfer Product** moves a quantity of one or more inventory rows. **Transfer LP** moves a license plate with everything on it. **Transfer Location** moves the whole content of a location. **Change Attributes** corrects a lot, a date or a damage reason without moving anything. Every move posts a transfer to the ledger.

## Before you start

- **Transfer Product** needs the **Transfer Product** permission on **Inventory by Location**. **Transfer LP** and **Transfer Location** need **Transfer LP/Location**. **Change Attributes** needs **Change Attributes**.
- Only free units in **Stock** status can move or change. Allocated units stay where they are.

## Transfer a product

1. Go to **Inventory > Inventory by Location**.
2. For one row, select **Transfer product** in its menu. For several rows, select them and select **Transfer Product** above the grid.
3. Enter the **Transfer Product Quantity**.
4. Choose where it goes in **Move to LP/Location**: a location, or an LP.
5. Select **Transfer**. For several rows, the button reads **Transfer 3 rows**, with your count.

The toast reads **Transfer completed successfully**, or **Transfer was not completed** with the reason. If some rows fail in a bulk transfer, the button changes to **Retry 1 failed** so you can try those again.

## Transfer a whole LP or location

1. Go to **Inventory > Inventory by Location**.
2. Select **Transfer LP/Loc**, then **Transfer LP** or **Transfer Location**.
3. In **Transfer from Parent LP/LP** or **Transfer from Location**, find the LP or location. The **Contents** show each **SKU**, **LP**, **Lot/Batch Num.**, **Pack Type**, **Pack Qty**, **SKU Qty**, **Expiry Date** and **Production Date**.
4. Choose the target in **Move to LP/Location**.
5. Select **Transfer**.

## Change attributes

1. Go to **Inventory > Inventory by Location** and select the rows.
2. Select **Change Attributes**, then **Change Lot/Batch Number**, **Change Expiry Date**, **Change Production Date** or **Change Damage Reason**.
3. Enter the new value. For **Change Damage Reason**, pick a reason or **No damage reason**.
4. For one row, set **Quantity to change**. Leave it empty to change all free units. A smaller quantity splits the row.
5. Read the **Attention** callout and select **Save**.

Points to know:

- The new value must differ from the current one: **Enter a different value than the current one**.
- Lot numbers are at most 60 characters.
- Setting a lot or date on a product that doesn't track it is refused. Clearing it is allowed. Turn tracking on in the product first.
- Allocated units keep their current value.
- Giving units a damage reason takes them out of **Undamaged Quantity** and **Current ATP**.

## Rules the app enforces

| Message | Cause |
| --- | --- |
| **Move to LP/Location is required** | No target was chosen. |
| **Source and target locations are the same.** | The target is the same location. |
| **Source and target LP are the same.** | The target is the same LP. |
| **The stock is already in A0102.** | The stock is already in the target. The message names it. |
| Count lock message | The source or target location is locked by an open count plan. Finish, update or cancel the count first. |

Location rules such as **Only 1 SKU**, and LP type mixing rules, are checked when stock moves in. See [Create a location](/docs/wms/create-location) and [License plates](/docs/wms/license-plates).

## Related pages

- [Inventory by location](/docs/wms/inventory-by-location)
- [Put away received stock](/docs/wms/putaway)
- [Add, adjust and remove inventory](/docs/wms/adjust-inventory)
