# 04: Board Views and Dashboards (monday.com reference, KitStak spec)

> Scope: Kanban, Calendar, Timeline, Gantt, Chart, Form, Files, Map, Cards and Gallery board views, plus Dashboards (grid, widgets, Add-widget center, settings panel, filters, board connections).
> Audience: KitStak CRM engineers and designers. Everything here is an original-product spec. Do not copy monday logos, illustrations, mascots (for example the Llama Farm art) or icon artwork.

## 0. Provenance and confidence

| Source | What it gave | Confidence |
|---|---|---|
| monday API, read-only (`all_widgets_schema`, `get_board_info` on Deals 18438743477) | Exact widget config schemas for Battery, Calendar, Chart, Number, ListView (Table), Gantt and App-feature. Saved view list and filter shape. | **Exact** |
| monday Help Center via the knowledge tool | Feature lists and menu labels for Kanban, Chart, Form (WorkForms), Calendar, Gantt/Baseline, Files, Map, Countdown, Numbers, Battery and Dashboards. | **High** (wording paraphrased) |
| monday's open-source "Vibe" design system tokens, from memory | Colors, radii, shadows, spacing and motion curves | **High for tokens**. Per-component pixel values are marked *(verify)*. |
| Live browser inspection | **Blocked.** New browser tabs in this session landed on `auth.monday.com/auth/login_monday`, and choosing the "already signed in" account tile looped back to the login page. Only the original seed tab was signed in, and I was told not to drive it. | Not available |

**Action for the orchestrator:** re-run a short visual pass to confirm the *(verify)* pixel values once a signed-in tab can be shared. Re-signing in the shared browser profile should fix the problem. The structure, menus, states and behaviors below don't depend on that pass.

Sandbox facts (from API):
- The Deals board has these saved views: `Active Pipeline` (TableBoardView; filter `stage NOT_ANY_OF [4,5]`, i.e. hides Won/Lost; sort `deal_value`), `Pipeline Chart` (dashboard view) and `Deal Timeline` (dashboard view). The API reports type `null` for both dashboard views.
- View filter model (copy this shape): `{operator:"AND", groups:[{operator:"AND", rules:[{column_id, compare_value:[labelIndex...], compare_attribute, operator:"NOT_ANY_OF"}]}]}`, with `sort:[{column_id, direction}]`.
- The public API can only create TABLE, DASHBOARD, FORM and APP views. Kanban, Chart and Calendar are UI-only creations. **KitStak should make every view type creatable through API and UI parity.**

---

## 1. Shared design tokens (Vibe-equivalent → KitStak tokens)

Use these as KitStak `:root` tokens. Rename the prefix to `--ks-`.

### 1.1 Color (light theme)
| Token | Hex | Use |
|---|---|---|
| primary | `#0073EA` | Primary buttons, active tab underline, focus ring, selected state |
| primary-hover | `#0060B9` | Primary hover |
| primary-selected | `#CCE5FF` | Selected row/tab/chip background |
| primary-selected-hover | `#AED4FC` | |
| text-primary | `#323338` | All body text |
| text-secondary | `#676879` | Meta, placeholders, axis labels |
| text-disabled | `rgba(50,51,56,.38)` | |
| ui-border | `#C3C6D4` | Input borders |
| layout-border | `#D0D4E4` | Card and widget borders, dividers |
| ui-background | `#E7E9EF` | Neutral chip and track background |
| allgrey-background | `#F6F7FB` | Canvas behind dashboard widgets and Kanban lanes |
| bg-hover | `rgba(103,104,121,.10)` | Ghost button and menu item hover |
| positive | `#00854D` | Success text |
| negative | `#D83A52` | Error text and destructive menu items |
| warning | `#FFCB00` | |
| surface | `#FFFFFF` | Cards, widgets, popovers |

Status label palette (the user-pickable label colors, which drive Kanban lanes, chart slices and calendar chips):
`done-green #00C875`, `working-orange #FDAB3D`, `stuck-red #DF2F4A`, `grass-green #037F4C`, `bright-blue #579BFC`, `dark-purple #784BD1`, `royal #0086C0`, `sky #66CCFF`, `chili-blue #5559DF`, `berry #BB3354`, `sunset #FF7575`, `egg-yolk #FFCB00`, `lipstick #FF5AC4`, `dark-orange #FF642E`, `peach #FFADAD`, `bubble #FAA1F1`, `aquamarine #4ECCC6`, `tan #A25DDC`, `explosive (default/empty) #C4C4C4`, `american-gray #808080`, `blackish #333333`.
Label text on a status color is always white `#FFFFFF`. The only exceptions are light colors (egg-yolk, peach, bubble, sky), which use `#323338`. Compute this with a contrast check, not a lookup table.

Dark theme: background `#181B34`, surface `#30324E`, text `#D5D8DF`, layout-border `#4B4E69`. Night/black theme: background `#111111`, surface `#2C2C2C`. KitStak must ship light and dark from day one.

### 1.2 Type
- Body: **Figtree** (Vibe moved from Roboto to Figtree). Headings and big numbers: **Poppins**. KitStak should pick its own pair, for example Inter Display for numbers and Inter for UI, at the same scale.
- Scale: 12/16 (caption), 14/20 (default UI), 16/22 (emphasized), 18/24 (widget title, semibold 500–600), 24/32 (view title), 32/40 (board title, Poppins 500), 40–64 (Numbers widget value, Poppins 300–500).

