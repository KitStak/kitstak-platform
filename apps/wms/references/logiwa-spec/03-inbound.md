# Logiwa iO Spec — Cluster 03: Purchase Orders & Receiving (Inbound)

Captured 2026-11-05 from the my.logiwa.com sandbox, scoped to warehouse **MLT1 - Test Warehouse** (client **MLTest**).
Test records created: **KS-TEST-PO-001** (fully received: 10 x MLT-WIDGET-01 @ $5.00 into MLT1-RECV, status Completed) and **KS-TEST-PO-002** (5 x MLT-WIDGET-01 @ $0, then Cancelled).
"Unknown" means it was not observable in the sandbox.

## Shared UI patterns (apply to every list in this cluster)

- **Section shell**: breadcrumb (`Home > PO & Receiving > <Page>`), H1 title, centered grey helper sentence in the header, primary action button(s) top-right.
- **Sub-nav tabs** (route links, underlined active): `PURCHASE ORDER` (/en/wms/purchase-order/list), `VENDORS` (/en/wms/purchase-order/vendor/list), `RECEIVING HISTORY` (/en/wms/purchase-order/receipt/list). The H1 stays "Purchase Order" on all three; the breadcrumb leaf changes (Purchase Order / Vendor / Receiving History).
- **Toolbar left**: a search-mode button (list icon + chevron) next to a search box with a search-icon button. Search-mode popover: **"Search Content"** radio `Equal` (default) / `Starts With`, plus an **Apply** button. Placeholders: "Search by code" (POs), "Search by PO number" (receipts), "Search by Company Name" (vendors).
- **Filter button** ("Filter ˅") opens the popover **"Select Filter Type"**, which has two tabs: `New` | `Saved`. It includes a "Search Filter" box and an alphabetical list of filter fields. Each row has a **bookmark icon**, which pins the field as a favourite or quick filter, and an **x/+ icon**, which opens the field editor. The field editor has a back-chevron header with the field name. Its body depends on the field type, and the footer has an **Add Filter** button that stays disabled until a value is set.
  - Multi-select enum: a "Search Filter" box plus a checkbox list. When the field is nullable, the list starts with an "Empty" option.
  - Text: an operator dropdown `equals | contains | starts with | ends with | exclude` (default equals) plus a text input that uses the field name as its placeholder.
  - Numeric range: `Min` – `Max` inputs.
  - Boolean or toggle: `Yes` / `No` radios.
  - Date: a preset dropdown, default `Custom`, then `From` / `To` date-time pickers (defaults today 00:00 and today 23:59, format `YYYY/MM/DD HH:mm`). The presets are: Custom, Today, Last 3 days, Last 7 days, Last 30 days, Last 90 days, Last 12 months, X Day(s) Ahead and More, X Day(s) Before and More, Within X Day(s) Past, Within X Next Day(s), Sunday … Saturday. The X-day presets show a "0 day" numeric input.
  - Applied filters write their state to the URL query string. Example for Warehouse = MLT1: `?wn=["<warehouseGuid>"]&wnqt=in&wnlbl=MLT1 - Test Warehouse&ps=100`. The pattern is `<key>`, `<key>qt` (operator: in / eq / …) and `<key>lbl` (display label), plus `ps` for page size. Filtered URLs can therefore be shared.
  - After a filter is applied, the toolbar shows a **"+N" chip** with the active filter count, a **save-view icon** (floppy disk, which saves to the Saved tab) and a **clear-filters icon** (funnel with x).
