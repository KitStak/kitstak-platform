---
title: End of the day manifests and carrier pickup
description: Close each carrier's daily manifest, print the End Of The Day report for the driver, schedule a carrier pickup, and set manifests to close automatically.
section: Packing and shipping
order: 70
---

Every label you create joins an open manifest for its carrier setup and ship day. At the end of the day you close the manifest and print the End Of The Day report to hand to the carrier. You can also book a carrier pickup for the packages on a manifest, and set a cutoff time so manifests close on their own.

## Before you start

- You need the End Of The Day view permission to see the page, and the print permission to close manifests, reprint and schedule pickups.

## Find manifests

1. Go to **Fulfillment > End Of The Day**.
2. Filter by carrier, status or ship date.

| Column | What it shows |
| --- | --- |
| **Prefix** and **Carrier** | The carrier setup. |
| **Status** | **Open** or **Closed**. An open manifest from an earlier ship day is flagged: print its report to hand it to the carrier. |
| **Ship from** and **Ship date** | The warehouse address and day. |
| **Manifest #** | 1 for the first manifest of the carrier and day. Higher numbers opened after an earlier one was closed. |
| **Close date** | When the manifest was closed, in the warehouse's time zone. |
| **Report printed?** | Whether the report was printed. |
| **Scheduled pickup** | The booked pickup time. |
| **Total package** | Active packages. Select the number to see them in **Carrier Shipment Details**. |
| **Voided packages** | Packages voided from this manifest. |

## Close a manifest and print the report

1. Select the open manifests.
2. Choose **Print end of the day report**.
3. Confirm **Close this manifest and print the report?**

The close date is set, the report is marked printed and the packages are handed to the carrier. Labels created afterwards open a new manifest. A toast offers **Open report**.

Rules:

- Only **Open** manifests can be closed. Use **Reprint** for closed ones.
- A manifest with no active packages can't be closed.
- Only closed manifests have a report to reprint. **Open printed report** in the row menu opens it.

## Schedule a carrier pickup

1. Select the manifests and choose **Schedule pickup**.
2. Set **Ready for pickup at**.
3. Set **Latest pickup time (dock closes)**. It must be after the ready time.
4. Select **Schedule pickup**.

KitStak books a pickup with the carrier for the packages and stamps **Scheduled pickup** on each of them. A manifest with no active packages can't get a pickup.

## Close manifests automatically

1. Select **Auto-close** in the toolbar.
2. In **Close of day automation**, choose a **Carrier setup** and a **Cutoff time**.
3. Select **Add rule**.

Every day at the cutoff time, in the warehouse's time zone, the carrier setup's open manifests close. The End Of The Day report is printed and stored as if you closed it by hand. Turn a rule off with its switch, or remove it. Each carrier setup takes one rule.

## Related pages

- [Manage carrier labels](/docs/wms/ship-carrier-labels)
- [Ship orders](/docs/wms/ship-orders)
- [Plan truck loads with shipment plans](/docs/wms/ship-shipment-plans)
