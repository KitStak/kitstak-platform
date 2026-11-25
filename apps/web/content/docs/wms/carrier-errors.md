---
title: Carrier errors
description: Find failed label, rate and void calls to every carrier, read the exact request and response, and download them to share with the carrier or your team.
section: Integrations
order: 90
---

Every call KitStak makes to a carrier is logged: rating a shipment, creating a label and voiding or canceling one. **Carrier Errors** lists the calls that failed, so when a packer can't print a label you can see exactly what the carrier answered and why.

## Before you start

- You need the **Carrier Monitoring** page in your role.

## Open Carrier Errors

1. Go to **Integrations > Carrier Monitoring > Carrier Errors**.
2. Pick the tab for the step: **Label Generation**, **Rate Call** or **Void/Cancel Label**.
3. Filter by carrier setup, carrier connection, client, warehouse, date, status or other fields.

Each tab shows failed calls by default. Add a **Status** filter of **Success** to include successful calls too. You can also open a setup's errors from **Errors (24h)** on the carrier page.

## Columns

| Column | What it shows |
| --- | --- |
| **Shipment order** | The order the call was for. |
| **Timestamp** | When the call was made. |
| **Integration step** | **Label Generation**, **Rate Call** or **Void/Cancel Label**. |
| **Tracking number** | On the void tab, the label that was voided. |
| **Destination type** | Domestic or international. |
| **Carrier** | The carrier. |
| **Status** | Success or error. |
| **HTTP code** | The code the carrier answered with. |
| **Error** | The carrier's error message. |
| **Resp. time** | How long the carrier took to answer. |
| **Shipping option** | The service requested. |
| **Carrier connection**, **Carrier setup** | Which provider and which of your setups. |
| **Warehouse**, **Client** | Where and for whom. |
| **User** | Who made the call, or **System**. |
| **Source**, **Label type**, **Rate shopping name** | Where the call came from, shipping or return label, and the rate shopping preset used. |

## Filters

| Filter | Values |
| --- | --- |
| **Carrier setup name** | Your setups. |
| **Carrier connection** | The providers, including KitStak Sandbox. |
| **Client**, **Warehouse** | Your clients and warehouses. |
| **Created date** | A date range. |
| **Is international?**, **Is rate shopping?**, **Return label** | Yes or no. |
| **Shipment order code**, **Tracking number** | Text. |
| **Status** | **Success** or **Error**. |
| **HTTP code** | A number. |

## Read a call

1. Select **Show details** in the row menu. The **Transaction details** drawer opens.
2. Read the summary: **Integration step**, **Created date**, **Status**, **Response time**, **Shipment order**, **Carrier setup**, **Shipping option**, **Rate shopping** and **Source**.
3. Switch between **REQUEST** and **RESPONSE** to read the JSON bodies.

**Download request** and **Download response** in the row menu save the bodies as files, ready to send to the carrier's support.

## Common causes

| What you see | Where to look |
| --- | --- |
| Address errors on every call | The warehouse ship from address, or the setup's **Ship from address** on its **Advanced** tab. |
| Authentication errors | The setup's credentials and **Environment** on its **General** tab. |
| Errors on one service only | Whether that service is active on the account at the carrier. |
| A phone number error | Carriers need a ship from phone number of at least 10 digits. |

## Related

- [Connect a carrier account](/docs/wms/carrier-connect-a-carrier)
- [Channel health and monitoring](/docs/wms/channel-health-and-monitoring)
- [Integrations overview](/docs/wms/integration-overview)
