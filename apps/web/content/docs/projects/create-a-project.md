---
title: Create a project
description: Start a project from a built-in template, your team's template or a blank board, set its key, dates and visibility, add people and link a customer.
section: Projects and tasks
order: 10
---

A project holds one piece of work: a launch, a client go-live, a sprint. The **New project** wizard walks you through three steps: **Start**, **Details** and **People & links**. When you finish, the project opens on its Overview, with starter tasks on the board if you used a template.

## Before you start

- You need the Member, Admin or Owner role in the workspace. Viewers and guests see **You can’t create projects in this workspace**. See [roles and permissions](/docs/projects/roles-and-permissions).
- To link a customer or CRM deal, your organization needs KitStak CRM. See [link CRM and WMS records](/docs/projects/link-crm-and-wms-records).

## Step 1: Start

1. Go to **Projects** and select **New project**. You can also select **New project** from **More ways to create** in the top bar, or the plus next to **Spaces** in the sidebar.
2. Pick a starting point. **Blank project** gives you an empty project with **To do**, **In progress**, **In review** and **Done**. Every other card is a template.
3. Narrow the gallery with **Search templates** or a category chip. **All** shows every template.
4. Look at the preview on the right. It lists the template's board columns, milestones, starter tasks and automations.
5. Select **Use this template** (or **Start blank**), or select **Continue**.

## Step 2: Details

1. Pick a color and icon for the project.
2. Enter the **Project name**. With a template, it starts as the template name.
3. Check the **Key**. Projects suggests one from the name. Task ids use it: with the key `OPS`, tasks are `OPS-1`, `OPS-2` and so on.
4. Optional: fill in **What is this project about?** with the goal, who it is for, and what done looks like.
5. Pick a **Space**. With a template, Projects picks the space whose name matches the template's category, such as Operations.
6. Pick the **Owner**. The owner leads the project and can manage people. It starts as you.
7. Set the **Start date** and **Due date**. The start date starts as today. A template sets the due date from its length.
8. Choose **Who can see it**: **Everyone in the workspace** or **Only people I add**.
9. With a template, leave **Add the starter work** on to get its tasks. Their start and due dates line up with your start date. Turn it off to get only the columns, labels and milestones.
10. Select **Continue**.

## Step 3: People & links

1. Under **Who’s working on it?**, select **Add people** and pick teammates. Each one gets a role, **Editor** to start. Teammates you add get a note in their inbox.
2. Optional: under **Connect it to your customer**, pick a customer from the shared customer list used by CRM and the warehouse.
3. Optional, with CRM: under **CRM record**, choose **Deal** or **Account** and pick one. If nothing matches, select **Link an account instead**, or **Create a deal in CRM** to open the CRM.
4. Check the **Summary** and select **Create project**.

A private project with no one added shows a note: only you will see it until you add people.

## Rules Projects checks

| Field | Rule |
| --- | --- |
| **Project name** | Required |
| **Key** | 2 to 6 letters or numbers, starting with a letter, such as `OPS` or `Q4MKT` |
| **Key** | Must not be used by another project |
| **Due date** | Must be on or after the start date |
| Template dates | A task or due date that falls on a Saturday or Sunday moves to the next Monday |

If the key was taken while you were filling in the wizard, Projects sends you back to **Details** to change it.

## Start a project from a CRM deal

In KitStak CRM, open a deal, go to its **Projects** tab and select **Start a project**. The wizard opens with the **Client onboarding** template, the deal name, the customer and the deal already filled in.

## Try a sample project

On an empty Projects page, or in the welcome dialog, select **Create sample project** or **Try a sample project**. It uses the Product launch template, and its first four dated tasks are assigned to you.

## Related

- [Project templates](/docs/projects/templates)
- [Find and manage projects](/docs/projects/projects-page)
- [Project settings](/docs/projects/project-settings)
