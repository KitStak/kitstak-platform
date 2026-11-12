# Logiwa iO Spec — Cluster 04: Inventory & Counts

Captured 2026-11-05 from the Logiwa iO sandbox, warehouse **MLT1 - Test Warehouse** (id `4a7c3492-8275-47ed-ae54-ac916a6e3b44`). Team 1 Supplier Service records were only listed, never opened or changed.
Test records created during capture (all in MLT1): count plan `KS-TEST-COUNT-01`, LP type `KS-TEST-TOTE`, LP numbers `KST-00001` and `KST-00002`.

---

## 0. Patterns shared by every page (build these once)

**Tech:** Angular app using a Kendo Angular grid (`role=grid`, `aria-rowcount`). Drawers are ant-design right-side drawers (`ant-drawer-right`). Small confirm modals use cdk-overlay. Header dropdown buttons are native `<details><summary>`.

**Page header:** breadcrumb (`Home / <Module> / <Page>`), H1 title, one-line helper text on the right, and primary/secondary action buttons at the top right.

**Sub-tab strip:** uppercase link-tabs under the header. Each tab is its own route.

**Grid toolbar, left to right:**
1. **Search comparator** (icon + chevron). Opens a "Search Content" popover with radio options **Equal** (default) and **Starts With**, plus **Apply**. It is written to the URL as `<field>qt=eq|sw`.
2. **Search box.** The placeholder is page-specific ("Search by SKU", "Search LP number"). A magnifier button runs the search. Writes `?sku=X&skuqt=eq`.
3. **Filter button** ("Filter ▾"). Opens a popover titled **Select Filter Type** with two tabs, **New** and **Saved**, plus a "Search Filter" box and an alphabetical list of filterable fields. Clicking a field opens its editor (back-chevron header). The editor type depends on the field:
   - **Enum / reference (multi-select checklist):** operator dropdown `in | not in`, then a search box and a checkbox list.
   - **Text:** operator dropdown `equals | contains | starts with | ends with | exclude | empty`, then a text input.
   - **Numeric range:** `Min` and `-` and `Max` numeric inputs.
   - **Date:** a preset dropdown, then From/To date pickers or an "X day" numeric box. Presets: Custom, Today, Last 3 days, Last 7 days, Last 30 days, Last 90 days, Last 12 months, X Day(s) Ahead and More, X Day(s) Before and More, Within X Day(s) Past, Within X Next Day(s), Sunday through Saturday.
   - **Boolean:** a Yes/No checklist.
   - Footer button: **Add Filter**.
4. **Applied filter chips** appear inline, for example "Warehouse / in MLT1 - Test Warehouse", each with an ×. After the chips come two icon buttons: a **save** icon (saves the current set as a named filter, input "Filter Name", listed later under the Saved tab) and a **clear-all filters** icon.
5. **Bulk-action buttons** sit on the right. They are disabled until at least one row is checked.
6. **Refresh** icon button (tooltip "Refresh the table").

**Grid behavior:**
- The first column is a checkbox (select-all in the header) when the page has bulk actions.
- The last column is a "•••" row-action button. It opens a small `myl-grid-menu-popup` list.
- Row click does nothing; there is no row drill-down.
- Some cells are **hyperlinks** (blue text with an open-in-new icon). They open a related list in a **new tab**, pre-filtered by URL params. Example: on Total Inventory, SKU opens `en/wms/product/list?cli=[clientId]&cliqt=in&clilbl=MLTest&sku=MLT-WIDGET-01&skuqt=eq&ps=100`, and Open SO Qty opens `en/wms/shipment-order/list?cli=…&wn=[warehouseId]&wnqt=in&wnlbl=…&sku=…&skuqt=eq`.
- Sortable headers are clickable (asc, then desc). Sort is written to the URL as `sf=<field>&sd=asc|desc`.
- Header gear = **column chooser**: a checkbox list of every column plus an **Apply** button. Columns can also be resized and dragged to reorder.
- Some headers have a "?" help-tooltip icon (e.g., Total Pack Qty, Allocated Pack Qty).

**URL state.** Every filter, sort and page is mirrored to the query string, so views are shareable. Example: `?wc=%5B"<id>"%5D&wcqt=in&wclbl=MLT1%20-%20Test%20Warehouse&sf=totalQuantity&sd=desc&p=1&ps=100`.

**Footer:**
- Density toggle: **Large | Small** (Small is the default).
- Page size dropdown: "Show 100 items", with options 100, 300, 500, 700, 1000.
- Pager: first, prev, page-number spinbox "/ N", next, last.
- **Export As Excel** (green outline button). Export runs **async**: a toast says "Started preparing the Excel file for download. Once the export begins, you can check its status in the Transactions section at the top right corner." The top-bar has a Transactions popup.
- Right side: "Total: N" and, when rows are checked, "Selected: N".

