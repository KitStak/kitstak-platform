---
title: Add and manage users
description: Create KitStak WMS users with roles, warehouses and clients, send invites, reset passwords, end sessions, deactivate users and import users from Excel.
section: Settings and admin
order: 10
---

Every person who signs in to KitStak WMS is a user. A user has one or more roles that decide what they can do, a list of warehouses they can see and either all clients or a chosen set. Users can be warehouse staff, the account owner or a client's own sign-in.

## Before you start

- You need the **Users** page in your role: **View**, **Create**, **Edit**, **Change Log** and **Import File** as needed.
- Create the roles first. See [Roles and permissions](/docs/wms/role-roles-and-permissions).
- Each user takes a seat on your plan. When the plan is full, the error offers **Add a seat**. See [Getting started](/docs/getting-started).

## Add a user

1. Go to **Settings > Users > Users** and select **Add user**.
2. On **User info**, fill in the fields below and select **Next**.
3. On **Roles**, tick one or more roles. Permissions are the union of every assigned role.
4. On **Warehouse**, tick the warehouses the user may work in.
5. On **Client**, choose **All clients** or **Select manually** and tick the clients.
6. Select **Create user**.

| Field | What it does | Required |
| --- | --- | --- |
| **First name**, **Last name** | Up to 60 characters each. | Yes |
| **Email** | Used to sign in. Must be unique; KitStak checks it as you type and shows **A user with this email already exists**. | Yes |
| **User type** | **Operation** for warehouse and office staff, **Client** for a client's own sign-in. The account owner's type can't change. | Yes |
| **Password**, **Confirm password** | Must meet your company's password policy. | Yes, unless you send an invite |
| **Send welcome email** | Emails an invite with a link to choose a password, valid for 3 days. Needs email delivery set up. | No |
| **Active** | Inactive users can't sign in. | No |

When editing, leave both password fields blank to keep the current password. A new password signs the user out everywhere.

| Step | Rule |
| --- | --- |
| **Roles** | **Assign at least one role**. |
| **Warehouse** | **Give access to at least one warehouse**. Data from other warehouses is hidden in every grid, report and API call. |
| **Client** | **Select at least one client, or give access to all clients**. **All clients** includes clients created later. |

## The Users list

The page **Users & Roles** has the tabs **Users** and **Roles**.

| Column | What it shows |
| --- | --- |
| **Name**, **Email** | The user. |
| **Role**, **Warehouse** | Assigned roles and warehouses. |
| **User type** | **Operation**, **Client** or **Owner**. |
| **Status** | **Active** or **Inactive**. |
| **API user** | Marks machine users for integrations. |
| **Last sign-in** | Or **Never**. |
| **Live sessions**, **Created date** | Hidden columns you can turn on. |

Search by email or name. **Export As Excel** exports the list.

## Row actions

| Action | What it does |
| --- | --- |
| **Show details** | Opens tabs **Details**, **Access**, **Sessions** and **Change log**. Details show last sign-in, when the password changed and whether the account is locked. |
| **Edit** | Opens the four step drawer. |
| **Change log** | Every change to the user. |
| **Deactivate** or **Activate** | Deactivated users are signed out on their next click. Activated users sign in with their current password. |
| **Reset password** | Replaces the password with a one time temporary password, signs out every session and makes the user choose a new password after signing in. |
| **Sessions** | Lists the user's live sessions by device and IP address, with a revoke for each one or all. |

The temporary password is shown once in a **Temporary password** dialog. Share it with the user privately.

You can't deactivate your own account, and you can't reset your own password here; use **Change Password** instead. Select several users to **Activate** or **Deactivate** them together.

## Import users from Excel

Select **Bulk import/update** and choose one of:

| Option | What it does | Columns |
| --- | --- | --- |
| **Bulk import users** | Create users with their role. | Email, Full Name, User Type, Role, Default Warehouse Code, All Clients, Status |
| **Import user-role** | Assign or unassign roles. | Email, Role, Action |
| **Assign/unassign user-warehouse** | Give or remove warehouse access. | Email, Warehouse Code, Action |
| **Assign/unassign user-client** | Give or remove client access. | Email, Client Code, Action |

**User Type** is `Operation` or `Client`. **Action** is `Assign` or `Unassign`. Add the user's role first, then assign warehouses or clients.

## Account lockout and sign-in rules

Failed sign-ins lock an account for a while, and passwords can expire. Both follow the policy in **Company Settings**. See [Company settings and security](/docs/wms/settings-company-and-security). If your company uses single sign-on, see [Single sign-on with OpenID Connect and SAML](/docs/wms/sso-single-sign-on).

## Related

- [Roles and permissions](/docs/wms/role-roles-and-permissions)
- [Client users and what they see](/docs/wms/client-users-and-access)
- [Audit log and change logs](/docs/wms/admin-audit-log-and-change-logs)
