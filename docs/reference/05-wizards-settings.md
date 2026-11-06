# 05: Wizards, Modals, and Settings (monday.com reference to KitStak spec)

Status: **Draft v0.1. Tokens are verified; live UI capture is still to do.**
Scope: board creation, templates center, add workspace, automations center and builder, integrations center, board settings and permissions, the board "..." menu, the import wizard, workspace settings, profile and preferences, empty states, onboarding hints, and toasts.

---

## 0. Provenance and confidence (read first)

| Source | What it gives | Confidence |
|---|---|---|
| monday's open-source design system "Vibe" (`monday-ui-style@0.26.2` CSS tokens, pulled from unpkg on 2026-11-05) | Exact colors, spacing, radii, shadows, motion durations and easings, type scale | **High (verified)**. These are the tokens monday's own UI is built from. |
| Sandbox workspace "KitStak Reference Sandbox" (id 18353908): boards Deals, Leads, Contacts, Accounts, Activities, and subitems | Data model and column types we must support in every wizard | High |
| Product knowledge of monday.com's web app (2024–2026 UI) | Flows, steps, menu items, microcopy tone (all paraphrased) | **Medium**. Each item marked `[verify]` needs a live check. |

**The live browsing pass was blocked.** New browser-pane tabs had no monday session and redirected to `auth.monday.com/auth/login_monday`. The user's Chrome also showed a login form with saved credentials filled in. Signing in with a password is outside what an automated agent may do, and the only signed-in tab ("seed") belonged to other researchers, so I did not drive it. Nothing in any monday workspace was viewed in-app or changed.

Before freezing this spec, a signed-in researcher should check every `[verify]` item: pixel sizes of the modals, exact step order, and copy.

Legend: **[T]** verified Vibe token · **[verify]** confirm live · **KS+** where KitStak should beat monday.

---

## 1. Shared foundation tokens (Vibe, verified) [T]

### 1.1 Color: light theme (default)
| Token | Hex | Use in wizards and modals |
|---|---|---|
| primary / brand | `#0073ea` | Primary buttons, focus ring, selected tab underline, links in modals |
| primary-hover | `#0060b9` | Primary button hover |
| primary-selected | `#cce5ff` | Selected list row or card, selected template category |
| primary-selected-hover | `#aed4fc` | Hover on a selected row |
| primary-highlighted | `#f0f7ff` | Soft highlight (keyboard-active row, "recommended" card) |
| primary-surface | `#eceff8` | Left nav surface, gallery sidebar |
| primary-text | `#323338` | Body text, titles |
| secondary-text | `#676879` | Helper text, field labels, subtitles |
| icon / placeholder | `#676879` | Icons, input placeholder |
| link | `#1f76c2` | Inline links ("Learn more") |
| primary-background | `#ffffff` | Modal and dialog surface |
| allgrey / grey-background | `#f6f7fb` | Wizard side panels, empty-state canvases |
| primary-background-hover | `rgba(103,104,121,0.1)` | Ghost button and menu item hover |
| ui-background | `#e7e9ef` | Secondary button fill, chips |
| ui-background-hover | `#d8d9e0` | Secondary button hover |
| ui-border | `#c3c6d4` | Input borders (default) |
| layout-border | `#d0d4e4` | Dividers, card borders, table grid |
| disabled-background | `#ecedf5` | Disabled inputs and buttons |
| disabled-opacity | `0.38` | Disabled text = `rgba(50,51,56,.38)` |
| backdrop | `rgba(41,47,76,0.7)` | Modal overlay (navy-tinted, not black) |
| inverted-bg | `#323338` | Toasts (normal), tooltips |
| positive | `#00854d` (hover `#007038`, selected `#bbdbc9`) | Success toast, "Connected" badge |
| negative | `#d83a52` (hover `#b63546`, selected `#f4c3cb`) | Error text, destructive buttons, invalid input border |
| warning | `#ffcb00` (hover `#eaaa15`, selected `#fceba1`) | Warning banners (black text on top) |

### 1.2 Color: dark theme (`.dark-app-theme`)
Primary bg `#181b34`, dialog `#30324e`, primary text `#d5d8df`, secondary text `#9699a6`, ui-border `#797e93`, layout-border `#4b4e69`, shadows tinted `rgba(9,11,25,.5)`. Brand stays `#0073ea`. A "black" theme also exists: bg `#111111`, dialog `#2c2c2c`.

### 1.3 Status palette (used in wizard previews, template thumbnails, recipe tokens) [T]
done-green `#00c875` · working-orange `#fdab3d` · stuck-red `#df2f4a` · grass-green `#037f4c` · bright-blue `#579bfc` · chili-blue `#66ccff` · purple `#9d50dd` · egg-yolk `#ffcb00` · lipstick `#ff5ac4` · sofia-pink `#e50073`. Every color has `-hover` (about 15% darker) and `-selected` (darker in light theme, pastel in dark theme) variants.

### 1.4 Type [T]
- Family: `Figtree, Roboto, Noto Sans Hebrew, Noto Kufi Arabic, Noto Sans JP, sans-serif`. Titles use a title family (Poppins in the app chrome `[verify]`).
- Scale: H1 32/40 · H2 24/30 · H3 18/24 (weights 300/500/600/700). Body text1 16/22 · text2 14/20 · text3 12/16.
- Modal title is H2 (24/30, weight 500). Field label is text2 (14/20, `#323338`, weight 400–500). Helper text is text3 (12/16, `#676879`).