- **Toolbar right**: bulk-action buttons that stay disabled until at least one row is selected, then a **refresh icon** button at the far right.
- **Grid**: Kendo grid with a checkbox column (on screens that support bulk actions) and a header select-all. A **gear icon** in the last header cell opens **"Edit Table Columns"**, a checkbox list of every column with an **Apply** button. Sortable headers show sort affordances. The last column holds the row "•••" (three-dots) menu. The first data column is a blue link that opens the record.
- **Footer**: a density toggle `Large | Small` (Small is the default and highlighted), a page-size dropdown (`Show 100 items`; options probably 10/20/50/100 — unknown), the pager `|< < [n] / N > >|`, a green outline **Export As Excel** button, `Total: N` and, once rows are selected, `Selected: N`.
- **Toasts** appear at the bottom-right with a bold title (`Success` / `Error`) and a message line.
- **Confirm dialogs**: a red header band with a large white "x" circle and bold white question text, an optional grey sub-line ("This action cannot be undone."), and buttons `No` (grey) and `Yes` (primary blue). For orders, the dialog body includes a mini table of the affected records (Order Code | Order Status | Order date).
- **Right-side drawer**: used for create/edit vendor, edit PO line, product category picker, change log and custom fields. It has a title, an "x" close button, a scrollable body and a sticky footer with `Cancel` (grey) and a primary button (`Save` / `Apply` / `Add To Form`).

### PO status values and pill colours (class `po-table-status-container table-status-{id}`)

| Status | id | Background | Text |
|---|---|---|---|
| Pending | 1 | `rgb(227,230,232)` grey | `rgb(80,87,92)` |
| (unknown, id 2) | 2 | unknown | unknown |
| Started (partially received) | 3 | `rgb(213,229,242)` light blue | `rgb(13,54,163)` |
| Completed | 4 | `rgb(211,240,227)` light green | `rgb(23,135,77)` |
| (unknown, id 5) | 5 | unknown | unknown |
| Cancelled | 6 | `rgb(251,219,222)` light red | `rgb(178,11,28)` |

The pills are rounded rectangles with medium-weight text. The filter's Status options are: Cancelled, Completed, Pending, Started.

### PO types (tenant-configurable list)
`Purchase Order`, `Purchase Order- Non Crossdock`, `Transfer Order`, `Return Order`, `Open Order`.

---

## Purchase Order List

- **URL**: `/en/wms/purchase-order` redirects to `/en/wms/purchase-order/list`. Page title: "Purchase Order - Logiwa".
- **Breadcrumb**: Home > PO & Receiving > Purchase Order.
- **Helper text**: "A Purchase Order is a document issued by a buyer (you), specifying the products to be delivered by a vendor in the future."
- **Header buttons**:
  - **Import ˅** (outline) opens a dropdown:
    - `Import Purchase Orders` goes to `/en/wms/import/purchaseorder/3` (see the Import page below).
    - `Import Serial Numbers` opens the serial-number import (same import framework; not opened).
  - **Create Purchase Order** (primary blue) goes to `/en/wms/purchase-order/form/add`.
- **Tabs**: PURCHASE ORDER | VENDORS | RECEIVING HISTORY.

### Grid columns
There are 16 columns, all visible by default. The Edit Table Columns order matches the grid order.

| # | Column | Sortable | Notes |
|---|---|---|---|
| 1 | PO Number | yes | blue link that opens the PO edit/detail page |
| 2 | Vendor | no | vendor display name, truncated with an ellipsis |
| 3 | Reference Number | no | |
| 4 | Purchase Price | yes | currency `$120.00` (sum of line totals) |
| 5 | Total Quantity | yes | thousands separator `27,240` |
| 6 | Status | yes | pill |
| 7 | PO Type | yes | |
| 8 | Tags | yes | colored tag chips |
| 9 | PO Date | yes | `M/D/YYYY h:mm:ss AM` |
| 10 | Client | yes | |
| 11 | Warehouse | no | |
| 12 | Created Date | no | |
| 13 | Planned Receiving Date | yes | |
| 14 | Actual Receiving Date | yes | set automatically when the PO is fully received |
| 15 | Planned Arrival Date | yes | |
| 16 | Actual Arrival Date | yes | |

