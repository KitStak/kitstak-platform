# 00 — KitStak Parity Checklist (match or beat monday.com CRM)

This is the critic's checklist. Every line can be tested: either Given/When/Then or a measurable spec.
It merges and dedupes the research in `01-shell-navigation`, `02-board-table`, `04-views-dashboards` and `05-wizards-settings`,
and checks it against the `docs/ARCHITECTURE.md` contract. Module names follow `src/features/<feature>/`.

**Priority**
- **P0**: required before any blind side-by-side. Missing or broken means KitStak loses.
- **P1**: needed for enterprise parity. The critic marks it down if absent.
- **P2**: where we beat monday, or depth parity. Ship after P0/P1 are green.

**Source tags**: [01] [02] [04] [05] are the research docs. [KS] is a KitStak decision. [verify] means a live monday pass has not confirmed the pixel value yet; use the value given here as the KitStak spec anyway.

> **Gap:** `03-item-panel-toolbar.md` was **not present** in `docs/reference/` when this checklist was compiled. The `item-panel` and part of the `board-toolbar` sections below come from what docs 02, 04 and 05 say about those surfaces, plus product knowledge. They are marked [derived]. Re-run the merge when doc 03 lands.

**Global rules for every item** (the critic applies these to every component, so they are not repeated per line):
- G-1 `P0` Every interactive element has default, hover, focus-visible, active, disabled (0.38 opacity) and loading states. No state may be missing.
- G-2 `P0` Every data surface has skeleton-loading, empty, filtered-empty and error states. It never shows a full-page spinner.
- G-3 `P0` Light and dark themes are both intentional. All text tokens meet ≥4.5:1 contrast (≥3:1 for large text and UI glyphs) in both themes.
- G-4 `P0` No per-component hex values. Every color, radius, shadow and duration comes from `src/styles/tokens.css`.
- G-5 `P0` Mutations are optimistic. On server failure the UI rolls back and shows an error toast within 300ms of the response.
- G-6 `P0` `prefers-reduced-motion: reduce` turns motion into opacity-only at ≤70ms and disables confetti, tilts and slides.
- G-7 `P0` Every popover and menu: Esc closes it and returns focus to the trigger. Arrow keys, Enter and type-ahead work.
- G-8 `P0` Item terminology ("Deal", "Lead", …) flows into every button, count, empty state, toast and add-row on that board.
- G-9 `P1` Interaction latency: INP < 100ms for nav clicks, cell picker open < 100ms, client-side filter < 50ms on 5k items.
- G-10 `P0` No monday logos, names, illustrations, mascots or copied icon art anywhere. Microcopy is original.

---

## shell

### Layout and frame
- SH-001 `P0` The app is a CSS grid with a 48px top bar and a sidebar column. Top bar and sidebar share the `--surface-app` canvas tint and read as one L-shaped frame. [01 §2]
- SH-002 `P0` Main content is a white card floating on the canvas: radius 16px on the top corners (or all corners), with 8px right and bottom gutters and `overflow:hidden`. Measured with getComputedStyle. [01 §2, §10]
- SH-003 `P1` Given a viewport < 1200px, when the app loads, then the sidebar auto-collapses to the rail. Min supported width is 1024px, with no horizontal page scroll at 1024. [01 §2]
- SH-004 `P0` Landmarks are present: `banner` (top bar), `navigation` (sidebar) and `main` (card). The selected tree row has `aria-current="page"`. [01 §9.8]

### Top bar
- SH-010 `P0` Top bar, left to right: brand mark (click goes Home), flex spacer, right cluster of 32×32 icon buttons with 20px icons and 4–8px gaps: Activity, Invite, Search, Help, divider (1px × 24px, `--border-subtle`), AI entry (optional), account pill (32px avatar). Horizontal padding is 12–16px. [01 §3.1]
- SH-011 `P0` Icon-button states: default transparent with icon `--text-muted`; hover background `--hover-wash` and icon `--text`; selected (its panel is open) background `--primary-selected` and icon `--primary`; focus-visible ring per tokens. [01 §3.2]
- SH-012 `P0` Given any icon-only control, when hovered for 300ms, then a dark tooltip chip appears (bg `--inverted-bg`, white 12px text, radius 4, 6–8px padding, arrow). Hide delay is 0ms. Tooltips show the keyboard shortcut where one exists. No control is unlabeled (it also has an `aria-label`). [01 §3.2, §8.10]
- SH-013 `P0` Count badge: a pill 16px tall, 12px/600 white on `--danger`. It overlaps the top-right corner by about 4px, with a 2px ring in the bar color so it cuts out. It shows "99+" above 99. [01 §3.1, §3.2]
- SH-014 `P1` The top bar carries no upsell chrome ("See plans", trial banners). Billing lives in Admin only. [01 §9.1, KS]

### Sidebar
- SH-020 `P0` Sidebar width defaults to 256px. It resizes from 200 to 480px through a 4px invisible handle: col-resize cursor, and a 2px `--primary` line on hover. The width persists per user **server-side**. [01 §4.1, §10]
- SH-021 `P0` Primary nav rows are 36px with 20px icons and 14px labels: Home, My work, Activity, then the **CRM object nav** (Deals, Leads, Contacts, Accounts, Activities, Dashboards). Each object row expands to show its boards/views and pinned saved views. [01 §4.1, §9.3]
- SH-022 `P0` Tree row: 32–36px tall, radius 4, 8px left padding plus 16–20px per depth level, label 14/20 400 with ellipsis, and a full-name tooltip only when truncated. [01 §4.2]
- SH-023 `P0` Given a tree row, when hovered, then its background becomes `--hover-wash` and a 24×24 "…" button fades in at the right edge within 100ms. [01 §4.2]
- SH-024 `P0` The selected (current page) row has background `--primary-selected`, and `--primary-selected-hover` when hovered. There is no left bar and no bold weight. [01 §4.2, §8.3]
- SH-025 `P0` Focus-visible on a tree row shows an inset 2px `--primary` ring. The tree is `role="tree"`/`treeitem` with a roving tabindex: ↑/↓ move, →/← expand or collapse, Enter opens, Home/End jump. [01 §4.2, §9.8]
- SH-026 `P0` Tree rows are real `<a href>` links. Cmd/Ctrl+click and middle-click open a new tab. [01 §6]
- SH-027 `P0` Folder chevron rotates 90° in 150ms. Expanded state persists per user. Folder color comes from the label palette. [01 §4.2]
- SH-028 `P1` Inline rename on double-click or menu → Rename: the label becomes an input with a 1px `--primary` border and radius 4, the text does not shift, Enter saves, Esc cancels, and an empty value reverts. [01 §4.2]
- SH-029 `P1` Drag a tree row to reorder or move it into a folder: the ghost has shadow-medium, a 2px `--primary` insertion line shows the target, a folder target highlights `--primary-highlighted`, and the folder auto-expands after 600ms of hover. On failure: toast "Couldn't move board" with Retry. [01 §4.2, §7]
- SH-030 `P0` Board row "…" menu, in order: Open in new tab · Rename · Add to/Remove from favorites · Duplicate ▸ (structure / with items / with items + updates) · Move to ▸ · Share/Permissions · Save as template · divider · Archive · Delete (destructive style per TOK-MENU-DESTRUCTIVE). [01 §4.3]
- SH-031 `P0` Favorites section: a collapsible header ("Favorites", 14px `--text-muted`, not uppercase) with chevron. Starred boards, views, dashboards and records from **any** workspace appear here. Empty hint: star icon plus "Star boards to keep them here". [01 §4.1, §9.4]
- SH-032 `P1` Section search: a magnifier on a section header filters the tree inline, highlights matches, auto-expands the matching folders, and Esc clears. [01 §4.8]
- SH-033 `P0` Collapse: a 24px circular toggle (white, 1px border, shadow-small) on the sidebar's right edge, shown on sidebar hover. Collapsing animates width over 250ms on the transition curve, and the content card animates with it. [01 §4.7]
- SH-034 `P0` The collapsed state is a **56px icon rail** (Home, Search, Activity, the CRM objects, Favorites), each with a tooltip. Hovering the rail for 300ms peeks the full sidebar as an overlay (shadow-large) without reflowing content, and mouse-leave closes it after 300ms. [01 §9.10]
- SH-035 `P0` Cmd/Ctrl+\ toggles the sidebar. [01 §6]
- SH-036 `P2` Sidebar density setting: comfortable rows 36px, compact rows 28px. [01 §9.12]
- SH-037 `P1` Tree loading shows 3–6 shimmer skeleton rows. An empty workspace shows "No boards yet" plus "+ Add". The tree is virtualized at 500+ nodes with no scroll jank. [01 §7, §9.7]

### Workspace switcher and add menu
- SH-040 `P0` Switcher card: 40–48px tall, radius 8. It shows a 28–32px avatar tile (palette color, white initial at 14–16px/600, house glyph for the main workspace), the name at 14px/600 truncated, a chevron, then a "…" button and a 28×28 `--primary` "+" button (hover `--primary-hover`). [01 §4.4]
- SH-041 `P0` Given the switcher is clicked, then a 300–340px popover opens with the search input auto-focused. Typing filters instantly. The current workspace has a check. ↑/↓/Enter work. Footer: "+ Add workspace" and "Browse all". [01 §4.4]
- SH-042 `P1` Multiple workspaces can be expanded in the tree at once (no forced single-workspace view). [01 §9.4]
- SH-043 `P0` The "+" add menu (about 260px) lists: Board, Doc*, Dashboard, Form, Automation, divider, Folder, divider, Choose from templates, Import data. Each row has a colored type icon and a 14px label. It opens in ≤100ms. (*Doc is P2.) [01 §4.6, 05 §2]
- SH-044 `P2` Add menu has a type-to-filter field at the top and a shortcut hint on each row (B board, I import, …). [05 §2 KS+]
- SH-045 `P1` Workspace "…" menu: Rename · Change icon/color · Settings/permissions (Open/Closed) · Manage members · Add to favorites · Duplicate · Sort tree (A–Z / manual) · Collapse all folders · Delete (type-to-confirm). [01 §4.5, 05 §6]

### Workspace home
- SH-050 `P1` Header: 64–80px avatar tile (a pencil appears on hover to change it), name in Poppins 32px/500 (inline-editable with a hover border), description placeholder "Add workspace description", and on the right a member stack (32px circles with a 2px white ring and a "+N" chip), Members button and "…". [01 §5.1]
- SH-051 `P1` Tabs: Recents · Content · Members · Permissions. Tab text is 14px `--text-muted`; the selected tab is `--text` with a 2px `--primary` underline that slides between tabs over 150ms. There is a 16–24px gap between tabs and a 1px baseline under the row. [01 §5.2]
- SH-052 `P1` Content tab: search, type filter, sort (Last viewed / Name / Created) and a "+ Add" split button, over a list of Name/Type/Folder/Owner/Last modified with 40–48px rows, a hover wash and a per-row "…" that matches SH-030. [01 §5.2]
- SH-053 `P1` An empty workspace shows an original illustration, "Start by adding a board", and the CTAs New board / Choose from templates / Import. [01 §5.2, 05 §6]

### Breadcrumbs and global behaviour
- SH-060 `P1` The main card header shows a breadcrumb (Workspace › Folder › Board). Each segment has its own switcher dropdown. [01 §9.9]
- SH-061 `P1` Browser back/forward restore the route, the scroll position and the selected item panel. [01 §6]
- SH-062 `P0` Toasts: bottom-center, 24px from the edge, 48–56px tall, min width 300, max width 600, radius 4–8 (TOK), 12×16 padding, 20px icon, action button ("Undo"), close ×. Variants: normal `--inverted-bg`, positive, negative, warning (dark text). Auto-hide after 6s, hover or focus pauses the timer, at most 3 stack with the newest on top. Enter: slide up 16px plus fade over 250ms (enter curve). Exit: 150ms (exit curve). `role="status"`, assertive for errors. [01 §7, 05 §13.2]
- SH-063 `P0` Given the user archives or deletes anything, then a toast "‹N› ‹noun› deleted · Undo" appears. Clicking Undo restores the object in place with a slide-in and shows a second toast "Restored". [05 §13.2]
- SH-064 `P1` Cmd/Ctrl+Z undoes the last destructive action even after its toast is gone (at least the last 20 actions in the session). [05 §13 KS+, 02 §11]
- SH-065 `P1` "?" opens a keyboard-shortcut cheat-sheet modal. g-chords work: `g h` Home, `g d` Deals, `g c` Contacts, `g a` Accounts, `g l` Leads. `c` quick-creates a record of the current board type. [01 §6, §9.6]
- SH-066 `P1` Offline: a top banner "You're offline — changes will sync when you're back". Edits are queued and replayed when the connection returns. [02 §12]

