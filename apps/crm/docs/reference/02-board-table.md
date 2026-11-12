# 02 — Board Main Table (monday.com reference → KitStak spec)

Status: v0.1 reference spec. Engineer-ready; every value is tagged with its provenance.

## 0. Provenance and confidence (read first)

| Tag | Meaning | Confidence |
|---|---|---|
| **[API]** | Read live from the KitStak Reference Sandbox (Deals board `18438743477`) through the monday GraphQL API, read-only. | Exact |
| **[VIBE]** | Taken from monday's public, open-source design-system tokens (`monday-ui-style@0.26.2`, `dist/index.min.css`). These are the tokens the board UI is built on. | Exact token values. Where a token applies to which element is high confidence, but not measured on the page. |
| **[OBS]** | Behaviour and anatomy of the current monday board table, written from working knowledge of the product. | Medium. Pixel values are ±2px. **Must be confirmed in a live visual pass.** |
| **[KS]** | KitStak decision or improvement. It is not a monday fact. | Normative for our build |

> **Research limitation, this session:** the built-in browser pane's new tabs had no monday session. Every new tab redirected to `auth.monday.com/auth/login_monday`, and the "already signed in" account tile looped back to login. The Chrome-extension browser was also logged out and showed an autofilled password form. I did not enter credentials, and per instructions I did not drive the user's existing logged-in tab. Hover, zoom and computed-style measurement in a live DOM therefore **could not be done**. To compensate, this spec uses exact API data plus monday's published token sheet, and marks the remaining layout values [OBS]. A follow-up visual pass should take each [OBS] pixel value and record the measured number next to it, for example with `getComputedStyle` on `.board-row`, `.column-header` and `.status-label`.

---

## 1. Design tokens (foundation for everything below)

### 1.1 Typography [VIBE]
- Body font: `Figtree, Roboto, "Noto Sans Hebrew", "Noto Kufi Arabic", "Noto Sans JP", sans-serif`
- Title font: `Poppins, Roboto, …, sans-serif`. Board title and group titles use Poppins or Figtree at 500.
- Weights: 200 very-light, 300 light, 400 normal, 500 "bold" (the token), plus 600 and 700 in the newer text tokens.
- Type scale tokens:
  - `text1` = 16/22. `text2` = 14/20. `text3` = 12/16.
  - `h1` = 32/40 (−0.5px tracking). `h2` = 24/30 (−0.1px). `h3` = 18/24 (−0.1px).
- Table cell text: **14px / 20px, weight 400** (text2-normal) [VIBE+OBS].
- Column header text: **14px, weight 400, color `--secondary-text-color` #676879** [OBS].
- Board title: **24px Poppins 500** (h2-normal, approx.) [OBS].
- Group title: **18px Poppins/Figtree 500**, colored with the group color [OBS].
- Smoothing: `-webkit-font-smoothing: antialiased`.

### 1.2 Spacing, radius, borders, motion [VIBE]
- Spacing: 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80 (`--space-*`).
- Radius:
  - small 4px: pills, inputs, menu items.
  - medium 8px: dialogs, menus, cards.
  - big 16px.
- Border: 1px solid.
- Disabled opacity: **0.38**.
- Motion durations: productive 70 / 100 / 150ms; expressive 250 / 400ms.
- Easing curves:
  - enter `cubic-bezier(0,0,.35,1)`
  - exit `cubic-bezier(.4,0,1,1)`
  - transition `cubic-bezier(.4,0,.2,1)`
  - emphasize (overshoot) `cubic-bezier(0,0,.2,1.4)`

### 1.3 Shadows [VIBE]
- `xs` `0 4px 6px -4px rgba(0,0,0,.1)`: sticky-column scroll shadow and subtle separation.
- `small` `0 4px 8px rgba(0,0,0,.2)`: tooltips and small popovers.
- `medium` `0 6px 20px rgba(0,0,0,.2)`: menus, pickers, the bulk-action bar.
- `large` `0 15px 50px rgba(0,0,0,.3)`: modals.
- Dark theme uses the same geometry with `rgba(9,11,25,.5)`.

### 1.4 Core UI colors — light / dark [VIBE]

| Token | Light | Dark | Board usage |
|---|---|---|---|
| primary-color | #0073ea | #0073ea | primary buttons, focus ring, selected-cell outline, checkbox checked |
| primary-hover-color | #0060b9 | #0060b9 | primary button hover |
| primary-selected-color | #cce5ff | #133774 | selected row background, selected menu item |
| primary-selected-hover-color | #aed4fc | — | selected row hover |
| primary-highlighted-color | #f0f7ff | — | search-match highlight, drop target |
| primary-text-color | #323338 | #d5d8df | cell text, titles |
| secondary-text-color | #676879 | #9699a6 | column headers, footer labels, placeholders |
| primary-background-color | #ffffff | #181b34 | table surface |
| primary-background-hover-color | rgba(103,104,121,.1) | rgba(103,104,121,.3) | icon-button hover, menu item hover |
| allgrey / grey-background | #f6f7fb | #30324e / #181b34 | app canvas behind boards |
| ui-border-color | #c3c6d4 | #797e93 | input borders |
| layout-border-color | #d0d4e4 | #4b4e69 | **table grid lines**, header bottom border |
| ui-background-color | #e7e9ef | #434660 | chips (people "+N", tags bg), header-hover |
| icon-color | #676879 | #c3c6d4 | all icons |
| link-color | #1f76c2 | #69a7ef | link, email and phone cell text |
| disabled-background | #ecedf5 | #3c3f59 | disabled controls |
| positive | #00854d | — | success toasts |
| negative | #d83a52 | — | destructive menu items (Delete), errors |
| warning | #ffcb00 | — | warnings |
| backdrop | rgba(41,47,76,.7) | — | modal scrim |
| surface (dark nav) | #292f4c | — | left nav in some themes |

Themes shipped: light (default), dark, **black**, and a novelty "hacker" theme. [VIBE]

### 1.5 Status / label palette — exact hexes [VIBE + API]

monday status labels use these named colors. Each has three values: **base** (pill fill), **hover** (pill hover / border-ish), and **selected** (light tint used in Edit Labels swatches and the battery background).

