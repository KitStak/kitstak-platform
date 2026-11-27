---
title: How 3PL billing works
description: The parts of KitStak 3PL billing: billing forms, fees, billing periods, the hourly scheduler, bills, approval and VAS operations, and who can do what.
section: Billing
order: 10
---

KitStak bills each client for the work your warehouse did for it. You describe the client's rates once on a billing form, and KitStak counts the client's real activity in each billing period, prices it and writes a bill. Nothing is typed into an invoice by hand: receipts, storage, picks, packs, shipments, returns, work orders and logged services all come from what happened on the floor.

## The parts

| Part | What it is | Where |
| --- | --- | --- |
| Billing form | One client's rates for one warehouse, with a start date and a billing period. Also called a contract. | **Settings > Client Setup > 3PL Billing** |
| Fee | One rate on a billing form, for one operation type, such as receiving per unit or storage per LP. | Inside the billing form |
| Billing period | Monthly, weekly, daily, every 2 months, twice a month or every 2 weeks, counted from the start date. | On the billing form |
| Bill | The result of one calculation: one bill per billing form and period, with consolidated and detailed lines. | **Settings > Client Setup > Billing Report** |
| VAS operation | A value-added service you log by hand, such as relabeling, billed by a VAS fee. | **Settings > Client Setup > VAS Operations** |

The three pages share the tabs **3PL Billing**, **Billing Report** and **VAS Operations**.

## The flow

1. Create a billing form for the client and warehouse. See [Create a billing form](/docs/wms/billing-create-a-billing-form).
2. Add its fees. See [Add fees to a billing form](/docs/wms/billing-fees).
3. **Approve** the billing form. Its fees lock and the scheduler starts billing it.
4. Every hour, the scheduler bills each approved billing form whose period has closed and has no bill for that period yet.
5. Review the draft bill in **Billing Report**, then approve it to lock it for invoicing. See [Calculate, review and approve bills](/docs/wms/billing-calculate-and-approve-bills).

You can also select **Calculate** at any time to bill the last closed period, the current period to date, or a custom date range.

## What each operation type counts

| Operation type | Activity counted |
| --- | --- |
| **Receiving** | Received units, LPs, POs and lines. |
| **Storage** | Inventory held, from the daily inventory snapshots. |
| **Pick & Pack** | Completed picking and packing tasks. |
| **Shipment** | Shipped orders, labels, LPs and packages. Voided labels are left out. |
| **Return** | Received returns (RMAs). |
| **Work Order** | Completed work orders and kits. |
| **VAS** | Value-added services logged as VAS operations. |
| **Recurring** | A flat charge once per billing period. |

Only the client's activity in the billing form's warehouse counts.

## Permissions

| Page | Actions |
| --- | --- |
| **3PL Billing** | **View**, **Create**, **Edit**, **Delete**, **Change Log**, **Calculate**, **Copy** |
| **Billing Report** | **View**, **Delete**, **Approve**, **Cancel** |
| **VAS Operations** | **View**, **Create**, **Edit**, **Delete**, **Import File** |

The built-in **Viewer** role can view all three billing pages. The **Warehouse Clerk** role has no billing access. See [Roles and permissions](/docs/wms/role-roles-and-permissions).

## Rules worth knowing first

- Only one billing form per client and warehouse can be approved at a time. A second one would bill the same activity twice.
- Fees can't change while a billing form is approved. Select **Cancel approval** first.
- A client that is deactivated has automatic billing paused for its approved billing forms.
- Every change to a billing form, fee or bill is in its change log.

## Related

- [Fee pricing: per unit, from quantity, tier base and graduated](/docs/wms/billing-pricing-and-tiers)
- [Storage fees: daily, peak, average and split month](/docs/wms/billing-storage-fees)
- [Log value-added services (VAS)](/docs/wms/billing-vas-operations)