**Sample rows**:
- `MLT-PO-002 | MLTest Vendor | | $120.00 | 24 | Completed | Purchase Order | | 10/16/2026 11:27:51 AM | MLTest | MLT1 - Test Warehouse | 10/16/2026 11:29:49 AM | | 10/16/2026 11:30:17 AM`
- `TO1769 | DUDE Products LLC | | $0.00 | 27,240 | Completed | Transfer Order | ...`

### Filter fields (New tab)
| Field | Editor |
|---|---|
| Actual Arrival Date | date |
| Actual Receiving Date | date |
| Client | multi-select: all clients |
| Code | text, with operators |
| Create Date | date |
| Custom Field Date 1/2/3 | date |
| Custom Field Drop Down 1/2 | multi-select, including "Empty" |
| Custom Field Text Box 1/2/3 | text |
| Custom Field Toggle 1/2 | Yes/No |
| Planned Arrival Date | date |
| Planned Receiving Date | date |
| PO Date | date |
| Price | Min–Max |
| Purchase Order Type | multi-select of the 5 types |
| Reference Number | text |
| Status | Cancelled / Completed / Pending / Started |
| Tag | multi-select, including "Empty" |
| Vendor Display Name | text |
| Warehouse | multi-select: MLT1 - Test Warehouse, Team 1 Supplier Service |

### Bulk actions
All are disabled until at least one row is checked.
- **Tag** opens the **Tags popover**. It has a "Search Tags" box with a magnifier, and an empty-state illustration with the text "Create new tags to differentiate your lines from others.", followed by a **+ Create Tag** primary button. Create Tag opens a **Tags modal** with:
  - a search row (Search Tags plus an x close button);
  - a create row: a colour swatch dropdown (purple by default), an "Enter tag name" input with a `0/30` counter, and an **Add** button.
  - Existing tags appear as a checklist that you toggle onto the selected POs.
- **Label ˅** dropdown: `Product Label` (prints product labels for the PO lines), `Purchase Order` (prints the PO document).
- **Cancel Order** shows a confirm dialog listing the affected orders, then sets the status to Cancelled. Only valid for Pending (and probably Started) orders.
- **Receive PO** performs a **one-click full receive** of every open line on the selected POs into the warehouse's default receiving location (MLT1 → `MLT1-RECV`). There is **no confirmation dialog**. Afterwards the status becomes Completed, Actual Receiving Date is set to now, and a Success toast reads "You have successfully received orders." Receipt rows appear in Receiving History with receiving type "Purchase Order".
- **Delete ˅** dropdown: `Delete Purchase Order`, `Remove Serial Number`.

### Row "•••" menu
`Show Details`, `Edit`, `Delete`. Show Details and Edit both open `/en/wms/purchase-order/form/edit/{guid}`. Clicking the PO number does the same.

### Empty state, export and counts
- **Empty state**: unknown (the grid uses the standard Logiwa empty state elsewhere).
- **Export As Excel**: exports the current filtered grid.
- **Counts**: Total = 8 before testing, 10 after.

---

## Create Purchase Order Wizard

- **URL**: `/en/wms/purchase-order/form/add`. Title: "Create Purchase Order - Logiwa". Breadcrumb: Home > Purchase Order > Create Purchase Order. A back-chevron sits before the H1.
- **Header right**: **Cancel Order** (grey), which abandons the draft.
- **Stepper**: 5 steps across the top. Each step has an icon circle, "Step N" and a label: `1 PO Details`, `2 Products`, `3 Vendor`, `4 Other Info`, `5 Confirm`. Completed steps show a green check next to "Step N" and use a green label. On create, the step headers are **not clickable**; navigation uses Back and Next Step only. On edit they **are** clickable.
- **Right rail (create)**:
  - **"PO Status"** card: the text "Follow all the steps to complete purchase order", a large blue percentage (`%0` → `%25` → `%50` → `%75` → `%100`), and a circular progress ring with a truck icon that fills by step.
  - **"Price"** card: `Total $0.00`, which updates live from the line totals.
  - **Confirm Purchase Order** primary button, disabled until step 5 is reached.

