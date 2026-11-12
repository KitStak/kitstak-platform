# Logiwa iO Reference Spec: 02 Fulfillment Operations

Captured 2026-11-05 from the my.logiwa.com sandbox. Scope was warehouse **MLT1 - Test Warehouse** (client **MLTest**). Team 1 Supplier Service data appears in shared grids and is used here only to show realistic values. Nothing was modified for Team 1.

Records created during capture: wave rule **"KS-TEST MLT1 Picking Rule"** (MLT1, Picking, unscheduled, Job Pool). No other records were saved.

Not exercised (they change live state): running a wave, executing or cancelling a task, assigning a user, updating priority, printing or creating labels, completing a pack, starting a return. Their dialogs were opened and closed where possible.

---

## 0. Shared UI conventions (apply to every grid below)

Stack observed: Angular, Kendo UI grid (`.k-grid`), Kendo dropdowns, ant-design modals, CDK overlay drawers.

### Page header
- Breadcrumb, for example `Home > Orders > Jobs > Job Management`.
- Page title (H1) with a short centered helper line beside it, for example "From this section, you can create new jobs or manage created jobs."
- The primary CTA sits top-right as a solid indigo button, for example "Create a New Wave Rule" or "Create New Job Type".
- Section tabs appear under the title as uppercase underlined links. The active tab is indigo and underlined. Each tab is a real route.

### Grid toolbar (left to right)
1. **Search-mode toggle** (list icon + caret). It opens a "Search Content" popover with radio buttons **Equal** (default) and **Starts With**, plus an **Apply** button.
2. **Search box** with a page-specific placeholder ("Search by code", "Search by wave no", "Search by order code", "Search by name", "Search by count code") and a magnifier button.
3. **Filter ▾** button. It opens the "Select Filter Type" panel:
   - Segmented control: **New** / **Saved**.
   - "Search Filter" input.
   - Scrollable list of filterable fields. Each row has a bookmark icon (pin/save) and a **+**.
   - Clicking a field drills into an operator view with a back chevron, then an **Add Filter** button.
   - Field types:
     - **Enum**: checkbox list of values, for example Job Status = Cancelled / Completed / Pending / Started.
     - **Text**: operator "equals" and a text input.
     - **Numeric range**: min "-" max, as two numeric spinners.
     - **Date**: preset dropdown plus From/To date-time pickers plus an "X day" numeric input. Presets: Custom, Today, Last 3 days, Last 7 days, Last 30 days, Last 90 days, Last 12 months, X Day(s) Ahead and More, X Day(s) Before and More, Within X Day(s) Past, Within X Next Day(s), Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday.
4. **Active filter chips.** When filters exist they show as small 2-line chips (label + value, for example "Job Status / in Pending, Started") with an ×. When several exist they collapse into a "+N" pill that opens a popover listing the chips.
5. **Save filter (bookmark icon)**. Saves the current filter set as a "Saved" view. The Saved tab includes "Create New".
6. **Clear filters (funnel icon).**
7. Right side: bulk-action buttons and dropdowns. They are disabled until at least one row is selected.
8. **Refresh** icon button at the far right.

### Grid body
- Checkbox column with select-all in the header. The header checkbox shows an indeterminate "–" for partial selection.
- Sortable headers show a sort arrow (for example "↑" plus the screen-reader text "SORTED ASCENDING").
- Some headers carry a "?" tooltip icon, for example "ORIGINAL IO JOB TYPE ?".
- Column resizer. Horizontal scroll for wide grids. Sticky header.
- A **gear icon** at the right of the header row opens the Kendo **Columns** chooser: a checkbox per column plus Apply/Reset. Every column is visible by default on Job Management (32 columns).
- Text truncates with an ellipsis, for example "Team 1 Supplier ...".
- Link-style cells use indigo semibold text, for example Job Code and Wave Rule Name.
- The row "..." menu (three dots, last column) is standard on config grids: **Show Details / Edit / Change Log / Delete**.

### Footer
- Left: density toggle **Large | Small**, then "Show 100 items ▾" page size.
- Center: pager `|< < [1 / N] > >|`.
- Right: **Export As Excel** (green outline button with an xls icon), then "Total: N", then "Selected: N" when rows are selected.

### URL state
Filters, sort and paging are serialized into query params. Example: `?wjst=%5B1%2C2%5D&wjstqt=in&wjstlbl=Pending,%20Started&sf=aiJobTypeDescription&sd=asc&p=1&ps=100`.
- `wjst` = job status ids.
- `qt` = operator.
- `lbl` = chip label.
- `sf` / `sd` = sort field and direction.
- `p` / `ps` = page and page size.

Deep links use the same scheme. For example, a job code link opens `task-details/order-operations/list?wjc=Job6044624&wjcqt=eq&ps=100` in a new tab.

### Status pill colors (computed)
| Pill | Background | Text |
|---|---|---|
| Pending (job/task) | `rgb(227,230,232)` light gray | `rgb(80,87,92)` |
| Started | `rgb(213,229,242)` light blue | `rgb(13,54,163)` dark blue |
| Priority High | `rgba(229,97,86,.24)` pale red | `rgb(229,97,86)` red, with an up-arrow icon "↑ High" |
| Scheduled Yes / No (wave rules) | green tint / gray | — |

Completed and Cancelled pills exist but were not seen in the filtered views.

### Change Log drawer
Right-side drawer titled "<Entity> Change Log". Grid columns: TYPE (icon + Create/Update), MESSAGE, OPERATION DATE, SOURCE (user email). Paging footer.

Message format: `<Entity name> -> <Field key> is modified. <old> --> <new>`. Example: `Order Merge Default -> Logiwa.NameKey.RunCount is modified. 0 --> 1`, or "Wave Rule is created."

### Create/Edit drawers
- Right-side full-height drawer, about 40% of the width, with an × close.
- Title "Create X" / "Edit X" with an operation-type pill below it (for example "Picking").
- Stepper tabs "1.General / 2.Selection / ..." Completed steps are white, the active step is solid indigo, future steps are gray.
- Sticky footer: **Cancel | Next**, then **Back | Next**, and **Back | Save** on the last step.
- Validation: on Next with missing required fields, the fields get a red border. No toast appears.
- The first step of "Create" is always an **Operation Type** chooser drawer: stacked large cards, each with a title and a gray description.

---

## 1. Job Management — `/en/wms/job/management`