**Drawer forms:**
- Title at top left with a close ×.
- Labels sit above fields, and required fields have a red `*`.
- Kendo dropdowns. Large lists (locations, LPs) use server search: the message "You have to enter at least 3 characters to search." shows until 3 characters are typed.
- Text areas show counters such as "0/400" or "0/50".
- Footer: **Cancel | Save**. Save stays **disabled until the form is valid**.
- Invalid touched fields get a red outline. Inline text appears for some fields, e.g. "Transfer from Parent LP/LP is required."

**Wizards** use numbered step headers ("1.General  2.Tasks") with **Back / Next** and a final **Save / Finish**.

**Yes/No toggles** are segmented two-option pills (`lw-toggle-container`); the active option is highlighted.

**Status pills** are rounded rectangles with a tinted background and darker text:

| class | bg | text | used for |
|---|---|---|---|
| status-1 (grey) | #E3E6E8 | #50575C | Pending |
| status-2/3 (blue) | #D5E5F2 | #0D36A3 | Ready To Count, Count Started |
| status-4 (red) | #FBDBDE | #B20B1C | Cancelled |
| status-5/7 (green) | #D3F0E3 | #17874D | Inventory Updated, Recount Created |

**Toasts** show a "Success" title and a message, e.g. "You have successfully created LP Number."

---

## 1. Total Inventory — `en/wms/inventory/total`

- **Title:** "Inventory". Breadcrumb Home / Inventory / Inventory. Helper text: "You can see and manage your inventory level."
- **Header buttons:** none.
- **Sub-tabs** (shared across the inventory module): TOTAL INVENTORY (`/inventory/total`), INVENTORY BY LOCATION (`/inventory/list`), AVAILABLE TO PROMISE (`/report/available-to-promise`), KIT INVENTORY (`/report/kit-inventory`), KIT COMPONENT INVENTORY AVAILABILITY (`/report/kit-component-availability`).
- **Grain:** one row per SKU × warehouse. With no warehouse filter, the Warehouse column shows "All Warehouses" (an aggregate). Total in the sandbox: 5,773 rows.
- **Columns** (16, all visible by default, none hidden; [S] = sortable):
  1. Image (thumbnail; `noImage.png` placeholder)
  2. Warehouse
  3. Client [S]
  4. SKU [S] (hyperlink to the product list)
  5. Product Name [S]
  6. UOM Pack Type
  7. UOM Quantity
  8. Available UOM Qty [S]
  9. Total Quantity [S]
  10. Open SO Qty [S] (hyperlink to the shipment-order list)
  11. Undamaged Quantity [S]
  12. Undamaged Available UOM Qty [S]
  13. Kit Type
  14. Product Type
  15. Product Group [S]
  16. Damaged Qty
- **Toolbar:** search comparator, "Search by SKU", Filter, Refresh. There is no checkbox column and no bulk or row actions. This page is read-only.
- **Filter fields:** Available Undamaged UOM Quantity, Available UOM Quantity, Client, Damaged Quantity, Kit Type, Open SO QTY, Product Group, Product Name, Product Type, SKU, Total Quantity, Undamaged Quantity, Warehouse (in/not in: "MLT1 - Test Warehouse", "Team 1 Supplier Service").
- **Sample data (MLT1, sorted by Total Qty desc):**
  - MLTest / MLT-WIDGET-01 "MLTest Widget" / Each: UOM 48, Available 44, Total 48, Open SO 4, Undamaged 48, Undamaged Avail 44, Damaged 0.
  - MLT-KITTEST-COMPA "Kit Test Component A": 10/10/10.
  - MLT-KITTEST-COMPB "Kit Test Component B": 6/6/6.
  - Every other SKU shows 0. On the "All Warehouses" view, negative available values are possible (testclient kit-item-umt1: Available -2, Open SO 2).
- **Logic inferred:** Available = Total − allocated/open demand. Undamaged Available = Undamaged − allocated.

## 2. Inventory by Location — `en/wms/inventory/list`

- **Header** as in section 1.
- **Header buttons:**
  - **Transfer LP/Loc ▾** (dropdown) with items **Transfer LP** and **Transfer Location**.
  - **Import**, which navigates to `en/wms/import/inventory/2` (see 2.9).
  - **Add Inventory** (primary).
- **Grain:** one row per inventory record (SKU × location × LP × lot × expiry × status). Total in the sandbox: 1,200 rows. MLT1 has 6 to 7 rows.
- **Columns** (39). A checkbox column comes first and a "•••" column last; [S] = sortable:
  - Image
  - Client [S]
  - SKU [S]
  - Barcode
  - Product Name [S]
  - Total Pack Qty [S] (?)
  - Allocated Pack Qty [S] (?)
  - Allocated UOM Qty [S]
  - Free Quantity [S]
  - Free UOM Qty [S]
  - Pack Type
  - UOM Pack Type
  - UOM Quantity
  - Lot/Batch Number [S]
  - Expiry Date [S]
  - Product Type
  - Product Group [S]
  - Warehouse [S]
  - Location [S]
  - Location Group [S]
  - Location Zone [S]
  - Location Type [S]
  - Area Type [S]
  - Replenishment Location Type [S]
  - Walking Path Priority [S]
  - PO Number
  - LPN [S]
  - Parent LP
  - Original LP Number
  - LP Type [S]
  - Parent LP Type
  - Original Parent LP
  - Mobile Cart
  - Inventory Status [S]
  - Damage Reason
  - Receiving Date
  - Production Date
