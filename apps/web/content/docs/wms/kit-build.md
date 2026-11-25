---
title: Build kits from a work order
description: Use Create kit to turn a work order's components into kit stock, set the target location, lot and dates, build in full or in part, and print kit barcodes.
section: Work orders and kitting
order: 20
---

**Create kit** consumes the components of a work order and receives the finished kits into a target location. You can build every requested kit at once or build in parts; the work order completes when the last kit is built. The dialog checks that the components are where they should be before anything changes.

## Before you start

- Create the work order. See [Work order types, statuses and creation](/docs/wms/work-order-create).
- For **Work Order with Picking**, run **Picking/job operations** and pick the components to the kitting area first.
- You need the Create Kit permission.

## When Create kit is available

| Situation | Message |
| --- | --- |
| The work order is completed | This work order is already completed |
| The work order is cancelled | Cancelled work orders can't build kits |
| The work order is in Shortage | Components are short; allocate them first |
| With picking, still Open | Run Picking/Job Operations first to allocate the components |
| With picking, picks not finished | Components not yet picked to kitting area, with the count picked |
| Every kit is built | Every requested kit is built |
| A source is locked by a count plan | Finish, update or cancel the count first |

Select exactly one work order to build kits.

## Build kits

1. Go to **Inventory > Work Orders**.
2. Select the work order and select **Create kit**.
3. On **Confirmation**, review the components. Each one shows **Component qty** (per kit), **Total qty** and where it comes from: **Reserved for this WO**, **In kitting area**, **Available at source** or **Usable (unlocked bins)**.
4. When components are FEFO-picked, scan the bin or LP you are taking them from in **Source location / LP**.
5. On **Information**, fill in the fields below.
6. On **Summary**, check the kit, quantity, target and lot, then select **Save**.

| Field | What it does | Required |
| --- | --- | --- |
| **Kit quantity** | How many kits to build now. At least 1, up to what is left. | Yes |
| **Target location** | Where the finished kits go. | Yes |
| **Target LP** | An LP to receive the kits into. | No |
| **Lot number** | The kit's lot. | When the kit tracks lots |
| **Expiry date** | The kit's expiry date. | When the kit tracks expiry |
| **Production date** | The kit's production date. | When the kit tracks production date |
| **Actual start** and **Actual finish** | Stamped on the work order. Finish must be after start. | No |

## Partial builds

Enter fewer kits than requested to build in parts. The work order stays **In Process** and the summary shows the finish as **Not set (partial build)**. The next **Create kit** continues from what is left. The build that reaches the requested quantity completes the work order.

## Pending picks

For a work order with picking whose picks are not all done, a supervisor with picking permission still sees **Create kit**. The dialog lists the open picking tasks and asks you to tick **Complete pending picks and build** before it builds.

## Print kit barcodes

On **Summary**, select **Print kit barcode** to print labels for the kits you just built.

## Preview a build from Kit Inventory

In **Inventory > Kit Inventory**, choose **Create Kit (Preview)** on a kit to see what a build would need. Enter the **Quantity** and check the **Inventory preview**. Kit-to-order kits are built during fulfillment, not by work orders.

## Related pages

- [Disassemble kits](/docs/wms/kit-disassemble)
- [Kit inventory and component availability](/docs/wms/kit-inventory)
