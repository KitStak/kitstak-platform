---
title: Connected, computed and file columns
description: Link items across boards, mirror values from linked items, read formula and progress results, attach files and track who changed what.
section: Items and columns
order: 60
---

Some columns don’t hold a value you type. **Connect boards** links an item to items on other boards, and **Mirror** shows their values. **Formula** and **Progress** calculate a result. **Files** holds attachments. **Last updated**, **Creation log** and **Item ID** record facts about the item itself.

## Connect boards

A connect cell links the item to one or more items, such as a deal to its account and contacts.

1. Select the cell (**Link items**).
2. Type in **Search items to link**. Results show each item’s board and group.
3. Select an item to link it. Select **Unlink** on a chip to remove the link.

| Setting | What it does |
| --- | --- |
| **Allow linking more than one item** | On by default. Turn off to allow one linked item per cell |

Connect columns from the CRM templates are limited to the right board, so the **Account** column of a deal only searches the Accounts board. They are also two-way: linking a deal to an account adds the deal to the account’s **Deals** column. A connect column you add yourself searches items on every board you can open.

A linked item that was deleted, or that you can’t open, shows **Item unavailable**.

## Mirror

A mirror column shows values from the items linked in a connect column, such as the sum of deal values on an account. It is read-only and updates when the linked items change. The board templates set up which column it mirrors and how it combines values: as a list, or as a sum, average, minimum, maximum, count, earliest or latest value.

## Formula

A formula column calculates a value from other columns of the same item. It is read-only. For example, the Deals template’s **Forecast value** column multiplies **Deal value** by **Close probability** and divides by 100. If a formula can’t be calculated, the cell shows **Formula error**.

Formula columns from the templates come with their formula. You can rename a formula column and add a description in **Column settings**.

## Progress

A progress column shows how far an item is, as a percent. It counts the item’s status columns that are set to their Done label and its checkboxes that are checked, and divides by the number of those columns. The Customer onboarding template, for example, uses its **Status** column. See [Status, dropdown, tags and checkbox columns](/docs/crm/label-columns) to set the Done label.

## Files

1. Select the cell (**Add files**).
2. Drag files onto the box, or choose them from your computer.
3. Select a file to **Preview** it, or **Remove from cell** to take it off. Removing shows **Undo**.

Files you add here also appear in the item panel’s **Files** tab and in the board’s file gallery.

| File types you can upload |
| --- |
| PDF, plain text, CSV and JSON |
| ZIP archives |
| Word, Excel and PowerPoint documents |
| PNG, JPEG, GIF and WebP images |
| MP4 video and MP3 audio |

Other types are rejected. Each file must also be under the upload size limit of your KitStak installation.

## Last updated and Creation log

- **Last updated** shows when the item last changed and who changed it. Hover the cell for the exact time.
- **Creation log** shows when the item was created and by whom.

Both are filled in automatically and can be added once per board.

## Item ID

A unique identifier for each item. Select the copy button (**Copy item ID**) to copy it. A toast confirms **Item ID copied**. Use it when you match items with other systems.

## Button

A button column shows a labeled button on every item. When no action is connected to it, selecting it shows **No action is connected to this button yet**.

## Related pages

- [Add, edit and arrange columns](/docs/crm/columns)
- [The CRM boards: leads, deals, accounts, contacts and activities](/docs/crm/crm-boards)
- [Chart and file gallery views](/docs/crm/chart-and-file-gallery-views)