- **Filter fields:** Allocated Quantity, Client, Damage Reason, Expiry Date (date), Location, Location Group, Location Zone (in/not in), Lot Batch Number, LP Number, LP Type (text ops), Mobile Cart, Pack Type, Parent LP Number, Parent LP Type, Product Group, Product Name, Product SKU (text ops), Product Type, Product UPC, Production Date, Purchase Order Number, Receiving Date, Status, Total Quantity (Min/Max), Warehouse.
  - **Status values:** Allocated, Loaded, Packed, Picked, Sorted, Stock.
  - **Damage Reason values:** Empty, Bad Packaging, Broken, Damaged, Extra, Leaking, Missing, OnHold, Quarantined.
- **Sample MLT1 rows:**

  | SKU | Location | Type / Area | Path | Total | Allocated | Free | Status |
  |---|---|---|---|---|---|---|---|
  | MLT-WIDGET-01 (barcode MLT000001) | MLT1-A-01 | Shelves / Picking | 1 | 20 | 0 | 20 | Stock |
  | MLT-WIDGET-01 | MLT1-B-01 | Racks / Storage | 2 | 24 | 0 | 24 | Stock |
  | MLT-WIDGET-01 | MLT1-A-01 | Shelves / Picking | 1 | 2 | 2 | 0 | Allocated |
  | MLT-WIDGET-01 | MLT1-A-01 | Shelves / Picking | 1 | 2 | 2 | 0 | Allocated |
  | MLT-KITTEST-COMPA | MLT1-B-01 | Racks / Storage | – | 10 | – | – | Stock |
  | MLT-KITTEST-COMPB | MLT1-B-01 | Racks / Storage | – | 6 | – | – | Stock |

  - The two Allocated rows show that allocation **splits inventory into separate status rows** at the same location.
  - Team 1 sample: SKU2, location "Receiving", LPN 4313131312, LP Type Pallet, Receiving Date 2026-09-29.
  - MLT1 locations: MLT1-A-01, MLT1-B-01, MLT1-PACK, MLT1-RECV, MLT1-SHIP.
- **Row "•••" menu:** **Add / Adjust / Remove**. It appears only on **Stock** rows; Allocated rows have no "•••".
- **Bulk buttons** (disabled until a row is checked; checking a row triggers a brief loading overlay):
  - **Transfer Product**.
  - **Change Attributes ▾** (dropdown) with Change Lot/Batch Number, Change Expiry Date, Change Production Date, Change Damage Reason.

### 2.1 Adjust Inventory (row → Adjust), right drawer "Adjust Inventory"

| Field | Type | Req | State / default |
|---|---|---|---|
| Warehouse | dropdown | * | prefilled, disabled |
| Location | dropdown | * | prefilled, disabled |
| Client | dropdown | * | prefilled, disabled |
| Product | dropdown | * | prefilled "MLT-WIDGET-01 - MLTest Widget", disabled |
| Pack Type | dropdown | * | prefilled, disabled |
| Adjustment Reason | dropdown | * | "Select adjustment reason"; options: **Inventory is missing, Inventory quantity discrepancy, Classic Migration** |
| Current Quantity | numeric | | read-only (e.g. 20) |
| New Quantity | numeric | * | placeholder "Enter new quantity" |
| Note | textarea | | "Enter note", 0/400 |

Buttons: Cancel and Save. Save is disabled until Reason and New Qty are filled. Save sets an absolute quantity, and the system posts the delta as an adjustment transaction (inferred).

### 2.2 Add Inventory (row → Add)

Same drawer, titled "Add Inventory". Field order: Warehouse, Location, Client, Product, Pack Type (all prefilled and disabled), Adjustment Reason* (same 3 options), Current Quantity (read-only), **Quantity to Add***, Note.

### 2.3 Remove Inventory (row → Remove)

Same drawer, titled "Remove Inventory", with **Quantity to Remove*** instead of Quantity to Add.

### 2.4 Add Inventory (header button), unprefilled drawer

| Field | Req | Notes |
|---|---|---|
| Warehouse | * | MLT1 - Test Warehouse / Team 1 Supplier Service |
| Location | * | server search, min 3 characters (e.g. "MLT" returns MLT1-A-01, -B-01, -PACK, -RECV, -SHIP) |
| LP Number | | server search, optional |
| Client | * | list of 31 clients |
| Product | * | searchable |
| Pack Type | * | |
| Adjustment Reason | optional here | |
| Damage Reason | | Damaged, Broken, OnHold, Bad Packaging, Leaking, Extra, Quarantined |
| Quantity to Add | * | |
| Note | | 0/400 |

Location, LP and Product cascade from Warehouse and Client.

