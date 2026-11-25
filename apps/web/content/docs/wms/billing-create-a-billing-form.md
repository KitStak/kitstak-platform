---
title: Create a billing form
description: Set up a client's 3PL billing form with its warehouse, start date and billing period, then approve, duplicate, print or delete it.
section: Billing
order: 20
---

A billing form holds one client's rates for one warehouse. It has a name, a calculation start date and a billing period, and it carries the fees KitStak uses to price the client's activity. KitStak calls it a contract in some messages; it is the same thing.

## Before you start

- You need the **Create** action on **3PL Billing**.
- The client must be active. Inactive clients are not listed.
- The bill currency is the client's currency. See [Client operational settings](/docs/wms/client-settings).

## Create a billing form

1. Go to **Settings > Client Setup > 3PL Billing** and select **Create billing form**.
2. Enter the **Billing form name**, for example `Harbor Lane Goods 3PL services`.
3. Choose the **Client** and the **Warehouse**.
4. Pick the **Calc. start date**. The first billing period starts on this day.
5. Choose the **Billing frequency**.
6. Select **Create and add fees**. The billing form opens so you can add its fees.

You can also start from a client: open the client and select **Create billing form**.

## Fields

| Field | What it does | Required |
| --- | --- | --- |
| **Billing form name** | Up to 100 characters. Two billing forms of the same client can't share a name. | Yes |
| **Client** | Only active clients are listed. | Yes |
| **Warehouse** | Only this warehouse's activity is billed. You must have access to it. | Yes |
| **Calc. start date** | The first billing period starts on this day. Later periods follow from it. | Yes |
| **Billing frequency** | **Monthly**, **Weekly**, **Daily**, **Every 2 months**, **Twice a month** or **Every 2 weeks**. | Yes |

**Twice a month** periods run from the 1st to the 15th and from the 16th to the end of the month. The other frequencies step forward from the start date, so a monthly form that starts on the 10th bills the 10th to the 9th.

> **Important:** Client, warehouse, start date and frequency lock once the billing form has a bill that was not canceled. The fields then show **Locked: this contract already has bills**.

## The billing form page

The header shows the billing form name, its approval status (**Draft** or **Approved**), the client, warehouse and currency. Select the pencil to open **Edit billing form** and change the name or, while there are no bills, the other fields.

| Item | What it shows |
| --- | --- |
| **Calc. start date** | The start date. |
| **Billing period** | The frequency. |
| **Next auto-run** | When the scheduler bills next and which period. **Off until approved** for a draft. |
| **Last calculation** | When it was last calculated, or **Never**. |
| **Fees** | The number of fees. |
| **Last bill** | The last bill number and total. Select it to open the bill. |

Below are the fees, a **Summary** table of every fee and the recent bills. **Open in Billing Report** lists every bill of this form. **Print** opens a printable summary of the billing form and its fees. **Show change log** opens its history.

## Approve a billing form

1. Add at least one fee.
2. Select **Approve**, then **Yes**.

Once approved:

- The fees lock. **Create fee**, **Edit** and **Delete** on fees show **Cancel the approval before changing fees**.
- The scheduler checks every hour and bills the form at each period end.

To change fees, select **Cancel approval**. The form goes back to **Draft** and stops billing automatically until you approve it again.

Only one billing form per client and warehouse can be approved. If another one already is, KitStak refuses with a message that names it and says to cancel that approval first.

## The 3PL Billing list

| Column | What it shows |
| --- | --- |
| **Billing name** | Select it to open the form. |
| **Client**, **Warehouse** | Who and where. |
| **Approval status** | **Draft** or **Approved**. |
| **Start date**, **Period** | Calc. start date and frequency. |
| **Fees**, **Bills** | How many of each. |
| **Last calculation**, **Next period** | Last run and the next period start. |
| **Created by**, **Create date** | Who created it and when. |

Select rows to use **Duplicate**, **Calculate**, **Approve**, **Cancel approval** or **Delete** on many forms at once. **Export As Excel** exports the list.

## Duplicate a billing form

Select **Duplicate billing form** in **More actions**, or **Duplicate** on the list. The copy keeps every fee, tier and condition and starts as **Draft**. If the original is approved, cancel its approval before approving the copy. You need the **Copy** action on **3PL Billing**.

## Delete a billing form

Select **Delete billing form** in **More actions**. You can't delete:

- An approved form: **Cancel the approval first**.
- A form that has bills: **Contracts with bills can't be deleted**.

## Related

- [Add fees to a billing form](/docs/wms/billing-fees)
- [Calculate, review and approve bills](/docs/wms/billing-calculate-and-approve-bills)
- [How 3PL billing works](/docs/wms/billing-overview)
