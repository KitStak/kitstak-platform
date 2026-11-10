# Logiwa iO — Reports & Analytics (cluster 07)

Captured 2026-11-05 from https://my.logiwa.com (sandbox; warehouses "MLT1 - Test Warehouse" and "Team 1 Supplier Service" both exist; MLT1 warehouse id `4a7c3492-8275-47ed-ae54-ac916a6e3b44`). Only read-only actions were taken. One wizard (Create Work Order) was walked to its last step and cancelled; nothing was saved.

Legend: `*` after a column = sortable (Kendo `aria-label="Sortable"`). "(i)" = column header has a `?` tooltip, with the tooltip text quoted.

---

## 0. Shared report-page framework (applies to every grid report below)

Build this once as a reusable `ReportGrid` shell; every report is configuration on top of it.

**Page header**
- Breadcrumb: `Home > Reports > <Report Name>`. Wave Log and Allocation Exceptions use `Home > Orders > Allocation Exceptions > ...` instead.
- H1 title. A one-line grey description sits to the right of the title or under it, sometimes with a "Read more" or "Click here to learn more" link to the Intercom help center (e.g. ATP links to `intercom.help/mylogiwa/en/articles/3652879-available-to-promise-atp-report`). Some titles have an info `(i)` icon with the same text as a tooltip.
- Optional **tab strip** of uppercase links that are separate routes. Sibling reports are grouped as tabs (see each page).

**Toolbar (left to right)**
1. **Quick search with comparator.** A list-icon button with a chevron opens a popover titled "Search Content" with radio buttons **Equal** / **Starts With** (Equal is the default) and an **Apply** button. Next to it is a text input whose placeholder names the searched key (e.g. "Search by SKU", "Search by order code", "Search by wave no"), then a magnifier button.
2. **Filter ▾** button. It opens the filter popover (described below).
3. **Filter summary chips.** Each applied filter shows as a chip with the field title, then the operator and value (e.g. "Warehouse / in MLT1 - Test Warehouse", "Snapshot Date / Within 1 Day(s) Past", "Period / Last 7 days"). Each chip has an × to remove it and a tooltip that shows the full value.
4. When filters are applied, two icon buttons appear:
   - **Save filter** (`filter-save.svg`): a dropdown panel titled "Save Filter" with a "Filter Name" input and a **Create New** button. It may also list existing saved filters to overwrite.
   - **Clear filter.**
5. On the right: **Refresh** icon button (tooltip "Refresh the table").

**Filter popover** (`.filter-popup-container`)
- Header: "Select Filter Type". A segmented control switches between **New** and **Saved**.
  - The Saved view is titled "Select Saved Filter Type", has a "Search saved filter" input, and lists the user's saved filters. It was empty in this sandbox.
- New view: a "Search Filter" input, then an alphabetical list of filterable fields. Each row has the field name, a **bookmark/pin icon** (probably pins the field as a quick filter; not clicked), and a **+** icon (adds the field).
- Clicking a field opens its sub-panel. The header has a back chevron and the field name. The editor depends on the field type:
  - **Multi-select enum:** a "Search Filter" box plus a checkbox list of values, sometimes with an "Empty" option. Button: **Add Filter**. Query operator `in`.
  - **Text:** an operator dropdown plus a text input whose placeholder is the field name. Operators: `equals` (default), `contains`, `starts with`, `ends with`, `exclude`, `empty`.
  - **Numeric range:** "Min" – "Max" inputs.
  - **Date / date-time:** a preset dropdown (default "Custom") with From/To pickers whose placeholder is "Enter date" or "Enter date/time". Presets: Custom, Today, Last 3 days, Last 7 days, Last 30 days, Last 90 days, Last 12 months, X Day(s) Ahead and More, X Day(s) Before and More, Within X Day(s) Past, Within X Next Day(s), Sunday … Saturday.
  - **Boolean:** Yes / No.
  - **Add Filter** stays disabled until a value is entered.
- Filter state is serialized into the URL querystring, so links are shareable. Example: `?wc=%255B%2522<warehouseId>%2522%255D&wcqt=in&wclbl=MLT1%20-%20Test%20Warehouse&ps=100`, where `wc` is the value array, `wcqt` the query type, `wclbl` the chip label and `ps` the page size. User Performance uses `period=7&periodqt=cst`.

**Grid** (Kendo Angular grid)
- Columns can be dragged to reorder (`kendodraggablecolumn`) and resized. Sortable columns show a sort indicator when clicked.
- Some reports have a checkbox selection column (Kit Inventory).
- Blue cells are links: order code, SKU, and similar keys open the related record.
- Empty state: a single row with "No records to display".
- **Column chooser:** a "Columns" icon button (`k-i-columns`) at the top-right of the header row. It opens a popup listing every column with a checkbox, plus an **Apply** button. In every report checked, all columns are visible by default (no hidden columns found).
- Row "..." actions (`myl-grid-action-three-dots`) open a `myl-grid-menu-popup` menu.

**Footer**
- Density toggle: **Large / Small** (Small is the default).
- Page size dropdown: "Show 100 items", with options 100, 300, 500, 700, 1000.
- Pager: first / prev, a page input "n / N", next / last.
- **Export As Excel** button (green outline). It runs as an asynchronous background task: the file appears in **Excel Export History**, and progress shows in the header's background-task icon ("View the progress and status of your background tasks. Completed transactions are cleared daily.").
- **Total: N** record count on the far right.

**Global filter dimensions** reused on almost every report:
- **Warehouse**: multi-select with "MLT1 - Test Warehouse" and "Team 1 Supplier Service".
- **Client**: multi-select with 31 clients, e.g. MLTest, testclient, DUDE Products LLC, Bulletpoint Mounting Solutions, Team 1, and others.

**Opportunities to beat Logiwa** (gaps observed):
- The Change Log shows raw i18n keys (`Logiwa.NameKey.RemainingVolume`).
- Integration Log details show "End Date 0NaN/NaN/NaN".
- The description on Dynamic Replenishment is the literal placeholder "Dynamic Replenishment Report description".
- There are typos: "requierements", "occuring", "were" instead of "where".
- Channel Sales shows a blank Warehouse column.
- Saved filters are per-page with no sharing.
- Labor and Operational Analytics are paywalled apps.

---

## 1. Reports mega-menu (top nav "Reports")

Hovering the top-nav item opens a multi-column mega menu (`lw-header--submenu`). Each column has an icon and a title, followed by child links.

