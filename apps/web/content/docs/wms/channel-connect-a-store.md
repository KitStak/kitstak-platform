---
title: Connect a sales channel store
description: Connect a client's store with a custom app, a public app or a KitStak Sandbox store, link store locations to warehouses and choose what syncs each way.
section: Integrations
order: 20
---

A store connection links one online store to one client. Once it is connected and its store locations are linked to warehouses, KitStak can download orders and products, push available inventory back and send tracking when an order ships. This page covers the steps every channel shares. The credentials each channel asks for are on the channel pages.

## Before you start

- You need the **Create Setup** action on **Integrations**.
- The client must exist. Orders, products and inventory of the store belong to this client.
- Have the store's API credentials ready, or plan to start with a KitStak Sandbox store.

## Connect a store

1. Go to **Integrations > Plugin Integrations > Channel Integrations**.
2. Select **Connect** on the channel card, or **Add** when it already has connections.
3. Choose the connection type. The three types are in the table below.
4. Pick the **Client**.
5. Enter the store name and the credentials the channel asks for.
6. Select **Continue**. KitStak checks the credentials with the store, saves them encrypted and opens the store's **Warehouse** tab.
7. Link store locations to warehouses, turn on the methods you want on **Configuration**, and select **Save**.

| Connection type | When to use it |
| --- | --- |
| **Custom App** | Paste the store's own API credentials. Available for every channel with a live adapter. |
| **Public App** | Approve the KitStak app on the store, with no keys to copy. Shopify only, and only when your workspace has its Shopify app keys. |
| **KitStak Sandbox** | A realistic test store that generates orders on every run. No credentials. |

Select **Manage** on a card to open that channel's connection list, such as **Shopify Connection List**. Its columns are **Store name**, **Client**, **Warehouse**, **Status**, **Connection**, **Methods** and **Last order**. **Status** is **Pending**, **Completed** or **Error**. Select **Connect Store** there to add another store.

## KitStak Sandbox stores

A sandbox store needs no credentials. Each **Download Orders** run creates 2 to 6 realistic orders from the client's active SKUs. Scheduled runs never fail on purpose. To practise missing orders and **Retry download**, use **Simulate error** on the **Download Orders** row of **Channel Methods**. Sandbox stores show a **Sandbox** badge.

## Edit a store connection

Open the row menu and select **Edit**. The drawer has four tabs.

### General

| Field | What it does |
| --- | --- |
| **Connection store name** | Shown as the store on downloaded orders. Up to 60 characters. |
| **Client** | Locked after the store is connected. |
| **Active** | Inactive connections pause every channel method. |
| **API version** | **Rest API** or **GraphQL**. Shopify uses it for validation. |
| Credentials | Badges show the last 4 characters of each stored secret. Select **Customize authorization method** to paste new ones. New credentials are checked with the store when you save; blank fields keep the current ones. |

### Warehouse

KitStak downloads orders, syncs inventory and sends fulfillments by store location. Under **Link store fulfillment locations with KitStak**, pick a **Store location** and a **Warehouse**, then select **Add**. Repeat for each location.

- Each store location maps to one warehouse.
- Orders, inventory and shipments need at least one linked location. Until then you see **Link a location first**.
- The store's locations load from the store, so credentials must work first.

### Advanced

| Field | What it does | Required |
| --- | --- | --- |
| **Payment status** | Which payment statuses to download: paid, partially paid, authorized, pending, partially refunded. | When orders download |
| **Tax ID mapping** | Where to read a tax ID on the order: **Order note attribute · tax_id**, **Customer tax exemption** or **Billing company**. | No |
| Filter method | **Included order tags** or **Excluded order tags**. | No |
| **Filter condition** | **All following tags** or **Any following tags**. | No |
| **Order tags** | The tags to filter on. Type a tag and press Enter. | No |

Orders stopped by the tag filter appear in **Missing Shipment Orders** as **Order is Blocked by Tag Filter**.

### Configuration

| Section | Settings |
| --- | --- |
| **Products** | **Download products** creates missing SKUs and links listings. **Product UOM**: Unit, Each, Case or Pack. |
| **Orders** | **Download orders**. **Shipment order type**: D2C Order or B2B Order. **Download open orders from**: **Let KitStak decide**, since the last successful run, or a **Specific date**. **Partial orders** creates the order with the SKUs that exist when others are missing. **Create nonexistent products when orders are downloaded**. **Skip address verification**. |
| **Inventory** | **Sync inventory**. **Inventory sync method**: **On Hand** or **Available**. Locations with Prevent inventory sync and listings set to never sync are skipped. |
| **Shipments** | **Send shipment info to my store** pushes tracking numbers for shipped orders. |

Each section has **Run every**, in minutes, from 5 up to 10,080 (once a week). The defaults are 15 minutes for orders, once a day for products, every hour for inventory and every 30 minutes for shipments.

When you save, the message lists the active methods.

## Other row actions

| Action | What it does |
| --- | --- |
| **Show details** | Status, orders, listings, missing orders, warehouses and each method's last run. |
| **Run Download Orders now** | Runs the order download immediately. |
| **Channel history** | Opens the store's run history. |
| **Change log** | Every change to the connection. |
| **Delete** | Removes the connection, its channel methods, run history, listings and missing orders. Downloaded orders stay. |

A connection with open orders can't be deleted. Set it inactive instead.

## Status pills

A method that is on but can't run shows a pill with the reason, such as **Needs reconnect** when credentials fail, **Inactive** when the connection is off, or **No live API** for a channel without a live adapter.

## Related

- [Connect Shopify](/docs/wms/channel-shopify)
- [Channel methods and logs](/docs/wms/channel-methods-and-logs)
- [Channel health and monitoring](/docs/wms/channel-health-and-monitoring)
