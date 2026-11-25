---
title: Export a board, view or selection
description: Download a view, a group or selected items as Excel or CSV, export charts, widgets, users and the audit log, and re-import KitStak exports cleanly.
section: Import and export
order: 20
---

Your data is yours. You can take any board view, group or selection out as an Excel or CSV file, and several other screens have their own export. Exports follow what you see: the current view’s filters, sort and columns.

## Before you start

- Members, admins and owners can export boards. Viewers and guests can’t.
- Only items you can see are exported.

## Export a view

1. Open the board and the view you want, with its filters and sort.
2. Open **More board actions** and select **Export this view**.
3. Pick **Excel (.xlsx)** or **CSV (.csv)**.

A toast says **Your export is being prepared…**, the file downloads, and a toast confirms it. You can also export from **More view options** in the toolbar with **Export view to Excel** or **Export view to CSV**.

## Export a group or a selection

- To export one group, open the group menu and select **Export group to CSV**.
- To export some items, select them with their checkboxes and select **Export** in the selection bar.

## What the file contains

| Column | What it holds |
| --- | --- |
| Name and every visible column | The values as they show in the view |
| `Group` | The group each item is in |
| `<column> (emails)` | The email addresses behind a people column |
| `<column> (currency)` | The currency code of a currency column |

These helper columns let a KitStak export import back into a board without creating extra columns. See [Import data from a spreadsheet](/docs/crm/import-data).

## Other exports

| Where | What you get |
| --- | --- |
| Chart view, **Chart options** | **Export PNG**, **Export SVG** or **Export CSV** of the chart |
| Dashboard widget menu | **Export CSV** of the widget’s data |
| **Dashboard options** | **Export as PDF** of the dashboard |
| **Admin > Users** | **Export CSV** of the user list, saved as `kitstak-users.csv` |
| **Admin > Audit log** | **Export CSV** of the entries that match your filters |
| Board menu, **Print** | A printable page of the board |

## Related pages

- [Import data from a spreadsheet](/docs/crm/import-data)
- [Search, filter, sort and group a board](/docs/crm/filter-sort-group)
- [Chart and file gallery views](/docs/crm/chart-and-file-gallery-views)