### 2.5 Transfer LP (header ▾ → Transfer LP), drawer "Transfer LP"

1. Warehouse*.
2. Transfer from Parent LP/LP* (server-search dropdown) plus a **Find** button. Validation: "Transfer from Parent LP/LP is required."
3. After Find, a summary card of the LP appears, followed by a target selector (see 2.6).

Buttons: Cancel and **Transfer**.

### 2.6 Transfer Location (header ▾ → Transfer Location), drawer "Transfer Location"

1. Warehouse*.
2. Transfer from Location* (server search) plus **Find**.
3. After Find, a **summary card** shows: location code (MLT1-B-01), LP: -, Lot/Batch Num.: -, Pack Type: Each, Pack Qty: 40, SKU: **Multi**, SKU Qty: 3, Expiry Date: -, Production Date: -.
4. Then **Move to LP/Location*** (server search, min 3 characters; lists both locations and LPs).

Buttons: Cancel and **Transfer**. This moves the whole location's contents.

### 2.7 Transfer Product (bulk, one row selected), drawer "Transfer Product"

1. A product header card (SKU), then: Transfer from LP/Loc: MLT1-A-01, Pack Type: Each, Pack Qty: 20, Damage Reason: -, Expiry Date: -, Production Date: -, Lot/Batch Number: -.
2. **Transfer Product Quantity*** (numeric, empty, required).
3. **Move to LP/Location*** (server search).

Buttons: Cancel and **Transfer**. This moves a partial quantity of one inventory record.

### 2.8 Change Attributes (bulk, one or more rows)

Each opens a small drawer with one field, an Attention box and Cancel/Save.

| Drawer | Field | Attention text |
|---|---|---|
| Change Lot/Batch Number | text "Enter lot/batch number" | "All inventory lot/batch numbers that you have selected will be updated with the new one." |
| Change Expiry Date | date "Enter date" | "All inventory expiry dates that you have selected will be updated with the new one." |
| Change Production Date | date | the same wording for production dates |
| Change Damage Reason | dropdown, default "No damage reason"; options Damaged, Broken, OnHold, Bad Packaging, Leaking, Extra, Quarantined | "All inventory damage reasons which you have selected will be updated with the new one." |

Setting a damage reason moves the quantity from Undamaged to Damaged (inferred from the Total Inventory columns).

### 2.9 Import Inventory — `en/wms/import/inventory/2`

- Title: "Import Inventory".
- Helper text: "You can bulk import inventory by using an Excel file. Excel file import history will be listed below. You can reach old import files there."
- Back link: "Go back to Inventory".
- Card "Download our excel template": "To import your inventory, download our template. If you want to import new products with inventory, go to the Import Product screen." It has a **Download** button.
- Drop zone: **Select** button, "Drop files here to upload / Drag and drop or browse".
- **History grid** columns: Status, Master Row Count, Success Count, Error Count, Uploaded By, Created Date Time, Actions.
  - Status values: Successful, Partially Successful, Failed.
  - Example: Partially Successful, 1026 / 26 / 1000.
- **Row "•••"** opens Details and Download Original File.
- **Details drawer:**
  - Header: Master row count 1026, Success 26, Error 1000, a **Show Errors** checkbox, Start Date, Status, Original File (Download).
  - Grid: ROW ID, SUCCESS? (Yes/No), IMPORT DATA (e.g. "BMS-Magnetic[Row:682]"), MESSAGE (e.g. "No response was received from the inventory service for this row.").
  - Paged at 100.

## 3. Available To Promise — `en/wms/report/available-to-promise`

- **Breadcrumb:** Home / Reports / Available To Promise. **Title:** "Available To Promise (ATP)".
- **Helper text:** "Available to promise (ATP) calculates the available quantity of a product to sell it. ATP helps you to manage demands and match them to purchasing plans. Read more…" ("Read more" is a help link).
- **Sub-tabs:** same as Inventory.
- **Grain:** SKU × warehouse. One row per warehouse; there is no aggregate. The grid is empty until a filter is applied.
- **Columns** (18; [S] = sortable):
  - Warehouse [S]
  - Client [S]
  - SKU [S] (hyperlink)
  - Product Name [S]
  - Barcode
  - Kit Type
  - Total Quantity [S]
  - Damaged Qty [S]
  - Undamaged Quantity [S]
  - Allocated SO Item Qty
  - Open SO Qty (hyperlink)
  - Open PO Qty
  - Current ATP [S]
  - Planned ATP Qty [S]
  - On Hand Qty [S]
  - Sellable Qty [S]
  - Pickable Qty [S]
  - Unallocated SO Item Qty [S]
- **Filter fields:** Client, Current ATP, Damaged Quantity, Kit Type, Open PO QTY, Open SO QTY, Planned ATP, Product Name, SKU, Total Quantity, Undamaged Quantity, Warehouse.
- **No bulk or row actions.** Export As Excel is available.
- **Worked example** (MLT1 / MLT-WIDGET-01):

  | Total | Damaged | Undamaged | Allocated SO | Open SO | Open PO | Current ATP | Planned ATP | On Hand | Sellable | Pickable | Unallocated SO |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | 58 | 0 | 58 | 4 | 5 | 0 | **53** | 53 | 58 | 53 | 54 | 1 |

