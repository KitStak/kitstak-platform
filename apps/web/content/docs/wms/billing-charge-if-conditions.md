---
title: Charge if conditions on fees
description: Limit a fee to the activity that matches conditions on location, LP, product, order, carrier or custom fields, such as only oversized items or one carrier.
section: Billing
order: 60
---

Conditions make a fee charge only part of a client's activity. A shipment fee can charge only orders to one country, a storage fee only hazardous products, a pick fee only oversized items. A fee charges activity that matches every condition on it. A fee with no conditions charges all of its activity.

## Before you start

- The billing form must be in **Draft**.
- **VAS** and **Recurring** fees have no conditions.

## Add a condition

1. Open the fee with **Create fee** or **Edit**, and choose its operation type.
2. In **Conditions**, select **Add condition**.
3. Search for an attribute in the field picker. Only attributes that apply to the fee's operation type are listed.
4. Choose a comparison.
5. Enter or pick the value.
6. Select **Add**. The condition shows as a chip, for example `Ship To Country is any of CA, MX`.
7. Add more conditions if needed, up to 20, then save the fee.

To remove a condition, select the cross on its chip.

## Which attributes each operation can use

| Operation type | Attribute groups |
| --- | --- |
| **Shipment** | Shipment Order, Carrier, SO Detail, Product, and shipment order, shipment plan and product custom fields |
| **Pick & Pack** | Shipment Order, Carrier, SO Detail, Product, Location, and shipment order, product and location custom fields |
| **Receiving** | Product, Location, LP, and product, location and LP type custom fields |
| **Return** | Product, Location, LP, and product, location and LP type custom fields |
| **Storage** | Location, LP, Product, and location, LP type and product custom fields |
| **Work Order** | Product and product custom fields |

KitStak only loads these facts for each operation, so an attribute outside its group could never match and is refused: **Carrier doesn't apply to Storage fees**.

## Attributes

| Group | Examples |
| --- | --- |
| Location | **Location Zone**, **Location Type**, **Location Group**, **Location Volume**, **Location - Area Type**, **Location - Only Damaged Items**, **Location - Only Single SKU** |
| LP | **LP Type**, **LP Volume**, **LP Weight** |
| Product | **Product Type**, **Product Group**, **Product - Sku**, **Product Weight**, **Product Volume**, **Product - Is Hazardous**, **Product - Is Oversized**, **Product - Is Fragile**, **Product - Is Kit Item**, **Product - Lot/Batch Tracking** |
| Shipment Order | **Shipment Order Type**, **SO Store**, **SO Channel**, **Order Tag**, **Priority**, **Ship To Country**, **Ship To State**, **Total Weight**, **Total Quantity**, **Nof Lines**, **SO - Is Gift** |
| Carrier | **Carrier**, **Shipment Method**, **Shipment Package Type**, **Carrier Billing Type**, **CARRIER - Rate**, **Label Cost** |
| SO Detail | **SO DETAIL - Line Note 1** to **SO DETAIL - Line Note 3**, **SO DETAIL - Is Kit Component** |
| Custom fields | Each entity's Text Box 1 to 3, Drop Down 1 and 2, Date 1 to 3 and Toggle 1 and 2, such as **PRODUCT - Custom Text Box 1** |

## Comparisons

| Attribute kind | Comparisons |
| --- | --- |
| Yes or no, such as **Product - Is Hazardous** | **Equals** Yes or No |
| Number, such as **LP Weight** | **Equals**, **Does not equal**, **Greater than**, **Greater than or equal**, **Less than**, **Less than or equal**, **Between**, **Is empty**, **Is not empty** |
| Text, such as **Product - Sku** | **Equals**, **Does not equal**, **Contains**, **Does not contain**, **Starts with**, **Ends with**, **Is any of**, **Is none of**, **Is empty**, **Is not empty** |
| Pick list, such as **Carrier** or **Location Zone** | **Is any of**, **Is none of**, **Is empty**, **Is not empty** |

For pick list attributes you choose values from a list built from master data and the client's own activity, so a typo can't stop the fee from charging. If nothing exists yet, the list reads **No carrier values found for this client**, with the attribute name. **Between** takes a low and a high value. **Is any of** and **Is none of** need at least one value.

## Examples

| Goal | Fee | Condition |
| --- | --- | --- |
| Extra charge for oversized picks | **Pick & Pack**, **Per Picking** | **Product - Is Oversized** **Equals** Yes |
| Cross border shipments | **Shipment**, **Per SO** | **Ship To Country** **Is none of** US |
| Hazardous storage | **Storage**, **LP** | **Product - Is Hazardous** **Equals** Yes |
| Heavy pallets received | **Receiving**, **Per LP** | **LP Weight** **Greater than** 1000 |

## Related

- [Add fees to a billing form](/docs/wms/billing-fees)
- [Storage fees: daily, peak, average and split month](/docs/wms/billing-storage-fees)
- [Calculate, review and approve bills](/docs/wms/billing-calculate-and-approve-bills)
