---
title: Build a custom automation
description: Pick a trigger, add conditions and chain up to ten actions in the automation builder, with every trigger, condition and action explained.
section: Automations
order: 20
---

When no recipe fits, build the automation yourself. The builder reads like a sentence: **When** a trigger happens, **And only if** conditions hold, **Then** do one or more actions. You fill in each underlined part.

## Before you start

- You need edit access to the board.
- Make sure the board has the columns the automation will use, such as a status, people or date column.

## Build an automation

1. Open the board and select **Automate**.
2. On **Board automations**, select **Create automation**, or select **Build from scratch** on **Recipes**.
3. Under **When**, pick a trigger in **Choose a trigger**. Select **Change** to pick another one later.
4. Select **Add conditions or more actions**, then **Add condition** if the automation should run only in some cases.
5. Under **Then**, pick an action with **Add an action**. Select **Add another action** to chain more.
6. Select each underlined part of a clause and choose its value.
7. Reorder actions with **Move up** and **Move down**. Remove a clause with **Remove condition** or **Remove action**.
8. Check the summary **In plain English** and the **Name**.
9. Select **Create automation**. When you edit an existing one, select **Save changes**.

The builder tells you what is missing: **Choose a trigger to start**, **Add at least one action** or **Fill in all fields**. When everything is set, it says **Ready to go**. If you close the builder with changes, it asks **Discard this automation?**.

## Triggers

| Trigger | Sentence | Notes |
| --- | --- | --- |
| **When status changes** | When a status column changes to a label | Pick **anything** to run on every change |
| **When a column changes** | When a column changes | Any column you can edit |
| **When a person is assigned** | When someone is assigned to a people column | Pick **anyone** or a specific person |
| **When an item is created** | When an item is created | Runs for every new item |
| **When an item moves to a group** | When an item is moved to a group | Pick the group |
| **When a date arrives** | When it’s the day of, or a number of days before or after, a date column | Up to 365 days before or after |

Triggers are grouped in the menu under **Column changes**, **Items** and **Dates & time**.

## Conditions

| Condition | Sentence |
| --- | --- |
| **Status is…** | A status column is one of the labels you pick |
| **Column is not empty** | A column has a value |
| **Column is empty** | A column has no value |
| **Number meets a threshold** | A number, currency or rating column is **greater than**, **at least**, **less than** or **at most** a value |
| **Person is assigned** | A people column includes a person |
| **Item is in group** | The item is in a group |

Every condition must hold for the actions to run. You can add up to 10 conditions.

## Actions

| Action | Sentence | Notes |
| --- | --- | --- |
| **Notify** | Notify someone with a message | Pick people, or **Everyone assigned in this column**. The message can be up to 2,000 characters |
| **Post an update** | Post an update on the item | Up to 2,000 characters |
| **Change status** | Change a status column to a label | |
| **Assign a person** | Assign someone as a people column | Pick people, or **Whoever triggered it** |
| **Set a date** | Set a date column to today, or a number of days from today or ago | Up to 3,650 days either way |
| **Clear a column** | Clear a column | |
| **Move to group** | Move the item to a group | Subitems stay with their parent |
| **Archive the item** | Archive the item | |
| **Create an item on a board** | Create an item on a board, in a group, with a name | The group is optional: **The top group** by default |

You need at least one action and can add up to 10. Actions run in order.

## Insert the item or board name

In a message, an update or a new item name, use **Insert:** to add **Item name** (for example **Deal name**) or **Board name**. They are replaced with the real names when the automation runs, for example `Time to follow up on Fleet automation rollout`.

## Rules

- An automation’s name is required and can be up to 255 characters.
- Columns, labels and groups an automation uses must exist on the board. If you delete one, the automation can fail. Its runs then show **Failed** in **Run history**.
- Notify needs at least one person or a people column. If the column is empty for an item, the run shows **Nobody to notify (the recipients list was empty)**.

## Related pages

- [Automate a board with recipes](/docs/crm/automations)
- [Test automations and read run history](/docs/crm/automation-runs)
- [Notifications and the bell](/docs/crm/notifications)