### 1.3 Space, radius, elevation, motion
- Spacing: 4 / 8 / 16 / 24 / 32 / 48.
- Radius: small 4px (chips, status pills, inputs), medium 8px (cards, widgets, menus, modals), big 16px (large modals, the onboarding wizard).
- Shadows:
  - xs `0 4px 6px -4px rgba(0,0,0,.1)` (resting card)
  - small `0 4px 8px rgba(0,0,0,.2)` (hovered card, dropdown)
  - medium `0 6px 20px rgba(0,0,0,.2)` (popover, menu)
  - large `0 15px 50px rgba(0,0,0,.3)` (modal, drag ghost)
- Motion:
  - Durations: productive 70 / 100 / 150ms; expressive 250 / 400ms.
  - Curves: enter `cubic-bezier(0,0,.35,1)`, exit `cubic-bezier(.4,0,1,1)`, standard `cubic-bezier(.4,0,.2,1)`, emphasize `cubic-bezier(0,0,.2,1.4)` (slight overshoot for pills and success states).
  - Menus fade and slide 4px in 150ms. Side panels slide in over 250ms. The modal backdrop fades to `rgba(41,47,76,.7)`.
- Controls: buttons are 32 (small) / 40 (medium) / 48 (large) px high with 8/16px horizontal padding and radius 4. The focus ring is `0 0 0 3px rgba(0,115,234,.5)` *(verify)*.

---

## 2. View tab strip and Views Center (applies to every board view)

### 2.1 Anatomy
- Board header row: board name (32px Poppins), then a star, then an info icon. On the right sit an avatar stack, an Integrate/Automate button, an "Invite / N" button and a `...` menu.
- View tabs row (about 40px high *(verify)*):
  - Tabs: icon (16px) plus label, 14px text, with 8–12px horizontal padding.
  - Active tab: 2px primary underline and `#323338` text. Inactive tabs use `#676879`. Hovered tabs get a `bg-hover` pill.
  - `+` button at the end of the strip opens the **Add view** menu. Overflow tabs go into a "N more" dropdown.
- Each tab has a `...` menu (on hover, or right-click). Items:
  - Rename
  - Duplicate
  - Share view (public link, if allowed)
  - Pin view (owner only) / Unpin view
  - Lock view (creator, owners and admins can still edit)
  - Set as default *(verify)*
  - Export (chart/table only)
  - Delete (red)
- Collapsed board header: the tabs collapse into a single "Main table ▾" dropdown that lists saved views and "Add view". Users can toggle this with the chevron at the right of the header.

### 2.2 Add view menu
- Popover (about 280px wide). The top section shows the most-used views, each with an icon and a 1-line label:
  - Table
  - Kanban
  - Chart
  - Calendar
  - Doc
  - Gantt
  - Form
  - File gallery
  - Timeline
  - Dashboard (embeds widgets inside the board)
- A "More views" entry opens the full **Views Center** modal. The modal has a left category rail (Board views, Apps, Featured) and a searchable grid of tiles: Blank Table, Gantt, Timeline, Files, Gallery, Map, Workload, Chart, Calendar, Form, Kanban, Cards, Pivot and Boards, plus marketplace app views. Each tile is about 220×160 with a preview illustration, a name and a 2-line description. Hover lifts the tile (shadow-small) and shows an "Add to board" primary button.
- A new view gets a name prompt (inline rename on the tab) and opens its settings panel automatically if it needs configuration (Chart, Kanban, Calendar, Map).

### 2.3 Per-view toolbar (shared)
- Left side:
  - "New item" split button (primary, 32px; the caret opens Import items / New group)
  - Search (an expanding input, 200→280px on focus)
  - Person filter (avatar picker)
  - Filter (funnel icon; a count badge appears when active)
  - Sort
  - Hide (eye; columns/fields)
  - Group by / Divide by (view-dependent)
  - `...` overflow
- When a filter is active, the button turns primary-selected with the rule count. A "Save to this view" button appears so the unsaved filter can become the view's filter. This is important: monday distinguishes *temporary* filters from *saved* ones.
- Filter popover: Quick filters show a column-by-column grid of chips (each value has a count). There's an "Advanced filters" tab with rule rows: `[Where] [column] [is / is not / contains / is empty / is any of / greater than / ...] [value]`. You can add a rule or a group with AND/OR, and there's a "Clear all" link.

**What feels premium:** filter counts on every chip, instant client-side filtering under 50ms, and the same filter UI in every view and on dashboards.

---

## 3. Kanban view

### 3.1 Anatomy
- The canvas background is `#F6F7FB`, scrolls horizontally, and has 16px padding. Lanes have a 16px gap.
- **Lane** (about 272px wide *(verify)*; monday lanes are fixed width):
  - Header: a full lane-width colored bar in the label color, about 40px high, radius 8 on the top corners. It holds the white label text (14px semibold) and the item count, e.g. "Proposal / 4".
  - Lane body: tinted with the label color at about 10–15% *(verify)*, radius 8 on the bottom corners, with 8px padding and an 8px gap between cards.
  - Collapse chevron in the header: a collapsed lane becomes a 40px-wide vertical strip with rotated text and a count.
  - Bottom of each lane: a "+ Add item" ghost row, 32px, `#676879`. Hover gives a white background and primary text.
  - Lane order is drag-reorderable by the header.