- **Formulas inferred:**
  - Current ATP = Undamaged − Open SO.
  - Planned ATP = Current ATP + Open PO.
  - Pickable = On Hand − Allocated SO.
  - Sellable = Current ATP.
  - Unallocated SO = Open SO − Allocated SO.

## 4. Kit Inventory — `en/wms/report/kit-inventory`

- **Title:** "Kit Inventory". Helper text: "The inventory levels of kit-to-order products can be monitored on this report".
- **Header button:** **Create Work Order** (opens the kitting work-order flow, which belongs to another cluster).
- **Columns:** checkbox, Warehouse, Client, SKU, Kit Type, Barcode, Product Name, Pack Type Name, Product Type, Product Group, Pending Order Quantity, Net Kitting Capacity, Total Inventory Capacity, Current Inventory Quantity, Required Kitting Quantity, Last Updated.
- **Example:** DW-FP-18-6 "DUDE Wipes 18ct Fragrance Free, Travel 6 Pack", Kit to Stock, Each: Pending 0, Net Kitting Capacity 255, Total Inventory Capacity 360, Current Inventory 105, Required Kitting 0, Last Updated 11/5/2026 3:45 PM. The report is recomputed periodically.
- **Kit Type values** seen: "Kit to Stock". Kit-to-order types are also implied by the helper text.

## 5. Kit Component Inventory Availability — `en/wms/report/kit-component-availability`

- **Helper text:** "Inventory levels and reorder requirements of kit product components can be monitored in this report."
- **Columns:** Warehouse, Client, Component SKU, Component Product Name, Product Type, Product Group, Included Kits, Total Order Quantity, Total Inventory Quantity, Total Available Inventory Quantity, Reorder Quantity.
- The grid is empty until filtered.

## 6. Count Plans — `en/wms/count/plan/list`

- **Breadcrumb:** Home / Inventory / Count Plans. **Title:** "Count Details". Helper text: "You can create, edit or delete your count plans here."
- **Header buttons:**
  - **Import ▾** (`<details>` dropdown) with **Import Location Count Plan** (`en/wms/import/count/location/18`) and **Import SKU Count Plan** (`en/wms/import/count/product/19`).
  - **Create New Count** (primary).
- **Sub-tabs:** COUNT PLAN | LOCATION DETAILS | SKU DETAILS.
- **Bulk buttons** (disabled until selection; enabled for a Pending plan): **Cancel**, **Update Inv.**, **Create Job**.
- **Columns:**
  - checkbox
  - Count Code
  - Warehouse
  - Job Code (comma list, e.g. "Job5969094, Job5969042")
  - Count Started Time
  - Count Completed Time
  - Number of SKU [S]
  - Counted SKU [S]
  - Number of Location [S]
  - Counted Locations [S]
  - Created Time
  - Status (pill)
  - Count Type (Location / LP / SKU)
  - AI Count Plan (Yes/No)
  - Count Operation Type (Cycle / Instant)
  - Created By
  - Count Object
  - Inventory Updated Date Time
  - Inventory Update User
  - •••
- **Filters:**
  - Count Plan Code (text).
  - Count Plan Operation Type: Cycle Count, Instant Count.
  - Count Plan Status: Cancelled, Count Started, Inventory Updated, Pending, Ready To Count.
  - Count Plan Type: Location, LP, SKU.
  - Warehouse.
- **Row "•••":** Show Details, Edit, Delete. Show Details on a Pending plan opens the same drawer as "Edit Count", headed with a "Count" badge.
- **Status lifecycle (inferred):** Pending (created, no job) → Ready To Count (job created) → Count Started (a scanner user began) → Count Completed → Inventory Updated (after **Update Inv.** posts the variances). Cancelled is reachable via **Cancel**. Line-level Recount Created is covered in section 7.
- **Instant counts** are auto-named `IC<yyyyMMddHHmmssfff>` (e.g. IC20260929151718259), have operation type Instant, and are created from mobile/scanner.
- **Samples:**
  - "Trainingsep30th": Location, Cycle, 2 locations / 1 counted, Inventory Updated, by Team 1 Supplier Admin.
  - "test 2": Count Started, Jobs Job5969094 and Job5969042.

### 6.1 Create New Count wizard (right drawer "Create New Count")

**Step 1. General**

| Field | Type | Req | Default / notes |
|---|---|---|---|
| Name | text (`countPlanCode`) | * | "Count Plan Name", counter 0/50 |
| Warehouse | dropdown | * | "Select warehouse"; MLT1 / Team 1 |
| Description | text | | |
| Scheduled Count Date | date-time picker | * | defaults to now, format `2026/11/05 15:49` |
| Lock Locations | Yes/No toggle | | **No** |

Buttons: Cancel and Next.

**Step 2. Tasks**

