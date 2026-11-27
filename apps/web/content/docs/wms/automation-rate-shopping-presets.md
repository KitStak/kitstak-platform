---
title: Rate shopping presets
description: Create rate shopping presets that pick the cheapest, fastest, or cheapest-in-time carrier service when a label is bought, and assign them to orders.
section: Automation
order: 50
---

A rate shopping preset tells KitStak how to choose a carrier service when it buys a label. Instead of a fixed service, the order carries a preset; at label time, KitStak quotes the services in the preset and picks the cheapest, the fastest, or the cheapest that arrives in time. Each preset belongs to one warehouse and one client.

## Before you start

- The client needs access to a carrier setup in **Carrier Integrations** at the warehouse. Otherwise the client list reads "No client has carrier services at this warehouse."
- You need the Rate Shopping view permission, and edit permission to change presets.

## Create a preset

1. Go to **Automation > Rate Shopping**.
2. Select **Create Rate Shopping Preset**.
3. Fill in **General**, **Settings** and **Shipment methods**.
4. Select **Save**.

### General

| Field | What it does | Required |
| --- | --- | --- |
| **RS preset name** | The name shown on orders. | Yes |
| **Warehouse** | Decides which carrier services the preset can compare. Locked after the preset is created. | Yes |
| **Description** | For example "Cheapest ground option for D2C orders". | Yes |
| **Client** | The client whose carrier services are compared. Locked after the preset is created. | Yes |
| **Active** | Inactive presets can't be chosen on orders. | No |

### Settings

Under **Rate calculation method**, choose one:

| Method | What it picks |
| --- | --- |
| **Cheapest** | The cheapest rate among available shipment methods. |
| **Fastest** | The fastest transit time among available shipment options. |
| **Cheapest In Time** | The cheapest rate that arrives within the **Transit time (days)** you enter, at least 1 day. |

Under **Error messages**, tick **Show error message if any shipment method returns an error.** when you want to see carrier errors from the comparison.

### Shipment methods

Keep **Use all available services.** on to compare every service the client has. Turn it off to pick services from the list; search by shipping option and tick at least one row.

## Use a preset

- On the order wizard **Shipping** step, choose it in **Rate shopping preset**.
- In a workflow, add the **Set Rate Shopping Preset** action. See [Build workflows and test them against an order](/docs/wms/workflow-rules).

Labels bought with a preset show **Rate shopping** and the **Rate shopping name** in **Carrier Shipment Details**.

## Edit or delete

The list shows **Preset name**, **Client**, **Warehouse**, **Method**, **Transit**, **Status**, **Options**, **All services**, **Show errors** and **Description**. Use the row menu for **Edit**, **Change log** and **Delete**. Presets set on open orders are skipped when you delete; set them inactive instead.

## Related pages

- [Buy labels and compare rates while packing](/docs/wms/pack-labels-and-rates)
- [Manage carrier labels](/docs/wms/ship-carrier-labels)
