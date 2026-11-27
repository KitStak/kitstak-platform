---
title: Return orders and RMA statuses
description: Find and manage return orders (RMAs) in KitStak WMS, read each RMA status, change statuses, cancel or reopen a return, and manage return labels.
section: Returns
order: 10
---

A return order, or RMA, records what a customer is sending back: which shipped order, which lines and how many units. The **Return Orders** list shows one row per RMA line, so you can follow each SKU from the request to the return station. Receiving happens at the **Return Station**.

## Before you start

- You need the Return Orders view permission.
- RMAs are created from shipped orders, or as manual returns at the return station.

## Find a return

1. Go to **Fulfillment > Return Orders**.
2. Use the status pills to filter by status. Counts are return lines: one grid row per RMA line.
3. Search by RMA, order, tracking or SKU.
4. Select a row to open the RMA.

## RMA statuses

| Status | Meaning |
| --- | --- |
| **Pending** | Created; waiting for the customer to ship it back. |
| **In Transit** | The return label was scanned by the carrier. |
| **Started** | Receiving began at the return station. |
| **Completed** | Every line was received, or the return was closed short. |
| **Cancelled** | Closed without receiving. Can't be received. |

| From | Can move to |
| --- | --- |
| **Pending** | **Started**, **In Transit**, **Cancelled** |
| **In Transit** | **Started**, **Completed**, **Cancelled** |
| **Started** | **Completed**, **Cancelled** |
| **Completed** | **Started**, only when the return was closed short |
| **Cancelled** | Nothing |

## Change the status

1. Select the return lines and choose **Change status**, or open the RMA and use **Change status**.
2. KitStak lists only the statuses allowed for the selection. Choose one.
3. Optionally say why the status is changing.
4. Save.

The status is set per RMA, so selecting one line moves its whole RMA. Completed and cancelled returns can't be changed this way.

## Read an RMA

The page title reads **Return Order** and the RMA code. It shows whether it is a **Customer RMA** or a **Manual return**, and has four tabs:

- **Lines & receipts**: requested lines and every receipt made at the station.
- **Photos & documents**: photos taken while receiving, and attached files.
- **Return label**: tracking, carrier, service, cost, label status and created date.
- **History**: every change.

## Cancel a return

Open the RMA and select **Cancel**. The return is cancelled and can't be received.

## Reopen a short-closed return

When a return was completed before every unit arrived, the RMA shows **Closed short** with the number of units not received.

1. Select **Reopen to receive the rest**.
2. Say why the return is reopened. A reason is required.
3. Confirm.

The RMA goes back to **Started** so the rest can be received at the return station.

## Return labels

Open **Label** on the list, or **Return label** on the RMA:

- **Create return label**: a prepaid label for the customer. On an RMA that already has one, **Create new return label** buys a new label and replaces the tracking number.
- **Reprint return label**: opens the label file.
- **Void return label**: voids with the carrier and clears tracking.

Manual returns have no shipment order, so they can't get a return label.

## Other actions

- **Bulk update return info** sets the return carrier, shipping option, cost and tracking numbers for several returns.
- **Tag** adds tags to the selected lines.
- **Return station** opens the station. **Receive at station** in the row menu opens it on that RMA.

## Related pages

- [Create an RMA](/docs/wms/return-create-rma)
- [Receive returns at the return station](/docs/wms/return-station-receive)
- [Return rules and dispositions](/docs/wms/return-rules-and-dispositions)
