---
title: Roles, teams and permissions
description: See what owners, admins, members, viewers and guests can do, limit who creates workspaces and boards, and group people into teams with owners.
section: Admin and permissions
order: 20
---

Access in KitStak CRM works in layers. Every person has one organization role. Workspaces can be open or closed, and boards can be main, private or shareable with their own board roles. Teams group people for invitations and sharing.

## Organization roles

| Role | In short |
| --- | --- |
| **Owner** | Everything, including billing, deleting the organization and managing other owners |
| **Admin** | Members, teams, security policy, API tokens, webhooks, the audit log and every board |
| **Member** | Create and edit boards, items, dashboards and automations, import and export |
| **Viewer** | Read-only access, plus writing updates |
| **Guest** | Only boards shared with them, where they can edit items, comment and upload files |

## The permission matrix

**Administration > Permissions** shows **Role permissions**, the permissions granted to each organization role. Use **Highlight role** to focus on one. Board privacy and board-level permissions apply on top.

| Permission | Owner | Admin | Member | Viewer | Guest |
| --- | --- | --- | --- | --- | --- |
| See the organization | Yes | Yes | Yes | Yes | Yes |
| Change organization settings | Yes | Yes | No | No | No |
| Delete the organization | Yes | No | No | No | No |
| Manage billing & plan | Yes | No | No | No | No |
| See members | Yes | Yes | Yes | Yes | No |
| Invite people | Yes | Yes | No | No | No |
| Change roles & deactivate | Yes | Yes | No | No | No |
| Remove members | Yes | Yes | No | No | No |
| See teams | Yes | Yes | Yes | Yes | No |
| Create & manage teams | Yes | Yes | No | No | No |
| See workspaces | Yes | Yes | Yes | Yes | No |
| Create & edit workspaces | Yes | Yes | Yes | No | No |
| Delete workspaces | Yes | Yes | No | No | No |
| See boards | Yes | Yes | Yes | Yes | Yes |
| Create boards | Yes | Yes | Yes | No | No |
| Edit board structure | Yes | Yes | Yes | No | No |
| Delete boards | Yes | Yes | Yes | No | No |
| Share boards | Yes | Yes | Yes | No | No |
| See items | Yes | Yes | Yes | Yes | Yes |
| Create & edit items | Yes | Yes | Yes | No | Yes |
| Delete items | Yes | Yes | Yes | No | No |
| Read updates | Yes | Yes | Yes | Yes | Yes |
| Write updates | Yes | Yes | Yes | Yes | Yes |
| Moderate anyone’s updates | Yes | Yes | No | No | No |
| Download files | Yes | Yes | Yes | Yes | Yes |
| Upload files | Yes | Yes | Yes | No | Yes |
| See dashboards | Yes | Yes | Yes | Yes | No |
| Build dashboards | Yes | Yes | Yes | No | No |
| See automations | Yes | Yes | Yes | Yes | No |
| Build automations | Yes | Yes | Yes | No | No |
| Import data | Yes | Yes | Yes | No | No |
| Export data | Yes | Yes | Yes | No | No |
| Read the audit log | Yes | Yes | No | No | No |
| Create API tokens | Yes | Yes | Yes | No | No |
| Manage webhooks | Yes | Yes | No | No | No |

Guests see only the boards they were added to. A member’s board role still limits them on each board: a board **Viewer** can’t make changes. See [Share a board and set board roles](/docs/crm/share-a-board).

## Limit who can create

1. Open **Administration > Permissions**.
2. Under **Who can create**, set **Workspaces** and **Boards** to **Members and above** or **Admins only**.

Changes apply immediately. The boards rule applies to every workspace, including boards created from templates.

## Create a team

1. Open **Administration > Teams**.
2. Type a name in **New team name, e.g. Enterprise Sales** and select **Create team**.

Team names must be unique. If a name is taken, you see **A team with this name already exists**.

## Manage a team

- Add people with **Add people to this team** and select **Add**.
- Select **Make owner** to make someone a team owner, and **Remove as team owner** to undo it.
- Remove someone with the remove button on their row. A toast offers **Undo**.
- Open **Team options** to **Rename** or **Delete team…** the team.

Deleting a team keeps its members’ accounts and access. Only the team grouping is removed, and this can’t be undone. You can add new people to a team as you invite them with **Add to team**.

## Workspace roles

Closed workspaces have their own members, with the role **Owner** or **Member**. Only those members and org admins can see a closed workspace’s boards and dashboards. See [Create workspaces and folders](/docs/crm/workspaces-and-folders).

## Related pages

- [Manage the organization and its users](/docs/crm/organization-and-users)
- [Share a board and set board roles](/docs/crm/share-a-board)
- [Security settings and the audit log](/docs/crm/security-and-audit)
