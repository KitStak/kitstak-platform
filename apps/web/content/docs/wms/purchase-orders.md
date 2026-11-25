---
title: Purchase orders
description: Find, open, cancel, delete and change the status of purchase orders in KitStak WMS, and learn what each PO status means.
section: Inbound
order: 10
---

A purchase order (PO) tells the warehouse what stock to expect: which client, which vendor, which SKUs and how many. You receive against it line by line, and KitStak WMS keeps the ordered, received and open quantity of every line. This page covers the PO list, the PO detail page and PO statuses.

## Before you start

- You need the **View** permission on **Purchase Orders**. Creating, receiving, cancelling, deleting, status changes and printing each have their own permission.
- The warehouse, client, vendor and products must exist. See [Set up your warehouse step by step](/docs/wms/setup-sequence).

## Open the purchase order list

1. Go to **Inventory > Purchase Orders**, or press `G` then `R`.
2. Search with **Search by code or reference**, or add filters.
3. Select a row to open the purchase order.

The page has four tabs: **Purchase Order**, **Vendors**, **Receiving History** and **Putaway**.

Main columns: **PO number**, **Status**, **Vendor**, **Reference number**, **Purchase price**, **Total quantity**, **PO type**, **Tags**, **Client**, **Warehouse**, **Created date**, **Planned receiving date**, **Actual receiving date**, **Planned arrival date** and **Actual arrival date**.

## PO statuses

| Status | Meaning | What moves it |
| --- | --- | --- |
| **Pending** | Created, nothing received yet. | Saved from the wizard or imported. |
| **Started** | Being received. Some lines still have an open quantity. | The first receipt, or a manual status change. |
| **Completed** | Closed. Actual receiving and completed dates are stamped. | Every line is fully received, the open balance is cancelled, or a manual change. |
| **Cancelled** | Will not be received. Can't change any more. | **Cancel order** on a PO without receipts, or a manual change. |

Only **Pending** and **Started** purchase orders can be received or cancelled.

## Actions on the list

Select one or more purchase orders, then use the buttons above the grid.

| Button | What it does |
| --- | --- |
| **Create purchase order** | Opens the PO wizard. See [Create a purchase order](/docs/wms/create-purchase-order). |
| **Import** | **Purchase orders** or **Serial numbers** from Excel. |
| **Putaway & reports** | Opens the **Putaway worklist**, the **PO receiving report** and **Receiving performance**. |
| **Tag** | Adds tags to the selected purchase orders. |
| **Label** | **Product label** per line or per unit, or the **Purchase order** document as a PDF. |
| **Cancel order** | Cancels the selected Pending or Started orders. |
| **Receive PO** | Receives every open unit of the selected orders into the default receiving location. |
| **Delete** | **Delete purchase order** for Pending orders without receipts, or **Remove serial number** to remove pre-advised serials. |

When some selected orders can't take an action, the action runs on the others and tells you which were skipped and why.

## The purchase order detail page

Opening a PO shows a read-only view. The rail on the side shows **Summary** (type, vendor, client, PO date, status, actual receiving), **Billing charges**, **Printouts** and documents. The lines show **Product**, **Pack type**, **Quantity**, **Received**, **Difference**, **Price per item** and **Total**.

- Select **Edit purchase order** to change it in the wizard.
- The **Receipts** section lists every receipt posted against the PO.
- Select **Other actions** for **Receive items**, **Receive PO**, **Print purchase order**, **Cancel order** and **Delete order**.
- In **Printouts**, select **Upload document** to attach a file, and **View documents** to see attachments.
- Select **Download billing charges** for the latest billing charges.

Lines of a Completed or Cancelled PO can't change.

## Change the status by hand

1. Open the purchase order.
2. In **Summary**, select the **Change status** button next to the status.
3. In **Change Purchase Order Status**, pick an available **New status**. Unavailable ones show why.
4. Enter a **Reason** of at least 3 characters.
5. Select **Change status**.

Rules the app enforces:

- A Completed PO can only go back to **Started**. This re-opens it: the completed and actual receiving dates are cleared, so you can receive more or cancel receipts.
- A Cancelled PO can't change.
- You can't cancel a PO that has active receipts. Cancel the received lines first.

## Cancel an order

1. Select the purchase orders, or open one and use **Other actions**.
2. Select **Cancel order** and confirm.

A PO with no receipts becomes **Cancelled**. A PO that already received stock is short-closed instead: its open units are no longer expected, the received lines and their stock are kept, and the order closes as **Completed**.

## Delete an order

Only **Pending** purchase orders without receipts can be deleted. This can't be undone.

## Related pages

- [Create a purchase order](/docs/wms/create-purchase-order)
- [Receive a purchase order](/docs/wms/receive-purchase-order)
- [Receiving history](/docs/wms/receiving-history)
- [Put away received stock](/docs/wms/putaway)
