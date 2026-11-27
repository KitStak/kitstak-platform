---
title: Export and schedule reports
description: Export any report or grid to Excel in the background, download it from the tasks tray, and email a saved report view daily or weekly as XLSX or CSV.
section: Reports and analytics
order: 50
---

Every report and most lists in KitStak WMS export to Excel. Exports run in the background, so you can keep working while a large file builds. For reports you need regularly, a schedule emails the same view to a list of people every day or every week.

## Before you start

- You need **View** on the report. Exports and schedules contain only what you can see.
- Scheduled emails need email delivery set up in **Company Settings**. See [Company settings and security](/docs/wms/settings-company-and-security).

## Export to Excel

1. Open the report or list and set the filters, search and columns you want.
2. Select **Export As Excel**.
3. The message **Export started** appears. Select **Open tasks tray** to watch it, or keep working.
4. When it is ready, download it from the background tasks tray in the header or from **Excel Export History**.

The export covers every row that matches your filters, not just the page on screen, up to 100,000 rows. With more, KitStak asks you to narrow the filters. Files are kept for 7 days. Fields a role restriction hides, such as carrier cost, are left out of the file.

**Export As Excel** is on every report, and on lists such as **Clients**, **Customers**, **Retailers**, **3PL Billing**, **Users**, **Roles**, **Audit Log** and **Warehouse**. Bills have their own consolidated and detailed exports. See [Calculate, review and approve bills](/docs/wms/billing-calculate-and-approve-bills).

## Schedule a report

1. Open the report and set the view: filters, sort, search and visible columns.
2. Select **Schedule**.
3. Check the line at the top. It says how many filters and visible columns the schedule uses.
4. Fill in the fields below.
5. Select **Save schedule**.

| Field | What it does | Required |
| --- | --- | --- |
| **Name** | Starts as the report name plus daily or weekly. Up to 120 characters. | Yes |
| **Frequency** | **Daily** or **Weekly**. | Yes |
| **Day** | The weekday, for **Weekly**. | Weekly only |
| **Time** | Delivery time in 24 hour HH:MM, in your browser's time zone, which is shown next to the label. | Yes |
| **Format** | **Excel (XLSX)** or **CSV**. | Yes |
| **Recipients** | Email addresses. Press Enter after each. Up to 20. | At least one |

Date chips such as **Today** are worked out again on every delivery, so a daily schedule with **Today** always sends that day's rows.

## What a delivery does

1. At the set time, KitStak builds the file from the saved view.
2. The file lands in **Excel Export History**.
3. Each recipient gets an email with a download link.

A schedule runs as the person who created it, with that person's warehouses, clients and permissions at delivery time. It never shows data its owner can't see. If email delivery isn't set up, the run is logged on the server instead of emailed.

## Manage schedules

The **Schedule** button shows how many schedules a report has. In the dialog, under **Scheduled for this report**, each schedule has **Send now**, **Pause** or **Resume**, and **Delete**. The **Report Hub** lists all your schedules under **Scheduled reports**. You can keep up to 25 schedules.

## Reports you can schedule

Channel Sales Report, Order Inventory, the three Serial Number Report tabs, Dynamic Replenishment Report, Inventory Snapshot Report, Change Log, Transaction History, Serial Number Transaction History, Missing Log, PO Receiving Report, User Performance Report, Inventory Aging Report, Location Utilization Report and Order Line Progress.

## Analytics exports

Each analytics chart has its own export menu with **Export as CSV** and **Export as Excel (.xlsx)**. See [Labor analytics and operational dashboards](/docs/wms/analytics-labor-and-operational).

## Related

- [Report Hub and the list of reports](/docs/wms/analytics-hub-and-catalog)
- [Change log, transaction history and other logs](/docs/wms/analytics-logs-and-history)
- [Inventory reports](/docs/wms/analytics-inventory-grids)
