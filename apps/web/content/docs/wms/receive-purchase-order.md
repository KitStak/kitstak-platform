---
title: Receive a purchase order
description: Receive a purchase order in KitStak WMS line by line with location, LP, lot, expiry and serials, or receive every open unit in one click.
section: Inbound
order: 30
---

You can receive a purchase order in three ways. **Receive items** receives some or all lines with full detail. **Receive PO** receives every open unit into the warehouse's default receiving location in one click. On a handheld, RF receiving receives by scan. Each receipt adds stock to the location, updates the PO line, and moves the PO to **Started** or **Completed**.

## Before you start

- You need the **Receive PO** permission on **Purchase Orders**.
- The PO must be **Pending** or **Started**.
- For **Receive PO**, the warehouse needs a **Default receiving location**. See [Set up your warehouse step by step](/docs/wms/setup-sequence).

## Receive items line by line

1. Go to **Inventory > Purchase Orders** and open the PO.
2. Select **Other actions > Receive items**. The **Receive items** drawer opens with every open line.
3. Clear the checkbox of any line you are not receiving now.
4. For each line, check or fill in the fields below.
5. Select **Receive**.

The quantity of each line starts at what is still open.

| Field | What it does | Required |
| --- | --- | --- |
| **Quantity** | How many of the line's pack type you are receiving. A whole number of 1 or more. | Yes |
| **Receiving location** | Where the stock goes. Scan or search a location. The putaway suggestion is filled in, with the reason it was chosen. | Yes |
| **License plate** | **No LP**, **Scan LP** to receive onto an existing LP, or **New LP** to create one from an **LP type**. A new LP number is assigned automatically. | No |
| **Lot batch number** | The lot. | When the product tracks lots |
| **Expiry date** | The expiry date. | When the product tracks expiry |
| **Production date** | The production date. | When the product tracks production date |
| **Serial numbers** | Scan or paste serials, separated by `Enter` or commas. The label shows how many are required. | When the product tracks serials |
| **Damage reason** | Leave as **Not damaged** for sellable stock, or pick a reason such as **Broken** or **Leaking**. | No |
| **Damage photo** | Upload a photo of the damage. | No |
| **Note** | Free text for the receipt. | No |

When you are done, the toast reads **You have successfully received orders.**

## Over-receipts and expired lots

- If a quantity is more than the line's open quantity, an **Over-receipt** callout shows. Tick **I confirm receiving more than ordered** to receive it.
- If an expiry date is before today in the warehouse's time zone, an **Expired lot** callout shows. Tick **I confirm receiving expired stock** to receive it.

## Receive every open unit

1. Open the PO, or select one or more POs on the list.
2. Select **Receive PO** and confirm.

Every open unit is received into the warehouse's default receiving location. **Receive PO** is not available when:

- The PO is not **Pending** or **Started**.
- Every line is already fully received.
- A line needs a lot, expiry date, production date or serial numbers. Use **Receive items** instead.
- The warehouse has no default receiving location. The message reads **Warehouse WH1 has no default receiving location. Set one in Warehouses.**, with your warehouse code

## Rules the app enforces

Messages show your own codes in place of the examples below.

| Message | Cause |
| --- | --- |
| **Choose a location in this warehouse.** | The location is in another warehouse. |
| **A0102 is inactive.** | The location is inactive. |
| **A0102 is locked for counting.** | A count plan locks the location. See [Count plans](/docs/wms/count-plans). |
| **Scan or choose an LP.** | **Scan LP** is selected with no LP. |
| **LP not found in this warehouse.** | The scanned LP is not in this warehouse. |
| **LP LP000101 is in another location.** | The LP sits somewhere else. |
| **MUG-11OZ-BLK is lot tracked: enter a lot/batch number.** | A lot is missing. |
| **MUG-11OZ-BLK is expiry tracked: enter an expiry date.** | An expiry date is missing. |
| **12 serial numbers required; 10 entered.** | The serial count doesn't match the quantity times the pack ratio. |
| **A purchase order in completed status can't be received.** | The PO is closed. |

## What happens after receiving

- The stock appears in **Inventory by Location** in the receiving location, on the LP if you chose one.
- The PO line's received quantity goes up. The PO moves to **Started**, or to **Completed** when every line is fully received.
- The receipt is listed in **Receiving History**.
- Stock in a receiving location appears on the **Putaway** worklist. See [Put away received stock](/docs/wms/putaway).

## Related pages

- [Receive on a handheld](/docs/wms/rf-receiving)
- [Receiving history](/docs/wms/receiving-history)
- [License plates](/docs/wms/license-plates)
- [Lots, serial numbers and expiry dates at receiving](/docs/wms/lots-serials-expiry)
