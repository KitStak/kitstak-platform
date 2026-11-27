---
title: Invoices and billing activity
description: Find every invoice with its PDF, read what each status means, and see a full log of payments, plan changes and billing emails you can download.
section: Billing and plans
order: 70
---

Every bill KitStak sends is kept on **Billing > Invoices**, each with a PDF for your books. **Billing > Activity** is the full log of what happened to your plan: who did it, when, and what changed. Owners, admins and billing managers can open both.

## Find an invoice

1. Open **Account menu > Billing** and select the **Invoices** tab.
2. The page reads **Every bill and receipt, newest first. Each one has a PDF you can save or send to your books.**
3. Select an invoice date to see it on screen, or select its PDF link to download it.

| Column | Meaning |
| --- | --- |
| **Date** | When the invoice was made. |
| **Number** | The invoice number, or **Pending** until it has one. |
| **For** | For example **Monthly plan**, **Yearly plan**, **Monthly plan, first payment** or **Plan change**. |
| **Amount** | The total. |
| **Status** | See the table below. |

The newest invoices also show on the Billing overview, with **See all invoices**. If you have none yet, the page says **No invoices yet.** and **Your first one arrives with your first payment.**

### Invoice status

| Status | Meaning |
| --- | --- |
| **Paid** | The invoice was paid. |
| **Due** | The invoice is not paid yet. Go to Billing to pay it or to update your card. |
| **Void** | The invoice was canceled. Nothing is owed on it. |
| **Not collected** | The invoice was closed without payment. |
| **Credit** | A credit for a plan change. Nothing was charged. It comes off your next bills. |

## Read an invoice

The invoice page has:

- **From** and **Billed to**, with your company, address and tax ID from billing details.
- **Date** and **Your plan**.
- A line for each charge, with **What**, **Count**, **Each** and **Amount**.
- **Subtotal**, **Sales tax** when it applies, and **Total**.
- **Paid** with the date and card, or **Still due**. A refund shows as **Sent back to your card**, and credit as **Added to your credit**.

If **Billed to** has no address or tax ID, the page says **An owner or a billing manager can add an address and a tax ID in Billing details.** Changes to billing details apply from your next invoice. See [Billing team and billing details](/docs/getting-started/billing-team-and-details).

A receipt email goes out for every payment, to the billing email and to every owner and billing manager.

## See billing activity

1. Open **Account menu > Billing** and select the **Activity** tab.
2. The page reads **Everything that happened to your plan, newest first. Who did it, when, and what changed.**
3. Rows are grouped by day, with **Today**, **Yesterday** or the date.
4. Each row is one plain sentence, the time, and who did it: a person, or KitStak for automatic events. A payment row links to its invoice.

### Filter the list

| Filter | Shows |
| --- | --- |
| **All** | Everything. |
| **Payments** | Payments, failed tries and card changes. |
| **Plan changes** | Trials, plan changes, pauses and cancels. |
| **Emails** | Every billing email KitStak sent. |

Each filter shows its count.

### Download the activity

Select **Download CSV**. The file holds the rows of the filter you are on, with these columns:

```
When (UTC),Kind,Who,What happened
```

Only owners, admins and billing managers of the current organization can download it, and it holds only that organization's rows.

## Related pages

- [Billing overview](/docs/getting-started/billing-overview)
- [Billing team and billing details](/docs/getting-started/billing-team-and-details)
- [Export and delete your data](/docs/getting-started/export-and-delete-data)
