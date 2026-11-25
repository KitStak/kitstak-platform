---
title: Order, receiving and performance reports
description: Read the Channel Sales Report, Order Line Progress, PO Receiving Report and User Performance Report, with what each column counts and the default filters.
section: Reports and analytics
order: 30
---

These four reports look at orders, receiving and people. Channel sales shows what sold where, order line progress shows what still needs picking and packing today, PO receiving compares what arrived with what was ordered, and user performance shows each associate's work per day.

## Before you start

- Each report needs its **View** permission in the **Reports** group. **Order Line Progress** needs **Shipment Orders** view.

## Channel Sales Report

Go to **Reports > Orders > Channel Sales Report**. One row per product, channel and store.

| Column | What it shows |
| --- | --- |
| **SKU**, **Product Name** | The product. |
| **Sold Quantity** | Units on shipped, partially shipped and delivered orders. |
| **# Shipment Orders** | How many orders. Select the number to open those orders. |
| **Revenue** | Revenue from those order lines. |
| **Channel**, **Store Name** | Where it sold. |
| **Warehouse**, **Client** | Where it shipped from and for whom. |
| **Barcode**, **Pack Type** | Product identifiers. |
| **Last Shipment Date** | The most recent shipment. |

The report opens with the chip **Has Sales?** set to yes, so listings that have not sold are hidden. Remove the chip to include them. It sorts by revenue, highest first.

## Order Line Progress

Go to **Reports > Orders > Order Line Progress**. Every line of an open order or an order shipped today, with its progress. These are the same lines the dashboard's **Order Lines** row counts.

| Column | What it shows |
| --- | --- |
| **Order Code**, **SKU**, **Product Name** | The line. |
| **Line State** | **Packed**, **Picked, not packed** or **Not picked**. Every line is in exactly one state. |
| **Required Qty**, **Picked Qty**, **Packed Qty** | Quantities so far. |
| **To Pick**, **To Pack** | What is left. |
| **Order Status**, **Order Group** | The order's status. |
| **Warehouse**, **Client**, **Pack Type** | Where and for whom. |
| **Order Date**, **Expected Ship Date** | Dates. |

A packed line counts once even if pick data lags behind. Filter **Line State** to see what still needs picking or packing.

## PO Receiving Report

Go to **Reports > Receiving > PO Receiving Report**. One row per purchase order line.

| Column | What it shows |
| --- | --- |
| **PO Code**, **SKU**, **Pack Type** | The PO line. |
| **PO Quantity** | Ordered quantity in the line's pack type. |
| **Units per Pack** | From the product's pack type hierarchy. Each is 1. |
| **PO UOM Quantity** | PO quantity times units per pack. |
| **Received UOM Quantity** | Everything received on the line, in units. Canceled receipts are left out. |
| **Receiving Difference** | Received minus ordered. Red is short, green is over, blank when they match. |
| **PO Status** | The purchase order's status. |
| **Damaged Quantity** | Units received as damaged. |
| **Product Name**, **Warehouse**, **Client**, **Barcode** | Details. |

## User Performance Report

Go to **Reports > Warehouse Efficiency > User Performance Report**. Each row is one associate's work on one warehouse day. It opens with the chip **Period: Last 7 days**; choose **Last 30 days** or **Last 90 days**, or filter by **Activity Date**, **User** or warehouse.

| Column | What it counts |
| --- | --- |
| **Picked Order Qty**, **Picked Order Line Qty**, **Picked Item Qty** | Orders, lines and units picked. |
| **Packed Order Qty**, **Packed Order Line Qty**, **Packed Item Qty** | Orders, lines and units packed. |
| **Sorted Order Qty**, **Sorted Order Line Qty**, **Sorted Item Qty** | Orders, lines and units sorted. |
| **Replenished Item Quantity**, **Replenished LP Quantity** | Units and LPs moved by replenishment tasks. |
| **Received Item Quantity**, **Received LP Quantity** | Units and LPs received. Canceled receipts are left out. |
| **Counted Item Quantity**, **Counted Location** | Units counted and locations counted. |
| **Returned Item Quantity**, **Returned Order Quantity** | Units and return orders received. |
| **Tasks** | Completed pick, pack, sort and replenishment tasks. |
| **Timed Tasks %** | Share of the day's tasks with a recorded start and finish scan. The rest have only a finish time. |
| **Timed Minutes** | Minutes between start and finish scans on timed tasks, each task capped at 30 minutes. |

Hover a column header for its exact definition. Search by the user's name.

> **Note:** Users whose roles don't include **View** on the **Users** page see only their own rows, and the report says **Showing your own work only**. Supervisors and admins see every associate. The Excel export follows the same rule.

## Related

- [Report Hub and the list of reports](/docs/wms/analytics-hub-and-catalog)
- [Labor analytics and operational dashboards](/docs/wms/analytics-labor-and-operational)
- [Export and schedule reports](/docs/wms/analytics-export-and-schedule)