### 1.5 Spacing, radius, shadow, motion [T]
- Spacing: 4 · 8 · 16 · 24 · 32 · 48 · 64 (xs, small, medium, large, xl, xxl, xxxl).
- Radius: small 4px (buttons, inputs, chips), medium 8px (cards, menus, dialogs), big 16px (large modals, template cards) `[verify modal = 8 or 16]`.
- Shadow: xs `0 4px 6px -4px rgba(0,0,0,.1)` · small `0 4px 8px rgba(0,0,0,.2)` (menus) · medium `0 6px 20px rgba(0,0,0,.2)` (dialogs, popovers) · large `0 15px 50px rgba(0,0,0,.3)` (modals).
- Motion durations: productive 70/100/150ms (hover, press, menu) · expressive 250/400ms (modal, panel, wizard step).
- Easing: enter `cubic-bezier(0,0,.35,1)` · exit `cubic-bezier(.4,0,1,1)` · transition `cubic-bezier(.4,0,.2,1)` · emphasize `cubic-bezier(0,0,.2,1.4)` (a small overshoot for success and "pop").

### 1.6 Base controls used by every wizard
| Control | Spec |
|---|---|
| Button sizes | small 32px tall (padding 0 8px) · medium 40px (0 16px) · large 48px (0 24px). Radius 4px. Text 14/20, weight 400 (Figtree). |
| Primary button | bg `#0073ea`, text white. Hover `#0060b9`. Active `transform: scale(.95)` for about 100ms `[verify]`. Disabled bg `#ecedf5`, text 38%. Loading: label swaps for a 16px spinner and width stays locked. |
| Secondary button | 1px `#c3c6d4` border, transparent bg, text `#323338`. Hover bg `rgba(103,104,121,.1)`. |
| Tertiary / ghost | No border or bg. Hover bg `rgba(103,104,121,.1)`. |
| Text input | Height 40px (medium; small 32, large 48), 1px `#c3c6d4` border, radius 4px, padding 0 16px. Hover border `#323338`. Focus border `#0073ea` plus no outer glow (Vibe uses a border-color change). Error border `#d83a52` with 12/16 helper text in red underneath. Success: a green check icon inside. |
| Focus ring (keyboard) | Vibe's `focus-visible` style: about 3px `hsla(209,100%,50%,.5)` box-shadow `[verify]`. Only on keyboard focus, never on mouse click. |
| Toggle | 40×24 track, 16px knob. On `#0073ea`, off `#c3c6d4`. Knob slides in 100ms with the transition easing. |
| Radio / checkbox | 16px, radius 4 (checkbox). Checked fill `#0073ea`, white tick. |
| Tooltip | bg `#323338`, white text3, radius 4, padding 8×12, arrow 6px, show delay about 300ms, hide 0ms. |
| Menu (dropdown) | bg white, radius 8, shadow medium, padding 8px. Items 32px tall, 8×12 padding, radius 4, hover bg `rgba(103,104,121,.1)`. Leading icon 16px `#676879`. Dividers 1px `#d0d4e4` with 8px vertical margin. Destructive items are text `#323338` with a trash icon (monday does **not** color them red in menus) `[verify]`. |
| Modal shell | Overlay `rgba(41,47,76,.7)`. Panel white, radius 8–16, shadow large. Header padding 24–32. Close "X" 32px ghost icon button top-right. Footer right-aligned: Cancel (tertiary) + primary. Enter animation: fade plus 8–16px rise or scale .95 to 1 over 250ms with the enter easing. Exit 150ms with the exit easing. |

---

## 2. Entry points: the "+ Add new" menu (left sidebar)

**Anatomy.** The workspace header in the left sidebar has a `+` square button (32×32, radius 4, primary `#0073ea` fill with white plus) `[verify fill vs ghost]`. Clicking it opens a menu anchored right of the button, about 260px wide.

**Menu items (paraphrased, in order) [verify]:**
1. Board (sub-flyout or direct → New board modal)
2. Doc
3. Dashboard
4. Form
5. Workflow / Automation (newer builds)
6. App / Vibe app (2025+)
7. divider
8. Folder
9. divider
10. Installed apps / "Add from templates" → opens the Templates center
11. Import data → opens the Import wizard

Each item has a 16px line icon, a 14px label, and an optional beta or "New" chip (radius 4, `#cce5ff` bg, `#0073ea` text).

**Keyboard.** Arrow keys move the highlight, Enter selects, Esc closes and returns focus to the `+` button.

**What feels premium.** It appears instantly (≤100ms fade), item icons are colored per object type, and new object types are announced inline with chips instead of modals.

**KS+.** Show a shortcut hint on each row (e.g. `B` new board, `D` doc, `I` import). Add a type-to-filter field at the top of the menu.

---

## 3. "Create board" modal (board name, privacy, item terminology)

**Trigger:** + Add → Board. In the empty workspace it is also "Create your first board".

