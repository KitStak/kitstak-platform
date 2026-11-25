---
title: Add, adjust and remove inventory
description: Add stock by hand, set a new quantity or remove units from an inventory row in KitStak WMS, with adjustment reasons and the rules that apply.
section: Inventory and locations
order: 60
---

Use inventory adjustments when the system quantity is wrong and you are not running a count: you found stock, units were damaged, or opening stock needs loading. Every change posts an inventory adjustment to the ledger with your reason and note.

## Before you start

- **Add Inventory** needs the **Add Inventory by Attributes** permission. **Add**, **Adjust** and **Remove** on a row need **Add Inventory by Line**, **Adjust Inventory by Line** and **Remove Inventory by Line**.
- Adjustment reasons come from your company's adjustment reason list.
- If the warehouse has **Adjustment reason required** turned on, every change needs a reason. See [Set up your warehouse step by step](/docs/wms/setup-sequence).

## Add new stock

1. Go to **Inventory > Inventory by Location**.
2. Select **Add Inventory**. The drawer says it adds stock as an Inventory Adjustment in the ledger.
3. Fill in the fields below.
4. Select **Save**.

| Field | What it does | Required |
| --- | --- | --- |
| **Warehouse** | Where the stock is. | Yes |
| **Client** | Who owns the stock. | Yes |
| **Location** | Search by code or barcode. Count-locked and occupied 1-SKU locations are marked. | Yes |
| **LP Number** | Puts the stock on an LP. The LP is placed in the location if it has none. | No |
| **Product** | Search by SKU, name or barcode. Pick the client first. | Yes |
| **Pack Type** | The pack type you are counting in. | Yes |
| **Adjustment Reason** | Why the stock is added. | When the warehouse requires it |
| **Damage Reason** | Leave empty for sellable stock. | No |
| **Quantity to Add** | How many of the pack type. | Yes |
| **Lot/Batch Number** | Up to 60 characters. | When the product tracks lots |
| **Expiry Date** | The expiry date. | When the product tracks expiry |
| **Production Date** | The production date. | When the product tracks production date |
| **Note** | Up to 400 characters. | No |

## Add to, adjust or remove from a row

1. Go to **Inventory > Inventory by Location** and find the row.
2. In the row menu, select **Add**, **Adjust** or **Remove**.
3. The drawer shows the **Current Quantity**. Enter **Quantity to Add**, **New Quantity** or **Quantity to Remove**.
4. Choose the **Adjustment Reason**. When the warehouse doesn't require one, the field reads **Optional for this warehouse**.
5. Add a **Note** if you want.
6. Check **After save**, which shows the quantity the row will have, then select **Save**. The button shows the change, for example **Save (+4)**.

## Rules the app enforces

| Rule | Message |
| --- | --- |
| Remove can't take allocated units. | **Only 8 unallocated can be removed**, with your own quantity |
| Adjust can't go below the allocated quantity. | **5 are allocated; the quantity can't go below that** |
| Adjust needs a new value. | **Enter a different quantity** |
| A reason is required when the warehouse says so. | **Adjustment Reason is required** |
| Only **Stock** rows can change. | Other statuses belong to an order in progress. |
| A count-locked location can't change. | The **Location locked by a count** callout shows. Finish, update or cancel the count first. |

Some reasons only go one way. A decrease reason, such as one named "Damaged" or "Lost", can't be used to add stock, and an increase reason, such as "Found", can't be used to remove it. The message names the reason, for example **"Lost" is a decrease reason. Use it to remove or adjust stock down.**

> **Important:** Setting **New Quantity** to 0, or removing every unit, deletes the inventory row from **Inventory by Location**. The callout **This deletes the inventory record** or **Removes every unit** warns you first.

## Load opening stock in bulk

To load existing stock for a new warehouse, use **Import** on **Inventory by Location**. See [Import data from Excel](/docs/wms/excel-imports).

## Related pages

- [Inventory by location](/docs/wms/inventory-by-location)
- [Move and transfer inventory](/docs/wms/transfer-inventory)
- [Update inventory from counts](/docs/wms/update-inventory-from-counts)
