---
title: Manage carrier labels
description: Create, reprint and void carrier labels, refresh tracking, create return and retailer labels, and find carrier errors in Carrier Shipment Details.
section: Packing and shipping
order: 60
---

**Carrier Shipment Details** lists every carrier label, one row per package. Labels appear here as soon as an order gets one from the packing station, the order screen or a job. Use this page to buy labels for orders that don't have one, reprint or void labels, follow tracking and fix carrier errors.

## Before you start

- You need the Carrier Shipment Details view permission, plus the label permissions for each action.
- The warehouse needs an active carrier connection.

## Find a label

1. Go to **Fulfillment > Carrier Shipment Details**.
2. Search by order code, tracking or master tracking number, or customer.
3. Select **Carrier errors** to show only labels with a carrier error.

| Column | What it shows |
| --- | --- |
| **Order code** and **Package** | The order and package number. |
| **Tracking number** and **Master tracking number** | Carrier tracking. Multi-package shipments share a master number. |
| **Label status** | **Active** or **Voided**. |
| **Carrier** and **Shipment method** | The carrier and service. |
| **Rate** and **Shipping cost** | What the label cost. |
| **Label type** | Shipping label or return label. |
| **Rate shopping** and **Rate shopping name** | Whether a preset chose the service. |
| **Label create date**, **Actual shipment date**, **Delivery date** | Key dates. |
| **Tracking status** | The latest carrier status. |

Select a row and choose **Package details** to see the package, ship to, insurance and dimensions.

## Create labels for orders

1. Select **Create label**.
2. Search for orders by order code, customer or store order number.
3. Select the orders and select **Create label**. With several orders the button reads, for example, **Create 3 labels**.

KitStak buys a carrier label per order with the order's carrier service, or the best rate when it names none. Labels join today's End Of The Day manifest. The result lists each order as **Created** or **Error**, with an **Open label** link.

You can also create labels from the backlog with **Label > Create label**, which buys labels and opens the PDF in a new tab. It works for orders that are **Open**, **Ready to Pick**, **Packing Started**, **Ready to Load**, **Loading Started**, **Ready to Ship** or **Partially Shipped** and have no active label.

## Reprint and download

- Row menu **Download label** or **Reprint** opens the label file.
- Select several rows and choose **Reprint labels**. Voided labels can't be reprinted.

## Void labels

1. Select the labels and choose **Void labels**, or use **Void label** in the row menu.
2. Review the list and confirm with **Yes, void**.

The carrier cancels the label and the package leaves today's end of the day manifest. This can't be undone. A label can't be voided when:

- It is already voided.
- The package already shipped.
- It is past the 30-day carrier void window.

## Tracking

- **Refresh tracking** asks the carrier for the latest status of the selected labels. Voided labels have no tracking.
- **Track** opens the carrier's public tracking page, when the carrier has one.

## Return, retailer and short labels

| Action | Rule |
| --- | --- |
| **Create return label** | Select one shipped package with a shipping label. The return label reuses its carrier service. |
| **Create retailer (UCC) label** and **Reprint retailer (UCC) label** | For retailer orders. |
| **Pick / pack short label** | For orders with a pick or pack short. |

## Related pages

- [Buy labels and compare rates while packing](/docs/wms/pack-labels-and-rates)
- [End of the day manifests and carrier pickup](/docs/wms/ship-end-of-day-and-pickup)
- [Rate shopping presets](/docs/wms/automation-rate-shopping-presets)