- A mode selector with two checkbox-style headers: **Location Count** (default) or **SKU Count**. Switching mode clears the list without a confirm.
- Toolbar: **Remove** (disabled until rows are checked) and **Add**.
- **Location mode grid:** Location, Loc Type, Loc Group.
  - **Add** opens the modal "Add Location". It contains the Filter control, a grid (checkbox, Location, Loc Type, Loc Group) listing the warehouse's locations (MLT1-SHIP Ramps, MLT1-PACK Business Station, MLT1-B-01 Racks, MLT1-A-01 Shelves, MLT1-RECV Ramps, PrimaryLoc), and an **Add** button.
  - Add Location filter fields: ABC Code, Aisle, Area Type, Assigned Mobile Cart, Client, Code, Column, Custom Field Date 1–3, Custom Field Drop Down 1–2, Custom Field Text Box 1–3, Custom Field Toggle 1–2, Display Member, Has Inventory, Height, Level, Location Barcode, Location Group, Location Type, Location Zone, Locked Location, Path Priority, Position, Prevent Allocation, Rack, Replenishment Type, Volume, Warehouse.
- **SKU mode grid:** Product Code, Item Type, Item Group.
  - **Add** opens the modal "Add Product": "Search by SKU" plus Filter. Grid columns: checkbox, Product Code, Client, Item Type, Item Group (all 5,774 products).
  - Add Product filter fields: Barcode, Client, Created Date, Custom Fields, FNSKU, Foldable, Fragile, Kit, Name, Oversized, Pack Type, Price, Product Group, Product Type, Returnable, Sales Price, Shelf Life, Sku, Stackable, Status, Track Expiry Date, Track Lot Batch Number, Track Production Date, Track Serial Number.

Buttons: Back and **Save**. Save is disabled while the list is empty.

**On save:** the drawer closes and the new row appears at the top. Example: KS-TEST-COUNT-01, MLT1, Number of SKU 1, Pending, Count Type SKU, AI No, Cycle, Created By Mike Lunsford.

**Edit Count:** the same 2-step wizard, prefilled. Step 2 shows the paged task list ("Total: 1").

### 6.2 Create Job (bulk, Pending plan selected), modal "Create New Job"

| Field | Req | Notes |
|---|---|---|
| Job Type | * | dropdown. In MLT1 it shows "No job type has been created yet.", so job types must be configured first (Settings). |
| Batch Size (Location) | * | numeric. How many locations each job contains, so one plan can be split into several jobs. |
| Assign to | | users (Team 1 Supplier Admin, Mike Lunsford) |

Buttons: Cancel and Save.

### 6.3 Update Inv. / Cancel (bulk)

These apply counted variances to inventory or cancel the plan. They were not executed (no completed MLT1 count). A confirm dialog is expected.

## 7. Count Location Details — `en/wms/count/location/list`

- **Title:** "Count Details", tab LOCATION DETAILS. Helper text: "You can create, edit or delete your count locations here."
- **Buttons:**
  - **More Details**, which triggers an async detailed Excel export. Toast: "Started preparing the Excel file… check its status in the Transactions section".
  - Bulk (disabled until selection): **Cancel**, **Update Inv.**, **Create Recount**.
- **Columns** (one row per location × job; [S] = sortable):
  - checkbox
  - Location [S]
  - Warehouse [S]
  - Job Code
  - Count Code [S]
  - Count Operation Type
  - Created By
  - Count Started Time [S]
  - Count Completed Time [S]
  - Status [S]
  - Num. of SKU [S]
  - Approved Stock Qty [S]
  - Initial Stock Qty [S]
  - Approved Count Qty [S]
  - Counted Qty [S]
  - Recount Line (Yes/No)
  - Recounted Location (Yes/No)
  - % Difference [S]
  - Count User
  - Note
  - Inventory Updated Date Time [S]
  - Inventory Update User
  - •••
- **Filters:** Count Plan Code, Count User, Difference (Min/Max), Location Code, Recount Line (Yes/No), Recounted Location, Status, Warehouse.
- **Status values:** Cancelled, Count Completed, Count Started, Inventory Updated, Pending, Ready To Count, Recount Created.
- **Samples:**
  - b-1-4, Job5969042: initial 1219, counted 34, % diff 102.79, **Recount Created**. A new line b-1-4 under Job5969094 is "Ready To Count" with Recount Line = Yes.
  - b-1-3: initial 10, counted 10, % diff 200 (as shown), Inventory Updated by Bryan King.
  - a-1-1: Cancelled.
- **Logic:**
  - A recount creates a new count line (Recount Line = Yes) in a new job, and the original line becomes "Recount Created".
  - Approved qty fields hold the qty accepted for update.
  - % Difference compares counted vs stock.

## 8. Count SKU Details — `en/wms/count/product/list`