---

## board-table

### Board header
- BT-001 `P0` Title row is about 48px tall with 32px left padding. Board name is Poppins 24px/500. Hover shows a 1px `--border-strong` box (radius 4); click turns it into an input with a 1px `--primary` border **in the same box**, so the layout shifts 0px (checked by bounding-box diff). [02 §2.1, §2.3]
- BT-002 `P0` Favorite star: outline on title hover. Clicking it fills it with `--star` (#ffcb00-family), keeps it visible, plays a 250ms "pop" on the emphasize curve, and the board appears in sidebar Favorites without a reload. [02 §2.1]
- BT-003 `P1` A chevron or info icon next to the name opens the Board info popover: description, board type, owner(s), created by and date, workspace, "See more". [02 §2.1]
- BT-004 `P1` Right cluster: avatar stack (24–28px, −6px overlap, 2px white ring, "+N" chip), Automate button with count ("Automate / 2"), Share (secondary, 32px), Activity, and "…" (32×32, radius 4). [02 §2.1]
- BT-005 `P1` Description line: 14px `--text-muted`, one line with ellipsis, click to edit. It is hidden when empty except for an "Add board description" ghost on hover. [02 §2.1]
- BT-006 `P1` The board header can collapse. Collapsed, the view tabs turn into one "‹View› ▾" dropdown. The state persists per user. [04 §2.1]

### Groups
- BT-010 `P0` Every row, header row, add-row and footer-adjacent row of a group has a **6px solid left edge in the group color**. The edges join into one continuous stripe with a 4–8px radius on the first and last rows. On the add-row the edge is the same color at 40% opacity. [02 §5.1, §7]
- BT-011 `P0` Group title: 18px weight 500, text color = group color. A 16px chevron in the group color sits to its left and rotates 90° in 150ms on the transition curve. [02 §3.1]
- BT-012 `P0` Given a title click, then it becomes an input with a color swatch on its left. Clicking the swatch opens the group palette (≥20 swatches). Enter or blur saves, Esc cancels, and an empty value reverts. [02 §3.1, §3.3]
- BT-013 `P0` Item count shows as "12 Deals" (terminology-aware) in 14px `--text-muted`, on hover and always when the group is collapsed. [02 §3.1]
- BT-014 `P0` A collapsed group is one 36–40px row with the 6px edge, the title and the count, **and the column summaries render inline in that row** (battery, sums, date range, people). [02 §3.1, §8]
- BT-015 `P0` Sticky group header: scrolling inside a long group keeps the group title and its column-header row stuck under the toolbar until the next group's header pushes it out. [02 §3.1]
- BT-016 `P0` Group "…" menu: Collapse this group / Collapse all / Expand all · Select all items · Add group · Duplicate · Move to board · Move to top · Rename · Change color ▸ · Export to Excel · Save as template* · Archive · Delete (confirm "Delete this group? N items will be deleted", then Undo toast). (*P2) [02 §3.2]
- BT-017 `P1` Drag a group by its title: all groups collapse to single rows while dragging, the ghost has shadow-medium, a 2px `--primary` insertion line shows the target, and the reorder writes **one** row (fractional position). [02 §3.3, §1.6]
- BT-018 `P1` Shift-click on any group chevron collapses or expands all groups. [02 §3.3]
- BT-019 `P1` Groups are about 40px apart vertically. [02 §3.1]

### Column header
- BT-020 `P0` Header row is 36px, white, with a 1px `--border-subtle` bottom border and 1px vertical dividers. Text is 14px `--text-muted`, centered except the name column (left-aligned), with ellipsis and a full-name tooltip. [02 §4.1]
- BT-021 `P0` The first header cell holds a 16×16 select-all checkbox (radius 4) and the terminology title ("Deal"). It shows an indeterminate dash when some rows are selected. [02 §4.1, §9]
- BT-022 `P0` Given a header is hovered, then within 100ms its background becomes `--hover-wash`, a 24×24 "…" appears at the right, a 6-dot grip appears at the left, and the divider shows a resize affordance. [02 §4.1]
- BT-023 `P0` Column "…" menu: Settings · Filter · Sort asc/desc · Collapse · Group by · Duplicate ▸ (structure / with values) · Add column to the right ▸ · Change type ▸ (shows a conversion warning) · Rename · Delete (Undo toast) · Column permissions* (*P1). [02 §4.2]
- BT-024 `P0` Default widths: Name 360–400 (sticky), Status 140, People 100, Date 120, Numbers 110, Timeline 160, Text 160, Tags/Dropdown 160, Rating 120, Checkbox 80. Minimum 80. Widths persist per view. [02 §4.1]
- BT-025 `P0` Resize: dragging a divider shows a 2px `--primary` guide line and the col-resize cursor. **Double-clicking a divider auto-fits to content.** A "Fit all columns" action exists. [02 §4.3, §15.3]
- BT-026 `P0` Reorder by dragging a header: the column body follows as a semi-transparent ghost, a 2px blue drop line shows the target, and the other columns slide using a 150ms transform. The name column is not draggable. [02 §4.3, §10]
- BT-027 `P0` Rename by double-click or menu: an inline input with a blue border. Enter saves, Esc reverts. [02 §4.3]
- BT-028 `P1` An active sort shows an arrow in the header. An active column filter shows a dot. A column description shows an "i" icon with a tooltip. [02 §4.1, §4.3]
- BT-029 `P1` Collapse column: the column shrinks to a 30px stripe (status shows only its colors) and a click expands it. [02 §4.2]
- BT-030 `P0` The last header cell is a 36px "+" that opens a quick picker of 10+ common types in a 2-column icon list (Status, Text, People, Dropdown, Date, Numbers, Files, Formula, Connect boards, Timeline, Long text) plus "More columns". [02 §4.4]
- BT-031 `P1` "More columns" opens the Column Center modal (about 900×600, radius 8, shadow-large): category rail, search, and type cards (icon tile, title, one-line description, "Add to board" on hover). [02 §4.4]
- BT-032 `P0` Given a column is added, then it is inserted at the far right, scrolled into view, and its header rename input is auto-focused with the default title selected. [02 §4.4]

### Rows
- BT-040 `P0` Row height defaults to 36px with a 1px `--border-subtle` bottom border and 1px cell right borders (a visible grid). [02 §5.1]
- BT-041 `P0` Row height setting: Small 32 (22px avatars) · Medium 36 · Large 48 (name wraps to 2 lines). It persists per view. [02 §6.6]
- BT-042 `P0` Row hover tints the row background (`--row-hover`). Status cells keep their own fill. [02 §5.1]
- BT-043 `P0` Checkbox cell is 36–40px with a 16×16 box (1px `--border-strong`, white). Hovering darkens the border to `--icon`. Checked: `--primary` fill with a white check. [02 §5.1]
- BT-044 `P0` Selected row background is `--primary-selected`, including the sticky name cell. [02 §5.1]
- BT-045 `P0` Given a row is hovered, then a 16px "…" row-menu icon appears in a 40px gutter **outside** the table on the left, and a drag grip appears. [02 §5.1, §10]
- BT-046 `P0` Name cell is sticky: 8px left padding, 14px text, single line with ellipsis. On hover, the right side shows an "Open" button (expand icon plus label, 24px) and an updates bubble. The bubble is outline "+" with no updates and filled `--primary` with a white count when updates exist; clicking it opens the item panel on Updates. [02 §5.1]
- BT-047 `P0` Click the name text to edit it inline. Double-click selects all. [02 §5.1]
- BT-048 `P0` The sticky checkbox and name columns stay fixed on horizontal scroll. A right-edge shadow on the sticky column fades in **only when scrollLeft > 0**. A right-edge fade hints that more columns exist. [02 §5.1, §12]
- BT-049 `P0` Focused cell shows a 2px `--primary` inset outline while the row stays hover-tinted. [02 §5.1, §11]
- BT-050 `P1` A subitem expander chevron sits left of the name with a count chip ("3"), shown when subitems exist or on hover. It rotates in 150ms. Subitems render as an indented (about 40px) nested table with its own header, a connector line, 32–34px rows and "+ Add subitem". Expand and collapse **animate height** (transform/FLIP, 150ms); rows never jump. [02 §5.2, §15.8]
- BT-051 `P2` Subitems live in the same table hierarchy, share or override parent columns, and can be dragged to indent or outdent (promote/demote). [02 §15.7]
- BT-052 `P1` Row "…" menu: Open · Copy link · Duplicate · Move to ▸ (group / board) · Add subitem · Create new item above/below · Archive · Delete. [derived 02/04]

### Add-item row
- BT-060 `P0` The last row of each group shows ghost text "+ Add ‹noun›" in `--text-muted` and the 40% edge (BT-010). Focus turns it into an input with a 1px `--primary` border. [02 §7]
- BT-061 `P0` Given text is typed and Enter is pressed, then the item is created at the bottom of the group, the new row fades and slides in over 150ms, **and the input stays focused** for the next entry. Esc clears. Blur with text creates the item. [02 §7]
- BT-062 `P1` Pasting multi-line text into the add row creates N items, one per line, with a single Undo toast "N items created · Undo". [02 §11, §16]
- BT-063 `P2` An empty group row shows contextual CTAs ("Import deals from CSV", "Add from template"). [02 §15.15]

### Footer summaries
- BT-070 `P0` A footer row (36px, no group edge) sits below the add row, aligned to the columns. [02 §8]
- BT-071 `P0` Status footer is a **battery**: a stacked bar about 24px tall (radius 2–4) split by label color in proportion to counts. Hovering a segment shows "Done 5/12 (41%)". **Clicking a segment applies that label as a quick filter.** [02 §8]
- BT-072 `P0` Numbers footer shows the formatted value plus a small gray function caption below ("$3,240,000 / sum"). Clicking it opens a picker: Sum · Average · Median · Min · Max · Count · None. Unit and decimals follow the column. [02 §8]
- BT-073 `P1` Other footers: Date shows a "Oct 1 – Dec 15" range pill; Timeline shows a mini span bar; People shows a stack of every assignee; Checkbox shows "3/12"; Rating shows the average; text and link show nothing. [02 §8]
- BT-074 `P1` A board-level summary row is at the very bottom, toggled by "Show summary". [02 §8]

### Bulk actions
- BT-080 `P0` Given ≥1 row is checked, then a floating bar slides up 16px and fades in over 250ms (enter curve) at bottom-center. It is 56–64px tall, white, radius 8, shadow-medium. Left side: a `--primary` square count badge, "‹N› ‹nouns› selected", and one dot per item in its group color. Right side: × clears the selection. [02 §9]
- BT-081 `P0` Bulk actions are ~64px icon-over-label buttons with a 12px label: Duplicate · Export · Archive · Delete · Move to ▸ · **Set value ▸** (column + value, applied to every selected item) · Convert*. (*P2) [02 §9, §15.10]
- BT-082 `P0` While a selection exists, the board gets extra bottom padding equal to the bar height, so the last row can scroll fully into view. [02 §15.10]
- BT-083 `P0` Shift-click selects a range within a group. Header select-all selects the visible (filtered) items only. The selection survives scrolling and collapsing groups, and clears when the view changes. [02 §9]
- BT-084 `P0` Bulk Delete or Archive removes rows optimistically and shows "N items deleted · Undo". [02 §9]

### Drag and drop
- BT-090 `P0` Row drag: the ghost has shadow-medium, a 2–3° tilt and 0.9 opacity, and a 2px `--primary` insertion line shows the target. Dropping into another group takes that group's color edge. The view auto-scrolls near the viewport edges. Dragging any selected row drags all selected rows, and the ghost shows the count. [02 §10]
- BT-091 `P0` Every reorder (row, group, column) persists one fractional-index write. Reloading shows the same order. [02 §10, ARCH]

### Keyboard grid
- BT-100 `P0` The grid is `role="grid"` with `aria-rowindex`/`aria-colindex`, a roving tabindex and `aria-selected` on selected rows. [02 §11]
- BT-101 `P0` Arrow keys move cell focus. Tab and Shift+Tab move to the next and previous cell. Enter opens the editor or picker, and Enter in a text editor saves and moves down. Esc cancels to cell focus, and a second Esc clears focus. [02 §11]
- BT-102 `P0` Typing a printable character on a focused text or number cell starts editing with that character. Delete or Backspace clears the cell, with an undo toast. [02 §11]
- BT-103 `P0` Space toggles a checkbox cell, and on the row-checkbox cell it toggles row selection. [02 §11]
- BT-104 `P1` Cmd/Ctrl+C and Cmd/Ctrl+V copy and paste cell values. Pasting TSV from Excel fills or creates the matching cells or items. [02 §11]
- BT-105 `P1` Shift+Arrow selects a range. Cmd/Ctrl+A selects all items in a group. Cmd/Ctrl+Enter opens the item card. Cmd/Ctrl+F focuses board search. [02 §11]
- BT-106 `P0` Given a picker closes for any reason, then focus returns to the origin cell. [02 §15.17]

### Scale, loading, realtime
- BT-110 `P0` Rows **and** columns are virtualized. A board with 10k items and 40 columns scrolls at ≥55fps with no blank flashes, and horizontal scroll does not jank. [02 §12, §15.13]
- BT-111 `P0` First paint shows a skeleton: header bar, group titles and about 10 rows with a 1.2s shimmer (`--skeleton-from` → `--skeleton-to`). [02 §12]
- BT-112 `P0` An empty board shows an original illustration, "This board is empty — add your first ‹noun›", and a primary "New ‹noun›" button. [02 §12]
- BT-113 `P0` A failed cell write reverts the cell and shows a red toast "Couldn't save your change" with Retry. [02 §12]
- BT-114 `P1` Another user's change appears in under 1s through SSE, with a 600ms highlight flash on the changed cell (`--primary-highlighted` fading to none). [02 §13]
- BT-115 `P2` Presence: the avatar of another user who is viewing or editing an item shows on its row. [02 §13, 04 §13]

---

## cells

**Common rules**
- CE-000 `P0` A single click opens the editor or picker (there is no separate edit mode). Pickers are popovers anchored under the cell: radius 8, shadow-medium, white, 8px padding, enter = fade plus 4px slide over 150ms (enter curve). They flip or shift to stay on screen. Every picker with a list has search at the top and type-to-filter. [02 §6]
- CE-001 `P0` Empty cells show nothing at rest. On hover they show a ghost affordance: "+" person silhouette (people), calendar icon (date), file "+" (files). [02 §6]
- CE-002 `P0` Invalid input never fails silently. It shows a 1px `--danger` border, 12px helper text and `aria-invalid="true"`, and the value is not saved. [02 §15.9]

### Status / priority (the pill)
- CE-010 `P0` The **whole cell** is filled with the label color (full-bleed, no inner rounded pill), with centered 14px/400 text and ellipsis. An empty value shows the grey default label with no text. [02 §6.1, ARCH]
- CE-011 `P0` Pill text color is computed from contrast: white when it gives ≥4.5:1, otherwise `--text` (#323338-family). egg-yolk, peach, bubble, sky, chili-blue, lavender, steel and explosive must therefore use dark text. Checked with axe and the contrast formula. [02 §1.5, §15.1; 04 §1.1]
- CE-012 `P0` Hover shows the **folded-corner dog-ear** at the top-right (a small triangle in a lighter shade) and moves the fill to the label's `-hover` shade within 100ms. [02 §6.1, ARCH]
- CE-013 `P0` Picker: popover 200–240px wide. Labels are stacked full-width pills (32px tall, radius 4, label fill, centered text). The current label has a ring. Below a divider sits "✎ Edit labels". A search box appears when there are more than 10 labels. ↑/↓/Enter and type-to-filter work. [02 §6.1]
- CE-014 `P0` Given a label is picked, then the cell color changes with a 150ms transition, the popover closes, and a single activity row is written. [02 §6.1]
- CE-015 `P0` Edit labels mode: each label becomes an input with a color swatch on its left, the swatch opens a 6–8 column grid of 20px swatches (the full palette), a drag handle reorders, × deletes (a label in use asks for confirmation and a replacement label), "+ New label" adds one, and Apply/Cancel finish. The default (blank) label can be renamed but not deleted. Labels are keyed by stable id, so renaming keeps existing values. [02 §6.1, §1.5]
- CE-016 `P1` A label can be marked `isDone` (drives battery, deadline and automations) and, for CRM, `isLost`. [02 §1.5, §15.5]
- CE-017 `P2` Picking an `isDone` label plays a small confetti burst (≤400ms, emphasize curve). It respects reduced motion and is toggled in board settings. [02 §6.1]
- CE-018 `P2` An optional "soft pill" style: tinted `-selected` background with dark text, as a 4px-radius inset pill. [02 §15.1]

### People
- CE-020 `P0` Display: centered avatars at 24px (22px in Small, 30px in Large), 50% radius, −8px overlap with a 2px white ring. More than 2 people show a "+N" gray circle. Teams show a team glyph. [02 §6.2]
- CE-021 `P0` Picker (about 280px): assigned people as removable chips (20px avatar + name + ×, `--ui-bg`, 16px radius) above an auto-focused search ("Search names, roles or teams"), then a suggested list (avatar, name, title). Clicking toggles. Backspace in the empty input removes the last chip. [02 §6.2]
- CE-022 `P0` Assigning a person creates a notification for that person (NO-0xx). [02 §6.2]

### Date / timeline
- CE-030 `P0` Date display: centered and locale-aware. "Oct 30" in the current year, "Oct 30, 2025" otherwise; with time, "Oct 30, 10:00 AM". [02 §6.3]
- CE-031 `P0` When a date is linked to a status: overdue and not done shows a red "!" circle; done shows a green ✓ with muted text. [02 §6.3]
- CE-032 `P0` Date picker (about 300px): a typeable input ("next fri" parses), a "Today" button, a 7-column month grid with 32px day cells (selected = `--primary` circle with white text, today = `--primary` text with a ring), month arrows, "Add time" toggle, and Clear. Arrow keys move the day and PgUp/PgDn change month. [02 §6.3]
- CE-033 `P0` Timeline display: a rounded bar about 22px tall (radius 11). The fill is the group color, with the elapsed portion relative to today, over a `--ui-bg` remainder. It shows white centered text "May 1 – Oct 30"; on hover it shows the duration ("182d"). [02 §6.4]
- CE-034 `P0` Timeline picker: a dual-month range calendar with a `--primary-selected` band and Clear. [02 §6.4]

### Numbers / currency
- CE-040 `P0` Numbers are formatted with `Intl.NumberFormat` per locale, with thousands separators by default. Unit symbol position follows settings ("$" left, "%" right). The raw value 1150000 with a $ unit displays "$1,150,000". [02 §6.5, §15.4]
- CE-041 `P1` In a column narrower than the formatted value, numbers show compact ("$1.15M") with the full value in a tooltip. [02 §15.4]
- CE-042 `P0` Editing happens in an inline input in the cell. Non-numeric input shows the CE-002 error state and is not silently dropped. [02 §6.5]
- CE-043 `P1` Column settings: unit (none / $ / € / £ / % / custom), direction, decimals, the footer function, and (for currency) the ISO currency. [02 §6.5]

### Text, long text, link, email, phone, location
- CE-050 `P0` Text edits inline. Enter saves, Esc reverts. [02 §6]
- CE-051 `P0` Long text: the cell is single-line truncated. Click opens an expanding textarea popover (about 300×150, resizable) with an expand-to-modal icon. **Enter saves and Shift+Enter inserts a newline**, the same everywhere. Blur saves. A character counter shows at 80% of the limit. [02 §6.14, §15.6]
- CE-052 `P0` Link: shown as `--link` text with ellipsis, and clicking the text opens a new tab with `rel="noopener noreferrer"`. Clicking the empty cell area opens a popover with "Web address" and "Text to display" plus Save/Cancel. URLs are validated (http/https/mailto only). [02 §6.11]
- CE-053 `P0` Email: shown as the display name or address as a `--link` mailto. The popover has Email and Text to display. Invalid emails are rejected with CE-002. [02 §6.12]
- CE-054 `P0` Phone: a flag followed by the E.164 number in international format ("🇺🇸 +1 214 555 0163"), which links to `tel:`. The editor has a country selector (flag + dial code, searchable) and a formatted number input. [02 §6.13]
- CE-055 `P1` Location: a pin icon plus the address. The editor is an autocomplete input (provider pluggable; manual entry always allowed). [02 §6.15]

### Dropdown, tags, rating, checkbox, files, connect, mirror, other
- CE-060 `P0` Dropdown: chips with `--ui-bg`, 12–14px text, radius 4, 4px gap. Overflow shows "+N" with a tooltip listing the rest. The picker is a multi-select with checks, search, "Create new label" (if allowed) and "Edit labels". A single/multi setting exists. [02 §6.8]
- CE-061 `P1` Tags: chips showing "#tag". Tags are **org-level** and shared across boards. The picker searches existing tags and offers "Create '#tag'". [02 §6.7]
- CE-062 `P0` Rating: 5 icons at 16–18px, filled `--star`, empty as a light outline. Hovering previews the fill up to the cursor, clicking sets the value, clicking the current value clears it. There is no popover. Keyboard: ←/→ change the value and 0 clears. [02 §6.9]
- CE-063 `P0` Checkbox: a centered 16–20px box. Checked shows a `--status-done` ✓. A single click toggles with a small scale bounce (100ms, emphasize curve). [02 §6.10]
- CE-064 `P1` Files: about 24px type thumbnails colored by type (xls green, pdf red, doc blue, ppt orange, zip amber, media sky) with "+N" overflow. Dropping an OS file onto the cell shows a dashed `--primary` overlay and uploads. Clicking a thumbnail opens the lightbox (arrow-key navigation, zoom, download). Uploads are checked for type and size on the server. [02 §6.16, ARCH]
- CE-065 `P0` Connect boards: linked item names as chips (`--ui-bg`, radius 4). The picker searches the target board's items grouped by group, multi-selects with checkboxes, and has "+ Create new ‹noun›". Two-way linking keeps the reverse column in sync. [02 §6.17]
- CE-066 `P1` Mirror: read-only, rendered exactly like the source column type (a status mirror shows a pill). [02 §6.17]
- CE-067 `P1` Formula: a formula editor with a live preview of the result for the first item, syntax highlighting and inline errors ("Unknown column {X}"). [02 §15.11]
- CE-068 `P1` Computed types render correctly and are read-only: progress (a battery made from the status columns), last_updated (avatar + relative time), creation_log, item_id. [ARCH, 02 §6.18]
- CE-069 `P2` Button column triggers an automation, with a press state and a toast. Country column shows flag + name. [02 §6.18, ARCH]

---

## item-panel [derived — doc 03 missing]
- IP-001 `P0` The panel opens from **every** view (table Open button, update bubble, Kanban card, calendar event, chart drill-down row, notification, search result, `Cmd/Ctrl+Enter`). It is a right slide-over 600–900px wide (resizable, width persisted), with a 250ms slide-in on the enter curve and a scrim-free overlay over the board. [04 §13, 02 §5.1]
- IP-002 `P0` The URL deep-links to the item (`…/boards/:id/items/:itemId`). Reload, share and back/forward reopen the same panel and tab. [01 §6, KS]
- IP-003 `P0` Header: the item name in Poppins 24px, inline-editable in the same box (0px layout shift); a breadcrumb (board › group); prev/next item arrows (also `k`/`j`); a subscribers avatar stack; "…" (Copy link, Duplicate, Move, Archive, Delete); and close ×. Esc closes the panel and focus returns to the row. [derived]
- IP-004 `P0` Tabs: **Updates** · **Files** · **Activity log** · **Item card** (all column values as a form). The tab underline matches SH-051. [04 §13]
- IP-005 `P0` Updates composer: a Tiptap editor placeholder ("Write an update and mention others with @"). It supports @mention of people and teams (which sends a notification), bold/italic/lists/links/code, file attach and paste-image, Cmd/Ctrl+Enter to post, and draft autosave per item. Content is sanitized on the server. [05 §14.1, ARCH]
- IP-006 `P0` Update card: avatar, name, relative time (exact time in a tooltip), body, Like (with a reactions count), Reply (threaded, with an inline reply editor), "…" (Edit, which shows an "edited" marker; Pin to top; Copy link; Delete), and a "Seen by N" read receipt. [01 §3.5, ARCH]
- IP-007 `P0` An empty Updates tab shows an original illustration and "No updates yet" plus the composer focus hint. [05 §14.1]
- IP-008 `P0` The Item card tab shows every column value in the same editors as the table cells (CE-*). Edits stay in sync with the table instantly in both directions. [derived]
- IP-009 `P0` The Activity log tab is a chronological list of who changed which column from what to what (rendered before → after, e.g. status pills), filterable by column and person. [ARCH, 02 §13]
- IP-010 `P1` The Files tab shows a grid/list of the item's files from Files columns and updates, with upload by dropzone and the lightbox. [04 §8]
- IP-011 `P1` A Subitems section in the Item card lists subitems with an add row. [derived]
- IP-012 `P1` For CRM objects, the panel shows **related records** (Account → Contacts, Deals, Activities) as linked lists, plus a "Log activity" quick action (call / email / meeting / note). [05 §11.4 KS+, KS]
- IP-013 `P1` Realtime: a new update from another user appears in the open panel without a reload, with a subtle highlight. [02 §13]
- IP-014 `P2` The panel can be undocked to a full page (`Open as page`) and has a split view that keeps the board visible. [05 §17.8]

---

## board-views
- BV-001 `P0` View tabs row is about 40px. Each tab is a 16px icon plus a 14px label with 8–12px padding. The active tab has a 2px `--primary` underline and `--text`; inactive tabs are `--text-muted`; hover shows a `--hover-wash` pill. Overflow tabs go into an "N more ▾" menu. [04 §2.1]
- BV-002 `P0` Tab "…" menu (on hover or right-click): Rename · Duplicate · Share · Pin/Unpin · Lock view · Set as default · Export* · Delete. (*chart/table only) [04 §2.1]
- BV-003 `P0` "+" opens the Add view popover (about 280px): Table, Kanban, Chart, Calendar, Timeline, Gantt*, Form, Files, Dashboard, then "More views" → the Views Center modal (category rail, search, tiles about 220×160 that lift on hover and show "Add to board"). (*Gantt may be the Timeline "Project mode", see BV-041) [04 §2.2]
- BV-004 `P0` Given a new view is added, then its tab enters inline rename and, if the view needs configuration (Chart, Kanban, Calendar, Map), its settings drawer opens automatically. [04 §2.2]
- BV-005 `P0` Switching views keeps the toolbar mounted and crossfades only the canvas over about 100ms. There is no full-page spinner. [04 §13]
- BV-006 `P0` Every view type can be created, configured and deleted through **both** the UI and the API (`/api/v1/views`) with the same config schema. [04 §0, §14.1]

### Kanban
- BV-010 `P0` Canvas: `--surface-sunken` (#f6f7fb-family), horizontal scroll, 16px padding, 16px lane gap. Lanes are about 272px wide. [04 §3.1]
- BV-011 `P0` Lane header: a full-width bar in the label color, 40px tall, top radius 8, text 14px/600 (contrast-computed color) with the count "Proposal / 4". The lane body is tinted with the label color at 10–15%, bottom radius 8, 8px padding and an 8px gap between cards. [04 §3.1]
- BV-012 `P0` **CRM lane totals:** on boards with a currency column, the lane header shows Σ value and weighted Σ (value × probability), e.g. "$1.2M · wtd $480K". [04 §14.4]
- BV-013 `P0` Card: white, radius 8, 1px border or shadow-xs, 12px padding. It shows an optional cover (about 140px, crop/fit), the name at 14px/500 clamped to 3 lines, one field row per chosen card column (status as a 24–28px radius-4 pill, people as 24px avatars, date with a calendar icon that turns red when overdue, numbers right-aligned), and footer chips (updates count, subitems "2/5"). [04 §3.1]
- BV-014 `P0` Card hover shows shadow-small and a "…" that fades in over 100ms (Open, Add subitem, Move to, Duplicate, Copy link, Archive, Delete). Fields on the card are inline-editable (status and people open their pickers). Clicking elsewhere on the card opens the item panel. [04 §3.1, §3.4]
- BV-015 `P0` Given a card is dragged to another lane, then on pick-up it tilts 2–3°, takes shadow-large and 0.95 opacity, and leaves a dashed placeholder. The target lane body darkens its tint and a gap opens. On drop it settles in 150ms and the divide-by column is written optimistically. On failure it snaps back with "Couldn't move ‹noun›. Try again" and Retry. [04 §3.3, §3.4]
- BV-016 `P0` Dragging within a lane reorders the cards, and the order persists per view. Dragging a lane header reorders lanes for this view only. A lane can collapse to a 40px vertical strip with rotated text and the count. [04 §3.1, §3.3]
- BV-017 `P0` "+ Add ‹noun›" (32px ghost) at the bottom of each lane opens an inline input. Enter creates the item with that lane's value, and the input stays open for the next entry. [04 §3.3]
- BV-018 `P0` Kanban keyboard: arrow keys move between cards and lanes, Enter opens, Space picks up, arrows move, Space drops, Esc cancels. Each move is announced through `aria-live`. Cards have visible focus rings. [04 §3.3, §14.2]
- BV-019 `P0` Settings drawer (about 320px, non-modal, changes apply live, no Save button): Divide by (status / group / connect column) · Hide empty lanes · Cover column + crop/fit · Card fields (search, select all, **drag to set per-view order**, per-field style pill/text/icon) · Show subitems. [04 §3.2, §14.3]
- BV-020 `P1` Loading shows 3 lane skeletons with 3 shimmer cards each. Filtered to zero shows "No results match your filter" plus "Clear filters". A disallowed drop shows the not-allowed cursor and no highlight. [04 §3.4]
- BV-021 `P1` Multi-select on cards (a checkbox appears on hover) adds a 2px `--primary` border and brings up the bulk bar (BT-080). [04 §3.4]
- BV-022 `P2` WIP limit per lane: the header turns warning-colored when the count exceeds the limit. [04 §14.4]

### Calendar
- BV-030 `P0` Toolbar: Today (outlined) · ‹ › (32px) · range title (18px/600) · Month/Week/Day segmented control (selected segment `--primary-selected` with `--primary` text) · search · filter · settings. [04 §4.1]
- BV-031 `P0` Month grid: 7 columns (week start configurable), day cells ≥120px tall, today shown as a 24px `--primary` circle, events as 20–22px radius-4 chips in the color-by color, "+N more" opens a day popover, and multi-day items render as spanning bars. [04 §4.1]
- BV-032 `P0` Week and Day views have 48px hour rows, an all-day lane, and a red "now" line with a dot. Event blocks are sized by duration (default 30 minutes). [04 §4.1]
- BV-033 `P0` Drag an event to another day or time to rewrite the date. Drag the bottom edge to resize (timeline-backed). Click an empty slot to quick-create an item with that date. Hovering an event shows a tooltip card (name, board/group, date, status pill). [04 §4.3]
- BV-034 `P0` An **"Unscheduled (N)" tray** lists items with no date, and they can be dragged onto the grid to schedule them. The header states how many items are hidden for lacking a date. [04 §4.3, §14.5]
- BV-035 `P1` Settings: date/timeline columns plotted, color by (group / status / person / connect / none), label by, show time slots, hide weekends, event duration (30–240), and view mode persisted per user. [04 §4.2]
- BV-036 `P1` Keyboard: `T` today, ←/→ previous/next, `M`/`W`/`D` mode, `N` new. [04 §4.3]

### Timeline / Gantt
- BV-040 `P0` Timeline view: a group-by lane header on the left, a time grid with zoom Days/Weeks/Months/Quarters/Years, bars 28–32px with radius 4 in the color-by color and the name inside (or outside when the bar is short). Dragging moves a bar, dragging an edge resizes it, and clicking an empty row space creates an item with that range. While dragging, a snap guide and tooltip show "Nov 12 → Nov 19 (8d)". [04 §5.1, §5.4]
- BV-041 `P1` **Project mode** (one view, not two): a split pane with a left grid (resizable splitter, `Ctrl+G` toggles all groups), Auto-fit, zoom ± anchored to the cursor (250ms), Today line, dependencies (arrows 1.5px `--text-muted`, primary on hover, drag from an end dot to create), cascade preview ghosts when a predecessor moves, baseline snapshot (gray shadow bars, green or red against the baseline), milestones as diamonds, group summary bars. [04 §5.2, §14.6]
- BV-042 `P1` Keyboard: arrows nudge the selected bar by ±1 unit, Shift+arrow resizes, `Z` auto-fits. [04 §5.3]
- BV-043 `P0` Empty state with no date or timeline column: "To use this view add a Timeline or Date column" plus a primary "Add column" button. Items without dates show a ghost "+ Set dates" bar on row hover. [04 §5.3]

### Chart
- BV-050 `P0` Chart types: pie, donut, column, bar, line, smooth line, area, bubble, and stacked plus 100%-stacked for column, bar, area and line (≥16 types), chosen from a 48×48 thumbnail gallery (selected tile has a 2px `--primary` border and `--primary-selected` background). [04 §6.1]
- BV-051 `P0` Data settings: X-axis (status / person / group / board / name / date with day–year bucketing), Y-axis (count or a number column with sum/avg/min/max/count), Stack by (required for stacked types; otherwise an inline error "Choose a column to stack by"), Sort (X or Y, asc/desc), Include subitems. [04 §6.2, §6.4]
- BV-052 `P0` Customization lives **in the same panel** with a live preview: per-label color, name and order (drag), data labels, legend position, percentages, cumulative toggle, goal line, chart title. Custom colors are free. [04 §6.3, §14.7]
- BV-053 `P0` Hovering a bar or slice shows a tooltip (white, shadow-medium, radius 8, 8×12 padding) with swatch, label, value and % of total. **Clicking a bar or slice opens a drill-down list of the matching items**, and each row opens the item panel. [04 §6.4]
- BV-054 `P0` The donut center shows the total (Poppins 24–32px) with a "Total" caption. Bars grow from the baseline over 400ms (enter curve) on data change only, never on resize. [04 §6.4]
- BV-055 `P1` Export PNG / SVG / CSV / PDF, Print, and Full screen from the "…" menu. [04 §6.4]
- BV-056 `P1` Chart aggregation runs on the server. A 50k-item board renders a chart in under 500ms. [04 §14.15]

### Form
- BV-060 `P0` Builder is a full page with three panes: left (about 280px) outline and content blocks with drag reorder and a hidden-question eye-slash; center live WYSIWYG canvas (logo, cover, 32px title, rich description, question blocks; a selected block gets a 2px `--primary` outline); right (about 320px) settings for the selected question. Top bar: Back · name · Build | Design | Settings · Preview (desktop/mobile) · **Share form** (link, embed, QR). [04 §7.1]
- BV-061 `P0` Question types map 1:1 to columns, and adding a question creates a column: short/long text, number, email, phone, link, date (+time), timeline, status (radio/dropdown), dropdown (multi), checkbox, rating, location/country, file upload, connect boards, name (always present). [04 §7.2]
- BV-062 `P0` Per-question settings: title, description, required, hidden, default, placeholder, validation (min/max, email/URL), prefill from URL param, **conditional logic** (show if [question] [is / is not / contains] [value], AND/OR). The outline shows a branch icon on conditional questions. [04 §7.1, §7.6]
- BV-063 `P1` Layout supports a page container (classic) vs one-by-one steps, and mixed. In one-by-one mode there is a progress bar, Enter advances and Shift+Enter makes a newline. [04 §7.1, §7.5]
- BV-064 `P1` Design: theme presets, background color or image, accent, font, alignment, logo, button text. Branding removal is free. [04 §7.3, §14.12]
- BV-065 `P0` Settings on **one page**: thank-you title and message, "Submit another", redirect URL, require login, close on a date or after N responses, anti-abuse (honeypot plus rate limit; CAPTCHA optional), notify on submit, copy to respondent, target group. [04 §7.4, §14.12]
- BV-066 `P0` Submitter states: focus shows a `--primary` border and ring; an error shows a `--danger` border, an inline message and a scroll to the first error; submit loading shows a spinner with locked width; success shows a checkmark (emphasize curve) and the thank-you text; a closed form shows "This form is no longer accepting responses". [04 §7.5]
- BV-067 `P2` CRM lead routing on submit: round-robin owner assignment, plus dedupe against Contacts by email. [04 §14.12]

### Files / Map / Cards / Workload
- BV-070 `P1` Files view: collects files from Files columns and updates. Grid/List toggle; tiles about 200×180 (thumbnail or a colored type tile, name, item link, uploader and date); hover shows a checkbox, download and "…" (Preview, Download, Open in item, Rename, Copy link, Delete). The whole view is a dropzone with a dashed `--primary` overlay. The lightbox has arrow navigation and zoom. [04 §8]
- BV-071 `P2` Map view: pins colored by color-by, clusters, a pin popover with "Open item", a list panel, fit-to-pins, **lasso territory filter** and "near me". Empty state: "Add a Location column to see your items on the map". [04 §9, §14.14]
- BV-072 `P2` Cards and Gallery views: a responsive grid with a minimum of 260px per card, the Kanban card anatomy, and a 4:3 cover for gallery. [04 §10]
- BV-073 `P2` Workload view: one row per person, circles sized and colored by load (green under capacity, red over), and dragging an item to another person reassigns it. [04 §11]

---

## board-toolbar
- TB-001 `P0` Toolbar is 40px tall with 8px gaps. Left to right: "New ‹noun›" split button (primary, 32px, radius 4; the main part adds at the top of the first group, the caret offers New group / Import) · Search · Person filter · Filter · Sort · Hide · Group by · "…" (row height, conditional coloring*, show summary, export). (*P2) [02 §2.1, 04 §2.3]
- TB-002 `P0` Search: an icon that expands to a 200→280px input on focus (200ms). It filters live as you type, highlights matches with `--primary-highlighted`, and has options to include subitems and updates. Cmd/Ctrl+F focuses it. [02 §2.1, 04 §2.3]
- TB-003 `P0` Person filter: a popover of avatars, where one click filters to "Person is X" and the button shows the selected avatar. [02 §2.1]
- TB-004 `P0` Filter popover, **Quick** tab: a column-by-column grid of value chips, **each with its count**. **Advanced** tab: rule rows `[Where] [column] [operator] [value]` with operators matched to the type (is / is not / contains / is empty / is any of / > / < / between / relative dates), plus add rule, add group, AND/OR and "Clear all". [04 §2.3]
- TB-005 `P0` Given any filter is active, then the Filter button turns `--primary-selected` with the rule count, **active filters show as removable chips under the toolbar**, and a "Save to this view" button appears whenever the temporary state differs from the saved one. [04 §2.3, 02 §15.12]
- TB-006 `P0` Sort: rule rows of column plus Asc/Desc, multi-level, with "Save to this view". [02 §2.1]
- TB-007 `P0` Hide: a column checklist with search, select all and an "x/y columns" count. Changes apply live. [02 §2.1]
- TB-008 `P1` Group by: group rows by status, person, date (with bucket) or dropdown, with "Save to this view". [02 §2.1]
- TB-009 `P1` Filter, sort, group and hidden-column state is encoded in the URL (`?view=…&f=…`), so pasting the URL reproduces the exact state. Named saved filter sets can be shared. [04 §14.11, 01]
- TB-010 `P1` Board "…" menu groups: View (collapse header, new tab, fullscreen) · Board (favorite, save as template, duplicate ▸ with "keep subscribers", move to ▸, rename, privacy) · Data (export to Excel, import, print, board settings) · Activity & integrations (activity log, automations (n), integrations, permissions, board email address, board notifications) · Danger (archive, delete). There is a search field at the top. [02 §2.2, 05 §7]

---

## dashboards
- DB-001 `P0` Header: name 32px inline-editable, optional description, star, avatar stack, Share, Activity, "…" (Duplicate, Export PDF/image, Present, Settings, Delete). [04 §12.1]
- DB-002 `P0` Toolbar: "+ Add widget" (primary split) · "N connected boards" chip · search · person filter · dashboard filter · present/full screen. [04 §12.1]
- DB-003 `P0` Canvas: `--surface-sunken` with 24px outer padding, a 12-column grid, about 40px row height and a 16px gutter. Widgets snap to grid units. [04 §12.1, §12.2]
- DB-004 `P0` Owners can drag widgets by the header handle (move cursor) and resize from the bottom-right grip and edges **without switching to an Edit mode**. Other widgets reflow vertically (compacting), and the drop placeholder has a `rgba(primary,.1)` fill with a dashed `--primary` border. A "Lock layout" toggle disables this. Viewers cannot move widgets. [04 §12.2, §14.9]
- DB-005 `P0` Widget chrome: white, radius 8, 1px border or shadow-xs, 16px padding. The header (about 48px) has the title at 16–18px/600 (double-click to rename) and an optional 12px subtitle. On hover it shows filter (with a dot when active), settings, full screen and "…" (Settings, Rename, Duplicate, Filter, Full screen, Dock/Undock, Export, Print, Move to dashboard, Delete with confirm). [04 §12.3]
- DB-006 `P0` Widget states are each designed: type-specific skeleton; unconfigured ("Connect boards to see data" + Select boards / "Choose columns" + Open settings); no data after filter; error with Retry; a stale spinner in the header. [04 §12.3]
- DB-007 `P0` Add widget: the popover lists Chart, Numbers, Battery, Table, Calendar, Text, Countdown, Timeline, Workload*, Files* and "More widgets…". The Widgets Center modal (about 960×640, radius 16) has a category rail, search and lift-on-hover tiles. A new widget drops into the first free slot, scrolls into view, shows a 1s `--primary` outline pulse, and opens its settings when it needs configuration. (*P2) [04 §12.5]
- DB-008 `P0` Widget settings panel: right side, 360–400px, 250ms slide, does not block the widget, **the widget preview updates live**, everything autosaves, and there is "Reset to defaults". Sections: Boards (with per-board groups) · Columns · Type options · Customization. [04 §12.6]
- DB-009 `P0` Numbers widget: calculation (sum / avg / median / min / max / count) over number columns or item count, unit and direction, prefix/suffix, format (number / % / currency). It shows one value in Poppins, auto-scaled 32–64px, abbreviated ("1.2M") with the exact value and the aggregation in a hover tooltip ("Sum of Deal Value across 2 boards"). [04 §12.7]
- DB-010 `P1` Numbers widget extras: **delta vs previous period** (▲ 12% in green, ▼ in red), a sparkline and a goal bar. [04 §12.7, §14.10]
- DB-011 `P0` Battery widget: a 24–32px segmented bar (radius 4) by label color with a large "64% done" and a legend of circles. Hover shows label, count and %. It supports multiple status columns and an optional weight column. [04 §12.7]
- DB-012 `P0` Table widget: a cross-board table with board/group indicators, cells editable in place, row height single/double/triple, and subitem display modes. [04 §12.7]
- DB-013 `P1` Calendar, Timeline and Chart widgets reuse the board-view components and config (BV-03x/04x/05x). [04 §12.7]
- DB-014 `P1` Countdown widget (digit blocks with unit labels, flip/opacity tick) and Text widget (rich text). A "Section header" widget spans 12 columns with no card chrome. [04 §12.7]
- DB-015 `P0` Board connections: a searchable checkbox list across workspaces, with connected boards on top (each with ×), and an "Auto-include in existing widgets" option (default on). There is **no plan-based board limit**, and there is one dashboard engine. [04 §12.4, §14.8]
- DB-016 `P0` Dashboard filter panel: pick a board (or all), then Quick chips with counts and Advanced rules (the same component as TB-004). It applies to every widget, and per-widget filters add to it. Named filter sets are saved and shareable by URL. [04 §12.8]
- DB-017 `P1` Present mode: full-screen with no chrome, optional auto-rotate between dashboards on a timer. Export the whole dashboard to PDF. [04 §12.9]
- DB-018 `P1` A board can embed a dashboard as a view tab, using the same grid. [04 §12.1]
- DB-019 `P2` "Explain this chart" AI insight on chart and number widgets. [04 §12.5]
- DB-020 `P1` On mobile widths (<768px) widgets stack in a single column in grid order. [04 §12.2]

---

## wizards
- WZ-001 `P0` Every modal is built on one `<Dialog>`: focus trap, `aria-modal`, focus returns to the trigger, Esc closes (if the form is dirty, it asks "Discard changes?"), scroll lock, inert background. Sizes: S 400 / M 580 / L 800 / Full (24px inset). The backdrop is the navy-tinted `--backdrop`. Panel radius 16 (L/Full) or 8 (S/M), shadow-large. Enter: fade plus scale .96→1 over 250ms (enter curve). Exit: 150ms (exit curve). [05 §1.6, §18]
- WZ-002 `P0` Modal anatomy: title in Poppins 24/30 weight 500; header padding 24–32; a 32px ghost × at the top right; footer right-aligned with Cancel (tertiary) and the primary button. Inputs are 40px with radius 4 and a `--border-strong` border; hover darkens the border, focus turns it `--primary`, and an error shows a `--danger` border with 12/16 red helper text. [05 §1.6, 01 §4.6]
- WZ-003 `P0` Primary button: hover `--primary-hover`; active scale .97 for 100ms; disabled `--disabled-bg` with 38% text; loading swaps the label for a 16px spinner and keeps the width locked (no reflow). [05 §1.6]
- WZ-010 `P0` Create board modal (M): an optional "Start from" segmented control (Blank · CRM template · Import CSV) at the top; **Board name** prefilled "New board" and **auto-selected**; **Privacy** radios Main / Private / Shareable, each with a helper line; **Managing** chips (Deals, Leads, Contacts, Accounts, Activities, Projects, Tasks, Items, Custom… which reveals an input). Create is disabled while the name is empty. Enter submits. After creation the user lands on the new board in under 800ms. [05 §3]
- WZ-011 `P0` Choosing a CRM object type in Create board seeds the proper columns and status labels (for example Deals: Stage, Owner, Value, Probability, Close date, Priority, Account relation, Source…) with CRM-aware colors (Won = green, Lost = gray/red). [05 §3 KS+, 02 §15.5]
- WZ-012 `P1` Create board shows a live mini-preview with the chosen noun ("+ Add deal"), and remembers the last privacy choice per workspace. [05 §3 KS+]
- WZ-020 `P1` Templates center is a **side sheet or split view that keeps context** and has its own deep-link URL. Search (fuzzy, including column names), a category rail (selected `--primary-selected`), cards about 280×220 in 3–4 columns with a 24px gap (thumbnail, title, 2-line description, "Includes automations"/"Includes dashboard" badges). Hover lifts the card 2px and fades in "Use template" and "Preview" over 150ms. [05 §4, §17.8]
- WZ-021 `P1` Template preview is an **interactive** live board with sample data and tabs per board for multi-board solutions, plus "What's included" (boards, dashboards, automations) and "Use template". [05 §4.2 KS+]
- WZ-022 `P0` Using the CRM solution template installs Deals, Leads, Contacts, Accounts and Activities **with every relation prewired** and demo data that can be cleared in one click. A setup progress checklist shows while it runs. [05 §4 KS+, §14.2]
- WZ-023 `P2` "Install into existing board" merges a template's columns and automations into a board. [05 §4 KS+]
- WZ-030 `P1` Add workspace modal (about 480px): a 64px avatar (color from ≥20 swatches or an upload), name (required), privacy Open/Closed with descriptions, and optional description. It lands on the workspace home empty state. [05 §5]
- WZ-040 `P1` Wizards with 3 or more steps use a left-rail stepper (completed steps show a check and are clickable), validate per step on Next (focusing and scrolling to the first error), show "Step n of N", move between steps with a 16–24px slide plus fade over 250ms, end with a summary review step, and mark the active step with `aria-current="step"`. [05 §15]
- WZ-041 `P1` Closing a wizard partway asks "Keep your progress?", and the draft resumes when the wizard is reopened. Every wizard step has its own URL. [05 §15, §17.8]
- WZ-050 `P0` Confirm dialog (S): title "Delete this board?", body text explaining whether it can be restored ("Moves to Trash for 30 days"), and Cancel plus a destructive button in `--danger`. **Initial focus is on Cancel.** Item-level deletes do **not** confirm; they use an Undo toast instead. [05 §13.1]
- WZ-060 `P1` Empty states follow one pattern: an original illustration of 160–240px, a title in H3 18/24, 1–2 lines of `--text-muted` text no wider than 360px, a primary CTA, an optional secondary link, and a "Press ⌘K" hint. [05 §14.1, §14 KS+]
- WZ-061 `P2` Onboarding: coach marks (title, 1–2 lines, "Next (1/3)" / "Got it", an 8px pulsing dot that loops every 1.5s), a getting-started checklist ("3/7") with check animations, role-aware tasks (SDR / AE / manager), dismissal remembered per user, and "Skip tour". [05 §14.2]

---

## automations
- AU-001 `P0` Entry: an "Automate (n)" header button and board "…" → Automations. This opens the Automations center as a side sheet or overlay with a left nav: Templates · Board automations (n) · Runs/History · Usage. [05 §9.1]
- AU-002 `P0` Recipe gallery: search, category chips (Status change, Notifications, Recurring, Item creation, Due dates, Move item, Dependencies, Subitems, Email & activities, CRM). Recipe cards are about 280×140 with a 1px border, radius 8 and 16–24px padding, showing the sentence at 16/22 with **bold, underlined tokens**. Hover turns the border `--primary` and shows "Add to board". [05 §9.1]
- AU-003 `P0` Sentence builder: the sentence is shown at 24–32px. Unset tokens are generic ("status", "something", "someone") with a 2px underline and 4px offset; they are buttons with `aria-haspopup`. Clicking a token opens a searchable popover: columns filtered by compatible type (incompatible ones are hidden), label values shown as **real colored pills**, the people picker including "Person in column…", and a message editor with dynamic-value chips ({item.name}, {board.name}). [05 §9.2, §18]
- AU-004 `P0` After a token is set, focus jumps automatically to the next unset token. Tab moves from token to token and Enter confirms. "Create automation" stays disabled until every token is set, with the tooltip "Fill in all fields". On success: toast "Automation created", and the new automation appears in the list with its toggle on. [05 §9.2]
- AU-005 `P0` Custom builder: "When…" opens a trigger list (item created, status changes, column changes, date arrives, every period, update created, button clicked, subitem created). "+ Add condition" adds "and only if…" rows. "Then…" opens an action list (notify, create item, move to group, change status, set date, assign person, create update, send email*, archive, duplicate, create subitem, connect items). Multiple actions can be chained. The name is auto-generated from the sentence and editable. (*P1) [05 §9.3]
- AU-006 `P0` Board automations list: each row shows the sentence summary (tokens bold), creator avatar, "Created 3d ago", an on/off toggle (toast "Automation turned off") and "…" (Edit, Duplicate, Activity, Delete with confirm). Empty: "No automations yet" plus "Browse templates". [05 §9.4]
- AU-007 `P0` The automation engine runs on the server, is org-scoped and idempotent, and guards against loops (an automation cannot re-trigger itself more than N times per item per minute). [ARCH, KS]
- AU-008 `P0` Runs log: a table of timestamp, automation, item link and a status pill (Success `--status-done` / Failed `--status-stuck` / Pending). A detail drawer shows the plain-language error ("Column was deleted") and the before/after payload. Filters: date, status, automation. [05 §9.5]
- AU-009 `P1` **Retry run** with one click, **"Test with item…"** dry run that previews what would happen, and **"Run on existing items"** backfill. [05 §9 KS+]
- AU-010 `P1` Usage meter "X / N actions this month", which turns warning at 80% and danger at 100%, shows per-automation cost and a forecast. [05 §9.5, §17.4]
- AU-011 `P2` Version history and an owner per automation. An "Automation broke" notification deep-links to the fix. [05 §9 KS+]

---

## crm
- CR-001 `P0` A first-class object nav (SH-021) of Deals, Leads, Contacts, Accounts and Activities. Each one is a real board kind with the right item terminology. [01 §9.3, ARCH]
- CR-002 `P0` Seeded relations work both ways: Deal ↔ Account, Deal ↔ Contacts, Contact ↔ Account, Activity ↔ Deal/Contact/Account. A link created from one side appears on the other side within one refresh cycle (<1s through realtime). [05 §17.7]
- CR-003 `P0` Mirror columns show related data (Deal → Account industry, Contact → Account owner). [02 §6.17]
- CR-004 `P0` Stage labels carry semantic flags `isDone`/`isWon`/`isLost`, which drive Kanban lane totals, forecasting, the battery and automations. The default colors are semantic: Won green, Lost gray, Negotiation blue, Proposal purple, Lead/Discovery orange/sky. [02 §15.5]
- CR-005 `P0` Pipeline Kanban (BV-012) shows value and weighted value per stage. The Deals board ships with "Active pipeline" (Won and Lost hidden), "Pipeline chart" and "Deal timeline" views preconfigured. [04 §0, §14.4]
- CR-006 `P1` Lead → Contact/Account/Deal conversion wizard: map fields, dedupe against existing Contacts and Accounts by email and domain, and keep the activity history. [05 §11 KS+, KS]
- CR-007 `P1` Log activity (call / email / meeting / note / task) from the item panel. It creates an Activities item linked to the record and updates "Last contacted". [KS]
- CR-008 `P1` Forecast dashboard template: weighted pipeline by close month, win rate, average deal size, deals by owner, stage conversion. [04 §12, KS]
- CR-009 `P2` Native two-way Gmail and Microsoft 365 email and calendar sync with per-connection health (last sync, error count). [05 §10 KS+]
- CR-010 `P2` Field-level masking of sensitive CRM fields (deal value, phone) by role. [05 §8 KS+]

---

## search
- SE-001 `P0` Cmd/Ctrl+K (and the top-bar magnifier) opens the palette: centered about 15vh from the top, 720–800px wide, radius 8–16, shadow-large, light backdrop, a 48–56px input with 16–18px text and placeholder "Search or type a command…". Implemented as `role="combobox"` with a listbox. [01 §3.3, §10]
- SE-002 `P0` One palette mixes **records** (items, contacts, accounts, deals), **navigation** (boards, dashboards, views, settings pages) and **commands** ("Create deal", "Go to Contacts", "Assign to me", "Toggle dark mode", any wizard). It uses fuzzy matching and shows keyboard hints on command rows. [01 §3.3, §9.5, 05 §17.14]
- SE-003 `P0` With an empty query it shows "Recently visited" (type icon, name, breadcrumb). [01 §3.3]
- SE-004 `P0` Results are grouped by type with section headers. Rows are 40px with icon, name (the matched substring bold), breadcrumb and timestamp. ↑/↓ move, Enter opens, Cmd/Ctrl+Enter opens in a new tab, Esc closes and restores focus. [01 §3.3]
- SE-005 `P0` Filter chips: All · Boards · Items · People · Files · Updates · Dashboards. [01 §3.3]
- SE-006 `P0` Loading shows shimmer rows. No results shows an original illustration, "No results for '…'" and a suggestion to change filters. On error: "Search unavailable" with Retry. [01 §3.3, §7]
- SE-007 `P0` Server search is org-scoped and permission-filtered (private boards never leak), and the first results arrive in p95 < 200ms on the seed dataset. [ARCH, KS]
- SE-008 `P1` A preview pane for the highlighted result (item summary, status, owner). [01 §9.5]
- SE-009 `P2` "Recently deleted" can be opened from the palette, with restore. [01 §9.11]

---

## notifications
- NO-001 `P0` One **Activity center** (bell) replaces monday's split between Notifications and Inbox. It is a right panel 520–600px wide, full height under the top bar, white, shadow-large, sliding in over 250ms, with × at the top right. Tabs: All · Unread · Mentions · Assigned · Updates. [01 §3.4, §9.2]
- NO-002 `P0` Header: title (Poppins about 24px) and "…" (Mark all as read, Notification settings). There is a board/people filter and search. [01 §3.4]
- NO-003 `P0` Row: 40px avatar (a system icon for automations); a rich summary ("Dana changed Stage to Won on **Northwind**"); a board › item breadcrumb; relative time on the right. Unread rows have an 8px `--primary` dot at the left and a `--primary-highlighted` background. [01 §3.4]
- NO-004 `P0` Hover shows quick actions: mark read/unread and "…" (Mute this item, Delete). Clicking a row opens the item panel in context and marks it read. [01 §3.4]
- NO-005 `P0` The badge count updates through realtime within 1s of the triggering event, with no polling flash. [ARCH]
- NO-006 `P0` Events that notify: @mention, assignment to a people column, update on a subscribed item, automation notify action, date reminder. [05 §12.2]
- NO-007 `P0` Empty: "You're all caught up" with an original illustration. On error: a Retry banner. Loading: skeleton rows. [01 §3.4, §7]
- NO-008 `P1` Notification settings: a matrix of events × channels (in-app, email, push*) with toggles, an email digest (instant / daily / weekly) and Do-not-disturb scheduling. (*P2) [05 §12.2]
- NO-009 `P2` Snooze a notification. Rules by object ("only Deals > $50k"). Quiet hours per weekday. [05 §12 KS+]

---

## admin
- AD-001 `P0` Profile/account menu (about 480px, two columns, radius 8, shadow-medium; rows 32px with 20px icons, hover wash, 8px inset). Left column: Admin, Members, Teams, Trash, Archive, Import data, Audit log. Right column: My profile, Working status, Notification settings, Preferences (theme light/dark/system, language, density), Keyboard shortcuts, Log out. The header shows avatar, name and email (12–14px `--text-muted`). [01 §3.9, 05 §12.1]
- AD-002 `P0` Profile page: avatar (about 120px, "Change photo" overlay on hover), and click-to-edit rows (pencil on hover; blur or Enter saves, Esc cancels) for title, phone, location, time zone. Tabs: Personal info · Working status · Notifications · Language & region (date format, week start, 12/24h) · Password · Sessions (device, last active, revoke) · Two-factor. [05 §12.2]
- AD-003 `P0` Members admin: invite by email chips plus a role picker (Admin / Member / Viewer / Guest), invite link copy, a members table with role dropdowns, deactivate (not hard-delete). Only owners and admins can see it (RBAC enforced on the server, so a 403 for others). [01 §3.6, ARCH]
- AD-004 `P0` Board permissions modal (M): radio cards (1px border, radius 8, 16px padding; the selected card has a `--primary` border and `--primary-highlighted` background) for Edit everything / Edit content / Edit assigned rows (with a column picker) / View only. Save shows the toast "Board permissions updated". The server enforces each level (tested by API calls as a member). [05 §8.2]
- AD-005 `P1` Column permissions: tabs "Restrict view" and "Restrict edit", each with a people/team picker. Board owners are always included and shown greyed with a tooltip. [05 §8.3]
- AD-006 `P1` RBAC matrix (roles × actions) presented as a grid, plus "View as ‹role›" impersonation preview. [05 §8 KS+]
- AD-007 `P0` Audit log: security events (login, failed login, role change, permission change, token created, export, delete) with actor, IP, time and target. Filterable, exportable, append-only. [ARCH, 05 §8 KS+]
- AD-008 `P0` Unified **Board settings** surface with a left nav: General (name, description, owners, terminology, privacy) · Columns (drag, visibility, per-column "…") · Default values · Permissions · Automations · Notifications · Views (default view, locking) · Danger zone. Every section has a deep link. [05 §8.1, §17.1]
- AD-009 `P0` Security baseline is verified: CSRF origin check on every mutation (a cross-origin POST is rejected); rate limits on auth (5 failed logins per minute gives 429); CSP plus HSTS, nosniff, frame-deny and referrer-policy headers present; sessions revocable; API tokens stored hashed and shown once. [ARCH]
- AD-010 `P1` Trash (30-day restore) and Archive pages, each with search, restore and a permanent-delete confirm (owner only). [05 §7]
- AD-011 `P1` API tokens page (create, scope, last used, revoke) and Webhooks page (URL, events, signing secret, delivery log with replay). [ARCH, 05 §10 KS+]
- AD-012 `P2` Workspace health card: stale boards, broken automations, unused columns. [05 §6 KS+]

---

## inbox-mywork
- MW-001 `P0` My work page: every item assigned to me across boards, grouped by Past dates (overdue) · Today · This week · Next week · Later · Without a date. Each row shows name, board, status pill (editable inline) and date (editable). [01 §4.1]
- MW-002 `P0` Mark done from My work writes the board's done label and the row animates out with an Undo toast. [KS]
- MW-003 `P1` Filters: board, status, date-column choice. Option to hide done items. Search. [KS]
- MW-004 `P1` The Updates tab in the Activity center (NO-001) is the inbox: update cards from followed items, each with author, time, breadcrumb, body, Like, Reply with an inline editor, and a "Mark read" check. Empty state: "Inbox zero". [01 §3.5]
- MW-005 `P1` Home page: recently visited (cards), My work preview (next 5), Activity preview, favorites. [01 §4.1]
- MW-006 `P2` My work calendar mode and drag to reschedule. [KS]

---

## import-export
- IE-001 `P0` Import wizard (L, left-rail stepper per WZ-040): Source (Excel / CSV tiles about 140×120, radius 8, hover border `--primary`) → Upload → Destination → Map → Review → Import. [05 §11]
- IE-002 `P0` Upload: a dashed drop zone (2px dashed `--border-strong`, radius 8, `--surface-sunken`, about 520×240) with "Drag and drop your file here, or browse" and "Accepts .xlsx, .xls, .csv up to 25MB". On drag-over the border turns `--primary` and the background `--primary-highlighted`. Upload shows a 4px `--primary` progress bar. A parse error shows inline red text "We couldn't read this file". Multiple sheets show a sheet picker. File type and size are validated on the server. [05 §11.2]
- IE-003 `P0` Destination: New board (name prefilled from the filename, CRM object type) or Existing board plus group. [05 §11.3]
- IE-004 `P0` Mapping: a two-column table, "Column in file" (header plus 2–3 sample values in muted text) → "Column on board" (compatible existing columns, "+ New column (type)" or "Don't import"). It auto-maps by name similarity: matched rows show a green check, unmatched an amber dot. The item name mapping is required. Types are inferred (dates, numbers, emails, phones; ≤20 distinct values become status labels with auto colors). [05 §11.4]
- IE-005 `P0` **Dedupe step**: match on email, domain or a chosen key, with an action per match of Update existing / Skip / Create new, and counts shown. [05 §11 KS+]
- IE-006 `P0` **Validation preview**: per-row errors (bad email, unparsable date) listed and fixable inline before import. The primary button reads "Import 245 deals". [05 §11 KS+]
- IE-007 `P1` **Relationship mapping**: a "Company" text column maps to the Accounts relation and auto-creates missing accounts. [05 §11 KS+]
- IE-008 `P0` Import runs as a background job with a progress toast and a notification when it finishes. The result screen shows created/updated/skipped counts, "Go to board", and a downloadable error report CSV. [05 §11.5]
- IE-009 `P1` **Undo the whole import** (rollback by batch id) for 24h. Saved mapping templates for recurring imports. [05 §11 KS+]
- IE-010 `P0` Export board/group/selection to .xlsx and .csv: visible columns, formatted values plus raw-value columns where useful. Toast "Your export is being prepared", then a download. Every export writes an audit row. [05 §7, ARCH]

---

## Design tokens extracted

All values come from monday's open-source Vibe tokens (`monday-ui-style`, verified in docs 01/02/05) unless marked [OBS]/[verify]. Where research docs disagreed, the **resolved** value is shown and the conflict noted. KitStak should implement these as `--ks-*` (or the ARCHITECTURE names) in `src/styles/tokens.css`. Our primary hue is deliberately tuned (see recommendations) so the brand is not a clone.

### Core color — light / dark
| Role | monday light | monday dark | Notes |
|---|---|---|---|
| primary | `#0073ea` | `#0073ea` | |
| primary-hover | `#0060b9` | `#0060b9` | |
| primary-selected (selected row/tab/chip bg) | `#cce5ff` | `#133774` | |
| primary-selected-hover | `#aed4fc` | `#0d2e65` | |
| primary-highlighted (search hit, drop target, unread) | `#f0f7ff` | `#0d2753` | |
| surface-app (canvas behind sidebar/top bar) | `#eceff8` | `#181b34` | |
| surface-sunken (Kanban/dashboard canvas, empty panels) | `#f6f7fb` | `#30324e` / `#181b34` | |
| surface (cards, table, popovers) | `#ffffff` | `#181b34` (dialogs `#30324e`) | |
| text | `#323338` | `#d5d8df` | |
| text-muted (secondary, headers, icons, placeholder) | `#676879` | `#9699a6` (icons `#c3c6d4`) | dark muted fails AA on `#30324e` (3.9:1); see R-9 |
| hover-wash (universal) | `rgba(103,104,121,.10)` | `rgba(103,104,121,.30)` | |
| row-hover [OBS] | `#f5f6f8` | — | |
| ui-bg (chips, tracks, secondary button) | `#e7e9ef` | `#434660` | hover `#d8d9e0` / `#35384d` |
| border-strong (inputs) | `#c3c6d4` | `#797e93` | |
| border-subtle (grid lines, dividers, cards) | `#d0d4e4` | `#4b4e69` | |
| disabled-bg | `#ecedf5` | `#3c3f59` | disabled opacity `0.38` |
| link | `#1f76c2` | `#69a7ef` | |
| inverted-bg (tooltip, normal toast) | `#323338` | `#ffffff` | |
| backdrop | `rgba(41,47,76,.7)` | same | navy-tinted, never black |
| positive | `#00854d` (hover `#007038`, selected `#bbdbc9`) | | |
| negative / danger | `#d83a52` (hover `#b63546`, selected `#f4c3cb`) | | |
| warning | `#ffcb00` (hover `#eaaa15`, selected `#fceba1`) | | dark text on top |
| star / rating fill | `#ffcb00` | | |
| skeleton shimmer | `#f6f7fb` → `#e7e9ef`, 1.2s sweep | | |
| Black theme | bg `#111111`, dialog `#2c2c2c` | | optional P2 |

### Label palette (base / hover / selected) — authoritative source doc 02 §1.5
done-green `#00c875 / #0f9b63 / #80e3ba` · grass-green `#037f4c / #116846 / #81bfa5` · bright-green `#9cd326 / #7ca32b / #cde992` · saladish `#cab641 / #9d8f3e / #e4daa0` · egg-yolk `#ffcb00 / #eaaa15 / #ffe580` · working-orange `#fdab3d / #c0873c / #fed59e` · dark-orange `#ff6d3b / #c25531 / #ffb196` · peach `#ffadad / #c2888a / #ffd6d6` · sunset `#ff7575 / #c26163 / #ffbaba` · stuck-red `#df2f4a / #ad3f51 / #f0a1ad` · dark-red `#bb3354 / #92334c / #dd99a9` · sofia-pink `#e50073 / #c20062 / #ff8ac4` · lipstick `#ff5ac4 / #c24e9a / #fface1` · bubble `#faa1f1 / #be80ba / #fcd0f8` · purple `#9d50dd / #7d45b0 / #d0aeed` · dark-purple `#784bd1 / #6344a3 / #bba5e8` · berry `#7e3b8a / #673971 / #be9dc4` · dark-indigo `#401694 / #3c1f78 / #a08bc9` · indigo `#5559df / #4b4ead / #aaacef` · navy `#225091 / #274776 / #90a7c8` · bright-blue `#579bfc / #4c7cc1 / #abcdfd` (default group color) · dark-blue `#007eb5 / #0f6d97 / #80c2df` · aquamarine `#4eccc6 / #469e9b / #a6e5e2` · chili-blue `#66ccff / #569ec3 / #b2e5ff` · river `#74afcc / #588095 / #b3d0de` · winter `#9aadbd / #7b8895 / #ccd6de` · explosive/default `#c4c4c4 / #98999a / #e1e1e1` · american-gray `#757575 / #69696a / #bfbfbf` · blackish `#333333 / #222222 / #999999` · brown `#7f5347 / #684943 / #bfa9a3` · orchid `#e484bd / #ae5d8d / #ecbad7` · tan `#bca58a / #8a7862 / #d6cabc` · sky `#a1e3f6 / #81b6c5 / #d0f1fa` · coffee `#cd9282 / #976758 / #dec0b7` · royal `#216edf / #225eb7 / #95bbf2` · teal `#175a63 / #12484f / #8bacb1` · lavender `#bda8f9 / #9786c7 / #ded4fc` · steel `#a9bee8 / #8798ba / #d4dff4` · lilac `#9d99b9 / #7e7a94 / #ceccdc` · pecan `#563e3e / #453232 / #ab9f9f`.

> **Conflict resolved:** doc 04 §1.1 lists several different hexes from memory (royal `#0086C0`, chili-blue `#5559DF`, dark-orange `#FF642E`, tan `#A25DDC`, american-gray `#808080`). Doc 02's values come from the token CSS plus the live API, so **doc 02 wins**.

File-type colors: xls `#207245`, pdf `#bb0706`, doc `#2a5699`, ppt `#d64e2a`, zip `#e4901c`, media `#2ea2e9`.

### Typography
- UI font: Figtree (fallback Roboto, Noto). Title font: Poppins. Antialiased.
- Weights: 400 normal, 500 medium ("bold" token), 600, 700.
- Ramp (size/line-height): h1 32/40 (−0.5px) · h2 24/30 (−0.1px) · h3 18/24 (−0.1px) · text1 16/22 · **text2 14/20 (default UI and cells)** · text3 12/16 (captions, badges, helper).
- Usage: board title 24 Poppins 500 · workspace and dashboard title 32 Poppins 500 · modal title 24/30 500 · group title 18 500 in the group color · column header 14 400 muted · widget title 16–18 600 · number widget 32–64 Poppins 300–500 · badge 12/600.

### Spacing, sizing, radius, borders
- Spacing scale: 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80.
- Radius: 4 (inputs, buttons, pills, menu items, tree rows) · 8 (menus, popovers, cards, widgets, S/M dialogs) · 16 (main content card, L/Full modals, Widgets Center).
- Border: 1px everywhere; group edge **6px**.
- Heights: top bar 48 · sidebar row 36 (compact 28) · tree row 32–36 · table row 32/36/48 · column header 36 · view tabs 40 · toolbar 40 · button S/M/L 32/40/48 (padding 8/16/24) · input 40 (S 32, L 48) · menu row 32 · palette input 48–56 · palette row 40 · toast 48–56 · bulk bar 56–64 · Kanban lane header 40 · timeline cell bar 22 (radius 11) · battery 24.
- Widths: sidebar 256 (200–480; rail 56) · Kanban lane 272 · status picker 200–240 · people picker 280 · date picker 300 · Kanban/Chart settings drawer 320 · widget settings 360–400 · Activity panel 520–600 · item panel 600–900 · palette 720–800 · dialogs S 400 / M 580 / L 800.
- Icons: 20px in shell, 16px in menus/tabs/table.
- Avatars: 32 shell, 24 cells (22 small, 30 large), 40 notification row, 20 chip.
- Checkbox 16×16. Toggle 40×24 with a 16px knob.

### Elevation
- xs `0 4px 6px -4px rgba(0,0,0,.1)` (sticky header, resting card)
- small `0 4px 8px rgba(0,0,0,.2)` (tooltip, hover card)
- medium `0 6px 20px rgba(0,0,0,.2)` (menus, pickers, palette, bulk bar)
- large `0 15px 50px rgba(0,0,0,.3)` (modals, side panels, drag ghosts)
- Dark theme: same geometry, color `rgba(9,11,25,.5)`.
- Sticky-column shadow `0 0 8px rgba(0,0,0,.1)`, only when scrollLeft > 0.

### Motion
- Durations: 70 · 100 · 150 (productive) · 250 · 400 (expressive).
- Curves: enter `cubic-bezier(0,0,.35,1)` · exit `cubic-bezier(.4,0,1,1)` · standard `cubic-bezier(.4,0,.2,1)` · emphasize `cubic-bezier(0,0,.2,1.4)` (delight only).
- Mapping:
  - hover color: 70–100
  - menu or popover open: 150 fade plus 4px slide
  - chevron rotate: 150
  - panel and side sheet: 250
  - modal: 250 in, 150 out
  - sidebar collapse: 250
  - toast: 250 in, 150 out
  - chart grow: 400
  - star pop and confetti: 250–400 with emphasize
  - tooltip delay: 300
  - submenu open delay: 100–150
  - realtime flash: 600

### Focus and resolved cross-doc conflicts
- **TOK-FOCUS**: the docs disagree (doc 01 says a solid 2px `#0073ea` outline with 2px offset; docs 04/05 say a `0 0 0 3px rgba(0,115,234,.5)` glow). **Resolved:** `outline: 2px solid var(--ks-focus); outline-offset: 2px` on `:focus-visible` only. Grid cells and tree rows use an inset 2px ring. The single token `--ks-focus` equals primary.
- **TOK-MENU-DESTRUCTIVE**: doc 01 says destructive menu items are red; doc 05 says monday does not color them. **Resolved:** a divider, then a trash icon plus `--danger` text, always the last group.
- **TOK-TOAST-POS**: bottom-center versus bottom-left. **Resolved:** bottom-center, 24px offset. Auto-hide 6s, hover pauses.
- **TOK-PILL-TEXT**: computed by contrast (white vs `--text`, ≥4.5:1), not a lookup table.

---

## Where we beat monday

| # | monday weakness | KitStak answer (checklist IDs) |
|---|---|---|
| 1 | Upsell clutter in the chrome; paywall modals mid-flow | Chrome is navigation only; nothing ever blocks a flow (SH-014) |
| 2 | Notifications, Inbox and My Work overlap | One Activity center with tabs, plus My work (NO-001, MW-004) |
| 3 | Generic board tree for a CRM | First-class CRM object nav plus pinned saved views (SH-021, CR-001) |
| 4 | Single-workspace tree; favorites limited | Multi-workspace tree, cross-workspace favorites (SH-031, SH-042) |
| 5 | Search-only palette | Unified palette of records + navigation + commands + wizards (SE-002) |
| 6 | Few shortcuts, no sidebar toggle | g-chords, `c` create, `?` sheet, Cmd/Ctrl+\ (SH-035, SH-065) |
| 7 | 30px collapsed rail with no icons | 56px icon rail plus hover-peek (SH-034) |
| 8 | Partial grid keyboard, no range select, typing doesn't edit | Spreadsheet-grade grid keyboard and copy/paste (BT-100…106) |
| 9 | No global undo | Cmd/Ctrl+Z history beyond the toast (SH-064) |
| 10 | White text on light pills fails WCAG | Contrast-computed pill text, soft-pill option, AA in both themes (CE-011, CE-018, G-3) |
| 11 | No auto-fit columns | Double-click divider auto-fit and "Fit all" (BT-025) |
| 12 | Raw numbers, no locale | Intl formatting, compact display with tooltip (CE-040, CE-041) |
| 13 | Index-based, color-arbitrary status | Semantic isDone/isWon/isLost and CRM-aware colors (CE-016, CR-004) |
| 14 | Silent validation | Inline error state with aria-invalid (CE-002) |
| 15 | Inconsistent long-text Enter behavior | Enter saves, Shift+Enter newline, everywhere (CE-051) |
| 16 | Subitems are a separate board; rows jump on expand | Same-table hierarchy, indent/outdent, animated height (BT-050, BT-051) |
| 17 | Bulk bar covers the last rows; no bulk set-value | Bottom padding while selecting, bulk "Set value" (BT-081, BT-082) |
| 18 | Buried filters, not URL-shareable | Persistent filter chips, URL state, named filter sets (TB-005, TB-009, DB-016) |
| 19 | Wide boards jank | Row and column virtualization, 10k×40 at ≥55fps (BT-110) |
| 20 | API can't create Kanban/Chart/Calendar | Every view is UI+API parity (BV-006) |
| 21 | Kanban: no keyboard, locked field order, no lane totals | Keyboard DnD with aria-live, per-view field order, Σ and weighted Σ (BV-018, BV-019, BV-012) |
| 22 | Calendar hides undated items | Unscheduled tray plus hidden count (BV-034) |
| 23 | Timeline vs Gantt split | One timeline with Project mode (BV-041) |
| 24 | Chart customization hidden; custom colors paywalled | One panel with live preview, free colors (BV-052) |
| 25 | Dashboard Edit/View friction; plan board limits; two engines | Always-on drag for owners, lock toggle, no limits, one engine (DB-004, DB-015) |
| 26 | Numbers widget has no trend | Delta, sparkline, goal (DB-010) |
| 27 | Form settings scattered; branding removal paywalled | One settings page, free branding removal, CRM lead routing (BV-064, BV-065, BV-067) |
| 28 | Automation logs shallow; no dry-run or retry | Payload diff, retry, test-on-item, backfill, usage forecast (AU-008…010) |
| 29 | Import lacks dedupe, relations, row fixes, rollback | Dedupe, relation mapping, inline fix, rollback, saved mappings (IE-005…009) |
| 30 | Coarse permissions | RBAC matrix, field masking, "View as" (AD-006, CR-010) |
| 31 | CRM templates need manual relation wiring | Prewired CRM solution with clearable demo data (WZ-022, CR-002) |
| 32 | Heavy full-screen overlays lose context | Side sheets and split views, deep-linkable wizard steps (WZ-020, WZ-041) |
| 33 | Settings scattered | One Board settings surface with a left nav (AD-008) |
| 34 | Focus lost after pickers; weak ARIA | Focus returns to origin, grid/tree/combobox ARIA, WCAG 2.2 AA (BT-106, SH-025, SE-001) |
| 35 | Breadcrumbs weak | Breadcrumb with per-segment switchers (SH-060) |
| 36 | Map has no territories | Lasso territories, near-me (BV-071) |
| 37 | Dark-mode contrast weak | Per-theme tuned palette, AA on all text tokens (G-3, R-9) |

---

## Token conflicts with `docs/ARCHITECTURE.md` (Design language) — recommendations only

ARCHITECTURE.md was **not edited**. These are recommended values for the foundation/design-system owner.

| # | ARCHITECTURE.md says | Research shows | Recommendation |
|---|---|---|---|
| R-1 | Table rows 36px, compact 32 / comfortable **40** | monday: Small 32 / Medium 36 / **Large 48** (name wraps to 2 lines) | Use **32 / 36 / 48**. 40 gives no room for the 2-line wrap that makes "Large" useful. If 40 is kept, add a 4th "Expanded 48". |
| R-2 | Motion "120–200ms ease-out" | Vibe: 70/100/150 productive, 250/400 expressive, with 4 named curves | Replace with tokens `--ks-dur-1..5 = 70,100,150,250,400ms` and the curves `--ks-ease-enter/exit/standard/emphasize`. Panels and modals at 250ms fall outside "120–200" today. |
| R-3 | Status pills: "white text" | White on egg-yolk/peach/sky/bubble/chili-blue/lavender/steel/explosive fails WCAG | Text color computed from contrast (white or `--ks-text`) at ≥4.5:1 (CE-011). |
| R-4 | Primary "#0073EA-ish family, our own tuned scale" | monday primary `#0073ea`, hover `#0060b9`, selected `#cce5ff`, selected-hover `#aed4fc`, highlighted `#f0f7ff` | Pick a distinct but equivalent KitStak blue, for example `--ks-primary #1662dd`, hover `#0f4fb8`, active `#0b3f94`, selected `#d6e6ff`, selected-hover `#bcd5fd`, highlighted `#f0f6ff`. Check: white text on primary ≥4.5:1 (it is about 5.1:1 for #1662dd), and primary-on-selected readable. Keep the *roles* identical to the Vibe set. |
| R-5 | Fonts Figtree (UI) + Poppins (headings) | These are exactly monday's pairing (doc 04 suggests choosing our own) | Allowed (both are OFL fonts, and the contract says matching UX is fine), but for brand distinctness consider keeping **Figtree** for UI and swapping headings to a different geometric face (e.g. **Plus Jakarta Sans** or **Manrope** 600). Low priority; flag for product owner decision. |
| R-6 | `--surface-app` "very light cool gray" | monday canvas `#eceff8` (lavender-grey) under the shell; `#f6f7fb` behind Kanban/dashboards | Define **two** tokens: `--ks-surface-app` (shell frame, e.g. `#edf0f7`) and `--ks-surface-sunken` (view canvases, e.g. `#f6f7fb`). One token cannot serve both. |
| R-7 | Borders "1px `--border-subtle`" only | Two distinct border roles: layout `#d0d4e4` and input `#c3c6d4` | Add `--ks-border-strong` (inputs, checkboxes) alongside `--ks-border-subtle` (grid lines, dividers). |
| R-8 | Not specified | Radius 4/8/16, shadows xs/s/m/l, focus ring, backdrop, tooltip delay | Add the tokens: `--ks-radius-sm 4 / md 8 / lg 16`; shadows as in "Elevation"; `--ks-focus` 2px with 2px offset; `--ks-backdrop rgba(41,47,76,.7)`; `--ks-hover-wash rgba(103,104,121,.1)`. |
| R-9 | "Dark theme must look intentional" | Vibe dark secondary text `#9699a6` on `#30324e` is about 3.9:1 (fails AA) | Dark `--ks-text-muted` ≥ `#a9adbd` on raised surfaces. Retune label colors per theme (slightly lower luminance and saturation in dark) rather than reusing light hexes. |
| R-10 | Status palette names list (green-done … peach, + light variants) | 40 named colors, each with base/hover/selected | Store each label color as three tokens `--ks-label-<name>`, `-hover`, `-selected` (doc 02 §1.5 values). "Light variants" = `-selected`. |
| R-11 | Sidebar not specified | 256 default, 200–480 resize, 56 rail, rows 36/28 | Add `--ks-sidebar-w` (256), min 200, max 480, rail 56. |
| R-12 | Group: 6px border, footer summaries | Also: collapsed group renders summaries inline; add-row edge at 40% opacity; edges join with 4–8px end radii | Add to the design-language bullets (BT-010, BT-014). |
