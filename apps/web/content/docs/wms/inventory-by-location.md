---
title: Inventory by location
description: See every inventory row in KitStak WMS by location, license plate, lot and status, open its details, and start adjustments and transfers.
section: Inventory and locations
order: 50
---

**Inventory by Location** lists every inventory row: one SKU in one location, with its license plate, lot, expiry date, production date, damage reason and status. It is where you look up exactly where stock is, and where you add, adjust, remove, transfer and change stock.

## Before you start

- You need the **View** permission on **Inventory by Location**.
- Each write action has its own permission: **Add Inventory by Line**, **Adjust Inventory by Line**, **Remove Inventory by Line**, **Change Attributes**, **Transfer LP/Location**, **Transfer Product**, **Add Inventory by Attributes** and **Import File**. Roles without them see a read-only page.

## Open the page

1. Go to **Inventory > Inventory by Location**.
2. Search with **Search SKU, location, LP or barcode**, or add filters.
3. Select a row, or **Show details** in its menu, to open the row details.

## Columns

Shown by default: **Image**, **SKU**, **Location**, **UOM Quantity**, **Expiry Date**, **Inventory Status**, **Damage Reason**, **Receiving Date**, **Warehouse**, **Location Zone** and **LPN**, among others.

Hidden until you add them in **Columns**: **Production Date**, **Product Type**, **Location Type**, **Area Type**, **Replenishment Location Type**, **Walking Path Priority**, **PO Number**, **Parent LP**, **Original LP Number**, **LP Type**, **Parent LP Type**, **Original Parent LP** and **Mobile Cart**.

## Inventory statuses

| Status | Meaning |
| --- | --- |
| **Stock** | In a location and not yet picked. Part of it can still be allocated to orders. |
| **Allocated** | Reserved for an order. |
| **Picked** | Picked for an order. |
| **Sorted** | Sorted for an order. |
| **Packed** | Packed in a shipment. |
| **Loaded** | Loaded for shipping. |

**Add**, **Adjust** and **Remove** work only on **Stock** rows. Other statuses belong to an order in progress.

## Row details

The details drawer has three tabs:

| Tab | What it shows |
| --- | --- |
| **Attributes** | Warehouse, client, barcode, product type and group, inventory status, damage reason and damaged qty, lot, expiry and production date, location with its type, area, group, zone, walking path and replenishment type, LPN and LP type, parent and original LPs, pack type, **UOM quantity**, **Allocated UOM qty**, **Free UOM qty**, PO number, received date and mobile cart. |
| **Allocations** | Each document and job that holds part of the row, with status and quantity. **Nothing allocated** means every unit is free to move, remove or change. |
| **Transactions** | The ledger history of the row. |

## Actions

| Where | Action | See |
| --- | --- | --- |
| Header | **Add Inventory** | [Add, adjust and remove inventory](/docs/wms/adjust-inventory) |
| Header | **Transfer LP/Loc > Transfer LP** or **Transfer Location** | [Move and transfer inventory](/docs/wms/transfer-inventory) |
| Header | **Import** | [Import data from Excel](/docs/wms/excel-imports) |
| Header | **Reports** | Opens inventory reports such as **Transaction History**, **Inventory Snapshot** and **Inventory Aging**. |
| Row menu | **Add**, **Adjust**, **Remove** | [Add, adjust and remove inventory](/docs/wms/adjust-inventory) |
| Row menu | **Transfer product** | [Move and transfer inventory](/docs/wms/transfer-inventory) |
| Bulk | **Transfer Product** | [Move and transfer inventory](/docs/wms/transfer-inventory) |
| Bulk | **Change Attributes** | [Move and transfer inventory](/docs/wms/transfer-inventory) |

## Rows that can't be changed

Bulk actions skip rows they can't act on and tell you which:

- Rows not in **Stock** status: the order is in progress.
- Rows in a location locked by a count plan. The message reads **Location A0102 is locked by count plan CNT-001. Finish, update or cancel the count first.**, with your own codes.
- Rows where every unit is allocated.

When no selected row qualifies, the bulk button is disabled and says why.

## Related pages

- [Add, adjust and remove inventory](/docs/wms/adjust-inventory)
- [Move and transfer inventory](/docs/wms/transfer-inventory)
- [Total inventory and available to promise](/docs/wms/total-inventory-and-atp)
- [Manage locations](/docs/wms/locations)
