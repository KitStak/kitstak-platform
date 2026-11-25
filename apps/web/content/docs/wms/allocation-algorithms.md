---
title: Allocation algorithms and dry run
description: Build allocation rules with order conditions, inventory conditions and order by to decide which stock an order reserves, then dry run them on a real order.
section: Automation
order: 10
---

An allocation algorithm decides which stock an order reserves: which locations, LPs and lots, and in what order. It is a chain of rules read top to bottom. The first rule whose order conditions match the order is used; its inventory conditions filter the stock, and its order by ranks what is left. The dry run shows exactly what an algorithm would reserve for an open order, without reserving anything.

## Before you start

- You need the Algorithms view permission, and edit permission to change algorithms.
- Picking and work order job types name the allocation algorithm their jobs use. See [Picking job types and batch templates](/docs/wms/job-types-for-picking).

## Open the allocation algorithms

1. Go to **Automation > Algorithms**.
2. Choose **Allocation Algorithm** (decide which stock an order reserves). The page also has a **Putaway Algorithm** tab.

The list shows **Name**, **Type**, **Warehouse**, **Active**, **Rule quantity** and **Last updated**.

## Create an allocation algorithm

1. Select **Create Allocation Algorithm**.
2. On **Primary Information**, enter the name, choose the **Warehouse** and set **Algorithm status** to **Active** or **Passive**. The warehouse can't change after you save.
3. Open **Rules** and select **Create New** to add the first rule.
4. Build the rule on the canvas (see below) and select **Save Rule**.
5. Add more rules. Drag rules to change their order.
6. Select **Save**.

With no rules, the default FEFO chain is used.

## Build a rule

The first rule reads **If**, the next ones **1. If else**, **2. If else** and so on. Each rule has a name, which must be unique, and an active switch. The canvas has three sections:

| Section | Question it answers | Examples |
| --- | --- | --- |
| **Order Conditions** | Which orders use the rule | **Client**, **Channel**, **Order Type**, **Carrier**, **Priority**, **Country**, **SKU**, **Is Back Order** |
| **Inventory Conditions** | Which stock is eligible | **Area Type**, **Location Zone**, **Location Group**, **ABC Code**, **Inventory Lot Batch Number**, **Inventory Expiry Date**, **Free Inventory** |
| **Order By** | Which stock goes first | **Expiry Date**, **Receiving Date**, **Walking Path Priority**, **Free Inventory**, **Aisle**, **Level** |

Add a condition with **Add condition**, and an ordering with **Add Order By**. An empty order conditions section reads **Applied to all**. Hover a node to edit, delete or add before or after it.

**Inventory Conditions** also has three preferences: **Prioritize Same Pack Type**, **Prioritize Higher Pack Type** and **Only Allocate Full LPs**.

The canvas footer has **Cancel Rule**, **Test Rule** and **Save Rule**. Save or cancel the open rule before you switch to another rule or save the algorithm.

## Dry run an order

1. On the editor, select **Dry run for order**. In the list, the row menu has the same **Dry run for order** action.
2. Search open orders by code or customer and pick one.
3. Select **Run dry run**.

The dry run uses the unsaved rules on the real allocation engine, then rolls everything back. Nothing is reserved. The result shows:

- The outcome as an order status: **Ready to Pick** (would be fully allocated), **Shortage** (would be short) or **Cancelled** (would fail).
- The rule that matched, as a **Rule** badge.
- Each line with its **Qty** and the **Buckets chosen**: location, LP, lot and expiry. Lines with no stock read **Nothing eligible**.
- Any **Allocation exceptions**, with the same explanations the wave log records.

To commit the allocation, allocate the order from **Job Management** or the order backlog.

## Delete algorithms

Select algorithms and choose **Delete**. System algorithms, the last active replenishment algorithm and algorithms used by job types are skipped and listed in the result.

## Related pages

- [Create and run wave rules](/docs/wms/wave-rules)
- [Wave log and allocation exceptions](/docs/wms/wave-log-and-exceptions)
- [Shortages and backorders](/docs/wms/order-shortages-and-backorders)