### Step 1 — PO Details
The fields are laid out in two columns.

| Field | Type | Req | Default | Validation / options |
|---|---|---|---|---|
| Warehouse | select | * | "Select warehouse" | MLT1 - Test Warehouse, Team 1 Supplier Service |
| Client | select | * | "Select client" | all clients (31). Once chosen it shows as a chip with an x. |
| PO number | text | * | placeholder "Order code" | max 50 (`0 / 50` counter). Uniqueness is checked **only at Confirm**; see Step 5. |
| PO type | select | * | "Select Purchase Order Type" | the 5 PO types. An (i) tooltip icon sits next to the label. |
| PO date | datetime | * | now (`2026/11/05 15:37`) | calendar picker icon |
| Planned Receiving Date | datetime | | empty, "Enter date/time" | |
| Actual Receiving Date | datetime | | empty | |
| Planned Arrival Date | datetime | | empty | |
| Actual Arrival Date | datetime | | empty | |
| Reference Number | text | | | max 100. An (i) tooltip icon sits next to the label. |
| Note | textarea | | | max 500 |

- **Buttons**: Next Step.
- **Validation**: clicking Next Step with empty required fields shows inline errors under the fields (styled red; exact text not captured).

### Step 2 — Products
- **Product search**: a combobox at the top, "Enter SKU and Add Product (At least 3 char.)".
  - Fewer than 3 characters shows the hint "You have to enter **at least 3 characters** to search."
  - Results are filtered to the selected client. Each result row shows a thumbnail, SKU (bold), description (grey), a quantity stepper (default 1, with up/down arrows) and a **+** button.
  - Clicking + opens the **Edit Product drawer** for that line, pre-filled with the stepper quantity.
- **Create New Product** button opens the **"Product Category"** drawer. Subtitle: "Please select the type of product category to proceed." It contains an illustration and three cards, each with a chevron:
  - **Product**: "Select this category to create standard products."
  - **Kit**: "Select this category to proceed with creating kit-to-order or kit-to-stock products."
  - **Packaging Material**: "Select this category to create packaging materials to match with your shipment packages for inventory tracking."
  - The cards hand off to the Product cluster's create wizard.
- **Lines toolbar**:
  - "Find PO Detail by SKU" search.
  - **Label** button, disabled until a line is selected.
  - **Number of SKU** counter chip.
  - **Total Qty** counter chip.
- **Lines grid columns**: (checkbox), IMAGE, SKU, PRODUCT DESCRIPTION, QUANTITY, PRICE PER ITEM, TOTAL PRICE, RECEIVING LOCATION, LOT BATCH NUMBER, RECEIVED QTY, PACK TYPE, UOM PACK TYPE, UOM QUANTITY, EXPIRY DATE, LP TYPE, LP NUMBER, PRODUCTION DATE, (•••). The grid scrolls horizontally.
- **Line row "•••"**: Show Details, Edit, Delete.
- **Empty state**: a box icon, "No product has been created yet." and a **Create Product** button.
- **Next Step** is disabled until there is at least one line.

#### Edit Product drawer (line editor)
| Field | Type | Req | Notes |
|---|---|---|---|
| SKU | read-only | | |
| Product Description | read-only | | |
| Pack Type | dropdown | | the product's UOMs (e.g., `Each`) |
| Quantity | numeric stepper | * | Apply is disabled while empty |
| Price Per Pack Type | decimal | * | default 0.00. A price of 0 is allowed. |
| Total Price | read-only | * | equals qty × price (e.g., 10 × 5.00 = 50.00) |

