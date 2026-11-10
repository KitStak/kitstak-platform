# 08 — Settings, Billing, Shell & Navigation (Logiwa iO benchmark)

Captured 2026-11-05 from https://my.logiwa.com (sandbox, user "Mike Lunsford", role Supervisor). Warehouse scope: MLT1 - Test Warehouse. Nothing was saved on any settings page. Wizards were walked step by step and then cancelled or abandoned.

Conventions used throughout Logiwa (build these once as shared primitives):
- **Page header**: breadcrumb (e.g. `Home > Settings > Printouts`; "Home" links to `en/`), H1 title on the left, grey helper sentence centered in the header band, primary CTA (blue filled) top-right, optional secondary button (white outlined, e.g. "Import", "Bulk Import/Update ⓘ ▾").
- **Page tabs**: uppercase small links under the title (e.g. `3PL BILLING | BILLING REPORT | VAS OPERATIONS`). The active tab is blue and underlined. Each tab is a separate route.
- **Grid toolbar (left)**: a search-field selector button (list icon ▾) opens a popover titled "Search Content" with radio buttons **Equal** / **Starts With** and an **Apply** button. Next to it are a search input ("Search by code", "Search by name", "Email", "Search by billing form") with a magnifier button, then a **Filter ▾** button.
- **Filter ▾ popover**: title "Select Filter Type", segmented **New | Saved** (the saved filters list), a "Search Filter" input, and a list of filterable fields. Each field row has a bookmark icon and a "+". Clicking a field drills in with a back chevron and the field name as header, and shows a field-specific editor:
  - Multi-select (e.g. Warehouse) lists checkboxes and an **Add Filter** button that is disabled until something is checked.
  - Numeric range shows two number spinners "__ – __".
  - Date shows a preset dropdown (Custom, Today, Last 3 days, Last 7 days, Last 30 days, Last 90 days, Last 12 months, X Day(s) Ahead and More, X Day(s) Before and More, Within X Day(s) Past, Within X Next Day(s), Sunday … Saturday), From and To datetime pickers (`2026/11/05 00:00` / `2026/11/05 23:59`), and **Add Filter**.
- **Applied filter** renders as a chip next to Filter (`Warehouse / in MLT1 - T… ×`), followed by a **Save filter** icon button (tooltip "Save filter") and a **Clear filter** funnel icon (tooltip "Clear filter"). The filter is encoded in the URL, e.g. `?wn=["<uuid>"]&wnqt=in&wnlbl=MLT1 - Test Warehouse&ps=100`. The pattern is `<key>`, `<key>qt` = operator (`in`, `eq`), and `<key>lbl` = display label.
- **Grid toolbar (right)**: bulk-action buttons that are disabled until rows are selected (e.g. Actions ▾, Duplicate, Calculate; Cancel, Approve), plus a refresh icon button.
- **Grid**: a checkbox column when bulk actions exist. Column headers are uppercase grey 10px. The first column is a blue link that opens the detail or edit drawer. The last column is a "•••" row menu that opens a `k-popup myl-grid-menu-popup` list of actions. A gear icon in the header's far right opens the **Edit Table Columns** popover (a checkbox per column and an **Apply** button). The grid scrolls horizontally with a scrollbar.
- **Grid footer**: density toggle **Large | Small** (Small active), page size "Show 100 items ▾" (100 is the default; 10000 is seen on some), pager `|◀ ◀ [1] / N ▶ ▶|`, green outlined **Export As Excel**, and `Total: N` (plus `Selected: N` when rows are selected).
- **Drawers**: right-side slide-over at about 35% width with a title, an X close, and step tabs or segmented tabs across the top. The footer has **Cancel/Back** (grey outlined) and **Next/Save** (blue filled). Escape closes the drawer and discards changes.
- **Validation**: required fields are marked `*`. On submit, invalid fields get a red border and no text message appears (Logiwa behavior; we should do better with inline messages). On some forms the Next/Save button stays disabled until the required fields are filled.
- **Yes/No toggles**: two-segment control. The selected "Yes" is green-filled, the selected "No" is red-filled, and the disabled state is grey-filled.
- **Info tooltips**: (i) icon with a dark tooltip on hover (ant `nz-tooltip`).
- **Change Log**: right drawer titled "<Entity> Change Log" with grid columns TYPE | MESSAGE | OPERATION DATE | SOURCE. When empty it shows "No records to display". Example row: `Create | Monthly account fee -> Billing Form Fee Detail is created. | 10/16/2026 1:22:16 PM | mike@team-01.com`.
- **Status pills**: Active, Successful and Yes are green with dark-green text. Approved and Draft are lavender with purple text. No is grey. BETA is a tiny purple badge.

---

## Global Shell — Top Navigation Bar

- A full-width, deep indigo/purple bar (~36px high at 800px width) with a white "LOGIWA" wordmark and logo on the left (links to `en/`).
- Mega-menu triggers sit center-left: **Fulfillment, Inventory, Automation, Integrations, Reports, Analytics, Settings**. The menus open on **hover**, appear as a white rounded panel under the trigger, and the active trigger gets a white underline. Menus are pre-rendered in the DOM (`li.lw-header--menu--item > .lw-header--submenu > .lw-header--submenu-column`). Each column has an icon and a heading and is separated from the next by a vertical divider. Items are plain links, grey text that turns blue on hover. **There are no item descriptions.**
- Right cluster: the **Search** pill, then round icon buttons **Screen Recording** (camera), **Transactions** (history), **Printers** (printer), **Help Center** (?), and **User** (person). Each has a purple tooltip on hover.

### Mega-menu contents (exact)
Icons are SVGs at `assets/images/icons/header/<name>.svg`.

**Fulfillment**
- Outbound (outbound.svg): Shipment Orders `en/wms/shipment-order/list` · Shipped Orders `en/wms/shipment-order/shipped/list` · Carrier Shipment Details `en/wms/shipment` · End Of The Day `en/wms/shipment/end-of-day` · Packing Station `en/wms/packing-station`
- Task Management (task-management.svg): Job Management `en/wms/job/management` · Order Operations Task Details `en/wms/task-details/order-operations/list` · Count Task Details `en/wms/task-details/count/list` · Replenishment Task Details `en/wms/task-details/replenishment/list`
- Shipment (shipment.svg): Shipment History `en/wms/shipment-order/shipment-history/list` · Shipment Plan `en/wms/shipment-plan`

**Inventory**
- Inbound (inbound.svg): Purchase Orders `en/wms/purchase-order` · Receiving History `en/wms/purchase-order/receipt/list` · Return Station `en/wms/return-station/dashboard` · Return Orders `en/wms/shipment-order/return/list` · Work Orders `en/wms/work-order/list`
- Inventory (inventory.svg): Total Inventory `en/wms/inventory/total` · Inventory by Location `en/wms/inventory/list` · Available To Promise (ATP) `en/wms/report/available-to-promise`
- Count Operations (count.svg): Count Plan `en/wms/count/plan/list` · Count Location Details `en/wms/count/location/list` · Count SKU Details `en/wms/count/product/list`

