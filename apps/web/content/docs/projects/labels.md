---
title: Labels
description: Tag tasks with colored labels, add and manage a project's labels in settings or right from a task, and filter, group and automate by label.
section: Fields
order: 20
---

Labels are colored tags you put on tasks, such as `Bug`, `Client action` or `Design`. A task can have any number of labels. Use them to filter views, group the board and list, and set off automations.

## Before you start

- You need the Editor or Owner role on the project to add, change or delete labels.

## Add a label to a task

- In the task panel, select **Labels** (or **Add labels**) and pick one. Type a new name to create it.
- Press `#` with a task selected to change its labels.
- In quick add, type `#` and the label name. See [the quick add syntax reference](/docs/projects/quick-add-syntax).

## Manage a project's labels

1. Open the project and select the **Settings** tab.
2. Select **Labels**.

| To | Do this |
| --- | --- |
| Add a label | Pick a color, type in **New label name** and select **Add label** |
| Rename a label | Select its name, type, and press `Enter` |
| Recolor a label | Select its color dot |
| Delete a label | Select the bin, then **Delete label** |

Each label shows how many tasks use it. Deleting a label takes it off those tasks; the tasks stay.

### Labels for every project

Some labels belong to the whole workspace instead of one project. They show an **Every project** badge, appear in every project, and can't be renamed, recolored or deleted from a project's settings.

## Rules Projects checks

- Label names can be up to 40 characters.

## Where labels are used

| Place | How |
| --- | --- |
| Filter bar | **Labels** filter, with **No label** for tasks with none |
| Board | **Swimlanes** by **Label** |
| List and Table | **Group by** **Label** |
| Bulk bar | **Labels** adds a label to every selected task |
| Automations | The trigger **a label is added**, the condition **the labels**, and the actions **add a label** and **remove a label** |

## Related

- [Custom fields](/docs/projects/custom-fields)
- [Statuses and workflow](/docs/projects/statuses-and-workflow)
- [Views, filters and saved views](/docs/projects/views-and-filters)