Section **"Receiving Details"**:
| Field | Type | Notes |
|---|---|---|
| Received Quantity | numeric | disabled on create |
| Receiving Location | async select, "Select inventory location" | needs 3 or more characters to search |
| Expiry Date | date | disabled unless the product is expiry-tracked |
| Production Date | date | disabled unless the product is tracked |
| Lot Batch Number | text | disabled unless the product is lot-tracked |
| LP Type | select | "NO DATA FOUND" in the sandbox |
| LP Number | combobox | "Select LP Number" |

Footer: `Cancel` | `Apply`. Apply adds or updates the line and updates Number of SKU, Total Qty and the Price card.

### Step 3 — Vendor
- A grid of the vendors that belong to the selected client:
  - Search box: "Search by client name".
  - Filter button.
  - **Add New Vendor** primary button (opens the Create Vendor drawer with Client prefilled; see Vendors below).
  - Columns: checkbox, VENDOR DISPLAY NAME, VENDOR NAME, and an orange **edit pencil** button per row.
  - Pager and `Total: 1`.
- Select exactly one vendor with its checkbox, then click **Next Step**.

### Step 4 — Other Info
- Text: "You can optionally add or edit custom fields under "Other Info" tab".
- A blue (+) **Add/Edit Custom Field** link with an (i) icon opens the **"Create Custom Field"** drawer:
  - Custom Field Type* (select: Text Box, Drop Down, Date Picker, Toggle)
  - Custom Field Name*
  - Is Active (segmented control: Yes, highlighted green by default / No)
  - "+ Add More Custom Field" (adds another row)
  - Footer: Cancel | **Add To Form**
  - The defined custom fields then render as inputs on this step. They map to the Custom Field Text Box 1-3 / Drop Down 1-2 / Date 1-3 / Toggle 1-2 filters on the list.
- **Buttons**: Back | Next Step.

### Step 5 — Confirm
- **Summary lines table**: IMAGE (thumbnail, SKU and name), PRODUCT, PACK TYPE, QUANTITY, PRICE PER ITEM, TOTAL.
- **Vendor card**: display name, vendor name, **Shipping Address**, **Billing Address**.
- **Order Details card**: PO number, PO type, `Client: X`, `PO date: M/D/YYYY`, warehouse name, and a warehouse illustration.
- **Back** button.
- The right rail shows `%100` and enables **Confirm Purchase Order**.
- **Duplicate PO number**: Confirm shows a red full-width dismissible banner at the top of the step: "This purchase order code already exists (KS-TEST-PO-001)". The user must click Back to Step 1 to fix the number.
- **Success screen** (replaces the form at the same URL): "You have successfully created a new purchase order: KS-TEST-PO-001". Under "What can you do next?" there are three option cards:
  - "Go Back To Purchase Order List" — "Turn to Purchase Order screen to see a full list of orders."
  - "Create Another Purchase Order" — "Turn to create order form to create another purchase order."
  - "Check the PO Receiving History" — "Control the received purchase order history to see pending and received quantities."
- A new PO is created with status **Pending**.

---

## Purchase Order Detail / Edit

- **URL**: `/en/wms/purchase-order/form/edit/{guid}`. Title: "Edit Purchase Order - Logiwa". Breadcrumb: Home > Purchase Order > Edit Purchase Order.
- The page opens on **Step 5 Confirm**, which is the read view. All steps show green checks, and the step headers are clickable to jump and edit.
- On edit, Step 1 has **Client locked** (disabled chip, no asterisk). Warehouse, PO number, PO type, the dates, Reference Number and Note stay editable, even on Cancelled and Completed orders.

### Right rail
- **Save Purchase Order** (primary; at the top and repeated at the bottom of the rail).
- **Other Actions ˅** dropdown:
  - `Receive PO`, `Delete Order`, `Cancel Order`.
  - All three are **enabled when Pending**. They are **disabled when Completed**; Cancelled was observed with the menu but item state was not captured.
  - Cancel Order shows the confirm dialog "Are you sure you want to cancel selected order(s)?" with an order table, then a Success toast "You have successfully cancelled an order." The pill becomes **Cancelled**.