**Automation**
- Workflows & Algorithms (automation.svg): Algorithms `en/wms/algorithm` · Workflows `en/wms/workflow` · Rate Shopping `en/wms/rate-shopping-presets` · Wave Rules `en/wms/job/wave-rules`

**Integrations**
- Plugin Integrations (integration.svg): Channel Integrations `en/wms/integration/list/1` · Carrier Integrations `en/wms/integration/list/2`
- Channel Logs (reports.svg): Channel Methods `en/wms/integration/analytics/integration-status` · Channel History `…/integration-history` · Orders and Shipments `…/order-shipments` · Products and Inventory `…/products-inventory`
- Channel Monitoring (monitoring.svg): Channel Health Overview `en/wms/integration-monitoring/integration-health-overview` · Channel Setup Details `…/channel-setup-details` · Missing Shipment Orders `…/list/missing-orders` · Recent Errors `…/list/recent-errors` · Workflow Blocked Shipment Orders `…/list/workflow-blocked-orders` · Product Listing Exceptions `…/list/product-listing-exceptions`
- Carrier Monitoring (shipment.svg): Carrier Errors `en/wms/carrier-monitoring/carrier-errors`

**Reports**
- Orders (orders.svg): Channel Sales Report `en/wms/report/channel-base-sale` · Shipment History · Shortage Report `en/wms/report/shortage`
- Inventory (inventory.svg): Available To Promise (ATP) · Kit Inventory Report `en/wms/report/kit-inventory` · Kit Component Inventory Availability Report `en/wms/report/kit-component-availability` · Serial Number Report `en/wms/report/serial-number-report` · Order Inventory `en/wms/report/order-inventory` · Dynamic Replenishment Report `en/wms/report/replenishment` · Inventory Snapshot Report `en/wms/report/inventory-snapshot`
- Logs (logs.svg): Change Log `en/wms/report/change-log` · Transaction History `en/wms/report/transaction-history` · Integration Log (= integration-history) · Missing Log `en/wms/report/missing-log` · Serial Number Transaction History `en/wms/report/serial-number-report/transaction-history` · Allocation Exceptions `en/wms/job/allocation-exceptions` · Wave Log Report `en/wms/job/wave-log` · Excel Export History `en/wms/report/excel-export-history`
- Receiving (receiving.svg): PO Receiving Report `en/wms/report/partial-receipt` · Receiving History
- Warehouse Efficiency (warehouse-efficiency.svg): User Performance Report `en/wms/report/user-performance`

**Analytics**
- Labor Analytics (labor-analytics.svg): Average Task Analysis · Associate Task Analysis · Performance Quadrant Analysis · Associate Analysis · Receiving Performance Analysis (`en/wms/labor-analytics/<kebab>`)
- Operational Analytics (operational-analytics.svg): Inbound & Inventory Dashboard `…/inbound-inventory` · Fulfillment Dashboard `…/fulfillment` · Management Dashboard `…/management` · Productivity Dashboard `…/productivity`

**Settings**
- Master Data (master-data.svg): Products `en/wms/product` · Product Listings `en/wms/listing-product/list` · Locations `en/wms/location` · Vendors `en/wms/vendor/list` · Customers `en/wms/customer` · Retailers **BETA** `en/wms/retailer`
- Configuration (configs.svg): Warehouse `en/wms/warehouse` · Mobile Carts `en/wms/mobilecart` · LP Types `en/wms/lp-types` · LP Numbers `en/wms/lp-numbers/list` · Shipment Packages `en/wms/shipmentpackage` · Printouts & Labels `en/wms/printout` · Data Setup `en/account/settings/datasetup/code-generation` · Job Types `en/wms/job/types` · Screen Configuration `en/wms/screen-configuration`
- Client Setup (client-setup.svg): Clients `en/account/client` · 3PL Billing `en/wms/billing` · Billing Report `en/wms/billing/report/list` · VAS Operations `en/wms/billing/operations/list`
- Users (users.svg): Users `en/account/user/list` · Roles `en/account/user/role`

Note: several items appear in two menus (Shipment History, ATP, Receiving History, Integration Log). Menu visibility is permission-driven: each menu item maps to a role permission "View" (see Roles).

### Global Search ("Search in pages")
- The pill shows "🔍 Search". Clicking it expands an input with the placeholder "Search in pages", dims the page with an overlay, and shows a clear "×" on the right.
- **It only searches navigation pages, not records.** Typing shows a suggestion list in which each row is a page link with the matched substring in **bold** and a right-aligned grey type label "Page". Matching is case-insensitive substring on the page title. Examples:
  - `ship` → Shipment Orders, Shipped Orders, Carrier Shipment Details, Shipment History, Shipment Plan, Orders and Shipments, Missing Shipment Orders, Workflow Blocked Shipment Orders, Shipment Packages.
  - `inv` → Total Inventory, Inventory by Location, Products and Inventory, Kit Inventory Report, Kit Component Inventory Availability Report, Order Inventory, Inventory Snapshot Report, Inbound & Inventory Dashboard.
- Typing an order code (`SHP-811074190`), a SKU (`BMS-M8…`) or `SO1` returns "No data found." Enter does nothing, and Escape keeps focus.
- **KitStaks opportunity**: a true global record search (orders, SKUs, POs, LPs, locations) with typed result groups would beat Logiwa outright. Keep the "Page" results group for parity.

### Screen Recording (camera icon)
- Tooltip: "Screen Recording". Clicking it opens a third-party popup (`logiwa.birdie.so`) to record the screen for support. No in-app UI.

### Transactions (history/refresh icon)
- A popover titled "⇆ Transactions" with an (i) tooltip: "View the progress and status of your background tasks. Completed transactions are cleared daily."
- Empty state: "There is no transaction today." This is a background-job tray for imports, exports and bulk operations.

### Printers (printer icon) — Direct Print setup
- A popover titled "🖨 Printers" with the notice "Printing application has not been installed yet. **Download the setup** if you need a printing solution." (link).
- Step 1: "Warehouse Selection" with a dropdown (Select Warehouse / MLT1 - Test Warehouse / Team 1 Supplier Service), plus **Back** and **Next** buttons (Next is disabled until a warehouse is selected).
- Step 2: "Warehouse: MLT1 - Test Warehouse" with a **Change** link, then two slots:
  - "Selected Barcode Printer: Not Selected" ("Select or scan to assign printer", + button)
  - "Selected Laser Printer: Not Selected"
  - An input "Scan Or Enter" and a list "Search And Select" to choose a printer.
- Logic: the per-user printer assignment per warehouse (label printer vs laser printer) is used by every "Direct Print" printout.

### Help Center (? icon)
- Tooltip "Help Center". It opens the external Intercom help center (`intercom.help/mylogiwa`) in a new tab.

### User menu (person icon, opens on hover)
- Header: avatar initials bubble "ML" (lavender), name "Mike Lunsford", and role "Supervisor" below it.
- Items with icons: **Change Password** `en/account/user/password/form` · **My Profile** `en/account/user/profile/form` · **Company Settings** `en/account/settings/company/basic` · **Apps** `en/wms/apps/list` · divider · **Log Out**.
- **No warehouse switcher exists in the web header.** Warehouse scoping is done per page via filters, and mobile has "Change Warehouse" in Profile(Mobile). There is **no notifications bell**.

