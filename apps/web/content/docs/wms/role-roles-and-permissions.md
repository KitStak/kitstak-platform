---
title: Roles, permission groups and restrictions
description: Use the built-in roles or build your own from the permission matrix, and hide carrier cost, carrier account data and rate shopping data from chosen roles.
section: Settings and admin
order: 20
---

A role is a named set of permissions. Each permission is one action on one page, such as **Create** on **Purchase Orders**. A user can hold several roles and gets every permission in any of them. Restrictions sit on top of permissions and hide sensitive carrier fields from a role's users everywhere.

## Before you start

- You need the **Roles** page in your role: **View**, **Create**, **Edit**, **Delete**, **Change Log** and **Manage Restrictions** as needed.

## Built-in roles

| Role | What it can do |
| --- | --- |
| **Admin** | Full access to every screen and action. Always sees every field. |
| **Supervisor** | Runs warehouse operations and configuration. |
| **Warehouse Clerk** | Executes warehouse work; read-only reports, automation, integrations and analytics. No settings, billing or users. |
| **Viewer** | Read-only access to operational screens, plus billing views. |
| **Client** | Client portal: read-only orders, inventory and reports for the client's own data. Carrier costs and account numbers are hidden. |

Built-in roles are marked **System** and can't be changed or deleted. Select **Duplicate** to make an editable copy. Every user, whatever the role, keeps access to their own profile and password pages.

## Permission groups

The permission matrix is arranged in groups, then sections, then pages.

| Group | Sections |
| --- | --- |
| **Fulfillment** | Outbound, Task Management, Shipment |
| **Inventory** | Inbound, Inventory, Count Operations |
| **Automation** | Automation |
| **Integrations** | Integrations: setup, logs, channel monitoring and carrier monitoring |
| **Reports** | One view permission per report |
| **Settings** | Master Data, Configuration, Client Setup, Users, Other Settings |
| **Mobile** | The mobile app's screens and actions |
| **Analytics** | Labor Analytics and Operational Analytics |

Each group and section shows how many of its permissions are granted.

## Create a role

1. Go to **Settings > Users > Roles** and select **Add role**.
2. Enter the **Name**, up to 60 characters, and a **Description**, up to 250.
3. Choose the **Role category**: **Operation** or **Client**. Client roles are meant for client users.
4. Open a group and tick the actions. A page's checkbox grants or revokes all of its actions at once. Use **Search permissions, e.g. cancel** to find an action.
5. Select **Create role**. Changes apply on the users' next click.

### The View rule

Every action needs the page's **View**. Ticking any action ticks **View** too, and unticking **View** clears that page's other actions. KitStak tells you which pages it cleared. A role can never change records on a screen it can't open.

## Change, duplicate or delete a role

| Action | Rule |
| --- | --- |
| **Edit** | Custom roles only: **System roles are view-only. Duplicate to customize.** |
| **Duplicate** | Copies every permission into a new custom role that opens ready to edit. |
| **Change log** | Every permission and setting change. |
| **Delete** | System roles can't be deleted. A role with users can't be deleted either: reassign them first. |

The roles list shows **Role name**, **Description**, **Role category**, **Restrictions**, **Users**, **Permissions**, **Type** (**System** or **Custom**) and **Updated**. **Export As Excel** exports it.

## Restrictions: hide carrier cost and account data

| Restriction | What it hides |
| --- | --- |
| **Carrier cost** | Shipping rates, carrier fees and related cost information. |
| **Carrier account data** | Carrier account numbers and billing details. |
| **Rate shopping data** | Rate shopping usage and selected shipping options. |

Restricted users see an empty value for these fields everywhere: every screen and API response, and Excel exports, where the columns are left out.

### Set restrictions

1. On **Settings > Users > Roles**, select one or more roles.
2. Select **Manage restrictions**.
3. Tick the restrictions to apply. Restrictions every selected role already shares start ticked.
4. Select **Save**. Changes apply at the users' next page load.

The **Admin** role always sees every field, so it can't be restricted. The built-in **Client** role has all three restrictions on.

## Good to know

- A user with several roles gets every permission from all of them.
- Permission denials are written to the audit log as **Permission denied**. See [Audit log and change logs](/docs/wms/admin-audit-log-and-change-logs).
- Seeing a client's data also depends on the user's client access. See [Client users and what they see](/docs/wms/client-users-and-access).

## Related

- [Add and manage users](/docs/wms/user-manage-users)
- [Client users and what they see](/docs/wms/client-users-and-access)
- [Connect a carrier account](/docs/wms/carrier-connect-a-carrier)