- **Summary card**: PO number (large bold), PO type, Vendor (right-aligned), PO Date, a **Show Change Log** link, the status pill, and a small **pencil** icon beside the pill (manual status edit; unknown options), followed by **Total $X**.
- **Billing Charges card**: "Download Billing Charges" button and the text "Click to download the latest billing charges".
- **Printouts card**: "Documents — Not Available" in red, with a **+** button (Upload Document modal) and an **eye** button (view documents).
  - **Upload Document modal**: Document Type select (GiftNote, PackingInstruction, PackingDocument, Bill of Lading, External, Invoice), a dashed drop zone with a (+) and "File Text", and a **Save** button.

### Purchase Order Change Log
A right drawer titled "Purchase Order Change Log".
- Columns: TYPE (a blue circle icon plus `Create` / `Update`), MESSAGE, OPERATION DATE, SOURCE (user email).
- Paged: `Show 100 items`, `Total: 6`.
- Example rows, newest first:
  - `Update | Logiwa.NameKey.PurchaseOrderStatusName is modified. Pending --> Completed`
  - `Update | Logiwa.NameKey.CompletedDateTime is modified. ' ' --> 2026/10/16 4:30 PM`
  - `Update | Actual Receiving Date is modified. ' ' --> 2026/10/16 4:30 PM`
  - `Update | MLT-WIDGET-01 -> Logiwa.NameKey.ReceivedUOMQuantity is modified. 0 --> 24`
  - `Create | MLT-WIDGET-01 -> Purchase Order Line is created.`
  - `Create | MLT-PO-002 -> Purchase Order is created.`
- Logging is field-level: old value --> new value, with line-level entries prefixed by the SKU. Receive events update ReceivedUOMQuantity per line, then CompletedDateTime and Actual Receiving Date, then status.

### Business logic inferred
- **Status flow**: Pending → Started (some lines partially received) → Completed (all lines fully received). Pending or Started → Cancelled through Cancel Order.
- **Receive PO** (bulk or Other Actions) receives the remaining quantity of every line into the default receiving location and stamps Actual Receiving Date and CompletedDateTime.
- Purchase Price on the list is the sum of qty × price per item.

---

## Import Purchase Order

- **URL**: `/en/wms/import/purchaseorder/3`. Title: "Import Purchase Order - Logiwa".
- **Helper text**: "You can bulk import purchase orders by using an Excel file. Excel file import history will be listed below. You can reach old import files there." A "Go back to purchase orders" link returns to the list.
- **Card 1 — "Download our excel template"**: "To import your purchase orders and vendors, download our template." A **Download** button. Followed by "If you want to use your own Excel file to import products read the **Import Purchase Order Manual**." (link).
- **Card 2 — upload**: a **Select** button and a drop zone, "Drop files here to upload" / "Drag and drop or browse".
- **History grid**: STATUS, MASTER ROW COUNT, SUCCESS COUNT, ERROR COUNT, UPLOADED BY, CREATED DATE TIME, ACTIONS (presumably download the original or the error file). Empty: "No records to display".

---

## Receiving History

- **URL**: `/en/wms/purchase-order/receipt/list`. Title: "Receiving History - Logiwa". Breadcrumb: Home > PO & Receiving > Receiving History. The H1 stays "Purchase Order" and the RECEIVING HISTORY tab is active.
- **Helper text**: "The Receiving History Report lists all past purchase order receiving actions and inventory adding actions."
- **Header buttons**: none.
- **Toolbar**: search-mode button, "Search by PO number", Filter, refresh. There are **no bulk actions and no row checkboxes**.

