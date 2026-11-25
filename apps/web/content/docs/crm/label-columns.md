---
title: Status, dropdown, tags and checkbox columns
description: Track stages with colored status labels, pick several dropdown labels, add free-form tags and tick checkboxes, and edit the labels of a column.
section: Items and columns
order: 30
---

Label columns turn a value into a choice. A **Status** cell holds one colored label, such as a deal stage. A **Dropdown** cell holds several labels. **Tags** are free text you type, and **Checkbox** is yes or no. These columns drive the kanban lanes, group summaries, progress and many automations.

## Status

A status cell shows one label as a full colored pill.

1. Select the cell to open the label picker.
2. Pick a label, or search with **Search labels**.
3. Pick **No label (clear)** to empty the cell.

A new status column starts with **Working on it** (orange), **Done** (green) and **Stuck** (red), plus a blank label for empty cells.

## Dropdown

A dropdown cell can hold several labels.

1. Select the cell (**Add labels**).
2. Pick one or more labels. Type in **Search or create a label** to find one, or to create a new label from what you typed.
3. Select a chosen label again to remove it.

A new dropdown column has no labels until you add them.

## Edit labels

1. Open the column menu and select **Edit labels**, or select **Edit labels** at the bottom of the label picker.
2. In **Edit labels**, change a label’s name, or select its color swatch (**Label color**) to pick another color.
3. Select **New label** to add one.
4. Drag a label by its handle to reorder.
5. On a status column, select the check next to a label to mark it as the Done label (**Mark as the Done label**). The Done label shows **Counts as done**.
6. Select **Apply**.

Changes apply to every item on the board. If you close the dialog with unsaved changes, it asks **Discard your unsaved label changes?** with **Keep editing** and **Discard**.

## Delete a label

1. In **Edit labels**, select **Delete label** next to the label. If items use it, the button shows how many, for example **Delete (used by 4)**.
2. If the label is in use, choose where those items go under **Move them to:**. Pick another label or **No label (clear)**.
3. Confirm, then select **Apply**.

## Label rules

| Rule | Message you see |
| --- | --- |
| A label name is 100 characters or fewer | **Keep label names under 100 characters** |
| Dropdown labels need a name | **Give this label a name** |
| Two labels in a column can’t share a name | **Another label already has this name** |

A column can have up to 200 labels. Colors come from a palette of 24, including green, orange, red, gray, blue, purple, pink, teal, yellow and light variants.

## Why the Done label matters

The Done label of a status column is used by:

- **Progress** columns, which count done labels. See [Connected, computed and file columns](/docs/crm/connected-and-computed-columns).
- **Battery** widgets on dashboards.
- Automation recipes that run when work is done.
- My work, which uses it for **Mark done**.

## Tags

Tags are free-form words you type, shown as `#tag`.

1. Select the cell (**Add tags**).
2. Type in **Search or create a tag**. Pick a suggestion, or select **Create** to add a new tag.
3. Press `Backspace` in an empty field to remove the last tag, or select a tag’s remove button.

## Checkbox

Select the cell to tick or clear it. The group footer shows how many items are checked. Filters offer **Checked** and **Unchecked**.

## Related pages

- [Add, edit and arrange columns](/docs/crm/columns)
- [Kanban view](/docs/crm/kanban-view)
- [Automate a board with recipes](/docs/crm/automations)
