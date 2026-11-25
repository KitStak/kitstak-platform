---
title: Put away received stock
description: Use the KitStak WMS putaway worklist to move received stock from receiving locations to storage, one task at a time or in bulk.
section: Inbound
order: 50
---

After you receive a purchase order, the stock sits in a receiving location. The **Putaway** worklist lists every inventory row still in a receiving location, oldest first. You move each one to a storage location suggested by the putaway algorithm, or to a location you scan.

## Before you start

- You need the **View** permission on **Purchase Orders** to see the worklist.
- To move stock you need the **Transfer Product** permission on **Inventory by Location**. Without it the **Put away** action reads **You don't have permission to transfer inventory**.

## Open the worklist

1. Go to **Inventory > Purchase Orders** and open the **Putaway** tab.
2. Or select **Putaway & reports > Putaway worklist**.
3. Search with **Search SKU, barcode, location or PO**.

Columns include **SKU**, **Location**, **Quantity**, **Expiry date**, **PO number**, **Receiving date** and **Waiting**, which shows how long the stock has been in receiving.

## Put away one task

1. Find the row and select **Put away** in its actions menu.
2. The dialog shows **Suggested locations** from the putaway algorithm. The first is marked **Best**. Point at a suggestion to see why it was chosen.
3. Scan or type the **Destination location**, or pick a suggestion.
4. Enter the **Quantity** to move. When the stock is on an LP, you can instead tick **Move the whole LP** to move the LP with every SKU on it in one scan.
5. Select **Confirm putaway**.

The stock moves through an inventory transfer with the note `Putaway`. A row leaves the worklist once all of its stock is out of the receiving location.

Quantity rules:

- **Enter a quantity** when the field is empty.
- **Use a whole number**.
- **Enter a quantity of at least 1**.
- **At most 24 Each can be moved**, with your own quantity and pack type, when you enter more than the row holds.

## Put away in bulk

1. Select the rows with the checkboxes.
2. Select **Put away** above the grid.
3. Under **Destination**, choose **Each task to its best suggested location** or **All tasks to one location**.
4. For **All tasks to one location**, scan the location, cart or staging lane they all go to.
5. Confirm.

With **Each task to its best suggested location**, the putaway algorithm picks the location per SKU, lot and quantity.

Bulk putaway moves every selected task in full. Rows that can't move are skipped and listed in the result.

## When a row is blocked

A row can't be put away while its receiving location is locked:

- **Location RCV-01 is locked. Unlock it in Locations before putting stock away.** See [Manage locations](/docs/wms/locations).
- The location is locked by an open count plan. Finish, update or cancel the count first. See [Count plans](/docs/wms/count-plans).

Blocked rows are flagged and their actions are disabled.

## Other row actions

- **Open purchase order** opens the PO the stock came from.
- **View in Inventory by Location** opens the stock row.

## Related pages

- [Receive a purchase order](/docs/wms/receive-purchase-order)
- [Inventory by location](/docs/wms/inventory-by-location)
- [Move and transfer inventory](/docs/wms/transfer-inventory)
- [Create a location](/docs/wms/create-location)