### Breadcrumbs
- Small (10px) dark text above the H1: `Home > <Menu> > <Page>` (e.g. `Home > Orders > Job Types`, `Home > Settings > Billing > Edit Billing`). "Home" is a link. Intermediate crumbs are plain text.

---

## Dashboard — `en/wms/dashboard`
Title "Dashboard - Logiwa". There is no breadcrumb or H1, just the cards.

**Filter bar**: a filter icon button, the label "Filter by", then two multi-select dropdowns, **Warehouse** and **Client**. Each dropdown opens a panel with a "Search Filter" input, checkbox options, and **Add Filter** (disabled until a change is made). Warehouse options: MLT1 - Test Warehouse, Team 1 Supplier Service. Client options: all 31 clients. The selection is shown inside the dropdown (e.g. "MLT1 - Test Warehouse").

**Widgets** (sample values: all warehouses / MLT1 only):
1. **Progress for Today** (i) "Shows the progress of the tasks, order lines, and orders that have been created today and prior to this day."
   - Day Shift block. With multiple warehouses selected it shows "Select just one warehouse to see Day Shift data." With one warehouse it shows `Thu, Nov 5` and `15:39 - 17:00` (now - shift end, now in green), a blue progress bar for elapsed shift, and `☀ 08:00` / `17:00 ☾` labels.
   - Tasks: `23% Completed`, `18 - 80` (done in green, then total), with a thin progress bar.
   - Order Lines: `0% Packed`, `5 - 9,208`.
   - Orders to be Shipped Today: `0% Packed`, `4 - 3,261`.
2. **Unfulfilled Orders** (i) "Total number of orders with no action taken, regardless of a specific time interval."
   - A donut chart (gold = Open, blue = Ready to Pack & Ship) with the center label "Total Order 3,283". The legend items are clickable and toggle series.
   - Three rows of Total Order / Total Pack Quantity: **Total** 3,283 / 435,776 · **Open** (gold) 3,263 / 435,662 · **In Progress** (blue) 20 / 114.
3. **Order Breakdown by Status** (i) "Shows the number of orders according to their current status. Orders with an expected shipment date set to today or prior to this day will be displayed in this section."
   - Four columns: Open, Ready to Pick, Picking Started | Ready to Pack, Packing Started, Ready to Load, Ready to Ship | Cancelled, Shortage, On Hold | Already Shipped Today, Orders to be Shipped Today, Orders to be Shipped Tomorrow. Values are bold and not clickable.
4. **Channels**, "Order details coming from Channels.": a ranked list such as `1. ShipStation 95.98% of All Orders 3152`, `2. Shopify 2.83% 93`, `3. Others 1.19% 39`.
5. **Clients**, "Client's order details and rank": Bulletpoint Mounting Solutions 96.13% 3157; testclient 3.59% 118; Paqari; MLTest; Foam (top 5).
6. **Carriers**, "Ranking of carriers to which orders are shipped": Others 99.88% 3280; UPS 0.12% 4.
7. **Order By Country**, "Rank of the regions where orders are shipped": United States of America 99.63% 3272; Others; Canada.
8. **Jobs**, "You can manage and review the details of the jobs with the tabs on the right." Segmented tabs **Priority | Status | Type**. The table columns are Name | Product Qty | Order Qty | Percentage | Job Qty.
   - Priority: None 7/7/87.5%/7; High 6/10/12.5%/1.
   - Status: Pending 12/17/32%/8; Completed 7/10/44%/11; Cancelled 10/12/24%/6.
   - Type: Work Order Picking; Multi Item Orders; Single Unit Orders; MLT1 D2C Picking; B2B Order Picking; Identical SKU- Single Unit.

**Drilldowns**: every ranked row except "Others" is clickable and deep-links to Shipment Orders with a URL filter:
- Channel → `en/wms/shipment-order/list?cn=["1"]&cnqt=in&cnlbl=Shopify`
- Client → `…?cli=["<clientUuid>"]&cliqt=in&clilbl=testclient`
- Carrier → `…?lcn=["14157"]&lcnqt=in&lcnlbl=UPS`
- Country → `…?ccn=Canada&ccnqt=eq&ccnlbl=Canada`

The status breakdown, progress and jobs widgets are not clickable. **KitStaks opportunity**: make those widgets drill down too.

---

## Printouts & Labels — `en/wms/printout` → `en/wms/printout/template/all`
- Breadcrumb `Home > Settings > Printouts`, H1 "Printout Types", helper "You can create, edit, design your own printouts".
- A left vertical category list with counts. Each category is its own route: **All (25)** `/template/all`, **Lists (8)** `/template/1`, **Labels (11)** `/template/2`, **Billings (4)** `/template/3`, **Others (2)** `/template/4`. Note: Labels displays only 9 cards and All only 23, so Logiwa's counts don't match the cards shown.
- A 3-column card grid. Each card has a round icon (blue for list types, purple for label types), the TYPE NAME in uppercase, and "N Printouts". Some cards carry a BETA badge.
  - Lists: PACKING LIST (1), PICKING LIST, CONSOLIDATED PICKING LIST, PURCHASE ORDER LIST, MANIFEST/BOL, WORK ORDER PICKING LIST, WORK ORDER CONSOLIDATED PICKING LIST, RESOLUTION JOB.
  - Labels: LP LABEL, LOCATION LABEL, JOB PICKING LIST, PICK SHORT LABEL, PRODUCT LABEL, MOBILE CART, RETAILER LABEL FOR CASE (BETA), RETAILER LABEL FOR PARENT LP (BETA), PACK SHORT LABEL.
  - Billings: CONTRACT, BILLING REPORT, SO BILLING CHARGES, PO BILLING CHARGES.
  - Others: CUSTOM EOD, JOB CONTENT.
- Clicking a card opens **Printout List** `en/wms/printout/list/{typeId}` (Packing List = 1).
  - H1 "Printout List (Packing List)", a **Create Printout** CTA, and a "‹ Go back to Printout Types" link.
  - Grid columns: REPORT NAME (link) | DESCRIPTION | CREATION DATE | CREATED BY | STATUS (pill) | REPORT TYPE | •••. Example row: `Packing Slip | Packing Slip | 10/22/2026 | Team 1 Supplier Admin | Active | Packing List`.
  - Row ••• menu: **Show Details, Edit, Duplicate, Change Log, Delete**. Change Log opens a "Printout Change Log" drawer.
