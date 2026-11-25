---
title: "Fee pricing: per unit, from quantity, tier base and graduated"
description: Price a fee with one rate, a free allowance, or graduated and tier based ranges, and check the result with the live preview before you save.
section: Billing
order: 40
---

Every fee except a split month storage fee is priced in its **Charges** section. You pick one of four pricing modes, enter the rate or the ranges, and KitStak applies it to the fee's total quantity for the billing period. A live preview shows the exact sum for a sample quantity as you type.

## Before you start

- Choose the fee's **Charge by** first. Until then the section reads **Choose Charge by to set prices.**
- The billing form must be in **Draft**.

## The four modes

| Mode | What it does | Ranges |
| --- | --- | --- |
| **For each unit** | One rate for every unit in the period. | One rate |
| **From quantity** | Charges only the units above a threshold. | One threshold and one rate |
| **Tier base** | All units are priced at the rate of the tier the total lands in. | Two or more |
| **Graduated** | Each unit is priced at the rate of the range it falls in. | Two or more |

New fees start on **For each unit**.

## Set a rate

1. In **Charges**, pick the mode.
2. For **For each unit**, enter the **Rate per** unit, for example **Rate per LP**.
3. For **From quantity**, enter **Charge from** the unit number and the rate. Units before that one are free, so `101` charges from the 101st unit.
4. For **Tier base** or **Graduated**, fill in each row's from value, **Up to (incl.)** and **Rate**. Leave the last **Up to (incl.)** empty to mean and up. Select **Add tier** for another row.
5. Type a sample quantity next to **Preview** to see the formula and total.

Rates take up to 4 decimals. Quantities take up to 3 decimals, so volume and weight charges work too. A fee can have up to 20 tiers.

## Worked example

Tiers for a receiving fee charged per unit:

| From | Up to (incl.) | Rate |
| --- | --- | --- |
| 0 | 100 | 0.30 |
| 100 | 500 | 0.25 |
| 500 | and up | 0.20 |

For 650 units in the period:

| Mode | How it prices 650 units | Total |
| --- | --- | --- |
| **Graduated** | 100 x 0.30 + 400 x 0.25 + 150 x 0.20 | 160.00 |
| **Tier base** | 650 lands in 500 and up, so 650 x 0.20 | 130.00 |
| **From quantity**, from unit 101 at 0.25 | 650 minus 100 free = 550 x 0.25 | 137.50 |
| **For each unit** at 0.25 | 650 x 0.25 | 162.50 |

Each range starts where the previous one ends. In the example, the second range bills everything above 100, including fractions such as 100.5, at the second rate. The older whole unit form, 1 to 100 then 101 to 500, is also accepted.

## Rules KitStak enforces

| Message | Meaning |
| --- | --- |
| **Add a rate** | The fee has no rate. |
| **For each unit uses a single rate** | Remove the extra rows. |
| **From quantity uses a single threshold and rate** | Remove the extra rows. |
| **Charge from quantity must be 1 or more** | The threshold is 0. |
| **Charge 2: Up to must be greater than From** | A range ends before it starts. |
| **Charge 2: only the last charge can be open-ended** | Only the last row can leave **Up to (incl.)** empty. |
| **Charge 3: should start at 500 (where charge 2 ends)** | Ranges must be continuous. |
| **Enter a rate greater than 0** | Every rate is zero. |

The numbers in the messages name the row that needs fixing.

## On the bill

Consolidated bill lines show one line per fee and range, with **From qty**, **To qty**, **Quantity**, **Unit price** and **Total price**. A minimum or maximum price then adjusts the fee's period total in **Min/max adj.**. See [Add fees to a billing form](/docs/wms/billing-fees).

## Related

- [Add fees to a billing form](/docs/wms/billing-fees)
- [Storage fees: daily, peak, average and split month](/docs/wms/billing-storage-fees)
- [Calculate, review and approve bills](/docs/wms/billing-calculate-and-approve-bills)