### 3.1 Anatomy [verify sizes]
- Modal about 580px wide, auto height, radius 8, padding 32.
- Title "Create board" (H2 24/30).
- **Field 1: Board name.** Label "Board name", input 40px, prefilled "New Board" and **auto-selected** so typing replaces it. Max length about 255.
- **Field 2: Privacy.** Three radios in a row: **Main** ("Visible to everyone in your account"), **Private** ("Visible to members you invite") with a lock icon, **Shareable** ("Visible to you, your team, and invited guests") with a share icon. Selecting one updates a helper line underneath. Guest/Shareable is plan-gated; a locked option shows an upgrade chip and tooltip.
- **Field 3: "Select what you're managing in this board"** (item terminology). A chip/radio group: Items (default) · Budgets · Employees · Campaigns · Leads · Projects · Creatives · Clients · Tasks · Custom… "Custom" reveals an inline text input. This sets the singular and plural noun used on "New item", "+ Add item" and the item card ("New Lead").
- Footer: "Cancel" (tertiary) · "Create Board" (primary, disabled while the name is empty).

### 3.2 States
| State | Behavior |
|---|---|
| default | Name focused and selected. Main privacy selected (or Private if admin policy says so). |
| empty name | Create button disabled. No error until blur, then "Board name is required" `[verify]`. |
| loading | Primary shows a spinner. The modal stays open about 300–800ms, then closes and routes to the new board. |
| success | Board opens with 1 group "Group Title", 5 starter items, and default columns Owner / Status / Date `[verify]`. An onboarding tooltip may point at "+ Add view". |
| error | An inline banner in the modal (negative-selected bg `#f4c3cb`, red icon) with a retry. |

**Keyboard.** Enter submits from the name field. Esc cancels. Tab order: name → privacy radios (arrow keys inside the group) → terminology chips → Cancel → Create.

**Feels premium.** The name text is pre-selected. The terminology choice immediately changes product language. One screen, no stepper.

**KS+.**
1. Add a **"Start from" segmented control** at the top (Blank · CRM template · Import CSV) so users aren't sent to another surface.
2. Show a **live mini-preview** on the right of the board with the chosen noun ("+ Add deal").
3. Remember the last privacy choice for each workspace.
4. For CRM boards, preselect a CRM object type (Deals, Leads, Contacts, Accounts, Activities) that seeds proper columns, matching our sandbox schema.

---

## 4. Templates center

**Trigger:** "+ Add → Choose from templates", the home "Explore templates" link, or the empty-workspace CTA. Opens as a **full-screen overlay** (nearly the full viewport with a 24–40px inset, radius 8, shadow large) `[verify]`.

### 4.1 Layout
- **Header** (64px): search input (about 360px, magnifier icon, placeholder like "Search templates") and a close X on the right.
- **Left rail** (about 240px, `#f6f7fb` bg, 8px item radius). Categories (paraphrased): Recommended for you · Most popular · Project management · Sales & CRM · Marketing · Software development · HR · Operations · Construction · Nonprofits · Education · Startups · Product · Creative & design · Remote work · IT · Manufacturing · Event · "Made by monday" / "Apps". A "Templates by monday.com Product" filter groups by product (work management, CRM, dev, service). The selected category uses primary-selected bg `#cce5ff` with text `#323338`. Hover uses the grey hover bg.
- **Grid**: cards about 280×220, 3–4 per row, gap 24. Each card has a thumbnail (illustrated board preview with colored status pills, top radius 8), a title (text1 600), a 2-line description (text2 secondary), and badges (e.g. "Includes automations", "Includes dashboard") `[verify]`.
- **Card hover**: shadow small to medium plus a 2px lift. A primary "Use template" button and a secondary "Preview" fade in at the bottom over 150ms.

### 4.2 Template preview (detail)
- Clicking a card replaces the grid with a **preview pane**: a large live-rendered board preview (real table with sample data, scrollable), a right column with the template name, "Use template", "What's included" (boards, dashboards, automations, integrations listed with icons), description, and a "Created by" attribution.
- Multi-board solutions (e.g. CRM) show tabs for each included board.
- A "Back to templates" link sits top-left.

### 4.3 "Use template" flow
1. Click Use template. A small dialog may ask for the **destination workspace / folder** and **board name** (prefilled with the template name) `[verify]`.
2. Loading takes 1–5s with a progress animation ("Setting up your board…"). Multi-board solutions show a checklist of what's being created.
3. The new board opens, sometimes with an onboarding checklist side panel.

### 4.4 States
Empty search shows an illustration plus "No templates found" and a suggestion to try other words or start from scratch. Loading shows skeleton cards (grey `#e7e9ef` blocks with a shimmer).

**Feels premium.** Real data previews instead of screenshots; "What's included" sets clear expectations.

**KS+.**
1. Search matches fuzzy **column names** ("probability", "close date").
2. Preview is **interactive** (change a status, drag an item) before committing.
3. "Install into existing board" merges the template's columns and automations into a board you already have.
4. One-click CRM solution installs Deals, Leads, Contacts, Accounts and Activities **with relations prewired**. monday's CRM template is close, but its connect-boards columns often need manual linking.

---

## 5. Add workspace modal

