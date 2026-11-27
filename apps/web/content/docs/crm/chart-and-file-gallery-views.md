---
title: Chart and file gallery views
description: Chart any board column as bars, lines, areas or pies, drill into the items behind a value, and browse, upload and preview every file on a board.
section: Views
order: 50
---

A chart view turns a board into a live chart that updates as items change. A file gallery view collects every file attached to the board’s items in one place.

## Add a chart view

1. Select **Add view** and pick **Chart**.
2. Open **Customize** (**Chart settings**) and pick a **Chart type**.
3. Set the data, as in the table below.

The CRM templates include charts such as **Pipeline by stage** on Deals, **By source** on Leads, **ARR by region** on Accounts and **Activity mix** on Activities.

## Chart types

**Column**, **Bar**, **Stacked column**, **Stacked bar**, **Line**, **Smooth line**, **Area**, **Stacked area**, **Pie** and **Donut**.

## Chart settings

| Section | Setting | What it does |
| --- | --- | --- |
| **Data** | **X-axis** (**Slices** for pie and donut) | The column that makes the categories, such as **Stage** |
| **Data** | **Group dates by** | For a date column on the X-axis: the date bucket |
| **Data** | **Y-axis** | **Count items**, or a number or currency column |
| **Data** | **Calculate** | **Count**, **Sum**, **Average**, **Minimum** or **Maximum** |
| **Data** | **Stack by** | A second column that splits each bar (stacked charts) |
| **Data** | **Sort** | **Board order**, **Value, high → low**, **Value, low → high**, **Name, A → Z** or **Name, Z → A** |
| **Data** | **Hide empty categories** | Leaves out categories with no items |
| **Customize** | **Data labels**, **Legend**, **Cumulative** | Display options |
| **Customize** | **Colors** | A color per category |

A stacked chart without a **Stack by** column shows **Choose a column to stack by**.

## Drill into a value

Select a bar, slice or point (**Click to see the items**). A list opens with the items behind that value. Select an item to open it.

## Export a chart

Open **Chart options** and choose **Export PNG**, **Export SVG** or **Export CSV**, or **Full screen** to present it.

## Use the file gallery

1. Select **Add view** and pick **File gallery**.
2. Search with **Search files**.
3. Filter by type: **All types**, **Images**, **Documents**, **Spreadsheets** or **Other**.
4. Sort by **Newest first**, **Oldest first** or **Largest first**.
5. Switch the **Layout** between **Grid** and **List**. The list shows **Name**, **Uploaded by**, **Date** and **Size**.

Select a file to preview it. In the viewer, use **Previous file** and **Next file**, and switch between **Fit** and **Zoom** on images.

## Upload files in the gallery

1. Select **Add files**, or drag files onto the view.
2. Choose the item to attach them to.
3. Confirm the upload.

A toast confirms how many files were uploaded and which item they are attached to.

## Delete a file

Open the file’s menu (**Actions for** the file) and delete it, then confirm **Delete file**. It is removed from its item for everyone.

## Related pages

- [Add and manage board views](/docs/crm/board-views)
- [Connected, computed and file columns](/docs/crm/connected-and-computed-columns)
- [Add and configure dashboard widgets](/docs/crm/dashboard-widgets)
