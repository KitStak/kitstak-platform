---
title: Create an RMA
description: Create a return order from a shipped shipment order, choose the items and quantities, add return reasons, and buy a prepaid return label or record the customer's.
section: Returns
order: 20
---

An RMA tells the return station what to expect. You start from a shipped order, choose the lines and quantities coming back, give a reason for each, and decide how the parcel travels: a prepaid label you buy now, or tracking the customer or marketplace provides. The new RMA is **Pending** until it is received.

## Before you start

- The order must be **Shipped**, **Partially Shipped** or **Delivered**. RMAs can only be created for shipped orders.
- Return reasons come from Data Setup. If there are none, the reason field reads **No reasons set up**.
- To buy a return label you need the Create Return Label permission and a carrier for the order's warehouse.

## Start an RMA

Use either path:

- Go to **Fulfillment > Return Orders** and select **Create RMA**, then choose the order.
- Go to **Fulfillment > Shipped & Canceled Orders**, select the shipped orders and select **Create RMA**.

The wizard has three steps: **Order**, **Items** and **Return shipping**. The **Return summary** rail on the right shows the order, customer, lines, units, expected date, return address and label choice as you go.

## Step 1: Order

1. Select **Choose a shipped order**.
2. Search and pick the order. The card shows the store order number, shipped date and delivery date.

If the order can't be returned, the step shows **This order can't be returned** with the reason. **Next** stays unavailable until a returnable order has loaded.

## Step 2: Items

1. Check each line that is coming back. Use the header box to select every returnable item.
2. Enter the return quantity.
3. Choose a return reason for each selected line.

| Field | Rule |
| --- | --- |
| Line check box | Select at least one item to return. |
| Return quantity | At least 1, and no more than the units shipped minus units already returned. |
| Return reason | Required for every selected line. |

Lines that can't come back show **Marked non-returnable** or **Fully returned**.

## Step 3: Return shipping

Set the **Expected return date** if you know it. Then choose one:

- Turn on **Create return label** and choose the **Return carrier** and **Return service**. Both are required. KitStak buys the label when you save.
- Leave it off and record the return shipping the customer or marketplace provides: **Return address**, **Return carrier**, **Return shipping option**, **Return shipping cost** and **Return tracking numbers**. No label is bought.

Add a **Note** for the return station, for example what to check on arrival.

## Save

Select **Create RMA**. The RMA is created in **Pending**. The success panel offers:

- **View RMA**: lines, label and timeline.
- **Print return label**: opens the label PDF, when one was bought.
- **Create another RMA**.
- **Open return station**: receive returned items.

If the label fails, the RMA is still created without a label and the panel shows the carrier's message. You can create the label later from the RMA.

## Validation messages

| Message | Meaning |
| --- | --- |
| Choose a shipped order | No order is selected. |
| Select at least one item to return | No line is checked. |
| Choose a return reason | A selected line has no reason. |
| Enter at least 1 | The quantity is 0. |
| Enter a valid cost | The return shipping cost is not a number. |

## Related pages

- [Return orders and RMA statuses](/docs/wms/return-orders-overview)
- [Receive returns at the return station](/docs/wms/return-station-receive)
