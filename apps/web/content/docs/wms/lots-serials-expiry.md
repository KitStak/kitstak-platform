---
title: Lots, serial numbers and expiry dates at receiving
description: Capture lot numbers, expiry and production dates and serial numbers when you receive stock, and pre-advise serials on a purchase order.
section: Inbound
order: 80
---

When a product tracks lots, expiry dates, production dates or serial numbers, KitStak WMS asks for them at receiving and stores them on the inventory row. Every later move, count and pick keeps them. This page covers what is asked at the dock, how pre-advised serial numbers work, and how to fix a wrong value later.

## Before you start

- Turn tracking on for the product in the product wizard. See [Tracking, customs, hazmat and replenishment settings](/docs/wms/product-advanced-settings).
- You need the **Receive PO** permission on **Purchase Orders**.

## What is asked at receiving

| Product setting | What you enter at receiving | Message when missing |
| --- | --- | --- |
| **Lot/batch tracking** | **Lot batch number** | **MUG-11OZ-BLK is lot tracked: enter a lot/batch number.** |
| **Expiry date tracking** | **Expiry date** | **MUG-11OZ-BLK is expiry tracked: enter an expiry date.** |
| Production date tracking **Active** | **Production date** | **MUG-11OZ-BLK tracks production date: enter one.** |
| **Track serial number** | One serial per unit | **12 serial numbers required; 10 entered.** |

Messages show your own SKU and counts.

- The number of serials is the quantity times the pack type's UOM quantity. Receiving 2 cases of 6 needs 12 serials.
- Lot, expiry and production date are required unless your warehouse's receiving screen configuration marks that step as optional. Serial numbers are always required when tracking is on.
- On a purchase order line you can store an expected lot, expiry and production date under **Receiving details**. See [Create a purchase order](/docs/wms/create-purchase-order).

## Expired lots

If you enter an expiry date before today, in the warehouse's time zone, the receipt is held:

- In **Receive items**, an **Expired lot** callout shows. Tick **I confirm receiving expired stock** to receive it anyway.
- Without the confirmation, the message reads **This lot is already expired. Confirm receiving expired stock to continue.**
- RF receiving on a handheld never receives expired stock. Use **Receive items** on the desktop.

Stock that expires today is still accepted.

## Pre-advise serial numbers

Your vendor can send serial numbers before the goods arrive. Import them onto the PO so receiving fills them in.

1. Go to **Inventory > Purchase Orders**.
2. Select **Import > Serial numbers**.
3. Download the template, fill in one row per serial with `PO Code`, `SKU` and `Serial Number`, and drop the file.

How the serial import works:

- The PO must be open, and the SKU must be serial tracked and on the PO.
- A serial already pre-advised on an open PO, or already in stock, is rejected. The check ignores upper and lower case.
- Serials fill the first line of that SKU that still has room: one serial per ordered unit times the pack ratio.
- Invalid rows go to the error file with the reason. Valid rows are imported.

When you open **Receive items**, the line says how many pre-advised serials are not received yet and fills them in, in import order.

## Remove pre-advised serials

1. On the purchase order list, select the POs.
2. Select **Delete > Remove serial number**.
3. Confirm.

Only the pre-advice is removed. Serials already received stay on their receipts and in stock. The action is disabled when none of the selected POs has pre-advised serials.

## Fix a lot or date after receiving

Use **Inventory > Inventory by Location**, select the rows, then **Change Attributes** and pick **Change Lot/Batch Number**, **Change Expiry Date** or **Change Production Date**. See [Move and transfer inventory](/docs/wms/transfer-inventory).

## Mixing rules

Locations and LP types can refuse mixed lots and dates:

- A location with **Only 1 lot number**, **Only 1 expiration date** or **Only 1 production date** blocks a second value. See [Create a location](/docs/wms/create-location).
- An LP type with **Only 1 lot batch number**, **Only 1 expiry date** or **Only 1 production date** blocks the scan. See [License plates](/docs/wms/license-plates).

## Related pages

- [Receive a purchase order](/docs/wms/receive-purchase-order)
- [Receive on a handheld](/docs/wms/rf-receiving)
- [Tracking, customs, hazmat and replenishment settings](/docs/wms/product-advanced-settings)
