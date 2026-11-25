---
title: Import a CSV file
description: Bring a spreadsheet into Pulse in four steps, Upload, Match columns, Check and Done, read every counter on the check, fix problem rows and undo an import for 7 days.
section: Import and export
order: 10
---

Every kind of data in Pulse can come in from a spreadsheet. You upload a file or paste rows, match your columns to Pulse's, and see a check of every row before anything is saved. The rows are saved together, and you can undo the whole import for 7 days.

## Before you start

- Most imports need a manager, admin or owner. A supervisor can import **Production**, **Other time**, **Time punches** and **Materials**.
- The **Labor rates** file needs an admin or the owner.
- Download the template for the kind of data first. See [CSV files and their columns](/docs/pulse/csv-templates).

## The import center

Go to **More > Import and export**. The **Import** tab has one card per kind of data, grouped **Set up once**, **Every day** and **Money in and out**. Each card shows how many rows are in Pulse, the last import, and two downloads: the template, and how to fill in the file. **Past imports** lists every import with who ran it, when, how many rows were new or changed, its status and an **Undo** button for 7 days.

## Step 1: Upload

1. Select **New import**, then pick what you are bringing in.
2. Under **How to bring the rows in**, pick **Upload a file** and drag the file in, or pick **Paste rows** and paste rows copied from Excel or Google Sheets with the row of column names on top.
3. Check **The first rows, as Pulse reads them**. If the columns look wrong, change **Columns are split by**. If your file has a title above the column names, pick the **Row with the column names**.

Pulse reads CSV files up to 10 MB, 50,000 rows and 200 columns. An Excel file must be saved as CSV first.

## Step 2: Match columns

Pulse lines up your columns with its own by name, so `Units Good`, `units_good` and `Good units` all match. Each column shows sample values.

1. Check each match. Pick **Do not import this column** for columns you do not need. The columns a row cannot be saved without are listed first.
2. Under **Before you check**:
   - **Use a saved mapping** to pick one you saved before.
   - **Dates like 3/4/2026**: **Let Pulse work it out**, **Month first: March 4** or **Day first: April 3**. Dates like 2026-03-04 or Mar 4 2026 are always read the same way.
   - **Add what is missing** (on by default): when the file names a client, job type or item Pulse does not have yet, add it. Each one is listed in the check.
   - **Remember this mapping** so the next file with the same column names matches itself.
3. Select **Check the file**.

## Step 3: Check every row

The check saves nothing. It shows what each row would do. The counters across the top are:

| Counter | What it counts |
| --- | --- |
| **New** | Rows that will be added. |
| **Changed** | Rows already here that will change. Each shows the fields that change, from and to. |
| **No change** | Already here and the same. |
| **Look the same** | Rows with no key that match a row already here, left out so money is not counted twice. |
| **Left out** | Rows you chose to leave out. |
| **Problems** | Rows that cannot be saved as they are. |

Select a counter to show only those rows. Each problem is named on its exact cell, for example "Row 22, job_number: there is no job J-2040. Add it first or turn on Create missing." or "October 2026 is closed. Ask the owner to reopen it."

To deal with problems:

- **Fix** a row: change its cells and select **Check this row again**.
- **Leave out** a row, or **Put back** one you left out.
- **Download rows with problems** to fix them in your spreadsheet.

Then pick **When a row has a problem**:

| Choice | What happens |
| --- | --- |
| **Save nothing** | One problem stops the whole file, so you never end up with half of it saved. The default. |
| **Skip bad rows** | The rows with problems are left out. The rest are saved. |

Two more switches may show:

- **Add new labor classes**: when the file names labor classes Pulse does not have. Off by default, and needs an admin or the owner. A new class has no rate yet, so its hours cost the workspace default until you set one.
- **Add them anyway**: saves rows that look the same as rows already here, when they really are separate rows.

If you imported the same file before, the check says so first: "You imported this same file on Nov 3."

The save button names the count, for example **Save 240 rows**. It reads **Finish** when every row is already in Pulse. Select **Back to columns** to change the matches, or **Discard** to drop the upload.

## Step 4: Done

The result line says how many rows were new, changed and already the same. From here you can **See it in Pulse**, **Import another file**, go to **All imports**, **Download rows left out**, or **Undo this import**.

## Undo an import

1. Open the import from **Past imports** or from its Done page.
2. Select **Undo this import** and confirm **Undo the import**.

The rows it added are removed and the rows it changed go back to what they were. Rows that someone changed after the import are left as they are, and Pulse says how many. After 7 days, undo is no longer offered.

## Related

- [CSV files and their columns](/docs/pulse/csv-templates)
- [Export your data](/docs/pulse/export-data)
- [Roles and who sees money](/docs/pulse/roles-and-access)
