---
title: Connect Amazon, Walmart, eBay, Etsy and TikTok Shop
description: The credentials each marketplace asks for in KitStak WMS, where to find them, and which orders, listings, inventory and tracking sync each way.
section: Integrations
order: 40
---

Marketplace connections follow the same steps as every store: pick the client, paste the credentials, link store locations to warehouses and turn on the methods. What differs is the credentials each marketplace uses and which of its orders KitStak downloads. Each connect drawer also shows a note named for the marketplace, such as **Where to find your Amazon credentials**.

## Before you start

- You need the **Create Setup** action on **Integrations**.
- Read [Connect a sales channel store](/docs/wms/channel-connect-a-store) for the shared steps and settings.
- Each of these connects with **Custom App**. You can also start with a **KitStak Sandbox** store.

## Amazon

KitStak downloads merchant fulfilled orders from Amazon Seller Central. It asks Amazon for the buyer's shipping address with the restricted data role, confirms shipments with tracking, updates each listing's fulfillment availability and reads products from your listings.

1. Register a Selling Partner API app with the Orders, Listings and Shipping roles, plus the restricted shipping address role.
2. Authorise the app for the seller and copy its Login with Amazon credentials and the refresh token.
3. In KitStak, select **Connect** on **Amazon**, choose **Custom App** and fill in the fields below.

| Field | What it does | Required |
| --- | --- | --- |
| **Amazon store name** | Shown as the Store on downloaded orders. | Yes |
| **LWA client ID** | The app's Login with Amazon client ID. | Yes |
| **LWA client secret** | The app's Login with Amazon client secret. | Yes |
| **Refresh token** | From authorising the app for this seller. | Yes |
| **Seller ID (Merchant token)** | In Seller Central under Settings, Account Info, Merchant Token. Letters and digits only. | Yes |
| **Marketplace ID** | Leave blank for Amazon.com (US). Letters and digits only. | No |

## Walmart

KitStak downloads Walmart Marketplace orders in Created or Acknowledged status and acknowledges the Created ones. Shipments post line level Shipped statuses with tracking. Inventory updates each SKU.

1. In Walmart Seller Center, go to **Settings**, then **API Key Management**.
2. Copy the Client ID and Client Secret for the Marketplace API.
3. In KitStak, choose **Custom App** on **Walmart** and fill in **Walmart seller name**, **Client ID** and **Client secret**.

## eBay

KitStak downloads orders that are not started or in progress from the Fulfillment API, posts a shipping fulfillment with tracking, and updates quantities in bulk.

1. In the eBay Developer Program, generate a user token for the seller with the `sell.fulfillment` and `sell.inventory` scopes.
2. In KitStak, choose **Custom App** on **eBay**.
3. Enter the **eBay seller username**, shown as the Store on downloaded orders, and paste the **User access token (OAuth)**.

## Etsy

KitStak downloads paid, unshipped receipts, posts tracking to the receipt so Etsy marks it shipped, and updates the listing quantity per SKU.

1. Create an app in the Etsy developer portal.
2. Authorise it for the shop with OAuth 2.0 with PKCE and the scopes `transactions_r`, `transactions_w`, `listings_r` and `listings_w`.
3. In KitStak, choose **Custom App** on **Etsy** and fill in the fields below.

| Field | What it does | Required |
| --- | --- | --- |
| **Etsy shop name** | Shown as the Store on downloaded orders. | Yes |
| **OAuth access token** | The seller's access token. | Yes |
| **App keystring (API key)** | From your app in the Etsy developer portal. | Yes |
| **Shop ID** | The numeric shop ID. | Yes |
| **Refresh token** | Recommended. Etsy access tokens last one hour; KitStak renews them with the refresh token. | No |

## TikTok Shop

KitStak downloads orders awaiting shipment, ships each order's package with your own tracking, and updates the SKU quantity in the shop's default warehouse. Every request is signed with the app secret.

1. In TikTok Shop Partner Center, create a custom app with the Order, Product, Logistics and Fulfillment scopes.
2. Authorise it for your shop and copy the seller's access and refresh tokens.
3. In KitStak, choose **Custom App** on **TikTok Shop** and fill in the fields below.

| Field | What it does | Required |
| --- | --- | --- |
| **TikTok shop name** | Shown as the Store on downloaded orders. | Yes |
| **App key** | The app's key. | Yes |
| **App secret** | The app's secret. | Yes |
| **Seller access token** | From authorising your app for the shop. | Yes |
| **Refresh token** | Recommended. Access tokens expire after about 7 days; KitStak renews them. | No |
| **Shop cipher** | Leave blank to use the first shop the token is authorised for. | No |

## After connecting any marketplace

1. On the **Warehouse** tab, link the marketplace's locations to warehouses.
2. On **Advanced**, choose the **Payment status** values to download.
3. On **Configuration**, turn on the methods you want and save.

All secrets are stored encrypted, and only the last 4 characters are ever shown. When the marketplace refuses the credentials, the run is marked **Unauthorized**. Paste new credentials with **Customize authorization method** on the **General** tab.

## Related

- [Connect a sales channel store](/docs/wms/channel-connect-a-store)
- [Channel health and monitoring](/docs/wms/channel-health-and-monitoring)
- [Connect WooCommerce, BigCommerce, Magento and ShipStation](/docs/wms/channel-web-stores-and-shipstation)
