---
title: Personal API tokens
description: Create personal API tokens with scopes and an expiry to connect scripts and BI tools to the KitStak CRM REST API, and revoke them when done.
section: Admin and permissions
order: 40
---

A personal API token lets a script, a BI tool or your own integration use the KitStak CRM REST API as you. Each token has scopes that limit what it can do and an expiry date. Treat tokens like passwords.

## Before you start

- Members, admins and owners can create tokens. Viewers and guests can’t.
- A token can never do more than your role allows. Its effective access is what both your role and its scopes permit.

## Create a token

1. Open **My profile > API tokens**, or **Administration > API** if you are an admin.
2. Select **New token**.
3. Enter a **Name**, for example `Nightly BI sync`.
4. Under **Scopes**, check what the token may do. See the table below.
5. Pick when it **Expires**: **In 30 days**, **In 90 days**, **In 1 year** or **Never (not recommended)**.
6. Select **Create token**.
7. In **Copy your new token**, select **Copy** and store the token safely. For your security it won’t be shown again.
8. Select **Done**.

| Scope | Code | What it allows |
| --- | --- | --- |
| **Read boards & items** | `boards:read` | Read workspaces, boards, items, updates, files, dashboards and automations |
| **Create & edit boards and items** | `boards:write` | Create and edit boards, create, edit and delete items, upload files |
| **Post updates** | `updates:write` | Write updates on items |
| **Read members & teams** | `members:read` | Read members and teams |
| **Manage webhooks** | `webhooks:manage` | Manage board webhooks |
| **Read the audit log** | `audit:read` | Read the audit log. **Admins only** |

## Use a token

Send the token in the `Authorization` header of each request to the REST API, which lives under `/api/v1`:

```
Authorization: Bearer ks_live_...
GET /api/v1/boards
```

Responses are JSON. If an IP allow-list is enforced, requests from other addresses are blocked. See [Security settings and the audit log](/docs/crm/security-and-audit).

## Review and revoke tokens

The token list shows each **Token** (its first characters), its **Scopes**, when it was **Last used**, when it **Expires** and its **Status**.

- Turn on **Show revoked & expired** to see old tokens.
- Admins can switch **Token owner** between **My tokens** and **Everyone**.
- Select **Revoke** on a token and confirm **Revoke token**. Anything using it stops working immediately. This can’t be undone.

## Related pages

- [Send board events to other tools with webhooks](/docs/crm/webhooks)
- [Set up your profile and preferences](/docs/crm/profile-settings)
- [Roles, teams and permissions](/docs/crm/roles-and-permissions)
