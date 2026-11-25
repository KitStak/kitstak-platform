---
title: Total inventory and available to promise
description: Read stock totals per SKU and warehouse in KitStak WMS, and see what you can promise today and once open purchase orders arrive.
section: Inventory and locations
order: 40
---

Two read-only pages answer "how much do we have". **Total Inventory** shows one row per SKU and warehouse, with an **All Warehouses** total. **Available To Promise (ATP)** shows how much you can promise from stock today, and how much once open purchase orders arrive. Both pages follow the working context in the header.

## Before you start

- **Total Inventory** needs the **View** permission on **Total Inventory**.
- **Available To Promise (ATP)** needs the **View** permission on **ATP**.

## Open Total Inventory

1. Go to **Inventory > Total Inventory**, or press `G` then `I`.
2. Search with **Search by SKU**, or add filters.
3. Select **Shortage** to show only rows where **Available UOM Qty** is below 0. Select it again to show every row.

Products appear as soon as they are created, even before stock arrives. The SKU and the **Open SO Qty** link open the product and the open orders in a new tab. **By Location** opens the stock rows in **Inventory by Location**.

## Total Inventory columns

| Column | Meaning |
| --- | --- |
| **Warehouse** | The warehouse, or **All Warehouses** for the total. |
| **Client**, **SKU**, **Product Name** | The product. |
| **UOM Quantity** | On-hand quantity in the product's primary (UOM) unit. |
| **Available UOM Qty** | Total Quantity minus Open SO Qty. Negative when open orders exceed stock. |
| **Total Quantity** | Every on-hand unit in every status (Stock, Picked, Packed and so on), damaged included. |
| **Open SO Qty** | Units still to ship on open shipment orders: ordered minus cancelled minus shipped. |
| **Undamaged Quantity** | Total Quantity minus Damaged Qty. |
| **Undamaged Available UOM Qty** | Undamaged Quantity minus Open SO Qty. |
| **Damaged Qty** | Units carrying a damage reason. |
| **Kit Type**, **Product Type**, **Product Group** | Product attributes for filtering. |

## Open Available To Promise

1. Go to **Inventory > Available To Promise (ATP)**.
2. Search with **Search by SKU or barcode**, or add filters.
3. Select **Shortage** to show only rows where **Current ATP** is below 0.

The grid opens with the warehouse from the header context, or every warehouse you can see.

## ATP columns

| Column | Meaning |
| --- | --- |
| **Total Quantity** | Every on-hand unit in the warehouse, damaged included. |
| **Damaged Qty** | Units carrying a damage reason. |
| **Undamaged Quantity** | Total Quantity minus Damaged Qty. |
| **Allocated SO Item Qty** | Units allocated to open shipment orders. |
| **Open SO Qty** | Units still to ship on open shipment orders. |
| **Open PO Qty** | Units still to receive on open purchase orders. |
| **Current ATP** | Undamaged Quantity minus Open SO Qty. What you can promise from stock today. |
| **Planned ATP Qty** | Current ATP plus Open PO Qty. What you can promise once open POs arrive. |
| **On Hand Qty** | Every unit physically on hand, damaged included. |
| **Sellable Qty** | Undamaged units in locations that sync inventory to channels, minus Open SO Qty. The quantity published to sales channels. |
| **Pickable Qty** | Unallocated, undamaged stock in active, unlocked locations that allow allocation. |

Point at a column header to see its formula in the app.

## Example

A SKU has 100 units on hand, 4 of them damaged. Open orders need 30 units, and an open PO brings 50 more.

- **Undamaged Quantity** is 96.
- **Current ATP** is 96 minus 30, so 66.
- **Planned ATP Qty** is 66 plus 50, so 116.

## Export

Select **Export As Excel** to download either grid. The file appears in **Transactions**.

## Related pages

- [Inventory by location](/docs/wms/inventory-by-location)
- [Manage the product catalog](/docs/wms/products)
- [Purchase orders](/docs/wms/purchase-orders)
