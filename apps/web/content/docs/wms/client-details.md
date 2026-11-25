---
title: Client details page
description: Read a client's 30 day activity, edit its settings and addresses, see who can access it and its billing forms, and activate, deactivate or delete it.
section: Clients
order: 30
---

The client details page is the one place to see and run everything about a client: recent volume, settings, addresses, the users who can see it, its billing forms and its history. Open it by selecting a client name on the **Clients** list.

## Before you start

- You need the **View** action on **Clients**. Editing needs **Edit**, deleting needs **Delete**.
- A client that is outside your client access shows **Client not found**.

## The Clients list

Go to **Settings > Client Setup > Clients**. The list has the tabs **Client**, **Customer**, **Vendors** and **Retailers** at the top.

| Column | What it shows |
| --- | --- |
| **Client** | Display name. Select it to open the details page. |
| **Code** | The client code. |
| **Official name** | Legal name. |
| **Tax ID** | Tax ID, when set. |
| **Status** | **Active** or **Inactive**. |
| **# Products** | Products of the client. Select the number to open them. |
| **# Open orders** | Open shipment orders. Select the number to open them. |
| **Currency** | Billing currency. |

**Full name**, **Contact**, **Contact email** and **Created date** are hidden columns you can turn on. Search matches client, code, official name or tax ID. Each row menu has **Show details**, **Edit**, **Change log**, **Activate** or **Deactivate**, and **Delete**. **Export As Excel** exports the rows that match your filters.

## The header and tiles

The header shows the client name, its status and, when set, its tax ID. **Edit** opens the four step drawer, where **Save** applies every step. The **More actions** menu has **Change log**, **Create billing form**, **Activate** or **Deactivate**, and **Delete**.

| Tile | What it shows |
| --- | --- |
| **Orders · 30 days** | Orders in the last 30 days and how many are open now. |
| **Units shipped · 30 days** | Units shipped in the last 30 days. |
| **Inventory units** | Units on hand, SKUs in stock and the number of products. |
| **Open POs** | Purchase orders not yet closed. |

Each tile opens the matching list filtered to this client. If your company also uses KitStak Projects or KitStak Pulse, a line under the tiles shows the client's project health or its profit for the last 30 days, with a link into that app. See [KitStak Projects](/docs/projects) and [KitStak Pulse](/docs/pulse).

## Tabs

| Tab | What you do there |
| --- | --- |
| **Overview** | Display name, official name, tax ID, currency, billing form, SSCC-18, contact, created date, the number of switches on, and the default shipping, billing and return addresses. |
| **Settings** | Currency and the 28 switches. See [Client operational settings](/docs/wms/client-settings). |
| **Addresses** | Add, edit and set default addresses, then select **Save addresses**. |
| **Users with access** | Every user who can see this client. See [Client users and what they see](/docs/wms/client-users-and-access). |
| **Billing contracts** | The client's billing forms with warehouse, period, start date, fees, bills, last calculation and approval. |
| **Activity** | The client's change history and a notes panel. |

The **Overview** tab shows the approved billing form, or the latest one when none is approved. When a default address is missing it shows **Not set** with a link to add one.

## Activate or deactivate a client

1. Open the client and select **More actions**.
2. Select **Deactivate** or **Activate**, then **Yes**.

When you deactivate a client:

- It disappears from order, PO and billing client selects.
- Automatic billing pauses for its approved billing forms. You can still calculate a final bill by hand.
- The pause is written to each approved billing form's change log, and billing resumes when you activate the client again.

A client with open orders can't be deactivated. The menu item shows how many open orders it has. You can also select several clients on the list and use the bulk **Activate** or **Deactivate** actions.

## Delete a client

Delete is only for a client created by mistake. A client can't be deleted when it has products, orders, purchase orders, stock on hand or billing forms. KitStak shows **Clients with products, orders or billing forms can't be deleted; deactivate instead**.

Deleting removes the client, its addresses and its customers. It can't be undone.

## Create a billing form from the client

Select **Create billing form** in **More actions**, or on the **Billing contracts** tab. The client must be active first. See [Create a billing form](/docs/wms/billing-create-a-billing-form).

## Related

- [Create a client](/docs/wms/client-create-a-client)
- [Customers and retailers](/docs/wms/client-customers-and-retailers)
- [How 3PL billing works](/docs/wms/billing-overview)
