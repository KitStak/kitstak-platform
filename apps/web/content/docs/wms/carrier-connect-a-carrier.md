---
title: Connect a carrier account
description: Add UPS, FedEx, Stamps.com, EasyPost, Shippo, ShipStation, a Custom Carrier or the KitStak Sandbox carrier, then choose clients, services, packages and label settings.
section: Integrations
order: 80
---

A carrier setup connects one carrier account to one warehouse. Once connected, its services can be rate shopped and used to print labels at packing. You choose which clients may use it, which services and packages are on, and how labels, markups and international paperwork work.

## Before you start

- You need the **Create Setup** action on **Integrations**.
- The warehouse must exist and have a complete address. KitStak uses it as the ship from address for rating and labels.
- Have the carrier's API credentials and, for UPS and FedEx, the account number.

## Connect a carrier

1. Go to **Integrations > Plugin Integrations > Carrier Integrations**.
2. Select **Connect** on the carrier card. On a carrier's page, select **Add New Connection**.
3. Enter a **Setup name**, for example `UPS-EAST`.
4. Paste the credentials the carrier asks for. They are in the table below.
5. Enter the **Payor account number**. It is required for UPS and FedEx.
6. Choose the **Warehouse**.
7. Set **Test account**. **Yes** validates requests like the carrier and returns sandbox rates and labels. **No** calls the live carrier API.
8. Select **Continue**. For a production setup, KitStak checks the credentials with the carrier first. The message shows how many services the setup starts with.

## Credentials per carrier

| Carrier | Fields | Where to get them |
| --- | --- | --- |
| UPS | **API key**, **API secret**, **Payor account number** | An app on the UPS Developer Portal with Rating, Shipping and Tracking. KitStak renews the token itself. |
| Fedex | **API key**, **Secret key**, **Payor account number** | A project on the FedEx Developer Portal with Rates, Ship and Track. |
| Stamps.com | **Client ID**, **Client secret**, **Refresh token** | Your Stamps.com credentials, for USPS rates and labels. |
| EasyPost | **API key** | A production key from EasyPost account settings. Carrier accounts linked in EasyPost become services. |
| Shippo | **API token** | A live token from Shippo settings. Carrier accounts in Shippo become services. |
| ShipStation | **API key**, **API secret** | ShipStation **Settings**, **Account**, **API Settings**. Rates and labels use the carriers in your ShipStation account. |
| Custom Carrier | None | No API is called. |
| KitStak Sandbox | None | A built in test carrier. |

## Custom Carrier

Use a Custom Carrier for your own fleet, a regional courier or an LTL partner without an API. It starts with the services **Custom Standard**, **Custom Express**, **Custom Next Day**, **Local Delivery**, **White Glove**, **LTL Freight** and **Custom International**, and the packages **Box**, **Poly Mailer**, **Envelope**, **Pallet** and **Crate**. KitStak prints its labels with a tracking number that starts with `CC`, or the number the operator types at ship time. Voids happen in KitStak only.

## Edit a carrier setup

Open the carrier's page, select the setup name or **Edit** in its row menu. The drawer has five tabs.

### General

| Field | What it does |
| --- | --- |
| **Setup name** | Up to 60 characters. |
| **Warehouse** | Locked after creation. |
| Credentials | Shows the last characters of each saved secret, or **Not set**. Paste a new value to replace it. |
| **Payor account number** | The carrier account billed for labels. |
| **Active** | Turn off to set the setup inactive. |
| **Environment** | **Test** validates requests and returns sandbox labels and rates. **Production** uses the live API; credentials are checked when you save. |

### Clients

Turn on **Give access to all existing and future clients.**, or turn it off and choose each client. For each client you can set a markup: **Percentage** or **Fixed Price** and an amount. A percentage markup can be at most 100. Set both the type and amount, or neither. At least one client needs access.

### Services and Packages

Each tab lists the carrier's services or packages with an on or off switch. **Give access to all existing and future services** and **Give access to all existing and future packages** turn everything on. Tick rows and use **Activate selected** or **Deactivate selected**. At least one service must be active. Services show their transit days, an international flag and how many rate shopping presets use them.

### Advanced

| Section | Settings |
| --- | --- |
| **Ship from address** | **Use the order's retailer address as the ship from address**, or enter a company, address, contact name and phone. Carriers need a phone number of at least 10 digits. |
| **Third party accounts** | **Account number**, **Billing country** and **Billing zip** of accounts you bill labels to. Select **Add account**. |
| **Markup rate** | A general markup for this setup. Client markups on the **Clients** tab take priority. |
| **Label settings** | Label format **PDF**, **ZPL** or **EPL**; size 4 x 6, 4 x 8 or 6 x 4 in; up to three label messages of 60 characters each. |
| **International settings** | **Tax type** (EIN, DNS or FGN), **Tax ID**, **Use components on commercial invoice**, **Customer reference (invoice number)** and **Customer reference (PO number)**. |
| **Return label settings** | **Generate return label with shipping label**. |

Label messages can insert tokens such as `OrderCode`, `StoreOrderNumber`, `ClientName`, `SKU1` and `RetailerPO`. Customer references can use `OrderCode`, `StoreOrderNumber`, `Note`, `Tags` and `RetailerPO`.

## The carrier page

Each carrier page lists its setups with **Setup name**, **Warehouse**, **Status**, **Environment**, **Connection**, **Services**, **Clients** and **Errors (24h)**. A production setup without credentials shows **No credentials**. The error count opens the setup's [carrier errors](/docs/wms/carrier-errors).

## Delete a setup

Select **Delete** in the row menu. Its services are removed from rate shopping presets. Setups with open orders or label history can't be deleted. Set them inactive instead.

## Hide carrier costs from some users

Roles can hide carrier rates, fees and account numbers. See [Roles and permissions](/docs/wms/role-roles-and-permissions).

## Related

- [Carrier errors](/docs/wms/carrier-errors)
- [Integrations overview](/docs/wms/integration-overview)
- [Direct Print agent](/docs/wms/integration-direct-print-agent)
