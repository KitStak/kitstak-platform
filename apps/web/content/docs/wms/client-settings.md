---
title: Client operational settings
description: Set a client's currency and the 28 switches for notification emails, fulfillment, packing and inventory attributes that change how KitStak handles its work.
section: Clients
order: 20
---

Each client has a currency and 28 switches in four groups. The switches change how KitStak treats that client's orders on the floor: which emails go out, how allocation behaves when stock is missing, what packers can and can't do, and which receiving details stay on inventory. Every switch is off until you turn it on.

## Before you start

- You need the **Edit** action on **Clients**.
- The client must exist. See [Create a client](/docs/wms/client-create-a-client).

## Change the settings

1. Go to **Settings > Client Setup > Clients** and open the client.
2. Select the **Settings** tab.
3. Choose the **Currency**. Bills and VAS prices for this client use it.
4. Turn switches on or off. Each group shows how many are on, for example **3 / 17 on**, and a **Turn all on** or **Turn all off** button.
5. Select **Save settings**. The message shows how many of the 28 switches are on. **Discard** throws away unsaved changes.

You can also set the switches on the **Settings** step of the create or edit drawer. Hover the info icon next to a switch to read what it does.

## Notification email settings

Emails sent to the client's contact email.

| Switch | What it does |
| --- | --- |
| **Received PO notification** | Emails the client when one of their purchase orders is fully received. |
| **Daily inventory notification** | Sends a daily on-hand summary per SKU every morning. |
| **Daily inventory by location notification** | Sends the daily on-hand summary broken down by location. |
| **Safety stock notification** | Emails when a SKU's available quantity drops below its safety stock. |

## Fulfillment settings

How allocation behaves when stock goes missing.

| Switch | What it does |
| --- | --- |
| **Prevent reallocation if missing** | When a picker reports missing stock, the line is not reallocated to another location automatically. |
| **Retain allocation during missing** | Keeps the original allocation in place while a missing report is investigated. |
| **Allow different location/LPN** | Lets pickers pick the same SKU from a different location or LP than the one suggested. |

## Packing settings

Packing station rules for this client's orders.

| Switch | What it does |
| --- | --- |
| **Direct print pack list** | Prints the packing list automatically when packing completes. |
| **Enable pack all** | Shows a Pack All button that packs every remaining item in one step. |
| **Disable shipping option change** | Packers can't change the carrier or service chosen on the order. |
| **Disable package change** | Packers can't change the suggested shipment package. |
| **Disable batch order packing** | Orders must be packed one at a time, not as a batch. |
| **Disable carrier rate** | Hides live carrier rates at the packing station. |
| **Do not allow multiple shipment packages** | Every order ships in a single package. |
| **Disable packing without label** | A shipping label must be created before packing can complete. |
| **Enable enter quantity** | Lets packers type a quantity instead of scanning each unit. |
| **Enable package suggestion** | Suggests the best fit shipment package from item dimensions. |
| **Force package type validation** | The scanned package must match the suggested package type. |
| **Direct print attached documents** | Prints documents attached to the order when packing starts. |
| **Scan only pack type barcodes** | Accepts only pack type barcodes at packing, not the base product barcode. |
| **Capture label images for packing list** | Embeds shipping label images on the printed packing list. |
| **Auto complete packing on last scan** | Completes the package automatically when the last unit is scanned. |
| **Use pre-produced labels in multi box packing** | Uses labels printed in advance for each box of a multi box order. |
| **Force cartonization instructions on packing** | Packers must follow the cartonization plan box by box. |

## Advanced settings

Inventory attributes kept from receiving.

| Switch | What it does |
| --- | --- |
| **Keep receiving date on inventory** | Stores the receiving date on each inventory bucket for FIFO and aging. |
| **Allow unique SKU barcodes** | Each SKU must have a barcode no other SKU of this client uses. |
| **Keep PO number on inventory** | Stores the PO number on received inventory for traceability. |
| **Activate receiving verification for physical attributes** | Receivers confirm weight and dimensions of new SKUs on first receipt. |

## Currencies you can choose

USD, CAD, EUR, GBP, AUD, MXN, NZD, SGD, INR, IDR, MYR, MAD, NGN, PKR, PHP, THB, TRY and XOF.

## Good to know

- Every switch change is written to the client's change log as the group and switch name, from Yes to No or No to Yes.
- Saving the **Settings** tab keeps the SSCC-18 values as they are. Change those on the **Others** step of **Edit**.
- If someone else saved the client after you opened it, you see **This client changed since you opened it**. Select **Reload** and make your change again.

## Related

- [Create a client](/docs/wms/client-create-a-client)
- [Client details page](/docs/wms/client-details)
- [Audit log and change logs](/docs/wms/admin-audit-log-and-change-logs)
