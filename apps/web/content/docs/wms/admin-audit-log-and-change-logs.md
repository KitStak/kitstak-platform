---
title: Audit log and change logs
description: Review security events such as sign-ins, permission denials and settings changes in the Audit Log, and read the change history of any record.
section: Settings and admin
order: 70
---

KitStak WMS keeps two kinds of history. The **Audit Log** records security events: who signed in, who was refused, and who changed users, roles or company settings. Change logs record every create, update and delete on business records such as clients, products, orders and billing forms, field by field.

## Before you start

- The **Audit Log** needs **View** on the **Users** page.
- Change logs need the page's **Change Log** or **View** action.

## The Audit Log

Go to **Settings > Users > Audit Log**.

Four counters on top cover the last 24 hours. Select one to filter the grid.

| Counter | Filters to |
| --- | --- |
| **Sign-ins** | Sign-in events. |
| **Failed sign-ins** | Sign-ins that failed. |
| **Permission denials** | Requests a role didn't allow. |
| **CSRF rejects** | Requests blocked as cross-site. |

| Column | What it shows |
| --- | --- |
| **Date** | When it happened. |
| **Event type** | **Sign-in**, **Session**, **Password**, **CSRF rejected**, **Permission denied**, **User change**, **Role change**, **Settings change** or **Other**. |
| **Action** | What happened, such as **Sign in**, **Session revoked**, **Role restrictions changed** or **Password policy changed**. |
| **Outcome** | Success or failure. |
| **User** | Who did it, or **Not signed in**. |
| **Target** | The record it was about. |
| **Details** | A summary. Select it for the full details. |
| **IP address**, **Device** | Where it came from. |

**Group repeats** is on by default: identical events on the same day show once with a count. Turn it off to see each one. Select a row to open the event with its event type, outcome, user, target, IP address and device. The grid has filters, saved views and **Export As Excel**.

### What is recorded

| Event type | Examples |
| --- | --- |
| **Sign-in** | Sign in, sign in blocked after too many attempts. |
| **Session** | Sign out, signed out of all devices, session revoked, all sessions revoked. |
| **Password** | Password changed, password change rejected, reset requested, reset completed, reset by administrator. |
| **User change** | User created, invite email, user updated, activated, deactivated, profile updated. |
| **Role change** | Role created, permissions updated, duplicated, deleted, restrictions changed. |
| **Settings change** | Company settings updated, password policy changed, email delivery changed, test email, app activated, deactivated or settings changed, Data Setup values, number sequences, printouts. |

## Change logs on records

Most grids have a **Change log** row action, and record pages have a **Change log** button or an **Activity** tab. The drawer lists each change with its type and, for an update, the field, the old value and the new value. When nothing changed yet it reads **No changes recorded yet**.

| Record | Where |
| --- | --- |
| Clients | **Change log** on the list or the client page; the **Activity** tab adds notes. |
| Billing forms, bills, VAS operations | **Show change log** or **Change log** on each. |
| Store and carrier connections | **Change log** in the row menu. |
| Users, roles, warehouses, apps | **Change log** in the row menu. |
| Company settings | **Change log** on **Company Settings**. |

Some changes write an extra line to a related record. When you deactivate a client, each of its approved billing forms gets a line saying automatic billing is paused.

## The Change Log report

**Reports > Logs > Change Log** lists every change across all records, with filters by module, code, event type, property, source and date. Users without **View** on the **Users** page see only their own changes. See [Change log, transaction history and other logs](/docs/wms/analytics-logs-and-history).

## Related

- [Roles, permission groups and restrictions](/docs/wms/role-roles-and-permissions)
- [Add and manage users](/docs/wms/user-manage-users)
- [Company settings and security](/docs/wms/settings-company-and-security)