### Columns
There are 34 columns, all visible by default (Edit Table Columns lists each one):
Master Id (blue link) · PO Number · PO Type · SKU · Product Name · Barcode · Lot/Batch Number · Expiry Date · Quantity · Product Photo(s) (header has a ? help icon) · Pack Type · UOM Pack Type · UOM Quantity · Receiving Date · Receiving Type · SKU Details Updated (Yes/No) · Note · Purchase Order Line Note · Actual Return Reason · Customer Return Reason · Client · Warehouse · Location · Work Order Code · Shipment Order Code · RMA Number · LPN · LP Type · Parent LP · Parent LP Type · Damage Reason · Damage Image · Receiving User · Production Date.

**Sample rows**:
- `11346680 | KS-TEST-PO-001 | Purchase Order | MLT-WIDGET-01 | MLTest Widget | MLT000001 | | | 10 | | Each | Each | 10 | 11/5/2026 3:41:31 PM | Purchase Order | No | ... | MLTest | MLT1 - Test Warehouse | MLT1-RECV | ... | Mike Lunsford`
- `11282226 | - | | DW-FP-18-6 | DUDE Wipes 18ct ... | 10850030628401 | 1114 8404 | | 30 | Each | Each | 30 | 11/3/2026 12:50:40 PM | Kitting | No | ... | FG1 | WO1114 | ... | Sydney Baker`. Rows not tied to a PO show "-" for PO Number.
- A row with an LPN: `... | Receiving (location) | 8712371287 (LPN) | Pallet (LP Type)`.

### Values
- **Receiving Type**: Add Inventory, DisassembleKit, Kitting, Product Receive, Purchase Order, Return.
- **Damage Reason**: Bad Packaging, Broken, Damaged, Extra, Leaking, Missing, OnHold, Quarantined (plus Empty).

### Filter fields
| Field | Editor |
|---|---|
| Client | multi-select |
| Damage Reason | multi-select |
| Expiry Date | date |
| ID | text |
| Is SKU Details Updated? | Yes/No |
| Location | text with operators |
| Lot Batch Number | text |
| LP Number | text |
| LP Type | text |
| Pack Type | text or select |
| Parent LP Number | text |
| Parent LP Type | text |
| PO Number | text |
| Product Name | text |
| Production Date | date |
| Purchase Order Type | multi-select |
| Quantity | Min–Max |
| Receiving Date | date |
| Receiving Type | multi-select |
| RMA Number | text |
| Shipment Order Code | text |
| SKU | text |
| Store Order Number | text |
| Warehouse | multi-select |
| Work Order Code | text |

### Row "•••" menu
**Cancel** (reverses the receipt).
- Confirm dialog: "Are you sure you want to cancel the receiving?" / "This action cannot be undone." / No / Yes.
- **Rule**: if the parent order is Completed, the action fails with an Error toast: "A received line of an order in completed status can't be cancelled." So a receipt can be reversed only while its PO is Pending or Started.

### Master Id link
Styled as a link (`link-to-detail`). Clicking it in the automation did not navigate in the same tab; the detail target is **unknown** (likely a receipt detail or the inventory transaction in a new tab).

### Footer
Large/Small density, page size, pager, **Export As Excel**, `Total: 57`.

---

## PO Receiving Report (Partial Receipt)

- **URL**: `/en/wms/report/partial-receipt`. Title: "PO Receiving Report - Logiwa". Breadcrumb: Home > Reports > PO Receiving Report.
- **Helper text**: "The PO Receiving Report shows the history of your received purchase orders based on the quantity you have received."
- **Toolbar**: search ("Search by PO number"), Filter, refresh. There are no bulk actions.

### Columns
One row per PO line:
WAREHOUSE · CLIENT · PO CODE · SKU · PRODUCT NAME · PACK TYPE · BARCODE · DAMAGED QUANTITY · PO QUANTITY · PO UOM QUANTITY · RECEIVED UOM QUANTITY · RECEIVING DIFFERENCE.

- **Receiving Difference** equals Received minus PO quantity. It is blank when 0.
- Negative values render as a **red pill**: class `negative-difference`, text `rgb(237,99,74)`, background `rgba(237,99,74,0.24)`, padding 5px 10px, radius 5px. Example: `POTEST1 | SKU4 | PO 350 | received 100 | -250`.
- Positive (over-receipt) styling: unknown.

