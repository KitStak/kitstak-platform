---
title: Automation triggers, conditions and actions
description: Every trigger, condition and action the automation builder offers, with the choices each one takes and the words you can insert into messages.
section: Automations
order: 20
---

This page lists everything you can put in an automation: 19 triggers in four groups, 13 kinds of condition, and 14 actions in three groups. For how to build and manage a rule, see [build an automation](/docs/projects/automations).

## Triggers

A trigger is the **When** part of the sentence.

### Task changes

| Trigger | Choices |
| --- | --- |
| **a task is created** | |
| **the status changes** | To **any status**, one status of the project, or a category such as **Done** |
| **a task is marked done** | |
| **the assignee changes** | To **anyone**, **nobody (unassigned)**, or one person |
| **the priority changes** | To **any priority** or one priority |
| **the due date changes** | |
| **a label is added** | **any label** or one label |
| **someone comments** | |
| **a task moves to another section** | **any section** or one section |
| **all subtasks are done** | |

### Dates

| Trigger | Choices |
| --- | --- |
| **a due date is coming up** | **How soon**: **due today**, **due tomorrow**, or **due in 2, 3, 5, 7 or 14 days or less** |
| **a task becomes overdue** | |

Projects checks dates every few minutes. Each task sets off a date rule once per due date, and done tasks are skipped.

### Programs

| Trigger | Choices |
| --- | --- |
| **all builds of a run are done** | |
| **a run is below plan** | **How far behind** (a percent, 20% to start) and **When to check** (a time of day, 2:00 PM to start) |
| **output is logged on a build** | **Batch size**: **any amount**, or **at least** a number of units |
| **a build is done short of plan** | |
| **a build goes over plan** | |

Run triggers are checked every few minutes in each program's time zone, and each run sets one off once a day. Their actions run on the run's first build.

### Other KitStak apps

| Trigger | Needs | Choices |
| --- | --- | --- |
| **a linked CRM deal changes stage** | KitStak CRM | **Deal stage**: **any stage**, or a stage name. Names match whatever the case |
| **a linked WMS order ships** | KitStak WMS | |

These work on tasks linked to a CRM deal or WMS order. Projects checks every few minutes, and right away when someone opens the task.

## Conditions

Conditions are the **Only if** part. Every condition must be true for the rule to run. Most can be **is** or **is not**.

| Condition | What you can check |
| --- | --- |
| **the project** | Which project the task is in |
| **the program** | Which program the build is in (when you have programs) |
| **the variant** | Which variant a build makes (rules that work in one program) |
| **the work type** | **a task** or **a build** (when you have programs) |
| **the priority** | One priority |
| **the labels** | A label is on the task, or not |
| **the assignee** | **is nobody**, **is someone**, or is or is not one person |
| **the kind of status** | **To do**, **In progress**, **Done** or **Cancelled** |
| **the exact status** | One of the project's statuses (rules that work in one project) |
| **the section** | One of the project's sections (rules that work in one project) |
| **the due date** | **has passed (overdue)**, **is not set** or **is set** |
| **the name** | **contains** a word, like `invoice` |
| **subtasks** | **are skipped (top-level tasks only)**, or **only (it must be a subtask)** |

## Actions

Actions are the **Then** part. A rule runs its steps in order.

### Change the task

| Action | Choices |
| --- | --- |
| **move it to a status** | A status of the project (rules that work in one project) |
| **assign it** | A teammate, **the person who created it**, **the person who made the change**, or **nobody (unassign it)** |
| **set the priority** | One priority |
| **set the due date** | **today**, **tomorrow**, or **in 2, 3, 5, 7, 14 or 30 days**, counted from when the rule runs |
| **add a label** | One label |
| **remove a label** | One label |
| **move it to a section** | A section of the project (rules that work in one project) |
| **move it to another project** | A project you can edit, other than this one |
| **mark the parent task done** | |

### Tell people

| Action | Choices |
| --- | --- |
| **send a notification** | **Who hears about it**: **the assignee**, **the person who created it**, **the project owner**, **everyone following it**, **the person who made the change**, or a teammate. Plus an optional message |
| **post a comment** | The comment text |
| **add a follower** | The same people choices |

A notification with no message reads as the automation name and the task.

### Create work

| Action | Choices |
| --- | --- |
| **add a subtask** | The subtask name |
| **create a follow-up task** | The name, when it is due (**whenever (no date)** or a number of days), who gets it (**the same assignee**, **the person who created it**, a teammate or **nobody yet**), and the project (**the same project** or another) |

## Words you can insert

Messages, comments and follow-up names can hold words that fill themselves in. Select a word under **Insert:** to add it.

| Word | Becomes |
| --- | --- |
| `{task}` | The task's key and name, such as `OPS-42 Send the quote`. In a follow-up name, just the name. In program rules, the build |
| `{project}` | The project (the program, in program rules) |
| `{stage}` | The CRM stage, for **a linked CRM deal changes stage** |
| `{record}` | The linked record, for **a linked WMS order ships** |

For example, the follow-up name `Follow up on {task}` becomes `Follow up on Send the quote`, and the message `{task} is overdue` becomes `OPS-42 Send the quote is overdue`.

## Related

- [Build an automation](/docs/projects/automations)
- [Automation recipes](/docs/projects/automation-recipes)
- [Statuses and workflow](/docs/projects/statuses-and-workflow)
