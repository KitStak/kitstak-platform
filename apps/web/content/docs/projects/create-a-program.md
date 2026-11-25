---
title: Create a program
description: Set up a program with the guided wizard or Quick setup: basics, variants, a price card, an optional schedule, people and links. Drafts save as you go.
section: Programs
order: 20
---

The **New program** wizard sets up a program in up to six steps: **Start**, **Basics**, **Variants**, **Price card**, **Schedule** and **Links and review**. For a simple program, **Quick setup** does it on one page. Drafts save as you go, so you can stop and come back.

## Before you start

- You need the Member, Admin or Owner role in the workspace. Otherwise the wizard says **You can't create programs in this workspace**.
- To start from a won deal, your organization needs KitStak CRM. To link a Pulse job, it needs KitStak Pulse.

## Pick how to start

Go to **Programs** and open the **New program** menu, or pick **New program** from **More ways to create** in the top bar.

| Choice | What it does |
| --- | --- |
| **From scratch** | Set up variants, rates and a schedule |
| **Quick setup · one page** | Name, kits and one rate on one page |
| **From a won CRM deal** | Use the deal's customer, value and rates |
| **From a template** | Start from a saved program template |
| **Copy a program** | Copy variants, rates and schedules |
| **Resume a draft** | Pick up a draft you saved |

On the **Start** step, the same choices show as cards under **How to start**. A deal that already has a program shows **Has a program**. When you copy a program, pick **What to copy**: **Variants**, **Price card**, **Schedules** (copied as paused until you turn them on), **Members** and **Links**.

## Step: Basics

1. Pick a color and icon, and enter the **Program name**.
2. Check the **Key**. Builds use it: with the key `KITS`, builds are `KITS-1`, `KITS-2` and so on.
3. Optional: pick the **Customer**, a shared customer or a CRM account, and add a **Description**.
4. Pick the **Owner**. The owner runs the program and manages its people.
5. Set **Starts**. Leave **Ends** empty for an ongoing program.
6. Pick the **Time zone**. Days and today are counted in this zone in every app.
7. Under **What do builds count?**, pick kits, orders, units, packs or boxes, or **Other** and type the **One** and **Many** words, such as `case` and `cases`.
8. Under **Work days**, leave **Use the workspace calendar** on, or turn it off to pick this program's own days. Optional: add **Days off for this program** and **Extra work days**.
9. Optional: set a **Monthly revenue target**.
10. Select **Continue**.

## Step: Variants

Pick **How to add variants**:

- **Make a matrix**: add up to 4 attributes, such as Size and Color, and their values. Each mix of values becomes one variant. Under **Names and SKUs**, set how names, keys and SKUs are built. Select rows or columns to **Set qty** or **Set rate** for many at once. Add **Rates by attribute** to price every variant with one value the same way.
- **Paste a list**: paste SKUs or rows from a spreadsheet. Projects finds the attributes for you.
- **Add one by one**: type each variant's **Name**, **Key**, **SKU**, **Default qty** and **Rate**, then **Add variant**.

When the program has a customer, select **Match kits** to link variants to that customer's kits by SKU. A matched variant shows **Kit found**.

## Step: Price card

1. Pick **Add prices now**, or **Set prices later**. Without a price card, output is logged as **No price** until you publish one; then the open days get their prices.
2. Set **Price card starts**. Version 1 is in force from this day.
3. Under **Work charges**, set the rate per unit, and optional **Per batch** (charged each time a build is marked done) and **Per hour** lines.
4. Under **Fixed**, add an optional **Monthly fee**. Under **Minimum**, add an optional **Monthly minimum**.
5. Optional: **Add a setup fee** with its **Charge on** date. Setup fees are charged once on their date.

**What this card earns** shows what one run of every variant earns, and about how much a month at this schedule earns. From a deal, the card shows what came from the deal, with **Use as monthly minimum** and **Use as target**.

## Step: Schedule

This step is optional. Select **Skip** to plan builds by hand.

1. Turn on **Make builds on a schedule** and give it a **Name**. This is the run name everywhere.
2. Pick **Repeats**: **Every day**, **Every work day**, **On certain days** or **Every few weeks**.
3. Set the **First day**, an optional **Last day**, and how many days to **Make builds ahead**.
4. Leave **Skip days off** on to skip holidays and days off.
5. Under **What to build each time**, tick each variant to **Include**, set its **Qty**, and optionally **Vary by day** or pick an **Assignee**.

The **Preview** shows the next two weeks.

## Step: Links and review

1. Under **People**, select **Add people** and pick each person's role.
2. With CRM, link the deal and account.
3. With Pulse, pick **Do not link a job**, **Link an ongoing job** or **Make a new Pulse job**. Output and fees go to the job, for cost and margin.
4. Optional: link **Related projects**.
5. Check the **Review** and select **Create program**.

## Drafts

- Select **Save draft** at any time. Drafts save once the program has a name.
- Closing with unsaved changes asks **Leave without saving?**: **Save draft**, **Discard** or **Keep editing**.
- Find a draft later under **New program > Resume a draft**.

## Quick setup

1. Choose **Quick setup · one page**.
2. Enter the **Program name**, **Key**, **Customer** and **What do builds count?**.
3. Paste your kits, or add them one by one.
4. Add a price per unit, or choose **Set prices later**.
5. Optional: turn on **Make builds every work day** and set **How many of each**.
6. Select **Create program**.

Everything else takes its default. You can change it later in the program's tabs.

## Rules Projects checks

- The name is required, and the key follows the same rule as project keys: 2 to 6 letters or numbers, starting with a letter, not used by another project or program.
- A program needs at least one work day.
- A matrix can have up to 4 attributes, 30 values each, and make up to 200 variants at once.

## Related

- [Programs overview](/docs/projects/programs-overview)
- [Plan builds and log output](/docs/projects/builds-and-output)
- [Variants, price cards and month close](/docs/projects/program-pricing-and-close)
