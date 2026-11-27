---
title: Search, filter, sort and group a board
description: Narrow a board to the items you need with search, person and quick filters, advanced rules and condition groups, then sort and regroup them.
section: Views
order: 20
---

The board toolbar sits above every view. It holds the button to add items and the tools that decide which items you see and in what order. What you change applies to the current view only, and stays yours until you save it to the view.

## The toolbar

| Control | What it does |
| --- | --- |
| **New item** (for example **New deal**) | Adds an item. The split menu also has **New group of items** and **Import items** |
| **Search** | Finds items by text in this view |
| **Person** | Shows only items assigned to one person |
| **Filter** | Quick filters and advanced rules |
| **Sort** | Orders items by one or more columns (table) |
| **Hide** | Shows or hides columns (table) |
| **Group by** | Regroups items by a column (table) |
| **More view options** | View tools and row height |

On narrow screens some controls move into **More view options** under **View tools**.

## Search a view

1. Select **Search** and type, for example `fleet`.
2. The view shows only the items that match. Active searches show as a chip under the toolbar.

## Filter by person

1. Select **Person**.
2. Pick someone in **Filter by person**. Search with **Search people**.
3. Select **Clear** to show everyone again.

If no one is assigned on the board, the panel says **No one is assigned yet**.

## Use quick filters

1. Select **Filter**. The **Quick filters** tab opens.
2. Pick values under each status, dropdown, people or date column. Each value shows how many items have it.
3. Date columns offer **Overdue**, **Today**, **This week**, **Next week**, **This month** and **No date**.
4. Select **Clear all** to remove every filter.

If the board has none of those columns, the tab says **No quick filters for this board** and points you to the advanced tab.

## Build advanced filters

1. Select **Filter** and open the **Advanced** tab.
2. The first rule starts with **Where**. Pick the **Column**, the **Condition** and the value.
3. Select **Add rule** for more rules. Choose **And** to match all rules or **Or** to match any.
4. Select **Add group** to add a **Condition group**, a set of rules with its own **And** or **Or**.
5. Select **Remove rule** or **Remove condition group** to take one out.

| Column type | Conditions |
| --- | --- |
| Status, Dropdown, People | **is**, **is not**, **is empty**, **is not empty** |
| Numbers, Currency, Rating, Progress, Formula | **equals**, **doesn't equal**, **greater than**, **at least**, **less than**, **at most**, **is between**, **is empty**, **is not empty** |
| Date, Timeline, Last updated, Creation log | **is** (a relative date), **is before**, **is after**, **is between**, **is empty**, **is not empty** |
| Checkbox | **is** **Checked** or **Unchecked** |
| Text and other types | **contains**, **doesn't contain**, **is**, **is not**, **is empty**, **is not empty** |

Relative dates are **Overdue**, **Today**, **Yesterday**, **Tomorrow**, **This week**, **Last week**, **Next week**, **This month**, **Last month**, **Next month**, **Past 7 days**, **Next 7 days**, **Past 30 days** and **Next 30 days**.

A filter can hold up to 50 rules and 10 condition groups. Button, Files, Mirror and Item ID columns can’t be filtered. Active filters show as chips under the toolbar. Select a chip’s remove button to drop it.

## Sort a view

1. Select **Sort**.
2. Select **Add sort** and pick a column under **Sort by**.
3. Pick the **Direction**: **Ascending** or **Descending**.
4. Select **Add another sort** for a tiebreaker. Ties on the first rule fall through to the next.

You can also sort from a column’s menu with **Sort ascending** or **Sort descending**. Long text, Files and Button columns can’t be sorted.

## Hide columns

1. Select **Hide**.
2. Search with **Find a column**, then switch columns on or off. **All columns** toggles them all.

## Group by a column

1. Select **Group by**.
2. Pick a status, person, dropdown, checkbox or date column in **Group items by**.
3. For a date column, pick a **Date bucket**: **Week**, **Month**, **Quarter** or **Year**.
4. Pick **Board groups (default)** to go back.

Items are regrouped for this view only. Board groups are unchanged. While a column grouping is on, the button reads **Group by (active)**.

## Keep your changes

The toolbar shows **Unsaved changes** while your filters, sort, hidden columns or grouping differ from the saved view. Select **Save to this view** to keep them for everyone, or **Reset to the saved view** to drop them. See [Add and manage board views](/docs/crm/board-views).

## Related pages

- [Add and manage board views](/docs/crm/board-views)
- [Add, edit and arrange columns](/docs/crm/columns)
- [Export a board, view or selection](/docs/crm/export-data)
