---
title: Build workflows and test them against an order
description: Create workflows that act on shipment orders when they are created, imported, updated or shipped, and test each one against a real order before it goes live.
section: Automation
order: 40
---

A workflow watches for an event, checks conditions and runs actions. For example: when a shipment order is created and its address line contains "PO Box", block the order and notify the team. Workflows run top to bottom for each trigger. Before you activate one, you can test it against a real order and see exactly what it would change, with nothing saved.

## Before you start

- You need the Workflows view permission, and edit permission to build workflows.
- Blocked orders wait for someone with permission to edit shipment orders to release them.

## Triggers

| Trigger | When it fires |
| --- | --- |
| **Shipment Order Created** | Any new order: created in the app, through the API, downloaded from a channel or imported. |
| **Shipment Order Imported** | Only orders downloaded from a sales channel or imported from Excel or CSV. Runs before Created workflows. |
| **Shipment Order Updated** | An open order's header or lines are edited. |
| **Purchase Order Created** | A purchase order is created in the app, through the API or by import. |
| **Order Shipped** | Ship confirm marks an order Shipped or Partially Shipped. |

## Actions

| Action | What it does |
| --- | --- |
| **Block Order** | Stops allocation until someone releases it. Optional reason shown to the team. |
| **Partially Block Order** | Flags the order for review; it can still allocate. |
| **Set Carrier Service** | Assigns a specific carrier service and clears any preset. |
| **Set Rate Shopping Preset** | Rate-shops at label time with a preset of the order's client. |
| **Set Priority** | Changes the order priority used by waves and jobs. |
| **Add Tag** | Adds a tag; it is created if it doesn't exist. |
| **Set Warehouse** | Moves the open order to another warehouse. |
| **Set Shipment Package** | Pre-selects the box packers should use. |
| **Set Order Type** | Sets the Data Setup order type. |
| **Add Note** | Appends text to the order note. |
| **Notify Users** | Sends an in-app notification with a link to the order. |

**Purchase Order Created** workflows can only use **Notify Users**. **Order Shipped** workflows can only use **Add Tag** and **Notify Users**.

## Create a workflow

1. Go to **Automation > Workflows**.
2. Select **Create Workflow**.
3. Under **When**, fill in the fields below.
4. Add conditions. Choose **Match all** or **Match any**, then select **Add condition**. Add a group for a nested condition, for example Country is US AND (Carrier is UPS OR Carrier is FedEx).
5. Under **Then**, select **Add action** and fill in each action's fields. Actions run in the order shown; drag to reorder.
6. Test the workflow (see below).
7. Select **Save**.

| Field | What it does | Required |
| --- | --- | --- |
| Name | For example "Block PO box addresses". Up to 80 characters. | Yes |
| **Trigger** | The event that runs the workflow. | Yes |
| **Description** | Why the workflow exists, so the team knows when to release its orders. Up to 500 characters. | No |
| **Warehouse** | Limits the workflow to one warehouse. Empty means all warehouses. | No |
| **Client** | Limits it to one client. Empty means all clients. | No |
| **Active** | Only active workflows run. | No |
| **Stop processing** | When this workflow matches, later workflows are skipped. | No |

A workflow needs at least one action, up to 20, and up to 50 conditions. If an active workflow has no conditions and no warehouse or client, KitStak warns "This workflow will change every order in every warehouse" before you save.

## Test against an order

1. In the **Test against order** panel, search by order code, customer or address and pick an order. **Order Shipped** workflows test against a shipped order, and purchase order workflows against a purchase order.
2. Select **Run test**.

The test runs the unsaved workflow on the real order and rolls everything back. The result shows:

- Whether the order **matches** or **doesn't match**, and **Blocked** with the block type when it would be blocked.
- Each condition with a pass or fail mark.
- Each action as **Applied** or **Skipped**, with the field changes it would make.

## Set the sequence

Select **Change sequence** on the workflow list, drag workflows into the order they should run, and select **Save sequence**. A workflow with **Stop processing** ends the chain when it matches.

## Follow and release blocked orders

- The order page shows **Fully blocked by workflow** or **Partially blocked by workflow** with the workflow name. Select **Release** to clear it.
- **Integrations > Workflow Blocked Shipment Orders** lists every blocked order.
- The workflow's **Run history** tab shows each run with **Run date**, **Order**, **Matched**, **Actions applied**, **Block** and **Notes**.

## Related pages

- [Outbound order lifecycle and statuses](/docs/wms/outbound-order-lifecycle)
- [Rate shopping presets](/docs/wms/automation-rate-shopping-presets)
- [Allocation algorithms and dry run](/docs/wms/allocation-algorithms)
