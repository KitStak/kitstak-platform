---
title: Manage the organization and its users
description: Set the organization name, URL, logo and default workspace, invite people with a role, change roles, deactivate users and check usage.
section: Admin and permissions
order: 10
---

The admin center is where owners and admins run the organization: its profile, its people, teams, permissions, security, audit log, API tokens and usage. This page covers the organization settings, users, invitations and usage.

## Before you start

- Open the admin center from your avatar menu with **Administration**. Only owners and admins see it.
- Each admin section needs its own permission. Owners can do everything, including billing, deleting the organization and managing other owners. Admins can manage members, teams, security policy, API tokens and every board in the organization.

## Admin sections

| Group | Section | What it holds |
| --- | --- | --- |
| Organization | **General** | Name, URL, logo and defaults |
| Organization | **Users** | Roles, invitations and status |
| Organization | **Teams** | Groups of people and their owners |
| Organization | **Permissions** | Role matrix and creation rules |
| Security | **Security** | Sessions, sign-in and network rules |
| Security | **Audit log** | Every security-relevant event |
| Security | **API** | Personal API tokens |
| Account | **Usage & billing** | Seats, content and plan |

## Edit the organization profile

1. Open **Administration > General**.
2. Under **Organization profile**, change the **Logo**, the **Organization name** (2 to 80 characters) or the **Organization URL**.
3. Pick a **Default workspace**, where new members land after their first sign-in, or **No default (home page)**.
4. Select **Save changes**, or **Discard**.

> **Important:** Changing the organization URL breaks links people have bookmarked.

**Data & region** shows the **Data region**, set when the organization was created, the **Created** date and the organization ID used by API integrations.

## Invite people

1. Select **Invite members** in the top bar, or **Invite people** in **Administration > Users**.
2. Type or paste email addresses. Press `Enter` or a comma after each one. You can paste a whole list, up to 50 at a time.
3. Pick the role for new invitees: **Member** (create and edit boards), **Viewer** (read-only access), **Guest** (only boards shared with them) or **Admin** (manage members and settings).
4. Optionally pick a team in **Add to team**.
5. Select **Send invite** (or **Send 3 invites**).

Each invitation has a join link. Share it from the **Pending** tab with **Copy invite link**. The person signs in with the invited email to join. Links expire after 7 days. Addresses that are already members, or your own, are flagged.

If an admin set **Allowed email domains**, only those domains can be invited. See [Security settings and the audit log](/docs/crm/security-and-audit). If your plan has no free seat, the dialog says so and links to your plan.

## Manage users

**Administration > Users** lists everyone with their **Role**, **Teams**, **Last active**, **Joined** date and **Status**.

- Search with **Search name, email or title**, and filter by role (**All roles**) and status: **All statuses**, **Active**, **Deactivated** or **Pending invitations**.
- Change a role with the role menu on the row. A toast offers **Undo**.
- Select several users for **Change role**, **Deactivate** or **Reactivate** in bulk.
- Open **Actions for** a user for **Copy email**, **Deactivate…** or **Reactivate**.
- Select **Export CSV** to download the list as `kitstak-users.csv`.

You can’t change your own role here, and only a higher role can change someone’s role. Reactivate a deactivated user before you change their role.

## Deactivate a user

1. Open **Actions for** the user and select **Deactivate…**.
2. Confirm **Deactivate**.

They lose access to this organization immediately. Their boards, items and history are kept, and you can reactivate them at any time. Deactivated members don’t use a seat.

## Manage pending invitations

The **Pending invitations** table shows the **Email**, **Role**, **Invited by** and **Expires** date of each invitation. Expired ones show **Expired**.

- Select **Resend** to issue a fresh invitation with a new expiry date. The old link stops working.
- Select **Revoke** and confirm **Revoke** to cancel it. The link stops working, and you can invite them again later.

## Check usage

**Administration > Usage & billing** shows:

| Area | What it shows |
| --- | --- |
| **Fair use limits** | Meters for **Automation runs this month**, **File storage**, **Boards**, **Items**, **Automations**, **Dashboards**, **Files** and **Active API tokens** |
| **Seats by role** | How many people hold each role, and **Pending invites** |

Meters turn amber at 80% and red at 100%. Select **Plan and payment** to manage your plan in the KitStak portal. See [Pricing](/pricing).

## Related pages

- [Roles, teams and permissions](/docs/crm/roles-and-permissions)
- [Security settings and the audit log](/docs/crm/security-and-audit)
- [Personal API tokens](/docs/crm/api-tokens)
