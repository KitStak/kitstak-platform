---
title: Create a purchase order
description: Create a purchase order in KitStak WMS with the PO wizard, or import purchase orders and pre-advised serial numbers from Excel.
section: Inbound
order: 20
---

The purchase order wizard has five steps: **PO details**, **Products**, **Vendor**, **Other info** and **Confirm**. A progress ring shows how far you are, and the side rail keeps the PO number, client, vendor, number of SKUs and total quantity in view. You can also load many purchase orders at once from Excel.

## Before you start

- You need the **Create** permission on **Purchase Orders**.
- The warehouse, the client and the client's products must exist. You can create a vendor or a product from inside the wizard if your role allows it.

## Create a purchase order

1. Go to **Inventory > Purchase Orders**.
2. Select **Create purchase order**.
3. Fill in each step and select **Next**. **Next** stays disabled until the step is valid, and says why.
4. On **Confirm**, review the order and select **Confirm purchase order**.

The new PO is saved as **Pending**. After saving you can go to the purchase order list, create another purchase order, or view receiving history.

## PO details step

| Field | What it does | Required |
| --- | --- | --- |
| **Warehouse** | Where the stock will arrive. Can't change after receiving starts. | Yes |
| **Client** | Who owns the stock. Products and vendors are limited to this client. | Yes |
| **PO number** | The order code, up to 50 characters: letters, numbers, spaces, dots, dashes or slashes. The wizard checks that it is unique and shows **Already exists** if not. | Yes |
| **PO type** | **Purchase Order**, **Purchase Order- Non Crossdock**, **Transfer Order**, **Return Order** or **Open Order**. | Yes |
| **PO date** | The order date. | Yes |
| **Planned receiving date** | When you expect to receive it. | No |
| **Actual receiving date** | Stamped automatically when the order is fully received. | No |
| **Planned arrival date**, **Actual arrival date** | When the truck is due and when it came. | No |
| **Reference number** | Your vendor's order or invoice number. Up to 100 characters. | No |
| **Note** | Free text, up to 500 characters. | No |

PO types in short: **Purchase Order** is standard inbound, put away after receiving. **Purchase Order- Non Crossdock** is never routed to crossdock staging. **Transfer Order** is stock moving in from another warehouse. **Return Order** is customer returns. **Open Order** is a blanket order received in several deliveries.

## Products step

1. Type in **Search by SKU, name or barcode** to find a product of the client.
2. Add it. The **Add product** drawer opens.
3. Enter the **Pack type**, **Quantity** and **Price per pack type**. The total price shows below.
4. Under **Receiving details**, add expected attributes if you know them: **Receiving location**, **Expiry date**, **Production date**, **Lot batch number**, **LP type**, **LP number** and **Line note**. Lot, expiry and production date apply to tracked products only.
5. Save the line. Repeat for each product.

Use **Find PO detail by SKU** to find a line on a long order. Each line's actions menu lets you show, edit or remove it. **Create new product** opens the product wizard without leaving the PO.

Line rules:

- **Quantity** is a whole number from 1 up.
- **Price per pack type** can't be negative.
- When a line has been partly received, its quantity can't go below the received quantity.
- **Expiry date** must be after the **Production date**.
- The order needs at least one product.

## Vendor step

Pick the vendor from the client's vendors. Vendors belong to a client, so choose the client first. Select **Add new vendor** to create one here. An inactive vendor can't be used.

## Other info step

Fill in your company's custom fields for purchase orders. This step is optional. Custom fields become filters on the purchase order list.

## Confirm step

Check the **Vendor**, the **Shipping address**, the **Billing address**, the **Order details** and every line. Select any step to go back and change it. If the PO number was taken while you worked, the step shows **Duplicate PO number**.

## Edit a purchase order

1. Open the purchase order and select **Edit purchase order**.
2. Change any step, then select **Save purchase order**.

Lines of a Completed or Cancelled PO can't change, and the product of a received line can't change.

## Import purchase orders from Excel

1. Go to **Inventory > Purchase Orders**.
2. Select **Import > Purchase orders**. The **Import purchase orders** page opens with a tab per import.
3. Select **Import manual** to read every column with its rules, an example and notes.
4. Select **Download our excel template**, fill it in and drop the file on the page.

How the purchase order import works:

- One row per purchase order line. Rows with the same PO number, client and warehouse become one purchase order.
- A PO number that already exists and is still Pending gets the new lines added. A Started, Completed or Cancelled PO is rejected for that row.
- Vendors are matched by name within the client and created when missing.
- Each row is checked on its own. Valid rows are imported, invalid rows go to the error file with the reason in the last column.

```
PO Code *, Client Code *, Warehouse Code *, Vendor Name *, Vendor Code, PO Type, Expected Receiving Date, Reference Number, SKU *, Quantity *, Unit Cost, Pack Type, Lot Number, Expiry Date, Notes
```

To pre-advise serial numbers, use the **Serial numbers** tab. See [Lots, serial numbers and expiry dates at receiving](/docs/wms/lots-serials-expiry).

## Related pages

- [Purchase orders](/docs/wms/purchase-orders)
- [Receive a purchase order](/docs/wms/receive-purchase-order)
- [Import data from Excel](/docs/wms/excel-imports)
- [Create a product](/docs/wms/create-product)
