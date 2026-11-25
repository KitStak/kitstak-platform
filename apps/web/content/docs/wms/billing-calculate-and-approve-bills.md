---
title: Calculate, review and approve bills
description: Let the hourly scheduler bill each closed period or calculate by hand, then review consolidated and detailed lines, approve, cancel, print and export bills.
section: Billing
order: 70
---

A bill is the result of one calculation of a billing form for one period. KitStak counts the client's activity in that period, applies each fee's conditions, prices and minimum or maximum, and writes one bill with consolidated lines per fee and range and detailed lines per activity. Bills start as **Draft**. Approving a bill locks it for invoicing.

## Before you start

- Calculating needs the **Calculate** action on **3PL Billing**.
- Approving, editing info and exporting need **Approve** on **Billing Report**. Canceling needs **Cancel**, deleting needs **Delete**.
- The billing form needs at least one fee.

## Automatic calculation

Every hour, the scheduler bills each approved billing form whose period has closed and that has no bill for that period yet. Bills it writes show **Scheduler** as **Created by**. It skips billing forms of inactive clients.

To check it, go to **Settings > Client Setup > Billing Report** and select **Automatic calculation**. The drawer shows **Schedule**, **Next check**, **Last run**, **Last result** and a **Job history** of the bills each run wrote, by day.

## Calculate by hand

1. Open the billing form and select **Calculate**, or select one or more forms on the **3PL Billing** list and select **Calculate**.
2. Choose the period. The choices are in the table below.
3. Read the preview. It shows the exact range each form will bill, in warehouse time.
4. Select **Calculate**. When a draft bill already covers the range, tick the confirmation and select **Replace and calculate**.

| Period choice | What it bills |
| --- | --- |
| **Last closed period** | The most recent full period before today, the same one the scheduler bills. |
| **Current period to date** | From the start of the open period through today, as a preview bill. |
| **Custom date range** | Any **Start date** and **End date** inside the contract, such as a mid month termination. |

When it finishes, the dialog lists each bill with its number and total, and the message offers **View bill**.

### When a calculation is blocked

| Message | What to do |
| --- | --- |
| No closed period yet, with the first period's dates | The first period hasn't ended. Use **Current period to date**. |
| The form starts on a later date | Pick a range on or after the **Calc. start date**. |
| The period starts after today | Pick an earlier range. |
| An approved bill already covers the range | Cancel that bill first to bill the period again. |
| The form has no fees | Add at least one fee. |

### Replacing a draft

Recalculating the exact same period updates the draft in place, so it keeps its bill number. Any other draft that overlaps the range is canceled and named in the result as **Replaced draft bill** with its number. A failed bill for the same period is replaced by the new run.

## The Billing Report list

| Column | What it shows |
| --- | --- |
| **Name** | The billing form. |
| **Billing number** | Bill number: the date as YYMMDD followed by a 10 digit sequence. |
| **Calc. status** | **Successful** or **Failed**. Hover a failed one for the error. |
| **Client**, **Warehouse** | Who and where. |
| **Calculation date**, **Created by** | When and by whom. |
| **Period**, **Period end**, **Billing frequency** | The billed range. |
| **Bill status** | **Draft**, **Approved** or **Canceled**. **Outdated** shows when the activity changed after calculation. |
| **Price** | The bill total. |
| **Exported to integration** | Whether the bill was exported. |

Select bills to **Approve**, **Export to accounting**, **Cancel** or **Delete** them in bulk. Each row has **View**, **Edit info**, **Change log** and **Delete**.

## Review a bill

Open a bill to see its header, its facts (**Period**, **Billing frequency**, **Calculated**, **Created by**, **Exported to integration**) and two tabs.

| Tab | Columns |
| --- | --- |
| **Consolidated** | Fee name, Operation, Fee by, Charge by, From qty, To qty, Quantity, Unit price, Total price, **Min/max adj.**, Adjusted price |
| **Detailed** | Fee name, Operation, Fee by, Billing frequency, Activity date, Reference, SKU, LP / tracking, Charge by, Qty, Unit price, Total, Adjusted, Integration, Note |

Each tab has **Print** and **Export As Excel**. The files are named after the bill, such as `bill-2611010000000042-consolidated.xlsx`. Fees with no billable activity in the period are listed under the consolidated lines.

When a VAS operation inside a draft bill's period is added or changed after calculation, the bill shows **This draft no longer matches its activity**. Calculate the period again to include it.

A failed bill shows **This calculation failed** with the reason. Select **Recalculate** to open the billing form, fix it and calculate again. A failed bill can't be approved.

## Approve, cancel or delete a bill

| Action | Allowed from | Effect |
| --- | --- | --- |
| **Approve** | **Draft**, calculated successfully | Locks the bill. It can't be deleted and the VAS operations in its period lock. |
| **Cancel bill** | **Draft** or **Approved** | Final. Calculate the period again to replace it. |
| **Delete** | **Draft** only | Removes the draft and its lines. |

Approving a bill whose period hasn't ended asks you to confirm with **Approve anyway**. Approving early locks the period's VAS operations and blocks the period end run, so activity after today won't be billed.

**Edit info** changes the **Bill number** and **Bill status**. Two bills can't share a number: **Another bill already uses this number**. An approved bill can go back to **Draft**. Canceled bills are final.

## Export to accounting

On an approved bill, select **Export to accounting**. KitStak marks the bill as exported: **Exported to integration** reads **Yes · lines Sent**. Draft, canceled and already exported bills are skipped.

## Related

- [Create a billing form](/docs/wms/billing-create-a-billing-form)
- [Log value-added services (VAS)](/docs/wms/billing-vas-operations)
- [How 3PL billing works](/docs/wms/billing-overview)
