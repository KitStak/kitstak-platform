---
title: Manage warehouses
description: Create a warehouse with its code, prefix, ship from address, day shift and time zone, set default locations and units, and choose the default warehouse.
section: Settings and admin
order: 50
---

A warehouse is a building you run in KitStak WMS. Every location, stock bucket, order, purchase order, job and carrier setup belongs to one warehouse, and users only see the warehouses they are given. The warehouse address is the ship from address for carrier rates and labels, and its time zone sets the day for reports, snapshots and billing.

## Before you start

- You need the **Warehouse** page in your role with **Create** or **Edit**.
- Each warehouse is part of your plan. When you are at the plan's limit, **Create warehouse** first shows **This warehouse is not in your plan yet** with **Add to my plan**. See [Getting started](/docs/getting-started).

## Create a warehouse

1. Go to **Settings > Configuration > Warehouse** and select **Create warehouse**.
2. Fill in the **Information** step and select **Next**.
3. Fill in the **Settings** step.
4. Select **Create warehouse**.

## Information step

| Field | What it does | Required |
| --- | --- | --- |
| **Code** | Up to 20 letters, numbers, dash or underscore, such as `EAST1`. Changing it later updates every label and report that shows it. | Yes |
| **Name** | Up to 120 characters. | Yes |
| **Prefix** | Up to 8 letters and numbers. A short tag added to codes generated in this warehouse. | Yes |
| **Type** | **Internal** or **External**. | Yes |
| **Address line 1**, **Address line 2** | The street address. | Line 1 |
| **City**, **Postal code** | A US postal code must be `12345` or `12345-6789`; a Canadian one `A1A 1A1`. | Yes |
| **State** or **Province** | Picked from the list for the US and Canada. | Yes |
| **Country** | Ship from address for carrier rating and labels. | Yes |
| **Contact name** | Up to 120 characters. | Yes |
| **Contact phone number** | International format such as `+15551234567`, or national format. 7 to 15 digits. | Yes |
| Day shift **Start time**, **End time** | In `hh:mm` with **AM / PM**. Used by the dashboard and end of day cut offs. Start and end must differ. | Yes |
| **Timezone** | The warehouse time zone. | Yes |

## Settings step

| Field | What it does |
| --- | --- |
| **Default dimension unit**, **Default weight unit** | Units used in this warehouse. |
| **Use LP dimensions for volumetric putaway** | Putaway suggestions check the LP's volume against the location's free volume. |
| **Create starter locations and use them as defaults** | Creates receiving, packing, ship and return locations named from the prefix, such as `EAST1-RECV`, `EAST1-PACK`, `EAST1-SHIP` and `EAST1-RET`, and sets them as defaults. New warehouses only. |
| **Default receiving location**, **Default ship location**, **Default return location** | Pre-filled when receiving, shipping and processing returns. Only locations of the matching area type are listed. |
| **Adjustment reason required** | Inventory adjustments must pick a reason. |
| **Count difference reason required** | Count updates with a difference must pick a reason. |
| **Auto logout inactive mobile users** | Signs mobile users out after the **Inactivity timeout (minutes)**, 1 to 720. |

When the warehouse is created, the message names its starter locations, or says to add locations next.

## The Warehouse list

| Column | What it shows |
| --- | --- |
| **Code**, **Name** | The warehouse. |
| **Address** | A warning icon shows when the stored address needs fixing. |
| **Contact**, **Type** | Contact and type. |
| **Default** | The default warehouse. |
| **Status** | **Active** or **Inactive**. |
| **Locations**, **Timezone**, **Created date** | Details. |

**Show details** shows units on hand, open work, the information and settings, and counts of open orders and purchase orders. **Export As Excel** exports the list.

## Set the default warehouse

Select **Set as default** in the row menu and confirm with **Yes, change default**. The message offers **Undo** for a few seconds.

## Deactivate a warehouse

Select **Deactivate** and confirm with **Yes, deactivate**. Inactive warehouses disappear from the warehouse switcher and can't receive new work. You can't deactivate:

- The default warehouse: **Make another warehouse the default first**.
- A warehouse with open orders, POs or jobs: finish or cancel them first.

**Activate** brings it back. Its locations reopen for putaway and picking.

## Related

- [Add and manage users](/docs/wms/user-manage-users)
- [Connect a carrier account](/docs/wms/carrier-connect-a-carrier)
- [Company settings and security](/docs/wms/settings-company-and-security)
