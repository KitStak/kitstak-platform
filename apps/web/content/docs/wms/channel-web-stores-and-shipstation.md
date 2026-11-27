---
title: Connect WooCommerce, BigCommerce, Magento and ShipStation
description: The credentials WooCommerce, BigCommerce, Magento and ShipStation ask for in KitStak WMS, where to create them, and what syncs with each one.
section: Integrations
order: 50
---

These four channels connect with credentials you create in the store or in ShipStation. The shared steps are the same as for every store: pick the client, paste the credentials, link locations to warehouses and turn on methods. This page lists what each one asks for and what it syncs.

## Before you start

- You need the **Create Setup** action on **Integrations**.
- Read [Connect a sales channel store](/docs/wms/channel-connect-a-store) for the shared steps and settings.
- WooCommerce and Magento stores must use HTTPS.

## WooCommerce

1. In WordPress, go to **WooCommerce**, then **Settings**, **Advanced**, **REST API**.
2. Add a key with Read/Write permission and copy the consumer key and secret.
3. In KitStak, select **Connect** on **WooCommerce** and choose **Custom App**.
4. Fill in the fields and select **Continue**.

| Field | What it does | Required |
| --- | --- | --- |
| **Store URL** | The WordPress site address, such as `shop.example.com`. HTTPS is required. | Yes |
| **Consumer key** | From the REST API key. | Yes |
| **Consumer secret** | From the REST API key. | Yes |

| Direction | What |
| --- | --- |
| In | Orders in the processing status, and products. |
| Out | Stock quantity per SKU, for products with stock management on. |
| Out | On shipment, a customer note with the tracking number, and the order is completed. |

## BigCommerce

The card is named **Big Commerce**.

1. In BigCommerce, go to **Settings**, then **Store-level API accounts**, and create an API account.
2. Grant Orders (modify), Products (modify), Information & settings (read only) and Store inventory (modify).
3. Copy the access token and the store hash: the part after `/stores/` in the API path.
4. In KitStak, choose **Custom App** on **Big Commerce** and fill in the fields.

| Field | What it does | Required |
| --- | --- | --- |
| **BigCommerce store name** | Shown as the Store on downloaded orders. | Yes |
| **API account access token** | The API account's token. | Yes |
| **Store hash** | Letters and digits only. | Yes |

| Direction | What |
| --- | --- |
| In | Orders in Awaiting Fulfillment, and catalog products. |
| Out | Inventory per SKU. |
| Out | A shipment with tracking and items, which moves the order to Shipped or Partially Shipped. |

## Magento

The **Magento** card covers Adobe Commerce and Magento 2 stores.

1. In the Magento admin, go to **System**, **Extensions**, **Integrations** and add a new integration.
2. Allow the Sales, Catalog and Stores resources, activate it and copy the access token.
3. Under **Stores**, **Configuration**, **Services**, **OAuth**, set Allow OAuth Access Tokens to be used as standalone Bearer tokens to Yes.
4. In KitStak, choose **Custom App** on **Magento** and fill in the fields.

| Field | What it does | Required |
| --- | --- | --- |
| **Store URL** | The Magento base URL. HTTPS is required. | Yes |
| **Integration access token** | The integration's access token. | Yes |

| Direction | What |
| --- | --- |
| In | Orders in the processing status, and products. |
| Out | Stock on the default source per SKU. |
| Out | A shipment with the shipped items and a track. |

## ShipStation as a sales channel

Connect ShipStation as a channel when a client's orders already flow into ShipStation from its stores. KitStak downloads the orders and marks them shipped in ShipStation, which then notifies the customer and the sales channel. To rate and print labels through ShipStation instead, connect it as a carrier. See [Connect a carrier account](/docs/wms/carrier-connect-a-carrier).

1. In ShipStation, go to **Settings**, **Account**, **API Settings** and generate an API key and secret.
2. In KitStak, choose **Custom App** on the **ShipStation** channel card.
3. Fill in the fields and select **Continue**. The ShipStation warehouses become the store locations you link on the **Warehouse** tab.

| Field | What it does | Required |
| --- | --- | --- |
| **ShipStation account name** | A name for this ShipStation account. | Yes |
| **API key** | From API Settings. | Yes |
| **API secret** | From API Settings. | Yes |

| Direction | What |
| --- | --- |
| In | Orders awaiting shipment, and products. |
| Out | Mark as shipped with carrier and tracking number. |

> **Note:** ShipStation does not hold store inventory, so **Sync inventory** reports an error for every SKU. Sync inventory from the store's own integration instead.

## Related

- [Connect a sales channel store](/docs/wms/channel-connect-a-store)
- [Connect Amazon, Walmart, eBay, Etsy and TikTok Shop](/docs/wms/channel-marketplaces)
- [Channel methods and logs](/docs/wms/channel-methods-and-logs)