### Filter fields
Client, Damaged Quantity, Has Difference? (Yes/No), Order UOM Quantity, Pack Type, PO Code, Product Name, Product SKU, Receipt Difference, Received UOM Quantity, Warehouse.

### Sample rows and footer
- **Sample row**: `MLT1 - Test Warehouse | MLTest | KS-TEST-PO-001 | MLT-WIDGET-01 | MLTest Widget | Each | MLT000001 | 0 | 10 | 10 | 10 | (blank)`.
- **Footer**: density, page size, pager, Export As Excel, `Total: 26`.

---

## Vendors (List + Create/Edit)

- **URL**: `/en/wms/purchase-order/vendor/list` (task alias `/en/wms/vendor/list`). Title: "Vendors - Logiwa". Breadcrumb: Home > PO & Receiving > Vendor.
- **Helper text**: "You can create, edit, and delete vendors from this screen. A vendor refers to a supplier of any goods or service. Generally, a vendor manufactures inventory/stock items and sells them to you."
- **Header button**: **Create Vendor** (primary).
- **Toolbar**: search-mode button, "Search by Company Name", Filter. There are **no row checkboxes and no bulk actions**.

### Grid
- **Columns**: VENDOR DISPLAY NAME (blue link that opens the Edit drawer, sortable), VENDOR NAME, CLIENT (sortable), and •••.
- **Rows**: DUDE Products LLC / DUDE Products LLC / DUDE Products LLC; Team 1 / Team 1 / Ultra Marketing Inc.; MLTest Vendor / MLTest Vendor / MLTest; TestVendor / TestVendor / testclient. `Total: 4`.
- **Filter fields**: Client, Company Name, Company Nickname. Display name maps to "nickname" and vendor name maps to "company name" in the backend.
- **Row "•••"**: `Edit`, `Change Log` (a change-log drawer like the PO one).
- **Footer**: page size, pager, Export As Excel. No density toggle was observed.

### Create Vendor / Edit Vendor drawer
- **Client\***: select. Required on Create from the list. Prefilled as a chip when the drawer is launched from the PO wizard. Locked on Edit.
- **Display name\***: text, max 100. Error text: "Vendor display name is required."
- **Vendor name\***: text, max 255. Error text: "Vendor name is required."
- **Toggle** "Use shipment address as billing address": on by default.
- **Section "Shipment address"**:
  - Address name (max 50)
  - Address line 1 (max 256)
  - Address line 2 (max 256)
  - Postal Code
  - City
  - Phone Number
  - Country\* (default "United States of America"; full country list)
  - State\* (default "Alabama"; depends on Country)
- **Section "Billing address"**: shown only when the toggle is off. It has the same fields as Shipment address.
- **Footer**: Cancel | **Save**.
- **Scoping**: vendors belong to one client, and the PO wizard's Vendor step lists only the selected client's vendors.

---

## Not accessed / unknown
- **Import Serial Numbers**: page not opened.
- **Saved filter views**: the "Saved" tab content was not opened.
- **Page-size options**: the list was not opened.
- **Field-validation text on PO Step 1**: inline error messages not captured.
- **Status ids 2 and 5**: labels unknown.
- **Status pencil**: options for the pencil next to the status on the detail page are unknown.
- **Partial-receive UI**: no partial-receive (line-quantity) screen exists on the web PO page. Partial receiving is done on mobile/RF, and the web "Receive PO" receives all lines.
- **Receiving History Master Id**: detail target unknown.
- **Label printing**: Label > Product Label / Purchase Order print previews were not opened.
- **Delete Purchase Order**: not executed. Its confirm dialog is presumably the same style as the others.
- **Tooltips**: text of the (i) tooltips on PO type and Reference Number not captured.
