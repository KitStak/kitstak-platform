---
title: Link CRM and WMS records
description: Link tasks and projects to CRM deals, accounts, shared customers and WMS orders, work orders, receipts and cycle counts, with live status on every link.
section: Links to CRM and WMS
order: 10
---

A task or project can be linked to the record it is about: the CRM deal it is for, the customer, or the warehouse order that has to ship. Each link shows that record's status now, and opens it in its own app. The same links show up in KitStak CRM and KitStak WMS, so both teams see the same progress.

## Before you start

- Links and rules for an app appear only if your organization runs that app. See [pricing](/pricing).
- WMS records can be linked only in the warehouse workspace. Elsewhere, **Settings > Integrations** says **WMS is in your plan but this workspace isn’t the warehouse workspace, so records can’t be linked here.**
- To add or remove links you need the Editor or Owner role on the project.

## What you can link

| Record | App | Search by |
| --- | --- | --- |
| **CRM deal** | CRM | Deal name |
| **CRM account** | CRM | Account name |
| **Customer** | Shared by every app | Name or code |
| **WMS order** | WMS | Order number (`SO` codes) or customer |
| **WMS work order** | WMS | Work order number (`WO` codes), for kitting and assembly jobs |
| **WMS receipt** | WMS | PO number (`PO` codes) |
| **WMS cycle count** | WMS | Count number (`CNT` codes) |

## Link a record to a task

1. Open the task.
2. Under **Linked records**, select **Link**.
3. Pick the kind of record under **What to link**.
4. Type a name or number and pick the record. Records already linked show **Already linked**.

The link shows as a chip with the app's mark, the record's title and its status, colored by what it means. Select it to open the record in its app. Select **Refresh linked records** to get the latest status from CRM and WMS.

To remove a link, select **Unlink** on it. Only the link goes; both records stay.

### Link by typing a code

In quick add, type a WMS code in the task name, such as `SO10482` or `PO2240`, and the new task links itself to that record. See [add tasks with quick add](/docs/projects/quick-add).

## Link a record to a project

1. Open the project's **Overview**.
2. Under **Linked records**, pick the kind of record under **What to link**.
3. Search and pick the record.

You can also link a customer and a CRM deal or account on the last step of the **New project** wizard. A project with no links says **Connect the customer, CRM deal or warehouse orders this project is for.**

## See linked records across a project

| Place | What you see |
| --- | --- |
| Board | **Swimlanes** by **CRM customer** or **WMS status** when tasks are linked |
| Table | The **Linked to** and **Customer** columns |
| Overview | The customer strip and **Linked records** |
| Automations | Triggers for **a linked CRM deal changes stage** and **a linked WMS order ships** |

## The customer strip

When a project is linked to a customer or CRM deal, the top of its **Overview** shows what the other apps know:

- From CRM: the deal **Stage**, **Value**, **Close date**, **Owner**, **Next step**, **Contacts** and **Other deals**, with **Open in CRM**.
- From the warehouse: **Open orders**, **Shipped, 7 days**, the **Latest receipt**, **SKUs received** and **Exceptions** such as shortages and holds, with **Open in WMS**.

Late receipts and inventory exceptions are listed as customer notes on the health chip. They never change the project's health.

With KitStak Pulse, a second strip shows revenue, cost, profit and margin so far for the jobs linked to the project.

## See project work from CRM and WMS

- In KitStak CRM, a deal or account has a **Projects** tab. It lists linked projects with their health and progress, and linked tasks with their live status. From there you can **Create task**, **Start a project**, **Link a project**, and **Open KitStak Projects**.
- In KitStak WMS, shipment order, work order, purchase order and cycle count pages have a **Project tasks** card. It lists linked tasks and projects, and has **Create task** to plan follow-up work without leaving the WMS.

A task created from CRM or WMS is linked to that record, and sets off the project's **a task is created** automations.

## Related

- [Start work from CRM and WMS records](/docs/projects/cross-app-rules)
- [Automation recipes](/docs/projects/automation-recipes)
- [KitStak CRM](/docs/crm)
- [KitStak WMS](/docs/wms)