- Title: **Jobs**. Browser title: "Jobs - Logiwa".
- Breadcrumb: Home > Orders > Jobs > Job Management.
- Helper text: "From this section, you can create new jobs or manage created jobs."
- Section tabs (shared by the job module): **WAVE RULES** (`/job/wave-rules`), **JOB MANAGEMENT**, **ALLOCATION EXCEPTIONS** (`/job/allocation-exceptions`), **WAVE LOG REPORT** (`/job/wave-log`), **SHORTAGE REPORT** (`/report/shortage`).
- No "create job" button exists on this page. Jobs are created by wave rules (scheduled or manual Run) or by manual allocation from Orders.

### Toolbar
- Search "Search by code", with Equal or Starts With mode.
- Default filter chip: **Job Status in Pending, Started**.
- Bulk actions. All are disabled until a row is selected.
  - **Update Priority** (button).
  - **Cancel** (button). Cancels the selected jobs.
  - **User Actions ▾**: **Assign**, **Unassign**. Unassign is disabled when the selected jobs have no assignee.
  - **Label ▾**: **Create Label**, **Reprint Label**, **Void Label**.
  - **Print ▾** (printer icon): **Print Job Pick List**, **Print Job Content**, **Print Pick Short Consolidation** (disabled unless pick-short exists), **Mobile Cart Layout** (disabled unless a cart is used), **Print Packing List**.
  - **Refresh**.

### Filter fields
Actual Finish Date, Actual Start Date, AI Job, Assignee, Client, Code, Create Date, Created By User, Executed By User, Job Status, Job Type, Mobile Cart, No. of Pending Packing Tasks, No. of Pending Picking Tasks, Number of Completed Tasks, Number of Count Locations, Number of Count Product, Number of Pending Tasks, Number of Tasks, Operation Type, Order Count, Picking Assignment Status, Planned Finish Date, Planned Start Date, PrecartonizationJob, Priority, Product Count, Resolution Job, Warehouse, Wave No, Wave Rule Name.

Job Status values: **Cancelled, Completed, Pending, Started**.

### Columns
All 32 are visible by default. Sortable where an arrow appears; most columns are sortable.

WAREHOUSE, CLIENT ("Multiple" when the job spans clients), WAVE NO, RULE NAME, JOB CODE (link + badges area), JOB TYPE, ORIGINAL IO JOB TYPE (? tooltip; AI job origin), STATUS (pill), PRIORITY (pill), OPERATION TYPE (Picking / Count / Replenishment / Work Order), ASSIGNEE, ORDER COUNT, PRODUCT COUNT, NUMBER OF TASKS, PENDING TASKS, COMPLETED TASKS, ACTUAL START DATE, ACTUAL FINISH DATE, CREATED DATE, CREATED BY USER, PENDING PICKING TASKS, PENDING PACKING TASKS, MOBILE CART, PICKING ZONE, START DATE (planned), END DATE (planned), NUMBER OF LOCATIONS, NUMBER OF SKUS, LABEL STATUS ("No Label"), PICK LIST STATUS ("Not Printed"), RESOLUTION JOB (true/false), PRE-CARTONIZATION JOB (true/false).

### Sample rows
| Warehouse | Client | Wave | Rule | Job code | Job type | Status | Priority | Op | Order cnt | Product cnt | Tasks | Created | Planned start / end |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MLT1 - Test Warehouse | MLTest | – | – | Job6073219 | MLT1 D2C Picking | Pending | – | Picking | 1 | 1 | 1 | 10/20/2026 11:29:45 AM | 12:29:45 PM / 1:29:45 PM |
| Team 1 | Multiple | 20522-16 | Priority Shipping | Job6006572 | Multi Item Orders | Pending | High | Picking | 10 | 6 | 24 | 10/12/2026 3:38 PM | … |
| Team 1 | testclient | – | – | Job5969094 | Cycle Count | Pending | – | Count | – | 0 | 4 | 10/8/2026 | locations 1, SKUs 4 |
| Team 1 | testclient | 20056-1 | Dynamic Replenishment | Job5904213 | Dynamic Replenishment | Pending | – | Replenishment | | | 1 | 10/1/2026 | |
| Team 1 | testclient | – | – | Job5881193 | Instant Count | **Started** | – | Count | assignee "Team 1 Supplier Admin" | 3 tasks, 3 completed | | | |

Planned Start = Created + 1h and Planned End = Created + 2h. This looks like the default SLA.

### Row and click behavior
- Clicking **Job Code** opens Task Details in a new tab, filtered to that job: `/en/wms/task-details/order-operations/list?wjc=<code>&wjcqt=eq`. Count jobs most likely route to the count tab (unverified).
- There is no row "..." menu on this grid.

### Modals

**Update Priority** (ant modal)
- Orange "! Attention" header.
- Text: "Previously assigned/selected priorities will change after your new priority selection."
- Prompt: "Set priority for selected jobs."
- Single-select checkbox cards: **None / Low / Medium / High**.
- Buttons: **Cancel**, **Save** (disabled until a choice is made).

**Assign User**
- Text: "Assign a user to selected job(s)."
- Field: **User** dropdown, "Search User". It searches asynchronously and needs at least 3 characters: "You have to enter at least 3 characters to search."
- Button: **Assign** (disabled until a user is chosen).
- Guard: if the selected jobs span warehouses, an "Attention — Different Warehouses Selected" dialog appears instead: "Assign and unassign can only be performed for jobs in the same warehouse. Please update your selection and try again." It has an [OK] button.

---

## 2. Wave Rules — `/en/wms/job/wave-rules`

- Title: **Job Wave Rules**. Helper text: "You can create wave rules".
- CTA: **Create a New Wave Rule**.
- Toolbar: search "Search by name", Filter, and a **Run** button (bulk; runs the selected rule(s) immediately and creates a wave). Run was not executed during capture.

### Columns
(checkbox), WAVE RULE NAME (link → opens the Edit drawer), WAREHOUSE, SCHEDULED (Yes = green pill, No = gray pill), STATUS (Pending pill), PRIORITY (pill), ASSIGNEE, OPERATION TYPE, LAST EXECUTED BY ("Auto Run" when the scheduler ran it), LAST RUN (datetime), LAST WAVE ID (for example 20522-94), NEXT RUN (live countdown `HH:MM:SS`, or `DDDD:HH:MM:SS`, for example "1106:17:42:20"), and a "..." menu.

