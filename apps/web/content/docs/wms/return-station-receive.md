---
title: Receive returns at the return station
description: Set up the return station, scan an RMA, order code or tracking number, receive each item with a condition, close a return short, or receive a manual return with no RMA.
section: Returns
order: 30
---

The **Return Station** is where returned parcels are opened and put back into stock. You scan the RMA or the tracking number on the box, scan each item, choose its condition, and complete the return. When a box arrives with no RMA, you receive it manually and KitStak creates a Manual RMA for you.

## Before you start

- The warehouse needs a location in the Returns area. Otherwise the station list reads "This warehouse has no Returns-area location. Add one in Locations."
- You need the Receive Return permission.
- Check which return rules are on. See [Return rules and dispositions](/docs/wms/return-rules-and-dispositions).

## Set up the station

1. Go to **Fulfillment > Return Station**.
2. Under **Station setup**, choose the **Warehouse**.
3. Scan or choose the **Return station**. A station locked by a count plan can't be chosen.
4. Choose the **Return target**: a **Location** or an **LP**, then scan or search it. Restocked and damaged items go here.

The station card then reads **Receiving at** the station, **into** the target.

## Read the station dashboard

- The tiles show **Returned orders today**, **Returned products today** and **Open RMAs**.
- **Expected returns** lists the warehouse's open RMAs: Started first, then In Transit, then Pending, oldest expected date first. Select **Receive** on a row to start, or **View all** to open **Return Orders**.
- **Return rules in force** lists each rule as On or Off, and where each condition puts the stock.

## Receive a return with an RMA

1. Select **Return with RMA**.
2. Scan or type in **RMA, order code or tracking number**. If several returns match, choose one from the list.
3. Scan each item in **Scan item**. The quantity goes up with each scan.
4. For each item, choose the **Condition**: **Restock**, **Damaged**, **Quarantine** or **Dispose**.
5. For **Damaged** items, choose a damage reason. It is required.
6. Optionally choose the actual return reason, add a note or attach a photo.
7. Fill in lot, expiry, production date or serials for tracked SKUs.
8. Select **Complete return**.

| Per item field | What it does | Required |
| --- | --- | --- |
| **Condition** | Where the units go. | Yes |
| Damage reason | Why the item is damaged. | Yes, for **Damaged** |
| Actual return reason | The reason you found, which may differ from the RMA. | No |
| Note | Up to 500 characters. | No |
| Photo | Saved on the RMA under **Photos & documents**. | No |
| Lot, expiry, production date, serial | For tracked SKUs. The shipped values are offered as choices. | When the rules require them |

If the RMA belongs to another warehouse, the screen shows **Found in** that warehouse with **Switch to**. Switching changes the receiving warehouse and its return station, then loads the return. If every unit is already in, the screen reads **Nothing left to receive**.

## Save progress or close short

- **Save progress** keeps what you scanned. The RMA stays open as **Started** so you can finish later.
- **Complete return** with units missing asks **Close as short?** The units not received are closed as short and the RMA moves to **Completed**. Add an optional reason, for example "Customer kept 2 units", and select **Close as short**. Select **Keep receiving** to go back.

A supervisor can reopen a short-closed RMA from the RMA page to receive the rest.

Select **Scan another RMA** to start over without saving.

## Receive a manual return

Use this when there is no RMA in the box.

1. Select **Return manually**.
2. Choose the client.
3. Optionally select **Link a shipped order** to tie the return to the original order.
4. Enter the **Customer name** (who sent it back) and a **Note**, for example "No RMA in the box".
5. Scan each product in **Scan product** and set its condition.
6. Select **Complete manual return**.

KitStak creates a Manual RMA and receives it in one step.

## If the page closes mid-receive

When the browser closes before the server confirms a receive, the station shows **Receiving** the RMA **was interrupted** the next time. Select **Open the RMA** to check what was saved, or **Dismiss**.

## Related pages

- [Return rules and dispositions](/docs/wms/return-rules-and-dispositions)
- [Return orders and RMA statuses](/docs/wms/return-orders-overview)
- [Create an RMA](/docs/wms/return-create-rma)
