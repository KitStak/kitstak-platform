---
title: Channel methods and logs
description: See every store's scheduled methods with their next run, run a method now, and trace each run and API call for orders, shipments, products and inventory.
section: Integrations
order: 60
---

Each store connection has four channel methods: **Download Orders**, **Download Products**, **Sync Inventory** and **Send Shipment Info**. A method runs on its own schedule while it is turned on, and every run and every call is logged. The channel logs are where you check that orders arrived, that tracking went back and why something failed.

## Before you start

- You need the **Integration Logs** page in your role.
- Running a method needs **Create Setup** or **Edit Setup** on **Integrations**.

## The four methods

| Method | What it does | Default schedule |
| --- | --- | --- |
| **Download Orders** | Pulls new orders from the store into KitStak. Orders with unknown SKUs go to **Missing Shipment Orders** with the reason. | Every 15 minutes |
| **Download Products** | Reads the store's products, creates missing SKUs and links listings. | Once a day |
| **Sync Inventory** | Sends the available or on hand quantity per linked SKU back to the store. | Every hour |
| **Send Shipment Info** | Sends tracking numbers and shipped quantities for shipped orders, so the store closes the order and emails the buyer. | Every 30 minutes |

Turn methods on and change **Run every** in the store's **Configuration** tab. See [Connect a sales channel store](/docs/wms/channel-connect-a-store).

## Channel Methods

Go to **Integrations > Channel Logs > Channel Methods**.

| Column | What it shows |
| --- | --- |
| **Method** | One of the four methods. |
| **Store name**, **Channel** | The connection. |
| **Status** | **Active** when the method is turned on, **Passive** when off. **Paused** when it is on but can't run; hover for the reason. |
| **Job status** | **Started**, **Processing**, **Waiting For Next** or **Paused**. |
| **Every** | The interval. |
| **Next run** | A live countdown to the next run. |
| **Last run**, **Result** | When it last ran and how it went. |
| **Run** | Runs the method now. |

On sandbox and demo stores, the **Download Orders** row also has **Simulate error**. It runs once with one order that has an unknown SKU, so you can practise **Missing Shipment Orders** and **Retry download**. Scheduled runs never fail on purpose.

## Channel History

Go to **Integrations > Channel Logs > Channel History**. Each row is one run, with **Store name**, **Method**, **Date**, **Status**, **Error**, **Total**, **Success** and **Channel**.

Run statuses are **Processing**, **Successful**, **Partially Successful**, **No Data**, **Failed** and **Unauthorized**. A run is **Unauthorized** when the store refused the credentials.

Select **Show details** on a row to open the run. The title follows the method: **Downloaded Order Details**, **Downloaded Product Details**, **Inventory Sync Details** or **Shipment Update Details**. It shows **Success qty**, **Error qty**, **Total qty** and the status, and lists each item with **All rows** or **Errors only**.

You can also reach a store's history from its row menu on the connection list with **Channel history**, or from **Reports > Logs > Integration Log**.

## Orders and Shipments, Products and Inventory

These two logs list every single API call.

| Log | Menu | Columns |
| --- | --- | --- |
| Orders and Shipments | **Integrations > Channel Logs > Orders and Shipments** | Channel, Store name, Call method, Successful, Call date, Store order no, Qty, Error message |
| Products and Inventory | **Integrations > Channel Logs > Products and Inventory** | Channel, Store name, Call method, Successful, Call date, Seller SKU, Qty, Error message |

Search by order number or store in the first, and by seller SKU or store in the second.

## How runs behave

- Every order and listing is written on its own, so one failure never rolls back the rest of the run.
- Orders go through the same checks and workflows as orders you create in KitStak.
- A method on an inactive connection doesn't run. Turn the connection back on in **Edit**.

## Related

- [Channel health and monitoring](/docs/wms/channel-health-and-monitoring)
- [Connect a sales channel store](/docs/wms/channel-connect-a-store)
- [Integrations overview](/docs/wms/integration-overview)
