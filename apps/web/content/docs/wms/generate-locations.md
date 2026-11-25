---
title: Generate a rack layout
description: Create a whole aisle or rack layout of locations at once in KitStak WMS with the location generator, with a live preview of every code.
section: Inventory and locations
order: 30
---

The location generator builds many locations from one pattern: aisles times racks times levels times positions. You see the number of codes, the first codes and any collisions with existing locations before anything is created. Use it to set up a new warehouse or a new aisle in minutes.

## Before you start

- You need the **Create** permission on **Locations**.
- Create the location zones and groups you want to assign. See [Manage locations](/docs/wms/locations).

## Generate locations

1. Go to **Settings > Master Data > Locations**.
2. Select **Generate locations**.
3. Under **Pattern**, choose the **Warehouse** and enter the ranges.
4. Under **Attributes**, set what every new location gets.
5. Check the **Preview**.
6. Select **Create locations**. Once the preview is checked, the button shows the count, for example **Create 240 locations**.

When the run finishes, the message may offer **Show them**. Select it to filter the list to the new codes.

## Pattern fields

Each range is letters, such as A to F, or numbers, such as 01 to 10. Leading zeros are kept.

| Field | What it does | Required |
| --- | --- | --- |
| **Warehouse** | Where the locations are created. | Yes |
| **Code prefix** | Optional first segment of every code. With prefix `P`, codes read `P-A-01-1`. Letters and numbers only, up to 10 characters. It is only part of the code; set the zone under **Attributes**. | No |
| **Aisles** | From and to, for example A to F. | Yes |
| **Racks** | From and to, for example 01 to 10. | Yes |
| **Levels** | From and to, for example 1 to 4. | No |
| **Positions** | From and to, for example A to B. | No |
| **Separator** | **Dash (A-01-1)**, **Dot (A.01.1)**, **None (A011)** or **Underscore (A_01_1)**. | No |

## Attribute fields

Applied to every generated location. You can edit any of them later.

| Field | What it does | Required |
| --- | --- | --- |
| **Location type** | Such as **Racks**, **Shelves** or **Bins**. | Yes |
| **Area type** | Such as **Storage** or **Picking**. | Yes |
| **Location zone** | The zone for every new location. | No |
| **Location group** | The group for every new location. | No |
| **Walking path starts at** | The walking path priority of the first location. | No |
| **Walking path step** | Added for each location, in aisle, rack, level, position order. | No |

## Read the preview

- The footer shows the number of codes and either **no collisions** or how many already exist.
- When some codes already exist, tick **Skip existing codes and create the other 200** (with your own count) to create only the new ones.
- When every code already exists, the preview says so, for example **All 4 codes already exist; nothing to create.**

## Limits and rules

| Rule | Message |
| --- | --- |
| At most 5,000 locations per run. | **6,000 locations exceeds the 5,000 limit; narrow a range** |
| A range can span at most 200 values. | **Aisle range can span at most 200 values** |
| Aisles and racks are required. | **Aisle range is required**, **Rack range is required** |
| Both ends of a range are needed. | **Enter both ends of the aisle range** |
| A range is letters or numbers, not both. | **Aisle range must be letters (A to F) or numbers (01 to 10)** |
| A range goes from low to high. | **Aisle range must go from low to high** |

More than 500 locations: the run continues in the background and you get a notification when it is done. Up to 500 are created at once.

## Example

Aisles `A` to `C`, racks `01` to `10`, levels `1` to `4`, separator **Dash** create 120 locations, from `A-01-1` to `C-10-4`.

## Related pages

- [Manage locations](/docs/wms/locations)
- [Create a location](/docs/wms/create-location)
- [Import data from Excel](/docs/wms/excel-imports)
