---
title: Timeline view
description: Plan work as bars on a timeline, drag to move and resize tasks, link tasks that wait on each other, see the critical path and zoom from days to quarters.
section: Views
order: 50
---

The **Timeline** tab shows each task as a bar from its start date to its due date. Drag bars to plan, link tasks that wait on each other, and see which tasks decide when the project ends. A line marks today.

## Before you start

- To move bars or link tasks you need the Editor or Owner role on the project.
- A task needs a start or due date to show as a bar. Tasks with no dates wait in **No dates**.

## Move and resize bars

- Drag a bar to move it. It keeps its length.
- Drag either end to change the start or due date.
- With a bar selected, the arrow keys move it a day. Hold `Shift` to change only its due date.
- Drag across an empty row to give a task dates.
- Drag across an **Add task** row in a group to make a new task with those dates. Type the name in **What needs to get done?** and press `Enter`.

Each move shows a message with **Undo**.

## Give tasks without dates a place

1. Select **No dates** in the toolbar. The list shows tasks you can see that have no dates yet.
2. Drag a task onto the timeline to give it dates.
3. To clear a task's dates, drag its bar onto the **No dates** list.

When every task you can see has a date, the list says **Everything is scheduled**.

## Link tasks

1. Drag the dot at the end of a bar onto another bar. That says “this has to finish first”.
2. Let go. An arrow joins the two bars.

If the second task starts before the first one is done, Projects offers **Move it later**. Select a line to remove the link or fix the clash. When you move a task and tasks that wait on it now start too early, the message offers to move them too.

See [subtasks and dependencies](/docs/projects/subtasks-and-dependencies) for the rules.

## Milestones and the due date

Milestones show on their dates. Editors can drag a milestone to move it. The project's due date shows as a dotted line; point at it to see **Project due date**.

## Critical path

Select **Critical path** to highlight the tasks that decide when the project ends. A note says how many tasks decide the end date, and that if one of them slips, the end date slips too. Give tasks dates and link them to see the full chain.

## Toolbar

| Control | What it does |
| --- | --- |
| **Zoom** | **Days**, **Weeks**, **Months** or **Quarters** |
| **Today** | Jumps to today |
| **Fit** | Fits all bars on screen |
| **Critical path** | Highlights the tasks that set the end date |
| **Find a task** | Finds a task by name |
| **No dates** | Opens the list of tasks with no dates |
| **Saved views** | Saves the zoom, grouping and options as a view |

## Options

Open the options menu in the toolbar.

| Option | Choices |
| --- | --- |
| **Group by** | **Section**, **Status**, **Person** or **No groups**. **Collapse all** and **Expand all** fold the groups |
| **Color bars by** | **Status** or **Priority** |
| **Show links between tasks** | Arrows from a task to the tasks waiting on it |
| **Show subtasks** | Shows subtasks as their own bars |
| **Show finished tasks** | Shows done tasks |
| **Shade weekends** | Shades Saturdays and Sundays |

A bar past its due date and not done is marked **Past its due date**.

## Related

- [Subtasks and dependencies](/docs/projects/subtasks-and-dependencies)
- [Calendar view](/docs/projects/calendar-view)
- [Project overview and status updates](/docs/projects/project-overview)
