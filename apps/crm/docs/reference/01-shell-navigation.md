# 01 — Global Shell & Navigation (monday.com reference → KitStak CRM spec)

Status: v0.1 reference spec. Audience: KitStak front-end engineers and designers.
Scope: top bar, left sidebar, workspace switcher, tree, add menu, search / command palette,
notifications, inbox, help, apps, profile menu, workspace home tabs, design tokens.

---

## 0. Provenance and confidence (read first)

| Source | What it gave us | Confidence |
|---|---|---|
| Vibe design-system tokens, published as the open-source npm package `monday-ui-style` (`dist/index.min.css`, downloaded 2026-11-05). Current package name is `@vibe/style` 4.x. | Every hex color, font stack, type ramp, spacing scale, radii, shadows and motion curves in section 1 | **High.** These are monday's real production tokens. |
| Prior hands-on knowledge of the monday.com web app (2024–2026 "surface" shell layout) | Shell anatomy, menu contents, interaction behavior | **Medium.** Microcopy is paraphrased. Exact pixel sizes are marked `~` where they are not tokens. |
| Live DOM measurement in the user's sandbox (workspace 18353908) | **Not obtained.** | — |

**Blocker:** The research browser tab could not authenticate. Every new tab in the built-in
browser pane redirected to `auth.monday.com/auth/login_monday` in a loop. Clicking
"Sign in to team-01606242" re-loaded the same page, and the Chrome extension asked for a password.
Typing passwords is not allowed for this agent, and only the orchestrator's "seed" tab was signed in.
The task rules say not to drive that tab, so no `getComputedStyle` pass was run.
Every `~` value below should be confirmed in one 10-minute pass from an authenticated tab
(the script is in Appendix A). Token values do not need re-checking.

KitStak should **adopt the structure and ergonomics, not the brand**. Use our own logo,
illustrations, primary hue (or a deliberately close but distinct blue) and type pairing.
The values below are reference points to calibrate against, not to clone.

---

## 1. Design tokens (monday "Vibe", light theme default)

### 1.1 Color — core UI (light / dark)

| Token | Light | Dark | Use in shell |
|---|---|---|---|
| `--primary-color` | `#0073ea` | `#0073ea` | Primary buttons, the "+" add button, focus rings, selected-tree accent |
| `--primary-hover-color` | `#0060b9` | `#0060b9` | Primary hover |
| `--primary-selected-color` | `#cce5ff` | `#133774` | **Selected sidebar row background** |
| `--primary-selected-hover-color` | `#aed4fc` | `#0d2e65` | Selected row hover |
| `--primary-highlighted-color` | `#f0f7ff` | `#0d2753` | Search-hit highlight, drop targets |
| `--primary-surface-color` | `#eceff8` | `#181b34` | **Shell canvas behind the top bar, sidebar and main card** |
| `--primary-text-color` | `#323338` | `#d5d8df` | Body text, tree labels |
| `--secondary-text-color` | `#676879` | `#9699a6` | Meta text, section headers, timestamps |
| `--icon-color` | `#676879` | `#c3c6d4` | All 20px shell icons |
| `--placeholder-color` | `#676879` | `#c3c6d4` | Search placeholder |
| `--primary-background-color` | `#ffffff` | `#181b34` | Main content card, popovers |
| `--secondary-background-color` | `#ffffff` | `#30324e` | Dialogs, menus (dark: raised) |
| `--allgrey-background-color` / `--grey-background-color` | `#f6f7fb` | `#30324e` / `#181b34` | Empty-state panels, inbox list background |
| `--primary-background-hover-color` | `rgba(103,104,121,0.1)` | `rgba(103,104,121,0.3)` | **Universal hover wash** for icon buttons, menu items and tree rows |
| `--ui-background-color` | `#e7e9ef` | `#434660` | Chips, segmented controls |
| `--ui-background-hover-color` | `#d8d9e0` | `#35384d` | |
| `--ui-border-color` | `#c3c6d4` | `#797e93` | Input borders |
| `--layout-border-color` | `#d0d4e4` | `#4b4e69` | Dividers, sidebar/card separators, menu dividers |
| `--disabled-background-color` | `#ecedf5` | `#3c3f59` | |
| `--disabled-text-color` | `rgba(50,51,56,.38)` | `rgba(213,216,223,.38)` | Opacity token `--disabled-component-opacity: 0.38` |
| `--link-color` | `#1f76c2` | `#69a7ef` | |
| `--inverted-color-background` | `#323338` | `#ffffff` | **Tooltips** (dark chip, white text) |
| `--backdrop-color` | `rgba(41,47,76,0.7)` | same | Modal scrim |
| `--positive-color` | `#00854d` (hover `#007038`, selected `#bbdbc9`) | | Success toasts |
| `--negative-color` | `#d83a52` (hover `#b63546`, selected `#f4c3cb`) | | Error states, notification badge |
| `--warning-color` | `#ffcb00` (hover `#eaaa15`, selected `#fceba1`) | | Trial / plan banners |
| `--color-surface` | `#292f4c` | `#292f4c` | Fixed dark surface (e.g. sidebar in "night" variants) |

