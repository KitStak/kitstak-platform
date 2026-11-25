---
title: Report Hub and the list of reports
description: Every KitStak WMS report by name with what it shows, how to find it in the Report Hub, pin favorites and see your scheduled reports and recent exports.
section: Reports and analytics
order: 10
---

KitStak WMS reports are live grids over your warehouse data. Each one has filters, saved views, column choice and an Excel export, and most can be emailed on a schedule. The Report Hub lists them all in one place, grouped the same way as the **Reports** menu.

## Before you start

- Each report has its own **View** permission in the **Reports** group of a role. You only see the reports your roles allow.
- Reports show only the warehouses and clients your user can access.

## Open the Report Hub

1. Go to **Reports** and select **Report Hub**.
2. Search by name, description or a related word, such as `aging` or `capacity`.
3. Select **All reports** or **Favorites**.
4. Select the star on a report to add it to your favorites. Favorites are saved for your user.

The hub also shows **Scheduled reports**, every schedule you own, and **Recent exports**, with a **Download** link for each finished file.

## Orders

| Report | What it shows |
| --- | --- |
| **Channel Sales Report** | Demand and revenue per product, channel and store, from shipped orders. |
| **Shortage Report** | Order lines that could not be allocated, with the stock they are waiting for. |
| **Order Line Progress** | Every open and shipped today order line with its pick and pack progress. |

## Inventory

| Report | What it shows |
| --- | --- |
| **Kit Inventory Report** | Kits on hand and how many more you can build from components. |
| **Kit Component Inventory Availability Report** | Component availability for every kit, with the limiting part. |
| **Serial Number Report** | Primary and secondary serial status, plus shipment and receiving history. |
| **Order Inventory** | Where the stock allocated to open orders sits: location, LP, lot and status. |
| **Dynamic Replenishment Report** | How much to move from reserve into pick faces to cover demand. |
| **Inventory Snapshot Report** | A point in time copy of every inventory bucket, taken nightly at 00:02. |

## Inventory Analysis

| Report | What it shows |
| --- | --- |
| **Inventory Aging Report** | How long on hand stock has sat, in buckets from 0 to 30 days through over 365 days. |
| **Location Utilization Report** | Units and SKUs per location against its capacity, with over full and empty bins. |

## Logs

| Report | What it shows |
| --- | --- |
| **Change Log** | Who changed what, from which value to which, with links to the record. |
| **Transaction History** | The inventory ledger: every move with its before and after state. |
| **Integration Log** | Channel downloads and syncs with their success and error counts. |
| **Missing Log** | Stock reported missing during picking: where, when and by whom. |
| **Serial Number Transaction History** | Every ledger transaction that moved a serial tracked unit. |
| **Allocation Exceptions** | Wave allocations that failed and why. |
| **Wave Log Report** | Every wave run with orders met, shortages and jobs created. |
| **Excel Export History** | Your Excel exports with status, row count and download. |

## Receiving and warehouse efficiency

| Report | What it shows |
| --- | --- |
| **PO Receiving Report** | Received against ordered quantity per PO line, with difference pills. |
| **User Performance Report** | Picks, packs, receipts, counts and returns per user per day. |

## Analytics

The hub also lists the analytics dashboards: **Average Task Analysis**, **Associate Task Analysis**, **Performance Quadrant Analysis**, **Associate Analysis**, **Receiving Performance Analysis**, **Inbound & Inventory Dashboard**, **Fulfillment Dashboard**, **Management Dashboard** and **Productivity Dashboard**. See [Labor analytics and operational dashboards](/docs/wms/analytics-labor-and-operational).

## What every report grid has

| Feature | What it does |
| --- | --- |
| Quick search | Searches the report's main field. It matches exactly by default; switch to starts with in the search box. |
| Filters | Add filter chips. Some reports open with a default chip, such as **Latest Snapshot?** on the snapshot report. |
| Columns | Show, hide and reorder columns. |
| Saved views | Save a set of filters and columns to reuse. |
| **Export As Excel** | Exports every row that matches, not just the page. |
| **Schedule** | Emails the current view daily or weekly. |

See [Export and schedule reports](/docs/wms/analytics-export-and-schedule).

## Related

- [Inventory reports](/docs/wms/analytics-inventory-grids)
- [Order, receiving and performance reports](/docs/wms/analytics-orders-receiving-performance)
- [Change log, transaction history and other logs](/docs/wms/analytics-logs-and-history)
