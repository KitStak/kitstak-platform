---
title: Inventory reports
description: Read the serial number, order inventory, dynamic replenishment, inventory snapshot, inventory aging and location utilization reports, column by column.
section: Reports and analytics
order: 20
---

The inventory reports answer where stock is, how old it is, how full your locations are and what needs to move. They read live data, except the snapshot report, which keeps one copy of every inventory bucket per night. All of them export to Excel and can be scheduled.

## Before you start

- Each report needs its **View** permission in the **Reports** group. **Inventory Aging Report** needs **Total Inventory** view, and **Location Utilization Report** needs **Locations** view.

## Serial Number Report

Go to **Reports > Inventory > Serial Number Report**. Three tabs:

| Tab | Columns |
| --- | --- |
| **Tracking** | Warehouse, Client, SKU, Product Name, Primary Serial Number, Secondary Serial Number, Current Location, Last Reference, Entry Date Time, Serial Status |
| **Serial Number Shipment History** | SKU, Product Name, serial numbers, Shipment Order Code, Store Order Number, Lot Batch Number, Expiry Date, Pack Type, Barcode, Shipment Date Time, Shipment Order Type, Note, Warehouse, Client, Location, LP Number, Parent LP, Carrier, Tracking Number |
| **Serial Number Receiving History** | Receipt ID, SKU, Product Name, Barcode, Purchase Order Code, serial numbers, Lot Batch Number, Expiry Date, Pack Type, Receiving Type, Receiving Date, Purchase Order Type, Note, Warehouse, Client, Location, LP Number, Parent LP, Damage Reason Name, Receiving User, Vendor |

Use it to answer a client's question about one serial number: where it is now, when it came in and which order it shipped on.

## Order Inventory

Go to **Reports > Inventory > Order Inventory**. One row per allocation of an open order, showing where the allocated stock sits.

Main columns: **Order Code**, **Warehouse**, **Client**, **Store Order Number**, **Job Code**, **Work Order Code**, **Wave No**, **SKU**, **Pack Type**, **Allocated UOM Qty**, **Allocated Pack Qty**, **Inventory Status**, **Location**, **LPN**, **Parent LP**, **Lot / Batch Number**, **Expiry Date**, **PO Number** and **Receiving Date**. LP weight and dimensions are hidden columns you can turn on. Search by order code.

## Dynamic Replenishment Report

Go to **Reports > Inventory > Dynamic Replenishment Report**. It lists products that have min and max replenishment levels in a warehouse, and how much to move into the pick face.

| Column | What it shows |
| --- | --- |
| **Min Replenishment Level**, **Max Replenishment Level** | From the product's replenishment settings. |
| **Source Location Total Quantity**, **Source Location Free Quantity** | Stock in reserve. |
| **Target Location Available Qty** | Stock already in the pick face. |
| **Open Order Quantity** | Demand from open orders. |
| **Open Replenish Task Qty** | Already on its way. |
| **To Replenish Quantity** | Max level plus open order quantity, minus target available and open replenish tasks. Never below 0. |

Set the min and max levels on the product's replenishment tab.

## Inventory Snapshot Report

Go to **Reports > Inventory > Inventory Snapshot Report**. KitStak copies every inventory bucket every night at 00:02 warehouse time. A night the server was down is rebuilt from the inventory ledger, and existing snapshots are never changed.

The report opens on the latest snapshot of each warehouse. Remove the **Latest Snapshot?** chip and filter on **Snapshot Day** to see an earlier day. Columns include **Warehouse**, **Client**, **Snapshot Day**, **Snapshot Date**, **SKU**, **Location**, **LP Number**, **UOM Qty**, **Pack Qty**, **Lot Batch Number**, **Expiry Date**, **Inventory Status** and product dimensions.

Storage fees on billing forms are counted from these snapshots. See [Storage fees: daily, peak, average and split month](/docs/wms/billing-storage-fees).

## Inventory Aging Report

Go to **Reports > Inventory Analysis > Inventory Aging Report**. Each row is an on hand inventory bucket. **Age (Days)** counts whole days since it was received, in the warehouse's calendar.

| Aging Bucket |
| --- |
| 0-30 Days |
| 31-60 Days |
| 61-90 Days |
| 91-180 Days |
| 181-365 Days |
| Over 365 Days |

Filter on **Aging Bucket** to find stock older than 90 or 180 days. Other columns: **SKU**, **Product Name**, **On Hand**, **Client**, **Location**, **LP Number**, **Lot Batch Number**, **Expiry Date**, **Received Date**, **Inventory Status** and **Warehouse**.

## Location Utilization Report

Go to **Reports > Inventory Analysis > Location Utilization Report**. It shows how full each active location is, with a summary bar on top.

| How utilization is worked out | When |
| --- | --- |
| On hand units divided by the unit capacity | The location has a **Max Capacity Qty** or a product capacity. |
| Cube: the stored units' product volume divided by the location's volume | No unit capacity, but the location has dimensions. |
| Legacy capacity units, marked estimated | The location has no volume. |

The report opens with the chip **Estimated Capacity? = No**, which hides locations that only have legacy capacity. Remove it to include them. Columns include **Location**, **Utilization %**, **On Hand Units**, **Capacity (Units)**, **Free Capacity**, **Capacity Source**, **Used Cube (in³)**, **Location Cube (in³)**, **Zone**, **Area Type**, **Location Type**, **SKU Count**, **LP Count** and **Warehouse**. Set **Max Capacity Qty** or dimensions on the location for an exact figure.

## Related

- [Report Hub and the list of reports](/docs/wms/analytics-hub-and-catalog)
- [Export and schedule reports](/docs/wms/analytics-export-and-schedule)
- [Change log, transaction history and other logs](/docs/wms/analytics-logs-and-history)