- **Card** (white surface, radius 8, layout-border 1px or shadow-xs, 12px padding):
  - Optional cover image (from a Files column; Crop or Fit; about 140px tall).
  - Item name: 14px, weight 500, wraps to 3 lines then clamps.
  - Field rows: one row per selected "Card column". Each row has a column icon or label (12px `#676879`) and the value. Status values render as full-width colored pills (radius 4, 24–28px high). People render as 24px avatars. Dates render as a calendar icon plus a short date, red if overdue. Numbers render right-aligned.
  - Footer chips: an updates count (speech bubble plus number) and subitem progress ("2/5").
  - Top-right `...` (visible on hover only). Card actions menu:
    - Open item
    - Add subitem
    - Move to (group / board)
    - Duplicate
    - Copy item link
    - Archive
    - Delete (red)
- Card fields are **inline-editable**: click a status to get the label picker popover, click a person to get the person picker. Clicking anywhere else on the card opens the item panel (right-side slide-over, about 600–900px).

### 3.2 Settings panel (the cog at the top right opens a right drawer about 320px wide)
Sections, in order:
1. **Kanban column**: choose the status column (or Group or a Connect-boards column) that defines the lanes. Label "Divide by" in newer UI.
2. **Hide empty groups**: checkbox; appears only after a divide-by is chosen.
3. **Cover columns**: choose a Files column; mode Crop / Fit.
4. **Card columns**: a checklist of every board column (and subitem columns), with search, select all and drag-reorder. Ordering follows the main table column order *(note: monday locks field order to the table, which is a weakness)*.
5. **Subitems**: show subitems on cards (as a collapsible checklist).
Changes apply live behind the drawer. There's no Save button; the drawer is non-modal.

### 3.3 Interactions
- **Drag card between lanes**: rewrites the divide-by column value (for example Stage = Negotiation).
  - On pick-up, the card tilts about 2–3°, takes shadow-large, gets 0.95 opacity, and leaves a dashed placeholder at its origin.
  - The target lane highlights its body (darker tint), and a 2px primary insertion line or a gap opens between cards.
  - Drop animates 150ms into place. An optimistic update writes the value. On failure the card snaps back with a toast.
- Drag within a lane reorders (manual position persists per view).
- Drag a lane header to reorder lanes. This reorders the status labels' display order for this view only.
- "+ Add item" in a lane creates an item prefilled with that lane's value. An inline input appears with Enter to create and Esc to cancel. The new card lands at the bottom and the input stays open for rapid entry.
- **Keyboard (monday is weak here):** basically no card keyboard navigation. KitStak should add arrow keys between cards and lanes, Enter to open, Space to pick up, arrows to move, Space to drop, Esc to cancel, and announce moves through an aria-live region.

### 3.4 States
| State | Spec |
|---|---|
| Empty board | Centered illustration, "No items yet", primary "+ New item" |
| Empty lane | Body shows only "+ Add item" (unless Hide empty groups) |
| Loading | 3 lane skeletons, each with 3 shimmering card blocks (`#E7E9EF` → `#F6F7FB` sweep, 1.2s) |
| Filtered to zero | "No results match your filter" with a "Clear filters" link |
| Card hover | shadow-small, `...` fades in at 100ms |
| Card selected (multi-select via checkbox in the corner on hover) | 2px primary border plus a bottom batch-actions bar |
| Drop disallowed (e.g. a formula column) | not-allowed cursor; lane body gets no highlight |
| Error saving | card reverts; red toast "Couldn't move item. Try again" with Retry |

### 3.5 What makes it feel premium
Lane color identity (the whole column is tinted), live counts, inline edit without opening the item, fast optimistic drag, and lanes that use the exact same label colors as the table.

---

## 4. Calendar view

### 4.1 Anatomy
- Toolbar:
  - `Today` (outlined button)
  - `‹` `›` arrows (32px icon buttons)
  - Current range title (18px semibold, e.g. "November 2026")
  - Mode segmented control: **Month / Week / Day** (32px; selected segment is primary-selected with primary text)
  - Search
  - Filter
  - Settings cog
- **Month grid**: 7 columns (Sun or Mon start, configurable). Day cells have a minimum height of about 120px and a top-left date number (12–14px). Today's number gets a primary-filled 24px circle with white text.
  - Events are 20–22px chips with radius 4, background = color-by value, white text, and the item name truncated.
  - Overflow shows "+3 more", which opens a day popover listing everything.
  - Multi-day (Timeline column) items render as spanning bars across cells.
- **Week/Day**: a time gutter on the left (hourly rows of 48px *(verify)*) and an all-day lane at the top. Timed events are blocks sized by `event_duration` (default 30; options 30/45/60/90/120/180/240 minutes). A red "now" line runs across with a dot on the left.

### 4.2 Settings (from the exact schema: board view plus widget)
- `columns`: which date / timeline / week / creation_log / last_updated / mirror (lookup) / formula columns are plotted. Multiple columns are allowed. Each board supports up to 2 "time ranges" (a start/end pair of date columns).
- `color_by_type`: `group | board | color (status) | multiple-person | board-relation | dropdown | subtasks | parent | none`. Default is `group`.
- `label_by_type` (widget): `board | group | parent | name | text | status | date | numeric | person | dropdown | formula | country | tag | timeline | week | hour`. This is the secondary text on each event.
- `show_time_slots` (default true), `hide_weekends` (default false), `event_duration`, `view_mode` (`month | week | day`; persisted per user).
- Widget-only: `groups_data.group_ids_per_board` (limit to groups) and `exclude_board_ids`.