- **Tab:** SKU DETAILS. Helper text: "You can create, edit or delete your SKU details here."
- **Buttons:** More Details, Cancel, Update Inv., Create Recount (the same as section 7).
- **Columns:**
  - checkbox
  - SKU Code [S]
  - Count Plan Code [S]
  - Count Operation Type
  - Created By
  - Warehouse [S]
  - Job Code
  - Location [S]
  - Count Started Time [S]
  - Count Completed Time [S]
  - Status [S]
  - Initial Stock Qty [S]
  - Approved Stock Qty [S]
  - Approved Count Qty [S]
  - Counted Qty [S]
  - Recount Line
  - Recounted SKU
  - % Difference
  - Count User [S]
  - Note
  - Inventory Updated Date Time [S]
  - Inventory Update User
  - •••
- **Filters:** Count Plan Code, Count User, Difference, Recount Line, Recounted SKU, Sku, Status, Warehouse.
- **Row "•••":** **Delete** only (removes the SKU line from the plan).
- **Sample:** MLT-WIDGET-01 / KS-TEST-COUNT-01 / Cycle / Mike Lunsford / MLT1 / Location "0" (unresolved until a job exists) / Pending (grey).

## 9. Count Task Details (related) — `en/wms/task-details/count/list`

- **Breadcrumb:** Fulfillment / Task Details / Count.
- **Tabs:** ORDER OPERATIONS | COUNT | REPLENISHMENT.
- **Default filter chip:** "Job Status in Pending, Started".
- **Columns:** Warehouse, Client, Task ID, Job Code, Job Type, PO Number, Count Plan, Task Type, Task Status, Product Image, SKU, Product Name, Barcode, Pack Type, To Pack Type, UOM Pack Type, Initial Task Pack Qty, Initial Task UOM Qty, Initial Task Approved Pack Qty, Approved Task UOM Qty, Approved Pack Qty, Approved Task Pack Qty, Source Location Zone, Source Location, Source Location Display Member, Source LPN, Target Location, Target LPN, Assignee, Executed By User, Planned Start Date, Start Date, Planned Finish Date, Finish Date, Task Created Date, Created By User, Lot/Batch Number, Expiry Date, Damage Reason, Updated By User, Source Parent LP, To Original Parent LP, To Original LP, From Original Parent LP, From Original LP, Source Parent LP Type, Receiving Date, Production Date.
- **Sample:** task 4000164, Job5969094, Cycle Count, plan "test 2", Count, Pending, SKU3, qty 200, location b-1-4, assignee bryan@….

## 10. LP Types — `en/wms/lp-types` (redirects to `/lp-types/list`)

- **Breadcrumb:** Home / Settings / LP Types.
- **Helper text:** "Packages (LP Types) are used for custom shipment packages. You'll be able to use them when getting labels or at the packing station. Learn more about LP types here." (help-center link).
- **Header button:** **Add New LP Type**.
- **Tabs:** LP TYPES | LP NUMBERS.
- **Bulk:** **Delete** (disabled until selection).
- **Columns:**
  - checkbox
  - Code [S]
  - Description [S]
  - Warehouse
  - Number Prefix
  - Number Length
  - Length, Width, Height
  - Dimension Unit
  - Empty Weight
  - Max Weight
  - Weight Unit
  - Is Prevent Multi Client
  - Is Prevent Multi Expiry Date
  - Is Prevent Multi Job
  - Is Prevent Multi Lot Batch Number
  - Is Prevent Multi Order
  - Is Prevent Multi SKU
  - SSCC18
  - Suitable For Parent LP
  - Is Use For AI Job
  - •••
- **Filters:** Code, Usable as Parent LP, Use for AI Jobs, Warehouse.
- **Row "•••":** Show Details, Edit, Change Log, Delete.
  - Show Details opens the wizard prefilled. The fields remain editable.
  - Change Log opens a drawer titled "LP Type Change Log" with grid TYPE, MESSAGE, OPERATION DATE, SOURCE, and "No records to display" when empty.
- **Seed data (Team 1):**
  - Picking Tote: "Picking totes for 'Pick and Sort by Tote' screen", prefix PT-, length 4.
  - Picking Cart: prefix PC-, length 4, "Pick to Location" screen.
  - Pallet: "For receiving, storage and shipment (B2B) inventory", prefix PLT, length 6.

### 10.1 Add & Edit LP Type wizard (drawer "Add & Edit LP Type", 3 steps)

**Step 1. General**

| Field | Type | Req | Default / options |
|---|---|---|---|
| Warehouse | dropdown | * | MLT1 / Team 1 |
| Code | text | * | |
| Number length | numeric | * | |
| Number prefix | text | * | |
| Description | text | | |
| Length, Width, Height | numeric | | |
| Dimension Unit | dropdown | * | **Inch**; Inch, Foot, Centimeter, Meter |
| Weight Unit | dropdown | * | **Ounce**; Pound, Ounce, Kilogram, Gram |
| Empty Weight, Max Weight | numeric | | |
| Volume Unit | dropdown | * | **Cubic Inch**; Cubic Inch, Cubic Meter, Cubic Foot, Liter, Gallon, Cubic Centimeter |
| Max Volume | numeric | | |