**Trigger:** the workspace switcher dropdown → "+ Add workspace".
- Modal about 480px wide. Title "Create workspace".
- **Workspace icon/avatar**: a 64px rounded square, colored, showing the first letter. Click it to change color (palette of about 20 swatches) or upload an image `[verify]`.
- **Name** input (required), placeholder like "Workspace name".
- **Privacy**: "Open" (everyone in the account can see and join) vs "Closed" (only invited members; Enterprise plan). Shown as radios with a description each. "Closed" is gated with an upgrade chip on lower plans.
- **Description** (optional textarea, about 3 rows) `[verify present at creation vs settings only]`.
- Footer: Cancel · Create workspace. After creation you land on the workspace home with an empty state.

**KS+.** Offer a "Duplicate structure from workspace…" option, a team picker with seat-count preview, and default permissions presets ("Sales team", "Leadership read-only").

---

## 6. Workspace home and workspace settings

- **Workspace header**: avatar (48–64px), name (H1/H2, inline-editable on click with a 1px hover outline), description (inline-editable, placeholder "Add workspace description"), and a "..." menu.
- **Tabs**: "Recents" · "Content" (boards, docs, dashboards, folders) · "Permissions" / "Members" `[verify naming]`.
- **Members tab**: list of members/owners with role dropdowns (Owner / Member), "+ Add members" (do not use in sandbox), team rows.
- **Settings in the "..." menu** (paraphrased): Rename · Change icon/color · Workspace settings (privacy: open/closed) · Save as template (Enterprise) · Move to another product · Delete workspace (destructive; type-to-confirm on Enterprise `[verify]`).
- **Empty workspace state**: centered illustration plus "This workspace is empty", with suggested actions: Create board, Use template, Import data. Buttons are medium size; the primary one is "Add" or "Create".

**KS+.** Show a workspace health card (stale boards, broken automations, unused columns) and an activity feed scoped to the workspace.

---

## 7. Board header "..." menu (board options)

Opened from the "..." icon button (32px ghost) right of the board title. Menu about 280px wide, shadow medium, radius 8. Items paraphrased; groups separated by dividers `[verify exact current order]`:

**Group A: view/collapse**
- Collapse board header / Show board description
- Open board in new tab
- Board fullscreen (newer)

**Group B: board actions**
- Add board to favorites (star)
- Save as a template
- Duplicate board → submenu: "Structure only" · "Structure and items" · "Structure, items and updates"; plus "Keep subscribers" checkbox, destination workspace selector `[verify]`
- Move to → workspace / folder picker submenu
- Rename board (also inline on the title)
- Change board type / "Board type: Main / Private / Shareable" (opens privacy confirm)

**Group C: data**
- Export board to Excel (downloads .xlsx; shows a toast "Your export is being prepared")
- Import items / "Import from Excel/CSV" → import wizard (§11)
- Print board
- Columns / "Manage columns" / Board settings → settings panel (§8)

**Group D: activity and integrations**
- Activity log
- Board automations (count)
- Board integrations
- Board permissions (§8.2)
- Email address for this board ("Send emails to this board" with a copyable address)
- Board's notification settings ("Board notifications": everything / mentions only / none)

**Group E: destructive**
- Archive board → confirm dialog (§13)
- Delete board → confirm dialog; then a toast with Undo; the board goes to Trash for 30 days

**Interaction.** Hovering a submenu row opens it after about 100ms, with a chevron at the right edge. Keyboard: ArrowRight opens a submenu, ArrowLeft closes it. Long menus scroll inside with a max height of about 70vh.

**KS+.** Show the most-used actions as icon buttons in the header (fewer menu trips). Add a search field at the top of long menus. Mark plan-gated items with a lock **and** explain why in a tooltip; monday hides some and gates others inconsistently.

---

## 8. Board settings and permissions

### 8.1 Board settings panel [verify current surface]
Recent builds consolidate this into a **"Board settings"** side panel or modal with sections:
- **General**: board name, description (rich text), board owner(s) (people picker), item terminology (same chip set as §3), privacy type.
- **Columns**: list of columns with type icon, drag handle (6-dot), visibility toggle, "..." per column (rename, settings, duplicate, delete). Required-column flags (Enterprise).
- **Default values**: per-column default for new items `[verify]`.
- **Notifications**: board-level defaults.
- **Board views**: default view, view locking.

### 8.2 Board permissions modal
- Modal about 560px wide. Title "Board permissions".
- Radio cards (each a 1px `#d0d4e4` card, radius 8, padding 16; selected card gets a `#0073ea` border plus `#f0f7ff` bg):
  1. **Edit everything**: "Members can edit all content and structure."
  2. **Edit content**: "Members can edit items but not columns, groups or views." Optional sub-setting: only edit items they're assigned to (a column picker, e.g. "Owner").
  3. **Edit rows assigned to them** (assigned-items only).
  4. **View only**: "Members can only view and write updates."
- Below that: "Who can create new items" `[verify]`, and "Restrict column editing" links (column-level permissions → per-column modal choosing who can edit or view).
- Footer: Save (primary). A plan gate replaces the cards with an upgrade CTA on Basic/Standard.
- After saving: toast "Board permissions updated".

### 8.3 Column permissions (per column "..." → "Column permissions")
Two tabs, "Restrict column view" and "Restrict column edit", each with a people/team picker ("Only these people can …"). Board owners are always included and greyed out with a tooltip.

