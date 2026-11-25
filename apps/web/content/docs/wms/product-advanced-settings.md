---
title: Tracking, customs, hazmat and replenishment settings
description: Turn on lot, expiry, production date and serial tracking, and set customs, hazmat, channel allocation and replenishment levels for a product.
section: Products
order: 40
---

The **Advanced** step of the product wizard holds the settings that change how a product is received, picked, shipped and replenished. It is optional: leave it closed and the product is not tracked by lot, date or serial. For kits, the step holds only customs, hazmat and channel allocation. Packaging material has no **Advanced** step.

## Before you start

- You need the **Create** or **Edit** permission on **Products**.
- Decide tracking before you receive the product. Tracked attributes are required at receiving once they are on.

## Open the Advanced step

1. Go to **Settings > Master Data > Products**.
2. Create a product, or open one and select **Edit**.
3. Go to the **Advanced** step. Each group opens and closes on its own.

## Expiry tracking

Capture expiry dates and enforce FEFO picking.

| Field | What it does |
| --- | --- |
| **Expiry date tracking** | Turns on expiry dates for this product. |
| **Receiving-only expiry tracking** | Capture the date at receipt only. |
| **Expiry date format** | How a scanned date reads, such as `yyyyMMdd` or `yyyy-MM-dd`. Required when tracking is on. |
| **Scan method** | **During Picking** or **During Packing**. |
| **Use production date** | Expiry = production date + shelf life. |
| **Shelf life in days** | Days added to the production date. |

## Lot/batch tracking

Capture lot numbers at receiving, picking or packing.

| Field | What it does |
| --- | --- |
| **Lot/batch tracking** | Turns on lot numbers for this product. |
| **Receiving-only lot/batch tracking** | Capture the lot at receipt only. |
| **Auto create lot/batch number** | Creates the lot number for you. |
| **Regex** | Pattern a lot number must match, such as `^L[0-9]{6}$`. Must be a valid regular expression. |
| **Scan method** | **During Picking** or **During Packing**. |

## Production date tracking

| Field | What it does |
| --- | --- |
| **Active** | Turns on production dates for this product. |
| **Receiving-only prod. date tracking** | Capture the date at receipt only. |
| **Production date format** | Required when tracking is on. |
| **Scan method** | **During Picking** or **During Packing**. |

## Serial number tracking

Primary and secondary serials at receiving and packing.

| Field | What it does |
| --- | --- |
| **Track serial number** | Turns on serial numbers. One serial per unit. |
| **Track secondary serial number** | Captures a second serial per unit. |
| **Tracking method** | **Both Receiving and Packing** or **Only Packing**. Required when tracking is on. |
| **Skip scan serial number** | Skips the serial scan. |
| **Serial number regex** | Pattern a serial must match, such as `^SN[0-9]{8}$`. |

## Add custom declarations

Declared value, HS tariff code and origin for international shipments.

| Field | What it does |
| --- | --- |
| **Declared value** | Value per unit for customs. |
| **HS tariff code** | Tariff code, such as `6109.10`. |
| **Origin country** | Pick a country from the list. |
| **Is not declared to customs?** | Leaves the item off the customs declaration. |
| **Manufacturer**, **Manufacturer product identifier** | Who made it and their product ID. |
| **Description** | Customs description. |

## Hazmat information

Dangerous goods data sent to carriers. Turn on **Mark this item as hazardous** to fill it in.

| Field | What it does |
| --- | --- |
| **Hazmat ID** | UN or NA identification number, such as `UN3481`. |
| **Hazmat type** | Carrier hazmat category: `FR`, `EQ`, `LR`, `LQ`, `BATTERY` or `ORMD`. Required for hazardous items. |
| **Hazmat attribute** | Lithium battery configuration. |
| **Quantity**, **Quantity type**, **Quantity unit** | Hazardous material per unit, gross or net, and its unit. |
| **Hazmat container type** | Outer packaging type. |
| **Proper shipping name** | As listed in the dangerous goods regulations. |
| **Class division** | Such as `9` or `2.1`. |

A hazardous product shows a **Hazardous** badge on its detail page.

## Inventory channel allocation

Static, reserve and percentage quantities pushed to each sales channel.

1. Select **Add allocation**.
2. Choose the **Sales channel setup** and, if you want, a **Warehouse**. Leave the warehouse empty to apply across every warehouse.
3. Enter a **Static qty** to always publish exactly that quantity, or a **Reserve qty** to hold back and an **Allocation percentage** to publish of what is left.
4. Save the allocation.

Each allocation needs a static qty, reserve qty or percentage.

## Replenishment levels

Min and max for pick-face replenishment, global or per warehouse.

1. Under **Select replenishment strategy**, choose **Global** or **Per warehouse**.
2. For **Global**, enter **Min. replenishment level** and **Max. replenishment level**.
3. For **Per warehouse**, select **Add replenishment level**, choose the **Warehouse(s)** and the levels.

Max must be at least min, and a warehouse can have only one level.

## Validation messages

| Message | Cause |
| --- | --- |
| **Select an expiry date format** | Expiry tracking is on without a format. |
| **Select a production date format** | Production date tracking is on without a format. |
| **Select a tracking method** | Serial tracking is on without a method. |
| **Select a hazmat type** | The item is hazardous without a type. |
| **Enter a valid regular expression** | The lot or serial regex is not valid. |
| **Max must be at least min** | The max replenishment level is below the min. |
| **A warehouse has two replenishment levels** | The same warehouse is listed twice. |

## Related pages

- [Lots, serial numbers and expiry dates at receiving](/docs/wms/lots-serials-expiry)
- [Create a product](/docs/wms/create-product)
- [Import data from Excel](/docs/wms/excel-imports)