Other themes ship as `.dark-app-theme`, `.black-app-theme` and `.hacker_theme-app-theme`.
The theme is a class on a root element, and every component reads CSS variables.
**KitStak should do the same: a token layer plus a theme class. No per-component hex values.**

### 1.2 Color — semantic palette (used for workspace avatars, item icons, status pills)
`done-green #00c875`, `grass_green #037f4c`, `bright-green #9cd326`, `saladish #cab641`,
`egg_yolk #ffcb00`, `working_orange #fdab3d`, `dark-orange #ff6d3b`, `sunset #ff7575`,
`bazooka #f65f7c`, `sofia_pink #e50073`, `lipstick #ff5ac4`, `purple #9d50dd`,
`berry #7e3b8a`, `dark_indigo #401694`, `indigo #5559df`, `royal #216edf`, `river #74afcc`,
`aquamarine #4eccc6`, `teal #175a63`, `explosive #c4c4c4`, `american_gray #757575`,
`blackish #333333`.
Each color has `-hover` and `-selected` variants (for example `working_orange-hover #c0873c`,
`-selected #fed59e`).
Workspace avatar tiles in the sidebar pick from this palette.

### 1.3 Typography

| Token | Value |
|---|---|
| `--font-family` | `Figtree, Roboto, "Noto Sans Hebrew", "Noto Kufi Arabic", "Noto Sans JP", sans-serif` |
| `--title-font-family` | `Poppins, Roboto, …` (headings, workspace title, board title) |
| Smoothing | `-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale` |
| Weights | very-light 200, light 300, normal 400, "bold" token = **500**; text styles also use 600/700 |
| `--font-h1-*` | 32px / 40px Poppins, letter-spacing −0.5px (700 / 600 / 500 / 300 variants) |
| `--font-h2-*` | 24px / 30px Poppins, −0.1px |
| `--font-h3-*` | 18px / 24px Poppins, −0.1px |
| `--font-text1-*` | 16px / 22px Figtree (700 / 600 / 400) |
| `--font-text2-*` | **14px / 20px Figtree**: default for tree rows, menus and inputs |
| `--font-text3-*` | 12px / 16px Figtree: badges, section captions, timestamps |
| Legacy ramp | 14 / 14 / 16 / 18 / 24 / 30px with line-heights 18 / 24 / 24 / 24 / 32 / 42 |

Shell mapping (`~` means confirm in the live app):
- Sidebar row label: text2-normal 14/20 `#323338`; selected row is the same weight on the selected background.
- Sidebar section header ("Favorites", "Workspaces"): text2 14px, `#676879`. (monday does not uppercase these.)
- Workspace switcher name: text2-medium 14/20, 600.
- Workspace home title: h1/h2 Poppins, ~32px, 500.
- Top bar product name: logo wordmark plus a "work management" sub-label in ~14px Figtree, `#323338`.
- Tooltips: text3/text2 12–14px, white text on `#323338`.
- Badge count: 12px / 600, white on `#d83a52` (notifications) or `#0073ea`.

### 1.4 Spacing, radius, borders, motion, elevation

- Spacing: `xs 4`, `small 8`, `medium 16`, `large 24`, `xl 32`, `xxl 48`, `xxxl 64`
  (with fine steps 2/4/8/12/16/20/24/32/40/48/64/80).
- Radius: `small 4px` (inputs, menu items, tree rows), `medium 8px` (menus, popovers, cards),
  `big 16px` (main content card corner, dialogs, onboarding cards).
- Border: 1px solid. Default divider `#d0d4e4`.
- Shadows:
  - `xs 0 4px 6px -4px rgba(0,0,0,.1)` for sticky headers
  - `small 0 4px 8px rgba(0,0,0,.2)` for tooltips and small popovers
  - `medium 0 6px 20px rgba(0,0,0,.2)` for **menus, dropdowns, workspace switcher and command palette**
  - `large 0 15px 50px rgba(0,0,0,.3)` for modals
  - In dark theme, all shadows use `rgba(9,11,25,.5)`.
- Motion durations: productive `70 / 100 / 150ms`, expressive `250 / 400ms`.
- Easing:
  - enter `cubic-bezier(0,0,.35,1)`
  - exit `cubic-bezier(.4,0,1,1)`
  - transition `cubic-bezier(.4,0,.2,1)`
  - emphasize (overshoot) `cubic-bezier(0,0,.2,1.4)`
  - expand animations use the enter curve.

