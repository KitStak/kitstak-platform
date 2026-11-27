---
title: Plan truck loads with shipment plans
description: Group orders onto a truck with a shipment plan, track loading from Open to Shipped, print the Manifest / BOL, create labels and ship the whole plan at once.
section: Packing and shipping
order: 80
---

A shipment plan is one truck load: the orders that go on it, the carrier, the truck plate and the loading gate. Use it for B2B and freight shipments that leave together. The plan tracks loading, prints the Manifest / BOL, and ships every ready order on the truck with one action.

## Before you start

- You need the Shipment Plan view permission. Creating, editing, shipping, printing and creating jobs each need their own permission.
- Orders on a plan must belong to the plan's warehouse. An order can be in only one active shipment plan.

## Create a shipment plan

1. Go to **Fulfillment > Shipment Plan**.
2. Select **Create shipment plan**.
3. Fill in **General**, then **Others**, then **Orders**.
4. Select **Save plan**.

If you save without orders, KitStak asks **Save a plan with no orders?** The plan can't be picked, loaded or shipped until you add orders.

### General

| Field | What it does | Required |
| --- | --- | --- |
| **Shipment plan code** | Up to 40 characters. | Yes |
| **Warehouse** | Where the truck loads. | Yes |
| **Client** | The client the plan is for. | No |
| **Carrier** | A carrier set up for the warehouse. | No |
| **Truck plate number** | For example `7KTR412`. | No |
| **Loading gate** | A dock or staging location. | No |
| **Status** | Only the legal next statuses are offered. Use **Ship** to ship the plan. | Yes |
| **Prevent LPN edit during loading** | Stops LPN changes while the truck is loading. | No |
| **Planned shipment date** | When the truck should leave. | No |
| **Loading started date**, **Loading completed date** | Stamped when the status moves. You can correct them; the change is logged. | No |
| **Truck departed date** | When the truck left the gate. Ship stamps it if empty. | No |
| **Expected total weight** and **Expected total volume** | Computed from the orders you add. | No |
| **Note** | Up to 2000 characters. | No |

Loading can't complete before it started, and the truck can't depart before loading completed.

### Others

Under **Consignee**, choose the **Customer** (type at least 3 characters), the **Customer address** and the **Retailer**.

### Orders

Select **Add order(s)** and pick orders from the warehouse. Orders already in another active plan are skipped.

## Shipment plan statuses

| Status | Meaning |
| --- | --- |
| **Open** | Created. Only Open plans can be deleted. |
| **In Progress** | Set on the **Status** field once work on the plan begins. |
| **Loading Started** | The truck is being loaded. |
| **Loading Completed** | Loading is done. **Truck departed** records the departure time. |
| **Shipped** | Every order on the plan shipped. Read-only. |
| **Cancelled** | Read-only. Its orders are released and can join another plan. |

## Work on a plan

Open a plan from the list. The header shows the lifecycle, and the tiles show **Orders**, **Loaded** and **Shipped**. The tabs are **Orders**, **License plates** and **History**.

- **Picking/job operations** puts the plan's unshipped orders into picking jobs.
- **Create label for order(s)** buys labels for the plan's orders.
- **Add order(s)** adds more orders while the plan is not shipped or cancelled.
- **Manifest / BOL** prints the manifest and bill of lading.
- **Edit** changes any tab. Shipped and cancelled plans can't be edited.

## Ship the plan

1. Select **Ship** on the plan, or select plans in the list and choose **Ship**.
2. Confirm **Ship this shipment plan?**

Every **Ready to Ship** order in the plan is shipped and leaves inventory. Orders that are not Ready to Ship yet, or have no active label, are reported and not shipped. A plan becomes **Shipped** once all of its orders are.

Ship is unavailable when the plan has no orders, when none of its orders are Ready to Ship yet, or when the ready orders have no shipping label.

## Related tabs

- **Shipment Plan Orders** lists every order on every plan.
- **Shipment Plan LPs** lists the license plates used for plan orders.

## Related pages

- [Ship orders](/docs/wms/ship-orders)
- [Create picking jobs from orders](/docs/wms/job-create-picking-jobs)
- [End of the day manifests and carrier pickup](/docs/wms/ship-end-of-day-and-pickup)
