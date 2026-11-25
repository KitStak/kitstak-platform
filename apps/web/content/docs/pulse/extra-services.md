---
title: Set up and track extra services
description: List the extra services you bill on top of a job, like labeling or gift wrap, log each one done, and see which earn their keep and which are underpriced.
section: Revenue and services
order: 20
---

Extra services are the things you bill on top of a job: labeling, rework, special packing, storage, gift wrap. Some shops call them value added services. Each service has its own price, its own cost and its own margin, so you can see which ones earn their keep.

## Before you start

- Adding services and service entries needs a manager, admin or owner.
- Open the services list from **Profit > Extra services**, or from **Settings > Catalogs > Extra services**.

## Add a service

1. Open the extra services list and select **Add a service**.
2. Fill in the fields below. A preview shows what one unit should cost and the margin at your price.
3. Select **Add service**.

| Field | What to type |
| --- | --- |
| **Name** | Like Labeling. |
| **Code** | Leave blank and Pulse makes one. |
| **One unit is called** | The plural word: labels, pallets, hours. |
| **How it is billed** | **Per unit**, **Per hour** or **Flat fee**. |
| Price for one unit | Your list price. |
| Parts cost for one unit | Labels, bags, wrap. Not labor. |
| **Target pace** | Units per person per hour. |
| **Active** | Turn it off to keep its history and hide it from new entries. |

The **standard cost** of one unit is its parts plus labor at the target pace. The **margin at list price** is the margin one unit makes at the list price and the standard cost.

## Log a service done

1. Open the job and go to **Money in**, or start from the job's **Overview** with **Add an extra service**.
2. Under **Extra services**, select **Add entries**.
3. Type the **Date**, the **Service**, **How many**, any **Labor hours** and, if it differs from the usual price, the **Price of one**.
4. Save.

A service can also be logged for a client with no job. The entry earns its quantity times its price. Its labor hours are costed at the real cost of an hour, and its parts cost counts too.

## Read the services list

| Tile | What it shows |
| --- | --- |
| **Revenue from extra services** | What every entry in the period earned. Core job work is counted apart. |
| **Profit from extra services** | Revenue from extra services, less their labor, their parts and their share of time not on a job. |
| **Services in use** | Active services with at least one entry in the period. |
| **Target margin** | With the number of services under it. |

The table shows each service's price, standard cost, margin at list price, volume, revenue, cost, margin, a profit trend and a check. Use **Which services to show** to pick **Active**, **Underpriced**, **Entries with no price** or **Turned off**. **Export CSV** saves the table.

## Underpriced services

An active service is underpriced when its margin at the list price, or its real margin in the period, is under your target margin. The check column names the problem:

- **Costs more than it earns**
- **Under your target margin**
- **No price set**
- **Priced under its standard cost**
- **Priced under your target margin**

Pulse also shows the price that would reach your target margin.

## Fix entries with no price

An entry with no price earns nothing on paper. Pick **Entries with no price**, open an entry and select **Set the price**. Type the price of one and save. This sets the price of that entry only. For entries from the warehouse, add a rate for the service to the client's contract in the warehouse, and the next sync prices them.

## A service page

Select a service name to open its page: volume, what one unit earned and cost, the trend against your target margin, **Price and standard cost**, **Clients using it** and every entry in the period.

## Worked example (made-up figures)

Labeling sells at $0.35 a label. Parts cost $0.04 a label, and the target pace is 300 labels per person per hour at a real cost of $21.00 an hour.

- Labor for one label: $21.00 / 300 = $0.07.
- Standard cost: $0.04 + $0.07 = $0.11.
- Margin at list price: ($0.35 less $0.11) / $0.35 = 68.6%.

## Related

- [Set prices and track revenue](/docs/pulse/prices-and-revenue)
- [Explore profit](/docs/pulse/profit-explorer)
- [Import a CSV file](/docs/pulse/import-csv)