Sortable columns: name, warehouse, scheduled, status, assignee, operation type, last run.

Row menu: **Show Details** (same as Edit), **Edit**, **Change Log**, **Delete**.

### Sample rows
| Rule | Scheduled | Priority | Assignee | Op type | Last executed by | Last run | Last wave | Next run |
|---|---|---|---|---|---|---|---|---|
| Order Merge Default | No | | | Order Merge | Team 1 Supplier Admin | 10/12/2026 3:24 PM | 20536-1 | |
| Priority Shipping Bulletpoint | Yes | High | | Picking | Auto Run | 11/5/2026 1:00 PM | 20522-94 | 15:21:23 |
| Dynamic Replenishment | No | | | Replenishment | Bryan King | 10/8/2026 | 20056-6 | |
| 6 month Cycle Count Wave | Yes | | Team 1 Supplier Admin | Count | | | | 1106:17:42:20 |
| KS-TEST MLT1 Picking Rule (created) | No | | | Picking | | | | |

Wave numbers have the form `<ruleId>-<runCount>`, for example 20522-94 is the 94th run of rule 20522.

### Create wizard

**Step 0 — Operation Type** (card chooser)
- **AI Job**: "Create an AI Wave and set up rules for job creation. The jobs created by AI Wave will be optimized by AI."
- **Picking**: "Set-up rules for picking jobs".
- **Cycle Count**: "Set-up rules for count jobs".
- **Replenishment**: "Set-up rules for replenishment jobs".
- **Order Merge**: "Set up rules for merging orders based on configured criteria."

**Picking / AI Job wizard:** 1.General → 2.Selection → 3.Schedule → 4.Assign. The header pill shows the op type.

