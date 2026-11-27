---
title: Report a pack issue and use hospital locations
description: Move damaged or wrong items out of a pack with Report issue, track them in hospital locations, resolve the pack short and move the stock back.
section: Packing and shipping
order: 40
---

When a packer finds a damaged unit, the wrong color or a missing item, **Report issue** moves the picked units to a hospital location and flags the order **Pack Short: Open**. The order waits there, with its allocation kept, until a supervisor resolves the pack short. The **Hospital locations** page shows everything held and lets you move the stock back when it is fine.

## Before you start

- The warehouse needs a hospital location. Put a location in the "Hospital" location group, or give it a code that starts with `HOSP`, for example `HOSP-01`. Return Station bins are never used as hospitals.
- You need the Report Issue permission to report and the Execute Task permission to move stock back.
- Only orders being packed (**Ready to Pack** or **Packing Started**) can report an issue.

## Report an issue while packing

1. On the pack screen, open **Other actions** and choose **Report issue**.
2. Choose the **Hospital location**. The default hospital is preselected.
3. Under **Units to move**, set how many units of each line go to the hospital. The table shows **Picked** and **Packed** for each line.
4. Describe the problem in **What is wrong?**, for example "Item damaged in the tote, wrong color picked".
5. Select **Report issue**.

The units you choose move to the hospital location and the order is flagged Pack Short: Open for follow-up. The order keeps its allocation.

| Field | What it does | Required |
| --- | --- | --- |
| **Hospital location** | Where the units go. | Yes |
| **Units to move** | Units per line, up to what was picked. Choose at least one unit. | Yes |
| **What is wrong?** | A note for the supervisor, up to 500 characters. | Yes |

If the warehouse has no hospital location, the window shows **No hospital location configured** and the button stays disabled.

## While the pack short is open

- The order can't be packed. Scanning it reads "has an open pack short issue. Resolve the pack short on the order before packing it."
- The packing dashboard counts it under **Pack-short orders held**.
- **Print > Pick / pack short label** on the backlog prints an issue label for it.

## Resolve the pack short

1. Go to **Fulfillment > Shipment Orders** and select the order.
2. Open **Warehouse ops** and choose **Resolve pack short**.
3. Confirm with **Resolve**.

Unpacked quantities go back to the picked tote and the order returns to **Packing Started** so it can be repacked. The action is enabled only when the pack short status is Open.

## Review hospital stock

1. Go to **Fulfillment > Packing Station** and select **Hospital locations** in the header.
2. Choose the **Warehouse**.

The tiles show **Hospital locations**, **Units in hospitals** and **Pack-short orders held**. Each hospital card shows whether it is the **Default for Report Issue**, how it was designated (**Hospital group** or **HOSP code**), and a table of SKUs with **Client**, **On hand**, **Held**, **Free**, **Status** and **Held for**.

## Move stock back

1. On the hospital card, select **Move back** on the SKU row.
2. Enter the **Quantity** and choose **Move to**, a storage or picking location.
3. Optionally add a note, for example "Pack short resolved, item OK".
4. Select **Move back**.

Units held for an order with an open pack short can't move. The button reads "All units are held for" the order. Resolve the pack short on the order first. Stock marked damaged can go to a Storage location for review, not straight to a Picking location.

## Related pages

- [Pack an order at the packing station](/docs/wms/pack-orders)
- [Execute picking tasks and handle pick shorts](/docs/wms/pick-execute-picking-tasks)
- [Hold, release, cancel and delete orders](/docs/wms/order-holds-and-cancellations)
