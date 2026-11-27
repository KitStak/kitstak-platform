---
title: Create a location
description: Create a single warehouse location in KitStak WMS with its type, area, walking path, capacity, location rules and product or LP capacity.
section: Inventory and locations
order: 20
---

The location wizard creates one location with three steps: **Information**, **Product capacity** and **LP capacity**. Only the first step is required. Use it for one-off locations such as a staging lane, or to fix a location after you generate or import many.

## Before you start

- You need the **Create** permission on **Locations**.
- Create location groups and location zones first if you want to use them. See [Manage locations](/docs/wms/locations).

## Create a location

1. Go to **Settings > Master Data > Locations**.
2. Select **Create location**.
3. Fill in the **Information** step and select **Next**.
4. Optionally add **Product capacity** and **LP capacity**.
5. Select **Create location**.

To start from an existing location, use **Duplicate** in its row menu.

## Identity and placement

| Field | What it does | Required |
| --- | --- | --- |
| **Location code** | The code shown on labels and scans, such as `A-01-02-1`. Up to 60 characters: letters, numbers, dot, dash, slash or underscore. Unique in the warehouse. | Yes |
| **Warehouse** | The warehouse. A location can't move between warehouses later. | Yes |
| **Location group** | A group from your location group list. | No |
| **Location zone** | A zone from your location zone list. | No |
| **Location type** | **Racks**, **Shelves**, **Bins**, **Virtual**, **BusinessStation** or **Ramps**. | Yes |
| **Area type** | **Picking**, **Storage**, **Receiving**, **Returns**, **Packing**, **Shipment**, **Kitting** or **Loading**. Drives which workflows can use the location: putaway, pick, pack, ship. | Yes |
| **Replenishment location type** | **Source** or **Target** for replenishment. | No |
| **Walking path priority** | Pick-path sequence. Lower numbers are visited first. | No |
| **Location capacity type** | **None**, **Maximum Unit Quantity** or **Maximum Pack Quantity**. | Yes |
| **Maximum capacity quantity** | The limit for the capacity type. Must be above 0 when a capacity type is set. | When a capacity type is set |
| **Maximum SKU quantity** | How many different SKUs the location may hold, up to 10,000. | No |

## Dimensions

| Field | What it does |
| --- | --- |
| **Mezzanine**, **Aisle**, **Rack**, **Column**, **Level**, **Position** | Where the location sits in the rack. |
| **Dimension unit**, **Height**, **Width**, **Length** | Inside size of the location. |
| **Volume unit**, **Volume** | Usable volume. Putaway can compare it with the LP volume. |

## Other information

| Field | What it does |
| --- | --- |
| **Cell display member** | A display name for the location. |
| **Location barcode** | A barcode other than the code, if your labels use one. |
| **ABC code** | **None**, **A**, **B** or **C**. |
| **Color code** | A color for the location. |
| **Single client** | Dedicates the location to one client. Pick the **Client**. |
| **Lock location** | Locked locations are skipped by putaway and allocation. |
| **Print & apply on packing** | Marks the location for print and apply at packing. |

Your company's custom fields for locations also show here.

## Location rules

Tick the rules the location must follow:

| Rule | Effect |
| --- | --- |
| **Prevent allocation** | Stock here is never allocated to orders. |
| **Prevent inventory sync to stores** | Excluded from channel inventory feeds. |
| **Only 1 lot number** | Blocks mixing lots in this location. |
| **Only damaged items** | Only damaged stock may be put here. |
| **Only 1 expiration date** | Blocks mixing expiry dates. |
| **Only 1 SKU** | A second SKU is rejected on putaway and transfer. |
| **Only 1 LP** | One license plate at a time. |
| **Only 1 production date** | Blocks mixing production dates. |
| **Auto remove LP after replenishment** | The LP is released when replenishment lands. |
| **Auto remove LP after transfer** | The LP is released when stock is transferred in. |

## Product capacity

Add a min and max per SKU to make the location a replenished pick face.

1. On the **Product capacity** step, select **Add capacity**.
2. Choose the **Client**, **Product** and **Pack type**, and enter **Min qty** and **Max qty**.
3. Save the row.

Max qty must be above 0 and at least the min qty. A product and pack type can have only one capacity per location.

## LP capacity

Limit how many pallets or totes of each LP type fit in the location.

1. On the **LP capacity** step, select **Add capacity**.
2. Choose the **LP type** and enter **Min qty** and **Max qty**. You can also limit it to one **Product SKU**, or leave it as **Any**.
3. Save the row.

You must pick a warehouse on the **Information** step before you add capacity. To load capacities in bulk, use **Assign capacity** on the locations list. See [Import data from Excel](/docs/wms/excel-imports).

## Validation messages

| Message | What to do |
| --- | --- |
| **Use letters, numbers, dot, dash, slash or underscore** | Remove other characters from the code. |
| **Location type is required** | Pick a location type. |
| **Area type is required** | Pick an area type. |
| **Set a maximum capacity above 0 for this capacity type** | Enter a maximum, or set the capacity type to **None**. |
| **Pick the client this location is dedicated to** | Pick a client, or turn off **Single client**. |
| **Max qty must be at least the min qty** | Raise the max or lower the min. |
| **This location changed since you opened it** | Someone else saved it. Reload and try again. |

## Edit a location

Select **Edit** on the row or the detail page, change any step, and select **Save**. The warehouse can't change.

## Related pages

- [Manage locations](/docs/wms/locations)
- [Generate a rack layout](/docs/wms/generate-locations)
- [License plates](/docs/wms/license-plates)
