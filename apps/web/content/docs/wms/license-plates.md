---
title: License plates
description: Set up LP types and LP numbers in KitStak WMS, receive stock onto a license plate, and move, print or delete license plates.
section: Inbound
order: 70
---

A license plate (LP) is a container with its own number, such as a pallet, a tote or a carton. Stock on an LP moves with it, so you can receive onto an LP, put the whole LP away in one scan, and transfer it as one. Each LP belongs to an LP type, which sets its number format, size and mixing rules.

## Before you start

- LP types need the **View** and **Create** permissions on **LP Types**. LP numbers need the same on **LP Numbers**.
- LP types belong to one warehouse. Create the warehouse first. See [Set up your warehouse step by step](/docs/wms/setup-sequence).

## Create an LP type

1. Go to **Settings > Configuration > LP Types**.
2. Select **Create LP type**.
3. Fill in the **General**, **Parameters** and **Other info** steps, then save.

| Field | What it does | Required |
| --- | --- | --- |
| **Warehouse** | The warehouse the LP type belongs to. | Yes |
| **Code** | Short code, such as `TOTE` or `PALLET`. Letters, numbers, dash or underscore. | Yes |
| **Number prefix** | Text in front of every LP number, such as `TOT-`. Letters, numbers or dash, up to 10 characters. | Yes |
| **Number length** | Number of digits in the LP number. At least 1. | Yes |
| **Dimension unit**, **Length**, **Width**, **Height** | Size of the container. | No |
| **Weight unit**, **Empty weight**, **Max weight** | Weight of the empty container and the most it may carry. 0 means no limit. | No |
| **Volume unit**, **Max volume** | The most volume it may hold. 0 means no limit. | No |
| Mixing rules | Checked whenever stock is put on an LP of this type. A breach blocks the scan. | No |
| **Description** | Such as "Blue picking tote 24 x 16 x 12". | No |

The **Numbering preview** shows the next three numbers this type will create.

Mixing rules you can turn on: **Only 1 expiry date**, **Only 1 production date**, **Only 1 lot batch number**, **Only 1 SKU**, **Only 1 client**, **Only 1 order**, **Only 1 job**, **Suitable for parent LP** and **Use for AI job**.

An LP type that still has LP numbers or location capacities can't be deleted.

## Create LP numbers

1. Go to **Settings > Configuration > LP Numbers**.
2. Select **Create LP number**.
3. Under **Type and location**, choose the **Warehouse**, the **LP type** and, if you want, a **Location**. Empty LPs start in the warehouse's default receiving location when you leave it blank.
4. Choose **From sequence** to issue numbers from the LP type, and enter the **LP number count**. Turn on **SSCC18** for GS1 serial shipping container codes with a check digit; it needs a **Client**.
5. Or choose **Custom numbers** and enter each **LP number**, with an optional **Alternate barcode** as a second scan code.
6. Save.

Warehouse, LP type and location are locked after creation. To load many numbers, select **Import LP number**. See [Import data from Excel](/docs/wms/excel-imports).

## LP statuses

| Status | Meaning |
| --- | --- |
| **Empty** | No stock on the LP. |
| **Occupied** | The LP holds stock. |
| **Shipped** | The LP left in a shipment. |
| **Removed** | The LP was voided. It is kept so its history still resolves. |

## LP details

Select an LP number to see its **Status**, **Units**, **SKUs** and **Child LPs**, plus **Warehouse**, **LP type**, **Location**, **Client**, **Parent LP**, **Original number**, **Alternate barcode**, **SSCC18**, **Dimensions**, **Weight** and **Label printed**. **Contents** lists each SKU and lot with **On hand** and **Allocated**.

Row actions: **Show details**, **Edit**, **Change log**, **Print barcode** and **Delete**.

## Receive onto an LP

When you receive a purchase order, each line has a **License plate** choice:

- **No LP** puts the stock straight in the location.
- **Scan LP** puts it on an existing LP. The LP must be in this warehouse and in the same location.
- **New LP** creates a new LP from an **LP type**. The number is assigned automatically.

See [Receive a purchase order](/docs/wms/receive-purchase-order) and [Receive on a handheld](/docs/wms/rf-receiving).

## Move an LP

- On the **Putaway** worklist, tick **Move the whole LP** to move the LP with every SKU on it. See [Put away received stock](/docs/wms/putaway).
- In **Inventory by Location**, select **Transfer LP/Loc > Transfer LP**. See [Move and transfer inventory](/docs/wms/transfer-inventory).

## Delete LP numbers

1. Select LP numbers and select **Delete**.
2. The dialog checks each LP. Never-used LPs are deleted. LPs with stock history are voided instead: status **Removed**.

An LP can't be removed when it holds units, has shipped, is nested on a parent LP, or has child LPs. Move the stock or take the LPs apart first.

## Related pages

- [Receive a purchase order](/docs/wms/receive-purchase-order)
- [Move and transfer inventory](/docs/wms/transfer-inventory)
- [Create a location](/docs/wms/create-location)