| Column (icon) | Items → route |
|---|---|
| **Orders** (`orders.svg`) | Channel Sales Report → `/en/wms/report/channel-base-sale`; Shipment History → `/en/wms/shipment-order/shipment-history/list`; Shortage Report → `/en/wms/report/shortage` |
| **Inventory** (`inventory.svg`) | Available To Promise (ATP) → `/report/available-to-promise`; Kit Inventory Report → `/report/kit-inventory`; Kit Component Inventory Availability Report → `/report/kit-component-availability`; Serial Number Report → `/report/serial-number-report`; Order Inventory → `/report/order-inventory`; Dynamic Replenishment Report → `/report/replenishment`; Inventory Snapshot Report → `/report/inventory-snapshot` |
| **Logs** (`logs.svg`) | Change Log → `/report/change-log`; Transaction History → `/report/transaction-history`; Integration Log → `/integration/analytics/integration-history`; Missing Log → `/report/missing-log`; Serial Number Transaction History → `/report/serial-number-report/transaction-history`; Allocation Exceptions → `/job/allocation-exceptions`; Wave Log Report → `/job/wave-log`; Excel Export History → `/report/excel-export-history` |
| **Receiving** (`receiving.svg`) | PO Receiving Report → `/report/partial-receipt`; Receiving History → `/purchase-order/receipt/list` |
| **Warehouse Efficiency** (`warehouse-efficiency.svg`) | User Performance Report → `/report/user-performance` |

## 2. Analytics mega-menu (top nav "Analytics")

| Column (icon) | Items → route |
|---|---|
| **Labor Analytics** (`labor-analytics.svg`) | Average Task Analysis → `/en/wms/labor-analytics/average-task-analysis`; Associate Task Analysis → `/labor-analytics/associate-task-analysis`; Performance Quadrant Analysis → `/labor-analytics/performance-quadrant-analysis`; Associate Analysis → `/labor-analytics/associate-analysis`; Receiving Performance Analysis → `/labor-analytics/receiving-performance-analysis` |
| **Operational Analytics** (`operational-analytics.svg`) | Inbound & Inventory Dashboard → `/operational-analytics/inbound-inventory`; Fulfillment Dashboard → `/operational-analytics/fulfillment`; Management Dashboard → `/operational-analytics/management`; Productivity Dashboard → `/operational-analytics/productivity` |

Note: the menu container also renders a hidden "BETA" tooltip ("What is BETA Version? It is a test version with most features…"), so some items may carry a BETA badge.

---

## Channel Sales Report
- URL `/en/wms/report/channel-base-sale`. Tab title "Channel Sales Report - Logiwa". Breadcrumb Home > Reports > Channel Sales Report.
- Description: "The Channel Sales Report lists the products that you sell via e-commerce channels and gives you an overview of the demand and revenue."
- Toolbar: Filter, Refresh. There is no quick search. Footer: density, page size, pager, Export As Excel, Total (7,267 rows across 73 pages).
- Columns (all visible by default): WAREHOUSE*, CLIENT*, CHANNEL*, STORE NAME*, SKU*, PRODUCT NAME*, BARCODE, PACK TYPE, SOLD QUANTITY* (i) "Total shipped QTY of the product.", # SHIPMENT ORDER* (i) "Total number of shipped orders that contains the product.", REVENUE* (i) "The total amount of income of shipped orders that contain the product." Revenue is formatted as `$0.00`.
- Filters:
  - Channel (multi): Empty, Amazon, AmazonFBA, BigCommerce, CartRover, Custom, eBay, Etsy, Loop Returns, Magento, QuickBooks Online, ShipStation, Shopify, Squarespace, Tiktok, Walmart, WooCommerce.
  - Client (multi).
  - No. of Shipment Orders (range).
  - Product Name (text).
  - Revenue (range).
  - SKU (text).
  - Sold Quantity (range).
  - Store name (text).
  - Warehouse (multi).
- Grain: one row per Client × Channel × Store × SKU (channel listing). Sample row: `testclient | Shopify | giftshoppers-usa | kit-item-umt3 | … | Unit | 0 | 0 | $0.00`. The same SKU appears once per store (Shopify "vroomtec" and ShipStation "ShipStation-1").
- Logic: aggregates **shipped** orders per channel listing. Quantity is the sum of shipped quantity, order count is the number of distinct shipped orders containing the SKU, and revenue is the sum of line revenue of shipped orders. The date window is not shown on the page (probably all-time; unknown).

