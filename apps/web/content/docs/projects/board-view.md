---
title: Board view
description: Drag tasks between the status columns of a project, add swimlanes, set work-in-progress limits, collapse columns and add tasks right on the board.
section: Views
order: 20
---

The **Board** tab shows a project's tasks as cards in columns, one column per status, left to right. Drag a card to another column to change its status. Swimlanes split the board into rows by person, priority or label.

## Before you start

- To move or add cards you need the Editor or Owner role on the project.
- The columns are the project's statuses. To add, rename or reorder them, see [statuses and workflow](/docs/projects/statuses-and-workflow).

## Move a card

- Drag the card to another column, or to another place in the same column.
- With the keyboard: focus a card, press `Space` to pick it up, use the arrow keys to move it, `Space` to drop it, or `Esc` to cancel. `Enter` opens it.
- `H` and `L`, or the left and right arrows, move between columns. `J` and `K` move between cards.

You can only drag a card to a new place in its column while **Order cards by** is **Manual (drag to reorder)**. With another order, Projects tells you to switch the order to Manual in **Display**.

## What a card shows

A card shows the task's key, name, labels, priority, due date and assignee. A card that waits on another task shows a waiting mark. A card with points shows its estimate. Select the due date, priority or assignee on the card to change it in place, or use the card's **More actions** menu.

## Add a task on the board

1. Select the plus at the top of a column, or open the column menu and select **Add a task here**.
2. Type in **What needs to be done?**
3. Press `Enter` to add it. Press `Esc` to stop.

The new task starts in that column.

## Column menu

Open a column's menu (**column options**).

| Item | What it does |
| --- | --- |
| **Add a task here** | Adds a task in this column |
| **Collapse column** | Folds the column to a narrow strip. It is still a drop target. Select it to expand |
| **Work-in-progress limit** | **No limit**, or 3, 5, 8, 10, 15 or 20 tasks |

An empty column whose status is in the **Cancelled** category folds away on its own.

### Work-in-progress limits

A limit is the most tasks a column should hold at once. The count at the top of the column shows, for example, `4 / 5`. At the limit it turns yellow; over the limit it turns red with the tip **Finish something before starting more.** The limit warns; it does not stop you moving cards.

You can also set limits in **Settings > Workflow**. Only editors and owners can change them.

## Display options

Open **Display** in the filter bar.

| Option | Choices |
| --- | --- |
| **Swimlanes** | **No swimlanes**, **Assignee**, **Priority**, **Label**, and **CRM customer** or **WMS status** when tasks are linked to those records |
| **Order cards by** | **Manual (drag to reorder)**, **Priority**, **Due date**, **Newest first**, **Name (A to Z)** |
| **Done tasks** | Show or hide cards in done columns |
| **Subtasks as cards** | Show subtasks as their own cards |
| **Only done in the last 14 days** | Hides done cards finished more than 14 days ago |

With swimlanes on, dragging a card into another lane changes that field too, such as its assignee. Lanes by a linked CRM customer or WMS status are for looking only: cards can't move between them, and each lane has **Show only this**.

## Related

- [Views, filters and saved views](/docs/projects/views-and-filters)
- [Statuses and workflow](/docs/projects/statuses-and-workflow)
- [Cycles](/docs/projects/cycles)
