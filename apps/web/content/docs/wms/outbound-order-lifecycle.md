---
title: Outbound order lifecycle and statuses
description: How a shipment order moves from Open to Shipped in KitStak WMS, which step changes each status, and where to act on the order at every stage.
section: Outbound
order: 10
---

Every outbound order in KitStak WMS is a shipment order. It starts **Open**, gets stock allocated, is picked, optionally sorted, packed and loaded, and ends **Shipped**. This page walks through the whole path and the status at each stage, so you know which screen to open next.

## Before you start

- Products, a warehouse, locations and a client must exist. See [KitStak WMS](/docs/wms) for setup.
- At least one picking job type must exist for the warehouse. See [Picking job types and batch templates](/docs/wms/job-types-for-picking).
- An active allocation algorithm decides which stock an order reserves. See [Allocation algorithms and dry run](/docs/wms/allocation-algorithms).

## The order lifecycle at a glance

1. **Create.** An order arrives from a sales channel, an import or **Create shipment order**. It is **Open**. See [Create and edit a shipment order](/docs/wms/order-create-shipment-order).
2. **Screen.** Active workflows run on the new order. They can block it, set its carrier service, add tags and more. See [Build workflows and test them against an order](/docs/wms/workflow-rules).
3. **Allocate and batch.** A wave rule or **Picking / job operations** allocates stock and puts the order into a picking job. Fully allocated orders become **Ready to Pick**. Orders without enough stock become **Shortage**. See [Create and run wave rules](/docs/wms/wave-rules) and [Create picking jobs from orders](/docs/wms/job-create-picking-jobs).
4. **Pick.** Pickers execute the picking tasks. The order moves to **Picking Started**. See [Execute picking tasks and handle pick shorts](/docs/wms/pick-execute-picking-tasks).
5. **Sort.** Only when the job type creates sorting tasks: **Ready to Sort**, then **Sorting Started**.
6. **Pack.** The order waits at **Ready to Pack** and becomes **Packing Started** at the packing station. See [Pack an order at the packing station](/docs/wms/pack-orders).
7. **Load.** Only when the job type creates loading tasks: **Ready to Load**, then **Loading Started**.
8. **Ship.** A packed order with a label is **Ready to Ship**. **Ship order** moves it to **Shipped** or **Partially Shipped**. See [Ship orders](/docs/wms/ship-orders).

## Shipment order statuses

| Status | What it means | What moves it on |
| --- | --- | --- |
| **Open** | The order exists. No stock is allocated yet. | Allocation by a wave or by **Picking / job operations**. |
| **Shortage** | Allocation could not reserve every unit. | Retry allocation, create a backorder, or cancel. |
| **Ready to Pick** | Stock is allocated and picking tasks wait. | The first picking task starts or completes. |
| **Picking Started** | At least one picking task has started or completed. | All picking tasks complete. |
| **Ready to Sort** | Picking is done and sorting tasks wait. | A sorting task starts. |
| **Sorting Started** | Sorting is under way. | All sorting tasks complete. |
| **Ready to Pack** | Picked (and sorted) units wait for a packer. | A packer opens the order at the packing station. |
| **Packing Started** | The packer is working on the order. | **Complete packing** on the pack screen. |
| **Ready to Load** | Packed and waiting for loading tasks. | A loading task starts. |
| **Loading Started** | Loading is under way. | All loading tasks complete. |
| **Ready to Ship** | Packed, labeled and ready to hand to the carrier. | **Ship order**, a shipment plan **Ship**, or auto ship. |
| **Partially Shipped** | Packed units shipped; the rest stay in the backlog. | The remaining units ship. |
| **Shipped** | Every unit left the warehouse. | Delivery is recorded for the order. |
| **Delivered** | The order reached the customer. | Nothing. This status is final. |
| **On Hold** | Someone put the order on hold. | **Release hold** returns it to its previous status. |
| **Cancelled** | The order was cancelled with a cancel reason. | Nothing. This status is final. |

The steps after picking follow the job type. A job type with **Create sorting task** adds the sort stage. A job type with **Create loading task** adds the load stage. When a stage has no tasks, the order skips it and moves straight to the next one.

## Rules the system enforces

- Only **Open**, **Shortage**, **Ready to Pick** and **On Hold** orders can be cancelled, and a cancel reason is required.
- An order can be put on hold from **Open**, **Shortage**, **Ready to Pick**, **Ready to Sort**, **Ready to Pack**, **Ready to Load** or **Ready to Ship**.
- An order on hold returns to the status it had before the hold. You can't release it into another status.
- Once picking has started, the order can't go back. The message reads "Picking has started for this order. Complete or cancel its job first."
- **Cancelled** and **Delivered** orders can't be changed.

## Where to find orders

- **Fulfillment > Shipment Orders** opens the **Order Backlog** tab with every order that has not shipped.
- **Fulfillment > Shipped & Canceled Orders** lists closed orders. It opens filtered to the last 7 days of actual shipment date.
- **Fulfillment > Return Orders** lists RMAs. See [Return orders and RMA statuses](/docs/wms/return-orders-overview).

On a phone, the backlog shows each order as a card. The header keeps a compact **New order** button and a **More order actions** menu with **Refresh** and the imports.

## Related pages

- [Hold, release, cancel and delete orders](/docs/wms/order-holds-and-cancellations)
- [Shortages and backorders](/docs/wms/order-shortages-and-backorders)
- [Manage jobs in Job Management](/docs/wms/job-management)
- [Plan truck loads with shipment plans](/docs/wms/ship-shipment-plans)
