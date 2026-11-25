---
title: Custom fields
description: Track extra details on every task in a project, like a PO number, cost, region or client, with nine field types that show in the task panel and the table.
section: Fields
order: 30
---

Custom fields track extra details on every task in a project, such as a PO number, a cost or a region. They show in the task panel and as columns in the **Table** view, where number and money fields add up in the totals row.

## Before you start

- You need the Editor or Owner role on the project.

## Field types

| Type | What it holds |
| --- | --- |
| **Text** | A short note, like a PO number |
| **Number** | Any number, like hours or quantity |
| **Single choice** | Pick one choice from a list |
| **Multiple choice** | Pick several choices from a list |
| **Date** | A calendar date |
| **Person** | Someone in the workspace |
| **Checkbox** | Yes or no |
| **Money** | An amount of money |
| **Link** | A web link |

## Add a custom field

1. Open the project and select the **Settings** tab.
2. Select **Custom fields**, then **Add field**.
3. Enter the **Field name**, such as `Region`.
4. Pick the **Type**.
5. For **Single choice** and **Multiple choice**, add the **Choices**: type one and press `Enter`, then pick a color for each.
6. For **Money**, pick the **Currency**: `USD`, `EUR`, `GBP`, `CAD`, `AUD`, `MXN` or `JPY`.
7. Optional: add **Help text**. It shows under the field so people know what to put in it.
8. Optional: turn on **Required** to ask for it on every task. It shows a reminder when it’s empty.
9. Select **Save field**.

The field shows on every task in the project straight away.

## Change or delete a field

- Select the pencil next to a field to edit it. Changes apply to every task in this project. The type can’t change once tasks have values.
- Select the bin to delete it. Its values disappear from every task in this project. This can’t be undone.

Fields with an **Every project** badge belong to the whole workspace and show in every project.

## Fill in a field on a task

1. Open the task.
2. Find the field under the task properties. An empty field shows **Empty**.
3. Select it and enter a value. For choice fields, pick from the list. If the field has no choices yet, add them in project settings.

You can also edit custom fields right in the **Table** view.

## Rules Projects checks

- A **Single choice** or **Multiple choice** field needs at least one choice. Empty choices are dropped when you save.

## Where custom fields are used

| Place | How |
| --- | --- |
| Task panel | Shown with the other properties |
| Table | One column per field, sortable, with totals for number and money fields |
| Table grouping | **Group by** a single choice **Custom field** |
| Intake forms | A form answer can fill a custom field. See [intake forms](/docs/projects/intake-forms) |
| Templates | Saved with the project and copied into new projects |

## Related

- [Table view](/docs/projects/table-view)
- [Labels](/docs/projects/labels)
- [Project templates](/docs/projects/templates)