**1. General**
- **Rule Set Name\*** (text, placeholder "Rule Set Name").
- **Warehouse\*** (dropdown; options are the user's warehouses: MLT1 - Test Warehouse, Team 1 Supplier Service).
- **Priority & Delete Options** (collapsible accordion, chevron):
  - **Priority**: "Choose a Priority Tag for all jobs in this wave." Segmented control **None** (default) / High / Medium / Low.
  - **Delete Options**: "Automate deletion of pending jobs based on a set frequency."
    - **Delete The Jobs If Not Started**: Yes / **No** (default).
    - **Delete Method**: dropdown, default "None"; disabled while No.
    - **Delete Time**: time input "--:-- --".
- **Select Job Types**: "Select at least one job type".
  - Before a warehouse is chosen: "Fill in the information above to list job types."
  - Afterwards: an ordered, numbered list (1., 2., …) of the warehouse's job types for this op type, each with a checkbox and a drag handle (≡) for priority order. The order is the precedence in which orders are matched to job types.
  - MLT1 shows "1. MLT1 D2C Picking".
  - Team 1 example order: Single Unit Orders, Multi Item Orders, Identical SKU- Single Unit, B2B Order Picking, Identical Kit to Order.
- AI Job on MLT1 shows an empty state: "You don't have any job type selected for AI feature for this Warehouse. Please go to the Add On screen."
- Validation: Next with nothing filled gives a red border on Name, Warehouse and the job type section.

**2. Selection**
- **Filters**: "Add Filter +" opens the field list, then the operator editor, then "Add Filter". Added filters render as chips such as "Order Quantity 1 - 10 ×" and "Order Type D2C Order ×". Empty state: "No filters have been added yet."
  - Filter fields: Carrier, Carrier Rate, City, Client, Country, Expected Shipment Date, Fraud, Is Back Order, Is Gift, Is Oversized, Is Partial, Number of Boxes, Order Price, Order Quantity, Order Tag, Order Type, Planned Shipment Date, Precartonization Type, Priority, Product Group, Product PackType, Retailer, Shipment Method, Shipment Order Date, Shipment Package, Sku, SO Custom Field DateTime 1-2, SO Custom Field DropDown 1-2, SO Custom Field TextBox 1-3, SO Custom Field Toggle 1-2, Store.
  - Numeric fields (Order Quantity and others) use min - max spinners.
  - Enum fields use a searchable checkbox list. Order Type values: Empty, B2B Order, BackOrder D2C, D2C Order, Partial Allocation D2C.
- **Order By** (order release sort): "Search and select order by method" dropdown + **Add** button, producing an ordered list. Empty state: "No order by method have been added yet."
  - Options: Shipment Order Date, Expected Shipment Date, Carrier Rate, Note, ExtraNote1, ExtraNote2, Priority, CustomFieldDateTime1-3, CustomFieldToggle1-2, CustomFieldDropDown1-2, CustomFieldTextBox1-3.

**3. Schedule**
- **Days**: "Select the days you would like to schedule for this ruleset to run". Toggle chips Monday through Sunday. Inactive chips are gray with "+". Active chips are green with "×".
- **Time**: "Select the times you would like this ruleset to run on scheduled days."
  - Counter "0 Daily Frequency".
  - **Remove** (disabled until a row is selected) and **Set Time** buttons. Set Time is active once a day is chosen.
  - Grid: NO / START TIME. Empty state: "No repeat time has been selected yet."
  - **Set Time popover** has 2 tabs:
    - **Set Specific Time**: "Enter the specific time at which the job will repeat" + time picker + **Set**.
    - **Set Time Period**: "Repeat every [n]" + **From** / **To** time + **Set**. This generates many start times.
- Validation: with a day selected and no time, Next is blocked. With no days, the rule is unscheduled and Scheduled shows "No".

**4. Assign** (radio cards)
- **Add to Job Pool** (default): "Any user can execute the created jobs from the pool".
- **Assign to User Roles**: "The users with the selected role can execute the jobs". Shows a grid with a filter: ROLE NAME, USER TYPE, ASIGNEED [sic], and an Assigned/Unassigned toggle per row. Example roles: Client (Client), Warehouse Clerk (Operation), Supervisor (Operation).
- **Assign to Users**: "Only assigned user can execute the created jobs". Grid: NAME, EMAIL, ROLE, USERTYPE, ASSIGNED toggle (21 users; user types Operation / Owner; roles Warehouse Clerk / Supervisor).
- Footer: Back | **Save**. Save closes the drawer and the grid refreshes with the new row, status Pending. No toast appeared.

**Cycle Count wizard** (pill "Count"): 1.General → 2.Selection → 3.Schedule → 4.Assign.
- General: Rule Set Name\*, Warehouse\*, **Count Type** (Select Count Type: **Location** / **SKU**), **Lock Locations** Yes/No, Select Job Types.
- MLT1 empty state: "You don't have any job type. You must create a job type."

**Replenishment wizard:** 1.General → 2.Selection → 3.Schedule → 4.Assign.
- General: Rule Set Name\*, Warehouse\*, **Enable Soft Allocation for Dynamic Replenishment** Yes/No, Select Job Types.

**Order Merge wizard:** 1.General → 2.Selection → 3.Schedule (no Assign step).
- General: Rule Set Name\*, Warehouse\*, **Order Merge Rules**: "Select at least one rule. Drag and reorder the execution sequence." MLT1 empty state: "No order merge rules found for the selected warehouse."

**Edit** uses the same drawer titled "Edit Wave Rule" with values prefilled.

---

## 3. Allocation Exceptions — `/en/wms/job/allocation-exceptions`

- Browser title "Wave Order Details - Logiwa". Page title **Allocation Exceptions**.
- Read-only log of why orders were not allocated or put into jobs during a wave or manual allocation.
- Search: "Search by wave no".
- Filters: Client, Explanation (text "equals"), Order Number, Run By User, Run Date (date presets), Warehouse, Wave Ruleset Name, WaveNo.

### Columns
ORDER CODE, WAVE NO ("Manual Allocation", "Manual Allocation - Work Order", or a wave id such as 20522-17), WAVE RULE SET NAME, ALLOCATION ALGORITHM RULE NAME (for example "Default"), SHORTAGE SKU, INVENTORY UOM QTY, ORDER LINE QTY (UOM), ALLOCATION ALGORITHM (for example "D2C Default"), EXPLANATION, IS ROLLBACKED? (false/true), RUN BY USER, RUN DATE, CLIENT, WAREHOUSE.

Total 76 rows. Footer has Export As Excel.

### Explanation values seen
- `Shortage` (SKU-level; with SHORTAGE SKU, inventory 0 vs line qty, for example 0 vs 400)
- `Eliminated by 'Multi Item' Condition(s)`
- `Eliminated by 'Single Item' Condition(s)` (MLT1 example: SO0000, Manual Allocation, Mike Lunsford, 10/16/2026)
- `Eliminated by Job Type 'Advanced' Condition(s)`
- `Order bypassed: All items are currently out of stock`

Logic: for each order, the engine evaluates job types in priority order. If no job type's conditions match, the row records which condition eliminated it. If stock is short, a Shortage row is written per SKU.

---

## 4. Wave Log Report — `/en/wms/job/wave-log`

- Browser title "Wave Log - Logiwa". Search: "Search by wave no".
- Filters: Rule Set, Run Date, Status, Warehouse, WaveNo.
- Wave Status values: **Completed, Failed, In Progress, Optimization Completed, Optimizing, Pending, Preparing For Optimization, Started**. The Optimiz\* values apply to AI waves.

### Columns
RULE SET, WAVE NO, WAVE STATUS, # OF ORDERS MET RULE SET CRITERIA, # OF SHORTAGE ORDERS, # OF JOBS CREATED, # OF ALLOCATED ORDERS, # OF MERGED ORDERS CREATED, RUN DATE, RUN BY ("Integration" for scheduled runs, or a user name), MESSAGE.

Total 101 rows across 2 pages.

### Sample rows
- Priority Shipping | 20522-17 | Completed | 35 | 20 | 3 | 15 | 0 | 10/12/2026 3:43 PM | Team 1 Supplier Admin
- Priority Shipping | 20522-16 | Pending | 27 | 18 | 1 | 9 | 0
- Order Merge Default | 20536-1 | Completed | 257 | 0 | 0 | 0 | 8
- Priority Shipping Bulletpoint | 20522-94 | Completed | 0 | 0 | 0 | 0 | 0 | Integration (scheduled runs at 7:00 AM and 1:00 PM daily)

---

## 5. Shortage Report — `/en/wms/report/shortage`

- Browser title "Shortage Report - Logiwa". Reached from the job module tabs. Search: "Search by order code".
- Filters: Client, Expected Shipment Date, Missing Triggered, On Hand Pack Quantity, Order Code, Order Date, Product SKU, Shortage Pack Quantity, Shortage Reason, Status, Store Order Number, Warehouse.

### Columns (25)
ORDER CODE, STORE ORDER NAME, SKU, PRODUCT NAME, ORDER CREATION DATE, ORDER TYPE, SHORTAGE REASON, MISSING TRIGGERED (Yes/No), ORDER STATUS, ORDER LINE PACK QTY, LINE PACK TYPE, SHORTAGE PACK QTY, SHORTAGE UOM QTY, FREE PACK QTY, FREE UOM QTY, DAMAGED PACK QTY, DAMAGED UOM QTY, ON HAND PACK QTY, ON HAND UOM QTY, LAST ALLOCATION TRIAL TIME, WAREHOUSE, CLIENT, ORDER AGE (days), EXPECTED SHIPMENT DATE, MASTER ORDER CODE (for split or backorders, for example BACKORDER1EX_1 → BACKORDER1EX).

Total 358 rows.

Value sets:
- Shortage reasons: **Insufficient Inventory**, **No Eligible Stock Found** (stock exists but is ineligible; for example free 412, damaged 402, on hand 0 in eligible locations).
- Order statuses: Shortage, Partially Shipped.
- Order types: D2C Order, Partial Allocation D2C, BackOrder D2C.

---

## 6. Job Types — `/en/wms/job/types`

- Title **Job Types**. Helper text "Create and list job types using this screen".
- CTA **Create New Job Type**. Search "Search by code".

### Columns
CODE (link), DESCRIPTION, WAREHOUSE, ALLOCATION ALGORITHM, OPERATION TYPE, and a "..." menu (Show Details / Edit / Change Log / Delete).

Total 11. Rows:

| Code | Description | Warehouse | Alloc algorithm | Op type |
|---|---|---|---|---|
| MLT1 D2C Picking | Test picking job type for MLT1 | MLT1 | Default | Picking |
| Work Order Picking | Work Order Picking - Kit to stock produce flow | Team 1 | D2C Default | Work Order |
| Static Replenishment / Dynamic Replenishment | (Dynamic: "with Pick and Put Phases") | Team 1 | – | Replenishment |
| Instant Count / Cycle Count | | Team 1 | – | Count |
| Identical Kit to Order | Batch picking and packing | Team 1 | D2C Default | Picking |
| B2B Order Picking | | Team 1 | B2B Default | Picking |
| Multi Item Orders | with Pick and Sort by Tote | Team 1 | D2C Default | Picking |
| Single Unit Orders / Identical SKU- Single Unit | | Team 1 | D2C Default | Picking |

### Create wizard
Step 0, Operation Type cards:
- **Picking**: "Assign settings for your picking jobs".
- **Count**: "Assign settings for your count jobs".
- **Replenishment**: "Assign settings for your replenishment jobs".
- **Work Orders**: "Assign settings for your work orders".

**Picking job type**: 1.General → 2.Templates → 3.Settings → 4.Conditions → 5.Grouping. Edit mode has no Templates step.

1. **General**
   - Job Type Name\* ("Enter job type name").
   - Warehouse\*.
   - Operation Type\* (locked to Picking).
   - Allocation Algorithm\* (disabled until a warehouse is chosen; auto-selects "Default" for MLT1; options are per-warehouse algorithms such as D2C Default and B2B Default).
   - Description\* ("Enter your description").
2. **Templates** (radio cards):
   - **Custom** (default) — "Proceed without using a template."
   - Single Item Order
   - Multi-Item Orders
   - Identical Item Orders
   - Pre-Cartonization (NEW badge)
   - Single SKU Cluster Pick
   - Putwall Process
   - Retailer Compliance (BETA badge)
   - Identical Kit to Order (NEW badge)

   Each template has the description "The settings for the … template will be used."
3. **Settings**
   - Order-scope radio cards: **All Orders** (default) / Identical Item Orders / Single Item Orders / Multi-Item Orders / Identical Kit to Order.
   - Retailer Flow Type (dropdown, default None, disabled).
   - UCC Label Scanning Type (dropdown, disabled).
   - Default Retailer Label Print Option (ⓘ).
   - Yes/No segmented toggles. Red **No** is the active "off" state; green **Yes** is the active "on" state.
     - Override For Last Job (default **Yes**)
     - Only Pick (No)
     - Only Pack (No)
     - Create Loading Task (No)
     - Disable Full LP Picking (No)
     - Auto Complete Picking Tasks (No)
     - Create Sorting Task (No)
     - One By One Sorting (disabled unless sorting is on)
     - Disable Tote Scanning (ⓘ, disabled)
     - Enable Picker Self-Assign (ⓘ)
   - **Batch Size**: Limitation Method dropdown (**Nof Order** / **Nof Item**) + Min + Max numeric fields.
   - **Select Mobile Screen Type**: "Select the mobile screen(s) that will use this job type". Rows: Pick and Sort [Use / Don't Use], Pick to Location [Use / Don't Use].
4. **Conditions**
   - **Add Condition** uses the same field list as wave rule filters (Carrier … Store).
   - **Order By**: "Order by Picking Method\*" dropdown + Add, producing a draggable ordered list. The default row is "1 Walking Path Priority [Ascending | Descending]".
   - Picking-method options: Sku, Item Weight, Item Volume, Location Aisle, Location Column, Location Position, Location Level, Location Rack, Product Custom Field Text Box 1-3 / DropDown 1-2 / Toggle 1-2 / DateTime 1-3, Location Custom Field Text Box 1-3 / DropDown 1-2 / Toggle 1-2 / DateTime 1-3.
5. **Grouping**
   - Group By: "Select a picking method group". Options were not captured; most likely the same location/product attributes. Then Save.

**Count job type**: 1.General → 2.Settings → 3.Loc. Conditions → 4.SKU Conditions.
- General: Name\*, Warehouse\*, Operation Type\* (Count), Allocation Algorithm (optional), Description\*.
- Settings (Yes/No): One by One Count, Auto-Update No-Difference Count Lines, Instant Count, Lock Location for Instant Count, Auto fill Tracking Attributes.
- Loc. Conditions: "The following conditions apply only to location count plans. Location count conditions cannot be combined with SKU count conditions within the same count plan." Then Location Count Conditions + Add Conditions, and Order By "Order by Count Method".
- SKU Conditions: equivalent text for SKU count plans, SKU Count Conditions + Add Conditions, then Save.

**Replenishment job type**: 1.General → 2.Settings → 3.Conditions.
- General: Name\*, Warehouse\*, **Replenishment Algorithm Method** (default **FEFO**), Description\*.
- Settings (Yes/No): Allow Exceed Task Quantity, Update Task Quantity If Less Picked, **Replenishment Flow** (Pick & Put / Direct Put), Pick Full Pack, Zone Based Replenishment, Allow Higher Pack Type-UOM Conversion, Location Group Based Replenishment, Only Pick Full LP, Allow Scanning Another Put Location, Allow Suggest Another, Enable LP Swap, **Replenishment Type** (Dynamic / Static).
  - Help text: "The algorithm (REPLENISHMENT_ALGORITHM) selected on the 'Putaway Algorithms' page will be used for dynamic replenishment".
- Conditions: a first filter section whose label was not captured (likely Destination Location Conditions), then Source Location Conditions, LP Conditions, Product Conditions. Each has its own "Add Filter".

**Work Order job type**: 1.General → 2.Settings → 3.Conditions.
- General: Name\*, Warehouse\*, Operation Type\* (Work Order), Allocation Algorithm\*, Description\*.
- Settings: one Yes/No toggle whose label was not captured; **Picking & Kitting** Yes/No; Limitation Method (Nof Order) + Min/Max; Mobile Screen Type → Pick to Location Yes/No.
- Conditions: filters.

---

## 7. Task Details — `/en/wms/task-details/{order-operations|count|replenishment}/list`

- Browser title "Task Details - Logiwa". Breadcrumb Home > Fulfillment > Task Details > Order Operations.
- Info banner: "The Task Details Report summarizes orders' or jobs' current details. This report helps you to monitor tasks, users, and orders in real time. Click here to learn more."
- Tabs: **ORDER OPERATIONS**, **COUNT**, **REPLENISHMENT**.
- Default filter on every tab: Job Status in Pending, Started.

### 7a. Order Operations tab
- Search "Search by order code".
- Toolbar dropdowns (disabled until a row is selected):
  - **Task Operations ▾**: **Execute**, **Update**, **Cancel**.
  - **User Actions ▾**: **Assign**, **Unassign**.
  - Also a Back/Next pager pair and Export as Excel.

**Columns (67):** WAREHOUSE, CLIENT, WAVE ID, TASK ID, JOB CODE, JOB TYPE, AI JOB DESCRIPTION, ORDER CODE, PO NUMBER, STORE ORDER NUMBER, ORDER TYPE, TASK TYPE, TASK STATUS, PICK SHORT STATUS, PACK SHORT STATUS, TASK PRIORITY, AI TASK SEQUENCE, WORK ORDER CODE, WORK ORDER TYPE, PRODUCT IMAGE, SKU, PRODUCT NAME, BARCODE, SUGGESTED SHIPMENT PACKAGE TYPE, TARGET LP TYPE, PACK TYPE, TO PACK TYPE, UOM PACK TYPE, TASK UOM QTY, ACTUAL QTY, PLANNED QTY, SOURCE LOCATION ZONE, SOURCE LOCATION, SOURCE LOCATION DISPLAY MEMBER, SOURCE LPN, TARGET LOCATION ZONE, TARGET CART, TARGET LOCATION, TARGET LOCATION DISPLAY MEMBER, TARGET LPN, ASSIGNEE, EXECUTED BY USER, PLANNED START DATE, START DATE, PLANNED FINISH DATE, FINISH DATE, TASK CREATED DATE, CREATED BY USER, LOT/BATCH NUMBER, EXPIRY DATE, DAMAGE REASON, ORDER DATE, CHANNEL, CARRIER, CUSTOMER, CUSTOMER ADDRESS, UPDATED BY USER, SOURCE PARENT LP, FROM ORIGINAL PARENT LP, SOURCE PARENT LP TYPE, TARGET PARENT LP, FROM ORIGINAL LP, TARGET PARENT LP TYPE, TO ORIGINAL PARENT LP, TO ORIGINAL LP, RECEIVING DATE, PRODUCTION DATE.

**Filters (49):** Actual Finish Date, Actual Quantity (in Primary UOM), Actual Start Date, Assignee, Barcode, Client, Created By User, Executed By User, Expiry Date, From LP Number, From Parent LP Number, From Parent LP Type, Job Code, Job Status, Job Type, Lot Batch Number, Order Date, Order Type, Pack Short Status, Pick Short Status, Planned Finish Date, Planned Quantity (in Primary UOM), Planned Quantity (in Secondary Pack Type), Planned Start Date, Product Name, Purchase Order Number, SKU, SO Code, Source Location, Source Location Display Member, Source Location Zone, Store Order Number, Target Cart, Target Location, Target Location Display Member, Target Location Zone, Task Created Date, Task Status, Task Type, To LP Number, To Parent LP Number, To Parent LP Type, Warehouse, Wave No, Work Order Code, Work Order Type.

**Enums:**
- Task Status: Cancelled / Completed / Pending / Started.
- Task Type: Count / Kitting / Loading / Packing / Picking / Replenishment / Sorting.
- Pick Short Status and Pack Short Status: None / Open / Resolved.
- Work Order Type: Work Order with Picking / Work Order without Picking.

**MLT1 sample rows:**
- Task 215548484 | Job6073219 | MLT1 D2C Picking | order MLT-B2B-001 | B2B Order | Picking | Pending | short None/None | SKU MLT-WIDGET-01 "MLTest Widget" barcode MLT000001 | Each | qty 2 | source MLT1-A-01 | customer "MLT Retail Test".
- Task 214268367 | Job6044624 | SO0000 | D2C Order | qty 2 | MLT1-A-01 | customer "MLT Customer", address "2908 SE I St Ste 2 Bentonville".

The Planned Finish Date is Planned Start + 1 minute per task.

**Modals:**
- **Update Task**: "Task ID 215548484". Fields: **Target Location** ("Select inventory location"), **To LPN** ("Select inventory LP"), **Job Code** ("Search Job Code", which moves the task to another job). Buttons: Cancel / Save.
- **Execute Task**: "Task ID(s) 215548484". Fields: **Target Location\*** ("Select target location"), **Target LPN** ("Select target LPN"). Buttons: Cancel / Execute. This is a supervisor force-complete from the desktop, without the handheld.
- **Cancel**: cancels the selected tasks. The confirmation dialog was not opened.

### 7b. Count tab
- Search "Search by count code". No bulk actions; Create New appears only for saved filters.
- **Columns (48):** WAREHOUSE, CLIENT, TASK ID, JOB CODE, JOB TYPE, PO NUMBER, COUNT PLAN, TASK TYPE, TASK STATUS, PRODUCT IMAGE, SKU, PRODUCT NAME, BARCODE, PACK TYPE, TO PACK TYPE, UOM PACK TYPE, INITIAL TASK PACK QTY, INITIAL TASK UOM QTY, INITIAL TASK APPROVED PACK QTY, APPROVED TASK UOM QTY, APPROVED PACK QTY, APPROVED TASK PACK QTY, SOURCE LOCATION ZONE, SOURCE LOCATION, SOURCE LOCATION DISPLAY MEMBER, SOURCE LPN, TARGET LOCATION, TARGET LPN, ASSIGNEE, EXECUTED BY USER, PLANNED START DATE, START DATE, PLANNED FINISH DATE, FINISH DATE, TASK CREATED DATE, CREATED BY USER, LOT/BATCH NUMBER, EXPIRY DATE, DAMAGE REASON (for example "Bad Packaging"), UPDATED BY USER, SOURCE PARENT LP, TO ORIGINAL PARENT LP, TO ORIGINAL LP, FROM ORIGINAL PARENT LP, FROM ORIGINAL LP, SOURCE PARENT LP TYPE, RECEIVING DATE, PRODUCTION DATE.
- Additional filters: Approved Pack Quantity, Count Plan Code, Initial Approved Pack Quantity, Initial Task Pack Quantity, Initial Task UOM Quantity, Task Pack Quantity, Task UOM Quantity.
- Sample: Job5969094, count plan "test 2", SKU3 Unit, initial 200, location b-1-4, lot 1391912. A Case-pack line shows pack qty 10 and UOM qty 100.

### 7c. Replenishment tab
- Search "Search by code". Toolbar button: **Cancel Task**.
- **Columns (50):** WAREHOUSE, CLIENT, WAVE ID, TASK ID, JOB CODE, JOB TYPE, PO NUMBER, TASK TYPE, TASK STATUS, **REPLENISHMENT PHASE** (for example "Replenishment Pick Phase"), **LP SWAP** (Yes/No), PRODUCT IMAGE, SKU, PRODUCT NAME, BARCODE, PACK TYPE, TO PACK TYPE, UOM PACK TYPE, **PACK TYPE CONVERSION APPLIED**, INITIAL TASK QTY, TASK QTY, TASK UOM QTY, SOURCE LOCATION ZONE, SOURCE LOCATION, SOURCE LOCATION DISPLAY MEMBER, SOURCE LPN, TARGET LOCATION ZONE, TARGET CART, TARGET LOCATION, TARGET LOCATION DISPLAY MEMBER, TARGET LPN, **LP AUTO REMOVED**, ASSIGNEE, EXECUTED BY USER, the planned and actual date columns, TASK CREATED DATE, CREATED BY USER, LOT/BATCH NUMBER, EXPIRY DATE, DAMAGE REASON, UPDATED BY USER, SOURCE/TARGET PARENT LP (+TYPE), RECEIVING DATE, PRODUCTION DATE.
- Sample: Job5904213 Dynamic Replenishment, Pick Phase, 100 Unit from b-1-4 to a-1-3.

---

## 8. Work Orders (kitting) — `/en/wms/work-order/list`

- Browser title "Work Orders - Logiwa". Breadcrumb Home > Inventory > Work Order.
- Helper text: "Create and list work orders for kitting process of kit to stock products".
- Header buttons: **Import** (→ `/en/wms/import/workorder/20`) and **Create Work Order**.
- Tab: WORK ORDERS. Search "Search by code".

### Toolbar
- **Disassemble Kit** (button).
- **Create Kit** (button). Disabled until a selection is made; it completes kitting for the selected work order.
- **Warehouse Ops ▾**: **Print Picking List**, **Batch Picking List**, **Picking/Job Operations**, **Cancel Picking**. All are disabled until selection.

### Filters
Client, Code, Created Date, Custom Field Date 1-3, Custom Field Drop Down 1-2, Custom Field Text Box 1-3, Custom Field Toggle 1-2, Job Code, Processed SKU, Requested Quantity, SKU, Tag, Warehouse, Work Order Actual Finish Date, Work Order Actual Start Date, Work Order Cancellation Date, Work Order Planned Finish Date, Work Order Planned Start Date, Work Order Status, Work Order Type.

Enums:
- Status: **Cancelled, Completed, In Process, Open, Shortage**.
- Type: Empty, Work Order with Picking, Work Order without Picking.

### Columns (20)
WORK ORDER CODE, WAREHOUSE, CLIENT, WORK ORDER STATUS (pill), AGE (days), WORK ORDER OPERATION TYPE (Kitting), WORK ORDER TYPE, TAGS, JOB CODE (present for "with Picking"), KIT SKU, REQUESTED KIT QUANTITY, PROCESSED QUANTITY, EXTRA NOTES (truncated), KITTING INSTRUCTIONS, CREATED DATE, PLANNED START DATE, PLANNED FINISH DATE, ACTUAL START DATE, ACTUAL FINISH DATE, CANCELLATION DATE, and a "..." menu (Show Details / Edit / Change Log / Delete).

Total 12.

MLT1 row: **MLT-WO-001** | MLTest | **Open** | age 20 | Kitting | Work Order without Picking | kit SKU MLT-KIT-2PK | requested 5 | processed blank | note "MLTest kitting test, 5 kits of 2" | created 10/16/2026.

Team 1 rows are mostly Completed, for example WO1113 "with Picking" Job6192008, DW-FP-18-6, 10/10.

### Create / Edit Work Order wizard
Drawer. Create starts with an Operation Type chooser with one card: **Kitting** — "Create a work order for kitting operations of kit-to-stock products".

Steps: 1.General → 2.Kit → 3.Advanced → 4.Other Info.

1. **General**
   - Warehouse\* ("Select warehouse").
   - Client\* ("Select client"; filtered by warehouse).
   - Work Order Code\* ("Enter Work Order Code").
   - Work Order Type\* (Work Order with Picking / Work Order without Picking).
   - Extra Note (textarea, "Enter extra note").
   - **Build For**: segmented **Stock** (default) / **SO**. SO reveals "Select Shipment Order".
   - Validation: red borders on the required fields.
2. **Kit**
   - **Select Kit**: "The kit-to-stock product selection for this work order". A searchable kit SKU picker shows a card: SKU, name, Pack Type, and Lot / Exp. Date / Prod. Date tracking flags.
   - Kit quantity numeric field (5).
   - **Components**: "Components of the selected kit-to-stock product". Per component: Component Qty (1) and Total Qty (10, auto = kit qty × component qty), SKU/name, Pack Type, Qty, Location, LP, Lot No, Exp Date, Prod Date. These can be set for "without picking" flows.
3. **Advanced**
   - Kitting Instructions (textarea).
   - Planned Start Date, Planned Finish Date, Actual Start Date, Actual Finish Date (date-time pickers).
   - **Document**: "Upload documents for the kitting process" + Upload Document (file).
4. **Other Info**
   - "You can optionally add or edit custom fields under 'Other Info' tab." + Add/Edit Custom Field, then Save.

### Import page — `/en/wms/import/workorder/20`
- Title "Bulk Import Work Orders".
- Text: "You can import work orders by using an Excel file. Excel file import history will be listed below."
- Links: "Go back to work orders", **Download our excel template**, "Import Work Orders Manual".
- Drop zone: "Drop files here to upload / Drag and drop or browse".
- History grid: STATUS, MASTER ROW COUNT, SUCCESS COUNT, ERROR COUNT, UPLOADED BY, CREATED DATE TIME, ACTIONS. Empty state: "No records to display".

---

## 9. Packing Station — `/en/wms/packing-station` → `/en/wms/packing-station/dashboard`

### Dashboard
- Browser title "Packing Station Dashboard - Logiwa". Breadcrumb Home > Fulfillment > Outbound > Packing Station.
- 3-column layout.
- **Left card**: Warehouse\* (MLT1 - Test Warehouse / Team 1 Supplier Service), **Packing Station\*** (filtered by warehouse; MLT1 has "MLT1-PACK").
- **Center card "Start Packing"**: "Please select one of the buttons below to start packing. You can start with scanning a tote or scanning a location/car or you can simply select an order from the list and start packing depending on your process." Four big buttons:
  - Scan a Tote
  - Scan a Location
  - Scan a Putwall/Mobile Cart
  - List and Select Order
- **Right card**: user avatar (initials), name, role (Supervisor). KPI tiles: Number of Orders You Packed Today (0), Number of Products You Packed Today (0), Total Number of Orders to be Packed (2 for MLT1).
- Hidden or utility buttons in the DOM: "Clear Completed", "Excel Export History", Back/Next.

### Pack screen
URL: `/en/wms/packing-station/details/{mode}/{warehouseGuid}/{stationGuid}/{stationCode}`. Mode 6 = Tote, 1 = Order. Title "Packing Station Pack - Logiwa".

**Left pane**
- Mode tabs: **Tote | Location | Order | Putwall**.
- Scan input, for example "Scan or enter a tote code" / "Scan or enter a order code", with a search button. The Order tab adds a clear icon and **List & Select**.
- Job card: "Scan or Enter Tote Code to Find Job", Job Type, "# of Orders in Tote 0/0".
- "Scan or enter product code" input.
- Order card: "Select Order to Pack", SKU Qty 0/0, Total Qty 0/0.

**Right pane**
- Header: Order Code, "Select Order to Pack".
- **Package Type\*** dropdown, plus Length\* / Width\* / Height\* (0.00).
- Package contents grid: Image, Product, Pack Type, Label, Weight, Quantity, Attributes. Empty state: "Press pack button or scan the code to add products to the package". Footer: Total SKU: 0, Total Quantity: 0.
- Weight inputs **lb** and **oz**, a purple **pack (box) icon button** that adds a package, and **Close Pack**.
- Carrier\*, Shipping Service\* (cascading), "Selected Shipping Option / Rate" (No Rate) + **Get Rate**, **Label** ("No Pre-generated Label Uploaded" + upload icon).
- Sticky footer:
  - **Other Actions ▴** (popup menu with item and description):
    - **Report Issue** — "Transfer products from this order to a hospital location."
    - **Print Actions** — "Lists the documents related to the order".
    - **Pack Without Label** — "Completes the packing tasks without printing label".
  - **Complete Packing And Create Label** (primary; disabled until packed).
- All right-pane controls are disabled until an order is loaded.

**List & Select modal** ("Search & Select Order")
- "You can search and select the order that will be packed from the list and click Start Packing button. You can also use the filters to minimize the list of orders."
- Search "Search by order code"; Filter fields: Client, Expected Shipment Date, Job Code, Note, SO Code.
- **Start Packing** button. Empty state "There are no ready to pack orders". Footer "Total : 0".

**Error example**: scanning SO0000 (picking not complete) shows a red toast "Error — No allocated order found. Please transfer the products to another location."

Flow (inferred): pick complete → tote or cart arrives → scan tote/location/cart/order → system loads the order → scan each product (qty increments, label per line) → choose package type (dims auto-fill) → enter weight → Close Pack (multi-box supported) → choose carrier and service → Get Rate → Complete Packing And Create Label (prints label, sets order Packed/Shipped).

---

## 10. Return Station — `/en/wms/return-station/dashboard`

- Browser title "Return Station Dashboard - Logiwa". Breadcrumb Home > Return Station.
- **Left card**:
  - **Receiving Warehouse** (defaults to MLT1 - Test Warehouse).
  - **Return Station** (searchable async location picker with a barcode-scan icon: "Type to search locations". No matching station location was returned for "MLT" in MLT1.)
- **Return Target Locations** card: "Set target location/LP for returned items." Segmented **Location | LP**, then "Select Location" / LP picker.
- **Center "Start Return"**: "Choose a method to start the return process." Buttons **Return With RMA** and **Return Manually**. Both are disabled (container class `disable`) until a return station is selected.
- **Right card**: user and role, KPI tiles "Nof Returned Orders Today", "Nof Returned Products Today", "Total Nof Orders to be Return".
- The RMA and manual return flow screens could not be reached because MLT1 has no return station location.

---

## Key business logic summary (for engineering)

1. **Wave rule → Wave → Jobs → Tasks.**
   - A wave rule (operation type + warehouse + ordered job types + order filters + release sort + schedule + assignment + priority + auto-delete) runs on a schedule (the "Integration" user) or by manual Run.
   - Each run creates a wave `<ruleId>-<n>` and a Wave Log row with counts (orders met, shortages, jobs created, allocated, merged) and a status lifecycle (Pending → Started / In Progress → Completed / Failed, with Optimizing states for AI).
2. **Allocation.**
   - For each order the engine picks the first job type whose conditions match (Single/Multi/Identical/All and condition filters).
   - It allocates stock using the job type's allocation algorithm (D2C Default / B2B Default / Default).
   - Failures produce Allocation Exception rows (eliminated-by-condition, shortage per SKU, all OOS bypass) and Shortage Report rows (Insufficient Inventory vs No Eligible Stock Found).
3. **Jobs** have a status (Pending / Started / Completed / Cancelled), a priority (None/Low/Medium/High), an assignee or pool, planned start/end, label status and pick list status. Bulk ops: priority, cancel, assign/unassign (same-warehouse guard), labels, prints.
4. **Tasks** are per job line, typed Picking / Packing / Sorting / Loading / Count / Replenishment / Kitting, with source/target location, LP and cart, short statuses, and Execute/Update/Cancel from the desktop.
5. **Job type settings** decide the downstream flow: only pick, only pack, sorting task, loading task, tote scanning, self-assign, batch limits, mobile screens (Pick and Sort, Pick to Location).
6. **Work orders**: kitting for kit-to-stock, with or without picking (with picking spawns a Work Order Picking job). Statuses Open → In Process → Completed, or Shortage / Cancelled. Create Kit and Disassemble Kit act on the selection.

## Not captured / unknown
- The Delete Method dropdown options; the Yes toggle did not enable it during capture.
- Grouping step options for picking job types.
- Order-by direction controls in the wave rule Selection step.
- Return RMA/manual flows (no return station in MLT1).
- A live pack flow (no MLT1 order is ready to pack).
- Confirm dialogs for Run, Cancel job, Cancel task, Create/Void Label, and the print outputs. These were not triggered.
- Job detail page: there is none. Job code links to the Task Details list.
