---
title: Kit inventory and component availability
description: See how many kits you have, how many you can build now and how many open orders need, then check component stock and reorder what is short.
section: Work orders and kitting
order: 40
---

Two pages answer the kitting questions: how many kits are on hand and buildable, and which components hold you back. **Kit Inventory** shows each kit with its stock, demand and kitting capacity. **Kit Component Inventory Availability** shows each component with its demand across kits, orders and work orders, and a reorder quantity.

## Before you start

- Kit SKUs need their components set up on the product.
- You need the Kit Inventory and Kit Component Inventory views.

## Kit types

| Kit type | Meaning |
| --- | --- |
| **Kit to Stock** | Built ahead of demand by a work order and stocked. |
| **Kit to Order** | Assembled while the order is fulfilled; capacity shown for planning. |

## Open Kit Inventory

1. Go to **Inventory > Kit Inventory**.
2. Use the kit type filter: **All kits**, **Kit to Stock** or **Kit to Order**.

| Column | What it shows |
| --- | --- |
| **Required Kitting Quantity** | Pending order quantity minus current kit stock, never below zero. Shown in red when it is more than you can build now. |
| **Net Kitting Capacity** | Kits you can build now: the smallest whole number of kits any one component allows. Stock in count-locked or allocation-blocked locations is excluded. |
| **Current Inventory Quantity** | Undamaged kit stock on hand. |
| **Pending Order Quantity** | Kit units on open shipment orders (not shipped or cancelled). |
| **Total Inventory Capacity** | Net kitting capacity plus current kit stock. |
| **Kit Type**, **Barcode**, **Pack Type Name**, **Product Type**, **Product Group** | Product details. |

The header shows **Last updated** with the time of the last calculation. Select **Recalculate Now** to refresh the numbers.

## Act on a kit

Row actions:

- **Open Product**, **View Components**, **Component Availability** and **Work Orders for This Kit**.
- **Create Kit (Preview)**: see what a build of a given quantity would use.
- **Disassemble Kit**: needs free kit stock in the warehouse. See [Disassemble kits](/docs/wms/kit-disassemble).
- **Create Work Order**: opens the work order form for the kit.

To create a work order from the toolbar, select one kit and select **Create Work Order**. Kit-to-order kits are built during fulfillment, not by work orders, so the button is unavailable for them.

## Open Kit Component Inventory Availability

1. Go to **Inventory > Kit Component Inventory**.
2. Filter by warehouse, client or component SKU.

| Column | What it shows |
| --- | --- |
| **Component SKU** and **Component Product Name** | The component. |
| **Included Kits** | The kits that use it. |
| **Total Order Quantity** | Open shipment order demand for the component, plus kit demand times the bill of materials quantity, plus open work order needs. |
| **Total Inventory Quantity** | Undamaged stock on hand. |
| **Total Available Inventory Quantity** | On hand minus allocated. |
| **Reorder Quantity** | Total order quantity minus total available, never below zero. |

When **Reorder Quantity** is above zero, select it, or choose **Create Purchase Order** in the row menu, to start a purchase order for the component.

## Related pages

- [Work order types, statuses and creation](/docs/wms/work-order-create)
- [Build kits from a work order](/docs/wms/kit-build)
