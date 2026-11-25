---
title: Set alert rules
description: Turn the twelve rules that come with Pulse on or off, and add your own plain sentence rules with a line, scope, who gets told and quiet hours.
section: Alerts
order: 20
---

A rule is one plain sentence, like "Tell me when a job's margin is heading under 15%." When it comes true, an alert lands in the inbox and the people you picked get a message. Twelve rules come with Pulse, and you can add your own.

## Before you start

- Changing rules needs a manager, admin or owner. Everyone else can read them.
- Go to **Alerts** and open the **Alert rules** tab.

## Rules that come with Pulse

These twelve are on from the start. You can change who gets told and turn one off. They cannot be deleted.

| Rule | Tells by default |
| --- | --- |
| Tell me when a job is losing money | Owners, admins, managers |
| Tell me when a job is at risk | Owners, admins, managers |
| Tell me when an active job has nothing logged for a few work days | Managers, supervisors |
| Tell me when a job is due soon and behind | Managers, supervisors |
| Tell me when hours have no labor rate | Owners, admins |
| Tell me when a job has no price | Owners, admins, managers |
| Tell me when days have units and no hours | Managers, supervisors |
| Tell me when finished work stays not billed | Owners, admins, managers |
| Tell me when paid time is not on any job (more than $2,000 this month) | Owners, admins |
| Tell me when my overhead rate is off (by more than $1,000 over 3 months) | Owners, admins |
| Tell me when the warehouse is short on parts for a job | Managers, supervisors |
| Tell me when a month is ready to close | Owners, admins |

The days for "nothing logged" come from **Settings > Cost rules > Nothing logged for**. The not billed amount and days come from **Tell me when work not billed yet passes** and **And it has waited** in the same place.

## Add your own rule

1. On **Alert rules**, select **New rule**.
2. Under **1. Tell me when**, pick **What to watch**. If the rule has a line, type it, like 15 for a margin line.
3. For job rules, pick **Which jobs**: **All jobs**, **Jobs of one client**, **Jobs of one type** or **Jobs at one site**.
4. Under **2. Who gets told**, tick the **Roles that get told** and **Add people**. Pick **How loud the alert is**: **Urgent**, **Heads up** or **Good to know**.
5. Under **3. Quiet hours**, turn on **Stay quiet at set times** if you want, with **Quiet from** and **Until**, and **Also quiet all day on Saturday and Sunday**. Nothing is lost: what happens in quiet hours shows at the next check after they end.
6. Read the preview: **Alerts per day, last 30 days** and **What it would have said**.
7. Select **Add the rule**.

Under **Your rules**, each rule has a switch to turn it on or off, an edit button and a delete button.

## Every rule and what it means

| Rule | Group | What it watches |
| --- | --- | --- |
| **Margin under a number** | Jobs | Where the margin of each open job will land when it finishes. |
| **Job losing money** | Jobs | The job costs more than it earns, now or at the finish. |
| **Job at risk** | Jobs | The job is well under its target margin, or far over its plan. |
| **Labor over plan** | Jobs | Labor cost so far is more than the plan allows for the units done. |
| **Materials over plan** | Jobs | Material cost so far is more than the plan allows for the units done. |
| **Pace under target** | Jobs | Units per person per hour are under the target pace of the job. |
| **Nothing logged** | Jobs | An active job with no work log entries for several work days in a row. |
| **Due soon and behind** | Jobs | At the pace so far the job will finish after its due date. |
| **Hours with no labor rate** | Jobs | Hours with no rate have no cost, so the job looks better than it is. |
| **Job with no price** | Jobs | A job with no price earns nothing on paper. |
| **Units with no hours** | Jobs | A day with units and no hours has no labor cost. |
| **Finished work not billed** | Jobs | Work that is done and not on an invoice yet. Leave the line empty to use the workspace limit. |
| **Client margin under a number** | Clients and services | Every client over the last 30 days. |
| **Extra service margin under a number** | Clients and services | Every extra service over the last 30 days. |
| **Paid time not on a job** | Company | Paid hours that were not logged on a job or a reason, this month. |
| **Overhead rate is off** | Company | The overhead your labor rates covered against your real company costs, over 3 months. |
| **Month ready to close** | Company | Last month has nothing left to fix. |
| **Warehouse short on parts** | Connected apps | Needs KitStak WMS. |
| **Won deal with no job** | Connected apps | Needs KitStak CRM. |
| **Import did not finish** | Connected apps | A CSV import stopped with an error. |
| **Connected app did not sync** | Connected apps | Pulse could not read a connected app. |

Job rules can be narrowed to one client, job type or site. The others look at the whole workspace.

## Lines and money

A line in dollars or a margin percent is money. People who do not see money read the rule without it, for example "Tell me when more than a set amount of paid time this month is not on any job."

## Related

- [Work the alerts inbox](/docs/pulse/alerts-inbox)
- [Cost rules and risk limits](/docs/pulse/cost-rules-and-risk-limits)
- [How Pulse judges a job](/docs/pulse/job-status)
