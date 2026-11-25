---
title: Variants, price cards and month close
description: Manage a program's variants, dated price card versions, schedules, settings and statements, and close each month so its numbers are locked.
section: Programs
order: 40
---

This page covers the program tabs that shape the work and the money: **Variants**, **Price card**, **Schedule** and **Settings**, plus the monthly statement and month close. For what each word means, see the [programs overview](/docs/projects/programs-overview).

## Before you start

- Editors and owners can change variants and schedules, and propose price changes. Only owners publish prices and close or reopen months.
- Money shows only to people allowed to see it. See **Settings > Money** below.

## Variants

The **Variants** tab lists the kits this program makes, with **Name**, **Key**, **SKU**, **Default qty**, **Rate**, **Kit**, **Std min** (standard minutes per unit) and **Status**.

1. To add variants, open **Add variants** and pick **Make a matrix**, **Paste a list** (from a sheet or an email) or **Add one**.
2. To change the attributes behind a matrix, select **Edit attributes**.
3. Open a variant's menu for **Edit**, **Change rate**, **Link kit** or **Change kit**, **Unlink kit**, **Plan builds for this variant**, **View builds**, **Retire**, **Restore** and **Delete**.

A retired variant can't be used by new builds. Past builds keep it. Rate changes you make here gather into one draft price version. Select **Ask for review** to send them to the owners, **Review and publish** if you are an owner, or **Discard changes**.

## Price card

A price card has dated versions, such as v1 and v2. Each version is **Draft**, **Scheduled** (published, starts later), **In force** or **Ended**. A published version never changes. To change prices, make a new version. Days before its start date keep the old prices.

### Lines on a version

| Line | How it charges |
| --- | --- |
| Per unit (named for the program's unit, such as **Per kit**) | For each unit built, at the variant rate or the card rate |
| **Per batch** | Once each time a build is marked done |
| **Per hour** | For billable time logged on the program. **Count all time** counts all of it |
| **Monthly fee** | A fixed fee each month. **Charge part of it in a partial month** and **Charge while paused** are on to start |
| **Monthly minimum** | If work charges are lower, a minimum top up brings the month up to it after the month ends |

Setup fees are charged once on their date. New price versions never charge them again. **Rates by attribute** set or add to the rate of every variant with one value.

### Make a new version

1. On the **Price card** tab, select **New version**.
2. Pick **New version from the current rates** or **Start an empty version**, and the day it starts.
3. Select **Start draft**.
4. Change the lines and rates. The impact panel shows the **Change so far** this month and the **This month forecast**.
5. Select **Save draft** to keep it.
6. An owner selects **Publish** with the version number, such as **Publish v2**. An editor selects **Ask for review** instead; owners then publish it or select **Send back** with a note.

To throw a draft away, select **Discard draft**. To reuse an older version, select **Copy into a new version**.

## Schedule

A schedule makes builds ahead of time on the days you pick. Each day it makes is one run.

1. On the **Schedule** tab, select **New schedule**.
2. Fill in the schedule as in [create a program](/docs/projects/create-a-program): **Name**, **Repeats**, **First day**, **Last day**, **Make builds ahead**, **Skip days off** and **What to build each time**.
3. Select **Create schedule**.

Each schedule shows its **Next runs**. Its menu has:

| Item | What it does |
| --- | --- |
| **Edit** | Changes it. Turn on **Also update builds already made after today that have no output** to update those too |
| **Pause** and **Resume** | Pause makes no new builds until you resume |
| **Skip a date** | No builds are made that day. Builds already made for it with no output are cancelled |
| **Run now** | Makes its builds for the lead window now |
| **End** | Stops after a date you pick. Builds already made stay |
| **Delete** | The schedule goes away. Builds it made stay, with their output and money. This can't be undone |

## Settings

| Section | What it holds |
| --- | --- |
| **General** | Name, look, owner, who can open it (**Everyone in the workspace** or **Only people added**), status, dates, and health: **Auto** or set by hand |
| **Units and calendar** | What a build counts, the program's time zone, work days and how builds behave |
| **Money** | Targets, who sees money (**Owners only**, **Editors and owners** or **Everyone in the program**) and how hours count (**Billable time** or **All time**) |
| **Month close** | Closed months and the close checklist |
| **People** | Members and roles |
| **Pulse check** | Whether the program and its Pulse job match, for owners, when a job is linked |
| **Danger zone** | **Archive** hides the program and keeps everything. **Delete** removes it, only when no month is closed, and you type the key to confirm |

The key can't change while a Pulse job is linked.

## Statements and adjustments

Open the program menu and pick **Statement** to view this month's or last month's statement, or download it as CSV or PDF. A statement lists **Work charges** and **Fees and adjustments**, with **Line**, **Date**, **Qty**, **Rate** and **Amount**, and a **Total**. Prices are the ones in force on each day.

To add a credit or charge, use **Add an adjustment**: pick **Charge** or **Credit**, the **Amount**, the **Date**, an optional **Variant**, and a **Reason** that shows on the statement. Turn on **Counts toward minimum** when it is for work.

## Close a month

Closing a month locks its output, prices and fees and saves its total.

1. Open the program menu and select **Close** with last month's name, such as **Close October**. Owners see it until that month is closed.
2. Work through the checklist. Rows with a warning need a fix first. Some fix themselves, like monthly charges a few minutes after the month ends.
3. For builds that closed short, confirm **Why did they close short?**
4. Tick **I checked these adjustments**.
5. Select **Close** and the month.

A closed day can't change. To reopen a month, an owner selects **Reopen** and says why. The reason is saved in **Activity**.

## Related

- [Programs overview](/docs/projects/programs-overview)
- [Create a program](/docs/projects/create-a-program)
- [Plan builds and log output](/docs/projects/builds-and-output)
