---
title: Import data from a spreadsheet
description: Import an Excel, CSV or TSV file or pasted rows into a new or existing board, map columns, handle duplicates and problems, and undo an import.
section: Import and export
order: 10
---

The import wizard brings spreadsheet data into a board in five steps: **Upload**, **Destination**, **Map columns**, **Review** and **Import**. Nothing is saved to a board until you confirm the import, and you can undo it afterwards.

## Before you start

- You need the member role or higher. Otherwise the page says **You need edit access to import**.
- Files can be `.xlsx`, `.csv` or `.tsv`, up to 10 MB and 10,000 rows. Legacy `.xls` workbooks are not supported. Save them as `.xlsx` or `.csv` first.
- From Google Sheets, choose **File > Download** and pick `.xlsx` or `.csv`.
- From another CRM, export contacts, companies or deals to CSV or Excel. Duplicates can be matched by email or name.

## Open the import wizard

Use any of these:

- **Import** on Home.
- **Import data** in the Workspaces add menu or in search.
- **Import data…** in a board’s menu, or **Import items** in the toolbar split menu. The board is picked for you.

## Step 1: Upload

1. Pick **Upload a file** (Excel, CSV or a Google Sheets download) or **Paste rows** (copy cells from any spreadsheet).
2. For a file, drop it on the page or choose it. For pasted rows, paste them including the header row and select **Use these rows**.
3. If the workbook has several sheets, pick the **Sheet**.
4. Check **First row contains column names**. The wizard finds the header row and skips the rows above it. Turn it off if your file starts with data.
5. Select **Next**.

A sample header row looks like this:

```
Name,Email,Company,Status,Owner
```

## Step 2: Destination

Under **Where should the rows go?**:

- **New board**: columns are created from your file. Enter a **Board name**, pick the **Workspace**, and under **What are you importing?** pick **Leads**, **Contacts**, **Accounts**, **Deals** or **Something else**. The CRM choices use the matching CRM template.
- **Existing board**: map onto its columns and add to a group. Pick the **Board** and the **Group**, or **New group…** with a **New group name**.

## Step 3: Map columns

Each row of the mapping table pairs a **Column in file** with a **Column on board**.

| Choice | What it does |
| --- | --- |
| The name column | **Required · the title of each row** |
| An existing column | Fills that column |
| **New column** | Creates a column from this data. Pick its name and type |
| **Group** | Puts each row in the group with this name |
| **Don't import** | Leaves this column out |

New columns can be **Text**, **Long text**, **Email**, **Phone**, **Link**, **Number**, **Currency**, **Date**, **Yes/No**, **Labels**, **People**, **Tags** or **Country**. The wizard suggests a type from your data. New labels get colors automatically, and you can recolor them on the board. People are matched to teammates by email or name. Separate several people with commas. A value with no match shows as a problem, for example **No teammate matches**.

A file exported from KitStak maps back on its own: its **Group** column routes rows to groups, and its `(emails)` and `(currency)` helper columns fill people and currency values.

## Step 4: Review

The **Summary** shows **Rows in file**, **Ready to import** and **Will be skipped**.

1. Fix problems inline. Each problem shows the **Row**, **Column**, **Value** and **Problem**. A row without a name is always skipped until you type a name.
2. Or turn on **Skip rows with problems**, or skip single rows with **Skip**.
3. When importing into an existing board, choose what happens **When a row matches** an item already on the board, under **Duplicates**:

| Option | What it does |
| --- | --- |
| **Always create new** | Every row becomes a new item |
| **Skip duplicates** | Leaves existing items untouched |
| **Update existing** | Fills matched items with the file’s non-empty values |

4. Under **Match on**, pick the item name or a column, such as **Email**.
5. Select the import button. It names what will happen, for example **Import 5 contacts**, **Update 5 contacts** or **Import 3, update 2 contacts**.

Rows beyond 10,000 are not imported. Download the **Error report** to keep a list of problems.

## Step 5: Import

The wizard shows progress and then a summary: **Created**, **Updated**, **Skipped** and **Failed**.

- Select **Pause now** to pause, and **Resume import** to continue. Select **Run in background** to keep working while it finishes.
- Select **Import another file** to start again.
- Select **Error report** to download the rows that failed.

If you leave the wizard before you finish, it asks **Keep your progress?** Your file and mapping stay until you come back.

## Undo an import

1. On the summary, select **Undo import**, or **Remove what was added** for an import into an existing board.
2. Confirm.

Imported items are archived and updated items are restored. New columns and labels that nothing else uses are removed. For an import that created a board, turn on **Also delete the board** to move the empty board to the trash.

## Related pages

- [Export a board, view or selection](/docs/crm/export-data)
- [Find and merge duplicate records](/docs/crm/duplicates)
- [Create a board from scratch or a template](/docs/crm/create-a-board)