- **Create/Edit Printout wizard** (right drawer, 5 steps "Step 1 … Step 5"):
  1. Name* (text "Enter name"), Description* ("Please enter description"), Type* (prefilled with the current type as a chip, disabled), Records per Page* (Select / Single Record / Multiple Records), Print Mode* (Direct Print / PDF Preview / Report Preview), Printer Type* (Label Printer / Laser Printer), Status segmented **Active | Passive** (Active is green by default). Next with empty fields gives red borders on the required fields.
  2. **Select Template**, "Please select a template from the list below to create a copy and edit to save as a new template". A radio-card list, where each card shows the name, Report Type, Description and a thumbnail. Packing List templates: Packing List; Packing Slip; Packing Slip(Task Based); Target Pack List; Macy's Pack List; QVC Pack List; Staples - Dropship Pack List; Walmart Pack List; Amazon Pack List.
  3. **Printout Designer**: "Click the Open Designer button to design your label printout. After completing your design, click the Save button under the Report tab in the designer window…", with an **Open Designer** button that launches a WYSIWYG report designer in a separate window (not opened).
  4. Type-specific options. For Packing List: checkbox "Use retailer or store based packing list for this printout." with the (i) tooltip "Select to use a retailer/store-based packing list. Deselect to revert to the standard list."
  5. Client access: checkbox "Give access to all existing and future clients." (default checked). Unchecking it reveals "Search by client", a **Bulk Actions ▾** menu (Activate Selected / Deactivate Selected), and a grid with columns checkbox | CLIENT (link) | ACCESS (green toggle) and Total: 31. Footer: Back / **Save**.

---

## Job Types — `en/wms/job/types`
- Breadcrumb `Home > Orders > Job Types`, H1 "Job Types", helper "Create and list job types using this screen", CTA **Create New Job Type**.
- Toolbar: search-field selector (Equal/Starts With), "Search by code", Filter (fields: **Code, Warehouse**), and refresh.
- Grid columns (all visible by default, all toggleable): CODE (link) | DESCRIPTION | WAREHOUSE | ALLOCATION ALGORITHM | OPERATION TYPE | •••. Row menu: **Delete** only. Clicking the code opens the Edit drawer. Footer: Large/Small, Show 100 items, pager, Export As Excel, Total.
- Data: MLT1 D2C Picking (MLT1, Default, Picking), Work Order Picking (Work Order), Static Replenishment and Dynamic Replenishment (Replenishment), Instant Count and Cycle Count (Count), Identical Kit to Order, B2B Order Picking (B2B Default), Multi Item Orders, Single Unit Orders, Identical SKU- Single Unit (D2C Default, Picking).
- **Create step 0, "Operation Type" drawer**: an illustration and the line "Please select the operation for which you want to create the operation type". Four cards with chevrons:
  - Picking: "Assign settings for your picking jobs"
  - Count: "Assign settings for your count jobs"
  - Replenishment: "Assign settings for your replenishment jobs"
  - Work Orders: "Assign settings for your work orders"
- **Picking job type** (drawer "Edit Job Type" + type pill; tabs General | Settings | Conditions | Grouping):
  - General: Job Type Name*, Warehouse* (MLT1 / Team 1), Operation Type* (disabled), Allocation Algorithm* (options from Automation › Algorithms filtered by warehouse, e.g. "Default"), Description*.
  - Settings:
    - Order profile radio cards: **All Orders / Identical Item Orders / Single Item Orders / Multi-Item Orders / Identical Kit to Order**.
    - Retailer Flow Type (None).
    - UCC Label Scanning Type.
    - Default Retailer Label Print Option, with tooltip "For orders using Retailer Post-Picking UCC Generation, scanning the Parent LP Number will automatically generate UCC labels based on this default setting."
    - Yes/No toggles: Override For Last Job, Only Pick, Only Pack, Create Loading Task, Disable Full LP Picking, Auto Complete Picking Tasks, Create Sorting Task, One By One Sorting, Disable Tote Scanning ("When this parameter is enabled, the user is expected to scan Cell location instead of scanning Tote in Sorting."), Enable Picker Self-Assign ("If enabled, pickers must self-assign jobs of this type via a confirmation step on their mobile device. This ensures one job is assigned to one picker.").
    - **Batch Size**: Limitation Method (Nof Order / Nof Item), Min and Max spinners.
    - **Select Mobile Screen Type**, "Select the mobile screen(s) that will use this job type". Rows "Pick and Sort" and "Pick to Location" each have Use / Don't Use. Tooltip: "…both of them can not be selected at a time."
  - Conditions:
    - "Add Condition +" opens a filter-type list: Carrier, Carrier Rate, City, Client, Country, Expected Shipment Date, Fraud, Is Back Order, Is Gift, Is Oversized, Is Partial, Number of Boxes, Order Price, Order Quantity (numeric range), Order Tag, Order Type, Planned Shipment Date, Precartonization Type, Priority, Product Group, Product PackType, Retailer, Shipment Method, Shipment Order Date, Shipment Package, Sku, SO Custom Field DateTime 1-2 / DropDown 1-2 / TextBox 1-3 / Toggle 1-2, Store.
    - **Order By**: "Order by Picking Method*" dropdown plus Add. The options are Sku, Item Weight, Item Volume, Location Aisle/Column/Position/Level/Rack, Product Custom Field (TextBox 1-3, DropDown 1-2, Toggle 1-2, DateTime 1-3), and Location Custom Field (same set). Each added sort is a numbered draggable row with an **Ascending | Descending** toggle. The default row is "1 Walking Path Priority, Ascending".
  - Grouping: "Group By" with "Select a picking method group": Location Zone, Product Group, Carrier, Area Type, Client, Order Tag. The footer becomes **Save**.
- **Count job type** (steps 1.General | 2.Settings | 3.Loc. Conditions | 4.SKU Conditions):
  - General: Job Type Name*, Warehouse*, Operation Type* (Count, disabled), Allocation Algorithm, Description*.
  - Settings: Batch Size, plus Yes/No toggles:
    - One by One Count.
    - Auto-Update No-Difference Count Lines: "When enabled, count lines with no difference between the counted and system quantity are automatically updated in inventory and the count line is marked as complete. Lines with a difference remain open for manual review."
    - Instant Count: "When enabled, this job type is used for operator-initiated counts started directly from the mobile app by scanning a location."
    - Lock Location for Instant Count: "When enabled, a location is locked for the duration of the count session…"
    - Auto fill Tracking Attributes: "Automatically fills Lot/Batch, Expiry and Production Date on the mobile count screen when a single matching value is found at the scanned location or LP."
  - Loc. Conditions: Information banner "The following conditions apply only to location count plans. Location count conditions cannot be combined with SKU count conditions within the same count plan." The "Add Conditions" types are Aisle, Area Type, Code, Column, Height, Level, Location Client, Location Custom Field Date Picker 1-2 / Dropdown 1-2 / Text Box 1-3 / Toggle 1-2, Location Group, Location Type, Location Zone, Priority, Replenishment Type. Empty state "No conditions have been added yet." Then Order By "Order by Count Method" + Add.
  - SKU Conditions: similar banner. The types are Product Client, Product Group, Product Type, Sku. Then **Save**.
- **Replenishment job type** (1.General | 2.Settings | 3.Conditions): Job Type Name*, Warehouse*, Replenishment Algorithm Method (**FEFO** default / FIFO), Description*. The Settings and Conditions content was not captured.
- **Work Orders job type**: not walked (unknown detail; the existing record uses the "D2C Default" allocation algorithm).

---

