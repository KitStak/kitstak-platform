---
title: Security settings and the audit log
description: Review and end active sessions, see the password and session policy, limit invitations by email domain, enforce an IP allow-list and search the audit log.
section: Admin and permissions
order: 30
---

The **Security** section of the admin center controls how people sign in and from where. The **Audit log** records every security-relevant event in the organization, so you can see who did what and when.

## Before you start

- You need the admin or owner role.
- For how KitStak protects your data, see [Security](/security).

## Review active sessions

1. Open **Administration > Security**.
2. Under **Active sessions**, filter with **Filter by person or IP**.
3. Each row shows the **Person**, the **Device**, the **IP address** and when the session was **Last refreshed**. Your own session shows **This device**.
4. To end a session, select its sign-out action and confirm **Sign out session**.

Sessions are account-wide: signing one out ends it in every organization that person belongs to. They can sign in again with their password.

## Sign-in and password policy

**Sign-in & passwords** applies to every member who signs in with email and password.

| Setting | Policy |
| --- | --- |
| **Password requirements** | 10 to 72 characters. Resetting a password signs out every other session |
| **Session length** | Two weeks, refreshed every 24 hours of activity |

## Allow only some email domains

1. Under **Allowed email domains**, type a domain in **Email domain**, for example `example.com`.
2. Select **Add domain**. Repeat for each domain.
3. Select **Save domains**, or **Discard**.

Only people with these email domains can be invited. Leave the list empty to allow any domain. A toast confirms **Allowed domains saved**.

## Enforce an IP allow-list

1. Under **IP allow-list**, enter **Allowed addresses**: one IPv4 or IPv6 address or CIDR range per line, for example `203.0.113.0/24`.
2. Turn on **Enforce allow-list**.
3. Select **Save allow-list**. A toast confirms **IP allow-list is on**.

When it is on, API and app requests from addresses outside these ranges are blocked. You can’t turn it on if your current address isn’t covered, so you don’t lock yourself out.

## Search the audit log

1. Open **Administration > Audit log**. Entries can’t be edited or removed.
2. Search with **Search action, person, target or IP**.
3. Filter by category: **All events**, **Sign-in & access**, **Members**, **Teams**, **Boards**, **Items**, **Organization**, **API tokens**, **Security**, **Exports & imports** or **Trash**.
4. Filter by person (**Anyone** or one person) and by date: **Any time**, **Last 24 hours**, **Last 7 days**, **Last 30 days**, **Last 90 days** or **Custom range…**.
5. Select **Load older events** to go further back.

Each entry shows **When**, **Who**, the **Action**, the **Target** and the **IP address**. Select **Show details** to see the device and the **Raw payload**, and **Copy** to copy it. If the start date is after the end date, you see **The start date is after the end date**.

## Export the audit log

Select **Export CSV**. With filters on, only matching entries are exported. Otherwise all entries are.

## Related pages

- [Manage the organization and its users](/docs/crm/organization-and-users)
- [Roles, teams and permissions](/docs/crm/roles-and-permissions)
- [Personal API tokens](/docs/crm/api-tokens)
