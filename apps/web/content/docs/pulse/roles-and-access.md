---
title: Roles and who sees money
description: The five Pulse roles, what each one can do, how a person gets a role, the switch that lets a supervisor or viewer see money, and who sees wages.
section: Settings and access
order: 30
---

Pulse has five roles. Seeing money is opt in: owners, admins and managers see money, and nobody else does unless you turn it on. Money is hidden on the server, never only on screen, so exports and reports follow the same rule.

## Before you start

- Changing roles needs an admin or the owner.
- People join your workspace from the KitStak Portal. See [Getting started](/docs/getting-started).

## The roles

| Role | What it can do | Sees money |
| --- | --- | --- |
| **Owner** | Everything, including deleting all data and reopening a closed month. | Yes, with wages. |
| **Admin** | Rates, settings, roles and month close, plus all a manager can do. | Yes, with wages. |
| **Manager** | Jobs, plans, costs, revenue, imports and reviewing days. | Yes. The real cost of an hour, never the wage. |
| **Supervisor** | Logs work for the last 7 days. Sees units, hours and pace. | No, unless you turn it on. |
| **Viewer** | Reads every screen. | No, unless you turn it on. |
| **No access** | Cannot open Pulse. | No. |

## What each action needs

| Action | Lowest role |
| --- | --- |
| Read Pulse, export what you can see | Viewer |
| Log production, other time and material usage | Supervisor |
| Import production, other time, time punches and materials | Supervisor |
| Edit anyone's entries, review days | Manager |
| Jobs, plans, costs, revenue, extra services, target pace, goals, alerts, other imports, device links | Manager |
| Labor rates, settings, roles, month close, sample data | Admin |
| Reopen a closed month, delete all data | Owner |

A supervisor can log and edit days that are not marked complete, in the last 7 days. A page that is not part of a role says **This page is not part of your role**.

## Who runs Pulse

When no one in the workspace is the Pulse owner yet, the first admin who opens Pulse is offered **Run Pulse for this workspace**. When there is no admin, any member can be. The person who accepts becomes the owner.

## Set a person's role

1. Go to **More > Settings** and open **People and roles**.
2. The panel starts with **Who can see money?** and a count of the people who do.
3. For each person, pick the role under their name. Each row says where the role came from: **Set here**, **From the warehouse app** or **From the workspace role**.
4. Select **Reset** to drop a role set here and go back to the role from the warehouse app or the workspace.

## Where a role comes from

1. A role set here in **People and roles**.
2. Else, when your workspace has KitStak WMS, the person's warehouse user: an owner or admin becomes **Admin**, a manager becomes **Manager**, an operator becomes **Supervisor**, a viewer becomes **Viewer**, and client users get no access.
3. Else the workspace role: an owner becomes **Owner**, an admin becomes **Admin**, and a plain member gets the **Role for new members**.

Set **Role for new members** under **New members**. **No access** is the safe choice: nobody sees your numbers until you say so.

## Let a supervisor or viewer see money

For a supervisor or viewer, turn on the switch next to the role. It reads **Sees money** when on and **No money** when off. Wages stay with owners and admins.

## What people without money see

- Money and margin figures are blank. Screens show units, hours and pace instead.
- Money pages, such as Profit and the Calculator, are not open to them.
- Exports leave money columns out. Reports that are about money are not open to them.
- Alerts and rules read without amounts, for example "a set amount" in place of a dollar line.

## Add a person

Invite people by email in the Portal with **Invite in the Portal**. When they sign in to Pulse with that email, they see the invitation and join. Then they show up in the list and you pick their role.

## Related

- [Log work on a floor tablet](/docs/pulse/floor-tablet)
- [Workspace settings](/docs/pulse/workspace-settings)
- [Read the audit log](/docs/pulse/audit-log)