## Screen Configuration — `en/wms/screen-configuration` → `/screen-configuration/type`
- A splash page "Select Operation Type", "Select a type to build your own configuration.", with one green button **Receiving** and an illustration on the right. Receiving is the only operation type available.
- List `…/screen-configuration/list/receiving`: breadcrumb `Home > Settings > Screen Configuration > List`, H1 "Receiving Screen Configuration List", helper "You can list your screen configuration setups and create new ones.", CTA **Create Receiving Configuration**. Toolbar: Filter and refresh. Grid columns: CONFIGURATION NAME | WAREHOUSE | OPERATION TYPE | SCREEN NAME | IS ACTIVE | CREATED DATE | CREATED BY | •••. Empty state: "No records to display".
- Create `…/screen-configuration/create/receiving` is a full page: a left form panel (~30%) and a right grey canvas, presumably the mobile-screen preview builder. Tabs: **General | Conditions | Configuration**.
  - General: Warehouse* (dropdown), Configuration Name*, Active Yes/No (Yes default). Next stays disabled until valid.
  - Conditions: "Select conditions for specific scenarios; if none selected, the configuration applies to all purchase orders." A rule sentence builder:
    - **When** [Operation Starting]
    - **If** [The selected purchase order is]
    - **And | Or** toggle across three dropdowns: Client; PoType (Transfer Order, Purchase Order- Non Crossdock, Return Order, Open Order, Purchase Order); Vendor
    - **Use** [config name]
    - Footer: Back / **Save**.
  - Configuration: locked until saved (not captured). It presumably configures which fields and steps appear on the mobile receiving screen.

---

## 3PL Billing — `en/wms/billing` → `en/wms/billing/list`
- Breadcrumb `Home > Settings > Billing`, H1 "Billing", helper "On the 3PL billing screen, you can edit or create a billing form for your clients.", CTA **Create Billing Contract**. Tabs: **3PL BILLING | BILLING REPORT | VAS OPERATIONS**.
- Toolbar: Filter (fields: Billing Name, Client, Create Date, Period, Warehouse), then on the right **Actions ▾**, **Duplicate**, **⊞ Calculate**. All three are disabled until a row is selected.
  - Actions menu: **Approve** (disabled if already Approved), **Cancel Approval**, **Delete** (red text).
  - Duplicate makes a copy of the contract. Calculate runs the billing calculation now and creates a Billing Report.
- Grid columns (all default-visible): checkbox | BILLING NAME (link) | CLIENT | APPROVAL STATUS (pill "Approved" or blank) | WAREHOUSE | START DATE | LAST CALCULATION DATE | BILLING FREQUENCY | CREATED BY NAME | CREATED DATE TIME | NEXT PERIOD START DATE | •••. Row menu: **Show Details, Edit, Change Log, Delete**.
- Data: `MLTest Billing | MLTest | Approved | MLT1 - Test Warehouse | 10/1/2026 | 11/1/2026 4:06:31 AM | Monthly | Mike Lunsford | 10/16/2026 1:17:58 PM | 11/30/2026 11:00:00 PM`; `Team 1 Standard 2026 | MLTest | (not approved) | MLT1 …`.
- Logic: contracts calculate automatically at each period end (last calc 11/1 ~4am). The next period start is shown in the grid.

### Create Billing Form — `en/wms/billing/form/add`
- Breadcrumb `… Billing > Create Billing`. Two panels: the left card is "Billing Form" (with "Show Change Log"), and the right card is "Summary: You can check the billing information."
- Fields: Billing Form Name*, Client* (31 clients), Warehouse*, Calc. Start Date* (date "Enter date"), Billing Frequency* (Monthly, Weekly, Daily, BiMonthly, SemiMonthly, BiWeekly). Buttons Cancel / **Save**. Fees can be added after the form is saved.

### Edit Billing Form (details) — `en/wms/billing/form/edit/{uuid}`
- Header card: BILLING FORM NAME "Billing - MLTest Billing", CLIENT, WAREHOUSE, BILLING START DATE, BILLING FREQUENCY, a **Show Change Log** button, and a pencil (edit header).
- **Fees** card with **Create Fee**, search "Search by name", and Filter. Each fee is a card showing:
  - FEE NAME
  - FEE TYPE / FEE CALCULATION TYPE (storage only) / FEE BY / CHARGE BY
  - A price strip "50.00 | Per Recurring"
  - Trash and pencil icons
- Fees in this contract: Monthly account fee (Recurring, 50.00 per Recurring); Pick and pack per order (Pick & Pack, by Packing, charge SO, 3.00 per SO); Storage per location (Storage, At Period End, Location, 25.00 per Location); Receiving per unit (Receiving, Product, Product (UOM Quantity), 0.25).
- Right **Summary** grid "Billing - MLTest Billing": NAME | TYPE NAME | FEE BY | CHARGE BY | CHARGE | FROM QTY. | TO QTY. | PERCENTAGE, plus a **Print** button (uses the "CONTRACT" printout).
- **Create Fee inline form**:
  - Fee Name*.
  - "Select an operation type to manage fees*": Shipment, Recurring, VAS, Pick & Pack, Receiving, Storage, Return, Work Order.
  - Fee Calculation Type (enabled only for Storage): Daily Accumulation, At Peak Inventory, At Period End, Distinct Period Count, Average Calculation, Split Month Storage.
  - Fee By* depends on the operation:
    - Shipment: Per SO / Per Label / Per LP / Shipment Package / Per Product
    - Recurring: Recurring
    - VAS: Operation (VAS types)
    - Pick & Pack: Per Picking / Per Packing
    - Receiving: Per Product / Per LP / Per PO / Per SKU / Per Volume / Per Receiving Line
    - Storage: Location / LP / Product / Total Volume / Parent LP (Distinct Period Count allows only Location / LP / Parent LP; Split Month Storage forces LP)
    - Return: Per RMA / Per SO / Per Product / Per SKU
    - Work Order: Per WorkOrder / Per Kit / Per Component
  - Split Month Storage extra section "Split Month Settings":
    - Split Day of Month* (default 15; tooltip "The last calendar day of the month that uses the Standard Storage Rate.")
    - Standard Rate (Days 1-15)* ("Applies to initial receipts through the Split Day and to recurring monthly storage charges.")
    - Alternate Rate (Days 16-Month End)* ("Applies only to initial receipts after the Split Day through the end of the calendar month.")
  - Use Minimum Price Yes/No → Minimum Price. Use Maximum Price Yes/No → Maximum Price.
  - **Add Condition +** opens a modal "Add Condition / Charge If [Select]" with options: LOCATION - Area Type, Color Code, CustomField(DateTime1-2, DropDown1-2, Textbox1-3, Toggle1-2), Only Damaged Items, Only Single Client, Only Single License Plate, Only Single Lot Number, Only Single SKU; Location Group/Type/Volume/Zone; LP Type/Volume/Weight; LPTYPE - custom fields; PRODUCT - custom fields, Expiration Date Tracking, Is Digital Product, Is Foldable, Is Fragile, Is Hazardous, Is Insert, Is Kit Item, Is Liquid, Is Oversized, Is Packing Material, Is Poster, Is Stackable, Lot/Batch Tracking, Serial Number Tracking, Sku; Product Group/Type/Volume/Weight; Total Volume. The modal has a Save button.
  - **Add Charge −**: Charge By* (Pick & Pack/Packing gives Product (Pack Quantity), Product (UOM Quantity), SO, SKU). It then shows a tiered rate row: "<Metric>* | For Each Unit | From Quantity __ to __ | Add" (multiple tiers allowed).
  - Cancel / Save (Save is disabled until valid).
