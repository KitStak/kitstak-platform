---
title: Picking job types and batch templates
description: Set up picking job types for single-item, identical-order, multi-item, putwall and retailer flows, with batch sizes, conditions and pick sequence.
section: Outbound
order: 70
---

A job type is the recipe for a picking job. It decides which orders a job accepts, how many orders or units go in one job, whether sorting, packing and loading steps follow picking, and in what sequence the picker visits locations. Wave rules and **Picking / job operations** both build jobs from job types.

## Before you start

- You need permission to manage job types.
- The warehouse needs an active allocation algorithm. Picking and work order job types must name one. See [Allocation algorithms and dry run](/docs/wms/allocation-algorithms).

## Create a picking job type

1. Go to **Settings > Job Types**. It is also a tab on **Fulfillment > Job Management**.
2. Select **Create new job type**.
3. Fill in the **General** step and select the **Picking** operation type.
4. On **Templates**, choose a starting template or **Custom**.
5. Adjust **Settings**, then the optional **Conditions** and **Grouping** steps.
6. Save.

## General step

| Field | What it does | Required |
| --- | --- | --- |
| **Job type name** | The name shown when you pick a job type. | Yes |
| **Warehouse** | The warehouse the type belongs to. It can't change after creation. | Yes |
| **Operation type** | **Picking**, **Count**, **Replenishment** or **Work Order**. | Yes |
| **Allocation algorithm** | The algorithm that reserves stock for jobs of this type. | Yes, for Picking and Work Order |
| **Description** | Shown under the name in job type lists. | Yes |

## Templates

A template presets the order scope, flags and batch size on the next step. You can still change every setting.

| Template | What it sets up |
| --- | --- |
| **Custom** | Proceed without using a template. |
| **Single Item Order** | One unit per order: pick in a batch, pack straight from the cart. Batches of 1 to 50 orders. |
| **Multi-Item Orders** | Several items per order: pick to totes and sort before packing. Batches of 1 to 20 orders. |
| **Identical Item Orders** | Orders with the same lines are batched together. Batches of 2 to 100 orders. |
| **Pre-Cartonization** | Cartons are suggested before picking; pick straight into the box. |
| **Single SKU Cluster Pick** | One SKU per cluster, consolidated pick across orders. |
| **Putwall Process** | Pick in bulk, then sort orders into putwall cells. |
| **Retailer Compliance** | B2B retailer orders with compliance labels and a loading step. |
| **Identical Kit to Order** | Kits with identical components picked and assembled together. |

## Settings step

**Order scope** limits the job type to **All Orders**, **Identical Item Orders**, **Single Item Orders**, **Multi-Item Orders** or **Identical Kit to Order**.

**Picking flow** has ten Yes or No flags:

| Flag | What it does |
| --- | --- |
| **Override for last job** | Orders that arrive while the last job of this type is open are added to it. |
| **Only pick** | Jobs stop after picking: no packing tasks are created. |
| **Only pack** | Picking is done outside the system; jobs only contain packing tasks. |
| **Create loading task** | Adds a loading task per order after packing. |
| **Disable full LP picking** | Pickers must scan items, even when a whole LP is allocated. |
| **Auto complete picking tasks** | Picking tasks complete automatically when the order is packed. |
| **Create sorting task** | Adds a sorting step between picking and packing. |
| **One by one sorting** | Each unit is scanned during sorting. Needs **Create sorting task**. |
| **Disable tote scanning** | Pickers do not have to scan a tote before picking. Needs **Create sorting task**. |
| **Enable picker self-assign** | Pickers can assign pool jobs to themselves. |

**Batch size** sets how many orders (or items) one job may hold. Choose **Number of orders** or **Number of items**, then the min and max. When you create a job by hand, the batch size you enter must stay in this range.

**Select mobile screen type** offers **Pick and sort** and **Pick to location**. Set one to **Use**; the screens are mutually exclusive.

**Retailer compliance** appears for retailer flows. It sets the **Retailer flow type** (UCC labels before picking, or after picking when the parent LP is scanned), the **UCC label scanning type** and the **Default retailer label print option**.

## Conditions and pick sequence

On **Conditions**, add order conditions. Orders must match every condition to join a job of this type. You can filter on fields such as **Client**, **Channel**, **Carrier**, **Priority**, **Order quantity**, **Is back order**, **Is gift**, **SKU**, **Order tag** and custom fields.

**Order by picking method** sets the task sequence inside the job. Drag to change the precedence. Options include **Walking path priority**, **Location code**, **Location aisle**, **Location level**, **Location zone**, **Expiry date**, **Lot / batch number** and **SKU**.

## Grouping

**Group by** puts orders that share a value into the same job. Choose from **Location zone**, **Product group**, **Carrier**, **Area type**, **Client** and **Order tag**. The order of the values sets the precedence.

## Related pages

- [AI job batches and walk ordering](/docs/wms/job-ai-batches-and-walk-order)
- [Create picking jobs from orders](/docs/wms/job-create-picking-jobs)
- [Create and run wave rules](/docs/wms/wave-rules)
