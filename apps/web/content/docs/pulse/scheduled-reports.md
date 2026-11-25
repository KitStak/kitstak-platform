---
title: Build a report on a schedule
description: Have Pulse build a report every day, week or month and tell the people you pick inside Pulse, with a CSV and a page to print. Pulse sends no email.
section: Reports
order: 20
---

Pulse can build a report for you every day, week or month. When a build is ready, the people you pick get a note in Pulse with a link to the files: a CSV, and a page to print or paste. Pulse does not send email.

For example: Job profit every Monday for last week, Ready to bill on the first of each month, or the daily production log each morning for the day before.

## Before you start

- You need a role that can open the report.
- A build that holds money can only be opened by people who see money.

## Schedule a report

1. Open the report from **Reports** and select **Build on a schedule**. Or go to **Reports > Scheduled** and select **Schedule a report**.
2. Fill in the fields below.
3. Select **Save schedule**.

| Field | What to pick |
| --- | --- |
| **Name** | A name for the schedule, like "Job profit, every week". |
| **Report** | Which report to build. |
| **How often** | **Every day**, **Every week** or **Every month**. |
| **On** or **On day** | The day of the week, or the day of the month. |
| **At** | The hour of the day, in the time zone of your site. |
| **Each build covers** | **Yesterday**, **Last week**, **This month so far**, **Last month** or **Last 90 days**. A schedule made from a report keeps that report's site, client and job type filters. |
| **Who is told** | **Pick people**. They get a note in Pulse with a link to the files. |
| **Include money** | On: the build holds money and only people who may see money can open it. Off: money columns are left blank, so anyone on the list can open it. A report that is about money always holds money. |

## Manage schedules

**Reports > Scheduled** lists each schedule with when it runs, what it covers, who is told, the next build and the last build. From a schedule's menu you can:

- **Build now**: build it at once. The files show under **Past builds**.
- Edit it with **Save changes**.
- Turn it off or on.
- Delete it, with an undo.

## Past builds

**Past builds** lists every build of the last 90 days with when it was built, the report, the period, the row count and the files. A build marked **Holds money. Ask an admin if you need it.** needs a role that sees money. A failed build says **This build failed.**

## Related

- [Run a report](/docs/pulse/reports)
- [Work the alerts inbox](/docs/pulse/alerts-inbox)
- [Roles and who sees money](/docs/pulse/roles-and-access)
