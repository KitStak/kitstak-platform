---
title: Manage locations
description: Find, filter, lock, unlock, label and delete warehouse locations in KitStak WMS, and use zones, location groups and the location detail page.
section: Inventory and locations
order: 10
---

A location is any place that holds stock: a bin, a shelf, a rack position, a receiving door or a packing station. The **Locations** page lists every location in the warehouses you can see, with a strip of zones on top. From here you create, generate, import, lock, label and delete locations.

## Before you start

- You need the **View** permission on **Locations**. Creating, editing, deleting, importing, labels and capacity each have their own permission.
- Create the warehouse first. See [Set up your warehouse step by step](/docs/wms/setup-sequence).

## Open the locations list

1. Go to **Settings > Master Data > Locations**, or press `G` then `L`.
2. Search with **Search location code or barcode**, or add filters.
3. Select a row to open the location detail page.

Columns include **Location code**, **Cell display member**, **Location barcode**, **Warehouse**, **Location group**, **Location zone**, **Location type**, **Replenishment type**, **Area type**, **Assigned mobile cart**, **ABC code** and **Dedicated client**. **Level**, **Mezzanine**, **Aisle**, **Rack**, **Position**, **Column**, **Height** and **Volume** are hidden until you turn them on in **Columns**.

## Zones

The zone strip above the grid shows each location zone with how many bins are occupied and how many units it stores. Select a zone to filter the grid to it, and select it again to clear the filter.

Location zones and location groups are lists you keep in **Setup**:

- **Location groups**: create, edit and delete location groups.
- **Location zones**: zones within a warehouse, used by picking and putaway.
- **Mobile cart types**: levels, columns, dimensions and operation.

## Header buttons

| Button | What it does |
| --- | --- |
| **Create location** | Opens the location wizard. See [Create a location](/docs/wms/create-location). |
| **Generate locations** | Builds many locations from a pattern. See [Generate a rack layout](/docs/wms/generate-locations). |
| **Import** | **Bulk import locations** to add new ones, **Bulk update locations** to change existing ones by code. |
| **Assign capacity** | Excel imports for product and LP capacity: **Bulk import product capacity**, **Bulk update product capacity**, **Bulk import LP capacity**, **Bulk update LP capacity**. |
| **Setup** | Opens the location masters above. |

On a phone, these fold into **More** next to **Create**.

## Lock or unlock a location

A locked location is skipped by putaway and allocation. Lock a location while you repair a rack or hold its stock.

1. Select the locations.
2. Select **Lock**, or **Unlock**.

Or use **Lock** and **Unlock** in a row's actions menu. You need the **Edit** permission. **Lock** is disabled when every selected location is already locked.

Stock in a locked location can't be put away from it. See [Put away received stock](/docs/wms/putaway).

> **Note:** A count plan with **Lock Locations** turned on also locks its locations while the count is open. That lock lifts by itself when the count is cancelled or posted. See [Count plans](/docs/wms/count-plans).

## Print location labels

1. Select the locations and select **Label**, or choose **Print label** on a row or on the detail page.
2. In **Print location labels**, pick the template and quantity.
3. Select **Preview**, **Download** or **Print**.

## Delete a location

1. Select the locations and select **Delete**, or use **Delete** in a row menu.
2. Confirm. Capacities are removed with the location.

A location can't be deleted when it:

- Holds inventory.
- Has open tasks that pick from it or put into it.
- Has inventory history. Lock it instead.
- Has license plates assigned.
- Is a warehouse's default receiving, ship or return location.

In bulk, locations holding stock or with open tasks are skipped.

## The location detail page

The header shows **Inventory status**, **Stored units**, **SKUs** and **Open tasks**, with **Edit**, **Print label**, **Change log** and **Delete**.

| Tab | What it shows |
| --- | --- |
| **Contents** | Every SKU in the location with **On hand**, **Allocated** and **Damaged**. |
| **Capacity** | **Product capacity** and **LP capacity** with **Min** and **Max**. |
| **Open tasks** | Pending and started tasks that pick from or put into this location. |
| **Ledger history** | Every stock movement in and out. |

The side panel lists **Attributes** and **Location rules**, and shows a **Label preview**.

## Related pages

- [Create a location](/docs/wms/create-location)
- [Generate a rack layout](/docs/wms/generate-locations)
- [Inventory by location](/docs/wms/inventory-by-location)
- [Import data from Excel](/docs/wms/excel-imports)
