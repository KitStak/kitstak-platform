---
title: Labor analytics and operational dashboards
description: Turn on the analytics apps, then read task times, associate speed, receiving rates and the fulfillment, inbound, management and productivity dashboards.
section: Reports and analytics
order: 60
---

Analytics turns your task scans into charts. Labor analytics measures how long tasks take and how fast each associate works. Operational analytics shows receipts, inventory, order flow, client volumes and hourly throughput. Every chart can show its data as a table and export it.

## Before you start

- Activate the **Labor Analytics** app, the **Operational Analytics** app, or both, in **Settings > Company > Apps**. Until then a dashboard says the app is switched off for your company, with **Open Apps**. See [Apps and add-ons](/docs/wms/settings-apps).
- Your role needs **Labor Analytics** or **Operational Analytics** in the **Analytics** group.

## Filters on every dashboard

| Filter | What it does |
| --- | --- |
| **Last 7 days**, **Last 30 days**, **Last 90 days** | Quick date ranges. |
| From and to dates | A custom range. |
| **Warehouse** | One warehouse. Day boundaries and daily buckets use the warehouse time zone. |
| **Client** | One client. |
| Refresh | Loads the latest data. |

The filters are kept in the page address, so you can share a link to the same view.

## Each chart

- Switch between the chart and the table behind it.
- Open the export menu for **Export as CSV** or **Export as Excel (.xlsx)**.
- KPI tiles and many rows link to the records behind them.

## Labor analytics

Go to **Analytics > Labor Analytics**.

| Dashboard | What it shows |
| --- | --- |
| **Average Task Analysis** | Tiles: **Tasks completed**, **Average task time**, **Measured hours**, **Task types**. Charts: **Average task time by day** and **Average by task type**. |
| **Associate Task Analysis** | Tiles: **Associates**, **Tasks completed**, **Tasks per associate**, **Top associate**. Chart: **Tasks per associate by type**. |
| **Performance Quadrant Analysis** | Tiles: **Median volume**, **Median speed**, **Top performers**, **Needs coaching**, **Best speed**. Chart: **Speed vs volume**. |
| **Associate Analysis** | Tiles: **Associates**, **Units handled**, **Team speed**. Table: **Associate scorecards** with rank, tasks, units, tasks per hour, average task minutes, hours and active days. |
| **Receiving Performance Analysis** | Tiles: **Units received**, **Receipt lines**, **Units per dock hour**, **Receivers**. Charts: **Units and lines per hour by associate** and **Units received per day**. |

### The performance quadrant

Each associate is placed by volume (tasks completed) and speed (tasks per hour) against the team medians.

| Quadrant | Volume | Speed |
| --- | --- | --- |
| **Top performers** | At or above median | At or above median |
| **Fast, low volume** | Below median | At or above median |
| **High volume, slower** | At or above median | Below median |
| **Needs coaching** | Below median | Below median |

**Best speed** needs an associate with at least 20 tasks.

### How task time is measured

A bar on each labor page shows the timing basis of the tasks behind it:

| Basis | Meaning |
| --- | --- |
| **Timed (start → finish scan)** | The task has a start and a finish scan. |
| **Inferred from the gap since the previous task** | Only a finish time; the duration is the gap since the associate's previous task. |
| **No duration evidence (left out of speeds)** | Not used in speed figures. |

In the **Labor Analytics** app settings you can set **Target units per hour** and **Exclude idle gaps longer than** a number of minutes.

> **Note:** Users whose roles don't include **View** on the **Users** page see **Showing your own work only**: their own figures next to the team medians. Supervisors and admins see every associate's speed and rank.

## Operational dashboards

Go to **Analytics > Operational Analytics**.

| Dashboard | What it shows |
| --- | --- |
| **Inbound & Inventory Dashboard** | Tiles: **Units received**, **Avg dock-to-stock**, **Inventory value**, **Units on hand**. Charts: **Receipts trend** (purchase orders and returns), **Inventory aging** and **Top SKUs by inventory value**. |
| **Fulfillment Dashboard** | Tiles: **Orders created**, **Orders shipped**, **On-time shipping**, **Open backlog**. Charts: **Orders created vs shipped**, **Backlog by status** and **Open shortages by SKU**. |
| **Management Dashboard** | Tiles: **Active clients**, **Orders shipped**, **Units shipped**, **Units received**. Charts: **Order share by client** and **Units by client**. With billing access, **Merchandise shipped**, **Billed** and **Shipped value by client**. |
| **Productivity Dashboard** | Tiles: **Units per hour**, **Units handled**, **Measured hours**, **Busiest hour**. Charts: **Units per hour by area and shift** and **Tasks completed by hour**. |

The **Management Dashboard** shows revenue and billing figures only to users with **View** on **3PL Billing** or **Billing Report**. Others see **Revenue and billing figures are hidden** and volumes instead.

In the **Operational Analytics** app settings, **Dashboard refresh** sets how often the dashboards reload: every 5, 15, 30 or 60 minutes.

## Related

- [Order, receiving and performance reports](/docs/wms/analytics-orders-receiving-performance)
- [Apps and add-ons](/docs/wms/settings-apps)
- [Report Hub and the list of reports](/docs/wms/analytics-hub-and-catalog)
