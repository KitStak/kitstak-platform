---
title: Work order types, statuses and creation
description: Create a kitting work order with or without picking, build for stock or for a shipment order, allocate components with a picking job, and follow its status.
section: Work orders and kitting
order: 10
---

A work order tells the kitting team which kit to build and how many. It names the kit SKU, the quantity and where the components come from. With picking, a job brings the components to the kitting area first. Without picking, the components are taken straight from the source locations you choose. Building the kits is covered in [Build kits from a work order](/docs/wms/kit-build).

## Before you start

- The kit must be a product with a bill of materials (its components and quantities).
- For work orders with picking, the warehouse needs a job type with the **Work Order** operation. See [Picking job types and batch templates](/docs/wms/job-types-for-picking).
- You need permission to create work orders.

## Work order types

| Type | How components reach the kitting area |
| --- | --- |
| **Work Order with Picking** | Components are allocated and picked to the kitting area by a job. |
| **Work Order without Picking** | Components are consumed straight from the source you choose for each one. |

## Work order statuses

| Status | Meaning | What moves it |
| --- | --- | --- |
| **Open** | Created. Nothing is allocated. | **Picking/job operations** allocates components, or kits are built without picking. |
| **Shortage** | Components are short. | Allocating again when stock is free. |
| **In Process** | Components are allocated or kitting has started. | Building every requested kit completes it. |
| **Completed** | Every requested kit is built. | Nothing. |
| **Cancelled** | Cancelled before any kit was built. | Nothing. Read only. |

**Cancel picking** takes an **In Process** work order back to **Open** as long as no kit has been built.

## Create a work order

1. Go to **Inventory > Work Orders**.
2. Select **Create work order**.
3. Fill in **General**, **Kit**, **Advanced** and **Other Info**.
4. Select **Save**.

### General

| Field | What it does | Required |
| --- | --- | --- |
| **Warehouse** | Where the kits are built. | Yes |
| **Client** | The client that owns the kit. | Yes |
| **Work order code** | Generated from the code sequence. Letters, numbers, dot, dash, slash or underscore, up to 40 characters. | Yes |
| **Work order type** | With or without picking. | Yes |
| **Extra note** | Up to 1000 characters. | No |
| **Build for** | **Stock** to build ahead of demand, or **SO** to build for one shipment order. Defaults to **Stock**. | Yes |
| **Shipment order** | The order the kits are for. | Yes, when Build for is SO |

### Kit

1. Choose the **Kit SKU**. The card shows its pack type and whether lot, expiry and production date tracking are on.
2. Enter the **Kit quantity**, from 1 to 100,000 whole kits.
3. For **Work Order without Picking**, every component needs a source. Select the pencil on a component to choose the location, LP and lot, or select **Auto-assign all sources** to pick FEFO or FIFO sources. Locations locked by a count plan can't be used.

### Advanced

Enter **Kitting instructions** (steps, packaging and quality checks), the **Planned start date** and **Planned finish date**, and upload documents. **Actual start date** and **Actual finish date** are stamped when kitting starts and finishes; you can correct them after the work order is created. Planned finish must be after planned start.

### Other Info

Custom fields for work orders.

## Allocate components with a picking job

For **Work Order with Picking**:

1. Select the work orders in the grid.
2. Open **Warehouse ops** and choose **Picking/job operations**.
3. Review each work order: components allocate and a picking job is created, or short components mark it **Shortage**.
4. Choose the **Job type** (Work Order job types of this warehouse), and optionally **Assign to** and **Priority**.
5. Select **Create job**. If nothing can allocate, the button reads **Mark shortage**.

Only **Open** or **Shortage** work orders with picking can be allocated.

## Other actions

| Action | Rule |
| --- | --- |
| **Cancel picking** | Releases allocations and cancels the picking job. Only In Process or Shortage work orders with picking, before any kit is built. |
| **Cancel work order** | Not for Completed or Cancelled work orders, or once kits were built. |
| **Delete** | Only Open work orders with no kits built. |
| **Edit** | Core fields lock once the work order leaves Open. Notes, instructions, dates and custom fields can still change. Cancelled work orders can't be edited. |
| **Print picking list** and **Batch picking list** | Work orders with picking only. |

## Read a work order

Open a work order to see tiles for kits left to build, components and the job, and the tabs **Components**, **Job & tasks**, **Receipts**, **Transactions**, **Exceptions**, **Documents** and **Activity**.

## Related pages

- [Build kits from a work order](/docs/wms/kit-build)
- [Disassemble kits](/docs/wms/kit-disassemble)
- [Kit inventory and component availability](/docs/wms/kit-inventory)
