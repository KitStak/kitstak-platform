---
title: Statuses and workflow
description: Set the steps every task in a project moves through, the category each step counts as, where new tasks start, and work-in-progress limits.
section: Fields
order: 10
---

Each project names its own steps between to do and done. These statuses are the columns on the board, left to right. Each status belongs to a category, and the category decides how the status counts toward progress, reports and automations.

## Before you start

- You need the Editor or Owner role on the project. Others see **Only project editors can change the workflow.**

## The four categories

| Category | Meaning |
| --- | --- |
| **To do** | Not started yet |
| **In progress** | Someone is working on it |
| **Done** | Finished. Counts toward progress |
| **Cancelled** | Won’t do. Left out of progress |

A blank project starts with **To do** (To do), **In progress** and **In review** (both In progress) and **Done** (Done). Templates bring their own statuses. See [project templates](/docs/projects/templates).

## Open the workflow

1. Open the project and select the **Settings** tab.
2. Select **Workflow**.

Each status shows its color, name, category, task limit, how many tasks it holds, and whether new tasks start there.

## Add a status

1. Under **Workflow**, type a name, such as `Waiting on client`.
2. Pick its category.
3. Select **Add status**.

## Change a status

| To | Do this |
| --- | --- |
| Rename it | Select the name, type, and press `Enter` |
| Recolor it | Select its color dot |
| Change its category | Pick a new one in its category menu |
| Reorder it | Drag it by its handle. With the keyboard, use the arrow keys, then `Space` to drop |
| Make new tasks start there | Select the star (**Make new tasks start here**) |
| Set a work-in-progress limit | Type a number in its limit box. Leave it empty for **No limit** |

## Delete a status

1. Select the bin next to the status.
2. If tasks are in it, pick where they should go under **Move tasks to**.
3. Select **Delete status**.

## Rules Projects checks

- A project needs at least one status. The last one can't be deleted.
- Status names can be up to 80 characters.
- A task limit has to be 1 or more, up to 999.
- When you delete a status that holds tasks, you must pick where they go.

## How categories are used

- **Mark done** moves a task to the first **Done** status. **Reopen** moves it to the status new tasks start in.
- Progress counts tasks in **Done** statuses. **Cancelled** tasks are left out.
- Automations can check **the kind of status** of a task. See [automation triggers, conditions and actions](/docs/projects/automation-reference).
- **Close without doing it** in the task menu moves a task to the project's **Cancelled** status.

## Related

- [Board view](/docs/projects/board-view)
- [Labels](/docs/projects/labels)
- [Project settings](/docs/projects/project-settings)
