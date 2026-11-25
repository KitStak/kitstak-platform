---
title: Test automations and read run history
description: Preview what an automation would do to an item, run it on demand, and use run history to see each run's trigger, changes and errors and retry failures.
section: Automations
order: 30
---

Before you rely on an automation, test it on a real item. Afterwards, run history shows every time it ran, what triggered it and what it changed, so you can find and fix problems.

## Test an automation

1. Open the board and select **Automate**.
2. On **Board automations**, open **More actions for** the automation and select **Test with an item…**.
3. In **Test with an item**, choose an item. Search with **Search by name**.
4. Read the preview. **Conditions** shows whether each condition holds. **It would** lists the actions it would take. If a condition fails, the list reads **It would have**.
5. Select **Close**, or select **Run on this item** (for example **Run on this deal**) to run it for real.

Previewing changes nothing. **Run on this item** is available only when every condition holds. A toast confirms **Automation ran**.

## Open run history

1. Open the board’s automations and select the **Run history** tab. Or select **Run history** in an automation’s menu to see only its runs.
2. Filter by time: **Any time**, **Last 24 hours**, **Last 7 days** or **Last 30 days**.
3. Filter by status: **All statuses**, **Success**, **Failed**, **Skipped** or **Pending**.
4. Filter by automation with **All automations** or one automation.

Each row shows the **Time**, the **Automation** and its **Status**. If nothing ran yet, the tab says **No runs yet**.

## Run statuses

| Status | Meaning |
| --- | --- |
| **Success** | Every action completed |
| **Failed** | An action failed. No action completed, and every change of the run was rolled back |
| **Skipped** | The run had nothing to do, for example a move that doesn’t apply to subitems |
| **Pending** | The run is waiting |
| **Running** | The run is in progress |

## Read a run

Select a row to open its details.

| Part | What it shows |
| --- | --- |
| **What triggered it** | The trigger event, such as a status change, with **Before** and **After** values |
| **What it did** | Each action and its result, such as **Changed a status**, **Sent a notification** or **Moved to a group** |
| **Raw payload** | The stored data of the run |

Actions read as plain sentences. A label or column that no longer exists shows **Deleted label** or **a deleted column**. If the automation was deleted, the run says **This automation has since been deleted.**

From the run details you can open **Runs for this automation** or **Edit automation**.

## Retry a failed run

1. Open a failed run.
2. Fix the cause first, for example re-create a deleted group or pick a new column in the automation.
3. Select **Retry run**.

A toast confirms **Run retried successfully**, or says **Retry did not succeed** with the error.

## Related pages

- [Automate a board with recipes](/docs/crm/automations)
- [Build a custom automation](/docs/crm/build-an-automation)
