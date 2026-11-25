---
title: "Storage fees: daily, peak, average and split month"
description: Bill storage by daily accumulation, peak, period end, distinct count or average from nightly snapshots, or split the month with standard and alternate rates.
section: Billing
order: 50
---

Storage fees bill the inventory a client holds in the warehouse. KitStak takes a snapshot of every inventory bucket each night at 00:02 warehouse time, and a storage fee reads those snapshots for the billing period. The **Fee calculation type** decides how the daily counts become one quantity for the period.

## Before you start

- The billing form must be in **Draft**.
- Snapshots start the night after stock is received. You can see them in the **Inventory Snapshot Report**. See [Inventory reports](/docs/wms/report-inventory-reports).

## Create a storage fee

1. Open the billing form and select **Create fee**.
2. Pick the **Storage** operation type.
3. Choose the **Fee calculation type**.
4. Choose **Fee by**. The list depends on the calculation type.
5. Set the price in **Charges**, or the split month rates.
6. Select **Add fee**.

## Fee calculation types

| Type | Quantity for the period |
| --- | --- |
| **Daily Accumulation** | Every day's on hand count: the sum of each daily snapshot in the period. |
| **At Peak Inventory** | The highest single day count in the period. |
| **At Period End** | The count on the last snapshot of the period. |
| **Distinct Period Count** | Each distinct location, LP or parent LP used at any time in the period, counted once. |
| **Average Calculation** | The average daily count across the period's snapshots. |
| **Split Month Storage** | Standard rate through the split day, alternate rate for first receipts after it. |

## What a storage fee can count

| Fee by | Charge by | Counts |
| --- | --- | --- |
| **Location** | **Location** | Locations holding the client's stock. |
| **LP** | **LP** | License plates holding the client's stock. |
| **Product** | **Product (UOM Quantity)** | Units on hand. |
| **Total Volume** | **Volume** | Volume of the stock. |
| **Parent LP** | **Parent LP** | Parent LPs, such as pallets. |

**Distinct Period Count** only offers **Location**, **LP** and **Parent LP**. **Split Month Storage** only offers **LP**.

### Example

A client holds 40 LPs for 10 days, then 60 LPs for 20 days, in a 30 day period.

| Type | Quantity |
| --- | --- |
| **Daily Accumulation** | 40 x 10 + 60 x 20 = 1,600 LP days |
| **At Peak Inventory** | 60 |
| **At Period End** | 60 |
| **Average Calculation** | 1,600 / 30 = 53.33 |

The quantity is then priced with the fee's charges, for example graduated tiers. See [Fee pricing: per unit, from quantity, tier base and graduated](/docs/wms/billing-pricing-and-tiers).

## Split month storage

Split month storage gives a lower rate to stock that arrives late in a calendar month. You set three values in **Split month settings**:

| Field | What it does | Required |
| --- | --- | --- |
| **Split day of month** | The last calendar day of the month that uses the standard rate. 1 to 28. New fees start at 15. | Yes |
| **Standard storage rate** | Applies to first receipts through the split day and to recurring monthly storage. | Yes |
| **Alternate storage rate** | Applies only to first receipts after the split day through the end of the calendar month. | Yes |

LPs already on hand at the start of the period bill at the standard rate. LPs first received after the split day bill at the alternate rate. At least one of the two rates must be greater than 0.

### Example

Split day 15, standard rate 12.00 per LP, alternate rate 6.00 per LP. In March, 50 LPs carried over from February, 20 LPs arrived on March 8 and 10 LPs arrived on March 22.

- 70 LPs bill at 12.00: the 50 carried over and the 20 received by the 15th.
- 10 LPs bill at 6.00: received after the 15th.

## Conditions on storage fees

A storage fee can be limited with conditions on **Location**, **LP** and **Product** attributes and their custom fields, for example only locations in one zone or only hazardous products. See [Charge if conditions](/docs/wms/billing-charge-if-conditions).

## Related

- [Add fees to a billing form](/docs/wms/billing-fees)
- [Calculate, review and approve bills](/docs/wms/billing-calculate-and-approve-bills)
- [Inventory reports](/docs/wms/report-inventory-reports)
