---
title: Create a client
description: Add a 3PL client with its code, official name, currency, switches, addresses and SSCC-18 settings, or import many clients from Excel.
section: Clients
order: 10
---

A client is a brand you store and ship for. Every product, order, purchase order, stock bucket and billing form belongs to one client, so you create the client before anything else for that brand. If you only ship your own goods, you work with a single client.

## Before you start

- You need the **Clients** page with the **Create** action in your role. See [Roles and permissions](/docs/wms/role-roles-and-permissions).
- Your user must have access to all clients. A user limited to some clients gets **Only users with access to all clients can create clients**.
- Pick the client code now. It can't change after you create the client.

## Create a client

1. Go to **Settings > Client Setup > Clients**.
2. Select **Create client**. A drawer opens with four steps: **Information**, **Settings**, **Addresses** and **Others**.
3. On **Information**, enter the **Display name** and **Official name**. KitStak suggests a **Client code** from the display name and checks that it is free.
4. Choose the **Status** and, if you like, the contact name, email and phone. Select **Next**.
5. On **Settings**, choose the **Currency** and turn on the switches the client needs. See [Client operational settings](/docs/wms/client-settings).
6. On **Addresses**, select **Add address** for each shipping, billing or return address. This step is optional.
7. On **Others**, enter the **Tax ID**, the **SSCC-18 barcode creation** values, any custom fields and a **Note**.
8. Select **Create client**. The client details page opens.

## Information step fields

| Field | What it does | Required |
| --- | --- | --- |
| **Display name** | The name shown across the app. Up to 100 characters. Two clients can't share a name. | Yes |
| **Official name** | Legal name printed on bills and BOLs. Up to 200 characters. | Yes |
| **Client code** | Used on SKUs, imports and integrations. 2 to 20 letters, numbers, dash or underscore, saved in capitals. | Yes |
| **Status** | **Active** or **Inactive**. Inactive clients are hidden from order, PO and billing client selects. | Yes |
| **Contact name** | Primary contact for notifications and billing questions. | No |
| **Contact email** | Must be a valid email when filled in. | No |
| **Phone** | Up to 40 characters. | No |

The code is checked while you type. If it is taken you see **Client code `HARBOR` is already used**, with a free suggestion such as `HARBOR2`.

## Others step fields

| Field | What it does | Required |
| --- | --- | --- |
| **Tax ID** | EIN or VAT number printed on bills. Up to 40 characters. | No |
| **Extension digit** | One digit, 0 to 9. Often used to tell pallets from cartons. | Only for SSCC-18 |
| **GS1 company prefix** | The 7 to 10 digit prefix GS1 assigned to the client. | Only for SSCC-18 |
| **Serial number** | Starting serial reference. With a 7 digit prefix it can have up to 9 digits; a longer prefix leaves fewer. | Only for SSCC-18 |
| **Note** | Saved to the client's notes with your name and the time. Up to 1000 characters. | No |

Pallet and carton LP labels for the client use GS1 SSCC-18 numbers built from the three SSCC values. Leave all three blank to skip SSCC labels. If you fill in one, all three are required. The drawer shows the first SSCC-18, check digit included, once all three are complete.

> **Note:** Prices don't live on the client. They come from the client's billing forms. See [Create a billing form](/docs/wms/billing-create-a-billing-form).

## Addresses

Each address has an **Address name**, a **Usage type** (**Shipping**, **Billing** or **Return**), the street address, city, country and postal code. State is required for countries that have states or provinces, and a US address needs a 5 digit ZIP or ZIP+4.

A **Shipping** address prints on carrier labels, so it also needs **Contact first name**, **Contact last name** and **Email**. Turn on **Set default address** to make it the default for its usage type. The default of each type is pre-filled on documents. A client can have up to 50 addresses.

## Import or update clients from Excel

1. On the **Clients** page, select **Bulk import/update**.
2. Choose **Import clients** to create new clients, or **Update clients** to change existing ones matched by client code.
3. Download the template, fill it in and upload it on the import page.

The client template has these columns:

```csv
Client Code,Client Name,Contact Name,Email,Phone,Billing Address 1,Billing Address 2,Billing City,Billing State,Billing Postal Code,Billing Country,Status
```

**Client Code** and **Client Name** are required. **Billing Country** uses the two letter ISO code, such as `US`. **Status** is **Active** or **Inactive**. You need the **Import File** action on **Clients** to use the menu.

## Rules KitStak enforces

- The client code can't change after creation. Editing shows **Codes can't change after creation**.
- Display names must be unique: **A client named Harbor Lane Goods already exists**.
- If someone else saves the client while your drawer is open, you see **This client changed since you opened it** and must reload.

## Related

- [Client operational settings](/docs/wms/client-settings)
- [Client details page](/docs/wms/client-details)
- [Client users and what they see](/docs/wms/client-users-and-access)
