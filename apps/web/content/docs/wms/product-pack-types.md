---
title: Pack types and barcodes
description: Set up the primary unit, hierarchical packs such as cases and pallets, irregular packs and their barcodes on a KitStak WMS product.
section: Products
order: 30
---

A pack type is a way a product is handled: a single unit, a case of 12, a pallet of 40 cases or a 3-pack. Each pack type has its own size, weight and barcodes, so a scanner can tell what was scanned. Standard products set pack types on the **Pack type** step of the product wizard.

## Before you start

- You need the **Create** or **Edit** permission on **Products**.
- Pack type names, such as `Unit`, `Case` or `Pallet`, come from the pack type master in **Settings > Data setup > Pack Type**.

## Kinds of pack type

| Kind | What it is | UOM quantity |
| --- | --- | --- |
| Primary (UOM) | The base unit every quantity is counted in. Each product has exactly one. | Always 1 |
| Hierarchical | A pack made of child packs, for example Case = 12 x Unit, Pallet = 40 x Case. | Child qty times the contained pack's UOM quantity |
| Irregular | An alternate pack outside the hierarchy, for example a 3-pack. | Entered directly |

## Add the primary pack type

1. In the product wizard, go to the **Pack type** step.
2. On the **Unit of measure** tab, select **Add primary (UOM) pack type**.
3. Choose the **Pack type**, enter dimensions, weight and barcodes.
4. Select **Add**.

The product can't be saved without a primary pack type.

## Add a case, pallet or multipack

1. On the **Unit of measure** tab, select **Hierarchical** or **Irregular**. Or open the **Hierarchicals** or **Irregulars** tab and select **Add hierarchical pack type** or **Add irregular pack type**.
2. Fill in the fields below.
3. Select **Add**.

You must add the primary pack type first.

| Field | What it does | Required |
| --- | --- | --- |
| **Pack type** | The name from the pack type master. Each name can be used once per product. | Yes |
| **Contains** | Hierarchical only. The pack this one is made of. | Yes, for hierarchical |
| **Child qty** | Hierarchical only. How many of the contained pack it holds. At least 2. | Yes, for hierarchical |
| **UOM quantity** | Units in this pack. Entered for irregular packs, calculated for the others. | Yes |
| **Use primary (UOM) barcode(s)** | Scanning a primary barcode also identifies this pack. | No |
| **Dimension unit**, **Length**, **Width**, **Height** | Size of the pack. Cubing and box selection need all three. | No |
| **Volume unit**, **Volume** | Volume. Select **Recalculate volume** to fill it from the dimensions. | No |
| **Use this shipping box only** | Ships this pack in one chosen box. **Any box** lets packing choose. | No |
| **Weight unit**, **Weight** | Weight. Rate shopping and shipping labels need a weight. | No |
| **Use item's own box for shipping** | The item ships in its own packaging: no carton is added at packing. | No |
| **Barcode(s)** | Type a barcode and press `Enter` to add it. Up to 20 per pack, each up to 100 characters. | No |

A pack card warns when length, width, height or weight is 0, and when the pack has no barcode.

## Barcode rules

- Scanning any pack type barcode identifies the pack.
- A barcode can't be on two pack types of the same product.
- A barcode has one meaning per client. If another product of the same client already uses it, the wizard names that SKU and pack type, for example **Barcode 012345678905 is already used by MUG-11OZ-WHT (Unit). Remove it to continue.**

## Edit or delete a pack type

1. On the pack card, use the edit or delete button.
2. Confirm **Delete pack type**.

Deleting a pack type removes its barcodes too. Packs nested in it move up one level. Deleting the primary pack type means you must add a new one before you can save.

## Import pack types

Use **Products > Bulk import/update > Pack types & barcodes** to add or update pack types and barcodes from Excel. Each row needs `Client Code`, `SKU`, `Pack Type` and `UOM Quantity`. See [Import data from Excel](/docs/wms/excel-imports).

## Related pages

- [Create a product](/docs/wms/create-product)
- [Manage the product catalog](/docs/wms/products)
- [Import data from Excel](/docs/wms/excel-imports)