- Billing Change Log columns: TYPE | MESSAGE | OPERATION DATE | SOURCE (user email).

---

## Billing Report — `en/wms/billing/report/list`
- H1 "Billing Report", helper "Billing report calculation description". Same three tabs as 3PL Billing.
- Toolbar: search selector, "Search by billing form", Filter (Billing Number, Client, Create Date, Name, Warehouse), then bulk **Cancel** and **Approve** (disabled until a selection is made), and refresh.
- Grid columns: checkbox | BILLING FORM (link) | BILL NUMBER | CALCULATION STATUS (pill "Successful") | CLIENT | WAREHOUSE | CALCULATION DATE TIME | CREATED BY USER ("—" when automatic) | PERIOD START | PERIOD END | BILL STATUS (Draft) | PRICE ("106.00 USD") | EXPORTED TO INTEGRATION (No) | •••. Row menu: **View / Edit, Delete**.
- Sample: `MLTest Billing | 2611010000462206 | Successful | MLTest | MLT1 | 11/1/2026 | — | 10/1/2026 | 11/1/2026 | Draft | 106.00 USD | No`. The bill number format is YYMMDD + sequence.
- **Billing Report Details** (full-screen modal with X):
  - Header strip: Selected Bill, Warehouse, Client, Issue Date, Bill Number, Bill Status pill, Period, Total Price, and a pencil.
  - The pencil opens the **Edit Info** modal: Bill Number (text), Bill Status (Draft / Approved / Canceled), Save.
  - Sub-tabs: **CONSOLIDATED BILLING REPORT** | **DETAILED BILLING REPORT**. Print is available on Consolidated.
  - Consolidated columns: FEE NAME | OPERATION TYPE | FEE BY | CHARGE BY | FROM QTY | TO QTY | UNIT PRICE | QUANTITY | TOTAL PRICE | MIN MAX ADJUSTMENT | ADJUSTED PRICE. Example: `Receiving per unit | Receiving | Product | Product (UOM Qu…) | | | 0.25 USD | 24 | 6.00 USD`.
  - Detailed columns: FEE NAME | OPERATION TYPE | FEE BY | CHARGE BY | SKU | FROM QTY | TO QTY | UNIT PRICE | QUANTITY | TOTAL PRICE | MIN MAX ADJUSTMENT | ADJUSTED PRICE | BILLING FREQUENCY | ACTIVITY DATE | REFERENCE NUMBER (e.g. MLT-PO-002) | LP NUMBER | INTEGRATION STATUS (Not Sent) | NOTE. It has search "Search by reference", Filter, and Export As Excel.
- Status lifecycle: Calculation Status is Successful or Failed (assumed). Bill Status goes Draft → Approved | Canceled, and Exported To Integration is Yes or No (export to accounting).

---

## VAS Operations — `en/wms/billing/operations/list`
- H1 "Billing" (VAS tab active). Buttons **Import** and **Create A VAS Operation**.
- Toolbar: Filter. Grid columns: VAS TYPE (link) | CLIENT | WAREHOUSE | OPERATION DATE | CREATED BY | CREATED DATE | CALCULATION TYPE | REFERENCE NUMBER | REFERENCE ORDER TYPE | VALUE | NOTE | •••. Example row: `Cycle Count (hours) | testclient | Team 1 … | 10/6/2026 | Team 1 Supplier Admin | 10/22/2026 | Vas Quantity | | | 10`.
- **Add a new VAS operation** drawer:
  - Client* and Warehouse*.
  - VAS Type* (Customer Pickup, Grade B Pallet, Programming (hours), Cycle Count (hours), Return Additional Item, Special Project). These come from Data Setup › VAS Type.
  - Operation Date* (defaults to now, `2026/11/05 15:54`).
  - Calculation Type (disabled; auto from the VAS type: Total Price or Vas Quantity).
  - Operation Value* (0.00 spinner).
  - Add a Note (textarea, counter "0 / 200").
  - Reference Order Type (Shipment Order, Purchase Order, Work Order) and Reference Number.
  - Cancel / Save (Save disabled until valid).
- **Import** → `en/wms/import/vas-operations/22`, "Bulk Import Vas Operations":
  - "‹ Go back to vas operations" link.
  - A card "Download our excel template" with the manual link and a **Download** button.
  - A drag-and-drop zone ("Drag and drop or browse").
  - An import-history grid: STATUS | MASTER ROW COUNT | SUCCESS COUNT | ERROR COUNT | UPLOADED BY | CREATED DATE TIME | ACTIONS, with refresh.
- Billing logic: VAS fees in contracts with Fee By = Operation multiply the VAS Operation Value by the rate (or use the total price).

---

## Apps — `en/wms/apps/list` ("Discover Apps for Logiwa")
- Hero: title, "Search by App" input, and an illustration. Tabs: **POPULAR APPS | ACTIVE APPS | ALL APPS**.
- A 3-column app card grid. Each card has a colored round icon, a gear (settings, shown on activated apps), the name, a truncated description, and footer buttons **Details** (opens the docs in a new tab) and **Activate** (blue) or "✓ Activated" (green text).
- Apps: AI Jobs (Activated), Custom Branding, Labor Analytics (Activated), Operational Analytics (Activated), Scale, Single sign-on (SSO), Two Boxes, API User, BukuShip Carrier Integration, Dropstream, Ehub Carrier Integration, Locad OMS, Locus (robotics), Shipium Carrier Integration, Techship Store Connections, eShipper Carrier Integration.
- Logic: feature flags/add-ons per account. Activating an app unlocks menu items (e.g. Analytics menus).

---

## Users & Roles — `en/account/user/list` (tab USERS) and `en/account/user/role/list` (tab ROLES)
- H1 "Users & Roles". Helper: "The Users & Roles screen allows you to add new users to your Logiwa account. You can manage warehouse access and client access for each user, and create different roles to manage the access levels of different users. For more details visit our User & Roles Help Center (link)."
- **Users tab**:
  - CTAs: **Bulk Import/Update ⓘ ▾**, **Add User**. The tooltip reads: "You will be directed to the bulk action page, where you can manage and upload Role, Warehouse and Client Listings in bulk using Excel files. To assign or unassign the Warehouse or Client, Roles need to be added first." Menu items: **Import User-Role**, **Update User-Role**, then a group **Assign/Unassign** with **User-Warehouse** and **User-Client**.
  - Search defaults to Email. Filter fields: Display Name, Email, Is API User?, Role, User Status, User Type, Warehouse.
  - Grid columns: checkbox | NAME (link) | EMAIL | ROLE | WAREHOUSE (comma list) | USERTYPE (Operation / Owner) | STATUS (Active pill) | API USER (No grey / Yes green pill) | •••. Selecting rows shows "Selected: N" but no bulk buttons. Row menu: **Show Details, Edit, Change Log** (no delete; users are deactivated instead). Total 21 users.
  - **Add User** drawer, steps 1.User Info | 2.Roles | 3.Warehouse | 4.Client:
    - User Info: First name*, Last name*, Email*, User type* (Operation / Client), Password**, Confirm password*, Send Welcome E-Mail Yes/No, Status ACTIVE / INACTIVE. Cancel / Next.
    - Roles: Unassign / Assign buttons over a grid of ROLE NAME | ACCESS (Assigned / Unassigned).
    - Warehouse: the same pattern with WAREHOUSE | ACCESS.
    - Client: radio cards "All Clients — Give access all existing and future clients" or "Select Manually — List clients and give access them by selection." Back / Save.
  - **Edit User** drawer "Edit User (Name)": tabs User Info | Roles | Warehouse | Client, with the same content. The password is required in the form but should be optional on edit.
