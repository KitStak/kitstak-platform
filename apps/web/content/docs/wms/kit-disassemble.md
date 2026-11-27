---
title: Disassemble kits
description: Break kit stock back into its components, from a work order or straight from kit inventory, and choose where the components go with their lots and dates.
section: Work orders and kitting
order: 30
---

**Disassemble kit** reverses a build. It takes kits out of stock and puts their components back into a location you choose, using the kit's bill of materials. You can disassemble kits that a work order built, or any free kit-to-stock kit in the warehouse.

## Before you start

- You need the disassemble permission.
- There must be free stock of the kit in the warehouse.

## Disassemble from a work order

1. Go to **Inventory > Work Orders**.
2. Select one work order that has built kits.
3. Select **Disassemble kit**.
4. On **Select kit**, choose the kit stock in **Source location / LP**.
5. Enter the **Kit quantity**.
6. Choose the **Target location** for the components, and optionally a **Target LP**.
7. Review the components and select **Save** on **Summary**.

A cancelled work order, or one that built no kits, can't be disassembled. With such a selection, **Disassemble kit** opens the disassembly from stock described below. On the work order page, the action is unavailable once every kit built by the work order was already disassembled.

## Disassemble kit stock without a work order

1. Go to **Inventory > Work Orders** and select **Disassemble kit** with no work order selected (disassemble kit-to-stock kits from stock). You can also choose **Disassemble Kit** on a row in **Inventory > Kit Inventory**.
2. Choose the **Warehouse**, **Client** and **Kit**.
3. Continue with steps 4 to 7 above.

If the warehouse has no free stock of the kit, the kit field reads "No free stock of this kit in the warehouse".

## Fields

| Field | What it does | Required |
| --- | --- | --- |
| **Source location / LP** | The kit stock to take apart. | Yes |
| **Kit quantity** | How many kits to disassemble. At least 1. | Yes |
| **Target location** | Where the components go. | Yes |
| **Target LP** | An LP for the components. | No |
| **Lot number**, **Expiry date**, **Production date** | Per component, for tracked components. | When the component tracks it |

The component list shows, for each SKU, the **Component SKU qty** per kit, the **Component total qty** for the quantity you entered and the **Stock qty at target**. Use the edit icon on a component to change its lot or dates, and the print icon to print its barcode.

## What happens

- The kits leave the source location.
- Each component is received into the target with the quantities from the bill of materials.
- A toast confirms **Kit disassembled**.

## Related pages

- [Build kits from a work order](/docs/wms/kit-build)
- [Kit inventory and component availability](/docs/wms/kit-inventory)
