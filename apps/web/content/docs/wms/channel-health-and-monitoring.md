---
title: Channel health and monitoring
description: Watch every store's success rate and volume, open one setup's details, and work missing orders, recent errors, workflow blocked orders and listing exceptions.
section: Integrations
order: 70
---

Channel monitoring tells you whether each store connection is healthy and gives you the list of things to fix: orders that didn't import, errors that keep coming back, orders a workflow is holding and listings that don't match a product. Check it daily, and first whenever a client says an order is missing.

## Before you start

- You need the **Integration Monitoring** page in your role.
- **Retry download** needs **Create Setup** or **Edit Setup** on **Integrations**. **Release** needs **Edit** on **Shipment Orders** or **Workflows**.

## Channel Health Overview

Go to **Integrations > Channel Monitoring > Channel Health Overview**.

At the top, one card per channel shows its number of setups and how many are low performing. Pick a card to filter the grid, or filter it by client. A setup is low performing when its success rate in the last 24 hours is below 80%.

| Column | What it shows |
| --- | --- |
| **Channel** | The sales channel. |
| **Setup name** | The store connection. Select it to open its setup details. |
| **Client** | The client the store belongs to. |
| **Download status** | Whether **Download Orders** is **Active** or **Passive**. **Paused** means it is on but can't run; hover for the reason. |
| **Success rate** | Orders imported successfully against orders that hit an error, in the last 24 hours. Setups with no calls show **No data** and don't count as low performing. |
| **Orders (24h)** | Orders downloaded in the last 24 hours. |
| **Lines (24h)** | Order lines downloaded in the last 24 hours. |
| **Last successful call** | When **Download Orders** last ran successfully. |

## Channel Setup Details

Go to **Integrations > Channel Monitoring > Channel Setup Details**, then pick a **Setup name**. The header shows its **Channel**, **Client** and **Warehouses**. The page has these cards:

| Card | What it shows |
| --- | --- |
| **Shipment order volumes** | Orders downloaded per day. |
| **Success rate** | Successful against failed order downloads in the last 24 hours. |
| **Integration methods** | The four methods and their state. |
| **Call results** | Successful and failed calls per day over the last two weeks. |
| **Missing shipment orders** | The latest orders that failed to import. |
| **Workflow blocked shipment orders** | Orders a workflow is holding. |
| **Product listing exceptions** | Listings that need a look. |
| **Recent errors** | The errors seen most. |

Each list card has **Show all**, which opens the full list filtered to this setup.

## Items For Review

The **Items For Review** tab holds four lists.

### Missing Shipment Orders

Orders the store has that KitStak couldn't import. Columns: **Order code**, **Last error code**, **Status**, **Last updated**, **Channel setup**, **Channel order #**, **Channel**, **Client** and **Order date**. **Status** is **Error**, **Retrying** or **Resolved**.

1. Select **Show details** to open **Order details**, with the error and the **Order payload (JSON)** the store sent.
2. Fix the cause, for example create the missing SKU or link the location.
3. Select **Retry download**. KitStak fetches that order again from the store.

**Download payload** saves the order's JSON.

### Recent Errors

Errors grouped by reason. Columns: **Error reason**, **Channel setup**, **Channel**, **Client**, **Errors**, **Orders** and **Last occurrence**. **Show affected orders** lists the orders behind an error, and **Open in Missing Orders** takes you to them.

### Workflow Blocked Shipment Orders

Orders a workflow stopped with **Block Order** or **Partially Block Order**. Columns: **Order code**, **Fully or partially**, **Channel setup name**, **Channel**, **Client**, **Order date**, **Workflow name**, **Action name** and **Warehouse**.

Select **Release** on one order, or **Release / unblock** on a selection. Released orders can be allocated and picked again. The workflow won't block them again unless they're updated.

### Product Listing Exceptions

| Issue type | Meaning |
| --- | --- |
| **Multi Listing** | One KitStak product is linked to more than one listing in the same store. |
| **SKU Difference** | The store's seller SKU is not the same as the KitStak SKU. |

Columns: **KitStak SKU**, **Seller SKU**, **Channel setup name**, **Channel**, **Client**, **Issue type** and **Listing date**.

## A daily routine

1. Open **Channel Health Overview** and look for low performing setups and **Paused** download status.
2. Open **Missing Shipment Orders**, fix each cause and select **Retry download**.
3. Open **Recent Errors** to spot a cause that affects many orders.
4. Release workflow blocked orders that are ready to ship.

## Related

- [Channel methods and logs](/docs/wms/channel-methods-and-logs)
- [Connect a sales channel store](/docs/wms/channel-connect-a-store)
- [Carrier errors](/docs/wms/carrier-errors)