Next with empty required fields gives red outlines on Warehouse, Code and Prefix, with no message text.

**Step 2. Parameters.** Nine Yes/No toggles, all defaulting to **No**:
- Only 1 Expiry Date
- Only 1 Production Date
- Only 1 Lot Batch Number
- Only 1 SKU
- Only 1 Client
- Only 1 Order
- Only 1 Job
- Suitable for Parent LP
- Use For AI Job

These are mixing constraints enforced when putting inventory into an LP.

**Step 3. Other Info.** "You can optionally add or edit custom fields under 'Other Info' tab" plus an **Add/Edit Custom Field** button.

Buttons: Back and **Finish**.

**Result:** the row "KS-TEST-TOTE | KS-TEST tote type for spec capture | MLT1 | KST- | 5 | 0 | 0 | 0 | Inch | 0 | 0 | Ounce | No × 9".

## 11. LP Numbers — `en/wms/lp-numbers/list`

- **Breadcrumb:** Home / Settings / Packages LP Numbers.
- **Helper text:** "You can create new or edit existing license plates (LP Numbers) on this page".
- **Header buttons:**
  - **Import LP Number**, which goes to `en/wms/import/lp-number/8` (the same import layout as 2.9).
  - **Create LP Number**.
- **Search:** "Search LP number" with the Equal / Starts With comparator. URL `?nm=KST-&nmqt=sw`.
- **Bulk:** **Print Barcode** (disabled until selection).
- **Columns:**
  - checkbox
  - Number
  - Warehouse
  - LP Type
  - Location
  - Length, Width, Height
  - Weight
  - Actual Volume
  - Parent LP Type
  - Parent LP Num.
  - Original LP Number
  - Alternate Barcode
  - Is SSCC18 (true/false)
  - •••
- 194 rows in the sandbox, e.g. PT-0154 / Team 1 / Picking Tote / PrimaryLoc.
- **Filters:** Alternate Barcode, License Plate Type, Location, Number, Original LP Number, Parent LP Number, SSCC18?, Warehouse.
- **Row "•••":** **Edit**, **Change Log**.

### 11.1 Create LP Number (drawer)

| Field | Req | Notes |
|---|---|---|
| Warehouse | * | |
| LP Type | * | options shown as "CODE (WAREHOUSE)", e.g. "KS-TEST-TOTE (MLT1)"; filtered by warehouse |
| Location | | optional. If blank, defaults to the warehouse's receiving location (MLT1-RECV). |

Section **LP Number Creation Settings**: **LP Number Creation Method** radio, **From Sequence** (default) or **Custom Numbers**.

**From Sequence:**

| Field | Req | Notes |
|---|---|---|
| LP Number Count | * | numeric |
| Created as SSCC18 | | radio, **No** (default) / Yes |
| Client | required only when SSCC18 = Yes | "Select client" |

**Custom Numbers:** LP Number* (text) and Alternate Barcode (text). The SSCC18 controls are hidden in this mode.

Buttons: Cancel and Save.

- **Toast:** "You have successfully created LP Number."
- **Numbering:** prefix + zero-padded sequence to Number length. Count 2 produced **KST-00001** and **KST-00002**.

### 11.2 Edit LP Number (drawer)

| Field | State |
|---|---|
| Warehouse | disabled |
| LP Type | disabled |
| Location | disabled |
| LP Number | editable |
| Alternate Barcode | editable |
| Dimension Unit | disabled, Inch |
| Length, Width, Height | editable |
| Weight Unit | disabled, Ounce |
| Weight | editable |
| Volume Unit | disabled, Cubic Inch |
| Actual Volume | editable |
| Created as SSCC18 | No / Yes |
| Client | disabled |

Section headers: "LP Dimension/Weight/Volume" and "SSCC18". Buttons: Cancel and Save.

### 11.3 Print Barcode (bulk), modal "Print Labels"

- Text: "Would you like to print the labels out for the LP numbers you have recently created?"
- Table: Warehouse | LP Type | Location | Number of LP's Printed (e.g. MLT1 | KS-TEST-TOTE | MLT1-RECV | KST-00002).
- Buttons: Cancel and **Print Labels**. Print Labels generates a label PDF or sends to a direct printer; the top bar has a direct-print popup. It was not executed.

---

## Gaps / not verified

- The Total Inventory "Saved" filter tab was not opened (no saved filters were seen).
- Transfer LP with a real LP: MLT1 has no LP-bound inventory, so the LP summary card was not seen. It is assumed to mirror Transfer Location.
- Update Inv. / Cancel / Create Recount confirm dialogs: no completed MLT1 count. Create Job is blocked because MLT1 has no count job type.
- Count plan "Show Details" for started or completed plans (read-only view): not opened, because those plans belong to Team 1.
- Kit Inventory "Create Work Order": not opened (kitting cluster).
- Excel template column layouts: not downloaded.
- Inventory "hold": there is no explicit Hold action. Holds are modeled through Damage Reason values (OnHold, Quarantined) and Change Damage Reason.