| Name (var) | Base | Hover | Selected |
|---|---|---|---|
| done-green / green-shadow | **#00c875** | #0f9b63 | #80e3ba |
| grass_green | #037f4c | #116846 | #81bfa5 |
| bright-green | #9cd326 | #7ca32b | #cde992 |
| saladish | #cab641 | #9d8f3e | #e4daa0 |
| egg_yolk | #ffcb00 | #eaaa15 | #ffe580 |
| working_orange / orange | **#fdab3d** | #c0873c | #fed59e |
| dark-orange | #ff6d3b | #c25531 | #ffb196 |
| peach | #ffadad | #c2888a | #ffd6d6 |
| sunset | #ff7575 | #c26163 | #ffbaba |
| stuck-red / red-shadow | **#df2f4a** | #ad3f51 | #f0a1ad |
| dark-red | #bb3354 | #92334c | #dd99a9 |
| sofia_pink | #e50073 | #c20062 | #ff8ac4 |
| lipstick | #ff5ac4 | #c24e9a | #fface1 |
| bubble | #faa1f1 | #be80ba | #fcd0f8 |
| purple | **#9d50dd** | #7d45b0 | #d0aeed |
| dark_purple | #784bd1 | #6344a3 | #bba5e8 |
| berry | #7e3b8a | #673971 | #be9dc4 |
| dark_indigo | #401694 | #3c1f78 | #a08bc9 |
| indigo | #5559df | #4b4ead | #aaacef |
| navy | #225091 | #274776 | #90a7c8 |
| bright-blue (default group color) | #579bfc | #4c7cc1 | #abcdfd |
| dark-blue / blue-links | **#007eb5** | #0f6d97 | #80c2df |
| aquamarine | #4eccc6 | #469e9b | #a6e5e2 |
| chili-blue | #66ccff | #569ec3 | #b2e5ff |
| river | #74afcc | #588095 | #b3d0de |
| winter | #9aadbd | #7b8895 | #ccd6de |
| explosive (grey / "default" label) | **#c4c4c4** | #98999a | #e1e1e1 |
| american_gray | #757575 | #69696a | #bfbfbf |
| blackish | #333333 | #222222 | #999999 |
| brown | #7f5347 | #684943 | #bfa9a3 |
| orchid | #e484bd | #ae5d8d | #ecbad7 |
| tan | #bca58a | #8a7862 | #d6cabc |
| sky | #a1e3f6 | #81b6c5 | #d0f1fa |
| coffee | #cd9282 | #976758 | #dec0b7 |
| royal | #216edf | #225eb7 | #95bbf2 |
| teal | #175a63 | #12484f | #8bacb1 |
| lavender | #bda8f9 | #9786c7 | #ded4fc |
| steel | #a9bee8 | #8798ba | #d4dff4 |
| lilac | #9d99b9 | #7e7a94 | #ceccdc |
| pecan | #563e3e | #453232 | #ab9f9f |

**API-confirmed label storage** [API]. Each label is stored as `{color, border, var_name}`, for example:
```
orange       color #fdab3d  border #e99729
green-shadow color #00c875  border #00b461
red-shadow   color #df2f4a  border #ce3048
blue-links   color #007eb5  border #3db0df
purple       color #9d50dd  border #9238af
grey         color #c4c4c4  border #b0b0b0
```
- The `border` is a slightly darker shade. monday uses it as the pill's hover/press tone and on the label's left accent in Edit Labels mode.
- `done_colors: [1]` marks which label index counts as "done". That drives the green "done" logic in the battery and in automations.
- Labels are keyed by **index**, not by name. Renaming a label keeps its index, so existing values survive.

