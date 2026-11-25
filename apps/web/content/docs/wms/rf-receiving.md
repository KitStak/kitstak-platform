---
title: Receive on a handheld
description: Receive purchase orders by scan on a handheld or RF scanner in KitStak WMS, one product at a time, with lot, expiry, serial and location.
section: Inbound
order: 40
---

RF receiving is a one-column screen built for handheld scanners. Every field accepts a scanner's `Enter`, buttons are large, and each confirmed product posts a partial receipt right away. It uses the same rules as receiving on the desktop.

## Before you start

- You need the **Receive PO** permission on **Purchase Orders**. Without it the screen reads **You can't receive purchase orders**.
- Open the browser on the handheld, sign in, and go to `/receiving/rf`. The page is titled **RF receiving**.
- The purchase order must be **Pending** or **Started** in one of your warehouses.

## Receive by scan

1. **Scan the PO.** Scan or type the PO number or reference in **Scan PO**. Or pick one under **Or pick an open PO**.
2. **Scan the product.** Scan the product barcode or type the SKU. **Open lines** lists what is still expected. Scanning the same product again adds one to the quantity.
3. **Set the quantity.** Use **One less** and **One more**, type the number, or select **All open**.
4. **Enter tracked attributes.** If the product tracks them, enter the **Lot/batch number**, **Expiry date** and **Production date**, and scan each serial number into **Scan a serial number**. The counter shows how many serials you have and how many are needed.
5. **Scan the location.** The putaway suggestion is filled in and marked **Suggested**. Scan another location to replace it.
6. **Choose the LP.** Pick **No LP**, **Scan LP** to put the stock on an existing LP, or **New LP** and choose the **LP type**.
7. **Confirm.** Select **Receive** with the quantity, for example **Receive 12**.

The screen returns to the product step for the next item. **Received this session** lists every receipt you posted.

To pick another product before confirming, select **Change product**.

## What blocks the Receive button

The button stays disabled and shows the first reason. Messages show your own SKU and numbers.

| Message | What to do |
| --- | --- |
| **Enter a quantity of at least 1.** | Enter a quantity. |
| **MUG-11OZ-BLK is lot tracked: scan or enter the lot/batch number.** | Enter the lot. |
| **MUG-11OZ-BLK is expiry tracked: enter the expiry date.** | Enter the expiry date. |
| **MUG-11OZ-BLK tracks production date: enter it.** | Enter the production date. |
| **Scan 6 serial numbers (4 scanned).** | Scan the rest of the serials. |
| **Scan the receiving location.** | Scan a location. |
| **Scan the LP, or switch to No LP.** | Scan the LP or choose **No LP**. |
| **Choose the LP type for the new LP.** | Pick an LP type. |
| **Only 10 open: confirm the over-receipt.** | Confirm that you are receiving more than ordered. |

A serial that is already scanned in this receipt is refused, for example **SN10000123 is already scanned.**

> **Note:** RF receiving does not accept expired stock. To receive a lot that is already expired, use **Receive items** on the desktop and confirm the expired lot there.

## Related pages

- [Receive a purchase order](/docs/wms/receive-purchase-order)
- [Put away received stock](/docs/wms/putaway)
- [Enter counts on the count sheet](/docs/wms/count-sheet)
