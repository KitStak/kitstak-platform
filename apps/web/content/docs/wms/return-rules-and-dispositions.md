---
title: Return rules and dispositions
description: The eight Return Process rules KitStak enforces on every return receipt, their messages, and where Restock, Damaged, Quarantine and Dispose put stock.
section: Returns
order: 40
---

Return rules decide what the return station accepts. They check every returned line against what actually shipped on the order: the SKU, the quantity, lots, dates, serials and pack type. The condition you choose for each item, called its disposition, decides where the stock goes. Both are shown on the return station so packers know the rules before they scan.

## Before you start

- Return rules are account wide. You change them in Data Setup.
- Every rule is on until an administrator changes it.

## Change the return rules

1. Go to **Settings > Data Setup** and open **Return Process**. The **Return Process settings** link on the return station opens the same page.
2. Turn each rule on or off.
3. Save.

Each change writes a change log entry, for example "Expiry date match: On to Off".

## The eight rules

| Rule | When on |
| --- | --- |
| **Expiry date match** | Accept a return only with an expiry date that was shipped on the order. |
| **Production date match** | Accept a return only with a production date that was shipped on the order. |
| **Lot / batch number match** | Accept a return only with a lot or batch number that was shipped on the order. |
| **Serial number match** | Accept a return only for serial numbers that were shipped on the order. |
| **Pack type match** | Accept a return only in the pack type it was shipped in. |
| **Prevent unspecified SKU returns** | Return only SKUs that were shipped on the order. |
| **Prevent exceeding shipped quantity** | Block returning more units of a SKU than were shipped. |
| **Enable returns to alternate warehouses** | Allow returns into a warehouse different from the one the order shipped from. |

## Messages the station shows

| Message | Rule |
| --- | --- |
| This SKU was not shipped on the order | **Prevent unspecified SKU returns** |
| Only 2 more can be returned (shipped 5) | **Prevent exceeding shipped quantity** |
| Lot `L2405` was not shipped on the order | **Lot / batch number match**, and the same wording for dates |
| Serial was not shipped on the order | **Serial number match** |
| Returns must be received in the warehouse the order shipped from | **Enable returns to alternate warehouses** is off |

The numbers and codes in these messages come from the order. When a rule blocks a line, the station highlights the field that failed.

## Dispositions

Choose the condition per item at the return station:

| Condition | Where the stock goes |
| --- | --- |
| **Restock** | Received as sellable stock into the return target, or the station when no target is set. |
| **Damaged** | Received as damaged stock into the return target. It can't be allocated. A damage reason is required. |
| **Quarantine** | Held at the return station for inspection. |
| **Dispose** | Received at the station, then written off with an inventory adjustment. |

## Manual RMAs

A manual return starts without an order. When you know which order it came from, use **Link a shipped order** at the station so the return is tied to the original shipment.

## Related pages

- [Receive returns at the return station](/docs/wms/return-station-receive)
- [Return orders and RMA statuses](/docs/wms/return-orders-overview)