Mapping:
- Hover color: 70–100ms.
- Menu open: 150ms fade plus 4–8px slide on the enter curve.
- Panel slide-in (notifications, inbox): 250ms.
- Sidebar collapse: ~250ms width transition.
- Dialog: 250ms scale 0.96→1 plus fade.
- Emphasize curve: use it only for success moments, such as creating a board.

---

## 2. Shell layout (the "surface" frame)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TOP BAR  (~48px, bg = --primary-surface-color #eceff8, no bottom border)     │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ LEFT SIDEBAR  │ ┌──────────────────────────────────────────────────────────┐ │
│ (~255px def., │ │ MAIN CONTENT CARD  bg #fff, radius 16px on top-left      │ │
│  bg = surface │ │ (and top-right), 1px #d0d4e4 or no border, fills rest;   │ │
│  #eceff8 or   │ │ board / dashboard / workspace home renders here          │ │
│  #fff variant)│ │                                                          │ │
│               │ └──────────────────────────────────────────────────────────┘ │
└───────────────┴──────────────────────────────────────────────────────────────┘
```

- The canvas is the light lavender-grey `#eceff8`. The working area is a **white rounded card that
  floats on it**, with ~8px gutters to the right and bottom and its top-left corner tucked under
  the top bar. This "app inside a frame" layering does most of the work of making monday look
  premium and calm. KitStak should copy the layering idea and pick its own surface tint.
- The top bar and sidebar share the canvas color, so they read as one L-shaped frame.
- Minimum supported viewport is ~1024px. Below ~1200px the sidebar auto-collapses.
  There is a separate mobile app; the web app is not responsive below ~768px.

---

## 3. Top bar

### 3.1 Anatomy (left → right), height ~48px, horizontal padding ~12–16px

1. **App switcher ("waffle" grid icon)**, 32×32 hit area, 20px icon.
   - Opens the product switcher: Work management, CRM, Dev, Service, plus "Explore more products".
   - For KitStak this becomes a module switcher (CRM, Ops, Inventory if KitStak spans products) or is removed.
2. **Logo plus product label**: brand mark and wordmark, with a "work management" sub-label to the right in ~14px `#323338`.
   - Clicking it goes Home. Do not copy the logo.
3. **Plan CTA**, e.g. "See plans" with a small icon.
   - Outlined/tertiary button, 32px tall, radius 4px, 14px text.
   - Shown on trials. Upsell surfaces sit in the chrome all the time (see weaknesses).
4. *(flex spacer)*
5. **Right cluster**: 32×32 icon buttons with ~4–8px gaps. Each has a tooltip on hover after ~300ms delay.
   - **Notifications** (bell). Red count badge, top-right, 16px tall pill, 12px/600 white on `#d83a52`.
   - **Update feed / Inbox** (tray icon). Count badge.
   - **Invite members** (person-plus icon).
   - **Apps / Marketplace** (grid-plus / puzzle icon).
   - **Search everything** (magnifier).
   - **Help** (question-mark circle).
   - *(1px vertical divider, ~24px tall, `#d0d4e4`)*
   - **AI / assistant entry** ("sidekick"-style sparkle button). In 2025–26 builds this opens a right-side AI chat panel.
   - **Account cluster**: account/company logo tile plus the user avatar (32px circle), shown as one pill. Opens the profile menu.

### 3.2 Icon-button states (applies to every top-bar and sidebar icon button)

| State | Visual |
|---|---|
| default | transparent bg, icon `#676879`, radius 4px |
| hover | bg `rgba(103,104,121,.1)`, icon `#323338`. Tooltip appears after ~300–500ms: dark `#323338` chip, 12–14px white text, radius 4px, 6–8px padding, arrow, placed below. |
| active / pressed | bg `rgba(103,104,121,.1)`; no scale animation |
| selected (panel open) | bg `#cce5ff`, icon `#0073ea` |
| focus-visible | 2–3px focus ring `rgba(0,115,234,.5)` or a solid `#0073ea` outline, offset 0–2px |
| disabled | 0.38 opacity |
| with badge | badge overlaps the top-right corner by ~4px, with a 2px ring in the bar color so it "cuts out" |

### 3.3 Search everything / command palette
- Opens from the magnifier, **Cmd/Ctrl+K** (newer builds; older builds used Cmd+B for "search everything"), or the "Search" entry in the sidebar.
- **Modal**:
  - Centered at ~15vh from top, ~720–800px wide, radius 8–16px, shadow-large, light backdrop.
  - Input row, 48–56px tall, magnifier at left, 16–18px text.
  - Placeholder paraphrase: "Search everything…".
- **Filter chips under the input**: All, Boards, Docs, Items, People, Files, Updates, Dashboards.
  - Further filters for workspace, date and "only items I'm subscribed to".
- **Empty query state**: "Recently visited" list of boards, docs and dashboards, each with its type icon and breadcrumb (workspace › folder).
- **Results**:
  - Grouped by type with section headers.
  - The matching substring is bold or highlighted.
  - Rows are 40px tall with an icon, name, secondary breadcrumb and timestamp.
  - Keyboard: ↑/↓ moves, Enter opens, Cmd/Ctrl+Enter opens in a new tab, Esc closes.
- **Loading**: skeleton rows (shimmer `#f6f7fb`→`#e7e9ef`).
- **No results**: an illustration plus "No results found for '…'" and suggestions to change filters.
- **Weakness**: Global search and in-board search are separate experiences. The global palette shows little "actions" content (create, navigate settings) compared with Linear or Notion.
  - KitStak should merge navigation, record search and commands ("Create deal", "Go to Contacts", "Assign to me") into one palette with fuzzy match and recents.

### 3.4 Notifications panel
- Clicking the bell opens a **right-side panel**, not a dropdown.
  - ~520–600px wide, full height under the top bar, white, shadow-large.
  - Slides in over ~250ms. A close "×" sits at the top right.
- **Header**: title "Notifications" (Poppins ~24px) plus a "…" menu with mark all as read, notification settings and open in new tab.
- **Tabs**:
  - "All", "Unread", "I was mentioned", "Assigned to me".
  - A board/people filter dropdown; newer builds add a search box.
- **Row anatomy**:
  - 40px avatar (or a system icon for automations).
  - Rich text summary, e.g. "Michael changed Stage to Won in **Northwind**" (paraphrased).
  - Item and board breadcrumb, then relative time ("2h") at right.
  - An unread dot (`#0073ea`, 8px) at the left edge.
  - The unread row background is a faint blue `#f0f7ff`.
- **Hover** reveals quick actions: mark read/unread (check icon) and the row "…" menu (turn off notifications for this item, delete).
- **Click** opens the item card (side panel) in context and marks the row read.
- **Empty state**: illustration plus "You're all caught up" (paraphrased).
- Also present: a "Notification settings" link and a desktop-push opt-in banner.

### 3.5 Inbox / Update feed
- A full-page view, or a panel in newer builds.
- Shows **updates (comments) from items you follow**, as a feed of update cards.
- **Update card**:
  - Author avatar and name, timestamp, board › item breadcrumb.
  - Rich-text body.
  - Like / Reply actions.
  - Inline reply editor.
  - "Mark as read" check per card.
- **Filters**: "Open", "All updates", "Mentions", "I was mentioned". Updates can be filtered by board.
- **Empty state**: "Inbox zero" style illustration.
- **Weakness**: Notifications and Inbox overlap confusingly; users do not know which one to check.
  KitStak should have **one Activity center** with tabs.

### 3.6 Invite members
- Modal with an email chip input ("Enter emails…"), a role selector (Member / Viewer / Guest) and an "Invite" primary button.
- Also offers "Invite with link" with a copy-link button.
- *(Not exercised: inviting is forbidden in the sandbox.)*

### 3.7 Apps / Marketplace
- Opens the marketplace overlay: a full-screen modal with categories on the left, featured apps and search.
- KitStak can defer this. If built, show "Integrations" for connected sources.

### 3.8 Help menu (question-mark)
- Dropdown menu, ~240–280px wide, radius 8px, shadow-medium.
- Items (paraphrased):
  - Help center / Knowledge base
  - Getting started / Learn & get inspired
  - Join a webinar
  - Contact support
  - Keyboard shortcuts
  - Community
  - What's new
  - Give feedback

### 3.9 Profile / account menu (avatar)
- Wide two-column menu, ~480px, radius 8px, shadow-medium.
- **Left column, "Account" or company name header**:
  - Admin
  - Teams
  - Apps
  - Billing / Upgrade
  - Trash
  - Archive
  - Import data
  - Activity log
- **Right column, "Working status" and the user**:
  - My profile
  - Working status ("Online", "Do not disturb" with a duration submenu)
  - Notification settings
  - Personal preferences (theme light/dark/night, language, density)
  - Keyboard shortcuts
  - Mobile app
  - Change account
  - Log out
- The header shows the avatar and name, with the email below in `#676879` at 12–14px.
- Items: 32px rows, 20px leading icon, 14px text, hover bg `rgba(103,104,121,.1)`, radius 4px, with 8px inset from the menu edge.

---

## 4. Left sidebar

### 4.1 Anatomy, top → bottom
- Width ~255px default; resizable ~200–~580px; collapsed ~30px rail.
- Background: canvas `#eceff8` or white in older builds. Padding ~8px horizontal.

1. **Primary nav rows** (36px each, 20px icon, 14px label):
   - **Home** (house icon): the cross-workspace home with recently visited, inbox preview and "my work" teaser.
   - **My work** (calendar/check icon): aggregated items assigned to me, grouped by date (Past dates / Today / This week / Next week / Later / Without a date).
   - **More** (…): overflow with things like Dashboards, Monday Learning, Templates, Apps, Recycle bin. Some builds show "Favorites" here.
2. **1px divider** `#d0d4e4`, 8px vertical margin.
3. **Favorites section**:
   - Collapsible header row with a chevron, label "Favorites" in `#676879`, 14px.
   - Starred boards and docs as tree rows.
   - **Empty state**: a hint card with a small star icon and "Star boards to add them here" (paraphrased).
4. **Workspaces section**:
   - Header row "Workspaces", with "…" and search icons on hover.
   - Then the **workspace switcher card**, then the **tree** of the current workspace.
5. **Footer** (optional, newer builds): a trial / plan widget ("X days left in trial", progress bar, "Upgrade") and a "+ Invite teammates" link.

### 4.2 Sidebar row (tree node) spec

| Property | Value |
|---|---|
| Height | ~32–36px (`~`) |
| Padding | 8px left (plus 16–20px per depth level), 8px right |
| Radius | 4px (`--border-radius-small`) |
| Icon | 16–20px, `#676879` (board = table/grid icon; dashboard = gauge/chart; doc = page; form = form; folder = folder that opens with an animation; app = puzzle) |
| Label | 14px/20px Figtree 400 `#323338`; single line, ellipsis truncation, full name in a tooltip on hover when truncated |
| Hover | bg `rgba(103,104,121,.1)`; a trailing **"…" icon button** (24×24) fades in at the right edge |
| Selected (current page) | bg `#cce5ff`; label stays `#323338`; icon unchanged |
| Selected + hover | bg `#aed4fc` |
| Focus-visible | inset 2px `#0073ea` ring |
| Drag | rows drag to reorder or move into folders. The ghost row has shadow-medium. A blue 2px insertion line (`#0073ea`) shows the drop position; a folder drop target highlights `#f0f7ff`. |
| Rename | double-click or "Rename" turns the label into an inline input (1px `#0073ea` border, radius 4px). Enter saves, Esc cancels. |
| Private/shareable marker | small lock or share glyph after the name for private boards |
| Unread/new | some builds bold the label or show a dot for boards with new updates |

**Folders**:
- Chevron at left that rotates 90° in 150ms.
- A folder color can be set from the semantic palette.
- Folder "…" menu: Rename, Change color, Add to folder (board/doc/dashboard/sub-folder), Collapse all, Delete.
- Expanded state persists per user.

### 4.3 Tree node "…" menu (board) — items, paraphrased
- Open in new tab
- Rename board
- Add to favorites / Remove from favorites
- Duplicate board (with sub-options: structure only / with items / with items + updates)
- Move to → (workspace / folder submenu)
- Share / Board permissions
- Save as template
- Archive board
- Delete board (destructive item at the bottom, `#d83a52` text, preceded by a divider)

Menu spec:
- 200–260px wide, radius 8px, shadow-medium, 8px vertical padding.
- 32px rows with 16px icons. Submenus open on hover after ~150ms with a chevron.
- Dividers are 1px `#d0d4e4` with 4–8px margins.
- Keyboard: arrows, Enter, Esc, and → to enter a submenu.

### 4.4 Workspace switcher (the card above the tree)
- Card-like row, ~40–48px tall, bg white (on the canvas) or a hover wash, radius 8px.
- **Left**: workspace avatar tile, 28–32px, radius 4–8px, colored from the palette, showing a white initial letter in 14–16px/600. A small house glyph marks the "Main workspace".
- **Middle**: workspace name in 14px/600, truncated.
- **Right**: a chevron-down. Next to the card are a **"…"** button (workspace actions) and a blue **"+"** button (28×28, radius 4–8px, bg `#0073ea`, white plus, hover `#0060b9`).
- **Click opens the switcher popover** (~300–340px, shadow-medium, radius 8px):
  - Search input at top ("Search workspaces"), auto-focused.
  - "My workspaces" list, then other workspaces ("Browse all workspaces").
  - Each row shows avatar, name, and "Closed"/"Open" or lock indicators.
  - Footer actions: "+ Add workspace" and "Browse all".
  - The current workspace has a check mark.
  - Arrow keys plus Enter work. Typing filters instantly.
- **Weakness**: The current workspace is easy to lose. The tree only shows one workspace at a time, so cross-workspace navigation needs the switcher.
  - KitStak should allow pinned multi-workspace sections, or (simpler for a CRM) a fixed object nav: Deals, Leads, Contacts, Accounts, Activities, Dashboards.

### 4.5 Workspace "…" header menu (paraphrased)
- Rename workspace
- Change icon / color (avatar editor)
- Workspace settings / permissions (Open / Closed)
- Manage members
- Add to favorites
- Duplicate workspace
- Sort tree (alphabetically / manually)
- Collapse all folders
- Delete workspace (destructive)

### 4.6 "+" Add menu (blue button next to the switcher)
Popover, ~240px. Items have type icons in their brand colors, paraphrased:
- **Board**, which opens a creation wizard: name, "privacy" (Main / Private / Shareable), and "Select what you're managing" (Items, Projects, Deals, Leads, Tasks, Custom).
- **Doc** (blank doc)
- **Dashboard** (name plus privacy, then pick boards)
- **Form**
- **Folder**
- **Workflow / Automation** (newer builds)
- **App / Installed apps**
- **Import data** (Excel/CSV, other tools)
- **Choose from templates**, which opens the full-screen Template Center (left category nav, preview, "Use template").

Creation dialogs:
- Centered modal, ~520–600px wide, radius 16px, shadow-large, scrim `rgba(41,47,76,.7)`.
- Title in Poppins 24px.
- Inputs: 40px tall, radius 4px, border `#c3c6d4`, focus border `#0073ea`.
- Primary button at bottom right: 40px, `#0073ea`, radius 4px, 14–16px/500 white text. Secondary button is tertiary text style.

### 4.7 Collapse / expand / resize
- **Collapse toggle**: a small circular chevron button (~24px, white, 1px `#d0d4e4` border, shadow-small).
  - It sits on the sidebar's right edge near the top and appears on sidebar hover.
  - Click collapses to a ~30px rail.
- **Collapsed rail**: shows only the toggle. Hovering the rail peeks the full sidebar as an **overlay** (shadow-large) without reflowing content, and it closes on mouse-leave after ~300ms.
- **Resize**: a 4px invisible handle on the right edge.
  - Cursor `col-resize`. On hover, a 2px `#0073ea` line appears.
  - Drag is clamped to min/max. Width persists per user.
- **Animation**: width and transform over ~250ms on the transition curve; content card padding animates at the same time.
- **Keyboard**: there is no well-known default shortcut. KitStak should add **Cmd/Ctrl+\\** or **[**.

### 4.8 Sidebar section-level search
- A magnifier on the "Workspaces" header filters the tree inline.
- Matches are highlighted and folders auto-expand to show them. Esc clears.

---

## 5. Workspace home page (main card, route `/workspaces/:id`)

### 5.1 Header
- 24–32px padding.
- **Large workspace avatar**: ~64–80px tile with a rounded 8–16px radius and a palette color plus initial, or an uploaded image. A "change icon" pencil appears on hover.
- **Workspace name**: Poppins ~32px/500 `#323338`, inline-editable on click (rename-in-place with a subtle hover border).
- **Description**: "Add workspace description" placeholder, editable.
- **Right side**: member avatars stack (overlapping 32px circles with a 2px white ring, "+N" overflow chip), an "Invite"/"Members" button and a "…" menu.

### 5.2 Tabs
- Tabs row: **"Recents" / "Content"** (boards, docs and dashboards list), **"Members"**, **"Permissions"** (admins). Some builds add "Overview" or "Templates".
- **Tab style**:
  - 14px/400 `#676879`. The selected tab is `#323338` with a 2px `#0073ea` underline.
  - Hover text is `#323338`.
  - 16–24px gap between tabs; a 1px `#d0d4e4` baseline under the row.
  - Underline slides between tabs over ~150ms.
- **Content tab**:
  - Toolbar: search ("Search in workspace"), filter by type (Boards / Docs / Dashboards / Forms), sort (Last viewed / Name / Created), and a "+ Add" primary split button.
  - List or table with columns Name (icon + name), Type, Folder, Owner, Last modified.
  - Rows are 40–48px with a hover wash, and a "…" menu per row that matches section 4.3.
  - Some builds show a card grid of "Recent boards" with thumbnails above the list.
- **Members tab**:
  - Table of members (avatar, name, email, role: Owner / Member), plus "Add members".
  - Workspace owners show a crown marker.
- **Empty workspace**: a centered illustration with "Start by adding a board" and buttons such as "+ New board", "Choose from templates", "Import".

---

## 6. Global keyboard & interaction behavior (monday, then KitStak target)

| Action | monday | KitStak target |
|---|---|---|
| Search / palette | Cmd/Ctrl+K (newer), Cmd+B legacy "search everything" | **Cmd/Ctrl+K** palette with commands |
| Keyboard shortcuts sheet | via Help menu, or "?" in some builds | **?** opens a cheatsheet modal |
| Close panel / menu | Esc | Esc, restoring focus to the trigger |
| Navigate menus | arrows, Enter, Esc; type-ahead limited | Full roving tabindex, type-ahead, Home/End |
| Toggle sidebar | none / unclear | **Cmd/Ctrl+\\** |
| Go to (G then D / C / A …) | not offered | Vim-style "g d" = Deals, "g c" = Contacts, "g a" = Accounts, "g h" = Home |
| Back/forward | browser history; SPA routes per board/view | Same, plus restored scroll position and selection |
| Open in new tab | Cmd/Ctrl+click on tree rows works (real `<a href>`) | Must work everywhere (tree, palette, search, notifications) |

Focus management: monday's focus rings are present but inconsistent (some custom elements are mouse-only).
KitStak should use a visible `:focus-visible` ring everywhere (2px `#0073ea`-equivalent with 2px offset), with no ring on mouse focus.

---

## 7. States checklist for shell components

| Component | default | hover | focus | active | selected | disabled | loading | empty | error |
|---|---|---|---|---|---|---|---|---|---|
| Top-bar icon btn | ✓ 3.2 | ✓ | ring | wash | blue bg when panel open | 0.38 | spinner in badge slot | — | — |
| Tree row | ✓ 4.2 | wash + "…" | inset ring | — | `#cce5ff` | 0.38 + "no access" lock | skeleton 3–6 rows with shimmer | "No boards yet" + "+ Add" | inline toast "Couldn't move board", retry |
| Workspace switcher | ✓ | wash | ring | — | check on current | — | skeleton list | "No workspaces match" | toast |
| Search palette | ✓ | row wash | input ring | — | row bg `#cce5ff`-ish | — | shimmer rows | recents / no-results | "Search unavailable, retry" |
| Notifications | ✓ | quick actions | — | — | unread bg `#f0f7ff` + dot | — | skeleton | "all caught up" | retry banner |
| Add "+" btn | `#0073ea` | `#0060b9` | ring | darker | — | 0.38 (viewer role) | — | — | — |
| Tabs | `#676879` | `#323338` | ring | — | underline `#0073ea` | 0.38 | — | — | — |

Toasts (global feedback): bottom-center (or bottom-left), 48px, radius 4–8px.
- Success: green `#00854d` bg with white text.
- Error: `#d83a52`.
- Info: dark `#323338`.
- Toasts can carry an action ("Undo") and auto-dismiss after ~5–8s. Hover pauses the timer.
- Example: **Undo is offered after archive/delete** ("Board deleted · Undo").

---

## 8. What makes monday's shell feel premium (copy the principles)

1. **The floating content card** on a tinted canvas, with a 16px corner, gives depth without heavy shadows.
2. **One universal hover wash** (`rgba(103,104,121,.1)`) on every row, icon and menu item gives calm, consistent feedback.
3. **A soft blue selected state** (`#cce5ff`) instead of heavy bold or left-bars. You always know where you are.
4. **Generous 32–36px rows with 20px icons** and roomy hit targets.
5. **Tight motion vocabulary** (70–150ms productive, 250ms panels, enter/exit curves). Nothing feels sluggish.
6. **Contextual "…" menus everywhere**, revealed on hover, so the tree stays clean but powerful.
7. **Color-coded workspace avatars and type icons** give fast visual scanning.
8. **Two-font pairing**: Poppins for titles and Figtree for UI. Titles feel branded; UI stays neutral.
9. **Polished empty states** with illustrations and a single clear CTA.
10. **Dark tooltip chips** with a short delay on every icon-only control. Nothing is unlabeled.

---

## 9. Weaknesses / annoyances in monday's shell that KitStak should beat

1. **Upsell clutter**: "See plans", trial banners, AI promos and marketplace nudges sit in the chrome all the time. KitStak keeps the chrome for navigation only; billing lives in settings.
2. **Notifications vs Inbox vs My Work** are three overlapping places to check. KitStak gets one **Activity center** with tabs (Mentions / Assigned / Updates / System).
3. **Generic tree-of-boards navigation for a CRM.** Users must know which board holds "Deals". KitStak gets a **first-class CRM object nav** (Deals, Leads, Contacts, Accounts, Activities, Dashboards, Reports), with user boards/views nested beneath and pinned saved views.
4. **Workspace switching hides other workspaces' content.** KitStak supports multiple expanded workspaces and favorites that cross workspaces.
5. **The command palette is search-only**, with few commands. KitStak gets a palette with actions, record creation, navigation, settings and recent records, with fuzzy matching, previews and keyboard hints.
6. **Few keyboard shortcuts for navigation.** KitStak adds g-chords, sidebar toggle, quick create (`C`), a "?" cheat sheet, and visible shortcut hints in tooltips and menus.
7. **Performance on large accounts**: the tree and search can lag, and skeleton→content shifts happen. KitStak targets virtualized trees, optimistic UI, prefetching on hover, and INP < 100ms for nav clicks.
8. **Inconsistent focus handling and accessibility**: some popovers trap focus poorly, and icon-only controls depend on tooltips. KitStak needs WCAG 2.2 AA, `aria-current="page"` on the selected row, landmark roles (`banner`, `navigation`, `main`), and a full roving tabindex tree (`role="tree"` / `treeitem`).
9. **Breadcrumbs are weak**: in the board header you often lose the workspace › folder context. KitStak gets a compact breadcrumb in the main card header with switchers per segment.
10. **The collapsed rail is too minimal (~30px)** and loses the icons. KitStak's collapsed state is a **56px icon rail** (Home, Search, Activity, objects, favorites) with tooltips, and the hover-peek overlay is still available.
11. **Destructive actions sit in hover menus**, with Undo only via toast. KitStak keeps Undo toasts and adds a "Recently deleted" panel reachable from the palette.
12. **No density setting for the sidebar.** KitStak offers comfortable (36px) and compact (28px) rows.

---

## 10. KitStak implementation contract (proposed)

- **Tokens**: a CSS variable layer mirroring the categories above (`--ks-surface`, `--ks-bg`, `--ks-text`, `--ks-text-muted`, `--ks-border`, `--ks-hover`, `--ks-selected`, `--ks-selected-hover`, `--ks-primary`, `--ks-primary-hover`, `--ks-focus`, `--ks-danger`, `--ks-success`, `--ks-warning`, radii 4/8/16, shadows xs/s/m/l, motion 70/100/150/250/400 with the four curves).
  - Themes: `light`, `dark` and `system`, via `[data-theme]`.
- **Layout**: CSS grid `grid-template-columns: var(--sidebar-w) 1fr; grid-template-rows: 48px 1fr;`. The main card has `margin: 0 8px 8px 0; border-radius: 16px 16px 0 0` (or all corners) and `overflow: hidden`.
- **Sidebar width**: default 256px, min 200, max 480, rail 56px. Persist per user (server-side preference, not only localStorage).
- **Components**: TopBar, IconButton (+Badge, +Tooltip), CommandPalette, ActivityPanel, ProfileMenu, HelpMenu, Sidebar, NavSection, TreeView (virtualized, DnD, inline rename), WorkspaceSwitcher, AddMenu, CreateDialog, Tabs, Toast, EmptyState, Skeleton.
- **Accessibility**: tree pattern per WAI-ARIA APG; menus per the menu-button pattern; palette uses `role="combobox"` with a listbox.
- **Perf budgets**: shell JS < 150kb gz; first nav paint < 1.5s; INP < 100ms on tree clicks.
- **Telemetry hooks**: palette queries (anonymized), nav source (tree / palette / recent), sidebar collapse usage.

---

## Appendix A — measurement script to run from an authenticated tab (confirms every `~` value)

```js
(() => {
  const pick = (sel) => document.querySelector(sel);
  const cs = (el, props) => el && Object.fromEntries(props.map(p => [p, getComputedStyle(el)[p]]));
  const P = ['height','width','padding','margin','backgroundColor','color','fontFamily','fontSize',
             'fontWeight','lineHeight','borderRadius','boxShadow','border','transition'];
  const out = {};
  out.topbar   = cs(pick('header, [class*="topbar"], [class*="surface-header"]'), P);
  out.sidebar  = cs(pick('nav, [class*="left-pane"], [class*="leftpane"], [class*="sidebar"]'), P);
  out.mainCard = cs(pick('[class*="surface-content"], main'), P);
  out.treeRow  = cs(pick('[role="treeitem"], [class*="leftpane"] a'), P);
  out.selected = cs(pick('[aria-current="page"], [class*="selected"]'), P);
  out.iconBtn  = cs(pick('header button'), P);
  out.root = ['--primary-surface-color','--primary-selected-color','--layout-border-color',
              '--font-family','--title-font-family']
             .map(v => [v, getComputedStyle(document.documentElement).getPropertyValue(v)]);
  return JSON.stringify(out, null, 1);
})()
```

Follow-up checklist for the authenticated pass:
- [ ] Top bar height and icon list order
- [ ] Sidebar default, min and max widths and the collapsed rail width
- [ ] Tree row height
- [ ] Main card radius and gutters
- [ ] Verbatim menu lists (4.3, 4.5, 4.6, 3.8, 3.9)
- [ ] Notification tab labels
- [ ] Workspace home tab labels
- [ ] Search shortcut
- [ ] Tooltip delay
