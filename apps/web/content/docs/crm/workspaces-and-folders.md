---
title: Create workspaces and folders
description: Create open or closed workspaces, manage their members, and organize boards and dashboards into nested folders you can move and sort.
section: Workspaces and boards
order: 10
---

A workspace holds boards, dashboards and folders for one team or purpose, such as `Enterprise sales` or `Customer success`. Folders sit inside a workspace and can be nested. Every organization keeps at least one workspace.

## Before you start

- Members, admins and owners can create workspaces and folders, unless an admin limits who can create workspaces. See [Roles, teams and permissions](/docs/crm/roles-and-permissions).
- Viewers and guests can open workspaces but not change them.

## Create a workspace

1. Open **Workspaces** in the top bar.
2. Open the workspace switcher and select **Add workspace**.
3. Enter a **Workspace name**, for example `Enterprise sales`.
4. Pick a **Color** and an **Icon**. **First letter** uses the first letter of the name.
5. Under **Privacy**, choose **Open** (anyone in your org can join) or **Closed** (only people you add see it).
6. Optionally add a **Description**.
7. Select **Create workspace**.

The new workspace becomes the active one. Add a board to get started.

## Open the workspace page

Select **Workspace overview** in the workspace menu (the menu next to the switcher, **Workspace options for** the workspace). The page has two tabs.

| Tab | What it holds |
| --- | --- |
| **Content** | Every board, dashboard and folder. Search with **Search this workspace**, filter by **All**, **Boards**, **Dashboards** or **Folders**, and sort by **Last updated**, **Name (A to Z)** or **Type**. Buttons **New board**, **Choose a template** and **Import** |
| **Members & permissions** | Who can see the workspace and their workspace role |

Select the workspace name, color or description on this page to edit them in place.

## Manage workspace members

1. On the workspace page, open **Members & permissions**.
2. Type a name in **Add member…** and pick the person.
3. Set each person’s workspace role to **Owner** or **Member**.
4. To remove someone, use the remove action on their row. A toast lets you undo.

In an **Open workspace**, everyone in the organization can find and open its main boards, and private boards still need an invite. In a **Closed workspace**, only the members listed here (and org admins) can see its boards and dashboards.

## The workspace menu

| Item | What it does |
| --- | --- |
| **Workspace overview** | Opens the workspace page |
| **Manage members** | Opens **Members & permissions** |
| **Rename** | Renames the workspace |
| **Change color** | Picks a new color |
| **Change icon** | Picks an emoji, or **Use initial letter** |
| **Sort tree** | **Alphabetical (A to Z)** or **Manual (drag to reorder)** |
| **Add to favorites** | Pins the workspace to your favorites |
| **Collapse all folders** | Closes every folder in the tree |
| **Delete workspace** | Moves the workspace to the trash |

## Delete a workspace

1. Open the workspace menu and select **Delete workspace**.
2. Type the workspace name in **Type the workspace name to confirm**.
3. Select **Delete workspace**.

Its boards, dashboards and folders move to the trash for 30 days, and members lose access immediately. You can’t delete the last workspace in the organization.

## Create a folder

1. In the Workspaces menu, select the add button (**Add to workspace**) and choose **New folder**.
2. Enter a **Folder name**, for example `Enterprise deals`, and pick a **Color**.
3. Choose the **Workspace** and the **Location**: the **Workspace root** or another folder.
4. Select the create button.

Then drag boards into the folder in the tree.

## The folder menu

Hover a folder and open **More actions for folder**.

| Item | What it does |
| --- | --- |
| **New board in folder** | Creates a board inside the folder |
| **New sub-folder** | Creates a folder inside this one |
| **Rename**, **Change color**, **Change icon** | Edits the folder |
| **Move to** | Moves the folder to another folder or workspace |
| **Add to favorites** | Pins the folder |
| **Collapse all folders** | Closes every folder in the tree |
| **Archive folder** | Archives the folder and the boards inside it |
| **Delete folder** | Deletes the folder. The boards inside move up a level |

A folder can’t be moved inside itself, and a parent folder must be in the same workspace.

## Move boards in the tree

Drag a board or folder to a new spot, or use **Move to** in its menu and search with **Search folders and workspaces**. With **Manual (drag to reorder)** sorting, the order you set is kept for everyone.

## Related pages

- [Create a board from scratch or a template](/docs/crm/create-a-board)
- [Share a board and set board roles](/docs/crm/share-a-board)
- [Archive, delete and restore](/docs/crm/trash-and-restore)