**Default new-status labels** [OBS]: "Working on it" (orange #fdab3d), "Done" (green #00c875), "Stuck" (red #df2f4a), and blank (grey #c4c4c4, shown as an empty grey pill).

**KitStak takeaway** [KS]:
- Store each label as `{id, index, name, colorToken, isDone, order}`.
- Text on a pill is white #ffffff on all saturated colors.
- For the light colors (egg_yolk, peach, bubble, sky, chili-blue, lavender, steel, explosive) monday still uses white text, which fails WCAG contrast. **KitStak should switch to #323338 text automatically when contrast is below 4.5:1.**

### 1.6 Group colors [API + VIBE]
- Groups draw from the same palette. Sandbox values:
  - Open Pipeline **#037f4c** (grass_green)
  - Closing This Quarter **#784bd1** (dark_purple)
  - Closed **#c4c4c4** (explosive)
- The default first-group color is bright-blue #579bfc.
- Group order is a float `position` [API]: 16459.0, 32818.0, 65536. This is fractional indexing, so a reorder rewrites one row. [KS] Use LexoRank or fractional keys the same way.

---

## 2. Board header (top of the board page)

### 2.1 Anatomy [OBS]
From top to bottom:
1. **Title row** (height ≈ 48px, page padding-left 32px):
   - **Board name**: h2, 24px, 500 weight. Click it to rename inline.
     - Hover shows a 1px `ui-border-color` box with 4px radius around the text.
     - Edit mode turns the box into an input with a 1px `primary-color` border.
   - **Chevron / info icon** next to the name opens the **Board info popover**: description, board type, owner, created by and date, workspace, and a "See more" link.
   - **Favorite star**:
     - Outline icon, appears on title hover.
     - Turns filled **#ffcb00** when favorited, and stays visible.
     - Adds the board to the left-nav Favorites with a micro "pop" scale animation (emphasize easing, ~250ms).
   - **Right cluster** (right-aligned, 8px gaps):
     - Avatar stack of board members/subscribers: 24–28px circles with −6px overlap, a white 2px ring, and a "+N" chip in `ui-background-color`.
     - **Sidekick/AI** button (newer UI).
     - **Integrate** and **Automate** buttons with counts, for example "Automate / 2".
     - **Invite / Share** button (secondary, outlined, 32px tall).
     - **Activity** opens the activity log panel: a person-avatar + clock style icon.
     - **"…" (More)** icon button: 32×32px, 4px radius, hover bg `primary-background-hover-color`.
2. **Description line** (optional): 14px `secondary-text-color`, one line with ellipsis, click to edit. Hidden when empty, except for a "Add board description" ghost shown on hover in some versions.
3. **View tabs row** (height ≈ 40px):
   - "Main table" with a home/table icon, then the other views (Kanban, Chart, Calendar, Gantt, Dashboard widgets, Form) and a "+" button to add a view.
   - The active tab has a **2px `primary-color` underline**, or a filled `primary-selected-color` pill in the newest UI.
   - Each tab's "…" offers Rename, Duplicate, Share, Set as default, Lock view and Delete.
4. **Board toolbar** (height 40px, 8px gaps):
   - **"New item"** split button: primary blue #0073ea, white text, 32px tall, 4px radius.
     - Left part adds an item at the top of the first group.
     - The right caret offers "New group of items" and "Import items".
   - **Search**: an icon that expands to a ~200px input. Filters live as you type, highlights matches, and includes subitems and updates via options.
   - **Person filter**: an avatar icon that opens a popover of people. One click filters to that person.
   - **Filter**:
     - Quick-filter popover with columns as chips: each status label, people, dates, etc.
     - "Advanced filters" builds AND/OR rule rows.
     - A count badge shows active filters, and the button turns `primary-selected-color` when filters are active.
   - **Sort**: rule rows of column plus Asc/Desc. "Save to this view" persists the sort.
   - **Hide**: column visibility checklist with a search box and a "x/y columns" count.
   - **Group by**: group rows by a column (status, person, date).
   - **Row height** (in "…"): Small / Medium / Large. See §6.6.
   - **"…" toolbar overflow**: Conditional coloring, Row height, Show summary, Export, etc.

### 2.2 Board "…" menu (item list, paraphrased) [OBS]
- **Board options**:
  - Collapse/expand all groups
  - Open board in new tab
  - Open "Board settings":
    - Rename board
    - Change board description
    - Board permissions / "Edit access"
    - Board owners/subscribers
    - Item terminology ("Item" can become "Deal", "Lead", etc.)
- **Content**:
  - Duplicate board (structure only / with items / with items + updates)
  - Save as template
  - Move to (workspace/folder)
  - Export board to Excel
  - Import data
  - Print
- **Views**: Board views, Activity log, Forms
- **Danger**: Archive board, Delete board (red `negative-color` text, with a confirm modal)
- **Board settings**:
  - Columns
  - Item terminology
  - Default values for new items
  - Email notifications
  - Board timezone

### 2.3 Premium details
- The title lives in the same visual box in view and edit modes, so nothing shifts when you start editing.
- Header elements fade with a ~100ms opacity transition on hover (productive-medium).
- Buttons carry tooltips after a ~300ms delay: dark #323338 bubble, 12px text, 4px radius, `box-shadow-small`.

---

## 3. Group header

### 3.1 Anatomy (left → right) [OBS]
- **Group container**:
  - ~40px vertical gap between groups.
  - The group is a "card" without a visible card. Its rows carry the **6px colored left border** (§5.1).
- **Collapse arrow**:
  - 16px chevron in the group color, placed to the left of the title (slightly outdented, in the row-menu column).
  - Rotates 90° on toggle over ~150ms with transition easing.
- **Group title**:
  - 18px, weight 500, **text color = group color**.
  - Hover shows a 1px border box and the "…" group menu button appears at the far left (outside the table).
  - Click puts the title in edit mode. A **color dot/swatch** appears at the left of the input; clicking it opens the group color palette.
- **Item count**:
  - Gray `secondary-text-color` 14px, e.g. "12 Items" (uses the item terminology, so "12 Deals").
  - In newer UI the count shows only on hover or when the group is collapsed.
- **Collapsed state**:
  - Shows as one row (~36–40px) with a 6px colored left edge and the title.
  - The count reads e.g. "8 items".
  - **Column summaries render inline in the collapsed row**: status battery, number sum, date range, people avatars. Monday preserves the summary even when collapsed, and that's important to copy.
- **Sticky behaviour**: when you scroll inside a long group, the group header row (title plus column headers) **sticks under the board toolbar**, then gets replaced by the next group's header. This is a key premium detail.

### 3.2 Group "…" menu [OBS]
1. Collapse this group, Collapse all groups, Expand all groups
2. Select all items
3. Add group (creates a group above this one)
4. Duplicate this group, Move to board, Move to top
5. Rename group, Change group color (palette submenu with ~20 swatches)
6. Export to Excel
7. Save as template
8. Archive group
9. Delete group (red, with confirm: "Delete this group? N items will be deleted" plus Undo toast)

### 3.3 Interactions
- **Drag a group**:
  - Drag by the title area.
  - While dragging, every group collapses to a single-row representation so reordering is easy.
  - The ghost of the dragged group follows the cursor with `box-shadow-medium`.
  - Drop shows a 2px `primary-color` insertion line. [OBS]
- **Shift-click collapse arrow**: collapses all groups (power-user shortcut). [OBS]
- **Inline rename**: Enter or blur saves, Esc cancels. Empty titles revert to the previous title.

---

## 4. Column header row

### 4.1 Anatomy [OBS]
- **Height**: ~36px. White bg. Bottom border 1px `layout-border-color` #d0d4e4. Vertical dividers 1px #d0d4e4 between columns.
- **First header cell (above item names)**:
  - Contains the **select-all checkbox** (16×16, 4px radius, 1px `ui-border-color`).
  - Then the column title, which shows "Item" or the board's item terminology, e.g. "Deal".
- **Header text**: centered for most column types (status, people, date, numbers), left-aligned for the name column. 14px, `secondary-text-color` #676879. Ellipsis on overflow, with the full name in a tooltip.
- **Hover state**:
  - Header bg becomes `primary-background-hover-color` (light gray).
  - A **"…" column menu button** (24×24) appears at the right edge of the cell.
  - A **drag handle** (6-dot grip) appears at the left edge.
  - A 1px **resize affordance** appears on the right divider.
- **Column info icon** ("i"): shows when the column has a description. Tooltip on hover.
- **Last header cell**: a "+" icon button (Add column), 36px wide, which opens the Column Center quick picker.
- **Header widths** [OBS]:

  | Column | Default width |
  |---|---|
  | Name | ~360–400px (sticky) |
  | Status | ~140px |
  | People | ~100px |
  | Date | ~120px |
  | Numbers | ~110px |
  | Timeline | ~160px |
  | Text / long text | ~160px |
  | Tags / dropdown | ~160px |
  | Rating | ~120px |
  | Checkbox | ~80px |

  - Minimum width ~80px. Resize by dragging the divider.
  - Widths are stored per board-view. The API returns `width: null` on the sandbox columns = defaults [API].

### 4.2 Column "…" menu (verbatim-ish list) [OBS]
- **Settings**: Customize column / Column settings (type-specific, e.g. number unit, status label editing, date "include time", people "limit to 1").
- **AI** (newer): "Autofill with AI" / "Assign AI action" on supported types.
- **Filter**: opens the filter popover pre-scoped to this column.
- **Sort**: Sort ascending / Sort descending (one-off, unsaved).
- **Collapse**: shrinks the column to a ~30px stripe that shows only color (status) or nothing. Click to expand.
- **Group by**: group the board by this column.
- **Duplicate column**: "Duplicate column" / "Duplicate with values".
- **Add column to the right**: opens a type picker submenu (Status, Text, People, Date, Numbers, Files, Formula, Dropdown, "More columns" → Column Center).
- **Change column type**: submenu of compatible types, with a data-conversion warning dialog.
- **Column extensions**: Status → "Auto-assign by label", "Add progress tracking", etc.
- **Rename**: inline edit of the header.
- **Delete**: red, moves the column to trash and shows an Undo toast.
- **Restrict column edit / view** (Pro/Enterprise): permission dialogs.

### 4.3 Interactions
- **Rename**: double-click the header text, or Menu → Rename. Inline input with blue border. Enter saves, Esc reverts.
- **Reorder**:
  - Drag the header by its grip (or anywhere on the header).
  - The column body follows as a semi-transparent ghost.
  - A 2px blue drop line shows the target.
  - Other columns slide using a transform transition (~150ms).
- **Resize**:
  - Cursor `col-resize` on the divider. A 2px blue guide line appears while dragging.
  - Double-click the divider to auto-fit? Monday does **not** reliably auto-fit, and that's an opportunity. [KS]
- **Sort indicator**: an active sort shows an arrow icon in the header.
- **Filter indicator**: an active column filter shows a filter dot/icon.

### 4.4 Column Center ("+" → "More columns") [OBS]
- A modal (~900×600, 8px radius, `box-shadow-large`, backdrop rgba(41,47,76,.7)).
  - Left category list: Essentials, Super useful, Board power-ups, Communication, Visualization, Time management, Integrations, AI.
  - Search input at the top.
  - Grid of column-type cards: icon tile in a colored square, title, one-line description, "Add to board" on hover.
- **Quick "+" popover** (before the modal): ~10 most-used types as a 2-column icon list, plus "More columns".
  - Types: Status, Text, People, Dropdown, Date, Numbers, Files, Formula, Connect boards, Timeline, Long text.
- Adding a column inserts it at the far right, scrolls it into view, and **auto-focuses the header rename input** with the default title selected.

---

## 5. Row anatomy

### 5.1 Structure [OBS]
```
[row-menu gutter ~40px, outside table] [6px group-color edge][checkbox cell 36px][Name cell (sticky)  …  ][col][col][col]…[+ col 36px]
```
- **Row height (default "Medium")**: **36px**, with 1px bottom border `layout-border-color`. Cells have 1px right borders, so the grid is visible.
- **Group-color left edge**:
  - A **6px solid bar** in the group color on the far-left of every row, header and add-row.
  - It joins into one continuous vertical stripe for the group, with a top-left/bottom-left radius of ~4–8px on the first and last rows.
  - This is the single strongest visual signature of monday boards.
- **Row "…" menu**: an icon (16px) that appears in the left gutter **outside** the table on row hover.
- **Checkbox cell**:
  - 16×16 checkbox centered in a ~36–40px cell. 1px `ui-border-color`, 4px radius, white fill.
  - Hover: border darkens to `icon-color`.
  - Checked: fill #0073ea with a white check.
  - Selecting **any** row reveals the bulk action bar (§9).
- **Name cell (sticky first column)**:
  - Left padding ~8px after the checkbox; 14px text, `primary-text-color`, single line with ellipsis.
  - **Subitem expander**: a chevron to the left of the name, shown only when subitems exist or on hover. It shows the count of subitems, e.g. a "≡ 3" style badge chip, gray 12px.
  - **On hover**, at the right side of the name cell:
    - **"Open" button**: an expand icon (diagonal arrows) with the label "Open" in newer UI, 24px tall. Opens the item card (side panel) — see doc 03.
    - **Updates bubble icon**: a speech bubble with "+" when there are no updates, and a **filled blue (#0073ea) bubble with a white count** when updates exist. Click it to open the item panel on the Updates tab.
  - **Click the name text** for inline edit mode. **Double-click** selects all.
  - An unseen-updates indicator gives the count bubble a red/blue dot.
- **Row hover**: the entire row background goes to `primary-background-hover-color`-ish (#f5f6f8). Cells with their own fills (status) are unaffected.
- **Row selected (checkbox)**: row bg `primary-selected-color` #cce5ff. The sticky name cell is also tinted.
- **Cell focus (keyboard or click)**: a **1px or 2px `primary-color` outline** inside the cell. The row stays hover-tinted.
- **Sticky first column**:
  - Checkbox and Name stay fixed when you scroll horizontally.
  - Once scrolled, a **right-edge shadow** appears on the sticky column (≈`0 0 8px rgba(0,0,0,.1)` or `box-shadow-xs` rotated).
  - The shadow fades in only when `scrollLeft > 0`. That's a premium detail.

### 5.2 Subitems [API + OBS]
- Subitems live on a **separate board** (`Subitems of Deals` = 18438743982). The parent column is type `subtasks` with `displayType: BOARD_INLINE` [API].
- Expanded subitems render as an **indented nested table**:
  - ~40px indent and its own column header row with subitem-specific columns.
  - A thin connector line to the parent.
  - Each subitem row has the same anatomy at a slightly smaller 32–34px height.
  - Ends with a "+ Add subitem" row.
- The expander rotates ~150ms. Expansion pushes the rows below with no animation (a monday weakness; KitStak should animate height with a transform).

---

## 6. Cell types — display and EDIT interaction

General rules [OBS]:
- **Single-click** a cell to open its editor or picker (no separate "edit mode" step).
- **Esc** closes the picker without changes. **Enter** confirms text editors.
- Pickers are popovers anchored under the cell: 8px radius, `box-shadow-medium`, white, ~8px padding, entry animation fade + 4px slide over ~150ms (enter easing).
- Every change is **optimistic**: the cell updates instantly, the server syncs in the background, and real-time updates reach other users via websockets.
- An empty cell shows nothing. On hover some types show a ghost hint (a "+" for people, a calendar icon for date).

### 6.1 Status (the pill)
- **Display**:
  - The **full cell is filled** with the label color (not a rounded pill inside the cell). Text is centered, white, 14px, weight 400, ellipsis.
  - An empty status shows the "blank" label as **#c4c4c4** grey with no text.
  - Hover: a **folded-corner / dog-ear** effect at the top-right corner (a small triangle revealing a lighter shade), which signals "click me".
  - Hover darkening: the fill moves to the `-hover` shade or applies an overlay.
- **Picker** (on click):
  - Popover ~200–240px wide.
  - Labels stacked vertically as **pills**: full width, 32px tall, 4px radius, label color fill, white centered text. The current label is ring-highlighted.
  - A divider, then a "**✎ Edit Labels**" button (pencil icon, gray text).
  - Newer UI: an "Apply AI" / "Autofill" row, and a search box once there are more than ~10 labels.
  - Selecting a label animates the cell color change, then the popover closes.
  - Selecting the "done" label (`done_colors`) triggers a **confetti** micro-celebration in some boards/settings (premium delight).
- **Edit Labels mode**:
  - Each label becomes an inline text input with a **color swatch square** on the left. Clicking the swatch opens a palette grid of ~40 colors (§1.5) in a 6–8 column grid of 20px circles/squares.
  - Labels can be reordered by a drag handle and deleted with an "×".
  - "+ New label" adds a row. "Apply" saves and "Cancel" reverts.
  - A label in use can't be deleted without a warning.
  - The "default label" (blank) can be renamed but not removed.
- **Keyboard**: arrow up/down to move through labels, Enter to select, typing filters.

### 6.2 People
- **Display**:
  - Centered avatar(s) at **24–30px** (row-height dependent), 50% radius, with a white 2px ring when stacked (−8px overlap).
  - More than 2 people shows "+N" in a gray circle.
  - Teams show a team icon or avatar.
  - Empty cell: on hover, a **gray outlined person-silhouette with a "+" badge**.
- **Picker**:
  - Popover ~280px with the currently assigned people as **removable chips** at the top (avatar 20px + name + "×", `ui-background-color` bg, 16px radius pill).
  - A search input "Search names, roles or teams" with autofocus.
  - "Suggested people" list (avatar + name + title): hover bg is the hover color, and clicking toggles assignment.
  - A footer link "Invite a new member by email". **(KitStak research note: never use it in the sandbox.)**
  - Assigning a person sends a notification (people-column notification).
- **Keyboard**: type to filter, arrows to move, Enter to add, Backspace in the empty input removes the last chip.

### 6.3 Date
- **Display**:
  - Centered text. Format follows the account locale, e.g. "Oct 30" for the current year, "Oct 30, 2025" otherwise.
  - Optional time appears as "Oct 30, 10:00 AM".
  - **Deadline indications** (when linked to a status):
    - Overdue shows a red "!" icon (red circle).
    - Done shows a green ✓ and strikethrough-ish styling.
- **Picker**:
  - Popover ~300px.
  - Top: a text input (typeable dates like "next fri") and a **"Today" quick button**.
  - Month calendar grid: 7 columns, 32px day cells, 50% radius on hover/select. Selected = #0073ea fill, white text. Today = blue text with a ring.
  - Month nav arrows. An "Add time" toggle reveals a time input.
  - A "Clear" link and a recurring-date option (newer).
- **Keyboard**: arrows move the day, Enter selects, PgUp/PgDn change month (partially supported).

### 6.4 Timeline
- **Display**:
  - A **rounded progress bar pill** spanning the cell (~22px tall, 11px radius).
  - Fill = group color (or a chosen status-linked color).
  - The fill **percentage = elapsed time / total** (today's position). The unfilled remainder is dark gray #333 or `ui-background-color` in newer UI.
  - Text is centered and white: "May 1 - Oct 30" [API value: `{"from":"2026-05-01","to":"2026-10-30"}`].
  - Hover shows the **duration in days** ("182d") in place of the dates.
- **Picker**: a dual-month range calendar with start/end selection, the range highlighted with a light `primary-selected-color` band, and Clear.

### 6.5 Numbers (+ unit)
- **Display**:
  - Centered (configurable), 14px.
  - Unit symbol on the left or right [API: `{"unit":{"symbol":"$","direction":"left"}}`, `{"symbol":"%","direction":"right"}`].
  - Thousands separators are **not** shown by default in older boards. Newer versions add a "Number format" setting (comma separators, decimals, K/M abbreviations).
  - Raw value `"1150000"` [API] → display "$1,150,000".
- **Edit**: an inline text input, right in the cell, with a numeric keypad on mobile. Non-numeric input is rejected silently, which is weak. [KS] Show inline validation instead.
- **Column settings**: unit (none / $ / € / £ / % / custom text), direction, decimals, and the footer function (§8).

### 6.6 Row height options [OBS]
| Option | Row height | Effect |
|---|---|---|
| Small | ~32px | Avatars 22px |
| Medium (default) | 36px | — |
| Large | ~48px | Name wraps to 2 lines. Long text shows more. |

### 6.7 Tags
- **Display**: one or more chips in **blue link-style text "#tagname"** (#1f76c2) with no background in classic UI. Newer versions show light chips. Overflow is "+N".
- **Picker**:
  - Search/create input. Existing account-wide tags are listed.
  - Typing a new value shows "Create '#tag'".
  - Tags are **account-level** entities [API: `tag_ids:[30343935,30343931]`]. That makes them shared across boards, unlike dropdown.

### 6.8 Dropdown
- **Display**:
  - **Chips** with `ui-background-color` #e7e9ef bg, 12–14px text, 4px or 12px radius, 4px gap.
  - Overflow shows "+N" with a hover tooltip listing the rest [API: `"Core Platform, Analytics Add-on, Integrations"`].
- **Picker**:
  - Multi-select list with checkmarks.
  - Search with "Create new label" when allowed.
  - "Edit labels" link.
  - Settings: single vs multiple select, and whether new labels can be added from the cell.

### 6.9 Rating
- **Display**:
  - 5 icons (default **stars**; can be hearts, thumbs, etc.), 16–18px.
  - Filled = **#ffcb00** (egg_yolk). Empty = light gray outline.
  - Display is in-cell [API: `{"rating":5}`].
- **Edit**:
  - Hover previews the fill up to the cursor.
  - Click sets the value. Clicking the current value clears it.
  - No popover — this is direct manipulation.

### 6.10 Checkbox
- **Display**: a centered 16–20px box. Checked shows a **green check ✓ (#00c875)** without a box fill in the classic look [API: `{"checked":true}`].
- **Edit**: a single click toggles it, with a small scale bounce on check.
- Footer: count of checked, e.g. "3/20".

### 6.11 Link
- **Display**: link text in `link-color` #1f76c2 with ellipsis. It opens a new tab on click of the text.
- **Edit** (clicking the empty cell area): a popover with two inputs, "Web address" (URL) and "Text to display", plus Save/Cancel.

### 6.12 Email
- **Display**: the display name (or the address), as a link-color mailto [API: `{"text":"Albert Wesker","email":"…"}`].
- **Edit**: a popover with "Email" and "Text to display".
- Validation: invalid emails show a red border and inline error text. Monday's validation is lenient.

### 6.13 Phone
- **Display**:
  - A country flag emoji or icon followed by the formatted number, e.g. "🇺🇸 +1 214 555 0163" [API: `{"phone":"+12145550163","countryShortName":"US"}`].
  - Clicking the number triggers `tel:`.
- **Edit**: a country selector dropdown with flags and dial codes, plus a number input with formatting.

### 6.14 Long text
- **Display**: single-line truncated text with ellipsis.
- **Edit**:
  - Click opens an **expanding textarea popover** (~300×150, resizable).
  - Multi-line, with a character limit of ~2000.
  - Saves on blur or outside-click.
  - Enter creates a newline, and **Shift+Enter or Ctrl+Enter** may save, depending on version. That's inconsistent. [KS] Use Enter to save and Shift+Enter for newline, plus an explicit expand icon.

### 6.15 Location
- **Display**: a pin icon plus the address text "Dallas, TX, USA" [API: `{"lat","lng","address"}`].
- **Edit**: a Google Places autocomplete input in a popover. The map lives in the Map view.

### 6.16 Files
- **Display**:
  - File type thumbnails (~24px), colored by type:
    - excel #207245
    - pdf #bb0706
    - word #2a5699
    - ppt #d64e2a
    - zip #e4901c
    - media #2ea2e9
  - Overflow is "+N".
  - Empty cell on hover: a file icon with "+".
- **Edit**:
  - A popover with "From computer", "Google Drive", "Dropbox", "Box", "OneDrive" and "Link".
  - **Drag-and-drop a file onto the cell** uploads it directly, with a blue dashed drop overlay.
  - Clicking a thumbnail opens the **file viewer lightbox** with annotation/versions.

### 6.17 Connect boards (board_relation) and Mirror
- **Display**: linked item names as **chips** (light gray bg, 4px radius) [API settings: `{"boardIds":[18438743481]}`].
- **Edit**:
  - A popover with a search of the connected board's items (grouped by group).
  - Checkbox multi-select and "+ Create new item".
  - The column settings allow two-way linking.
- **Mirror columns** show a linked item's column (e.g. Account → Industry) as read-only, rendered like the source type.
- **Note**: in the sandbox, the `Account` relation values are **empty** [API]. Seeding didn't populate them.

### 6.18 Other types to support (Column Center) [OBS]
- Text, Formula (with function editor), Auto number, Item ID, Creation log, Last updated, Progress (battery from statuses), Vote, Hour, Week, World clock, Country, Color picker, Button (automations), Dependency, Time tracking (play/stop with running timer), Doc.

---

## 7. "+ Add item" row
- **Display**:
  - The last row of each group: same 36px height, with the 6px group-color edge in a **lighter tint (~40% opacity)**.
  - Checkbox cell disabled/empty.
  - The name cell holds ghost text "**+ Add item**" (or "+ Add deal") in `secondary-text-color`. [OBS]
- **Hover**: the row bg tints and the cursor becomes text.
- **Focus**: becomes an input with a 1px `primary-color` border.
- **Enter**:
  - Creates the item at the bottom of the group. The input stays focused for rapid entry of the next item.
  - The new row **fades and slides in** (~150ms).
- **Esc / blur**: blur with text creates the item. Esc clears it.
- **Empty group**: shows only the column header, the add row and the footer. No empty-state illustration at group level.

---

## 8. Group footer summaries
- A row below "+ Add item" with **no group edge**, ~36px tall, aligned to the columns. The name cell is blank.
- **Status columns → "battery"**:
  - A horizontal stacked bar (~24px tall, 2–4px radius) of label colors, proportional to counts.
  - Hover on a segment shows a tooltip "Done 5/12 (41%)".
  - Clicking a segment filters the board by that label (quick filter).
- **Numbers**: "Sum" by default. The value is shown bold-ish with a small gray "sum" caption below, e.g. "$3,240,000 / sum".
  - The function is selectable by clicking the footer cell: Sum, Average, Median, Min, Max, Count, None.
  - Unit and decimals follow the column settings.
- **Date**: a date range "Oct 1 - Dec 15" in a dark pill, or the earliest–latest.
- **Timeline**: an overall span as a mini timeline bar.
- **People**: stacked avatars of everyone assigned in the group.
- **Checkbox**: "3/12 checked" style count.
- **Rating**: the average.
- **Text / long text / link**: none.
- **Board-level footer**: a summary row at the very bottom (newer), plus a toggle "Show summary" in the toolbar.
- **Collapsed group**: the footer summaries render **in the collapsed row itself** (§3.1).

---

## 9. Multi-select bulk action bar
- **Trigger**: checking ≥1 row checkbox (or Shift-click range select / select all).
- **Anatomy** [OBS]:
  - A **floating bar at the bottom-center** of the viewport, ~56–64px tall, white, 8px radius, `box-shadow-large`/`medium`. It slides up ~16px and fades in over 250ms with enter easing.
  - **Left**: a blue square badge with the **selected count** ("3"), the text "Items selected", and a row of tiny colored dots (one per selected item, in its group color).
  - **Actions** (icon on top, 12px label below, each ~64px wide, hover bg gray):
    1. Duplicate
    2. Export (to Excel)
    3. Archive
    4. Delete
    5. Convert (to subitems / to another board, newer)
    6. Move to (submenu: group in this board / another board)
    7. Apps (bulk actions from installed apps)
    8. Newer additions: "Apply AI" / Sidekick
  - **Right**: an "×" close button that clears the selection.
- **Delete / Archive**: optimistic removal, then a **toast** at the bottom-left/center "N items deleted" with an **Undo** button (~5–10s, dark #323338 bg, white text).
- **Selection persistence**: the selection survives scroll and collapses. It clears on view change.
- **Shift-click**: selects ranges within a group.
- **Header select-all**: selects visible (filtered) items. The header checkbox shows an indeterminate dash when partially selected.

---

## 10. Drag & drop
| Object | Handle | Behaviour |
|---|---|---|
| Row | Grip appears in the left gutter on hover, or drag the name cell | Ghost row with `box-shadow-medium`, slight tilt, 0.9 opacity. Blue 2px insertion line. Can be dropped into **another group**, and takes the group's color edge on drop. Auto-scrolls near the viewport edges. |
| Multiple rows | Drag any selected row | Drags all selected rows. The ghost shows a count. |
| Group | Title | All groups collapse during the drag. Insertion line between groups. |
| Column | Header | Ghost column with a blue insertion line. The name column is not draggable. |
| Subitem | Grip | Reorders within the parent. Can't be promoted by drag (monday weakness). |
| File | OS drag onto a file cell | Dashed blue overlay, then upload. |

Reorders persist with fractional positions [API: group `position` floats].

---

## 11. Keyboard navigation [OBS]
- monday's support is **partial**. There is cell focus with arrows in newer versions, but it's inconsistent across cell types. That's a big opportunity.
- **KitStak target** (spreadsheet-grade) [KS]:
  - **Arrows** move the cell focus (2px #0073ea inset outline).
  - **Tab / Shift+Tab** move to the next or previous cell.
  - **Enter** opens the editor or picker on the focused cell. Enter inside a text editor saves and moves down.
  - **Esc** cancels the edit and returns to cell focus. A second Esc clears focus.
  - **Space** toggles a checkbox and toggles row selection when focus is on the checkbox cell.
  - **Type any character** on a text or number cell to start editing with that character (Excel-style).
  - **Delete / Backspace** clears the cell value, with an undo toast.
  - **Ctrl/Cmd+C / V** copies and pastes cell values. Pasting multi-row TSV from Excel creates or updates items (monday supports multi-cell paste into the name column for bulk item creation).
  - **Ctrl/Cmd+Z / Shift+Z** undo and redo (monday has board-level undo for deletions only, via the toast).
  - **Shift+Arrow**: range selection.
  - **Ctrl/Cmd+A**: select all items in a group.
  - **Ctrl/Cmd+Enter**: open the item card.
  - **Ctrl/Cmd+F**: focus board search.
  - **Ctrl+K**: global search ("Search everything" in monday).
  - **Picker keyboard**: arrows, Enter and type-to-filter in every popover. Focus returns to the cell on close.
- **Focus management**: one roving tabindex in the grid, `role="grid"`, `aria-rowindex`/`aria-colindex`, and `aria-selected` on selected rows.

---

## 12. Scrolling and virtualization
- **Vertical**: the board virtualizes rows. Large boards (10k items) stay smooth. Group headers stick.
- **Horizontal**:
  - The table scrolls horizontally inside the board container while the name column stays sticky.
  - A **left shadow** appears on the sticky column when `scrollLeft > 0`.
  - A **right-edge fade/shadow** hints at more columns.
  - The scrollbar is thin (`scrollbar_gray` #b2b2b2), ~8px, and auto-hides on macOS.
- **Header**: the column header stays sticky under the toolbar for the group currently in view.
- **Loading**:
  - First paint shows a **skeleton**: gray `ui-background-color` bars for the header, group titles and ~10 rows, with a shimmer.
  - Items stream in by group. Monday shows its own loader animation on the initial board load.
- **Empty board**: a centered illustration and copy ("This board is empty — add your first item") plus a primary "New item" button. [KS] Use original illustrations only.
- **Error states**:
  - A failed cell update reverts the cell and shows a red toast: "Something went wrong, changes were not saved".
  - Losing the connection shows a top banner: "You're offline — changes will sync when you're back".

---

## 13. Real-time and collaboration signals [OBS]
- Another user's edits appear live with a brief **highlight flash** of the changed cell.
- Another user viewing or editing an item shows their avatar on the item row (newer).
- Activity log entries are written for every change (board "Activity" panel).
- An item that has unseen updates shows a blue dot on the update bubble.

---

## 14. What makes monday's table feel premium (copy these)
1. **Color as structure.** The 6px group stripe, the full-bleed status cells and the colored group titles make a board scannable at 2m distance.
2. **Zero-mode editing.** Every cell is one click from its editor, pickers open instantly (<100ms), and there are no save buttons.
3. **Summaries everywhere.** Footer batteries and sums, even on collapsed groups, turn a list into a dashboard.
4. **Micro-motion with restraint.** Motion is 70–150ms "productive" for UI and 250–400ms "expressive" for celebratory moments (confetti on done, star pop).
5. **Sticky everything.** Group header, column header and name column all stick, with scroll shadows that appear only when needed.
6. **Optimistic UI with Undo toasts** instead of confirm dialogs for most destructive actions.
7. **Consistent popover language.** 8px radius, the medium shadow, the same padding and the same search-at-top pattern across people, dropdown, tags and connect boards.
8. **Terminology customization.** "Item" becomes "Deal", and the change flows into buttons, counts and the add row.
9. **Dense but airy.** 36px rows with 14px text and 1px #d0d4e4 grid lines on a white surface, over a #f6f7fb canvas.

---

## 15. Weaknesses and annoyances KitStak can beat
1. **Pill contrast.** White text on light palette colors (egg_yolk #ffcb00, chili-blue, sky, bubble, explosive grey) fails WCAG AA.
   - [KS] Pick the text color automatically (#323338 vs #fff) from a contrast ratio of 4.5 or higher.
   - [KS] Offer an optional "soft pill" style: tinted bg using the `-selected` color, dark text and a 4px radius inset pill.
2. **Keyboard navigation is incomplete.** There are no true spreadsheet semantics: no range select, partial arrow-key support, typing doesn't start an edit, and no global undo.
   - [KS] Full grid keyboard model (§11) plus a global undo/redo stack across cell edits.
3. **No auto-fit column width.** [KS] Double-click a divider to fit content. Add a "Fit all columns" option.
4. **Number formatting defaults.** Raw numbers show without separators in many boards, and there's no currency locale.
   - [KS] Locale-aware Intl.NumberFormat by default, with compact display ("$1.15M") when the column is narrow and the full value in a tooltip.
5. **Status semantics are index-based and color-arbitrary.**
   - Sandbox example: "Won" is purple and "Discovery" is green, because colors are assigned by index [API].
   - [KS] Offer CRM-aware default palettes: Won is green, Lost is grey/red, Negotiation is blue. Add `isDone`/`isLost` semantic flags that drive forecasting.
6. **Long text editing is inconsistent** (Enter vs Shift+Enter) and the textarea is tiny. [KS] Use a consistent rich-text editor with an expand-to-modal option.
7. **Subitems are a separate board with separate columns.** They're awkward to configure, can't be promoted or demoted by drag, and roll up poorly.
   - [KS] Single-table hierarchy with shared or overridden columns, drag to indent/outdent, and roll-up formulas.
8. **Expand/collapse doesn't animate height.** Rows jump. [KS] Use FLIP-style transform animations at 150ms.
9. **Validation is silent.** Invalid numbers and emails are ignored or accepted. [KS] Add inline validation states (red 1px border, helper text, `aria-invalid`).
10. **Bulk bar is a modal-ish island.** It covers content at the bottom of the board, and you can't scroll to the last row comfortably.
    - [KS] Add bottom padding equal to the bar height while a selection exists.
    - [KS] Add keyboard shortcuts for bulk actions, and bulk "Set column value" (monday lacks direct bulk-edit of a column for the selected items without apps or automations).
11. **No inline formula preview or validation on Formula columns.** [KS] Live formula bar with syntax highlighting.
12. **Filters** are powerful but buried, and saved filters require view management.
    - [KS] Filter chips persistently visible under the toolbar with one-click removal, plus "Save as view".
13. **Performance on wide boards** (40+ columns) degrades and horizontal scroll janks. [KS] Virtualize columns as well as rows.
14. **Dark mode** contrast in pills and battery is weak. [KS] Tune palette luminance per theme rather than reusing light hexes.
15. **Empty-state guidance is thin** at group level. [KS] Add contextual CTAs in the empty-group row ("Import deals from CSV", "Add from template").
16. **Upsell interruptions.** Locked features show paywall modals mid-flow. [KS] KitStak should never block a flow with a paywall modal.
17. **Accessibility.** The grid lacks robust ARIA grid semantics, and focus is lost after closing pickers. [KS] Meet WCAG 2.2 AA. Return focus to the origin cell. Respect `prefers-reduced-motion` (disable confetti and slides).

---

## 16. KitStak implementation checklist (table)
- [ ] Tokens: port §1 into CSS variables, including the full label palette (base/hover/selected) and light/dark/black themes.
- [ ] Grid:
  - [ ] Virtualized rows and columns.
  - [ ] Sticky checkbox and name columns with conditional shadow.
  - [ ] Sticky group and column headers.
  - [ ] Row heights 32/36/48.
- [ ] Group: 6px color stripe, collapse with inline summaries, colored editable title, the full menu (§3.2), drag reorder with fractional positions.
- [ ] Column header:
  - [ ] Hover "…" menu with the full list (§4.2).
  - [ ] Inline rename, resize with auto-fit, drag reorder.
  - [ ] Collapse to a 30px stripe.
  - [ ] "+" quick picker and Column Center modal.
- [ ] Row: checkbox, hover state, selected state, the Open button, the update-count bubble, subitem expander, the row "…" menu in the gutter.
- [ ] Cell editors — all of §6. Each needs:
  - display, empty and hover states
  - popover editor
  - keyboard support
  - validation
  - optimistic update with rollback
- [ ] Add-item row with rapid entry; multi-line paste creates N items.
- [ ] Footer summaries: status battery (clickable filter), number functions, date range, people, checkbox count.
- [ ] Bulk bar: count badge and color dots, the 7 actions plus bulk set-value, an Undo toast for destructive actions.
- [ ] DnD: rows (across groups, multi-row), groups, columns, files.
- [ ] Keyboard grid model (§11) and global undo/redo.
- [ ] Loading skeleton, empty board, offline banner, error toast, real-time cell flash.
- [ ] Item terminology propagation ("Deal") across all copy.

---

## Appendix A — Sandbox board facts (Deals, read via API)
- Board `18438743477` "Deals". Description: null.
- Groups:

  | Group | Color | Position |
  |---|---|---|
  | Closed | #c4c4c4 | 16459.0 |
  | Closing This Quarter | #784bd1 | 32818.0 |
  | Open Pipeline (id `topics`) | #037f4c | 65536 |

- Columns (id → type):

  | id | type | Settings / notes |
  |---|---|---|
  | name | name | — |
  | stage | status | Lead/Discovery/Proposal/Negotiation/Won/Lost; colors orange, green-shadow, red-shadow, blue-links, purple, grey; done_colors [1] |
  | owner | people | — |
  | deal_value | numbers | $ left |
  | probability | numbers | % right |
  | close_date | date | — |
  | priority | status | Critical/High/Medium/Low |
  | timeline | timeline | — |
  | account | board_relation | → 18438743481 |
  | email | email | — |
  | phone | phone | — |
  | tags | tags | — |
  | fit | rating | — |
  | exec_sponsor | checkbox | — |
  | notes | long_text | — |
  | product | dropdown | 5 labels |
  | proposal | link | — |
  | location | location | — |
  | source | status | Inbound/Outbound/Referral/Partner/Event |
  | subtasks_mm8tq4cm | subtasks | BOARD_INLINE → 18438743982 |

- Value shapes (useful for the KitStak data model):
  - status `{"index":4}`
  - people `{"personsAndTeams":[{"id":…,"kind":"person"}]}`
  - numbers `"1150000"` (string)
  - date `{"date":"2026-10-30"}`
  - timeline `{"from","to"}`
  - email `{"text","email"}`
  - phone `{"phone":"+1…","countryShortName":"US"}`
  - tags `{"tag_ids":[…]}`
  - rating `{"rating":5}`
  - checkbox `{"checked":true}`
  - long_text `{"text"}`
  - dropdown `{"ids":[1,2,3]}`
  - location `{"lat","lng","address"}`
- Seed gaps noticed:
  - The `account` relation is empty on the items sampled.
  - The `proposal` link is empty.
  - Status colors are index-assigned, so they don't match the stage semantics (see §15.5).