- **Roles tab**:
  - CTA **Add Role**. Search "Search by name", Filter, and **Manage Restrictions** (disabled until a role is selected).
  - Grid columns: checkbox | ROLE NAME (link) | DESCRIPTION | ROLE CATEGORY | RESTRICTIONS ⓘ ("Displays the Data Restrictions assigned to the role.", shown as pills e.g. "Carrier Cost", "Rate Shopping Data") | •••.
  - Roles: Client (Client category), Warehouse Clerk, Supervisor (Operation).
  - **Manage Restrictions** modal: "Selected Role Name: Client". "Select the restriction(s) you want to apply to the selected Role Names." Checkboxes:
    - Carrier Cost: "Hides shipping rates, carrier fees, and related cost information."
    - Carrier Account Data: "Hides carrier account numbers and billing details."
    - Rate Shopping Data: "Hides rate shopping usage and selected shipping options."
    - Cancel / Save.
  - **Add/Edit Role** drawer: Name*, Description*, Role Category* (Operation / Client). Below is a **permission matrix**: collapsible sections with "(granted/total)" counters. Each page is a column with a header checkbox that toggles all, and an action checkbox list underneath. The full tree as configured for Supervisor (unchecked items marked ✗):
    - **Fulfillment (70/73)**
      - Outbound (45/46)
        - Shipment Orders (37/38): View, Create, Edit, Delete, Import File, Import Serial Numbers, Import Shipped File, Change Log, Cancel, Ship Order, Create Label, Void Label, Picking/Job Operations, Cancel Picking, Change Warehouse, Tag, Print Picking List, Batch Picking List, Print Packing Slip, Create Back Order, Change Status, Shipment Label Upload (SO Details), Reprint Label, Other Documents Upload (SO Details), Create New Product (SO Details), Create RMA, Remove Serial Number, Custom Field Management, Create Retailer Label, Reprint Retailer Label, Download Billing Charges, Pick/Pack Short Label, Pick Short, Pack Short, Override Order Allocation Cancellation Warning, Print Manifest / BOL, Unmerge Order, Create Return Label ✗
        - Carrier Shipment Details: View
        - End Of The Day: View, Print Custom Report, Print End Of The Day Report
        - Packing Station: View, Edit Ship To Address, Print Packing Slip, Report Issue
      - Task Management (13/15)
        - Job Management: View, Print Job Pick List, Assign, Cancel, Update Priority, Unassign, Print Job Content, Print Packing List ✗, Print Mobile Cart Layout ✗, Override Job Cancellation Warning, Print Pick Short Consolidation
        - Task Details: View, Execute Task, Cancel Task, Update Task
      - Shipment (12/12)
        - Shipment History: View
        - Shipment Plan: View, View Plan Orders, View Plan LPs, Create, Edit, Delete, Ship Order, Picking/Operations, Change Status, Print Manifest / BOL, Custom Field Management
    - **Inventory (67/67)**
      - Inbound
        - Purchase Orders: View, Create, Edit, Delete, Import File, Import Serial Numbers, Change Log, Cancel Order, Receive PO, Change Status, Download Billing Charges, Custom Field Management, Upload Documents, Tag, Product Label, Purchase Order Label, Remove Serial Number, Create New Product (PO Details)
        - Receiving History: View, Cancel
        - Return Station: View
        - Return Orders: View, Change Status, Tag
        - Work Orders: View, Create, Edit, Delete, Create Kit, Disassemble Kit, Tag, Picking/Job Operations, Cancel Picking, Custom Field Management, Import File
      - Inventory
        - Total Inventory: View
        - Inventory by Location: View, Import File, Add Inventory by Line, Adjust Inventory by Line, Remove Inventory by Line, Change Attributes, Transfer LP/Location, Transfer Product, Add Inventory by Attributes, Transfer Product - Convert to UOM
        - ATP: View
      - Count Operations
        - Count Plans: View, Create, Edit, Delete, Import File, Cancel, Update Inv., Create Job
        - Count Plan Location Details: View, Delete, More Details, Cancel, Create Recount, Update Inv.
        - Count Plan SKU Details: the same as Location Details
    - **Automation (22/22)**
      - Algorithms: View, Create, Edit, Delete, Change Log, Test
      - Workflows: View, Create, Edit, Delete, Change Log
      - Rate Shopping: View, Create, Edit, Delete, Change Log
      - Wave Rules: View, Create, Edit, Delete, Change Log, Run
    - **Integrations (6/6)**: Integrations (Create Setup, Edit Setup, Delete Setup); Integration Logs View; Integration Monitoring View; Carrier Monitoring View
    - **Reports (18/18)**: Analytics View; Shortage Report; Channel Sales Report; Kit Inventory; Dynamic Replenishment Report; Inventory Snapshot Report; Inventory Kit Component Availability Report; Serial Number Tracking Report; Order Inventory Report; Excel Export History; Change Log; Transaction History; Inventory Missing Log; Serial Number Transaction History; Wave Exceptions; Wave Log Report; PO Receiving Report; User Performance Report (all View)
    - **Settings (116/121)**
      - Master Data
        - Retailers: View, Create, Edit, Delete, customFieldManagement
        - Products: View, Create, Edit, Delete, Import File, Change Log, Label, Custom Field Management
        - Product Listing: View, Import File, Search a Product, Tag, Manage Tags
        - Locations: View, Create, Edit, Delete, Import File, Change Log, Custom Field Management, Assign Capacity, Label
        - Vendors: View, Create, Edit, Change Log
        - Customers: View, Create, Edit, Delete
      - Configuration
        - Warehouse: View, Create, Edit, Delete, Change Log
        - Mobile Carts: View, Create, Edit, Delete, Label, Duplicate
        - LP Types: View, Create, Edit, Delete, Custom Field Management
        - LP Numbers: View, Create, Edit, Import File, Change Log, Print Barcode
        - Shipment Packages: View, Create, Edit, Delete, Custom Field Management ✗
        - Printouts & Labels: View, Create, Edit, Delete, Change Log, Duplicate
        - Data Setup: View
        - Job Types: View, Create, Edit, Delete, Change Log
        - Screen Configuration: View, Create, Edit, Delete, Duplicate
        - Barcode Templates (0/4): View ✗, Create ✗, Edit ✗, Delete ✗
      - Client Setup
        - Clients: View, Create, Edit, Delete, Change Log, Import File
        - 3PL Billing: View, Create, Edit, Delete, Change Log, Calculate, Copy
        - Billing Report: View, Delete, Approve, Cancel
        - VAS Operations: View, Create, Edit, Delete, Import File
      - Users
        - Users: View, Create, Edit, Change Log, Import File
        - Roles: View, Create, Edit, Delete, Change Log, Manage Restrictions
      - Other Settings: Change Password View; My Profile View; Company Settings (View, Update); Add-Ons View
    - **Mobile (66/68)**
      - Sorting: View Sorting, View Sorting Operations, View Sorting Control
      - VAS Entry: View
      - Picking: View Picking, View Pick to Location, View Pick and Sort, Pick Your Jobs, Pick Jobs From Pool, Pick Specific Orders, Damaged Action, Missing Action, Skip Action, Alternate License Plate ✗, Inventory Lookup By LP Product ✗
      - Receiving: View Receiving, Damaged Action, Create New Product, Capture Product Photo, Edit Product Physical Attributes, Edit Product Physical Attributes during Receiving Verification
      - Transfer (13): View Transfer, View Transfer Product, View Transfer LP/Tote, View Transfer Location, View Directed Putaway, View LP Put Away in Directed Putaway, View Product Put Away in Directed Put Away, View Convert to UOM option under Bulk Product Transfer, under One-by-One Product Transfer, under Bulk Product Directed Putaway, under One-by-One Product Directed Putaway, Sequential LP Putaway, Action Button in Screens
      - Replenishment: View, View Direct Put, View Pick & Put, Replenish a Job From the Assigned Jobs, From the Job Pool, From Scan or Enter, Missing Action, Skip Action, Damaged Action, Cancel Task
      - Loading: View Loading
      - Shipment: View Ship Location, View Ship With Shipment Plan
      - Count
        - Cycle Count: View Count, View Your Jobs, View Job Pool, Complete Count & Update Inventory, Skip Location option in action button in Location Confirmation, Mark as damage option in action button in Product Confirmation, Reset Location Count, Complete Location Count
        - Instant Count: View Instant Count, Create New Instant Count, Resume Active Instant Count, Reset Location Count, Cancel Location Count, Complete Count & Update Inventory, Cancel Instant Count, Mark as Damaged
      - Look Up: View Look Up
      - Others / Profile(Mobile): Change Password, Change Warehouse, Device Settings, Language
    - **Analytics (2/2)**: Labor Analytics View; Operational Analytics View
    - Footer: Cancel / Save.

