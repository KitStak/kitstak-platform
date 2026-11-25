---
title: Export your data
description: Download any of the 17 kinds of data as a CSV file in the columns of its import template, filter it, or download everything as one zip.
section: Import and export
order: 30
---

Your data is always yours. Each of the 17 kinds of data downloads as a CSV file with one click, in the same columns as its import template, so a file you export can be fixed and imported back. You can also take everything in one zip file.

## Before you start

- Everyone with a Pulse role can export what they can see. Money columns are left out for roles that do not see money, and wage columns need an admin or the owner.
- Files open cleanly in Excel and Google Sheets.

## Export one kind of data

1. Go to **More > Import and export** and open the **Export** tab.
2. Pick the **Date range**: **All time**, **This month**, **Last month**, **This year**, or a **From date** and **To date**.
3. Optionally filter by client (**Every client**), **Job type**, site (**Every site**) and **Job status** (**Every status**). Your filters apply where a file has that column.
4. Turn on **Leave money out** to drop prices, costs and wages from the files.
5. Next to the kind of data, select its download button, for example **Download Production as CSV**.

Each card shows how many rows are in Pulse. A file that is all money, like **Labor rates** for a role that cannot see wages, says why it is left out.

## Download everything

Select **Download everything (zip)**. The zip holds one CSV file for every kind of data that has rows, with your date range applied, and a `READ ME.txt` that lists each file and its row count. Each file is cut at 200,000 rows, and the read me says when a file was cut.

## File names

A file is named `pulse-` then the kind of data, your workspace and the dates, for example `pulse-production-acme-2026-11-01-to-2026-11-30.csv`.

## Save an export setup

Use **Saved exports** to keep a date range and filters you use often, and pick them again in one click.

## Other places to export

| Where | What you get |
| --- | --- |
| **Jobs** | **Export CSV** of the list as shown. |
| **Profit** | The table or the numbers behind the chart. |
| **Labor** | The rows of each tab. |
| **Log work > All entries** | The filtered entries, ready to import back. |
| **Goals** | The goals, in the Goals template. |
| **Alerts** | The alerts in the list, as a CSV file. |
| **Reports** | **Download CSV** on any report. See [Run a report](/docs/pulse/reports). |
| **Settings > Audit log** | The log as a CSV file. See [Read the audit log](/docs/pulse/audit-log). |
| An import | The rows with problems, or the rows left out. |

## Related

- [CSV files and their columns](/docs/pulse/csv-templates)
- [Import a CSV file](/docs/pulse/import-csv)
- [Run a report](/docs/pulse/reports)
