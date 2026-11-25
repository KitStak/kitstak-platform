---
title: Subtasks and dependencies
description: Break a task into subtasks, and say which tasks must finish before another can start, from the task panel or by drawing links on the timeline.
section: Projects and tasks
order: 50
---

Subtasks break a big task into steps. Dependencies say what has to finish before what can start. Both live in the task panel, and dependencies also show as arrows on the timeline.

## Before you start

- You need the Editor or Owner role on the project.

## Add subtasks

1. Open the task.
2. Under **Subtasks**, select **Add a subtask**.
3. Type the name and press `Enter`. The box stays open as **Add another subtask** so you can keep going.
4. Press `Esc` when you are done.

Each subtask row has its own check, assignee and due date (**Set due date**), and a menu with more actions. Drag a row by its handle to reorder it.

Done subtasks fold away. Select **Show done subtasks** to see them, or **Hide done subtasks** to fold them again.

## Turn a task into a subtask

1. Open the task and select **More actions**.
2. Select **Make it a subtask of…**.
3. Find the parent task with **Find the parent task…** and pick it.

To take it out again, open the subtask's menu and select **Make it a regular task**.

### Subtask rules

- A subtask lives in the same project as its parent.
- A task cannot be its own subtask, or sit inside one of its own subtasks.
- A subtask moves with its parent. Move the parent to move them both to another project.
- Deleting a task deletes its subtasks. You can undo right after.

## See subtasks in views

Subtasks are hidden from views by default. Turn them on from **Display**:

| View | Display option |
| --- | --- |
| Board | **Subtasks as cards** |
| Table | **Subtasks as rows** |
| Timeline | **Show subtasks** |
| Calendar | **Show subtasks** |

In List, a task with subtasks shows a count. Select it to show or hide them under the task.

## Add a dependency in the task panel

1. Open the task.
2. Under **Dependencies**, select **Add**.
3. Choose **This waits on…** when the task you pick must be finished before this one can start, or **This blocks…** when the task you pick can't start until this one is done.
4. Pick the task. The list shows tasks in this project first, then everything else.

The panel lists the links under **Waiting on** and **Blocking**. Select **Stop waiting on** or **Stop blocking** to remove one. With no links, it says **Nothing is waiting on this, and it isn't waiting on anything.**

While a task waits on open tasks, its panel shows **Waiting on another task.** (or the number of tasks) with links to finish first, and its board card shows a small waiting mark.

### Dependency rules

- A task can't wait on itself.
- Projects refuses a link that would make a loop: **That would create a loop: these tasks would be waiting on each other.**

## Draw a dependency on the timeline

1. Open the project's **Timeline** tab.
2. Drag the dot at the end of a bar onto another bar. The tip reads **Release to make** that task **wait on this one**.
3. Let go. The link draws as an arrow.

If the waiting task now starts before the first one is done, Projects says so and offers **Move it later**. Select a line to remove it (**Link removed**) or to fix the clash. Turn the arrows on or off with **Show links between tasks** in the timeline options.

When you move a bar and tasks that wait on it now start too early, the message offers to move them too.

## Find the critical path

On the timeline, select **Critical path**. It highlights the tasks that decide when the project ends: if one of them slips, the end date slips too. Give tasks dates and link them to see the full chain.

## Related

- [Timeline view](/docs/projects/timeline-view)
- [Work with tasks](/docs/projects/tasks)
- [Automation triggers, conditions and actions](/docs/projects/automation-reference)
