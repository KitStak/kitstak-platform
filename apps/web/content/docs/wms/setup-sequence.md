---
title: Set up your warehouse step by step
description: The order to set up KitStak WMS in, from the warehouse and its locations to clients, products and your first receipt.
section: Get started
order: 30
---

KitStak WMS needs a few records before stock can move, and each one depends on the one before it. Follow these steps in order. The **Get set up** checklist on the dashboard follows the same order and checks off each step when it finds the data.

## Before you start

- You need a role that can create warehouses, locations, clients and products. Ask your admin if a button is missing or disabled.
- Have your warehouse address, time zone and shift hours ready.
- If you have many products or locations, download the Excel templates first. See [Import data from Excel](/docs/wms/excel-imports).

## Step 1: Create the warehouse

1. Go to **Settings > Configuration > Warehouse**.
2. Select **Create warehouse**.
3. On the **Information** step, fill in the fields below, then select **Next**.
4. On the **Settings** step, choose units, default locations, mandatory reasons and mobile settings.
5. Select **Create warehouse**.

| Field | What it does | Required |
| --- | --- | --- |
| **Code** | Short warehouse code shown on labels and reports, in capitals. Up to 20 characters. | Yes |
| **Name** | Full name of the warehouse. | Yes |
| **Prefix** | Short tag added to codes generated in this warehouse. Up to 8 characters. | Yes |
| **Type** | **Internal** or **External**. | Yes |
| **Address line 1**, **City**, **Postal code**, **Country** | Ship-from address for carrier rating and labels. | Yes |
| **Contact name**, **Contact phone number** | Who to call at the warehouse. | Yes |
| **Email** | Contact email. | No |
| **Day shift** start and end, **AM / PM** | Used by the dashboard and end-of-day cut-offs. | Yes |
| **Timezone** | Decides what "today" means for this warehouse. | Yes |
| **Default dimension unit**, **Default weight unit** | Units used when no unit is given. | No |
| **Use LP dimensions for volumetric putaway** | Putaway suggestions check the LP's volume against the location's free volume. | No |
| **Create starter locations and use them as defaults** | Adds four starter locations made from the prefix: `-RECV`, `-PACK`, `-SHIP` and `-RET`, and uses them as the default receiving, ship and return locations. | No |
| **Adjustment reason required** | Every inventory adjustment needs a reason. | No |
| **Count difference reason required** | Every count update needs a reason. | No |
| **Auto logout inactive mobile users**, **Inactivity timeout (minutes)** | Signs handheld users out after inactivity. | No |

> **Tip:** Turn on **Create starter locations and use them as defaults**. Without a default receiving location, **Receive PO** cannot run. If you skip it, set **Default receiving location** later from **Edit**.

## Step 2: Add storage locations

1. Go to **Settings > Master Data > Locations**.
2. Select **Create location** for one location, or **Generate locations** for a whole aisle.
3. Or import them from Excel with **Import > Bulk import locations**.

See [Manage locations](/docs/wms/locations), [Create a location](/docs/wms/create-location) and [Generate a rack layout](/docs/wms/generate-locations).

## Step 3: Add your first client

Products, purchase orders and orders belong to a client. Go to **Settings > Client Setup > Clients** and add the company you fulfill for. Client setup is covered in the client pages of the [KitStak WMS docs](/docs/wms).

## Step 4: Build the product catalog

1. Go to **Settings > Master Data > Products**.
2. Select **Create new product**, or use **Bulk import/update > Products** to load many at once.

See [Create a product](/docs/wms/create-product).

## Step 5: Receive your first stock

1. Create a vendor for the client and a purchase order. See [Create a purchase order](/docs/wms/create-purchase-order).
2. Receive it. See [Receive a purchase order](/docs/wms/receive-purchase-order).
3. Put the stock away. See [Put away received stock](/docs/wms/putaway).

If you already have stock on the shelves, load it with **Inventory > Inventory by Location > Import** instead. See [Import data from Excel](/docs/wms/excel-imports).

## The Get set up checklist

The dashboard shows a **Get set up** panel on new installs. It has five steps:

| Step | Button | Unlocks after |
| --- | --- | --- |
| **Create your warehouse** | **Add warehouse** | Nothing |
| **Add storage locations** | **Add locations** | **Create your warehouse** |
| **Add your first client** | **Add client** | **Create your warehouse** |
| **Build your product catalog** | **Add products**, or **Import from a spreadsheet** | **Add your first client** |
| **Create your first order** | **Create order** | **Build your product catalog** |

- A step shows **Done · detected** as soon as the data exists, even if you created it somewhere else.
- A locked step reads **Unlocks after** and the step it waits for.
- Users who can manage company settings can **Skip** a step and **Undo skip**. Skipping a step unlocks the steps after it.
- If you cannot open a step's page, its button is disabled and says you need permission.

## Related pages

- [Use the dashboard](/docs/wms/dashboard)
- [Import data from Excel](/docs/wms/excel-imports)
- [KitStak WMS overview](/docs/wms/overview)
