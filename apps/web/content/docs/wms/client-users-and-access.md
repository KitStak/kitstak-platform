---
title: Client users and what they see
description: Give a 3PL client its own sign-in, limit it to its own data with client access and the Client role, and check who can see each client.
section: Clients
order: 40
---

You can let a client sign in to KitStak WMS and look at its own orders, inventory and reports. A client sign-in is a normal user with the user type **Client**, access to that one client only, and a read-only role. Operation users can also be limited to some clients, for example a team that only works one brand.

## Before you start

- You need the **Create** action on **Users** to add a user, and **Edit** to change one.
- The client must exist and be active. See [Create a client](/docs/wms/client-create-a-client).
- New users need a free seat on your plan. When the plan is full, the error offers **Add a seat**. See [Getting started](/docs/getting-started).

## Add a sign-in for a client

1. Go to **Settings > Users > Users** and select **Add user**.
2. On **User info**, enter **First name**, **Last name** and **Email**, and set **User type** to **Client**.
3. Set a **Password** and **Confirm password**, or turn on **Send welcome email** so the person chooses their own password.
4. Select **Next**. On **Roles**, pick the **Client** role.
5. On **Warehouse**, give access to the warehouses that hold the client's stock.
6. On **Client**, choose **Select manually** and tick only that client.
7. Select **Create user**.

The welcome email holds a link to choose a password that is valid for 3 days. It needs email delivery to be set up in **Company Settings**. See [Company settings and security](/docs/wms/settings-company-and-security).

## What decides what a user sees

| Control | Where you set it | Effect |
| --- | --- | --- |
| **User type** | **User info** step | **Client** marks the person as a client user. The tip reads **Client users only see their own clients' data**. |
| **Client access** | **Client** step | **All clients** gives access to all existing and future clients. **Select manually** limits the user to the ticked clients. |
| **Warehouses** | **Warehouse** step | Data from other warehouses is hidden in every grid, report and API call. |
| **Roles** | **Roles** step | Which screens and actions the user has. Permissions are the union of every assigned role. |
| **Restrictions** | On the role | Hide carrier cost, carrier account data and rate shopping data. |

With **Select manually**, the user sees orders, inventory and reports of the ticked clients only. A user must have at least one client, or **All clients**. KitStak shows **Select at least one client, or give access to all clients** otherwise.

## The built-in Client role

KitStak creates a system role called **Client** for client portals. It gives read-only access to fulfillment, inventory and reports, plus the user's own profile and password pages. It has no settings, billing, user or integration setup pages.

The **Client** role also has the restrictions **Carrier cost**, **Carrier account data** and **Rate shopping data** turned on. Client users therefore see an empty value for shipping rates, carrier fees, carrier account numbers and rate shopping details, on screen and in Excel exports.

System roles can't be edited. To give clients a different set of pages, select **Duplicate** on the **Client** role, change the copy and set its **Role category** to **Client**. See [Roles and permissions](/docs/wms/role-roles-and-permissions).

## Things client users can't do

- Client users are not offered as assignees for count tasks or as wave rule users.
- Only users with access to all clients can create new clients.
- Client users can't open pages their role doesn't grant. A blocked request is written to the audit log as **Permission denied**.

## See who can access a client

1. Go to **Settings > Client Setup > Clients** and open the client.
2. Select the **Users with access** tab.

The tab lists each user with **User**, **Email**, **Role**, **Access** and **Status**. **Access** is **Assigned** for users given this client by selection, or **All clients** for users who see every client. When nobody can see the client, the tab reads **No users can see this client**.

## Change client access in bulk

On **Settings > Users > Users**, select **Bulk import/update** and then **Assign/unassign user-client**. The file has these columns:

```csv
Email,Client Code,Action
```

**Action** is `Assign` or `Unassign`. Add the user's role first, then assign clients.

## Related

- [Add and manage users](/docs/wms/user-manage-users)
- [Roles and permissions](/docs/wms/role-roles-and-permissions)
- [Client details page](/docs/wms/client-details)
