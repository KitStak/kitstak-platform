---
title: Kanban view
description: Show items as cards in lanes by status, dropdown or group, drag them between stages, set lane totals and WIP limits, and pick card fields.
section: Views
order: 30
---

A kanban view shows each item as a card in a lane. Lanes come from a status column, a dropdown column or the board groups. Dragging a card to another lane changes that value, so moving a deal from **Proposal** to **Negotiation** updates its stage.

## Before you start

- The board needs a status or dropdown column, or you can divide lanes by groups.
- You need edit access to move cards or change the view’s settings.

## Add a kanban view

1. Select **Add view** and pick **Kanban**.
2. Open **Customize** (**Kanban settings**) to choose how lanes are made.

The CRM templates already have one: **Pipeline** on Deals, **Lead funnel** on Leads, **By type** on Contacts and **Account health** on Accounts.

## Kanban settings

| Section | Setting | What it does |
| --- | --- | --- |
| **Lanes** | **Divide by** | A status or dropdown column, or **Groups** |
| **Lanes** | **Hide empty lanes** | Hides lanes with no cards |
| **Lane totals** | **Sum of** | Adds up a number or currency column in each lane, or **No totals** |
| **Lane totals** | **Weighted by** | Multiplies each value by a probability column (%), or **Not weighted** |
| **Card fields** | Field list | Picks and orders the columns shown on cards |
| **Card fields** | **Show empty fields** | Shows fields even when they have no value |

Hover a lane total to see the full **Total** and the amount **Weighted by probability**.

## Move cards

- Drag a card to another lane to change its status, dropdown label or group.
- Drag within a lane to reorder cards.
- Or open the card menu and use **Move to** to pick a lane, or **Move to group**.

With the keyboard, focus a card and press `Space` to pick it up. Use the arrow keys to move it and `Space` to drop it. `Esc` cancels and `Enter` opens the card.

## Add a card

1. Select **Add item** (for example **Add deal**) at the bottom of a lane.
2. Type the name and press `Enter`. Press `Esc` to close.

The new item gets the lane’s value.

## The lane menu

| Item | What it does |
| --- | --- |
| **Collapse lane** | Folds the lane to a narrow strip. Select it to expand |
| **Move left**, **Move right** | Reorders lanes |
| **WIP limit** | Sets a work-in-progress limit: **No limit**, 3, 5, 8, 10, 15 or 20 |

A lane with a limit shows its count against the limit, for example `4/5`. When a lane goes over, its tooltip says **Over the WIP limit**.

## The card menu

| Item | What it does |
| --- | --- |
| **Open item** | Opens the item panel |
| **Move to**, **Move to group** | Moves the card |
| **Add subitem** | Adds a subitem |
| **Duplicate** | Copies the item |
| **Copy link** | Copies a link to the item |
| **Archive**, **Delete** | Takes the item off the board |

Cards also show how many updates and subitems the item has.

## Related pages

- [Add and manage board views](/docs/crm/board-views)
- [Status, dropdown, tags and checkbox columns](/docs/crm/label-columns)
- [Read the pipeline and forecast](/docs/crm/pipeline)