**KS+.**
1. **Role-based (RBAC) presets** shown as a matrix (roles × actions) instead of four radio cards.
2. Field-level masking for sensitive CRM fields (deal value, phone) by role.
3. An **"Audit what changed"** link straight to the audit log filtered to permission events.
4. **"View as …"** impersonation preview.

---

## 9. Automations center

**Trigger:** the "Automate" button in the board header (lightning icon plus count badge), or board "..." → Automations. Opens as a **full-screen overlay** with a left sidebar `[verify]`.

### 9.1 Layout
- **Left sidebar** (about 240px): "Automations Center" title; nav items: **Recommended / Templates** (recipe gallery) · **Board automations** (count) · **Account usage** (actions used this month vs plan quota, with a progress bar) · **Automation runs / Activity** (history) · **Integrations** shortcut.
- **Recipe gallery header**: search ("Search for automations"), category tabs or chips across the top. Categories (paraphrased): Recommended · Status change · Notifications · Recurring · Item creation · Due dates · Move item · Dependencies · Subitems · Email & activities · Integrations (Gmail, Outlook, Slack…) · AI.
- **Recipe cards**: about 280×140, white, 1px `#d0d4e4` border, radius 8, padding 16–24. The recipe sentence is in text1 16/22 with **tokens underlined/bold** (e.g. "When **status** changes to **something**, notify **someone**"). Hover: border goes to `#0073ea` or shadow small, plus an "Add to board" affordance. Some cards have category color strips or icon pairs (trigger app icon → action app icon).
- **"Create custom automation"** button: primary, top-right.

### 9.2 Recipe sentence builder (core interaction) [high-value]
After clicking a recipe:
- A modal shows the **sentence at large size** (about 24–32px, light weight) centered on white or a light surface. Placeholder tokens are **underlined** (a 1–2px dotted or solid underline) and shown in a different weight. Unconfigured tokens read generically ("status", "something", "someone").
- Clicking a token opens a **popover picker** anchored under it (shadow medium, radius 8):
  - "status" → column list (only columns of a compatible type, with icons).
  - "something" → the chosen status column's labels as **colored pills** (real label colors, e.g. Won `#00c875`).
  - "someone" → people picker (search, avatars, "Person in column…" dynamic option, teams).
  - "notify" → message editor with **dynamic value insertion** ("{pulse.name}", "{board.name}" displayed as chips).
- After a value is chosen, the token updates to that value (underline stays, the color changes to primary text), and focus jumps to the next unconfigured token (wizard-like progression).
- The **"Create automation"** button stays disabled until every token is configured. Tooltip: "Please fill in all fields".
- Validation: incompatible columns are excluded, not shown disabled. Missing permission produces an inline error.
- On success: the modal closes, a toast "Automation created" appears, and the board automations list shows the new one with its toggle **on**.

### 9.3 Custom automation builder
- Same sentence canvas, starting with **"When…"**. Click it to open the **trigger list** (search plus categorized list: "When an item is created", "When status changes", "When a column changes", "When date arrives", "Every time period", "When a subitem is created", "When an update is created", "When a button is clicked", integration triggers…).
- Then **"+ Add condition"** ("and only if…", "and only if person is…") with optional multiple conditions.
- Then **"Then…"**, which opens the **action list** ("notify", "create item", "move item to group", "change status", "set date", "assign person", "create update", "send email", "archive item", "duplicate item", "create subitem", "connect boards", "AI: summarize / categorize / extract"…).
- **"+ Add action"** chains multiple actions (newer workflow builder). The newest "Workflow builder" is a canvas with blocks (vertical flow, connector lines, "+" nodes) `[verify which applies to account]`.
- A name field is auto-generated from the sentence and editable.

### 9.4 Board automations list
- Rows: sentence summary (tokens bolded), creator avatar, "Created x days ago", an **on/off toggle**, and a "..." menu (Edit · Duplicate · Activity · Delete).
- Toggling off shows a toast "Automation deactivated". Delete opens a confirm dialog.
- Empty state: an illustration plus "No automations yet" and a CTA to browse templates.

### 9.5 Automation runs / activity log
- A table of runs: timestamp, automation name, item (link), status pill (Success green `#00c875` / Failed red `#df2f4a` / Pending), and a detail drawer with the error reason (e.g. "Column was deleted", "Missing permissions"). Filters: date range, status, automation.
- Usage meter: "X / 250 actions used this month" with a progress bar (turns warning yellow at about 80%, red at 100%).

**Feels premium.** The plain-English sentence with editable tokens is the signature pattern. Pills render in true label colors. Focus auto-advances to the next token.

**Weaknesses / KS+.**
1. Monday's runs log is shallow (no retry button, terse errors). **KS+**: one-click "Retry run", a full payload diff, and a "Run on existing items" backfill.
2. There's no dry-run. **KS+**: a "Test with item…" preview showing what would happen.
3. Action quotas create anxiety. **KS+**: show per-automation cost and projected monthly usage.
4. Token popovers can't be searched in some cases. **KS+**: every picker is searchable, keyboard-first (Tab moves token to token, Enter confirms).
5. **KS+**: version history and an owner for each automation, plus "Automation broke" notifications that link straight to the fix.

---

## 10. Integrations center (browse only)

