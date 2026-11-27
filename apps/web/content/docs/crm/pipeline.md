---
title: Read the pipeline and forecast
description: Use the pipeline page for open and weighted pipeline, win rate, the stage funnel, a six-month forecast, quota attainment, at-risk deals and stage velocity.
section: Accounts and pipelines
order: 20
---

The pipeline page is the sales cockpit of your Deals board. It adds up open, weighted and won value for a period, shows how deals move through the stages, forecasts the next six months and flags the deals that need attention.

## Before you start

- You need a Deals board. Without one, the page shows **No deals board yet** with **Browse CRM templates**.
- Fill in **Stage**, **Deal value**, **Expected close** and **Owner** on your deals. See [The CRM boards: leads, deals, accounts, contacts and activities](/docs/crm/crm-boards).

## Open the pipeline

Open **CRM > Pipeline** in the top bar, or press `G` then `P`.

The header shows the board name, how many deals it has and that the forecast is weighted by stage probability. Select **Open board** to go to the Deals board. If you have more than one deals board, pick it in the **Deals board** menu.

## Filter the pipeline

| Filter | Options |
| --- | --- |
| Close date period | **Month**, **Quarter**, **Next qtr**, **Year** or **All time**. The default is **Quarter** |
| **Owner** | **All owners** or one owner |

The page shows the dates covered, for example **Closing Oct 1 to Dec 31**. Filters are kept in the page link, so you can share a filtered view. If the owner in a link has no deals on the board, you see **Owner not found** and all owners are shown.

## Metric tiles

| Tile | What it shows |
| --- | --- |
| **Open pipeline** | The value of open deals closing in the period, and how many there are |
| **Weighted forecast** | Value × stage probability for those deals |
| **Won** | Value of deals won in the period |
| **Win rate** | Won deals as a share of won and lost deals |
| **Avg won deal** | Average value of deals closed won in the period |
| **At risk** | Open deals that are stale or overdue |

Hover a value to see the exact amount.

## Stage funnel

**Stage funnel** lists the open stages in order, with the number of deals, their value and the stage probability. Between stages it shows the share of deals that moved on. Won and lost stages are listed after the funnel.

## Forecast by close month

**Forecast by close month** covers the next six months, whatever period you picked. Each month shows:

| Bar | Meaning |
| --- | --- |
| **Won** | Value already won |
| **Weighted** | Open value × stage probability |
| **Best case** | Every open deal at full value |

Commit is won plus weighted open pipeline closing in those months. Select **What is commit?** for the definition. Use the arrow keys to move between months. Open deals without a close date are left out.

## Quota attainment

**Quota attainment** compares what each owner won in the period with their quota. Quotas are set per quarter and scale with the period, so a year counts four quarterly quotas. Select **Edit quotas** to set them.

## Deals at risk

The at-risk card lists open deals with no activity for the number of days in the at-risk rule (two weeks unless you change it), or that are past their close date. Each deal shows its stage and how many days it has gone without activity. Select **View all** to see the full list and a deal to open it. When there are none, it says **Nothing at risk**.

Activity means a logged call, email or meeting, or an update on the deal.

## Stage velocity

**Stage velocity** shows, per open stage, the average days deals spend in it (**avg days in stage**), how many are **Here now** and how many **Moves measured**. The slowest stage is marked **Bottleneck**.

## Change pipeline settings

You need edit access to the Deals board.

1. Select **Settings**, or **Set probabilities**, **Edit quotas** or **Rule** on a card.
2. In **Pipeline settings**, open a tab:

| Tab | What you set | Rules |
| --- | --- | --- |
| **Stage probability** | The probability of each open stage | Whole numbers from 0 to 100. Won is always 100% and lost 0% |
| **Quotas** | A quarterly quota for each owner | A number of 0 or more. Leave empty for **No quota** |
| **At-risk rule** | **Flag open deals with no activity for** a number of days | 1 to 365 days |

3. Select **Save**. A toast confirms **Pipeline settings saved**.

Until you set probabilities, each open stage uses the average **Close probability** of its deals, or a default that rises from the first stage to the last.

## Related pages

- [The CRM boards: leads, deals, accounts, contacts and activities](/docs/crm/crm-boards)
- [Kanban view](/docs/crm/kanban-view)
- [Add and configure dashboard widgets](/docs/crm/dashboard-widgets)
