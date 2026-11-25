---
title: Set up the packing station
description: Choose your warehouse and packing station, pick how to start packing (tote, location, putwall or order list), and read the station dashboard and shortcuts.
section: Packing and shipping
order: 10
---

The **Packing Station** is where picked orders become packages with labels. Each packer chooses a warehouse and a packing station once; KitStak remembers both for the next visit. From the dashboard you start packing by scanning what the picked units arrived in, or by choosing an order from a list.

## Before you start

- The warehouse needs at least one location in the Packing area. If there is none, the station list shows "No Packing-area location in this warehouse. Add one in Locations."
- You need the Packing Station view permission. To complete packing you also need the Execute Task permission, and the Create Label permission to buy labels.
- Orders must be **Ready to Pack** or **Packing Started**.

## Choose your station

1. Go to **Fulfillment > Packing Station**.
2. Under **Station setup**, choose the **Warehouse**.
3. Choose the **Packing station**.

Both choices are remembered for your next visit. A station locked by a count plan can't be chosen; the list shows **Locked by** and the plan code.

## Start packing

Pick one of the four start cards. The number keys work as shortcuts on the dashboard.

| Card | Key | Use it when |
| --- | --- | --- |
| **Scan a tote** | 1 | Pack the orders picked into a tote. |
| **Scan a location** | 2 | Pack orders staged at a location. |
| **Scan a putwall / mobile cart** | 3 | Pack orders sorted into a putwall or cart. |
| **List and select order** | 4 | Find a ready-to-pack order and start. |

Each card opens the pack screen in that mode. You can switch modes on the pack screen with the **Tote**, **Location**, **Order** and **Putwall** tabs. See [Pack an order at the packing station](/docs/wms/pack-orders).

## Pack screen shortcuts

| Key | What it does |
| --- | --- |
| **Enter** | Submits a scan. |
| **F2** | Closes the open package. |
| **F9** | Completes packing. |
| **Esc** | Cancels a pending serial scan. |

## Read the dashboard

The right side shows your user card and the numbers for today:

| Tile | What it counts |
| --- | --- |
| **Orders packed today** | Orders packed today. |
| **Products packed today** | Units packed today. |
| **Total orders to be packed** | Orders waiting in the warehouse. |
| **Pack-short orders held** | Orders with an open pack short. |
| **Orders with packing warnings** | Orders that will show a warning when packed. |

The station card shows **Orders**, **Units** and **Packers** for every packer at this station since midnight. The packing history card lists recent packing in the warehouse.

## Header links

- **Hospital locations** opens the list of stock moved aside by **Report issue**. See [Report a pack issue and use hospital locations](/docs/wms/pack-report-issue-and-hospitals).
- **Orders to pack** opens the backlog filtered to **Ready to Pack** and **Packing Started**.

## Related pages

- [Buy labels and compare rates while packing](/docs/wms/pack-labels-and-rates)
- [Mobile carts and totes for picking](/docs/wms/pick-mobile-carts-and-totes)
