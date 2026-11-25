---
title: Pack an order at the packing station
description: Scan a tote, location, putwall or order, scan each product into packages, capture serials and lots, close packages and complete packing.
section: Packing and shipping
order: 20
---

The pack screen takes one order at a time. You load orders by scanning what they arrived in, scan every unit into a package, weigh and close the package, then complete packing. Completing packing buys the label (unless you pack without one) and moves the order on to **Ready to Ship**, or **Ready to Load** when the job type adds loading.

## Before you start

- Choose your warehouse and station. See [Set up the packing station](/docs/wms/pack-packing-station-setup).
- Without the Execute Task permission the screen opens as a **Read-only view**: you can look up orders and totes, but packing, labels and issue reports are disabled.

## Load the orders

Pick the mode tab at the top of the pack screen, then scan or type in the scan field.

| Mode | Scan field | What you scan |
| --- | --- | --- |
| **Tote** | **Scan tote** | The tote or LP number, for example `TOTE-0042`. |
| **Location** | **Scan location** | The location code or barcode where orders are staged. |
| **Order** | **Scan order** | The order code, store order number or tracking number. |
| **Putwall** | **Scan putwall / mobile cart** | The putwall or cart code. |

The screen lists the orders found, with how many are already packed. Select the order to pack. In **Order** mode, an order that can't be packed opens with the reason, for example "Release the hold before packing" or "already packed. Open the order to reprint the label."

## Scan products

1. Scan each unit in **Scan product**. It accepts the SKU, barcode or FNSKU.
2. Each scan packs one unit into the open package. A wrong item beeps and shows an error.
3. For serial-tracked SKUs, the field changes to **Scan serial number of** the SKU. Scan the serial. **Esc** cancels the serial scan.
4. For lot or expiry tracked SKUs, fill in the **Tracking capture** fields: **Lot number** and expiry date.

Callouts above the scan field show **Packing instructions**, a **Gift note** and any packing warning for the order.

## Build the packages

Each package card shows **Package** and its number, its state (**Open**, **Packing** or **Closed**) and the units in it.

| Field | What it does | Required |
| --- | --- | --- |
| **Package type** | A shipment package. It fills in the dimensions. | Yes, or enter L, W and H |
| Dimensions | Length, width and height. | Yes |
| **Weight** | Pounds and ounces. Max 150 lb per package. | Yes |

- **Close pack** (**F2**) closes the open package. A package needs at least one item, dimensions and a weight.
- **Add package** opens the next package. Scans go into it. The limit is 50 packages.
- Select the remove icon on a line to take one unit back out.
- Select a closed package's header to reopen it.

If the client does not allow multiple packages per order, **Add package** is disabled with that reason.

## Save progress and resume

Scans are saved as you go. The footer reads "Progress saved. Reopening this order resumes here." When you or another packer reopens the order, a banner shows how many units were already scanned, when and by whom. Select **Start over** to discard the saved progress.

## Packing warnings

An order with a packing warning type shows its warning when the order is displayed, when a product is scanned or when you close a package, depending on the warning's trigger. Read it and select **Acknowledge and continue** (or **OK** when no confirmation is needed).

## Complete packing

1. Choose the carrier and service, or check the one from the order. See [Buy labels and compare rates while packing](/docs/wms/pack-labels-and-rates).
2. Press **F9** or select the complete button. The first press gets the rate; the button then reads **Buy label** with the rate.
3. Press again to buy the label and complete.

Complete closes the open package for you. The result panel shows the status, tracking number and print status. Select **Pack next order** to open the next order from the same tote or cart, or **Scan next**.

If the order has **Is Auto Ship** set, a packed order that reaches **Ready to Ship** with a label is shipped straight away.

## Messages you may see

| Message | Meaning |
| --- | --- |
| Pack every item first | Some units are not scanned. Use **Report issue** for missing items. |
| Scan items into a package first | Every package is empty. |
| Choose a carrier and shipping service | Needed to buy a label. |
| has an open pack short issue | Resolve the pack short on the order before packing it. |
| No allocated order found. Please transfer the products to another location. | The tote, cart or location holds no order that can be packed. |
| Locked by count plan | A count plan locks the station or the staged stock. Finish the count first. |
| This order changed since you opened it | Reload and try again. |

## Related pages

- [Report a pack issue and use hospital locations](/docs/wms/pack-report-issue-and-hospitals)
- [Ship orders](/docs/wms/ship-orders)
- [Mobile carts and totes for picking](/docs/wms/pick-mobile-carts-and-totes)
