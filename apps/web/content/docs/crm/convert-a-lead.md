---
title: Convert a lead
description: Turn a qualified lead into an account, a contact and an optional deal in one step, reusing matching records instead of creating duplicates.
section: Accounts and pipelines
order: 30
---

When a lead is qualified, convert it. In one step the CRM links or creates the account, links or creates the contact, and can open a deal for the opportunity. The new records are connected to each other, and the lead is marked as converted so nobody converts it twice.

## Before you start

- You need a Leads board, and Accounts and Contacts boards. A Deals board is needed only for the deal step.
- You need edit access to the Leads, Accounts and Contacts boards. Without it, the dialog says **You need edit access to the Leads, Accounts and Contacts boards to convert leads.**

## Convert a lead

1. Open the lead on the Leads board.
2. Select **Convert** in the item panel header.
3. Wait while the dialog checks for existing accounts and contacts. The title reads **Convert** and the lead’s name, with its title, company and email.
4. Work through the three steps, **Account**, **Contact** and **Deal**, with **Next**.
5. Select **Convert lead** on the last step.

A toast confirms **Lead converted** with the contact, account and deal names. The **Lead converted** screen lists each record as **Created** or **Linked existing**, with links to open them. Select **Done** to close.

## Step 1: Account

The dialog looks for accounts that match the lead’s company or email domain.

- Pick a match, shown as **Link to** the account name. A badge says **Recommended** or **Possible match**, with the reason: **Same email**, **Same domain** or **Same name**.
- Or pick **Create a new account** and enter the **Account name** and **Website**. The website is used to match future leads.

If nothing matches, you see **No existing account matches this lead’s company or email domain.**

## Step 2: Contact

The dialog looks for contacts with the lead’s email or name.

- Pick a match, shown as **Merge into** the contact name. Leave **Fill empty fields from the lead** on to copy the email, phone, title and owner where the contact has no value. Nothing is overwritten.
- Or pick **Create a new contact** and check the **Name**, **Email**, **Phone** and **Title**.

If nothing matches, you see **No contact with this email or name exists yet.**

## Step 3: Deal

1. Leave **Create a deal for this opportunity** on, or turn it off to skip the deal.
2. Enter the **Deal name**.
3. Enter the **Amount** in the board’s currency, pick the **Stage** (each shows its probability) and the **Expected close** date.
4. Pick the **Owner**, or **Keep lead owner**.

The deal is linked to the account and the contact. If there is no Deals board you can add to, the dialog says the conversion will create the account and contact only.

## What conversion changes

- The account, contact and deal are linked through their connect columns, in both directions.
- The lead’s status is set to its Done label, **Qualified** on the Leads template.
- The lead moves to the top of the board’s qualified group, if it has one.
- The conversion is recorded on the lead. Opening **Convert** again shows **Already converted**, with the date and links to **Open account** and **Open contact**.

## Rules

| Field | Rule |
| --- | --- |
| **Account name** | Required, up to 255 characters |
| **Name** (contact) | Required, up to 255 characters |
| **Email** | Must be a valid email |
| **Deal name** | Required when a deal is created |
| **Amount** | A number of 0 or more |

## Related pages

- [The CRM boards: leads, deals, accounts, contacts and activities](/docs/crm/crm-boards)
- [Account and contact 360 pages](/docs/crm/account-and-contact-pages)
- [Find and merge duplicate records](/docs/crm/duplicates)
