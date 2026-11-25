---
title: Ship orders
description: Confirm Ready to Ship orders as shipped from the backlog or the order page, ship partly packed orders, and learn the label and packing rules Ship order checks.
section: Packing and shipping
order: 50
---

Shipping is the last step of the outbound flow. **Ship order** consumes the packed stock, stamps the actual shipment date on the labels and moves the order to **Shipped & Canceled Orders**. A partly packed order ships what is packed and stays in the backlog as **Partially Shipped** for the rest.

## Before you start

- The order must be **Ready to Ship**: packed and, in most cases, labeled.
- You need permission to ship shipment orders.

## Ship from the backlog

1. Go to **Fulfillment > Shipment Orders**.
2. Select the **Ready to Ship** orders. Filter by status to find them.
3. Open **Warehouse ops** and choose **Ship order**.
4. Read **Are you sure you want to ship orders?** and select **Yes**.

The window lists each order. When some orders are only partly packed, a **Shipment** column shows which ones ship in full and which ship partly.

## Ship from the order page

1. Open the order.
2. Open **Other actions** and choose **Ship order**.
3. Confirm **Are you sure you want to ship this order?**

## What shipping does

- Packed units leave inventory.
- Orders that ship in full move to **Shipped** and to **Shipped & Canceled Orders**.
- Orders that are only partly packed: the packed units ship, the order becomes **Partially Shipped** and stays in the backlog with the remaining units.
- The labels get the actual shipment date and join the carrier's End Of The Day manifest.
- Workflows with the **Order Shipped** trigger run.

## Rules Ship order checks

| Message | What to do |
| --- | --- |
| Only Ready to Ship orders can be shipped. | Finish packing first. |
| has no active shipping label. | Create a label. See [Manage carrier labels](/docs/wms/ship-carrier-labels). |
| has no active shipping label (its label was voided). Create a new label before shipping. | A voided label means the parcel never went to the carrier. |
| Nothing is packed for order | Pack the order first. |

Order types with **Allow shipment without label** ship without a carrier label. Orders whose label was voided still need a new label.

## Other ways orders ship

- **Is Auto Ship** orders ship as soon as packing completes with a label. See [Pack an order at the packing station](/docs/wms/pack-orders).
- A shipment plan's **Ship** ships every Ready to Ship order on the truck. See [Plan truck loads with shipment plans](/docs/wms/ship-shipment-plans).

## After shipping

- Open **Fulfillment > Shipped & Canceled Orders** to find shipped orders. The view opens on the last 7 days of actual shipment date.
- From there, **Label > Create return label**, **Create RMA** and **Bulk update return info** prepare returns. See [Create an RMA](/docs/wms/return-create-rma).

## Related pages

- [End of the day manifests and carrier pickup](/docs/wms/ship-end-of-day-and-pickup)
- [Outbound order lifecycle and statuses](/docs/wms/outbound-order-lifecycle)
