---
title: Mobile carts and totes for picking
description: Set up mobile carts with numbered cells, print cart and cell labels, put a picking job on a cart, and use carts and totes at the packing station.
section: Outbound
order: 100
---

A mobile cart is a rolling rack of cells. Each order in a picking job gets its own cell, so one picker can collect many orders in one trip and sort as they go. A tote is a container tracked as an LP. Both carry picked units to the packing station, where you scan the cart or tote to pack the orders inside.

## Before you start

- You need permission to view and edit mobile carts.
- Cart types (for example a 24-bin cart) set the default number of levels and columns.

## Create a mobile cart

1. Go to **Settings > Mobile Carts**.
2. Select **Create mobile cart**.
3. Fill in the **Mobile cart** step.
4. On **Cell list**, check the cell names and barcodes.
5. Select **Create mobile cart**.

| Field | What it does | Required |
| --- | --- | --- |
| **Code** | The cart code, for example `MC-05`. | Yes |
| **Warehouse** | Where the cart works. A cart can't move between warehouses. | Yes |
| **Mobile cart type** | Sets the default levels and columns. You can add a type from the field. | Yes |
| **Operation type** | **Picking** or **Replenishment**. | Yes |
| **Description** | For example "24-bin pick cart". | No |
| **Levels** and **Columns** | The layout, up to 20 levels and 20 columns. | Yes |
| **Allow multiple jobs** | Several open jobs may share this cart. | No |
| **Dynamic cart** | Cells are assigned to orders as they are scanned. | No |

Each cell is named by its level letter and column: `A01` is level A, column 01. Its barcode is the cart code plus that name, for example `MC-01-A01`. Cell labels print the same.

**Duplicate** in the row menu copies a cart under a new code.

## Print cart and cell labels

1. Select the carts in the grid.
2. Select **Label**.
3. Choose **Cart and cell labels** (the cart plate, then every cell), **Cart labels only** or **Cell labels only**.

## Put a picking job on a cart

1. Open the cart with **Show details**.
2. Under **Put a picking job on this cart**, choose an open picking job.
3. Select **Put on cart**.

Each order gets the next free cell (`A01`, `A02` and so on). The picker scans the cell barcode, for example `MC-01-A01`, to sort into it. The cart status reads **Occupied** while an open job holds it. A cart without **Allow multiple jobs** takes one job at a time.

The detail drawer shows every cell with the order it holds and its picked and planned units.

## Empty a cart

1. Open the cart and select **Empty cart**.
2. Confirm.

This frees the cells and takes the open job off the cart. Picked units are not moved.

## Print the cart layout

In **Job Management**, select a job that uses a cart and choose **Print > Mobile cart layout**. It shows which order goes in which cell.

## Totes

- At the packing station, choose **Scan a tote** and scan the tote or LP number to load the orders picked into it. See [Pack an order at the packing station](/docs/wms/pack-orders).
- Job types with **Create sorting task** expect pickers to scan a tote before picking, unless **Disable tote scanning** is on.
- **Resolve pack short** sends unpacked units back to the picked tote.

## Pack from a cart or putwall

Choose **Scan a putwall / mobile cart** at the packing station and scan the cart code. The screen lists the orders sorted into its cells.

## Related pages

- [Picking job types and batch templates](/docs/wms/job-types-for-picking)
- [Manage jobs in Job Management](/docs/wms/job-management)
- [Set up the packing station](/docs/wms/pack-packing-station-setup)