- **Trigger:** the board header "Integrate" button (plug icon), or the Automations center → Integrations.
- **Layout**: full overlay. Search at the top, a featured app carousel, and a grid of app tiles (about 160×120, app logo 48px centered, name text2). Categories on the left: Communication (Slack, Teams, Zoom), Email (Gmail, Outlook), CRM & Sales (Salesforce, HubSpot, Pipedrive, Zendesk), Dev (GitHub, Jira, GitLab), Files (Dropbox, Drive, OneDrive), Marketing (Mailchimp, Facebook Ads, LinkedIn), Forms (Typeform, SurveyMonkey), Finance (QuickBooks, Stripe), Calendar (Google Calendar), Automation hubs (Zapier, Make), Custom (Webhooks, API).
- **App detail page**: a header with logo, name, "by monday.com" or vendor, a short description, and a **recipe list** for that app (same sentence cards as §9, e.g. "When an email is received, create an item"). Clicking a recipe starts the sentence builder; the first token requiring auth triggers an **OAuth "Connect account"** step (popup window). *Not exercised, by rule.*
- Badges: "Installed", "New", "Popular". Connected accounts are managed under "Connections" in the profile admin.

**KS+.** For a CRM, native **two-way email and calendar sync** (Gmail and Microsoft 365) should be first-class, not a recipe. Add a health status per connection (last sync, error count), and webhooks with signing secrets and a replay UI.

---

## 11. Import data wizard (Excel/CSV, and from other tools)

**Trigger:** + Add → Import data, or board "..." → Import. *Steps observed in prior knowledge only; nothing was imported.*

### 11.1 Source selection (step 1)
A grid of source tiles (about 140×120, logo plus label, radius 8, hover border `#0073ea`): **Excel**, **CSV**, **Google Sheets** (via export), **Trello**, **Asana**, **Jira**, **Wrike**, **Smartsheet**, **ClickUp** `[verify list]`. Subtitle along the lines of "Bring your data into monday.com".

### 11.2 Upload (step 2)
A dashed drop zone (2px dashed `#c3c6d4`, radius 8, `#f6f7fb` bg, about 520×240). It contains an icon, "Drag and drop your file here, or browse", and accepted types ".xlsx, .xls, .csv" with a max size `[verify]`.
States:
- hover/dragover: border `#0073ea`, bg `#f0f7ff`
- uploading: progress bar 4px `#0073ea`
- parse error: red helper text such as "We couldn't read this file"
- multiple sheets: a sheet picker (radio list)

### 11.3 Destination (step 3)
"New board" (name prefilled from the filename) vs "Existing board" (board picker). For an existing board you also choose the target group.

### 11.4 Column mapping (step 4) [high-value]
- A two-column table: **"Column in file"** (header plus 2–3 sample values in secondary text) → **"Column on board"** (dropdown: existing columns filtered by type compatibility, or "+ New column" with a type picker, or "Don't import").
- Auto-mapping by name similarity. Matched rows show a green check; unmatched show an amber dot.
- Item name column: required. The first text column is selected by default.
- Type inference: dates, numbers, emails, phones, and statuses (distinct values ≤ about 20 become status labels with auto colors).
- Footer: Back · "Import" (primary). The count reads like "Import 245 items".

### 11.5 Progress and result (step 5)
A progress modal ("Importing your data…", progress bar, can run in the background). It ends with a success screen (item count, "Go to board") or a toast. Row-level failures appear as a "Some rows were skipped" summary `[verify downloadable report]`.

**Weaknesses / KS+.**
1. Monday dedupes poorly. **KS+**: a **dedupe/merge step** that matches on email, domain or a chosen key (vital for Contacts and Accounts), with "Update existing / Skip / Create new".
2. **KS+**: **relationship mapping**: map a "Company" text column to the Accounts relation (auto-create missing accounts).
3. **KS+**: validation preview with per-row errors (bad email, unparsable date) that can be fixed inline before importing.
4. **KS+**: an undo for the whole import (rollback batch id) and a saved import mapping template for recurring imports.
5. **KS+**: the import runs as a background job with a progress toast and a notification on completion.

---

## 12. Profile and preferences

**Trigger:** the avatar (32px, bottom-left in the newer layout or top-right) → profile menu.

### 12.1 Avatar menu (paraphrased) [verify]
Account header (avatar, name, account name) · My profile · My work · Admin (admins only) · Teams · Apps / Marketplace · Trash · Archive · Invite members (*do not use*) · Change theme → Light / Dark / Night (black) · Keyboard shortcuts · Help center / Learn · Mobile app · Getting started · Join beta · Language · Log out. Grouped with dividers; account switcher at the top if the user belongs to several accounts.

### 12.2 Profile page
- A cover banner (customizable color/image) and a large avatar (about 120px) with an upload overlay on hover ("Change photo").
- Tabs: **Personal info** (Title, Email, Phone, Mobile, Location, Birthday, Work anniversary, Time zone; each row is click-to-edit with a pencil on hover, saves on blur or Enter, cancels on Esc) · **Working status** ("Working from home / On a break / Out of office" with a date range and auto-reply message) · **Notifications settings** · **Language & region** (language, date format, start of week, time format 12/24h) · **Password** · **Sessions** (active sessions with device, last activity, and log out) · **Two-factor authentication** · **API** (personal token; *never touch*).
- **Notifications settings**: a matrix of event types (mentioned, assigned, subscribed board updates, automation notifications, due date reminders, daily digest) × channels (in-app bell, email, desktop push, mobile push), each a toggle. Plus "Do not disturb" scheduling and an email frequency choice (instant / daily / weekly).

