---
title: Track materials and scrap
description: Say who buys the parts, cost material by a cost per unit or by the parts really used, log parts used and scrapped, and pull parts from a linked work order.
section: Costs and rates
order: 30
---

Material cost is the parts and supplies you pay for, scrap included. In a 3PL the client often owns the components and you only buy boxes, tape and labels. Pulse asks who buys the parts, so parts the client supplies cost you nothing while their use and scrap are still tracked.

## Before you start

- Changing how a job costs material needs a manager. Logging parts used needs a supervisor or a manager.
- Parts you log often can be set up once as items. See **Set up items** below.

## Choose who buys the parts

1. Open the job and go to the **Materials** tab.
2. Under **Who buys the parts?**, pick **We do** or **The client does**.

A job follows the setting of its client or your workspace until you pick one here. Pulse decides who bought each part in this order: the material row, then the item, then the job, then the client, then the company rule in **Settings > Cost rules**.

## Choose how material is costed

Under **How should Pulse cost material?**, pick one:

| Option | When to use it | How the cost is worked out |
| --- | --- | --- |
| **A cost for each unit** | Steady kits where every unit takes the same parts. | Good and scrapped units times the material cost for one unit, for parts you buy. |
| **The parts really used** | Parts and scrap vary a lot. | Each usage row: parts used plus parts scrapped, times the cost of one part, for parts you buy. |

With **A cost for each unit**, select **Change it from a day** to set a new material cost for one unit. Pick **From which day?**: a day you pick, or the whole job from the start. Entries in open months from that day are worked out again. Earlier days keep the old number.

With **The parts really used**, rows you log under **Material used** set the cost. With a cost for each unit, those rows are a record and for scrap only.

## Log parts used

1. On the **Materials** tab, under **Material used**, select **Add parts used**.
2. Type one row per part and day, or paste rows from a spreadsheet.
3. Save. Every change has an undo.

| Column | What it holds |
| --- | --- |
| **Date** | The day the part was used. |
| **Part** and **SKU** | Which part. |
| **Used** | How many were used. More than zero. |
| **Scrapped** | How many were lost to scrap. |
| **Cost of one** | Up to 4 decimal places. |
| **Who bought them** | **The job's setting**, **We bought them** or **The client sent them**. |
| **Cost** | Used plus scrapped, times the cost of one. Parts from the client cost nothing. |

## Pull parts from the warehouse

When the job is linked to a KitStak WMS work order:

1. Select **Pull from the warehouse**. A badge shows how many rows are new.
2. Read **Parts on the work order**: **Part**, **Used in the warehouse**, **Already in Pulse**, **To add** and **Cost to add**.
3. Confirm, or select **Not now**.

Pulse adds only what is new since the last pull, so nothing is counted twice. If nothing is new it says **Already up to date**.

## The tiles

| Tile | What it shows |
| --- | --- |
| **Material cost so far** | With the part that was scrap. |
| **Good units**, **Scrapped units**, **Share scrapped** | Scrapped units over everything made, good and scrapped. |
| **Other costs so far** | Every other cost row on the job. See [Add other costs and company costs](/docs/pulse/other-and-company-costs). |
| **Usage rows** | A count of the rows under Material used. |

## Worked example (made-up figures)

A job costed by a cost for each unit made 3,000 good units and 60 scrapped, at $0.4500 of parts a unit.

- Material cost: 3,060 x $0.45 = $1,377.00.
- Of that, scrap: 60 x $0.45 = $27.00.

## Set up items

1. Go to **More > Settings**, open **Catalogs** and the **Items** tab.
2. Select **Add an item**.
3. Type the **SKU**, the name, what it is **Counted by the** (each, sheet, roll), the **Cost for one**, **Who supplies it** (**Follow the job**, **We buy it** or **The client supplies it**) and, if it belongs to one client, **Only for one client**.
4. Select **Add item**.

Material rows that already used an item keep their own cost when the item changes.

## Related

- [Work with a job page](/docs/pulse/job-page)
- [Add other costs and company costs](/docs/pulse/other-and-company-costs)
- [Connect CRM, WMS and Projects](/docs/pulse/connected-apps)
