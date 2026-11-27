---
title: Work with tasks
description: Open a task in the side panel or as a full page, set its status, people, priority, dates, estimate, labels and milestone, and copy, move or delete it.
section: Projects and tasks
order: 40
---

A task is one piece of work in a project. Every task gets a short key made of the project key and a number, such as `OPS-42`, that people can say out loud and type into search. This page covers the task panel and everything you can set on a task.

## Before you start

- To add or change tasks you need the Editor or Owner role on the project. Commenters can comment and upload files. Viewers can only look. See [roles and permissions](/docs/projects/roles-and-permissions).
- To create tasks, see [add tasks with quick add](/docs/projects/quick-add).

## Open a task

- Select a task on any board, list, table, calendar or timeline. It opens in a side panel. The page behind stays usable: select another task and the panel switches to it.
- Use the up and down arrows, or `J` and `K`, to walk through the tasks in the order the page shows them. The panel header shows where you are, such as **Task 3 of 12**.
- To open the full page, select **Open full page**. The address is the project key and number, such as `/p/OPS/42`.
- Add `?task=OPS-42` to any Projects address to open that task's panel there.

## Task properties

| Property | What it holds |
| --- | --- |
| **Status** | One of the project's statuses. See [statuses and workflow](/docs/projects/statuses-and-workflow) |
| **Assignee** | The one person doing the work. **Assign to me** takes it. Empty shows **No one yet** |
| **Reporter** | The person who asked for it. It starts as whoever created the task |
| **Priority** | **Urgent**, **High**, **Medium**, **Low** or **No priority** |
| **Start date** | When work starts. Empty shows **No start date** |
| **Due date** | When it must be done. Empty shows **No due date** |
| **Estimate** | **Story points**, **Time it should take**, or both |
| **Labels** | Any number of labels. **Add labels** creates new ones |
| **Milestone** | One of the project's milestones, or **No milestone** |
| Custom fields | Every custom field the project has. See [custom fields](/docs/projects/custom-fields) |

Below the properties come the **Description**, **Subtasks**, **Dependencies**, **Linked records**, **Files**, **Time** and the comments and history.

## Rules for dates and estimates

- The start date has to be on or before the due date. In the date picker, days past the other date are shaded. Picking one moves the other date too (**Moves due too**, **Moves start too**).
- Story points must be a whole number from 0 to 1000.
- Type time like `45m`, `2h` or `1h 30m`. If you type a time in the points box, Projects moves it to **Time it should take**.
- Leave a box empty to clear it.

## Write the description

Select **Add details: what needs to happen, links, a checklist…** and type. The description **Saves by itself** about a second after you stop typing, when you leave the box, when you press `Ctrl` `S`, and when you close the panel.

The formatting bar offers **Heading**, **Bulleted list**, **Numbered list**, **Checklist**, **Quote**, **Code block**, **Inline code**, **Italic**, **Strikethrough** and **Add link**.

## Mark a task done

- Select the round check next to the task, or **Mark done** in the panel header.
- Or press `Ctrl` `Enter` with the task open or selected.

The task moves to the project's first done status. **Reopen** moves it back to the status new tasks start in. A task that is still waiting on open tasks shows a yellow note, such as **Waiting on another task.**, with links to the tasks to finish first.

## The task menu

Open **More actions** in the panel header.

| Item | What it does |
| --- | --- |
| **Copy link** | Copies the task's address |
| **Copy task key** | Copies the key, such as `OPS-42` |
| **Open full page** | Opens the task on its own page (in the panel only) |
| **Follow this task** | Sends you its updates. **Stop following** ends that |
| **Mark done** | Moves it to the done status. **Reopen** if it is done |
| **Close without doing it** | Moves it to the project's cancelled status, if it has one |
| **Duplicate** | Makes a copy. Subtasks are copied too |
| **Move to project** | Moves the task and its subtasks to another project |
| **Make it a subtask of…** | Puts it under another task. **Make it a regular task** takes it out again |
| **Delete task** | Deletes it and its subtasks. You can undo right after |

Right-click a task in a view for a shorter menu with **Status**, **Priority**, **Assign**, **Labels**, **Due date** (with **Today**, **Tomorrow** and **In a week**) and **Move to project**.

## Rules Projects checks

- Every task needs a name, up to 500 characters.
- You cannot add tasks to an archived project. Restore it first.
- A subtask moves with its parent. To move it to another project, move the parent.
- The assignee must be a member of the workspace.

## Related

- [Subtasks and dependencies](/docs/projects/subtasks-and-dependencies)
- [Comments, files, followers and time](/docs/projects/comments-files-and-time)
- [Keyboard shortcuts](/docs/projects/keyboard-shortcuts)
