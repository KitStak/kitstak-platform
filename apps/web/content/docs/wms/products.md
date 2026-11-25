---
title: Manage the product catalog
description: Search, open, activate, deactivate, duplicate, label and delete products in the KitStak WMS product list and product detail page.
section: Products
order: 10
---

The **Products** page lists every SKU you store, for every client you can see. From here you create products, open a product's detail page, change status in bulk, print labels and import or update the catalog from Excel.

## Before you start

- You need the **View** permission on **Products**. Creating, editing, deleting, importing, labels and the change log each have their own permission.
- Each product belongs to one client. Add the client first. See [Set up your warehouse step by step](/docs/wms/setup-sequence).

## Open the product list

1. Go to **Settings > Master Data > Products**, or press `G` then `P`.
2. Type in **Search by SKU, name or barcode** and press `Enter`, or add filters.
3. Select a row to open the product detail page.

The page has two tabs: **Products** and **Product Listings**.

## Product categories

Every product has one category, chosen when you create it. You can't change the category later.

| Category | Use it for |
| --- | --- |
| **Product** | Standard products. Barcodes live on the pack types. |
| **Kit** | Kit-to-order or kit-to-stock products made of components. |
| **Packaging material** | Boxes and fillers matched to shipment packages for inventory tracking. |

See [Create a product](/docs/wms/create-product).

## Actions on the list

| Button | What it does |
| --- | --- |
| **Create new product** | Opens the product wizard. |
| **Bulk import/update** | Opens an importer: **Products**, **Pack types & barcodes**, **Warehouse replenishment levels**, **SKU based inventory allocation** under **Import**, and **Products** and **Kit-components** under **Update**. See [Import data from Excel](/docs/wms/excel-imports). |
| **Status** | **Activate** or **Deactivate** the selected products. |
| **Delete** | Deletes the selected products that can be deleted. |
| **Label** | Prints product labels for the selected products. |

Each row also has **Show details**, **Edit**, **Change log**, **Duplicate**, **Activate** or **Deactivate**, **Print label** and **Delete**.

## Deactivate or delete a product

Deactivate a product to stop it from being ordered or received while keeping its history.

1. Select the products.
2. Select **Status > Deactivate**.

To delete:

1. Select the products and select **Delete**.
2. The dialog marks each product **Can be deleted** or **Blocked**.
3. Select **Yes** to delete the ones that can be deleted. Linked channel listings become unlinked.

Products with stock, open orders, kit usage or history can't be deleted. They are kept for traceability. When every selected product is blocked, the dialog offers **Deactivate** instead.

## Duplicate a product

1. Open the row menu and select **Duplicate**, or select **Duplicate** on the detail page.
2. The wizard opens with every setting copied. Enter a new SKU and new barcodes.
3. Select **Save**.

## Print product labels

1. Select products and select **Label**, or select **Print labels** on the detail page.
2. In **Print product labels**, choose the **Printout template** and **Print quantity**.
3. Select **Preview**, **Download** or **Print**. **Print** sends the file to the printer assigned in **Printers** when the Direct Print agent runs, and opens the browser print dialog otherwise.

Products with no barcode on the product or its pack types print the SKU on the label.

## The product detail page

The header shows the image, SKU, status, category, client, barcode and created date. Badges show **Kit to Order** or **Kit to Stock**, **Hazardous** and **Digital** when they apply.

Header buttons: **Edit**, **Print labels**, **Duplicate**, **Activate** or **Deactivate**, and **More** with **Change log**, **View inventory** and **Delete**.

Availability figures:

| Figure | Meaning |
| --- | --- |
| **On hand** | Units physically in stock. |
| **Unallocated** | On hand units not allocated to orders. |
| **ATP** | Available to promise. See [Total inventory and available to promise](/docs/wms/total-inventory-and-atp). |
| **Allocated** | Units allocated to orders. |
| **Damaged** | Units with a damage reason. |
| **Open order demand** | Units still to ship on open orders. |
| **Inbound** | Units still to receive on open purchase orders. |

Tabs:

| Tab | What it shows |
| --- | --- |
| **Overview** | The product's settings. |
| **Pack types & barcodes** | Every pack type with its barcodes and dimensions. |
| **Inventory** | Stock rows by location. |
| **Orders & POs** | Open orders and open purchase orders for the SKU. |
| **Listings** | Channel listings linked to the product. |
| **Components** or **Used in kits** | A kit's components, or the kits a product is part of. |
| **Replenishment** | Replenishment levels. Not shown for kits. |
| **Transactions** | The ledger of stock movements. |

## Related pages

- [Create a product](/docs/wms/create-product)
- [Pack types and barcodes](/docs/wms/product-pack-types)
- [Tracking, customs, hazmat and replenishment settings](/docs/wms/product-advanced-settings)
- [Import data from Excel](/docs/wms/excel-imports)
