---
title: Start work from CRM and WMS records
description: Turn on rules that start a project or program when a CRM deal is won, and open tasks for WMS receipt discrepancies and cycle count variances.
section: Links to CRM and WMS
order: 20
---

Three workspace rules watch records in KitStak CRM and KitStak WMS and start work in Projects for you. When a CRM deal moves to Won, a project or program starts. When a WMS receipt comes in short, over or damaged, or a cycle count is off, a task opens for the right person.

## Before you start

- Your organization needs KitStak CRM for the deal rule, and KitStak WMS for the receipt and count rules. Without them, the tab says **Connect your other KitStak apps**.
- You need the Member, Admin or Owner role in the workspace. Others see **Ask a workspace member with edit access to turn one on.**

## The three rules

| Rule | App | What it does |
| --- | --- | --- |
| **Deal won, start the work** | CRM | When a CRM deal moves to Won, start a project from a template, or a program with the deal's rates, linked to the deal and its customer |
| **Receipt discrepancy, urgent task** | WMS | When a WMS receipt comes in short, over or damaged, create an urgent task for the receiving lead |
| **Count variance, open a task** | WMS | When a cycle count is off by more than the limit you set, open a task to investigate |

## Turn on the deal won rule

1. Go to **Automations** and select the **From CRM and WMS** tab.
2. On **Deal won, start the work**, select **Use this recipe**.
3. Check the **Name**.
4. Under **When the deal is won**, pick **Start a project** or **Start a program**.
5. For a project, pick the template under **Create the project from** and the **Project owner**. The new project is named after the deal and linked to it and its customer.
6. For a program, pick how to **Start the program from**: **The deal lines**, **A template** (pick a **Program template**) or **Another program** (pick the **Program to copy**). Then pick the **Program owner**. When the deal has prices, the deal prices win.
7. Optional: tick **Also start projects for deals won in the last 7 days** (or programs) to catch up on recent wins.
8. Select **Turn it on**.

The next deal that moves to Won gets its project or program automatically.

## Turn on a warehouse rule

1. Go to **Automations > From CRM and WMS**.
2. On **Receipt discrepancy, urgent task** or **Count variance, open a task**, select **Use this recipe**.
3. Pick the project under **Put the task in**.
4. Pick who gets it: the **Receiving lead** or **Inventory lead**, or **Nobody yet**.
5. Set the **Priority** and **Due in (days)**, from 0 to 60. Receipt tasks start due in 1 day, count tasks in 2.
6. For counts, set the **Variance limit (%)**. A task opens when the count is off by more than this, from 0.1 to 100. It starts at 2.
7. Optional: tick **Also check records from the last 30 days**.
8. Select **Turn it on**.

The next matching record in WMS gets a task automatically, linked to that receipt or count.

## Manage the rules

Each rule you turned on shows on the tab with its sentence, a switch to **Turn on** or **Turn off**, its recent runs and **Delete recipe**.

- Projects checks for new matches every few minutes. Select **Check now** to look straight away. It says how many new pieces of work it started, or **Nothing new to do**.
- Each record starts work once. A record that already started a project or task is never picked again.
- Only records that change after you turn a rule on count, plus the catch-up window if you ticked it.
- Deleting a rule keeps the work it already started.

## Related

- [Link CRM and WMS records](/docs/projects/link-crm-and-wms-records)
- [Automation recipes](/docs/projects/automation-recipes)
- [Project templates](/docs/projects/templates)