## Shortage Report
- URL `/en/wms/report/shortage`. Breadcrumb Home > Reports > Shortage Report.
- Tab strip (shared with Job/Wave pages): WAVE RULES `/job/wave-rules`, JOB MANAGEMENT `/job/management`, ALLOCATION EXCEPTIONS `/job/allocation-exceptions`, WAVE LOG REPORT `/job/wave-log`, SHORTAGE REPORT (active).
- Quick search: "Search by order code" (Equal / Starts With). Toolbar: Filter, Refresh, Columns, Export As Excel. Total 358.
- Columns, in order:
  - ORDER CODE: blue link to the order.
  - STORE ORDER NAME
  - SKU: blue link.
  - PRODUCT NAME
  - ORDER CREATION DATE
  - ORDER TYPE: e.g. D2C Order, Partial Allocation D2C, BackOrder D2C.
  - SHORTAGE REASON (i): shown in red text (#E71C30). Tooltip: "Insufficient Inventory represents that there were 0 Total Free Inventory for the SKU in the last allocation trial time or the Order can be only fully allocated and the Total Free Inventory was less than the Order Line Pack Quantity. No Eligible Stock Found means the Total Onhand Quantity is not sufficient for the order. There is inventory for this SKU during allocation trial, however, the stock is unavailable due to Inventory Conditions in Allocation Algorithm."
  - MISSING TRIGGERED (Yes/No)
  - ORDER STATUS
  - ORDER LINE PACK QTY
  - LINE PACK TYPE
  - SHORTAGE PACK QTY
  - SHORTAGE UOM QTY
  - FREE PACK QTY
  - FREE UOM QTY
  - DAMAGED PACK QTY
  - DAMAGED UOM QTY
  - ON HAND PACK QTY
  - ON HAND UOM QTY
  - LAST ALLOCATION TRIAL TIME
  - WAREHOUSE
  - CLIENT
  - ORDER AGE (days, e.g. 17, 180)
  - EXPECTED SHIPMENT DATE
  - MASTER ORDER CODE
- Columns found sortable: none on this page.
- Filters:
  - Client (multi).
  - Expected Shipment Date (date-time presets).
  - Missing Triggered (Yes/No).
  - On Hand Pack Quantity (range).
  - Order Code (text).
  - Order Date (date-time).
  - Product SKU (text).
  - Shortage Pack Quantity (range).
  - Shortage Reason (multi): Insufficient Inventory, No Eligible Stock Found, Reserved For Replenishment.
  - Status (multi): Cancelled, Loading Started, On Hold, Open, Packing Started, Partially Shipped, Picking Started, Ready To Load, Ready to Pack, Ready to Pick, Ready to Ship, Ready to Sort, Shipped, Shortage, Sorting Started.
  - Store Order Number (text).
  - Warehouse (multi).
- MLT1 has 0 rows (empty state "No records to display").
- Sample: `SO0001 | | MISSKU1 | MISSKU1 | 10/19/2026 11:06:55 AM | D2C Order | Insufficient Inventory | Yes | Shortage | 1 | Unit | 1 | 1 | 0 … | 10/23/2026 10:25:31 AM | Team 1 Supplier Service | testclient | 17 | …`
- Logic: one row per order line that failed allocation at its last allocation trial. The free, damaged and on-hand figures are a snapshot of inventory at that trial. Order Age is today minus the order date.

## Available To Promise (ATP)
- URL `/en/wms/report/available-to-promise`. Tab title "Available To Promise Report - Logiwa".
- Description: "Available to promise (ATP) calculates the available quantity of a product to sell it. ATP helps you to manage demands and match them to purchasing plans. Read more for detailed explanations." The "Read more" link goes to Intercom.
- Tab strip (inventory family): TOTAL INVENTORY `/inventory/total`, INVENTORY BY LOCATION `/inventory/list`, AVAILABLE TO PROMISE (active), KIT INVENTORY `/report/kit-inventory`, KIT COMPONENT INVENTORY AVAILABILITY `/report/kit-component-availability`.
- Quick search: "Search by SKU". Toolbar: Filter, Refresh, Columns, Export. Total 11,546 rows across 116 pages. Grain: Warehouse × SKU (each SKU appears once per warehouse).
- Columns, with tooltips:
  - WAREHOUSE*, CLIENT*, SKU* (link), PRODUCT NAME*, BARCODE
  - KIT TYPE (i): "Indicates if a kit product is 'Kit to Order' or 'Kit to Stock'. Field is empty for standard, non-kit products."
  - TOTAL QUANTITY* (i): "total quantity (UOM) … including any damaged units".
  - DAMAGED QTY* (i)
  - UNDAMAGED QUANTITY* (i): Total minus damaged.
  - ALLOCATED SO ITEM QTY (i): "currently allocated from inventory to fulfill specific shipment orders".
  - OPEN SO QTY (i): "currently on unshipped shipment orders".
  - OPEN PO QTY (i): "expected to be received from open purchase orders".
  - CURRENT ATP* (i): **Undamaged Quantity − Open SO Qty**.
  - PLANNED ATP QTY* (i): **Current ATP + Open PO Qty**.
  - ON HAND QTY* (i): "non-damaged total product inventory in locations where sync inventory is not prevented".
  - SELLABLE QTY* (i): **On Hand Qty − Open SO Qty**.
  - PICKABLE QTY* (i): "non-allocated & undamaged product inventory that is located in locations where allocation is not prevented & location is not locked".
  - UNALLOCATED SO ITEM QTY* (i): "inventory qty demanded by existing shipment orders but not allocated yet".
- Filters:
  - Client (multi).
  - Current ATP (range).
  - Damaged Quantity (range).
  - Kit Type (multi): Empty, Kit to Order, Kit to Stock.
  - Open PO QTY (range).
  - Open SO QTY (range).
  - Planned ATP (range).
  - Product Name (text).
  - SKU (text).
  - Total Quantity (range).
  - Undamaged Quantity (range).
  - Warehouse (multi).

## Kit Inventory Report
- URL `/en/wms/report/kit-inventory`. H1 "Kit Inventory" with an (i) tooltip "The inventory levels of kit-to-order products can be monitored on this report." Same inventory tab strip as ATP.
- Quick search: "Search by SKU". Toolbar: **Create Work Order** button (disabled until one or more rows are checked), Filter, Refresh, Columns, Export. Total 1,550. MLT1 has 2 rows.
- Columns:
  - Row checkbox
  - WAREHOUSE*, CLIENT*, SKU*, KIT TYPE (Kit to Order / Kit to Stock), BARCODE, PRODUCT NAME*
  - PACK TYPE NAME, PRODUCT TYPE, PRODUCT GROUP*
  - PENDING ORDER QUANTITY*
  - NET KITTING CAPACITY*
  - TOTAL INVENTORY CAPACITY*
  - CURRENT INVENTORY QUANTITY*
  - REQUIRED KITTING QUANTITY*
  - LAST UPDATED: e.g. "11/5/2026 3:30:00 PM", recalculated on a schedule.
- Examples:
  - `MLT1 | MLTest | MLT-KIT-2PK | Kit to Stock | MLT000002 | MLTest 2 Pack Kit | Each | … | 0 | 22 | 24 | 0 | 0`
  - `MLT-KITTEST-KIT1 | Kit to Order | … | 0 | 3 | 3 | 0 | 0`
  - `DW-FP-18-6 … | 0 | 255 | 360 | 105 | 0`
- Inferred logic:
  - Net Kitting Capacity is the number of kits buildable from free component stock.
  - Total Inventory Capacity = Net Kitting Capacity + current kit stock (22 + 0 vs 24? The numbers do not fully reconcile; treat as unknown).
  - Required Kitting Qty = max(0, Pending Order Qty − Current Inventory Qty).
- Filters:
  - Client (multi).
  - Current Inventory Quantity (range).
  - Damage Reason (multi): Empty, Bad Packaging, Broken, Damaged, Extra, Leaking, Missing, OnHold, Quarantined.
  - Kit Type (multi).
  - Net Kitting Capacity (range).
  - Open Shipment Order Quantity (range).
  - Pack Type (multi): Case, Each, Pallet, Unit.
  - Product Group (multi): Empty.
  - Product Name (text).
  - Product Type (multi): Empty, Packaging.
  - Required Kitting Quantity (range).
  - SKU (text).
  - Total Inventory Capacity (range).
  - UPC (text).
  - Warehouse (multi).

### Wizard: Create Work Order (opened from Kit Inventory with 1 row selected)
A right-side **drawer** (ant-drawer) titled "Create Work Order" with a close ×. It has a 4-step pill stepper: **1.General → 2.Kit → 3.Advanced → 4.Other Info**. The footer has Cancel and Next on step 1, Back and Next on steps 2–3, and Back and **Save** on step 4.

1. **General**
   - Warehouse: dropdown, pre-filled from the row ("MLT1 - Test Warehouse") and disabled.
   - Client: dropdown, pre-filled ("MLTest") and disabled.
   - **Work Order Code*** (text, placeholder "Enter Work Order Code"). Validation message "Enter Work Order Code is required."
   - **Work Order Type*** (dropdown "Select Work Order Type"). Options: Work Order with Picking, Work Order without Picking.
   - Extra Note (textarea "Enter extra note").
   - **Build For**: a segmented toggle, **Stock** (default) or **SO**.
2. **Kit**
   - "Select Kit": "The kit-to-stock product selection for this work order". A dropdown pre-filled with the SKU, then a product card showing image placeholder, SKU, name, Pack Type, Lot Number Tracking Yes/No, Exp. Date Tracking Yes/No, Prod. Date Tracking Yes/No, and a numeric stepper for the kit qty (default 1).
   - "Components": "Components of the selected kit-to-stock product". Counters show "1 Component Qty" and "2 Total Qty". Each component card shows SKU, name, Pack Type, a read-only Qty (= BOM qty × kit qty), and chips Location: – / LP: – / Lot No: – / Exp Date: – / Prod Date: –. A pencil icon lets you edit or assign the specific source inventory.
3. **Advanced**
   - Kitting Instructions (textarea).
   - Planned Start Date, Planned Finish Date, Actual Start Date, Actual Finish Date (date pickers).
   - Document: "Upload documents for the kitting process", with an **Upload Document** file input.
4. **Other Info**
   - Text: "You can optionally add or edit custom fields under 'Other Info' tab."
   - **Add/Edit Custom Field** button.
   - **Save** creates the work order. Not executed.

Closing with unsaved changes shows a confirm modal: "You have unsaved changes! If you leave this form, all unsaved changes will be lost. Are you sure you want to leave this form?" with buttons **No** / **Leave**.

## Kit Component Inventory Availability Report
- URL `/en/wms/report/kit-component-availability`. Description: "Inventory levels and reorder requierements of kit product components can be monitored in this report." Inventory tab strip.
- Quick search: "Search by SKU". Toolbar: Filter, Refresh, Columns. Footer has Export. Total 341.
- Columns (none sortable): WAREHOUSE, CLIENT, COMPONENT SKU, COMPONENT PRODUCT NAME, PRODUCT TYPE, PRODUCT GROUP, INCLUDED KITS, TOTAL ORDER QUANTITY, TOTAL INVENTORY QUANTITY, TOTAL AVAILABLE INVENTORY QUANTITY, REORDER QUANTITY.
  - INCLUDED KITS is a comma list in a tooltip cell, e.g. "SKU1,KITTOSTOCK123".
- Sample: `Team 1 | testclient | SKU3 | TESTSKU3 | | | SKU1,KITTOSTOCK123 | 112 | 1197 | 1055 | 0`.
- Logic: Reorder Qty = max(0, Total Order Qty − Total Available).
- Filters:
  - Client (multi).
  - Component SKU (text).
  - Included Kits (text).
  - Product Group (multi).
  - Product Name (text).
  - Product Type (multi).
  - Reorder Quantity (range).
  - Total Available Inventory Quantity (range).
  - Total Inventory Quantity (range).
  - Total Order Quantity (range).
  - Warehouse (multi).

## Serial Number Report (Tracking)
- `/en/wms/report/serial-number-report` redirects to `/report/serial-number-report/tracking`. Tab title "Serial Number Tracking Report - Logiwa".
- Description: "The Serial Number Report helps you monitor both primary and secondary serial numbers' statuses in the system."
- Tabs:
  - TRACKING `/report/serial-number-report/tracking`
  - SERIAL NUMBER SHIPMENT HISTORY `/report/serial-number-report/shipment-history`
  - SERIAL NUMBER RECEIVING HISTORY `/report/serial-number-report/receiving-history`
- Quick search: "Primary Serial Number". Toolbar: Filter, Refresh. There is no Columns or Export button (the sandbox has no data).
- Columns: WAREHOUSE*, CLIENT*, SKU*, PRIMARY SERIAL NUMBER, SECONDARY SERIAL NUMBER, ENTRY DATE TIME*, SERIAL STATUS*, (actions).
- Filters:
  - Client.
  - Primary Serial Number (text).
  - SKU (text).
  - Secondary Serial Number (text).
  - Serial Status (multi): Picked, Receipt Cancelled, Received, Shipment Order Cancelled, Shipped, Updated.
  - Warehouse.
- Empty state "No records to display".

### Serial Number Shipment History (tab)
- `/report/serial-number-report/shipment-history`. Quick search: Primary Serial Number.
- Columns: SKU, PRODUCT NAME, PRIMARY SERIAL NUMBER, SECONDARY SERIAL NUMBER, SHIPMENT ORDER CODE, STORE ORDER NUMBER, LOT BATCH NUMBER, EXPIRY DATE, PACK TYPE, BARCODE, SHIPMENT DATE TIME, SHIPMENT ORDER TYPE, NOTE, WAREHOUSE, CLIENT, LOCATION, LP NUMBER, PARENT LP, CARRIER, TRACKING NUMBER.
- Filters:
  - Carrier (multi): Empty, Cheapest, DHL Express from ShipStation (ShipStation), FedEx (ShipStation), FedEx One Balance (ShipStation), GlobalPost (ShipStation), SEKO LTL by ShipStation (ShipStation), Stamps.com (ShipStation), UPS, UPS by ShipStation (ShipStation), UPS by Worldwide Express (ShipStation).
  - Client.
  - Expiry Date (date).
  - LP Number, Lot Batch Number, Parent LP Number (text).
  - Primary Serial Number, SKU, Secondary Serial Number (text).
  - Serial Status (multi).
  - Shipment Date (date-time).
  - Shipment Order Code, Store Order Number, Tracking Number (text).
  - Warehouse.

### Serial Number Receiving History (tab)
- `/report/serial-number-report/receiving-history`.
- Columns: RECEIPT ID, SKU, PRODUCT NAME, BARCODE, PURCHASE ORDER CODE, PRIMARY SERIAL NUMBER, SECONDARY SERIAL NUMBER, LOT BATCH NUMBER, EXPIRY DATE, PACK TYPE, RECEIVING TYPE, RECEIVING DATE, PURCHASE ORDER TYPE, NOTE, WAREHOUSE, CLIENT, LOCATION, LP NUMBER, PARENT LP, DAMAGE REASON NAME, DAMAGE REASON IMAGE, RECEIVING USER, VENDOR.
- Filters:
  - Client.
  - Damage Reason (multi).
  - Expiry Date.
  - LP Number, Location, Lot Batch Number, PO Number (text).
  - Pack Type (multi).
  - Parent LP Number, Primary Serial Number (text).
  - Purchase Order Type (multi): Empty, Open Order, Purchase Order, Purchase Order- Non Crossdock, Return Order, Transfer Order.
  - Receipt Date (date-time).
  - Receipt ID, Received By (text).
  - Receiving Type (multi): Add Inventory, DisassembleKit, Kitting, Product Receive, Purchase Order, Return.
  - SKU, Secondary Serial Number, Vendor Display Name (text).
  - Warehouse.

## Order Inventory Report
- URL `/en/wms/report/order-inventory`. Description: "View the locations of products allocated for shipment orders".
- Quick search: "Search by order code". Toolbar: Filter, Refresh, Columns, Export. Total 38.
- Columns:
  - ORDER CODE*, WAREHOUSE*, CLIENT*, STORE ORDER NUMBER*, JOB CODE*, WORK ORDER CODE*, WAVE NO*, SKU*
  - PACK TYPE, UOM PACK TYPE, BARCODE, ALLOCATED UOM QTY, ALLOCATED PACK QTY
  - INVENTORY STATUS*, LOCATION*, LPN*
  - PARENT LP, ORIGINAL LP NUMBER, ORIGINAL PARENT LP, PARENT LP TYPE
  - LOT / BATCH NUMBER, EXPIRY DATE, DAMAGE REASON, PO NUMBER, PRODUCTION DATE, RECEIVING DATE
  - LPN WEIGHT, LPN WEIGHT UNIT, LPN HEIGHT, LPN LENGTH, LPN WIDTH, LPN DIMENSION UNIT
- Sample: `SO0006 | Team 1 | Bulletpoint Mounting Solutions | | Job6212280 | | | BMS-2Hole_Flange | Unit | Unit | | 1 | 1 | Allocated | B2002 | …`
- Filters:
  - Client.
  - Damage Reason (multi).
  - Expiry Date.
  - Job Code, LP Number, Location, Lot Batch Number, Parent LP Number, Parent LP Type, Product SKU, Shipment Order (text).
  - Status (multi): Allocated, Loaded, Packed, Picked, Sorted, Stock.
  - Store Order Number (text).
  - Warehouse.
  - Work Order Code (text).
- Logic: one row per allocation record (order line × inventory lot/location/LP). The inventory status moves through Allocated → Picked → Sorted → Packed → Loaded.

## Dynamic Replenishment Report
- URL `/en/wms/report/replenishment`. Tab title "Replenishment Report - Logiwa". The description is the unfilled placeholder "Dynamic Replenishment Report description".
- Quick search: "Search by SKU". Toolbar: Filter, Refresh, Columns, Export. Total 8.
- Columns:
  - WAREHOUSE, CLIENT, SKU*
  - MIN REPLENISHMENT LEVEL*, MAX REPLENISHMENT LEVEL*
  - SOURCE LOCATION TOTAL QUANTITY*, SOURCE LOCATION FREE QUANTITY*
  - TARGET LOCATION AVAILABLE QTY*
  - OPEN ORDER QUANTITY*
  - OPEN REPLENISH TASK QTY
  - TO REPLENISH QUANTITY (i): "calculated by adding the Max Replenishment Level and Current Open Order Quantity, then subtracting the Available Stock on picking locations and Open Replenish Tasks Qty."
- **Formula: ToReplenish = Max + OpenOrderQty − TargetAvailable − OpenReplenishTaskQty.** Verified on sample data: SKU3 gives 200 + 74 − 85 − 0 = 189.
- Sample rows:
  - `MLT1 | testclient | SKU4 | 5 | 50 | 0 | 0 | 0 | 0 | 0 | 50`
  - `Team 1 | testclient | SKU2 | 5 | 50 | 302 | 299 | 50 | 90 | 0 | 90`
- Filters:
  - Client.
  - Open Order Quantity (range).
  - SKU (text).
  - Show Only Active Products (Yes/No).
  - To Replenishment Quantity (range).
  - Warehouse.
- Wave Log shows a "Dynamic Replenishment" wave rule that turns this demand into replenishment tasks.

## Inventory Snapshot Report
- URL `/en/wms/report/inventory-snapshot`. No description. **Default filter chip: "Snapshot Date — Within 1 Day(s) Past"**.
- Quick search: "Search by SKU". Toolbar: Filter, Save filter, Clear filter, Refresh, Columns, Export. Total 1,192.
- Columns:
  - WAREHOUSE, CLIENT
  - SNAPSHOT DATE*: daily, e.g. "11/5/2026 12:02:38 AM", so snapshots are taken about 00:02 each day.
  - SKU*, LOCATION*, LP NUMBER*, UOM QTY*, PACK QTY*, LOT BATCH NUMBER*, EXPIRY DATE, DAMAGE REASON, PARENT LP NUMBER*, UOM PACK TYPE*, PACK TYPE*
  - INVENTORY STATUS*: Stock / Allocated / Packed / …
  - PRODUCT HEIGHT*, PRODUCT LENGTH*, PRODUCT WEIGHT*, PRODUCT WIDTH*
- Sample: `MLT1 - Test Warehouse | MLTest | 11/5/2026 12:02:38 AM | MLT-WIDGET-01 | MLT1-A-01 | | 4 | 4 | … | Each | Each | Allocated | 4 | 10 | 2 | 8`.
- Filters:
  - Client.
  - Damage Reason.
  - Expiry Date.
  - LP Number, Location, Lot Batch Number (text).
  - Pack Type (multi).
  - Parent LP Number, Product SKU (text).
  - Production Date (date).
  - **Snapshot Date**: a single "Within X Day(s) Past" preset with an "N day" numeric input.
  - Status (multi): Allocated, Loaded, Packed, Picked, Sorted, Stock.
  - UOM Pack Type (multi).
  - Warehouse.
- Logic: a nightly job copies on-hand inventory rows (location × LP × lot × status). The report is used for point-in-time and billing reconciliation.

## Change Log
- URL `/en/wms/report/change-log`. Description: "Change Log report helps you monitor all the changes occuring in the system".
- Quick search: "Search by code". Toolbar: Filter, Refresh, Export. There is no Columns button. Total 76,786.
- Columns: TYPE* (Create/Update/Delete), CHANGED MODULE*, CODE*, CHANGED PROPERTY*, CHANGED FROM, CHANGED TO, TRANSACTION DATE*, SOURCE* (user email or Integration), plus a blank trailing column.
- Samples:
  - `Update | Purchase Order | KS-TEST-PO-002 | Logiwa.NameKey.PurchaseOrderStatusName | Pending | Cancelled | 11/5/2026 3:46:50 PM | mike@team-01.com`
  - `Create | Wave Rule | KS-TEST MLT1 Picking Rule | | | | …`
  - `Update | Warehouse Location | MLT1-RECV | Logiwa.NameKey.RemainingVolume | 0.0 | -1.00`
- Modules seen: Purchase Order, Purchase Order Line, Wave Rule, Warehouse Location, Shipment Order, Shipment Order Line.
- Properties seen: status, RemainingVolume, OccupiedVolume (+ByDims, LP variants), CompletedDateTime, Actual Receiving Date, ReceivedUOMQuantity, LastRunDateTime, NextRunDateTime, LastWaveNo, RunCount, Shipment Address fields, AddressVerificationNotes[n], HasKit.
- Filters:
  - Changed Module (text).
  - Code (text).
  - Event Type (multi): Create, Delete, Update.
  - Source (text).
  - Transaction Date (date-time).
- **No warehouse or client filter**: the log is account-wide.
- Build better than Logiwa: show human-readable property labels and an entity deep-link.

## Transaction History
- URL `/en/wms/report/transaction-history`. Description: "Transaction History report helps you monitor all the transactions occuring within the inventory".
- Tabs: TRANSACTION HISTORY (active), SERIAL NUMBER TRANSACTION HISTORY.
- Quick search: "Search by SKU". Toolbar: Filter, Refresh, Columns, Export. Total 1,626.
- Columns (50):
  - TRANSACTION TYPE*, WAREHOUSE*, CLIENT*
  - SHIPMENT ORDER CODE*, ORIGINAL ORDER CODE, SHIPMENT ORDER TYPE*
  - PURCHASE ORDER CODE*, PO NUMBER*, RMA NUMBER, RECEIVING DATE*
  - WORK ORDER CODE*, ALGORITHM NAME*, ALGORITHM RULE NAME*
  - SKU*, PRODUCT NAME*, BARCODE, FROM PACK TYPE, TO PACK TYPE, UOM PACK TYPE, ADJUSTMENT REASON
  - SOURCE LOCATION*, FROM LOCATION GROUP, FROM LOCATION AREA TYPE
  - TARGET LOCATION*, TO LOCATION GROUP, TO LOCATION AREA TYPE
  - SOURCE LPN*, FROM ORIGINAL LP*, TARGET LPN*, TO ORIGINAL LP*
  - SOURCE PARENT LP, FROM ORIGINAL PARENT LP, SOURCE PARENT LP TYPE
  - TARGET PARENT LP, TO ORIGINAL PARENT LP, TARGET PARENT LP TYPE
  - COUNT PLAN CODE, ACTION UOM QUANTITY, ACTION PACK QUANTITY
  - FROM DAMAGE REASON, TO DAMAGE REASON, FROM EXPIRE DATE, TO EXPIRE DATE, FROM LOT / BATCH, TO LOT / BATCH
  - TRANSACTION DATE*, TRANSACTION USER*
  - FROM PRODUCTION DATE, TO PRODUCTION DATE, NOTE
- Samples:
  - `Receiving | MLT1 | MLTest | | | | KS-TEST-PO-001 | … | MLT-WIDGET-01 | MLTest Widget | MLT000001 | Each | Each | Each | | MLT1-RECV | | Receiving | MLT1-RECV | | Receiving | … | 10 | 10 | … | 11/5/2026 3:41:31 PM | mike@team-01.com`
  - `Allocation | Team 1 | Bulletpoint | SO0004 | | D2C Order | … | D2C Default | Default | BMS-2BallerFlange | … | PS1 | | Packing | …`
- Filters:
  - Client.
  - Count Plan Code (text).
  - From Damage Reason (text).
  - From Expiry Date (date).
  - From LP Number, From Location, From Lot Batch, From Parent LP Number, From Parent LP Type (text).
  - Original Shipment Order Code, PO Number (text).
  - Pack Quantity (range).
  - Product Name, Purchase Order Code (text).
  - Receiving Date (date).
  - SKU, Shipment Order Code, Shipment Order Type (text).
  - To Damage Reason (text), To Expiry Date (date), To LP Number, To Location, To Lot Batch, To Parent LP Number, To Parent LP Type (text).
  - Transaction Date (date-time).
  - **Transaction Type (multi)**: Allocation, Allocation Cancel, Attributes Change, Cancel Receiving, Count, Disassemble Kit, Inventory Adjustment, Inventory Movement, Kitting, Loading, Packing, Picking, Receiving, Replenishment, Return Receiving, Shipment, Sorting, Unloading.
  - Transaction User (text).
  - Warehouse.
  - Work Order Code (text).
- Logic: an immutable inventory ledger with from/to state for every attribute (location, LP, parent LP, lot, expiry, production date, damage, pack type).

## Serial Number Transaction History
- URL `/en/wms/report/serial-number-report/transaction-history`. Same header and tabs as Transaction History. Quick search: "Primary Serial Number". Toolbar: Filter, Refresh. Empty.
- Columns: TRANSACTION TYPE, SKU, PRODUCT NAME, PRIMARY SERIAL NUMBER, SECONDARY SERIAL NUMBER, SERIAL STATUS, WAREHOUSE, CLIENT, SHIPMENT ORDER CODE, ORIGINAL ORDER CODE, PURCHASE ORDER CODE, FROM LOCATION, TO LOCATION, FROM LP NUMBER, TO LP NUMBER, SOURCE PARENT LP, SOURCE PARENT LP TYPE, TARGET PARENT LP, TARGET PARENT LP TYPE, DAMAGE REASON NAME, EXPIRY DATE, LOT BATCH NUMBER, STORE ORDER NUMBER, TRANSACTION DATE, TRANSACTION USER.
- Filters:
  - Client.
  - Damage Reason (multi).
  - Expiry Date.
  - LP Number, Location, Lot Batch Number, Original Shipment Order Code, PO Number, Primary Serial Number, SKU, Secondary Serial Number (text).
  - Serial Status (multi).
  - Shipment Order Code, Transaction Type, Transaction User (text).
  - Warehouse.

## Missing Log Report
- URL `/en/wms/report/missing-log`. Description: "The Missing Log Report gives in-depth details about what has been marked missing, when, and were."
- Quick search: "Search by SKU". Toolbar: Filter, Refresh, Columns, Export. Total 2.
- Columns: WAVE ID*, JOB CODE*, SHIPMENT ORDER CODE*, SKU*, PRODUCT NAME*, PACK TYPE, BARCODE, LPN*, PARENT LP, PARENT LP TYPE, MISSING PACK QUANTITY*, LOCATION*, INVENTORY QUANTITY*, ENTRY DATE*, ENTERED BY*, NOTES, WAREHOUSE*, CLIENT*.
- Sample: ` | Job6062749 | SO0001 | MISSKU1 | MISSKU1 | Unit | | | | | 25 | a-1-3 | 0 | 10/20/2026 10:35:53 AM | team1supplier@logiwa.com | | Team 1 Supplier Service | testclient`
- Filters:
  - Client.
  - Entry Date (date-time).
  - Expiry Date.
  - Is Retain (Yes/No).
  - LP Number, Location, Lot Batch Number (text).
  - Pack Type (multi).
  - Parent LP Number, Parent LP Type, Product Name, Product SKU, Shipment Order Code (text).
  - Warehouse.
- Logic: written when a picker reports a short pick ("missing") on a job. This sets "Missing Triggered" on the Shortage Report and zeroes or adjusts inventory at the location.

## Wave Log Report
- URL `/en/wms/job/wave-log`. Tab title "Wave Log - Logiwa". Breadcrumb Home > Orders > Allocation Exceptions > Wave Log Report. Uses the Job tab strip (Wave Rules / Job Management / Allocation Exceptions / Wave Log Report / Shortage Report).
- Quick search: "Search by wave no". Toolbar: Filter, Refresh, Columns, Export. Total 101.
- Columns:
  - RULE SET*
  - WAVE NO*: format `<ruleId>-<runCount>`, e.g. 20522-94.
  - WAVE STATUS
  - # OF ORDERS MET RULE SET CRITERIA (i): "Number of orders that have met the criteria in the Wave rule filters."
  - # OF SHORTAGE ORDERS
  - # OF JOBS CREATED
  - # OF ALLOCATED ORDERS
  - # OF MERGED ORDERS CREATED
  - RUN DATE*
  - RUN BY: "Integration" for scheduled runs, or a user name.
  - MESSAGE
- Status renders as plain text, not a pill.
- Samples:
  - `Priority Shipping | 20522-17 | Completed | 35 | 20 | 3 | 15 | 0 | 10/12/2026 3:43:15 PM | Team 1 Supplier Admin`
  - `Order Merge Default | 20536-1 | Completed | 257 | 0 | 0 | 0 | 8 | …`
  - Scheduled rule "Priority Shipping Bulletpoint" runs twice daily (7:00 AM and 1:00 PM) as Integration.
- Filters:
  - Rule Set (multi): Empty, 6 month Cycle Count Wave, Dynamic Replenishment, KS-TEST MLT1 Picking Rule, Order Merge Default, Priority Shipping Bulletpoint.
  - Run Date (date-time).
  - Status (multi): Completed, Failed, In Progress, Optimization Completed, Optimizing, Pending, Preparing For Optimization, Started.
  - Warehouse.
  - WaveNo (text).
- Logic: there is one log row per execution of a wave rule (manual or scheduled). The counts satisfy: met criteria = shortage + allocated (35 = 20 + 15). Jobs are created from the allocated orders.

## Allocation Exceptions (in Logs menu)
- URL `/en/wms/job/allocation-exceptions`. Tab title "Wave Order Details - Logiwa". Job tab strip.
- Quick search: "Search by wave no". Toolbar: Filter, Refresh, Columns, Export.
- Columns:
  - ORDER CODE*
  - WAVE NO*: a wave number, or "Manual Allocation" / "Manual Allocation - Work Order".
  - WAVE RULE SET NAME*
  - ALLOCATION ALGORITHM RULE NAME (i): "Name of the rule in the allocation algorithm that caused a shortage."
  - SHORTAGE SKU* (i)
  - INVENTORY UOM QTY (i): "Inventory quantity of the item at the time of allocation. If the order is not allocated even though there is enough inventory, then the inventory was not found suitable by the allocation algorithm."
  - ORDER LINE QTY (UOM) (i)
  - ALLOCATION ALGORITHM: e.g. "D2C Default".
  - EXPLANATION
  - IS ROLLBACKED? (i): "Even though there was sufficient inventory, order allocation can be rolled back based on the # of orders set up in the job type."
  - RUN BY USER, RUN DATE*, CLIENT, WAREHOUSE
- Explanation values: "Shortage", "Eliminated by 'Multi Item' Condition(s)", "Eliminated by 'Single Item' Condition(s)", "Eliminated by Job Type 'Advanced' Condition(s)", "Order bypassed: All items are currently out of stock".
- Filters:
  - Client.
  - Explanation, Order Number, Run By User (text).
  - Run Date (date-time).
  - Warehouse.
  - Wave Ruleset Name (multi).
  - WaveNo (text).

## Excel Export History
- URL `/en/wms/report/excel-export-history`. No description, no filter and no quick search: only a disabled "Search" box in the header, plus Refresh and Columns. Total 1.
- Columns:
  - EXPORT TYPE*: e.g. "Warehouse Count Plan Detail".
  - ACTION: a download icon plus a "Download" link (Azure blob URL, opens in a new tab).
  - EXPORT DATE*
  - ROW COUNT*
  - ERROR MESSAGE*
  - STATUS*: a pill.
  - Row "..." menu: **Download**.
- Status pills (CSS): base `padding 5px 12px; radius 12px; 12px bold; bg #f7f7f7`.
  - **completed**: bg #28b5733d, text #28b573.
  - **started**: bg #d5e5f2, text #0d36a3.
  - **error**: bg #fbdbde, text #b20b1c.
- Logic: every "Export As Excel" click across the app enqueues an async job, writes a file to blob storage, and adds a row here. The header background-task tray shows progress, and completed entries are cleared daily.

## User Performance Report (Warehouse Efficiency)
- URL `/en/wms/report/user-performance`. It redirects to `?period=7&periodqt=cst&ps=100`, and the **default chip is "Period: Last 7 days"**.
- Description: "The User Performance Report summarizes user performances according to assigned tasks. This report helps to monitor your users' performances in a selected period. Click here to learn more."
- Quick search: "Search by executed name". Toolbar: Filter, Save/Clear filter, Refresh, Columns, Export.
- Grain: Warehouse × User × Activity Date (day).
- Columns:
  - WAREHOUSE*, USER*, ACTIVITY DATE* (yyyy-mm-dd)
  - PICKED ORDER QTY (i) "Order quantity picked by the user during the period."
  - PICKED ORDER LINE QTY (i), PICKED ITEM QTY (i)
  - PACKED ORDER QTY (i), PACKED ORDER LINE QTY (i), PACKED ITEM QTY (i)
  - REPLENISHED ITEM QUANTITY, REPLENISHED LP QUANTITY
  - RECEIVED ITEM QUANTITY
  - SORTED ORDER QTY, SORTED ORDER LINE QTY, SORTED ITEM QTY
  - RECEIVED LP QUANTITY
  - COUNTED ITEM QUANTITY, COUNTED LOCATION
  - RETURNED ITEM QUANTITY, RETURNED ORDER QUANTITY
- Samples:
  - `MLT1 - Test Warehouse | Mike Lunsford | 2026-11-05 | 0 … | 10 (received) …`
  - `Team 1 | Sydney Baker | 2026-11-03 | … | 27,240 received`
- Filters:
  - Activity Date (date-time).
  - **Period** (single select): Last 7 days, Last 30 days, Last 90 days.
  - User (text).
  - Warehouse.

## PO Receiving Report (Receiving)
- URL `/en/wms/report/partial-receipt`. Description: "The PO Receiving Report shows the history of your received purchase orders based on the quantity you have received."
- Quick search: "Search by PO number". Toolbar: Filter, Refresh, Columns, Export.
- Columns:
  - WAREHOUSE*, CLIENT*, PO CODE*, SKU*, PRODUCT NAME*, PACK TYPE, BARCODE
  - DAMAGED QUANTITY*, PO QUANTITY*, PO UOM QUANTITY*
  - RECEIVED UOM QUANTITY* (i): "UOM-equivalent of the received pack type … compared against the 'PO UOM Quantity'".
  - RECEIVING DIFFERENCE* (i): shown as a pill.
    - Negative pill (`.negative-difference`): bg #ed634a3d, text #ed634a.
    - Positive pill: bg #28b5733d, text #28b573.
    - Pill style: radius 5px, 10px bold.
    - Blank when there is no difference.
- Samples:
  - `MLT1 | MLTest | KS-TEST-PO-002 | MLT-WIDGET-01 | MLTest Widget | Each | MLT000001 | 0 | 5 | 5 | 0 | -5`
  - `KS-TEST-PO-001 … | 10 | 10 | 10 |` (no difference)
- Filters:
  - Client.
  - Damaged Quantity (range).
  - Has Difference? (Yes/No).
  - Order UOM Quantity (range).
  - PO Code (text).
  - Pack Type (multi).
  - Product Name, Product SKU (text).
  - Receipt Difference (range).
  - Received UOM Quantity (range).
  - Warehouse.

## Integration Log (Logs menu; lives under Integrations)
- URL `/en/wms/integration/analytics/integration-history`. Tab title "Integration Analytics - Logiwa". Breadcrumb Home > Integrations > Channel Logs > Channel History. Tabs: PLUGIN INTEGRATIONS, CHANNEL LOGS.
- Quick search: "Search by store name". Footer has Export.
- Columns: STORE NAME*, CHANNEL* (logo), METHOD*, DATE*, STATUS* (pill), SUCCESS*, ERROR*, TOTAL*, row "...".
- Status pills (`integration-history-status-tag`):
  - successful: text rgb(0,135,77) on rgb(211,240,227).
  - no-data: text rgb(178,11,28) on rgb(251,219,222).
- Row "..." menu: **Show Details**. It opens a drawer titled "Downloaded … Details" with the store name, Success Qty, Error Qty, Total Qty, Start Date, End Date and Status, plus a grid with columns SUCCESS (Yes/No), PROPERTIES (e.g. "Code:779965 / OrderId:811243893") and ERROR MESSAGE, which is paged.
- Filters:
  - Channel (multi): 16 channels.
  - Channel Method (multi): Download orders, Download products, Send shipment info to my store, Sync inventory.
  - Created Date (date-time).
  - Store Name (text).
  - Summary Status (multi): Already Processing, Error, Failed, No Data, Partially Successful, Processing, Successful, Unauthorized.

---

## Labor Analytics (all 5 pages): NOT ACCESSIBLE
- Routes: `/en/wms/labor-analytics/average-task-analysis`, `/associate-task-analysis`, `/performance-quadrant-analysis`, `/associate-analysis`, `/receiving-performance-analysis`.
- Page titles: "Average Task Analysis - Logiwa", "Associate Task Analysis - Logiwa", and so on.
- The body shows only an "Information" modal: "You do not have access to the Labor Analytics. Please contact your Account Admin to request access. Access can be managed from the Apps page under the Profile menu." with an **OK** button. The pages contain an iframe (`about:blank`), so they are probably embedded BI dashboards.
- Content is unknown. Implied features from the names:
  - Average time per task type.
  - Per-associate task breakdown.
  - A quadrant chart of speed vs volume (or accuracy).
  - Associate scorecards.
  - Receiving throughput per associate.

## Operational Analytics (all 4 dashboards): NOT ACCESSIBLE
- Routes: `/en/wms/operational-analytics/inbound-inventory` ("Inbound & Inventory Dashboard"), `/fulfillment` ("Fulfillment Dashboard"), `/management` ("Management Dashboard"), `/productivity` ("Productivity Dashboard").
- They show the same gate: "You do not have access to the Operational Analytics…" (an add-on app under Profile > Apps). Each page has an embedded iframe. Dashboard content is unknown.

---

## Feature checklist for KitStaks (derived)
1. Reusable ReportGrid with:
   - Quick search plus an Equal / Starts With comparator.
   - A typed filter builder: enum multi-select, text with 6 operators, numeric range, date presets, boolean.
   - Filter chips.
   - URL-serialized filters.
   - Saved filters (named, per page, with a Saved tab).
   - Clear filter, Refresh, column chooser, drag-reorder and resize of columns.
   - Sortable columns.
   - Density toggle, page sizes 100/300/500/700/1000, pager, Total count.
   - Async Export to Excel.
   - Header tooltips that explain formulas.
2. Async export pipeline with an Excel Export History page (status pills started / completed / error, row count, error message, download link) and a background-task tray.
3. Reports to implement:
   - Channel Sales, Shortage, ATP, Kit Inventory (with Create Work Order), Kit Component Availability.
   - Serial Tracking, Serial Shipment History, Serial Receiving History.
   - Order Inventory, Dynamic Replenishment, Inventory Snapshot (nightly job).
   - Change Log (field-level audit), Transaction History (inventory ledger), Serial Transaction History.
   - Missing Log, Wave Log, Allocation Exceptions.
   - User Performance, PO Receiving, Integration Log (with a detail drawer).
4. Create Work Order 4-step drawer wizard, launched from Kit Inventory selection.
5. Analytics dashboards: Logiwa gates these behind add-ons. KitStaks can ship native Labor (task time, associate scorecards, quadrant) and Operational dashboards (Inbound & Inventory, Fulfillment, Management, Productivity) as a differentiator.
