---
title: Automate a board with recipes
description: Open a board's automations, add a ready-made recipe in a few clicks, turn automations on and off, and see every automation across your boards.
section: Automations
order: 10
---

Automations do routine board work for you. Each one is a sentence: when something happens, if conditions hold, then do one or more actions. For example: when **Stage** changes to **Won**, move the deal to **Closed won** and notify the owner. Automations belong to a board and run on its items.

## Before you start

- You need edit access to the board to create or change automations. Viewers see **You need edit access to create automations**.
- Some recipes need a column the board doesn’t have yet, such as a status or date column. The recipe card says so.

## Open a board’s automations

1. Open the board.
2. Select **Automate** in the board header. The badge shows how many automations the board has.

The automations page has four tabs.

| Tab | What it holds |
| --- | --- |
| **Recipes** | Ready-made automations to add in a few clicks |
| **Board automations** | The automations on this board |
| **Run history** | Every time an automation ran, and what it did |
| **Integrations** | Webhooks and other ways to reach outside tools |

## Add a recipe

1. Open the **Recipes** tab.
2. Search with **Search recipes, e.g. “notify” or “due date”**, or pick a category.
3. Select **Add to board** on a recipe.
4. In **Set up this automation**, select each underlined part of the sentence to choose what it should be, such as the status column or the group.
5. Check the **Name**. It is generated from the sentence, and you can type your own.
6. Select **Create automation**.

A toast confirms **Automation created**. It’s on and runs the next time it’s triggered. When the board has only one column that fits a part of the sentence, that part is filled in for you.

## Recipe categories

| Category | Recipes |
| --- | --- |
| **Status change** | Notify people when a status changes. Keep two status columns in sync. Stamp a date when work reaches Done. Assign a person at a stage |
| **Notifications** | Notify someone when they are assigned. Notify when an item is stuck. Notify when a column changes. Notify when an item is created |
| **Recurring** | On a date, notify and push the date out 7 days. On a date, reset the status and schedule the next cycle in 30 days |
| **Item creation** | Assign new items to whoever created them. Start new items in a status. Record the date each item came in. When work is done, create the next item on another board |
| **Due dates** | Notify the day before a date. On the due date, notify only for items still open. Post an update 7 days ahead |
| **Move item** | Move done items to a group. Archive done items. Change the status when an item moves to a group. Notify when items enter a group |
| **Dependencies** | When a step is done, set the next status. When work is done, create a follow-up on another board. Notify when a scheduled date changes |
| **CRM** | When a deal is won, move it and celebrate. Move lost deals out of the pipeline. Start new deals in the first stage, owned by their creator. Remind the owner 7 days before the expected close. Start onboarding on another board when a deal is won. Create a deal when a lead is qualified |

**Popular** shows the most used recipes across categories. A recipe that needs a label the board doesn’t have, such as **Done** on a Deals board that uses **Won**, is hidden on that board.

## Build from scratch

Select **Build from scratch** on the **Recipes** tab, or **Create automation** on **Board automations**. See [Build a custom automation](/docs/crm/build-an-automation).

## Manage a board’s automations

Open **Board automations**. Search with **Search automations**.

- Use the switch on each row to turn an automation on or off.
- Rows show when the automation last ran, or **Never ran**. A failure badge points you to the failed runs in **Run history**.
- Open **More actions for** an automation for **Edit**, **Duplicate**, **Test with an item…**, **Run history** and **Delete**.

A duplicated automation is turned off so it doesn’t run twice. Turn it on when it is ready.

## See automations across boards

Press `Ctrl K` (`Cmd K` on a Mac), type `Automations` and select it. The **Automations** page lists every automation in the organization that you can see, with:

| Area | What it shows |
| --- | --- |
| **Runs this month** | Automation runs used this month, against the monthly allowance |
| **Active automations**, **Boards**, **Failed runs** | Counts for the organization |
| Filters | **Search automations or boards**, a status filter (**All statuses**, **On**, **Off**, **Failing this month**) and a board filter |
| List | **On**, **Automation**, **Board**, runs, **Failures** and **Last run** for each one |

Turn an automation on or off from the list, or select its name to open it. When the monthly allowance is reached, the meter says **Monthly allowance reached.** See [Pricing](/pricing) for what each plan includes.

## How automations run

- An automation runs right after the change that triggers it, as part of the same save. If one of its actions fails, only that run is rolled back. Your own change is kept.
- An automation never triggers itself again, and chains of automations triggering each other stop after a few steps.
- Date automations run once a day for each item whose date matches.
- Changes made by automations show **Automation** as the author in activity logs.

## Related pages

- [Build a custom automation](/docs/crm/build-an-automation)
- [Test automations and read run history](/docs/crm/automation-runs)
- [Send board events to other tools with webhooks](/docs/crm/webhooks)