### 4.3 Interactions
- Click an event to open the item panel. Hovering an event shows a tooltip card (name, board/group, date, status pill).
- Drag an event to another day or time to rewrite the date. Drag the bottom edge in Week/Day to change the end (when backed by a timeline column).
- Click an empty slot to quick-create an item with that date (inline name input in a popover).
- **Unscheduled items:** monday has no first-class unscheduled tray (it isn't documented). **KitStak should add an "Unscheduled (n)" side tray you can drag from.**
- Keyboard: KitStak should support `T` for today, `←/→` for prev/next, `M/W/D` for mode, and `N` for new.

### 4.4 States
- Empty range: the grid renders normally, with a subtle "Nothing scheduled this month" in the header.
- Loading: the grid renders and event chips show shimmer.
- An item with no date in the chosen column doesn't appear. There's no indication of that in monday, which is a weakness.

---

## 5. Timeline view (lightweight) and Gantt view (project-grade)

### 5.1 Timeline view
- Purpose: a big-picture snapshot of items placed on a time axis from a Timeline or Date column. It doesn't handle dependencies.
- Left: a group-by lane header (Group / status / person). Right: a time grid with zoom options Days / Weeks / Months / Quarters / Years.
- Bars: 28–32px tall, radius 4 (pill-like), color-by fill, and the item name inside (or to the right if the bar is too short). Avatars of the person column can sit at the bar end.
- Drag a bar to move it. Drag either edge to resize. Clicking empty space in a row creates an item with that range.

### 5.2 Gantt view (schema GANTT)
- Split pane:
  - Left grid: item name, plus optional columns, each group collapsible (`Ctrl+G` expands or collapses all groups). The splitter is draggable.
  - Right: the time chart.
- Header controls:
  - **Auto Fit** (zoom to the whole project)
  - Zoom `+` / `−` (Days → Weeks → Months → Quarters → Years)
  - Today
  - Baseline
  - Settings
  - Export
- Settings drawer (from the schema and Help Center):
  - **Choose timeline columns** (`columnIdsByBoardId`, including subitem timelines)
  - **Group by**: `none | board | group | color (status) | parent` (`groupByIdPerBoardId`)
  - **Color by**: `none | board | group | color | parent`. Default is group. Colors are reused from the table.
  - **Label by**: `name | none`
  - Visual settings:
    - Show Dependencies (arrows)
    - Show Group Summary (summary bar per group spanning min start → max end)
    - Show Color Legend (bottom)
    - `show_today_line` (default true)
    - `show_weekends` (default true)
  - Fiscal year start month (quarters are calculated from it)
  - `is_docked` (sticky header)
- Bars: item bars use the color-by color. **Milestones** render as diamonds (zero-length timeline). **Group summary** bars are thin dark bars with end caps.
- **Dependencies**: arrows go from the predecessor's end to the dependent's start, about 1.5px `#676879`, with an arrowhead. Hovering an arrow highlights it in primary. Hovering a bar shows connector dots at its ends; drag from a dot to another bar to create a dependency, which writes the Dependency column.
  - Dragging a delayed bar shifts its dependents by the same delta, depending on the dependency mode (strict, flexible, or none) set in the column settings.
- **Baseline**: a "Save baseline" snapshot shows as a gray shadow bar above each item. While a baseline is shown, Color by is disabled. Bars turn green when on/ahead of baseline and red when delayed, and the red also flows to dependents.
- Critical path: shown in the newer Gantt as a toggle that highlights the chain in red *(verify; not in docs)*.
- Today line: 1–2px primary or red vertical line with a "Today" flag in the header.

### 5.3 States and keyboard
- No timeline column: an empty state says "To use this view add a Timeline or Date column", with a primary "Add column" button.
- Item without dates: listed in the left grid with an empty chart row. Hovering the row shows a ghost "+ Set dates" bar you can drag-create.
- Keyboard: monday offers almost nothing beyond `Ctrl+G`. KitStak should add arrow-key nudging of a selected bar (±1 unit), `Shift+arrow` to resize, and `Z` to auto fit.

### 5.4 Premium cues
Smooth zoom, anchored to the cursor, with 250ms easing. Snapping guides while dragging (a vertical dashed line plus a date tooltip "Nov 12 → Nov 19 (8d)"). A dependency cascade preview that ghosts dependent bars before you drop.

---

## 6. Chart view (board) and Chart widget (dashboard)

### 6.1 Chart types (exact enum)
- `pie`, `donut`
- `column`, `bar`
- `line`, `smooth_line`, `area`
- `bubbles`
- Stacked: `stacked_column`, `stacked_bar`, `stacked_area`, `stacked_line`
- 100% stacked: `stacked_column_percent`, `stacked_bar_percent`, `stacked_area_percent`, `stacked_line_percent`

The UI exposes these as a **chart gallery**: a grid of about 48×48 thumbnail tiles at the top of settings. The selected tile gets a 2px primary border and a primary-selected background.

### 6.2 Settings drawer: Data tab
- **X-axis** (`x_axis_columns` + `x_axis_group_by`): `color` (status/priority labels), `multiple-person`, `group`, `board`, `name` (item level), or `date`.
  - For date, **Choose groups** (`group_by`) offers day / week / month / quarter / year.
- **Y-axis** (`y_axis_columns` + `y_axis_group_by`): "Count items" (`default-label-count`) or a numeric/formula column. Aggregation (`calc_function_type`) is `sum | average | min | max | count`.
  - Multi-board Y-axis compares number columns across boards (new dashboard engine only).
- **Stack by / Z-axis** (`z_axis_columns`): required for stacked types. For example, X = Owner and stack = Stage.
- **Sort** (`sort_by`): X ascending/descending or Y ascending/descending. Default is the label order from the column.
- Include subitems (toggle). Include archived *(verify)*.

### 6.3 Settings drawer: Customization tab
- **Edit color, name, and order**: a list of labels, each with a drag handle, a color swatch (opens the label color picker; custom hex is Enterprise only) and a rename field. Drag to reorder slices and bars.
- Show values / data labels, show legend (position), show percentages (pie/donut), and a cumulative toggle for line/area *(verify; not in docs)*.
- Chart title (inline editable in the header).

### 6.4 Chart chrome and interactions
- Header: title (18px semibold), Filter (quick/advanced; per-widget filters are separate from dashboard-level filters), Settings and `...`.
- `...` menu:
  - Export (PDF / PNG / JPEG / SVG / CSV)
  - Print
  - Full screen
  - Duplicate
  - Share
  - Delete
- Hover a bar or slice to get a tooltip: a white card with shadow-medium, radius 8, 8×12 padding, showing the label swatch, label, value and percent of total.
- Click a bar or slice to open a **drill-down modal**: the list of matching items as a mini table, with each row clickable into the item. This is a strong feature; keep it.
- Donut center shows the total (Poppins 24–32px) with a "Total" caption.
- Animations: bars grow from the baseline over 400ms with an enter curve, and pie slices sweep in. Charts re-animate only on data change, not on resize.
- Empty state: "No data to display" with a muted chart outline and a "Check your settings" link. Misconfiguration (stacked type without a z-axis) shows an inline error in the drawer: "Choose a column to stack by".

---

## 7. Form view (WorkForms)

### 7.1 Builder layout (full-page editor, three panes)
- **Left pane (about 280px):**
  - Tabs: Questions (outline) and Content blocks.
  - The outline lists every question with its type icon. Drag to reorder.
  - A "Page" container groups questions. Questions dragged *outside* the page render one-by-one (a typeform-like step flow). Deleting the page (trash at its bottom-right) makes all questions one-by-one. Mixed layouts are allowed.
  - Hidden questions show an eye-slash icon.
- **Center canvas:** a live WYSIWYG of the form.
  - Header area: logo, cover image, title (32px) and description (rich text).
  - Each question block: label, description, input preview and required asterisk.
  - Clicking a block selects it: 2px primary outline plus a cog at the bottom-left.
- **Right pane (about 320px):** settings for the selected question, which open from the cog:
  - Question title and description
  - Required toggle
  - Hide question toggle
  - Default value (e.g. default date, include time/timestamp)
  - Placeholder
  - Validation (min/max, email/URL format)
  - Prefill from URL parameter
  - **Conditional logic**: "Show this question only if [question] [is / is not / contains] [value]", with AND/OR
- Top bar:
  - Back
  - Form name
  - Tabs: **Build | Design | Settings**
  - "Preview" (eye; opens a desktop/mobile toggle)
  - **Share form** (primary): copy link, embed code, QR code
  - Responses link (back to the board)

### 7.2 Question types
Each question maps one-to-one to a board column, and a new question creates a column.
- Short text, Long text
- Number
- Email, Phone (with country code), Link
- Date (with optional time), Timeline / date range
- Status (single select: radio or dropdown), Dropdown (multi-select), Checkbox
- Rating (stars)
- People (internal only)
- Location / Country
- File upload
- Connect boards (choose from a related board)
- Signature *(verify)*
- Name (item name; always present)

Content blocks: Text (rich), Heading, Divider, Image *(verify)*.

### 7.3 Design tab
- Theme presets plus custom: background color or image, accent color (buttons, focus), font, text alignment (left/center) and layout (classic vs one-by-one). Logo upload and alignment. Hide branding (paid). Button text.

### 7.4 Settings tab
- After submit:
  - Thank-you title and message
  - Optional "Submit another response" button
  - Redirect to URL
- Access:
  - Require login (monday users only)
  - Restrict to account domain
  - Password protect *(verify; enterprise)*
  - Close form on a date or after N responses
  - CAPTCHA / reCAPTCHA
- Responses: Send notification on submit, send a copy of answers to the respondent, and edit-after-submit (allow respondents to edit).
- Which group new items land in (default: top group).
- Language and RTL.

### 7.5 Submitter-side states
- Input focus: primary border with the focus ring.
- Error: red border `#D83A52`, an inline message under the field, and a scroll to the first error on submit.
- Submit button loading: spinner replaces the label, button disabled.
- Success: checkmark animation with emphasize easing, then the thank-you text.
- One-by-one mode: progress bar at the top, `Enter` advances, `Shift+Enter` makes a new line in long text, back arrow.
- Closed form: "This form is no longer accepting responses".

### 7.6 Premium cues
Live canvas editing (no modal per question), mobile preview, and conditional logic that is visible in the outline (a branch icon on dependent questions).

---

## 8. Files view (File Gallery)
- Aggregates every file from Files columns **and** from item Updates on the board.
- Toolbar: search, filter (by file type, uploader, item, column), sort (newest, name, size) and a **Grid / List** toggle. "+ Add files" uploads into a selected item and column.
- Grid tile (about 200×180): thumbnail (images render a preview; documents show a type icon on a colored tile, e.g. PDF red, XLS green, DOC blue), file name (14px, 1 line), item name (12px `#676879`, links to the item) and uploader avatar plus date. Hover shows a checkbox (multi-select), a download icon and `...`. The `...` menu:
  - Preview
  - Download
  - Open in item (jumps to the update)
  - Rename
  - Copy link
  - Delete
- List mode: columns for Name, Item, Column / Update, Uploaded by, Date and Size.
- Preview: a full-screen lightbox with arrow-key navigation, zoom, download, and a comments/annotations panel (monday supports file annotations).
- Mobile behavior differs: views added on web are view-only on mobile, which is inconsistent. **KitStak should make files editable everywhere.**
- Empty: "No files yet. Drag files here or upload to an item". The whole view is a dropzone and shows a dashed primary overlay when dragging.

## 9. Map view
- Requires a Location or Country column. Pins are placed per item.
- Pin: a teardrop marker colored by the color-by setting (status/group). Pins cluster into numbered circles when zoomed out.
- Click a pin to open a popover card: item name, address, chosen columns, and an "Open item" link.
- Left list panel *(verify)*: items sorted by distance and visible extent. Selecting a list row pans to its pin.
- Settings: location columns, color by, map style (default/satellite) and fit-to-pins.
- Empty state when no location values exist: "Add a Location column to see your items on the map".
- CRM relevance: territory views for Accounts (HQ) and Deals (Location). **KitStak should add territory drawing (lasso to filter) and route ordering, which monday lacks.**

## 10. Cards and Gallery views
- Cards: a responsive grid of item cards (about 260px min width), the same anatomy as a Kanban card without lanes. "Card columns" picker, and an optional cover image.
- Gallery: image-first cards (cover 4:3), useful for Accounts with logos. Note: logos are user-supplied data, not monday assets.

## 11. Workload view and widget (summary)
- Rows per person (People column) or per team. The time axis is days/weeks. Each cell is a circle sized and colored by load: green under capacity, red over. The number in the circle is the item count or effort-column sum.
- Settings: People column, Timeline/Date column, effort column (optional), capacity per person (default 5 items/day or N hours), and hide weekends.
- Drag an item from an overloaded person onto another to reassign it (writes the People column).

---

## 12. Dashboards

### 12.1 Page anatomy
- Header:
  - Dashboard name (32px, inline rename)
  - Description (optional)
  - Favorite star
  - On the right: avatar stack, Share/Invite, Activity, and the `...` menu
- Toolbar (under the header):
  - **"+ Add widget"** (primary split button; the caret opens a quick list)
  - **Boards / "N connected boards"** chip (opens board connections)
  - Search
  - Person filter
  - **Filter** (dashboard-level)
  - **Edit / View toggle**, centered above the widgets. Only dashboard owners can move, resize or edit widgets. Viewers and subscribers see View only.
  - Presentation mode and full screen
  - `...` menu:
    - Duplicate
    - Export (PDF / image)
    - Present mode
    - Upgrade / downgrade dashboard engine (legacy)
    - Settings
    - Delete
- Canvas: `#F6F7FB` background with 24px outer padding and a 16px gutter.
- Board-embedded dashboard view: the same grid inside a board view tab (the sandbox's "Pipeline Chart" and "Deal Timeline").

### 12.2 Layout grid
- A 12-column responsive grid (react-grid-layout style) with a row height of about 40px *(verify)*. Widgets snap to grid units.
- Edit mode:
  - Each widget shows a drag handle on its header (move cursor).
  - A resize handle sits at the bottom-right corner (an 8px diagonal grip) and on the edges.
  - Moving reflows the other widgets vertically (compacting).
  - A drop placeholder shows the target with a translucent primary `rgba(0,115,234,.1)` fill and a dashed primary border.
- Default widget sizes:
  - Numbers: 3–4 columns × 4 rows
  - Chart: 6 × 8
  - Battery: 6 × 4
  - Calendar, Table, Gantt: 12 × 10
- "Dock this widget" makes a widget fill the dashboard (full-screen, sticky header).
- Mobile: a single-column stack in grid order.

### 12.3 Widget chrome (shared)
- Container: white, radius 8, border 1px layout-border or shadow-xs, 16px padding. In Edit mode, hover adds shadow-small.
- Header (about 48px): title (16–18px semibold, double-click to rename) and an optional subtitle/description (12px secondary). On the right, icon buttons appear on hover:
  - Filter (shows a dot when a widget filter is active)
  - Settings (cog)
  - Full screen
  - `...`
- Widget `...` menu (verbatim-ish):
  - Settings
  - Rename widget
  - Duplicate widget
  - Filter widget
  - Full screen
  - Dock this widget / Undock
  - Export (PDF / PNG / JPEG / SVG / CSV; Chart and Table only)
  - Print
  - Move to another dashboard *(verify)*
  - Delete widget (red; asks for confirmation)
- States:

| State | Spec |
|---|---|
| Loading | Skeleton specific to the widget type (bars for Chart, a big gray block for Numbers) |
| Empty / unconfigured | Centered prompt "Connect boards to see data" with a "Select boards" button, or "Choose columns" with an "Open settings" button |
| No data after filter | "No items match the current filters" |
| Error | Warning icon, "Couldn't load widget", Retry |
| Stale (realtime pending) | Subtle spinner in the header |

### 12.4 Board connections
- The "Boards" chip opens a modal or popover. It has a searchable list of boards across workspaces with checkboxes, and connected boards are listed at the top with a remove `×`. The plan limits the board count (Basic 1, Standard 5, Pro 10, Enterprise 50); show an upgrade badge at the limit.
- Option: "Automatically include data from newly connected boards in existing widgets" (default checked).
- Each widget then has its own **per-widget board subset** in its settings. Boards appear as a checkbox list with the board icon.

### 12.5 Add widget flow
1. "+ Add widget" opens a popover with the top widgets as rows (icon, name, 1-line description): **Chart, Numbers, Battery, Table, Calendar, Text, Countdown, Gantt, Timeline, Workload, Files Gallery, Llama Farm**, plus **"More widgets..."**.
2. "More widgets..." opens the **Widgets Center** modal (about 960×640, radius 16).
   - Left rail with categories: Popular, Charts & reports, Time management, Team & resources, Content, Fun, and Apps (marketplace).
   - Search at the top.
   - Main grid of tiles (preview image, name, description). Hover gives a lift and an "Add widget" button.
   - Selecting a tile can show a detail pane with a larger preview, a description and "Add widget".
3. The added widget drops at the **top-left** (or the first free slot) and **opens its settings automatically** when it needs configuration. The new widget scrolls into view with a short highlight pulse (primary outline that fades over 1s).

Full widget catalog to support (monday parity):
- Data: Chart, Numbers, Battery, Table (ListView), Pivot / Sum table, Calendar, Gantt, Timeline, Workload, Files Gallery, Map, Kanban (widget), Leaderboard, Goals / OKR
- Content: Text (rich text and links), Image / Video / Embed (iframe URL), Countdown, Quote of the day, Clock
- Fun: Llama Farm (a gamified progress visualization; KitStak must use its own concept and art), Weather *(apps)*
- AI: AI summary / insights widget (newer monday). KitStak should ship this natively: "Explain this chart".

### 12.6 Widget settings side panel
- Opens from the right (about 360–400px), pushes or overlays the canvas, slides in over 250ms, and does **not** block the widget. The widget preview updates live as settings change.
- Header: widget type name, a close `×`, and a back arrow inside nested sections.
- Common sections:
  - **Boards** (choose from connected boards; per-board group selection via `groups_data`)
  - **Columns** per board
  - Type-specific options
  - **Customization**
- Footer: none, because changes autosave. KitStak should add "Reset to defaults".

### 12.7 Widget-specific specs
**Numbers** (schema NUMBER):
- `calculation_type`: `columns` (number column(s)) or `count` (count items).
- `counter_type`: `sum | average | median | min | max`.
- `counter_unit`: symbol (e.g. `$`), direction left/right, or a custom unit ("USD").
- `should_count_items` / `should_count_subitems`.
- `prefix` / `suffix` text.
- `number_format`: `number | percentage | currency`.

Display: one huge centered value (Poppins, auto-scaled 32–64px to fit), unit and prefix/suffix in secondary 16px, and an optional title. Large numbers abbreviate ("1.2M"). Hover shows the exact value plus the aggregation ("Sum of Deal Value across 2 boards"). Tapping or clicking shows a breakdown per board.
Sandbox example: "Total Pipeline Value" = sum of `deal_value`.
**KitStak improvements:** a trend delta vs the previous period (▲ 12% in green/red), a sparkline, and a goal/target bar.

**Chart**: see Section 6.

**Battery** (schema BATTERY):
- `battery_data.status_column_ids_per_board` (multiple status columns allowed)
- optional `numeric_column_ids_per_board` (weighted progress, e.g. effort)
- `done_text` (label(s) counted as complete; default "Done")
- `groups_data` (limit to groups)

Display: a horizontal segmented bar (about 24–32px tall, radius 4) split proportionally by every label color. The big "% done" sits on the left or top (e.g. "64% done"). Legend circles sit below, one per label. Hover a segment or circle to get the label name, count and percent.

**Table** (schema LISTVIEW):
- `additional_columns`, `order_columns`, `show_hide_columns`, `wrapped_column_ids`
- `item_height`: `single | double | triple`
- `subitems_display_mode`: `subitems_mode_like_items | subitems_mode_nested | subitems_mode_with_parents`

It's a cross-board table. Rows show a board/group indicator, and cells are editable in place.

**Calendar**: see Section 4.2 (widget-only keys: `label_by_*`, `groups_data`, `exclude_board_ids`, `is_docked`).

**Gantt / Timeline**: see Section 5.2 (`columnIdsByBoardId`, `groupByIdPerBoardId`, `colorByIdPerBoardId`, `label_by_id_per_board`, `show_today_line`, `show_weekends`, `is_docked`).

**Countdown**:
- Settings: date (picker, default today), time, units (checkboxes: years / months / weeks / days / hours / minutes / seconds) and display mode **Countdown | Table | Split mode** (countdown plus the related items table).
- Visual: large digit blocks with labels underneath. Seconds tick with a subtle flip or opacity transition.

**Text**: a rich-text block (headings, bold, lists, links, emoji) edited inline in Edit mode. It's used for dashboard section titles. KitStak should add a "section header" widget that spans 12 columns with no card chrome.

**Workload**: see Section 11.

**Llama Farm** (monday-proprietary art): items are shown as animals that move across fields as their status changes. **KitStak must invent its own playful progress metaphor or skip it.**

### 12.8 Dashboard-level filters
- The Filter icon opens a panel. First pick a connected board (or all), then use:
  - **Quick filters**: chips by board, group and every column value, with counts.
  - **Advanced filters**: a rule builder across multiple columns (same component as boards).
- Dashboard filters apply to **all** widgets. Per-widget filters are additive.
- The person filter in the toolbar is a shortcut for "Person is X".
- Filter state is per user and session unless saved. **KitStak should provide named saved filter sets shareable by URL**, e.g. `?filter=…`.

### 12.9 Present and share
- Presentation mode: a full-screen, chrome-less grid that can auto-rotate dashboards on a timer (TV mode).
- Share: invite users as Owner / Subscriber / Viewer, or create a public link (if the account allows). Export the whole dashboard to PDF.

---

## 13. Cross-cutting interaction details
- **Realtime:** all views update live, with subtle cell flashes for other users' edits. KitStak should show a presence avatar on the item being edited by others.
- **Undo:** a toast with "Undo" appears for moves and deletes (bottom-left, about 6s, dark `#323338` toast with white text and a primary "Undo" link).
- **Item panel** opens from every view, so it's consistent everywhere. It's a right slide-over with tabs: Updates / Files / Activity Log / Item card.
- **Loading philosophy:** skeletons, never full-page spinners. The view switch keeps the toolbar mounted and swaps only the canvas (with about a 100ms crossfade).
- **Persistence:** each view saves its settings and filters. A "Save to this view" pattern shows when a temporary filter differs from the saved one.

## 14. Weaknesses and annoyances KitStak can beat
1. **API and UI parity:** monday's API can't create Kanban, Chart or Calendar views. KitStak should make every view a typed, versioned API object.
2. **Kanban keyboard accessibility** is almost non-existent. KitStak should add full keyboard drag, aria-live announcements and visible focus rings on cards.
3. **Kanban card field order** is locked to the table column order. KitStak should allow per-view field order and per-field display style (pill vs text vs icon-only).
4. **No WIP limits or lane totals** in Kanban. Sales teams want the sum of Deal Value per stage lane and a weighted value (value × probability) in the lane header. KitStak should make this default for CRM boards.
5. **Calendar** has no unscheduled-items tray and no indication of items hidden for lacking a date. KitStak should provide both, plus drag-to-schedule.
6. **Timeline and Gantt are split** into two views with overlapping purposes, and fiscal-year and baseline features are buried. KitStak should offer one Timeline with a "Project mode" toggle (dependencies, baseline, critical path).
7. **Chart customization lives in a separate tab.** Data labels, cumulative and goal lines are hard to find, and custom colors are Enterprise only. KitStak should put all options in one panel with live preview, and offer free custom colors.
8. **Dashboard board limits by plan**, plus a confusing old vs new dashboard engine split. KitStak should have a single engine.
9. **Edit/View mode toggle friction:** you must switch modes to move widgets. KitStak should use an always-available drag handle for owners, with an optional "lock layout" switch.
10. **Numbers widget** has no trend, target or comparison period. KitStak should add delta vs previous period, a goal and a sparkline.
11. **Filters aren't shareable by URL**, and dashboard filters reset per session. KitStak should save named filter sets in URL state.
12. **Forms:** the access and after-submit options are scattered, and branding removal is paywalled. KitStak should put all settings on one Settings page, with CRM-native lead routing (round-robin owner assignment and dedupe against Contacts on submit).
13. **Files view** is view-only on mobile when it was added on web. KitStak should keep parity across platforms.
14. **Map** has no territories, radius search or routing. KitStak should add lasso territory filters and a "near me" search.
15. **Performance:** monday's large boards (5k+ items) make Kanban, Calendar and Chart sluggish. KitStak should virtualize lanes and cards, aggregate on the server for charts, and target under 100ms for interactions.
16. **Cramped density options:** KitStak should offer comfortable/compact density in every view and widget.

## 15. Acceptance checklist for KitStak (harsh-critic test)
- [ ] Every view creatable, configurable and deletable via UI **and** API, and persisted per view.
- [ ] Kanban: drag between lanes rewrites the field, with optimistic update, rollback and a toast. Lane sum and weighted sum, collapse, add-in-lane, inline edit, full keyboard support.
- [ ] Calendar: Month/Week/Day, drag-reschedule, resize, quick-create, unscheduled tray, color-by, hide weekends.
- [ ] Timeline/Gantt: zoom levels, auto-fit, today line, drag/resize with snapping tooltip, dependencies with cascade preview, baseline, milestones.
- [ ] Chart: all 16+ types, X/Y/stack, aggregation, date bucketing, sort, color/name/order editor, drill-down, export to PNG/SVG/CSV/PDF.
- [ ] Form: three-pane builder, every column-backed question type, conditional logic, pages vs one-by-one, design theme, after-submit and access settings, mobile preview.
- [ ] Files: grid/list, lightbox, dropzone, filters. Map: pins, clusters, popover, territory lasso.
- [ ] Dashboard: 12-column drag/resize grid, Widgets Center, auto-open settings panel with live preview, per-widget and dashboard filters, board connections, present mode, export.
- [ ] Every component has the loading, empty, error and filtered-empty states defined above, in light and dark themes, and meets WCAG AA contrast.