**KS+.** Notification **rules by board/object** (e.g. "only Deals > $50k"), quiet hours per weekday, a preview of each notification type, and a notification center with snooze.

---

## 13. Confirmation dialogs, toasts, and undo

### 13.1 Confirm dialogs (archive / delete)
- Small modal, about 400–480px wide. Title like "Archive this board?" / "Delete this item?".
- Body text2 explaining reversibility: archive is restorable from the Archive; delete goes to Trash for 30 days.
- Footer: Cancel (tertiary) · Archive / Delete (primary; **delete uses the negative color `#d83a52`** in some places `[verify]`).
- Focus starts on Cancel for destructive actions `[verify]`. Enter triggers the focused button. Esc cancels.
- Item-level archive/delete usually **does not confirm**; it relies on undo toasts (monday's preferred pattern).

### 13.2 Toast
- **Position**: bottom-center (some builds top-center under the header) `[verify]`, about 24px from the edge.
- **Anatomy**: height about 48–56px, min width 300, max about 600; radius 4–8; padding 12×16; left icon 20px; message text2 white; an action button (e.g. **"Undo"**) as a white-outlined or underlined text button; a close X 16px.
- **Variants** (Vibe Toast): `normal` bg `#323338` (inverted) · `positive` bg `#00854d` · `negative` bg `#d83a52` · `warning` bg `#ffcb00` with dark text.
- **Timing**: autohide about 5–10s; hover pauses the timer `[verify]`; it stacks newest on top (max about 3).
- **Animation**: slide up 16px plus fade in over 250ms with the enter easing; exit 150ms with the exit easing.
- **Undo flow**: archive an item → toast "1 item archived" plus "Undo". Clicking Undo restores the item in place (row slides back in), shows a confirming toast ("Item restored") and dismisses the first one. Bulk actions read "5 items deleted · Undo".
- Examples (paraphrased): "Board archived", "Item moved to *Group*", "Copied to clipboard", "Automation created successfully", "Your export is being prepared", "You don't have permission to do that".

**KS+.** A global **"Undo" with Ctrl/Cmd+Z** for the last N destructive actions (not just while the toast is visible). An action-history drawer. Toasts that include a "View" link to the affected object. Accessible live region (`role="status"`, `aria-live="polite"`; assertive for errors).

---

## 14. Empty states and onboarding hints

### 14.1 Empty states (pattern)
- Centered layout on `#ffffff` or `#f6f7fb`: an illustration (about 160–240px; **build our own**, never copy theirs), a title (H3 18/24 or text1 600), a 1–2 line explanation (text2 secondary, max width about 360px), a primary CTA, and an optional secondary link.
- Instances:
  - **Empty board/group**: a ghost "+ Add item" row is always present. A totally empty board shows "Start by adding your first item".
  - **Empty search/filter result**: "No results found" plus "Clear filters" link.
  - **Empty updates panel** (item card): illustration plus "No updates yet", with "Write an update and mention others with @" style copy.
  - **Empty Inbox**: "You're all caught up" (positive tone).
  - **Empty automations, integrations, dashboards** ("Add widgets to get started"), **empty Trash/Archive**, **empty My Work** ("Nothing assigned to you").
- **Tone**: friendly, short, second person, light encouragement, no exclamation spam.

### 14.2 Onboarding hints
- **Coach-mark tooltips**: dark (`#323338`) or primary-blue popovers with an arrow, title plus 1–2 lines, "Got it" / "Next (1/3)" buttons, and a pulsing dot (8px primary, 1.5s pulse loop) on the target.
- **Getting-started checklist**: a side panel or widget with progress ("3/7 completed"); tasks such as Create a board, Invite your team, Set up an automation, Install an integration, Try a view. Each completes with a check animation (emphasize easing overshoot).
- **"New" feature callouts**: chips in menus, a "What's new" bell section.
- **Board empty-view hints**: "+ Add view" glows the first time.
- Dismissal is remembered per user. There's a "Skip tour" link.

**KS+.** Make onboarding **role-aware** (SDR vs AE vs manager); seed sample CRM data with one-click "clear sample data"; put a command palette hint (Ctrl/Cmd+K) in every empty state.

---

## 15. Wizard and stepper conventions (to standardize in KitStak)

monday mostly avoids explicit numbered steppers, preferring single-screen modals and sentence builders. Where steps exist (import, multi-board template install), they use:
- A step header such as "Step 2 of 4" in secondary text (or a dots indicator).
- Back (tertiary, left) and Next/Import (primary, right) in the footer.
- Steps transition with a horizontal slide of 16–24px plus fade over 250ms (enter easing) `[verify]`.

**KitStak standard (KS+):**
1. A left-rail stepper for flows with 3 or more steps (completed steps get a check and are clickable to go back).
2. Per-step validation that runs on Next, with the first error field focused and scrolled into view.
3. **Draft persistence**: closing a wizard mid-way prompts "Keep your progress?" and resumes later.
4. Every wizard is completable by keyboard alone, with `aria-current="step"` on the active step.
5. The final step shows a **summary review** before commit, plus an undo after commit.

---

## 16. What makes monday's version feel premium (checklist for KitStak)

1. **One design token system everywhere**: identical radii, shadows and easings across all modals (Vibe).
2. **Plain-language sentence builders** for automations; tokens show real data (actual status pill colors).
3. **Prefilled, preselected inputs** (board name selected on open), so the Enter key does the default right thing.
4. **Undo-over-confirm**: small destructive actions don't block; toasts offer Undo.
5. **Navy-tinted backdrop** (`rgba(41,47,76,.7)`) and soft large shadows instead of harsh black.
6. **Colorful but disciplined**: color appears in data (status pills, template thumbnails) and the chrome stays neutral grey/white.
7. **Fast, short motion**: 70–150ms for UI feedback, 250–400ms only for surfaces; the overshoot easing is reserved for delight moments.
8. **Live previews** in templates and the item terminology carried through into UI copy.
9. **Plan gating handled inline** (lock chips, upgrade tooltips) instead of dead ends.

## 17. Weaknesses and annoyances KitStak can beat (consolidated)

| # | monday weakness | KitStak answer |
|---|---|---|
| 1 | Settings are scattered (board "..." menu, header buttons, side panels, admin) | One **Board settings** surface with a left-nav (General, Columns, Permissions, Automations, Integrations, Notifications, Danger zone) plus deep links |
| 2 | Long "..." menus with inconsistent grouping and no search | Grouped, searchable menus with shortcut hints |
| 3 | Automation errors are terse; no retry or dry-run | Run log with payload, retry, test-on-item, backfill, versioning |
| 4 | Action quotas cause surprise | Transparent usage per automation plus forecast |
| 5 | Import lacks dedupe, relation mapping and row-level fixes | Full CRM-grade import: dedupe/merge, relation mapping, inline fix, rollback |
| 6 | Permissions are coarse (4 presets) and plan-gated | RBAC matrix, field-level security, "View as" |
| 7 | CRM objects need manual connect-board wiring after template install | Prewired CRM data model (Deals↔Accounts↔Contacts↔Activities) |
| 8 | Overlays (templates, automations, integrations) open as heavy full-screen layers that lose context | Side-sheet or split view that keeps the board visible; deep-linkable URLs for every wizard step |
| 9 | Kanban/Calendar/Chart views can't be created via API (per sandbox notes) | Every view type is API-first and template-able |
| 10 | Undo is limited to the toast lifetime | Global Ctrl/Cmd+Z history and an action history drawer |
| 11 | Native email/calendar sync is recipe-based | First-class two-way sync with connection health |
| 12 | Onboarding is generic | Role-aware onboarding plus resettable sample data |
| 13 | Dark mode contrast is weak in places (secondary text `#9699a6` on `#30324e` is about 3.9:1) | Meet WCAG AA 4.5:1 for all text tokens in both themes |
| 14 | The command palette is limited | Ctrl/Cmd+K palette that can launch every wizard, setting and recipe |

---

## 18. Implementation notes for engineers

- Build every modal on **one `<Dialog>` primitive**: focus trap, `aria-modal`, return focus to the trigger, Esc closes (unless dirty, then "Discard changes?"), scroll lock, inert background, sizes S 400 / M 580 / L 800 / Full (inset 24).
- **`<SentenceBuilder>`**: tokens are buttons (`aria-haspopup="dialog"`) with an underline (`text-decoration-thickness: 2px; text-underline-offset: 4px`), state `unset | set | invalid`. Popovers use a Floating UI–style positioner, flip/shift, 8px offset.
- **`<Toast>`** manager: queue (max 3), pause on hover/focus, `role=status`, action slot, programmatic `undo()` callback that resolves a pending server mutation (optimistic delete with a 7s commit delay, or soft-delete plus restore endpoint).
- **Motion tokens**: copy the Vibe durations and easings in §1.5 verbatim as KitStak tokens (they're good defaults). Respect `prefers-reduced-motion` (reduce to opacity-only, 0–70ms).
- **Color tokens**: define light, dark and black sets as CSS custom properties on `:root` / `[data-theme]`; status palette with base/hover/selected per color.
- The CRM objects to pre-wire in wizards are the sandbox schema: Deals (Stage, Owner, Deal Value, Close Probability, Expected Close, Priority, Sales Cycle, Account relation, Contact Email/Phone, Tags, Fit Score, Exec Sponsor, Next Steps, Product Line, Proposal Link, Location, Source), Leads, Contacts, Accounts and Activities as listed in the sandbox info.

## 19. Open verification list (for a signed-in researcher)
1. Exact pixel width and radius of the Create board, Add workspace, Permissions and Confirm modals.
2. Current item-terminology option list and wording.
3. Current board "..." menu order (2026 build) and which items moved into "Board settings".
4. Automations: legacy sentence builder vs new Workflow canvas for this account; recipe category names.
5. Import wizard: list of sources, max file size, whether there's a downloadable error report.
6. Toast position and autohide duration, and whether hover pauses it.
7. Theme names in the avatar menu and the profile tab list.
8. Focus-visible ring exact values.