---

## My Profile — `en/account/user/profile/form`
- Header "Profile", "Edit your account details and preferences from the My Profile page. Learn more here." (Intercom link).
- A left form card with a right-side vertical sub-nav: **My profile** `/en/account/user/profile/form` · **Change password** `/en/account/user/password/form` · **Preferences** `/en/account/user/preferences/form`.
- My profile: "Create your Logiwa profile." Fields: Display name*, First name*, Last name*, Email*, Language* (English). Button **UPDATE MY PROFILE**.
- Change password: "Please ensure that your password is unique and strong to prevent misuse of your account." Fields: Old password*, New password, Reenter password*. Button **CHANGE PASSWORD**.
- Preferences: "Choose your default language and number formats. You can also view the time zone, date format, and time format used by the system."
  - Timezone (read-only "GMT-06:00 (Central Standard Time)")
  - Date format* (dd/MM/yyyy, MM/dd/yyyy, yyyy/MM/dd)
  - Time format* (12 hour am/pm, 24 hour)
  - Number format* (Thousand Separator e.g. 1,025.00 / Decimal Separator e.g. 1.025,00)
  - Button **Save And Apply Changes**

## Company Settings — `en/account/settings/company/basic`
- Header "Company Settings", "Define your company by adding Display Name, Full Name and Company Logo."
- Company information, "Create a profile for your company.": Company display name*, Company full name*, Company Logo (upload; "Add File"; "Accepts images for jpg, jpeg, png formats that are less than 2 MB"; × to remove). Button **UPDATE COMPANY INFO**.
- Right sub-nav: Company information · **Account defaults** (`/en/account/settings`, which redirected back to basic in testing, so its contents are unknown).

## Data Setup — `en/account/settings/datasetup/*` (lookup tables)
- Breadcrumb `Home > Settings > <Section>`. Header "Data Setup". A right-side sub-nav lists each lookup table and its route:

  | Lookup | Route |
  |---|---|
  | Auto Code Generation Preferences | `code-generation` |
  | Purchase Order Type | `purchase-order-type` |
  | Shipment Order Type | `shipment-order-type` |
  | Order Merge Rule | `order-merge-rule` |
  | Work Order Type | `work-order-type` |
  | Damage Reasons | `damaged-reasons` |
  | Pack Type | `pack-types` |
  | Product Type | `product-types` |
  | Product Group | `product-groups` |
  | Location Group | `location-group` |
  | Location Zone | `location-zone` |
  | VAS Type | `vas-type` |
  | Mobile Cart Type | `mobile-cart-type` |
  | Packing Warning Type | `packing-warning-type` |
  | Custom Carrier | `custom-carrier` |
  | Return Process | `return-process` |
  | Inventory Adjustment Reason | `inventory-adjustment-reason` |
  | Shipment Order Cancel Reason | `shipment-order-cancel-reason` |

- Auto Code Generation Preferences: "Automate shipment order codes to simplify your order traceability and avoid wasting time". A choice between "Auto Generate Order Codes As" and "Keep Adding Codes Manually Each Time", with Prefix* and Code* (start number) fields and Save.
- Typical lookup page (VAS Type): H1 = lookup name, CTA **Create New VAS Type**, and a grid NAME | STATUS (Active) | •••. Values: Special Project, Return Additional Item, Cycle Count (hours), Programming (hours), Grade B Pallet, Customer Pickup. The create drawer has VAS Type Name*, Status Active/Passive, VAS Calculation Type Name* (Total Price / Vas Quantity), Cancel/Save.

## Clients — `en/account/client` → `/client/list` (seen briefly)
- Breadcrumb `Home > Settings > Organization`. H1 "Clients", helper "Define your customers (clients) and set up preferences.". Buttons **Bulk Import/Update**, **Create Client**.
- Tabs: CLIENT | CUSTOMER | VENDORS | RETAILERS (BETA).
- Toolbar: Filter and **Delete** (bulk). Grid columns: checkbox | CLIENT | OFFICIAL NAME | FULL NAME | TAX ID. Total 31. Client detail and create were not walked (they are covered by the master-data cluster).

---

## Gaps / not accessible
- Printout Designer (opens a separate designer window). Screen Configuration › Configuration tab (requires save). Replenishment and Work Order job-type Settings/Conditions. Count "Order by Count Method" options. Company "Account defaults" contents. App settings gear panels. The Help Center and Screen Recording popups (blocked as external popups).
- No notifications center and no web warehouse switcher exist in Logiwa. These are differentiation opportunities for KitStaks, along with a record-level global search, clickable status-breakdown drilldowns, and inline validation messages.
