---
title: Add tasks with quick add
description: Press C anywhere and type a task as one line. Quick add reads the due date, priority, assignee, labels and project out of what you type.
section: Quick add
order: 10
---

Quick add is the **New task** box. Type a task as one sentence, such as `Order pallet wrap next fri !high @dana #supplies`, and quick add fills in the due date, priority, assignee and labels for you. Chips under the box show what it understood, and you can still set every field by hand.

## Before you start

- You need the Editor or Owner role on at least one project. Quick add only offers projects you can add tasks to.

## Open quick add

- Press `C` anywhere.
- Select **New task** in the top bar.
- In a project, select **Add task** in the header. The task goes into that project.
- In the command palette, type your task and select **New task “your words”**.

## Add a task

1. Type the task name with any details. See the [quick add syntax reference](/docs/projects/quick-add-syntax) for every word quick add understands.
2. Check the chips under **We understood:**. Each chip shows a date, priority, person, label or project that was read out of your text.
3. Optional: set or change **Project**, **Status**, **Assignee**, **Due date**, **Priority** and **Labels** with the pickers. A picker you change wins over the text, and the matching word leaves the name.
4. Optional: select **Details** and add notes, links or steps.
5. Select **Add task**, or press `Enter`.

To add the task and open it straight away, select **Add and open** or press `Ctrl` `Shift` `Enter`. Tick **Add another** to keep the box open for the next task.

## Which project the task goes into

Quick add picks the project in this order:

1. A `+KEY` or `+name` in your text.
2. The project you picked with **Project**.
3. The project you are looking at.
4. The project you used last.
5. The first project you can add tasks to.

## Chips and what they mean

| Chip | Meaning |
| --- | --- |
| A date, such as `Fri, Dec 4` | The due date it will use |
| **Urgent**, **High**, **Medium**, **Low**, **No priority** | The priority |
| A person's name | The assignee. `@me` shows **Me** |
| A label name | A label that will be added |
| A label name with **(new)** | A label that will be created when you save |
| A project name | The project the task goes into |
| A red chip, such as **No one named sam** | A name that matched nobody. The task stays unassigned |
| A red chip, such as **No project called xyz** | A project that matched nothing. The text stays in the name |

Select **×** on a chip to **Keep as plain text**: the words stay in the task name and are not used as a field.

## New labels

When you can manage labels, a `#name` that matches no label becomes a new label when you save. People who cannot create labels see a warning chip instead, and the text stays in the name. In the **Labels** picker, type a name and select **Create label** to add one by hand.

## Warehouse codes become links

When your organization runs KitStak WMS, a warehouse code in the task name links the task to that record. Type a receipt, order, work order or count code, such as `PO2240`, `SO10482`, `WO94` or `CNT144`.

- Quick add writes the code the way WMS does, with six digits: `PO2240` becomes `PO002240`.
- A **Links to** chip shows the record. Select **Don't link** on it to leave it out.
- Up to three codes are linked from one name.

## Rules quick add checks

- A task needs a name. If only tokens are left, quick add asks you to add a few words for the task name.
- A task needs a project. Pick one if quick add cannot find one.

## Related

- [Quick add syntax reference](/docs/projects/quick-add-syntax)
- [Work with tasks](/docs/projects/tasks)
- [Keyboard shortcuts](/docs/projects/keyboard-shortcuts)
