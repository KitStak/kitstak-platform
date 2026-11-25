---
title: Create a product
description: Create a product, kit or packaging material in KitStak WMS with the product wizard, from client and SKU to packing details and components.
section: Products
order: 20
---

The product wizard creates one SKU for one client. It asks for the category first, then walks you through the steps that category needs. You can also create a product while you build a purchase order.

## Before you start

- You need the **Create** permission on **Products**.
- The client must exist. See [Set up your warehouse step by step](/docs/wms/setup-sequence).
- Product types and product groups come from lookup lists your admin sets up.

## Create a product

1. Go to **Settings > Master Data > Products**.
2. Select **Create new product**.
3. Under **Please select the type of product category to proceed**, pick **Product**, **Kit** or **Packaging material**. You can't change the category later.
4. Fill in each step and select **Next**. Optional steps can be left as they are.
5. On the last step, select **Save**.

To pick a different category before you type anything, select **Change** next to the drawer title.

## Steps by category

| Category | Steps |
| --- | --- |
| **Product** | **General**, **Packing**, **Pack type**, **Advanced**, **Other info** |
| **Kit** | **General**, **Components**, **Packing**, **Advanced**, **Other info** |
| **Packaging material** | **General**, **Packing**, **Other info** |

**Advanced** and **Other info** are optional.

## General step

| Field | What it does | Required |
| --- | --- | --- |
| **Product image** | Paste the URL address of an image. A preview shows. | No |
| **Kit type** | **Kit to Order** or **Kit to Stock**. Kits only. | Yes, for kits |
| **Client** | The client that owns the product. Locked after creation. | Yes |
| **SKU (stock keeping unit)** | Unique per client, up to 100 characters. The same SKU can exist under another client. A check mark shows when the SKU is free. | Yes |
| **Name** | Up to 200 characters. | Yes |
| **Description** | Up to 500 characters. | No |
| **Product barcode** | The scan code. Kits and packaging material only; standard products keep barcodes on their pack types. | No |
| **UOM pack type** | The unit the kit or packaging material is counted in. Kits and packaging material only. | Yes |
| **Product type**, **Product group** | Picked from your lookup lists. | No |
| **Currency** | Currency of the prices. | No |
| **Purchase price** | Cost per unit. | No |
| **Sales price** | Price per unit. Not shown for packaging material. | No |
| **Tax rate** | 0 to 100%. Not shown for packaging material. | No |
| **Minimum safety stock** | Replenishment and low-stock alerts trigger below this quantity. | No |
| **FNSKU** | Amazon fulfillment network SKU. | No |
| **Active?** | Inactive products can't be ordered or received. | No |
| **Digital?** | Digital products are never picked or packed. Not shown for packaging material. | No |

## Components step (kits)

1. Type in **Search and add component** to find a SKU of the same client. The result shows what is **Available**.
2. Select the add button on each component.
3. Set the **Quantity** of each component in one kit. It must be a whole number of 1 or more.
4. Use the remove button to take a component out.

A kit needs at least one component, and a component can be listed only once.

## Packing step

| Field | What it does |
| --- | --- |
| **Dimension unit**, **Length**, **Width**, **Height** | The kit's or packaging material's own size. Standard products set size on the pack type instead. |
| **Volume unit**, **Volume** | Volume. Select **Recalculate volume from dimensions** to fill it in. |
| **Use this shipping box only** | Ships the item in one chosen box. Leave **Any box** to let packing choose. |
| **Weight unit**, **Weight** | Weight of one unit. |
| **Packing instructions** | Shown to packers at the packing station. Up to 250 characters. |
| **Return instructions** | Shown at the return station. Up to 250 characters. |
| **Handling** flags | **Foldable**, **Fragile**, **Oversized**, **Insert**, **Stackable**, **Poster**, **Liquid** and **Non-returnable**. They drive packing prompts, box selection and carrier surcharges. Packaging material has no **Liquid** flag. |

## Pack type step (products)

Add the primary (UOM) pack type with its barcodes, then any case, pallet or multipack. See [Pack types and barcodes](/docs/wms/product-pack-types).

## Advanced and Other info steps

**Advanced** holds customs, hazmat, channel allocation, lot, expiry, production date, serial and replenishment settings. See [Tracking, customs, hazmat and replenishment settings](/docs/wms/product-advanced-settings).

**Other info** holds your company's custom fields for products.

## Validation messages

| Message | What to do |
| --- | --- |
| **Select a client** | Pick the client on the **General** step. |
| **SKU is required** | Enter a SKU. |
| **SKU MUG-11OZ-BLK already exists for this client** (with your SKU) | Use another SKU, or open the existing product. |
| **Name is required** | Enter a name. |
| **Select a kit type** | Choose **Kit to Order** or **Kit to Stock**. |
| **Add a primary (UOM) pack type** | Add the primary pack type on the **Pack type** step. |
| **Add at least one component to the kit** | Add a component on the **Components** step. |

When you save, the wizard jumps to the first step with an error.

## Edit a product

1. Open the product and select **Edit**, or choose **Edit** in the row menu.
2. Every step is open. Go to any step and select **Save** when you are done.

The client and the category can't change. If someone else saved the product while you had it open, you are asked to reload.

## Related pages

- [Manage the product catalog](/docs/wms/products)
- [Pack types and barcodes](/docs/wms/product-pack-types)
- [Tracking, customs, hazmat and replenishment settings](/docs/wms/product-advanced-settings)
- [Create a purchase order](/docs/wms/create-purchase-order)
