---
title: Connect Shopify
description: Connect a Shopify store with a custom app access token, client credentials or the KitStak public app, then link locations and turn on order and inventory sync.
section: Integrations
order: 30
---

The Shopify connection downloads a client's open, unfulfilled orders and its products, sets available inventory per location, and creates fulfillments with tracking when orders ship. You can connect with a custom app you create in the store, or with the KitStak public app when your workspace has it set up.

## Before you start

- You need the **Create Setup** action on **Integrations**.
- You need staff access to the Shopify admin that lets you create apps.
- Know the store's handle: the part before `.myshopify.com`, such as `harbor-lane`.

## Create the custom app in Shopify

1. In the Shopify admin, go to **Settings**, then **Apps and sales channels**, then **Develop apps**.
2. Create an app and grant it the orders, products, inventory, locations and fulfillments scopes.
3. Install the app and copy its Admin API access token. You can instead use the app's client ID and client secret.

## Connect with a custom app

1. Go to **Integrations > Plugin Integrations > Channel Integrations** and select **Connect** on **Shopify**.
2. Choose **Custom App**.
3. Pick the **Client**.
4. In **Your Shopify store name**, enter the handle, for example `harbor-lane`. KitStak connects to `harbor-lane.myshopify.com`.
5. In **Select authorization method**, choose **Access Token** or **Client ID & Secret**.
6. Paste the **Access token**, or the **Client ID** and **Client secret**.
7. Choose the **API version**: **Rest API** or **GraphQL**. GraphQL validates through Shopify's GraphQL endpoint.
8. Select **Continue**.

KitStak checks the credentials with the store before saving. With **Client ID & Secret**, it exchanges them for a token on each run through Shopify's client credentials grant.

## Connect with the public app

**Public App** lets a store owner approve KitStak without copying keys. It is available only when your workspace has its own Shopify app keys set up on the server. Until then, the card says it needs the workspace's Shopify app keys, and you connect with a custom app.

1. Choose **Public App**, pick the **Client** and enter **Your Shopify store name**.
2. Select **Connect to Shopify**.
3. On Shopify, select **Install**. You come back to KitStak with the store connected.

If the install doesn't finish, the connection list shows **Shopify install didn't finish** with the reason.

## Fields

| Field | What it does | Required |
| --- | --- | --- |
| **Client** | Orders, products and inventory of this store belong to this client. | Yes |
| **Your Shopify store name** | The store handle. Up to 60 characters. | Yes |
| **Select authorization method** | **Access Token** or **Client ID & Secret**. | Custom App |
| **Access token** | The Admin API access token. Stored encrypted; only the last 4 characters are ever shown. | With Access Token |
| **Client ID**, **Client secret** | The app's credentials. | With Client ID & Secret |
| **API version** | **Rest API** or **GraphQL**. | Yes |

## After connecting

1. On the **Warehouse** tab, link each Shopify location to a KitStak warehouse and select **Add**.
2. On **Advanced**, choose the **Payment status** values to download, such as paid.
3. On **Configuration**, turn on **Download orders**, **Download products**, **Sync inventory** and **Send shipment info to my store** as needed.
4. Select **Save**.

## What syncs

| Direction | What | Default schedule |
| --- | --- | --- |
| Shopify to KitStak | Open, unfulfilled orders updated since the last successful run | Every 15 minutes |
| Shopify to KitStak | Products and their listings | Once a day |
| KitStak to Shopify | Available or on hand quantity per linked location | Every hour |
| KitStak to Shopify | Fulfillments with tracking numbers | Every 30 minutes |

Orders whose SKUs don't exist go to **Missing Shipment Orders** with the reason, unless **Create nonexistent products when orders are downloaded** or **Partial orders** is on. See [Channel health and monitoring](/docs/wms/channel-health-and-monitoring).

## Related

- [Connect a sales channel store](/docs/wms/channel-connect-a-store)
- [Channel methods and logs](/docs/wms/channel-methods-and-logs)
- [Integrations overview](/docs/wms/integration-overview)
