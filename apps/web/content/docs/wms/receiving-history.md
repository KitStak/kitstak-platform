---
title: Receiving history
description: See every receipt posted in KitStak WMS, open its details and ledger transaction, and cancel a receipt to reverse the stock it added.
section: Inbound
order: 60
---

**Receiving History** lists every receipt: from purchase orders, returns, work orders and inventory added by hand. Each row is one receipt of one SKU into one location, with who received it and when. From here you can open the receipt, see its ledger transaction, or cancel it.

## Before you start

- You need the **View** permission on **Receiving History**.
- To cancel a receipt you need the **Cancel** permission on **Receiving History**.

## Open receiving history

1. Go to **Inventory > Receiving History**.
2. Or go to **Inventory > Purchase Orders** and open the **Receiving History** tab.
3. Search with **Search by PO number, SKU or master ID**, or add filters.

## Columns

| Column | What it shows |
| --- | --- |
| **Master ID** | The receipt number. |
| **Status** | **Received**, or **Cancelled** when the receipt was reversed and its stock taken back out. |
| **Receiving type** | Where the receipt came from, such as **Purchase Order**, **Return**, **Kitting**, **DisassembleKit**, **Add Inventory** or **Product Receive**. |
| **PO number** | The purchase order, when there is one. |
| **Product photo(s)** | The product image. |
| **Pack type**, **UOM quantity**, **Receiving date** | What was received and when. |
| **Location**, **Client**, **Warehouse**, **Note** | Where it went and any note. |
| **Work order code**, **Shipment order code** | The work order or shipment order behind the receipt, when there is one. |
| **Damage image** | The damage photo taken at receipt. |

Serial numbers of a receipt open the serial number receiving history in a new tab.

## Open a receipt

Select a row, or choose **Show details** in its actions menu. The drawer shows:

- **Receiving type**, **Purchase order** and **PO status**.
- **Quantity**, **Location** and **LPN**.
- **Lot/batch number**, **Expiry date** and **Production date**.
- **Damage reason**.
- **Received**, **Client / warehouse** and **Note**.
- **Ledger transaction**: the inventory posting the receipt made.

Other row actions: **Open purchase order** and **Ledger transactions**.

## Cancel a receipt

Cancelling reverses the receipt: the stock is taken back out of the location, and the PO line's received quantity goes down.

1. Find the receipt and select **Cancel receiving** in its actions menu.
2. Check the receipt in **Are you sure you want to cancel the receiving?**
3. Select **Yes**. This can't be undone.

You can't cancel a receipt when:

| Message | What to do |
| --- | --- |
| **This receipt is already cancelled.** | Nothing. It is already reversed. |
| **A received line of an order in completed status can't be cancelled. Re-open the purchase order (change its status to Started) first.** | Change the PO status to **Started**, then cancel. See [Purchase orders](/docs/wms/purchase-orders). |
| **The purchase order is cancelled.** | Nothing can change on a cancelled PO. |

## Related pages

- [Receive a purchase order](/docs/wms/receive-purchase-order)
- [Purchase orders](/docs/wms/purchase-orders)
- [Inventory by location](/docs/wms/inventory-by-location)
