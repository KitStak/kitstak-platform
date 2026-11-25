---
title: Integrations overview
description: The sales channels and carriers KitStak WMS connects to, what each card badge means, the permissions you need and where the logs and monitoring live.
section: Integrations
order: 10
---

Integrations connect KitStak WMS to the stores your clients sell on and the carriers you ship with. A channel connection brings orders and products in and sends inventory and tracking back. A carrier connection rates shipments and prints labels. Every connection belongs to one client (channels) or one warehouse (carriers), and its traffic is logged and monitored.

## Before you start

- Connecting, editing and deleting need the **Create Setup**, **Edit Setup** and **Delete Setup** actions on **Integrations**.
- Logs need **Integration Logs**. Channel monitoring needs **Integration Monitoring**. Carrier errors need **Carrier Monitoring**.

## Open Integration Management

Go to **Integrations > Plugin Integrations > Channel Integrations** or **Carrier Integrations**. The left menu switches between **All**, **Channel Integrations** and **Carrier Integrations**, and the search box filters the cards.

Each card shows the logo and description, a **Learn more** link to the Integration Help Center, and one of these:

| Button | Meaning |
| --- | --- |
| **Connect** | No connection yet. Opens the connect drawer. |
| **Connect sandbox** | There is no live connection for this integration. Connecting creates a simulated one. |
| **Connected (2)** with **Manage** and **Add** | You have connections. **Manage** opens the list, **Add** adds another. |

## Card badges

| Badge | Meaning |
| --- | --- |
| **Live API** | A connected account in your workspace has completed successful live API calls. |
| **Beta** | A live adapter exists but no account in your workspace has completed a call through it yet. It switches to **Live API** after the first successful call. |
| **Sandbox only** | KitStak can't connect to a real account for this integration. Connecting creates a KitStak Sandbox store or a simulated carrier. |
| **No API** | Custom Carrier: your own carrier with manual tracking numbers. No carrier API is called. |

## Sales channels with a live adapter

| Channel | Orders in | Products in | Inventory out | Tracking out | Setup page |
| --- | --- | --- | --- | --- | --- |
| Shopify | Yes | Yes | Yes | Yes | [Connect Shopify](/docs/wms/channel-shopify) |
| Amazon | Merchant fulfilled orders | Yes | Yes | Yes | [Marketplaces](/docs/wms/channel-marketplaces) |
| Walmart | Yes | Yes | Yes | Yes | [Marketplaces](/docs/wms/channel-marketplaces) |
| eBay | Yes | Yes | Yes | Yes | [Marketplaces](/docs/wms/channel-marketplaces) |
| Etsy | Paid, unshipped receipts | Yes | Yes | Yes | [Marketplaces](/docs/wms/channel-marketplaces) |
| TikTok Shop | Awaiting shipment orders | Yes | Yes | Yes | [Marketplaces](/docs/wms/channel-marketplaces) |
| WooCommerce | Processing orders | Yes | Yes | Yes | [Web stores](/docs/wms/channel-web-stores-and-shipstation) |
| Big Commerce | Awaiting fulfillment orders | Yes | Yes | Yes | [Web stores](/docs/wms/channel-web-stores-and-shipstation) |
| Magento | Processing orders | Yes | Yes | Yes | [Web stores](/docs/wms/channel-web-stores-and-shipstation) |
| ShipStation | Awaiting shipment orders | Yes | No | Yes | [Web stores](/docs/wms/channel-web-stores-and-shipstation) |

Loop Returns and CartRover appear as **Sandbox only**. Every channel also offers a **KitStak Sandbox** store for testing. See [Connect a sales channel store](/docs/wms/channel-connect-a-store).

## Carriers you can connect

| Carrier | What it does | Credentials |
| --- | --- | --- |
| UPS | Rates, labels and voids through the UPS APIs. | API key, API secret, payor account number |
| Fedex | Rates, labels and cancels through the FedEx APIs. | API key, secret key, payor account number |
| Stamps.com | USPS rates and labels. | Client ID, client secret, refresh token |
| EasyPost | Multi carrier labels. Carrier accounts in EasyPost become services. | API key |
| Shippo | Multi carrier labels. Carrier accounts in Shippo become services. | API token |
| ShipStation | Rates and labels with the carriers in your ShipStation account. | API key, API secret |
| Custom Carrier | Your own fleet or a regional courier, with your own services and tracking numbers. | None |
| KitStak Sandbox | A built in test carrier with realistic rates, labels and voids. | None |

Techship, Ehub and eShipper show as **Sandbox only**. Their connect drawer shows **No API adapter yet** and points you to the carriers above. See [Connect a carrier account](/docs/wms/carrier-connect-a-carrier).

## Credentials

Credentials are stored encrypted. After you save them, only the last 4 characters are ever shown. You can replace them, but you can't read them back.

## Where to watch your integrations

| Page | Menu | What it shows |
| --- | --- | --- |
| Channel logs | **Integrations > Channel Logs** | Every scheduled method, each run and each API call. See [Channel methods and logs](/docs/wms/channel-methods-and-logs). |
| Channel monitoring | **Integrations > Channel Monitoring** | Health per store, missing orders, errors, blocked orders and listing exceptions. See [Channel health and monitoring](/docs/wms/channel-health-and-monitoring). |
| Carrier errors | **Integrations > Carrier Monitoring > Carrier Errors** | Failed label, rate and void calls. See [Carrier errors](/docs/wms/carrier-errors). |

The **Integration Help Center** has a section per channel and carrier with its status and how to connect. Open it from **Learn more** on any card or the help link on integration pages.

## Related

- [Connect a sales channel store](/docs/wms/channel-connect-a-store)
- [Connect a carrier account](/docs/wms/carrier-connect-a-carrier)
- [Direct Print agent](/docs/wms/integration-direct-print-agent)
