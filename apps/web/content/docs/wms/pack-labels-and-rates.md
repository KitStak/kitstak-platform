---
title: Buy labels and compare rates while packing
description: Choose a carrier and service on the pack screen, compare rates across carrier accounts, upload a pre-generated label or pack without one, and print documents.
section: Packing and shipping
order: 30
---

The carrier panel on the pack screen decides how the order ships. KitStak always shows the rate before it buys a label: the first press of **F9** quotes, the second buys. You can also compare every service across your carrier accounts, upload a label someone else produced, or complete packing without a label.

## Before you start

- The warehouse needs an active carrier connection. Otherwise the panel shows **No carrier available** and you can only pack without a label or upload one.
- You need the Create Label permission to buy labels from the pack screen.

## Choose the carrier and service

1. On the pack screen, check **Carrier** and **Shipping service**. They come from the order when it names a service.
2. Close at least one package. Rates use the closed package sizes and weights.
3. Select **Get rate** to see the quote for the chosen service.

When you change packages after a quote, the quote goes stale and is fetched again on the next try.

## Compare rates

The **Rate shop** card compares every service across the client's carrier accounts for the current packages.

1. Select **Compare rates**.
2. Review the table of **Service**, **Rate** and **Transit**.
3. Select **Cheapest** or **Fastest** to use that carrier and service, or choose a row.

Accounts that returned no rate are listed under the table. If you change the packages, the card reads "The packages changed since this comparison. Compare again for current rates." Select **Compare again**.

## Complete packing with a label

The main button changes as you go:

| Button text | What happens |
| --- | --- |
| **Get rate and review** | Quotes the chosen service. Nothing is bought yet. |
| **Buy label** with the rate, then **and complete** | Buys the label and completes packing. |
| **Complete packing and create label** | Shown before a quote is available. |
| **Complete packing (uploaded label)** | Completes packing with the label you uploaded. |

If no rate comes back, the screen says "No rate came back for this service. Change the service, or press F9 again to buy the label without a quote."

If the carrier rejects the label after packing, the result shows **Label not created**. The order is packed; create the label from the order or from **Carrier Shipment Details**.

## Upload a pre-generated label

1. Select **Upload pre-generated label** in the carrier panel.
2. Choose the label file. It is attached to the order as a **Shipment Label** document.
3. Complete packing with **Complete packing (uploaded label)**.

Select **Replace pre-generated label** to swap the file.

## Pack without a label

1. Open **Other actions** and choose **Pack without label**.
2. Confirm **Pack** the order **without a label?**

Packing completes and the order moves to **Ready to Ship** with no tracking number. Create or upload the label later from the order. If the client has disabled packing without a label, the item is disabled and reads "Packing without a label is disabled for" the client.

## Print documents

**Other actions** has a **Print actions** group:

- **Packing slip**: PDF of the items being packed.
- **Shipping label**: one item per active label, with its tracking number. Labels are created when packing completes.
- **Create retailer label** and **Reprint retailer label**: case labels for B2B retailer orders. The order needs a retailer.

After **Complete packing**, labels and the packing slip are sent to your printer setup. The result panel reads **Printed** with what printed, or lists what was not printed so you can use **Reprint packing slip** and the label buttons.

## Related pages

- [Pack an order at the packing station](/docs/wms/pack-orders)
- [Rate shopping presets](/docs/wms/automation-rate-shopping-presets)
- [Manage carrier labels](/docs/wms/ship-carrier-labels)
