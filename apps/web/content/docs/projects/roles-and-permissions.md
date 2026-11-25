---
title: Roles and permissions
description: How workspace roles and project roles decide who can see a project, add and change tasks, manage people, run automations and see program money.
section: Settings and roles
order: 10
---

Two kinds of role decide what you can do in KitStak Projects. Your workspace role comes from your organization in the KitStak Portal. Your project role is set on each project. On a project, you get whichever of the two gives you more.

## Workspace roles

Workspace roles are set in the KitStak Portal. See [getting started](/docs/getting-started).

| Role | What it allows in Projects |
| --- | --- |
| **Owner** | Everything, including the workspace and rules for every project. Owner of every project |
| **Admin** | The same as Owner in Projects |
| **Member** | Create projects, spaces, templates, goals and programs. Editor on every project open to the workspace |
| **Viewer** | Read and comment. Commenter on every project open to the workspace |
| **Guest** | Only the projects they are added to |

## Project roles

| Role | Help text on screen |
| --- | --- |
| **Owner** | Can do everything, including people and delete |
| **Editor** | Can add and change tasks and settings |
| **Commenter** | Can view and comment |
| **Viewer** | Can only look |

Set project roles in the project's **Settings > People & roles**. See [project settings](/docs/projects/project-settings).

## Who sees a project

- A project set to **Everyone in the workspace** (or **Workspace**) is open to every member of the workspace, except guests. People who are not added get a role from their workspace role, as in the table above.
- A project set to **Only people I add** (or **Members only**) is open only to the people added to it. Workspace owners and admins can always open it, as owners.
- The project's owner is always an owner of it.
- If you are added with a role that is higher than the one your workspace role gives you, you get the higher one.

## What each project role can do

| Action | Viewer | Commenter | Editor | Owner |
| --- | --- | --- | --- | --- |
| See the project and its tasks | Yes | Yes | Yes | Yes |
| Comment and upload files | | Yes | Yes | Yes |
| Add, change and delete tasks | | | Yes | Yes |
| Log time | | | Yes | Yes |
| Change the project's details | | | Yes | Yes |
| Change statuses, sections, labels and custom fields | | | Yes | Yes |
| Share saved views with the project | | | Yes | Yes |
| Add automations and forms for the project | | | Yes | Yes |
| Plan builds, log output and change schedules (programs) | | | Yes | Yes |
| Propose price changes (programs) | | | Yes | Yes |
| Change the key, visibility, people and roles | | | | Yes |
| Delete the project | | | | Yes |
| Publish prices and close months (programs) | | | | Yes |

## What each workspace role can do

| Action | Minimum role |
| --- | --- |
| See people in the workspace | Viewer |
| Create projects and programs | Member |
| Add and change spaces | Member |
| Save and change templates | Member |
| Create and change goals | Member |
| Rules that work in every project | Admin |
| Manage the workspace | Admin |

## Who sees program money

Program money (revenue, rates and fees) follows its own rule, because every member is an editor on open projects by default:

- Workspace owners and admins always see it.
- The program's owner sees it.
- Anyone else needs to be added to the program with a role at or above the program's money setting: **Owners only**, **Editors and owners** (to start) or **Everyone in the program**. Set it in the program's **Settings > Money**.
- Guests never see money.

Everyone else sees units only, with the line **Money is hidden for your role.**

## Related

- [Project settings](/docs/projects/project-settings)
- [Your settings and workspace settings](/docs/projects/workspace-settings)
- [Security](/security)
