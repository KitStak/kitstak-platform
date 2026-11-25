---
title: Workspace settings
description: Set currency, calendar, working days, shift length and job numbers, add sites, and manage labor defaults, notifications and sample data.
section: Settings and access
order: 10
---

**Settings** holds what Pulse needs to know about your company: money, calendar, sites, labor defaults, cost rules, people, catalogs and devices. It has four tabs: **Workspace**, **Month close**, **Connected apps** and **Audit log**.

## Before you start

- Only an admin or the owner can change settings. Others see **Only an admin can change these settings.**
- Supervisors do not see Settings.

## The Workspace sections

Go to **More > Settings**. The **Workspace** tab lists these sections:

| Section | What it holds |
| --- | --- |
| **General** | Currency, week, working days, job numbers. |
| **Sites** | Buildings and their time zones. |
| **Job types** | The kinds of work you do. See [Set up job types](/docs/pulse/job-types). |
| **Labor defaults** | Taxes, benefits, overhead, overtime. |
| **Cost rules** | Parts, shared time, margin and risk limits. See [Cost rules and risk limits](/docs/pulse/cost-rules-and-risk-limits). |
| **People and roles** | Who can do what, who sees money. See [Roles and who sees money](/docs/pulse/roles-and-access). |
| **Plan and payment** | Your plan, seats and next payment. See [Pricing](/pricing) for plans. |
| **Catalogs** | Clients and items. See [Set up and review clients](/docs/pulse/clients) and [Track materials and scrap](/docs/pulse/materials). |
| **Notifications** | What lands under your bell. |
| **Device links** | Floor tablets and wall TVs. See [Log work on a floor tablet](/docs/pulse/floor-tablet). |
| **Sample data** | A made up shop to try things. |
| **Danger zone** | Delete all Pulse data. |
| **How Pulse does the math** | The cost model in plain words. See [How Pulse does the math](/docs/pulse/how-pulse-does-the-math). |

Each form saves with one button and shows an undo toast.

## General

| Field | What it does |
| --- | --- |
| **Currency** | The money every amount in Pulse is in. |
| **Company time zone** | Used for a new site and for "today" when a site has no time zone of its own. |
| **Week starts on** | Weekly totals and the weekly spread of time not on a job follow this. |
| **Year starts in** | The first month of your business year, for "this year" totals. |
| **Working days** | Days your floor usually runs. Projected finish dates and "nothing logged" alerts skip the other days. |
| **Length of a shift** | Fills in "hours each" on the log and sets daily goals. 8 hours by default. |
| **Job numbers start with** | New jobs are numbered with this in front, like J-1042. |
| **Dates like 3/4/2026 in files** | **Month first: March 4** or **Day first: April 3**, for imports. |

Changing the week start or the working days recalculates open months.

## Sites

A site is each building or floor you run. A site has its own time zone, so "today" on the log is right for the people who work there. Every workspace starts with **Main site**.

1. Open **Sites** and select **Add a site**.
2. Type the **Name**, an optional **Short code**, and pick the **Time zone**.
3. Select **Add site**.

You can edit, archive or delete a site, and make another site the main site. A site with jobs or logged work cannot be deleted. Archive it instead to hide it from new work.

## Labor defaults

What Pulse fills in when you add a labor rate. Each labor class can have its own numbers on the Labor page.

| Field | What it does |
| --- | --- |
| **Payroll taxes and workers comp** | On top of the wage. Fills in a new labor rate. |
| **Benefits and paid time off** | On top of the wage. |
| **Other costs on the wage** | Anything else you pay per hour worked, as a percent of the wage. |
| **Overhead for each hour** | The part of running the floor you want every labor hour to carry. |
| **Overtime pays** | Usually 1.5. |
| **Real cost of an hour when no rate is set** | Used for hours whose labor class has no rate yet, so labor cost is never zero by accident. Leave it empty to flag those hours instead. |

The section shows what a $16.00 wage really costs with these numbers. Changing the fallback rate or the overtime multiplier recalculates open months.

## Notifications

These switches are yours alone. **One summary a day** leaves one note a day under the bell with what to look at first, when something needs you. Who gets told about each alert is set on the alert rules. See [Set alert rules](/docs/pulse/alert-rules).

## Sample data

**Load sample data** adds a made up shop: five jobs in different states with two weeks of logged work, three labor rates, materials, extra services, costs and invoices. Every sample name ends in "(sample)". **Remove sample data** deletes every sample job, client, rate and entry. Your own jobs and entries stay exactly as they are. Needs an admin.

## Danger zone

**Delete all Pulse data** removes every job, client and entry of the workspace for good. Only the owner of Pulse for the workspace can do it. Type the workspace's short name to confirm, then select **Delete everything**. Your settings, sites and people are kept.

## Related

- [Cost rules and risk limits](/docs/pulse/cost-rules-and-risk-limits)
- [Roles and who sees money](/docs/pulse/roles-and-access)
- [Read the audit log](/docs/pulse/audit-log)
