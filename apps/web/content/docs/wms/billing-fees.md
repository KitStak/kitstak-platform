---
title: Add fees to a billing form
description: Create receiving, storage, pick and pack, shipment, return, work order, VAS and recurring fees, choosing what each fee counts and how it is charged.
section: Billing
order: 30
---

A fee is one rate on a billing form. You choose the operation type it charges, what it counts (**Fee by**), the unit it charges per (**Charge by**) and its price. A billing form can have as many fees as you need, for example one receiving fee per unit, one storage fee per LP and one recurring account fee.

## Before you start

- You need the **Edit** action on **3PL Billing**.
- The billing form must be in **Draft**. On an approved form, select **Cancel approval** first.
- For a VAS fee, the VAS type must exist. See [Log value-added services (VAS)](/docs/wms/billing-vas-operations).

## Create a fee

1. Open the billing form from **Settings > Client Setup > 3PL Billing**.
2. In **Fees**, select **Create fee**.
3. Under **Operation type**, pick one of the eight cards. No operation is preselected.
4. In **Fee**, enter the **Fee name**. KitStak suggests one, such as `Receiving fee` or `Monthly account fee`.
5. Choose **Fee by**, then **Charge by**. For **Storage**, choose the **Fee calculation type** first.
6. Set the price in **Charges**. See [Fee pricing: per unit, from quantity, tier base and graduated](/docs/wms/billing-pricing-and-tiers).
7. Optionally turn on a minimum or maximum price, and add conditions.
8. Select **Add fee**.

To change a fee, open its menu and select **Edit**, then **Save fee**. Deleting a fee removes it from the form; existing bills keep their lines.

## Fee fields

| Field | What it does | Required |
| --- | --- | --- |
| **Fee name** | Up to 100 characters. Two fees on one form can't share a name. | Yes |
| **Operation type** | **Receiving**, **Storage**, **Pick & Pack**, **Shipment**, **Return**, **Work Order**, **VAS** or **Recurring**. | Yes |
| **Fee calculation type** | Storage only: how stored inventory is counted across the period. | Storage only |
| **Fee by** | What the fee counts. The list depends on the operation type. | Yes |
| **Charge by** | The unit the price applies to. The list depends on **Fee by**. | Yes |
| **VAS type** | VAS only: logged VAS operations of this type are billed. | VAS only |
| **Charges** | The rate or tiers. | Yes |
| **Use minimum price** | Bill at least this amount for the period. | No |
| **Use maximum price** | Never bill more than this amount for the period. | No |
| **Conditions** | Only charge activity that matches every condition. | No |
| **Charge one time** | Recurring only: bill on the next calculation only. | No |

## Fee by and Charge by

| Operation type | Fee by | Charge by |
| --- | --- | --- |
| **Receiving** | **Per Product** | **Product (UOM Quantity)** or **Product (Pack Quantity)** |
| **Receiving** | **Per LP**, **Per PO**, **Per SKU**, **Per Volume**, **Per Receiving Line** | **LP**, **PO**, **SKU**, **Volume**, **Receiving Line** |
| **Storage** | **Location**, **LP**, **Product**, **Total Volume**, **Parent LP** | **Location**, **LP**, **Product (UOM Quantity)**, **Volume**, **Parent LP** |
| **Pick & Pack** | **Per Picking** or **Per Packing** | **Product (UOM Quantity)**, **Product (Pack Quantity)**, **SO** or **SKU** |
| **Shipment** | **Per SO**, **Per Label**, **Per LP**, **Shipment Package** | **SO**, **Label**, **LP**, **Shipment Package** |
| **Shipment** | **Per Product** | **Product (UOM Quantity)**, **Product (Pack Quantity)**, **SKU**, **Kit (UOM Quantity)** or **Component (UOM Quantity)** |
| **Return** | **Per RMA**, **Per SO**, **Per Product**, **Per SKU** | **RMA**, **SO**, **Product (UOM Quantity)**, **SKU** |
| **Work Order** | **Per WorkOrder**, **Per Kit**, **Per Component** | **Work Order**, **Kit (UOM Quantity)**, **Component (UOM Quantity)** |
| **VAS** | **Operation** | **Operation Value** |
| **Recurring** | **Recurring** | **Recurring** |

Where one **Fee by** maps to one **Charge by**, they pair in the order listed, so **Per LP** charges by **LP**. UOM quantity counts base units; pack quantity counts packs. A **Kit** charge counts kits shipped as the parent product; a **Component** charge counts the lines exploded from a kit.

## Recurring fees

A recurring fee charges a flat amount once per billing period, such as an account or system fee. Turn on **Charge one time** for a setup or onboarding fee: it bills on the next calculation only, and later periods skip it once a successful bill includes it. The fee card shows a **One-time** badge. **Charge one time** is only allowed on **Recurring** fees.

## Minimum and maximum price

Both adjust the fee's total for the period, not each line.

- With **Use minimum price** on, a period total below the **Minimum price** is raised to it.
- With **Use maximum price** on, a period total above the **Maximum price** is lowered to it.
- When both are on, the maximum must be at least the minimum.

The bill shows the change in a **Min/max adj.** column, so the client sees the activity price and the adjustment apart.

## Validation messages

| Message | Meaning |
| --- | --- |
| **Select an operation type** | Pick an operation card. |
| **Choose a Fee By for this operation** | The **Fee by** doesn't belong to the operation type. |
| **Choose a Charge By for this Fee By** | The **Charge by** doesn't belong to the **Fee by**. |
| **Choose the VAS type this fee charges** | VAS fees need a VAS type. |
| **Enter the minimum price** or **Enter the maximum price** | The switch is on but the amount is empty. |
| **Enter a rate greater than 0** | Every rate is zero. |

When you switch the operation type, conditions that don't apply to the new type are removed and KitStak tells you so.

## Related

- [Storage fees: daily, peak, average and split month](/docs/wms/billing-storage-fees)
- [Charge if conditions](/docs/wms/billing-charge-if-conditions)
- [Create a billing form](/docs/wms/billing-create-a-billing-form)
