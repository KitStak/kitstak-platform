---
title: Change log, transaction history and other logs
description: Trace who changed what with the Change Log, follow every stock move in Transaction History, and read the Missing Log, serial history and Excel Export History.
section: Reports and analytics
order: 40
---

The log reports are KitStak's memory. The Change Log records every create, update and delete on a business record. Transaction History is the inventory ledger, one row for every move with its before and after quantities. The other logs cover missing stock, serial numbers and your own exports.

## Before you start

- Each log needs its **View** permission in the **Reports** group.

## Change Log

Go to **Reports > Logs > Change Log**.

| Column | What it shows |
| --- | --- |
| **Type** | **Create**, **Update** or **Delete**. |
| **Transaction Date** | When the change was made. |
| **Source** | Where the change came from. |
| **Changed Module** | The kind of record, such as a client or a billing form. |
| **Code** | The record's code. Select it to open the record. |
| **Changed Property** | The field that changed. |
| **Changed From**, **Changed To** | The old and new values. |
| **Message** | A sentence about the change, when there is one. |

Filter by **Changed Module**, **Code**, **Event Type**, **Changed Property**, **Source** or **Transaction Date**.

> **Note:** Users whose roles don't include **View** on the **Users** page see only their own changes, with the note **Showing your changes only**. Admins and supervisors see every user's changes.

Most grids also have a **Change log** row action that opens the same history for one record. See [Audit log and change logs](/docs/wms/admin-audit-log-and-change-logs).

## Transaction History

Go to **Reports > Logs > Transaction History**. Every inventory move has a row.

Transaction types are **Allocation**, **Allocation Cancel**, **Attributes Change**, **Cancel Receiving**, **Count**, **Disassemble Kit**, **Inventory Adjustment**, **Inventory Movement**, **Kitting**, **Loading**, **Packing**, **Picking**, **Receiving**, **Replenishment**, **Return Receiving**, **Shipment**, **Sorting** and **Unloading**.

| Column group | Columns |
| --- | --- |
| What and when | Transaction Type, Transaction Date, SKU, Product Name, Transaction User |
| Where | Source Location, Target Location, Source LPN, Target LPN, parent LPs, location groups and area types |
| How much | Action UOM Quantity, Action Pack Quantity, On Hand Before, On Hand Change, On Hand After |
| Why | Shipment Order Code, Purchase Order Code, Adjustment Reason, Count Plan Code, RMA Number, Work Order Code, Algorithm Name, Algorithm Rule Name, Note |

To trace one movement, filter by SKU, LP, location or date. The **Serial Number Transaction History** tab shows the same ledger for serial tracked units, with **Primary Serial Number**, **Secondary Serial Number** and **Serial Status**.

## Missing Log

Go to **Reports > Logs > Missing Log**. One row for each time a picker reported stock missing.

Columns: **Wave ID**, **Job Code**, **Shipment Order Code**, **SKU**, **Product Name**, **Pack Type**, **Barcode**, **LPN**, **Parent LP**, **Parent LP Type**, **Missing Pack Quantity**, **Location**, **Inventory Quantity**, **Is Retain**, **Entry Date**, **Entered By**, **Notes**, **Warehouse** and **Client**. **Is Retain** shows whether the allocation was kept while the missing report is checked, which a client can turn on with **Retain allocation during missing**.

## Integration Log

**Reports > Logs > Integration Log** opens **Channel History**. See [Channel methods and logs](/docs/wms/channel-methods-and-logs).

## Excel Export History

Go to **Reports > Logs > Excel Export History**. Every Excel export you start, from any grid or report, and every scheduled delivery.

| Column | What it shows |
| --- | --- |
| **Export Type** | The grid or report exported. |
| **Action** | **Download** when the file is ready, **Queued** or **Preparing** with a percentage while it builds, **No file** when it failed. |
| **Status** | queued, started, completed or error. |
| **Row Count** | Rows in the file. |
| **Export Date**, **Finished** | When it started and finished. |
| **Exported By** | Who started it. |
| **Filters** | The filters the export used. |
| **Error Message** | Why a failed export failed. |

The page refreshes every few seconds while a file is being prepared. Export files are kept for 7 days.

## Related

- [Report Hub and the list of reports](/docs/wms/analytics-hub-and-catalog)
- [Export and schedule reports](/docs/wms/analytics-export-and-schedule)
- [Audit log and change logs](/docs/wms/admin-audit-log-and-change-logs)
