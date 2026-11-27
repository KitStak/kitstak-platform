---
title: Build an automation
description: Write a rule as a plain sentence: when something happens, and these conditions hold, do these steps. Turn rules on and off and check what they did.
section: Automations
order: 10
---

An automation is a rule that does routine work for you. You write it as a sentence: **When** something happens, **Only if** some conditions hold, **Then** do one or more steps. For example: when a task becomes overdue, set the priority to Urgent and tell the project owner.

## Before you start

- To add or change rules for a project, you need the Editor or Owner role on that project. People without edit access see **You need edit access to a project to add automations.**
- Rules for **Every project** need the Admin or Owner role in the workspace.
- You need at least one project. Otherwise the page says **Automations need a project to work in**.

## Create an automation

1. Go to **Automations** and select **New automation**. You can also start from a recipe: see [automation recipes](/docs/projects/automation-recipes).
2. Optional: give it a **Name**. Leave it empty and Projects names it for you.
3. Pick where it **Works in**: one project, one program, or **Every project**. Rules for one project can use that project's statuses and sections.
4. Under **When this happens**, pick the trigger and fill in its details. Click any underlined words to change them.
5. Optional: under **Only if**, select **Add a rule** to add a condition. Every rule must be true. Leave it empty to run every time.
6. Under **Then do this**, pick the first step. Select **Add another step** for more.
7. Read the preview sentence at the bottom. It says where the rule runs and what it will do.
8. Leave the switch **On** to start it now, or set it **Off** to keep it paused.
9. Select **Create automation**.

See [automation triggers, conditions and actions](/docs/projects/automation-reference) for every choice.

## Limits and rules the builder checks

| Rule | Message |
| --- | --- |
| At least one step | **Add at least one thing for the automation to do.** |
| Every part filled in | **Finish the highlighted parts first.** |
| Up to 10 conditions | **Add a rule** turns off at 10 |
| Up to 10 steps | **Add another step** turns off at 10 |
| Status and section steps need one project | **Pick a project at the top first** |
| Variant conditions need one program | **Pick a program at the top first** |
| A move needs a different project | **Pick a different project than this one.** |

Rules that use CRM or WMS show a note when that app isn't connected to your workspace yet; they won't run until it is.

## How automations run

- A rule runs right after the change that sets it off.
- Date triggers (**a due date is coming up**, **a task becomes overdue**) and CRM and WMS triggers are checked every few minutes, even when nobody is signed in. Each task sets off a date rule once per due date, and done tasks are skipped.
- Changes made by automations never set off the same automation again in a loop. A chain of rules setting off other rules stops after three steps.
- Changes an automation makes show **Automation** as the person in history and activity.
- A step that fails is recorded as a failed run. It never undoes or blocks the change that set the rule off.

## Manage your automations

The **Your automations** tab lists every rule. Each one shows **Starts when**, **Last ran**, **Runs so far** and **Runs in the last 7 days**.

1. Filter with **Search automations**, the **Project** menu (**All rules**, **Rules for everywhere**, or one project) and **On** or **Off**.
2. Use the switch on a rule to **Turn on** or **Turn off**.
3. Open a rule's menu for **Edit**, **Run history**, **Duplicate** and **Delete**.

A duplicate starts turned off so you can adjust it first. Rules with date or CRM and WMS triggers add a **Check now** button to run those checks straight away.

## Check the run history

1. Select the **Run history** tab.
2. Filter by **Everything**, **Worked** or **Stopped**.

Each run shows what set it off, such as **Task created**, **Status changed** or **Due soon**, the task, and what the rule did. **No changes were needed.** means the rule ran but nothing had to change. The list is newest first and refreshes on its own.

## Related

- [Automation triggers, conditions and actions](/docs/projects/automation-reference)
- [Automation recipes](/docs/projects/automation-recipes)
- [Start work from CRM and WMS records](/docs/projects/cross-app-rules)
