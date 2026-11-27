---
title: Log value-added services (VAS)
description: Define VAS types, log VAS operations such as relabeling or kitting by hand or from Excel, and bill them through a VAS fee on the client's billing form.
section: Billing
order: 80
---

Value-added services are jobs you do for a client outside the normal flow, such as relabeling cases, gift wrapping or building display packs. You log each one as a VAS operation with a date and a value, and a VAS fee on the client's billing form bills them in the next calculation.

## Before you start

- You need the **VAS Operations** page with **Create**, **Edit**, **Delete** or **Import File** as needed.
- The client's billing form needs a **VAS** fee for the VAS type. See [Add fees to a billing form](/docs/wms/billing-fees).

## Define a VAS type

VAS types live in Data Setup.

1. Go to **Settings > Configuration > Data Setup** and select **VAS Type**.
2. Select **Create new vas type**.
3. Enter the name, for example `Case relabel`.
4. Choose the **VAS calculation type**.
5. Choose a **Client**, or leave it empty to offer the type for every client.
6. Save.

| VAS calculation type | How the value is billed |
| --- | --- |
| **Total Price** | The value you log is the price. The VAS fee bills it as entered. |
| **VAS quantity** | The value you log is a quantity. The VAS fee bills it times the fee's rate. |

New VAS types start on **Total Price**.

## Log a VAS operation

1. Go to **Settings > Client Setup > VAS Operations**.
2. Select **Create a VAS operation**.
3. Fill in the **Operation** section, and optionally the **Reference** and **Note**.
4. Save. KitStak bills it on the next calculation under the client's VAS fee.

| Field | What it does | Required |
| --- | --- | --- |
| **Client** | Only active clients are listed. | Yes |
| **Warehouse** | The warehouse where the work was done. | Yes |
| **VAS type** | Types for this client or for all clients. Choose a client first. | Yes |
| **Operation date** | When the work was done. It decides the billing period. | Yes |
| **Operation price** or **Operation value** | A price for a **Total Price** type, a quantity for a **VAS quantity** type. More than 0 and at most 1,000,000. | Yes |
| **Reference order type** | **Shipment Order**, **Purchase Order** or **Work Order**. | With a reference number |
| **Reference number** | The order the work belongs to, for example `SO000123`. Up to 100 characters. | With a reference order type |
| **Note** | Up to 200 characters. | No |

## Import VAS operations from Excel

Select **Import** on the **VAS Operations** page. The file has these columns:

```csv
Warehouse Code,Client Code,VAS Type,Order / PO Code,Quantity,Notes
```

All columns except **Notes** are required.

## The VAS Operations list

Columns: **VAS type**, **Client**, **Warehouse**, **Operation date**, **Calculation type**, **Value**, **Reference order type**, **Reference number**, **Note**, **Created by** and **Created date**. Each row has **Show details**, **Edit**, **Change log** and **Delete**. You can delete several operations at once.

## How VAS operations meet bills

| Where the operation falls | What happens |
| --- | --- |
| Inside an approved bill | The operation is locked: **Billed in approved bill** with the bill number. Cancel that bill's approval before changing it. |
| Inside a draft bill | You can change it, but the draft is marked outdated. KitStak shows **Draft bill outdated**. Calculate the draft again before approving. |
| In a period with no bill yet | Billed on the next calculation. |

Deleting a selection skips operations inside approved bills.

## On the bill

VAS lines are listed on the bill's **Detailed** tab with the operation date, reference and note, so the client can see which job each charge came from.

## Related

- [Calculate, review and approve bills](/docs/wms/billing-calculate-and-approve-bills)
- [Add fees to a billing form](/docs/wms/billing-fees)
- [How 3PL billing works](/docs/wms/billing-overview)
