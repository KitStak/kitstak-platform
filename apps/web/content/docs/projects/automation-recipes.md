---
title: Automation recipes
description: The 18 ready-made automation recipes in KitStak Projects, what each one does, and how to start from a recipe and change the parts you need.
section: Automations
order: 30
---

A recipe is a ready-made automation. Start from one and change the parts you need. There are 18 recipes, grouped as **Popular**, **Reminders**, **Hand-offs**, **Tidy up**, **Programs** and **CRM and WMS**.

## Before you start

- You need the Editor or Owner role on a project.

## Use a recipe

1. Go to **Automations** and select the **Recipes** tab.
2. Pick a category under **Recipe category**, or **All**.
3. Select **Use recipe** on the one you want.
4. The builder opens as **Set up** and the recipe name, with every part filled in. Pick where it **Works in**, and change any underlined words.
5. Select **Create automation**.

If none fits, select **Build my own**. Recipes that need another app show **Uses KitStak CRM** or **Uses KitStak WMS**, with **(not connected)** when your workspace doesn't have it yet.

## Popular, reminders, hand-offs and tidy up

| Recipe | Categories | What it does |
| --- | --- | --- |
| **Tell the owner when work is done** | Popular, Hand-offs | When a task is marked done, notify the project owner |
| **Remind people the day before** | Popular, Reminders | When a task is due tomorrow, notify the assignee: “{task} is due tomorrow” |
| **Raise the alarm on late work** | Popular, Reminders | When a task becomes overdue, set the priority to High and notify the project owner |
| **Finish the parent when all subtasks are done** | Popular, Tidy up | When all subtasks are done, mark the parent task done |
| **Give new unassigned tasks to their creator** | Tidy up | When a task is created with nobody assigned, assign it to the person who created it |
| **Follow tasks you comment on** | Tidy up | When someone comments, add them as a follower |
| **Urgent work gets a 2-day deadline** | Reminders | When the priority changes to Urgent, set the due date to in 2 days |
| **Tell the requester when work starts** | Hand-offs | When a task moves to an In progress status, notify the person who created it |
| **Plan a check-in a week after work is done** | Hand-offs | When a top-level task is marked done, create a follow-up due in 7 days for the same assignee |
| **Add a review step to urgent tasks** | Hand-offs | When an urgent task is created, add the subtask “Review with the team” |
| **Nudge work that hasn’t started** | Reminders | When a task is due today but still in a To do status, post a friendly comment |

## Programs

| Recipe | What it does |
| --- | --- |
| **Tell the owner when a run is done** | When every build of the day is done, notify the program owner |
| **Flag a slow run in the afternoon** | At 2:00 PM, a run 20% or more behind plan notifies the owner |
| **Check finished builds** | When a build is marked done, create a quality check follow-up due the next day |

## CRM and WMS

| Recipe | Needs | What it does |
| --- | --- | --- |
| **Tell the team when a linked deal moves** | CRM | When the CRM deal on a task changes stage, notify the assignee and post a comment with the new stage |
| **Start delivery when a deal is won** | CRM | When the linked deal moves to Won, create a kickoff follow-up for the assignee and set the priority to High |
| **Tell the owner when the order ships** | WMS | When the WMS order on a task ships, notify the project owner |
| **Check delivery a few days after shipping** | WMS | When the linked WMS order ships, create a follow-up due in 3 days to confirm the customer got their order |

The CRM and WMS recipes work on tasks that are linked to a deal or an order. See [link CRM and WMS records](/docs/projects/link-crm-and-wms-records).

## Recipes for records in other apps

When your workspace runs KitStak CRM or WMS, the **From CRM and WMS** tab holds three more recipes that start new work from records in those apps: a won deal starts a project or program, a receipt discrepancy opens an urgent task, and a count variance opens a task. See [start work from CRM and WMS records](/docs/projects/cross-app-rules).

## Related

- [Build an automation](/docs/projects/automations)
- [Automation triggers, conditions and actions](/docs/projects/automation-reference)
