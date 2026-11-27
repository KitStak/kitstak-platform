---
title: Import data from Excel
description: Load products, pack types, locations, capacities, inventory, purchase orders and count plans in bulk with KitStak WMS Excel templates.
section: Get started
order: 50
---

Every bulk importer in KitStak WMS works the same way: download the template, fill it in, drop the file on the page, and read the result in the import history. Each row is checked on its own, so good rows go in even when other rows fail.

## Before you start

- You need the **Import File** permission for the page you import into, such as **Products** or **Locations**.
- Create the warehouse and the client first. Most templates ask for a `Warehouse Code` or a `Client Code`. See [Set up your warehouse step by step](/docs/wms/setup-sequence).

## Import a file

1. Open the importer from its page. The table below lists where each one lives.
2. Select **Download our excel template**. The file has every column, an example row and field notes. Required columns end with ` *`.
3. Fill in one row per record. Keep the header row as it is.
4. Drag and drop the `.xlsx` or `.csv` file onto the page, or browse for it. Files can be up to 10 MB.
5. Wait for the import to finish. While it runs, **An import is processing** shows and the page refreshes on its own.
6. Check the result in **Import history**.

## Read the import history

| Column | What it shows |
| --- | --- |
| **Status** | **Processing**, **Successful**, **Partially Successful** or **Failed**. |
| **Master Row Count** | Rows in the file. |
| **Success** | Rows imported. |
| **Error** | Rows rejected. |
| **Uploaded by** | Who uploaded the file. |
| **Created Date Time** | When the file was uploaded. |

Each row has these actions:

- **Details** opens the import details. Turn on **Show errors** to see only the failed rows.
- **Download original** downloads the file you uploaded.
- **Download error file** downloads the failed rows with the reason in the last column.

> **Tip:** Fix the rows in the error file and upload just those rows again. The rows that already went in are not touched.

## Importers for products, inbound, inventory and counts

| Importer | Where to open it | What a row adds or changes |
| --- | --- | --- |
| **Bulk Import Products** | **Products > Bulk import/update > Products** (under **Import**) | A new product with its primary pack type |
| **Bulk Update Products** | **Products > Bulk import/update > Products** (under **Update**) | Fields on an existing SKU, matched by client code and SKU |
| **Bulk Import Pack Types & Barcodes** | **Products > Bulk import/update > Pack types & barcodes** | A pack type with its UOM quantity, barcode and dimensions |
| **Bulk Import Warehouse Replenishment Levels** | **Products > Bulk import/update > Warehouse replenishment levels** | Min and max quantity of a SKU in a warehouse |
| **Bulk Import SKU Based Inventory Allocation** | **Products > Bulk import/update > SKU based inventory allocation** | An allocation percent or quantity of a SKU for a channel |
| **Bulk Update Kit Components** | **Products > Bulk import/update > Kit-components** | A component SKU and quantity of a kit |
| **Import Purchase Order** | **Purchase Orders > Import > Purchase orders** | A purchase order line |
| **Import PO Serial Numbers** | **Purchase Orders > Import > Serial numbers** | A pre-advised serial number on a PO line |
| **Import Inventory** | **Inventory by Location > Import** | Stock of a SKU in a location |
| **Bulk Import Locations** | **Locations > Import > Bulk import locations** | A new location |
| **Bulk Update Locations** | **Locations > Import > Bulk update locations** | Fields on an existing location, matched by warehouse and code |
| **Bulk Import Product Capacity** and **Bulk Update Product Capacity** | **Locations > Assign capacity** | Min and max quantity of a SKU in a location |
| **Bulk Import LP Capacity** and **Bulk Update LP Capacity** | **Locations > Assign capacity** | How many LPs of a type a location holds |
| **Import LP Number** | **LP Numbers > Import LP number** | A license plate number of an LP type |
| **Import Location Count Plan** | **Count Plan > Import > Import location count plan** | A location to count on a count plan |
| **Import SKU Count Plan** | **Count Plan > Import > Import SKU count plan** | A SKU to count on a count plan |

## Template columns

These are the columns of the most used templates. Columns marked required must have a value.

| Template | Required columns | Optional columns |
| --- | --- | --- |
| Products | `Client Code`, `SKU`, `Name`, `Barcode` | `Description`, `Product Group`, `Product Type`, `UOM`, `Weight (lb)`, `Length (in)`, `Width (in)`, `Height (in)`, `Unit Price`, `Unit Cost`, `Track Lot`, `Track Expiry`, `Track Serial`, `Status` |
| Pack types | `Client Code`, `SKU`, `Pack Type`, `UOM Quantity` | `Barcode`, `Weight (lb)`, `Length (in)`, `Width (in)`, `Height (in)` |
| Locations | `Warehouse Code`, `Location Code` | `Zone`, `Aisle`, `Column`, `Level`, `Position`, `Location Type`, `Area Type`, `Location Group`, `Walking Path Priority`, `Client Code`, `Is Pickable`, `Status` |
| Inventory | `Warehouse Code`, `Client Code`, `SKU`, `Location Code`, `Quantity` | `Pack Type`, `LP Number`, `Lot Number`, `Expiry Date`, `Production Date`, `Status`, `Damage Reason` |
| Purchase orders | `PO Code`, `Client Code`, `Warehouse Code`, `Vendor Name`, `SKU`, `Quantity` | `Vendor Code`, `PO Type`, `Expected Receiving Date`, `Reference Number`, `Unit Cost`, `Pack Type`, `Lot Number`, `Expiry Date`, `Notes` |
| PO serial numbers | `PO Code`, `SKU`, `Serial Number` | None |
| Location count plan | `Count Plan Name`, `Warehouse Code`, `Location Code` | `Job Type`, `Planned Date`, `Blind Count` |
| SKU count plan | `Count Plan Name`, `Warehouse Code`, `Client Code`, `SKU` | `Job Type`, `Planned Date`, `Blind Count` |
| LP numbers | `Warehouse Code`, `LP Type`, `LP Number` | `Alternate Barcode`, `Location Code`, `Is SSCC-18` |

A row in the inventory template can set `Status` to `Stock`, `Damaged` or `Quarantine`. In the inventory and purchase order templates, `Quantity` must be a whole number of 1 or more.

## Related pages

- [Import purchase orders](/docs/wms/create-purchase-order)
- [Manage the product catalog](/docs/wms/products)
- [Manage locations](/docs/wms/locations)
- [Create a count plan](/docs/wms/create-count-plan)
