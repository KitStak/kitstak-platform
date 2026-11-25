---
title: Create and edit a shipment order
description: Enter a shipment order by hand with the six-step order wizard, then open the order detail page to edit it, print documents and follow its jobs and labels.
section: Outbound
order: 20
---

Most orders reach KitStak WMS from a sales channel or an import. When you need to enter one by hand, the order wizard walks you through six steps and checks every required field before it saves. After saving, the order detail page is where you edit the order and follow its jobs, labels and activity.

## Before you start

- You need permission to create shipment orders. Without it the **Create shipment order** button does not show.
- The client must have products. The warehouse must have an order type set up in Data Setup.

## Create an order

1. Go to **Fulfillment > Shipment Orders**.
2. Select **Create shipment order**. On a phone the button reads **New order**.
3. Fill in each step and select **Next step**. Use **Back** to return to an earlier step.
4. On **Confirm**, check each card. Select the edit icon on a card to jump back to that step.
5. Select **Save order** in the right rail. The rail shows **Ready to save** once every required field is complete.

If you leave and come back in the same session, the wizard shows **Draft restored**. Select **Start over** to clear it. **Cancel order** in the header leaves the wizard without saving.

To import many orders at once, open **Import** and choose **Bulk import shipment orders**. **Bulk update shipment orders** updates existing orders by order code.

## Step 1: Order details

| Field | What it does | Required |
| --- | --- | --- |
| **Warehouse** | The warehouse that ships the order. | Yes |
| **Client** | The client that owns the stock. | Yes |
| **Order code** | Generated from the code sequence. Must be unique. | Yes |
| **Order type** | An order type from Data Setup. | Yes |
| **Order date** | When the order was placed. | Yes |
| **Expected shipment date** | When the order should leave. | Yes |
| **Expected delivery date** | Promised delivery date. | No |
| **Carrier expected delivery date** | Delivery date the carrier gave. | No |
| **Scheduled pickup date** | Planned carrier pickup. | No |
| **Scheduled shipment date** | Planned ship date. | No |
| **Store order #** | The order number in the sales channel. | No |
| **Priority** | A number from 0 to 9999. Higher numbers are picked first: 1 Low, 2 Medium, 3 High, 4 and above Urgent. | No |
| **Note** | Notes for the warehouse team. | No |

## Step 2: Customer & address

Pick a **Customer** or type the details. The **Shipment address** needs **Address line 1**, **Country**, **City** and **Postal code**. For US addresses the postal code must be a 5-digit ZIP or ZIP+4. You must enter the customer's first or last name.

Select **Verify address** to normalize the address before picking. Turn on **Skip address verification** to save the address exactly as entered. Add a **Billing address** when it differs; it then needs line 1, city and country.

## Step 3: Products

1. Type in **Find by SKU** and choose the product.
2. Open a line to set **UOM pack type**, **Quantity** and **Price per item**. The drawer also shows **Available pack quantity**.
3. Under **Inventory details** you can pin the line to an **Expiry date**, **Production date**, **Lot batch number**, **Damage reason**, **Inventory location** or **Inventory LP**.

The chips above the grid show **Number of SKU**, **Number of kits** and **Total qty**. An order needs at least one product, and every quantity must be at least 1.

## Step 4: Shipping

| Field | What it does |
| --- | --- |
| **Carrier** and **Shipping service** | The service used when the label is bought. Select **Get rates** to see quotes. |
| **Rate shopping preset** | Lets the label pick the cheapest or fastest service. See [Rate shopping presets](/docs/wms/automation-rate-shopping-presets). |
| **Shipping charges billing type** and **Tax & duties billing type** | Who pays the carrier. |
| **Use custom shipping account** | Bill a third-party account number. |
| **Shipment package** | The box packers should use. |
| **Packing instructions** | Shown to the packer on the pack screen. |
| **Return carrier**, **Return shipping option**, **Return shipping cost** | Return info for this order. |

## Step 5: Other info

Add up to five extra notes, a **Client reference code**, **Fraud** text and a **Packing warning type**. Turn on **Gift** to add a **Gift note**. For retailer (B2B) orders, fill in **Retailer**, **BOL**, **PRO**, **PO**, **Dept**, **Mark for** and **Retailer customer account number**. Custom fields appear at the end.

## Work with the order detail page

Select an order code in the backlog, or choose **Show details** from the row menu. The page title reads **Shipment order** followed by the code. It has four tabs: **OVERVIEW**, **EDIT ORDER**, **JOBS & SHIPMENTS** and **ACTIVITY**.

The right rail shows:

- **Summary**: warehouse, client, order type, store order number, master order and backorders.
- **Assigned jobs**: the picking job. Select **+** to assign one. A pending job can be unassigned here.
- **Printouts**: **Shipment label**, **Packing slip** and **Picking list**. The picking list is available once a picking job exists.
- **Packages & tracking** and **Billing charges**.

**Other actions** holds **Ship order**, **Put on hold** or **Release hold**, **Duplicate order** (a new Open order with the same lines), **Cancel order** and **Delete order**.

## Edit rules

- Lines are locked while stock is allocated. Remove the order from its job to change them.
- A **Shipped**, **Partially Shipped**, **Delivered** or **Cancelled** order only allows changes to notes and return info.
- A banner shows when the order is on hold or blocked by a workflow. Users who can edit orders can select **Release** on a workflow block.
- **Delete** works only on **Open** orders that are not in a job. The change log keeps a Delete entry.

## Related pages

- [Outbound order lifecycle and statuses](/docs/wms/outbound-order-lifecycle)
- [Hold, release, cancel and delete orders](/docs/wms/order-holds-and-cancellations)
- [Create picking jobs from orders](/docs/wms/job-create-picking-jobs)
