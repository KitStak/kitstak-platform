---
title: Link a job to a deal, work order or project
description: Tie a Pulse job to a CRM deal, a WMS work order or a Projects project, so its status shows on the job, data flows in, and you can jump between the apps.
section: Connected apps
order: 20
---

A link ties a job to the deal, work order or project it belongs to. The linked record shows as a chip on the job, its data flows into the job on each sync, and you can jump between the apps. A job can have more than one link.

## Before you start

- Linking needs a manager, admin or owner.
- The other app must be connected. See [Connect CRM, WMS and Projects](/docs/pulse/connected-apps).
- The project list shows only projects you can see in Projects.

## Link when you add the job

On the new job page, the **Start faster** panel can start a job from **A won deal** or **A warehouse work order**. The job is linked to that record when you save it. See [Add a job](/docs/pulse/add-a-job).

## Link an existing job

1. Go to **More > Settings** and open the **Connected apps** tab.
2. Under **Linked records**, select **Link a job**.
3. Pick the job.
4. Pick the **Kind of record**: **CRM deal**, **Work order** or **Project**.
5. Search for the record. Deals search by name or account, work orders by code, client or kit, projects by name or key. Pulse marks records **Already linked to this job**, or **Also on job** another job.
6. For a project, tick **Count this project's logged time as labor hours on the job** if you want its time to come in. A project's time counts on one job only, the first one that asked.
7. Select **Link record**.

Pulse costs project hours with your own labor rate. Time is never counted twice.

## What a link does

| Link | What it brings |
| --- | --- |
| **CRM deal** | The deal's stage shows on the job. |
| **Work order** | Kits built come in as units for the day, parts used can be pulled as materials, and a shortage of parts marks the job at risk. |
| **Project** | Status and progress show on the job. With time counted, logged time comes in as labor hours for each day. |

## See and remove links

- On the job's **Overview**, the **Linked records** panel lists each link. Select a link to open the record in a new tab, or remove it. A link kept in Projects says **This link is kept in Projects. Remove it there.**
- On **Connected apps**, **Linked records** lists every link in the workspace. For a project link, **Count its time** turns the time feed on or off. Hours already pulled stay until you delete them.

## Programs from Projects

When a KitStak Projects program feeds a job, the job shows which program bills to it, and the **Programs** tab of Profit adds up the jobs each program feeds. On the job's Overview, a manager can use **Link a program**.

## Related

- [Connect CRM, WMS and Projects](/docs/pulse/connected-apps)
- [Work with a job page](/docs/pulse/job-page)
- [Explore profit](/docs/pulse/profit-explorer)
