# Logiwa iO LIVE capture: Inbound, Inventory, Counts, Work Orders, Replenishment

Captured on 2026-11-09 from the live sandbox `my.logiwa.com`. Warehouse: **MLT1 - Test Warehouse**. Client: **MLTest**. The session was already signed in.
This file adds to `references/logiwa-spec/03-inbound.md`, `04-inventory.md` and `02-fulfillment-ops.md` §7–8. Those files remain the base spec. This file records what was seen live, the exact strings, and the behaviours that only show up when you run the flows. The last section is a delta list.

### Test records created in this session (all MLT1 / MLTest)

| Record | What was done | End state |
|---|---|---|
| **KS-REF-PO-001** | PO with 2 lines: MLT-WIDGET-01 ×12 @ $3.25 → MLT1-RECV; MLT-KITTEST-COMPA ×6 @ $1.50. Received via Other Actions → Receive PO. Status changed by hand from Completed to Started. The COMPA receipt was then cancelled. | **Started** (WIDGET 12/12, COMPA 0/6). An async delete was attempted and did not remove it. |
| **KS-REF-COUNT-01** | Location count plan with MLT1-B-01 and MLT1-RECV. | **Cancelled** |
| **KS-REF-WO-001** | Kitting work order without picking: MLT-KIT-2PK ×2, component MLT-WIDGET-01 from MLT1-B-01. Create Kit was run for 1 kit, into MLT1-A-01. | **Open**, processed 1 of 2 |

Inventory side effects:
- Transfer of 5 × MLT-WIDGET-01 from MLT1-RECV to MLT1-B-01.
- Adjustment on MLT1-RECV from 16 to 15 (note "KS-REF adjust test").

---

## 0. Navigation map

### Top mega-menu
Each top-level item opens a panel with grouped columns. The URLs are the live hrefs.

- **Fulfillment**
  - Outbound: Shipment Orders `/shipment-order/list` · Shipped Orders `/shipment-order/shipped/list` · Carrier Shipment Details `/shipment` · End Of The Day `/shipment/end-of-day` · Packing Station `/packing-station`
  - Task Management: Job Management `/job/management` · Order Operations Task Details `/task-details/order-operations/list` · Count Task Details `/task-details/count/list` · Replenishment Task Details `/task-details/replenishment/list`
  - Shipment: Shipment History `/shipment-order/shipment-history/list` · Shipment Plan `/shipment-plan`
- **Inventory**
  - Inbound: Purchase Orders `/purchase-order` · Receiving History `/purchase-order/receipt/list` · Return Station `/return-station/dashboard` · Return Orders `/shipment-order/return/list` · Work Orders `/work-order/list`
  - Inventory: Total Inventory `/inventory/total` · Inventory by Location `/inventory/list` · Available To Promise (ATP) `/report/available-to-promise`
  - Count Operations: Count Plan `/count/plan/list` · Count Location Details `/count/location/list` · Count SKU Details `/count/product/list`
- **Automation** → Workflows & Algorithms: Algorithms · Workflows · Rate Shopping · Wave Rules
- **Integrations**
  - Plugin Integrations
  - Channel Logs
  - Channel Monitoring (6 items)
  - Carrier Monitoring
- **Reports**
  - Orders: Channel Sales Report · Shipment History · Shortage Report
  - Inventory: ATP · Kit Inventory Report · Kit Component Inventory Availability Report · Serial Number Report · Order Inventory `/report/order-inventory` · **Dynamic Replenishment Report** `/report/replenishment` · Inventory Snapshot Report
  - Logs: Change Log · **Transaction History** `/report/transaction-history` · Integration Log · Missing Log · Serial Number Transaction History · Allocation Exceptions · Wave Log Report · Excel Export History
  - Receiving: PO Receiving Report `/report/partial-receipt` · Receiving History
  - Warehouse Efficiency: User Performance Report
- **Analytics**
  - Labor Analytics: 5 pages, including Receiving Performance Analysis
  - Operational Analytics: **Inbound & Inventory Dashboard** `/operational-analytics/inbound-inventory` · Fulfillment · Management · Productivity
- **Settings**
  - Master Data: Products · Product Listings · Locations · Vendors · Customers · Retailers
  - Configuration: Warehouse · Mobile Carts · LP Types · LP Numbers · Shipment Packages · Printouts & Labels · Data Setup · Job Types · Screen Configuration
  - Client Setup: Clients · 3PL Billing · Billing Report · VAS Operations
  - Users: Users · Roles

The top bar on the right holds: global **Search** pill, video icon, refresh/transactions icon, printer (direct-print) icon, help (?), user avatar.

### Drill-down and cross-links seen live

| From | Action | Goes to |
|---|---|---|
| PO list | PO Number link, or row ••• → Show Details / Edit | `/purchase-order/form/edit/{guid}`, which opens on Step 5 |
| PO create success screen | 3 cards | PO list · new create form · Receiving History |
| Receiving History | **Master Id** link | **New tab**: `/report/serial-number-report/receiving-history?ri={masterId}&riqt=eq&ps=100` |
| Receiving History | empty state link "You can create purchase orders here." | PO create |
| Total Inventory | SKU / Open SO Qty hyperlinks | New tab: product list / shipment-order list, prefiltered (see 04 spec) |
| Count Location Details | **Job Code** link (blue, with open-in-new icon) | Job in a new tab |
| Count Plan list | Count Code link | "Edit Count" drawer. This also happens for Inventory Updated plans; the drawer is still editable. |
| Work Order list | Code link, or ••• → Show Details | "Edit Work Order" drawer |

- **URL state.** Toolbar search writes `?{key}=value&{key}qt=eq&ps=100` and also adds a removable filter chip, e.g. "PO Number equals K…".
  - Search keys are page-specific: Receiving History uses `poc` (PO code), Inventory by Location uses `psku`, PO list uses `code`.
  - On Receiving History, `pn` means **Product Name**, not PO number.
- **Searching.** The search runs on **Enter or the magnifier**. When a search is active, the search box gets a solid blue border/fill.

---

## 1. Purchase Order List — `/en/wms/purchase-order/list`

The base spec (03 §PO List) is confirmed. Live additions:

- **Page-size dropdown options**: `100 | 300 | 500 | 700 | 1000`. The list opens upward.
- **Bulk toolbar** order: `Tag | Label ▾ | Cancel Order | Receive PO | Delete ▾ | ⟳`.
  - Everything is disabled until a row is selected.
  - After an action clears the selection, **Cancel Order** and **Receive PO** were seen still rendering as enabled. This is probably a Logiwa bug; KitStaks should not copy it.
- **Label ▾**
  - Items: `Product Label` | `Purchase Order`.
  - **Product Label** opens the **"Print Options" modal**:
    - Blue header band with a printer illustration and an × close button.
    - A template card with radio-square, grey "Default", bold "Product Label".
    - **Print Quantity** numeric stepper, default `1`.
    - Toggle **"Use as Line Quantity"**, default off. When on, it prints one label per received unit of each line.
    - Buttons: `Preview` | `Download` (outline), and a full-width primary `Print`.
- **Delete ▾**
  - Items: `Delete Purchase Order`, in red text and enabled; `Remove Serial Number`, greyed out and disabled when there are no serials.
  - Clicking Delete Purchase Order opens the modal **"Are you sure?"**, body "All selected Purchase Orders will be deleted.", buttons `Cancel` (grey) | `Delete` (red outline).
  - After confirming, a **blue "Info" toast** appears: "Deletion operation will be completed soon". Deletion is **asynchronous**.
  - A PO that already has receipts was **not** deleted, and no error appeared in the grid. The failure is silent in the list and is probably reported in the Transactions popup.
- **Row •••**: `Show Details` | `Edit` | `Delete`.
- **Status pill classes and colours** (computed live):
  - Pending: grey `#E3E6E8` / `#50575C`
  - Started: blue `#D5E5F2` / `#0D36A3`
  - Completed: green `#D3F0E3` / `#17874D`
  - Cancelled: red `#FBDBDE` / `#B20B1C`
- **Toasts** are a **solid filled banner at the top-centre** of the page, not at the bottom-right:
  - Success: green `#0B8A47`-ish, white text, check icon.
  - Error: red.
  - Info: blue.
  - Each has a bold title, a message line and a darker square × button on the right. They auto-dismiss.

## 2. Create Purchase Order wizard — `/purchase-order/form/add`

### Step navigation
- Steps: `1 PO Details · 2 Products · 3 Vendor · 4 Other Info · 5 Confirm`.
- Completed steps get a green circle-check next to "Step N" and a green label.
- The active step is bold black. Future steps are grey.
- Header buttons are **not clickable on create** and **are clickable on edit**.

### Step 1 — PO Details
- **Next Step is disabled** (`disabled` attribute) until the required fields are valid. You cannot click it to trigger validation.
- **Inline validation** appears on blur of a touched empty field: a red border plus red text below.
  - Seen text: **"Order code is required."** for PO number.
  - The other required fields follow the pattern "<Label> is required."
- **Layout.** Warehouse and Client are on row 1. Selecting the warehouse re-flows the grid: PO number and PO type move up.
- **Client dropdown**
  - Has an inline search box at the top of the popup and lists all 31 clients alphabetically by display order.
  - The chosen value renders as a grey chip with an ⓧ.
- **PO type**: the options appear in this order:
  1. Transfer Order
  2. Purchase Order- Non Crossdock
  3. Return Order
  4. Open Order
  5. Purchase Order
- **PO date** defaults to the current local time, format `YYYY/MM/DD HH:mm`. The input is a Kendo datetime "spinbutton".
- **Field limits**: PO number maxlength 50 (`0 / 50` counter), Reference Number 100, Note 500.
- **(i) icons** sit next to PO type and Reference Number. They are present, but their hover tooltips did not render in automation.

### Step 2 — Products
- **SKU search**
  - The combobox needs 3+ characters.
  - With fewer than 3, the panel shows "You have to enter **at least 3 characters** to search."
  - It is **debounced**: results appear after a pause or after the next keystroke.
  - Each result row shows: image placeholder, SKU in bold, name in grey, a qty stepper (default 1, ▲▼) and a **+** button.
- **Line editor.** Clicking + opens the **"Edit Product"** right drawer.
  - **Header fields**
    - SKU and Product Description: read-only grey.
    - Pack Type: dropdown, default `Each`.
    - **Quantity\***: stepper, prefilled from the search stepper.
    - **Price Per Pack Type\***: default `0.00`.
    - **Total Price\***: read-only, equals qty × price. It does **not** recompute when Quantity is cleared.
  - **Receiving Details** section
    - Received Quantity: disabled. It shows `0` on edit.
    - Receiving Location: async picker, 3+ characters, value shown as a chip.
    - Expiry Date and Production Date: disabled unless the SKU is tracked.
    - Lot Batch Number: disabled unless the SKU is tracked.
    - **LP Type**: options are "CODE (WH)", e.g. `KS-TEST-TOTE (MLT1)`.
    - LP Number: combobox.
  - **Validation**: an empty Quantity gets a red border, no text, and **Apply is disabled**.
  - **Esc closes the drawer and discards** the line.
- **After Apply**
  - Toast: **"Success — 12 product with SKU MLT-WIDGET-01 added successfully"**.
  - New lines are **prepended** at the top of the grid.
  - The `Number of SKU` and `Total Qty` chips update, and so does the right-rail Price total.
- **On edit**, Step 2 gets an extra **`Export`** button (green outline) to the left of `Label`. Lines get a checkbox column with select-all.
- **Line row •••**: `Show Details` | `Edit` | `Delete`.
- **Default location.** A line with no receiving location is received into the warehouse default receiving location (`MLT1-RECV`).
- The PO % ring goes from `%25` (step 2) to `%100` (step 5), with the truck icon in a blue ring.

### Step 3 — Vendor
- The grid has row checkboxes only; there is **no select-all**.
- **Next Step stays disabled until one vendor is ticked.**
- Toolbar: `Filter` and `Add New Vendor` (primary).
- Footer: "Show 100 items", pager, `Total: 1`.

### Step 4 — Other Info
- The text reads: You can optionally add or edit custom fields under "Other Info" tab.
- It has a blue ⊕ link **Add/Edit Custom Field** with an (i).
- Buttons: Back | Next Step.

### Step 5 — Confirm
- **Lines table** columns: IMAGE (thumbnail, SKU, name), PRODUCT, PACK TYPE, QUANTITY, PRICE PER ITEM ($), TOTAL ($). It scrolls horizontally.
- **Vendor card**: name ×2, then empty "Shipping Address" and "Billing Address" rows.
- **Order Details card**: PO#, type, Client, PO date `M/D/YYYY`, warehouse name, warehouse illustration.
- **Confirm Purchase Order** (right rail, full width, primary) is enabled only at 100%.
- **Success screen**: "You have successfully created a new purchase order: KS-REF-PO-001", then **"What can you do next?"** with 3 cards:
  - Go Back To Purchase Order List
  - Create Another Purchase Order
  - Check the PO Receiving History

## 3. Purchase Order Detail (Edit) — `/purchase-order/form/edit/{guid}`

- Opens on **Step 5 Confirm** with all steps green-checked and clickable.
- **Right rail**, top to bottom:
  - **Save Purchase Order** (primary)
  - **Other Actions ▾**
  - Summary card
  - Billing Charges card
  - Printouts card
  - **Save Purchase Order** again
- **Other Actions ▾**: items `Receive PO` | `Delete Order` | `Cancel Order`. Disabled items use the class `myl-action-menu-item-disabled` and are greyed.

| PO state | Receive PO | Delete Order | Cancel Order |
|---|---|---|---|
| Pending, nothing received | ✔ | ✔ | ✔ |
| Started, lines remaining | ✔ | ✖ (has receipts) | ✔ |
| Started, all lines fully received (manual status) | ✖ | ✖ | ✖ |
| Completed | ✖ | ✖ | ✖ |

- **Receive PO** (Other Actions) receives every remaining line **at once with no confirm**.
  - Toast: **"Success — You have successfully received orders."**
  - Status changes to Completed, and Actual Receiving Date and CompletedDateTime are set to now.
- **Summary card**: PO# (large), type, "Vendor" label with name right-aligned, PO Date, `Show Change Log` link, status pill.
- **Status pencil** (✎ beside the pill)
  - Shown only when the status is **not Pending** (seen on Completed and Started; absent on Pending).
  - It opens the modal **"Change Purchase Order Status"** with 4 radio pills: `Pending` | `Started` | `Completed` | `Cancelled`.
  - The current status is selected. Pending and Cancelled are disabled when the PO is Completed.
  - Single full-width **Save** button.
  - Changing Completed to **Started** re-opens the PO: it clears CompletedDateTime and Actual Receiving Date, and the change log records this.
- **Change Log drawer** (Show Change Log)
  - Newest first, `Total: N`. Columns: TYPE (icon + Create/Update), MESSAGE, OPERATION DATE (`M/D/YYYY h:mm:ss AM`), SOURCE (user email).
  - Messages seen:
    - `KS-REF-PO-001 -> Purchase Order is created.`
    - `MLT-WIDGET-01 -> Purchase Order Line is created.`
    - `MLT-WIDGET-01 -> Logiwa.NameKey.ReceivedUOMQuantity is modified. 0 --> 12`
    - `Actual Receiving Date is modified. ' ' --> 2026/11/10 2:18 AM`
    - `Logiwa.NameKey.CompletedDateTime is modified. ...`
    - `Logiwa.NameKey.PurchaseOrderStatusName is modified. Pending --> Completed`
    - `... Completed --> Started`
  - The raw i18n keys leak into the messages. This is a Logiwa bug; KitStaks should show human labels.
- **Partial receiving is not possible on web.** Received Quantity in the line editor is always disabled. Partial receipts happen on mobile, or through receipt cancellation.

## 4. Receiving History — `/purchase-order/receipt/list`

- **Empty state**: illustration with "There is no receiving history." and the link "You can create purchase orders here."
- Searching by PO number returns 1 row per received line, so 2 rows for KS-REF-PO-001.
  - A line received without an explicit location shows Location = MLT1-RECV.
  - Receiving Type is "Purchase Order", and Receiving User is the user's full name.
- **Master Id link** opens a new tab: the Serial Number Report receiving-history view filtered by that receipt id.
- **Row ••• → Cancel**
  - Opens the modal **"Are you sure you want to cancel the receiving?"**: red header band with a white ✕ circle, "This action cannot be undone.", buttons `No` | `Yes`.
  - On Yes, the grid reloads with a spinner, the **receipt row disappears** from the history, and the PO line's Received Qty goes back to 0.
  - The PO stays **Started**, and Receive PO is enabled again.
  - The inventory ledger posts a **"Cancel Receiving"** transaction with qty −6.
  - Rule from the spec: a cancel is refused when the PO is Completed. (Here the PO had first been moved to Started by hand.)

## 5. Inventory by Location — `/inventory/list`

- Total is now 8,048 rows across all warehouses. Grid columns are as in the 04 spec.
- **Merge behaviour**: receipts and transfers **merge into an existing Stock row** with the same SKU/location/LP/lot/status, rather than creating new rows. Example: MLT1-RECV went from 9 to 21 after receiving 12.
- **Row •••** (Stock rows only): `Add` | `Adjust` | `Remove`.

### Adjust Inventory drawer
- The fields are prefilled and disabled as in the 04 spec.
- **New Quantity\*** has an (i) tooltip, purple bubble: **"Replaces current inventory with this new total. Setting the quantity to 0 will delete this inventory record."**
- **Adjustment Reason** options: Inventory is missing · Inventory quantity discrepancy · Classic Migration. The first entry is a grey "Select adjustment reason".
- Save gives the toast **"Success — Inventory updated successfully."** The ledger posts the **delta** (−1) as type "Inventory Adjustment", with reason and note.

### Transfer Product drawer (bulk, 1 row)
- **Header card**: image, SKU / name; "Transfer from LP/Loc" with the code at top-right; then Pack Type, Pack Qty, Damage Reason, Expiry Date, Production Date, Lot/Batch Number.
- **Transfer Product Quantity\*** has **no client-side max**.
- **Move to LP/Location\***: async, 3+ characters, lists locations and LPs.
- **Transfer** is enabled once both fields are filled.
- **Over-quantity** (99 when 21 are available): red Error toast **"The entered transfer quantity exceeds the existing inventory amount."** The drawer stays open.
- **Success**: toast **"Transfer completed successfully"**. The drawer closes and the selection clears. The grid needs a refresh to show the new quantities; KitStaks should auto-refresh.
- The ledger posts type "Inventory Movement" with source and target location, location area types, and quantity.

## 6. Transaction History (inventory ledger) — `/report/transaction-history`

This is the audit ledger behind every inventory action.
- **Tabs**: TRANSACTION HISTORY | SERIAL NUMBER TRANSACTION HISTORY.
- **Helper text**: "Transaction History report helps you monitor all the transactions occuring within the inventory".
- **Columns** (≈55):
  - Transaction Type, Warehouse, Client
  - Shipment Order Code, Original Order Code, Shipment Order Type
  - Purchase Order Code, PO Number, RMA Number, Receiving Date, Work Order Code
  - Algorithm Name, Algorithm Rule Name
  - SKU, Product Name, Barcode
  - From/To/UOM Pack Type, Adjustment Reason
  - Source Location, From Location Group, From Location Area Type
  - Target Location, To Location Group, To Location Area Type
  - Source/From-Original/Target/To-Original LPN and Parent LP (+ type)
  - Count Plan Code
  - **Action UOM Quantity**, **Action Pack Quantity** (signed)
  - From/To Damage Reason, From/To Expire Date, From/To Lot/Batch
  - Transaction Date, Transaction User (email, or "Auto Run" for system work)
  - From/To Production Date, Note
- **Transaction Type enum** (filter):
  - Allocation, Allocation Cancel, Attributes Change, Cancel Receiving, Count
  - Disassemble Kit, Inventory Adjustment, Inventory Movement, Kitting, Loading
  - Packing, Picking, Receiving, Replenishment, Return Receiving
  - Shipment, Sorting, Unloading
- **Filters**:
  - Client, Count Plan Code
  - From Damage Reason, From Expiry Date, From Location, From Lot Batch, From LP Number, From Parent LP Number, From Parent LP Type
  - Original Shipment Order Code, Pack Quantity, PO Number, Product Name, Purchase Order Code
  - Receiving Date, Shipment Order Code, Shipment Order Type, SKU
  - To Damage Reason, To Expiry Date, To Location, To Lot Batch, To LP Number, To Parent LP Number, To Parent LP Type
  - Transaction Date, Transaction Type, Transaction User, Warehouse, Work Order Code
- **Sample rows from this session**, newest first:
  1. Inventory Adjustment, −1, reason "Inventory quantity discrepancy", note "KS-REF adjust test".
  2. Inventory Movement, MLT1-RECV → MLT1-B-01 (Receiving → Storage), 5.
  3. Picking (another agent's KS-REF-SO-001).
  4. Cancel Receiving, KS-REF-PO-001, COMPA, −6.
  5. Allocation, rule "Default/Default".
  6. Receiving ×2, KS-REF-PO-001.

## 7. Count Plans — `/count/plan/list`

- **Toolbar**: `Cancel | Update Inv. (i) | Create Job | ⟳`.
- **Update Inv. (i) tooltip**: "Triggers inventory update for count lines with the Count Completed status in the selected count plans. Lines in other statuses will be canceled."
- **Create New Count drawer**
  - The stepper is a **2-segment tab bar**: "1.General" | "2.Tasks". The active segment is solid blue and the inactive one is white with grey text.
  - **Next with empty fields** gives red borders on Name and Warehouse, with **no message text**.
  - **Lock Locations** is a Yes/No pill. The active **No** is a solid red fill, and the active Yes is presumably green.
  - **Step 2**
    - Two checkbox cards: `Location Count` (default, checked, blue border) | `SKU Count`.
    - Buttons: `Remove` (light-red fill, disabled until rows are selected) and `Add` (green outline).
    - Empty grid text: "No records to display".
  - **Add Location modal**
    - Search "Search by code" plus Filter, and an `Add` button that is disabled until rows are checked.
    - Grid columns: checkbox, LOCATION, LOC TYPE, LOC GROUP.
    - MLT1 now also lists `KS-TEST-LOC-01 (Shelves)`.
  - **Save** closes the drawer. The new plan appears at the top, Pending. For a location plan, Number of SKU shows 0 and Number of Location shows 2.
- **Create Job modal**
  - Blue header band with a worker illustration and an × close button.
  - Fields: Job Type\* (search box; empty state "No job type has been created yet."), Batch Size(Location)\* stepper, Assign to.
  - Buttons: Cancel | Save (disabled).
- **Update Inv. on a plan whose lines are not Completed** opens the modal **"⚠ Attention"** (orange title). Exact copy:
  - "Selected count plans contain lines that are not in Completed status."
  - "If you proceed:"
    - "Inventory **will be updated** for Completed lines only" (green emphasis)
    - "Lines not in Completed status **will be canceled**" (red emphasis)
  - "Some of the lines in the following count plans will be cancelled: (1):" followed by the list of plan codes and a **copy-to-clipboard** icon button.
  - Blue info box: "To view the details, you can go to the **Location Details** or **SKU Details** screen."
  - Buttons: `Cancel` | `Proceed` (primary).
- **Bulk Cancel** opens the modal **"Cancel Count Plan(s)?"**: "You are about to cancel the selected count plan(s). **This action cannot be undone.**", buttons `Close` | `Cancel Count Plan(S)` (primary blue).
  - Toast: **"Success — Selected Count Plans cancelled successfully."**
  - The plan and all its lines become **Cancelled** (red pill).
- **Row •••** (Cancelled too): `Show Details` | `Edit` | `Delete`.
- **Count Code link** opens the "Edit Count" drawer with a small blue **"Count"** badge next to the title. It stays editable even for Inventory Updated plans.

## 8. Count Location Details — `/count/location/list`

- **Toolbar**:
  - `More Details` (green outline)
  - `Cancel`
  - `Update Inv. (i)`
  - `Create Recount (i)`, with tooltip: "Recount jobs can only be created for Cycle Count plans and only for lines in Count Completed status. Deselect any Instant Count plan lines to enable this action."
- **Job Code** cells are blue links with an open-in-new icon.
- **Row •••**: `Delete` only.
- Cancelling a plan cancels all of its location lines.

## 9. Work Orders — `/work-order/list`

- **Toolbar** (right side), in order:
  - `Disassemble Kit` (always enabled)
  - `Create Kit` (needs a selection)
  - **🖨 ▾ print dropdown**: `Print Picking List` | `Batch Picking List`
  - `Warehouse Ops ▾`: `Picking/Job Operations` | `Cancel Picking`
  - 🔖 tag icon button
  - ⟳ refresh
- **Status pills**
  - **Open**: teal `rgb(208,243,238)` / `rgb(22,194,170)`, class `table-status-1`.
  - **Completed**: green `rgb(211,240,227)` / `rgb(0,135,77)`, class `table-status-3`.
  - Statuses: Open, In Process, Completed, Cancelled, Shortage.
- **Row •••**: `Show Details` | `Edit` | `Change Log` | `Delete`.
  - Show Details opens the "Edit Work Order" drawer with Client disabled.
  - After partial kitting, the Kit picker is disabled.

### Create Work Order
The flow starts with an **Operation Type** panel: illustration plus a card "Kitting — Create a work order for kitting operations of kit-to-stock products". Clicking the card opens the 4-segment tab wizard.

1. **General**
   - Warehouse\*, Client\* (search, chip)
   - Work Order Code\* ("Enter Work Order Code")
   - Work Order Type\*: `Work Order with Picking` | `Work Order without Picking`
   - Extra Note
   - **Build For** segmented: `Stock` (default, solid blue) | `SO`. In edit there is a hidden "Select Shipment Order" input.
2. **Kit**
   - "Search and Add Kit-to-Stock Product" (kit-only search). Before selection the empty card reads "Select a kit".
   - **Kit card**: SKU, name, Pack Type, Lot Number / Exp. Date / Prod. Date Tracking Yes/No, and a qty stepper.
   - **Components**: chips `N Component Qty` and `N Total Qty` (= kit qty × per-kit qty). Each component card shows SKU/name, Pack Type, read-only Qty, and grey attribute chips `Location: - · LP: - · Lot No: - · Exp Date: - · Prod Date: -`.
   - A ✎ on each component opens the **"Edit Component" modal**:
     - Subtitle is literally "Kit component form description" (placeholder copy left in by Logiwa).
     - SKU (read-only), Qty (read-only, = total), Inventory Location (async, 3+ characters), Inventory LP, Lot Batch Number, Expiry Date, Production Date.
     - Buttons: Cancel | Save.
3. **Advanced**
   - Kitting Instructions (textarea)
   - Planned Start Date and Planned Finish Date
   - Actual Start/Finish Date: **disabled on create**
   - **Document**: "Upload documents for the kitting process" with a dashed ⊕ "Upload Document" box.
4. **Other Info**: the custom-fields link, then **Save**.

Save gives the toast **"Success — Work Order created successfully."** The new WO is at the top, **Open**, age 0.

### Create Kit (bulk, 1 WO selected) — 3-tab drawer
1. **Confirmation**: "Location or LP Confirmation".
   - **Source Location/LP\*** is required. Next shows a red border.
   - "Components — The components in this work order are listed below." with Component QTY / Total QTY chips and component cards.
2. **Information**
   - Kit Information card, with **Kit QTY editable** (partial kitting allowed; default = remaining).
   - **Target Location/LP\***.
   - Attribute Selection: Lot Number, Expiry Date, Production Date (disabled unless tracked).
   - Kitting Task Time Range: Actual Start/Finish Date-Time.
3. **Summary**
   - Kit Summary card with 🖨 and ✎ icons, and chips `Component SKU QTY : 1` and `Component Total QTY : 2`.
   - Kitting Process Summary: Source/Target Location, Actual Start/Finish.
   - **Inventory Transaction Summary** grid: SKU, LOCATION, CURRENT QTY, QTY CHANGE. The kit row shows **+1 in green** and the component row **−2 in red**.

Save gives the toast **"Success — Kit created successfully."** For a partial kit the WO stays **Open** with Processed Quantity = 1 of 2.

### Disassemble Kit — 2-tab drawer
1. **Select Kit**
   - Fields: Warehouse\*, Client\*, Source Location/LP\*, Target Location/LP\*.
   - **Kit\*** "Search and select the kit" opens a kit card with a qty stepper.
   - Expiry Date, Production Date, Lot Number.
2. **Summary**
   - Kit Summary with chips `Component SKU QTY`, `Component Total QTY` and `Stock QTY : n`.
   - **Print Product Barcode** button.
   - Inventory Transaction Summary: the kit row is **−1 red** and the components are **+2 green**. A component row ••• offers `Add Attribute`.
   - Footer: Back | Save. (Save was not executed. Esc closed the drawer and discarded it.)

## 10. Replenishment

### Dynamic Replenishment Report — `/report/replenishment`
- The helper text is literally "Dynamic Replenishment Report description" (Logiwa placeholder copy).
- **Columns**: WAREHOUSE, CLIENT, SKU, MIN REPLENISHMENT LEVEL, MAX REPLENISHMENT LEVEL, SOURCE LOCATION TOTAL QUANTITY, SOURCE LOCATION FREE QUANTITY, TARGET LOCATION AVAILABLE QTY, OPEN ORDER QUANTITY, OPEN REPLENISH TASK QTY, TO REPLENISH QUANTITY.
- **Formula** (checked against all 8 rows): **To Replenish = Max − Target Available + Open Order Qty − Open Replenish Task Qty**, floored at 0.
  - Example: SKU3 → 200 − 85 + 74 − 0 = **189**.
  - Example: sku213… → 100 − 0 + 0 − 100 = **0**.
- There is one row per SKU × warehouse that has min/max levels. Levels are set on Product → Replenishment Levels (Global or Per-Warehouse), see 05 spec.
- **Filters**: Client, Open Order Quantity, **Show Only Active Products**, SKU, To Replenishment Quantity, Warehouse.
- **Saved filter tab** (seen live):
  - The header changes to "Select Saved Filter Type".
  - New/Saved is a segmented control with Saved solid blue.
  - "Search saved filter" box. The list is empty when nothing is saved.

### Replenishment Task Details — `/task-details/replenishment/list`
- Breadcrumb: Home › Fulfillment › Task Details › Replenishment.
- Default chip: "Job Status in Pending, Started".
- Toolbar: **Cancel Task**.
- Columns are as in 02 spec §7c.
- Sample: Job5904213 "Dynamic Replenishment", Pending, **Replenishment Pick Phase**, LP Swap No, 100 Unit, b-1-4 → a-1-3.

---

## Delta vs existing spec (`references/logiwa-spec/*`)

### New
1. **Navigation**: full mega-menu group headings and items (§0). Neither spec 03 nor 04 had the column groupings.
2. **PO Step 1**: Next Step is **disabled until valid**. It is not a click-to-validate button. Error text pattern "Order code is required."
3. **PO line add toast**: "N product with SKU X added successfully". New lines are prepended.
4. **PO edit Step 2** has an extra **Export** button and a checkbox column.
5. **Print Options modal** for Label › Product Label: template card, Print Quantity, "Use as Line Quantity" toggle, Preview / Download / Print.
6. **Status pencil → "Change Purchase Order Status"** modal with 4 radio pills. It can re-open Completed to Started, which clears the completion dates. The pencil is hidden while Pending.
7. **Other Actions enablement matrix** by PO state (§3 table).
8. **Delete PO** modal copy ("Are you sure? / All selected Purchase Orders will be deleted.", Cancel / Delete). Deletion is **async**, with an Info toast. POs that have receipts are not deleted.
9. **Receipt cancel** removes the history row, reverts the line Received Qty, keeps the PO Started and posts a ledger "Cancel Receiving".
10. **Master Id** on Receiving History opens the Serial Number Report receiving-history view in a new tab. The spec had listed this as unknown.
11. **Receiving History empty state** copy.
12. **Toast style**: solid coloured banner at the **top-centre**, with Success green, Error red and Info blue. Spec 03 said bottom-right.
13. **Inventory**:
    - Adjust "New Quantity" tooltip copy: setting 0 deletes the record.
    - Transfer over-quantity error copy.
    - Success copy for both actions.
    - Merge-into-existing-row behaviour.
    - The grid does not auto-refresh after a transfer.
14. **Transaction History ledger**: full column, enum and filter lists. Adjustments post deltas, and the user shows as "Auto Run" for system work.
15. **Count**:
    - Update Inv. and Create Recount tooltips.
    - **Attention modal** for Update Inv. on non-completed lines.
    - "Cancel Count Plan(s)?" modal and its success toast.
    - The 2-segment tab-bar stepper style.
    - The red/green Yes/No pill colouring.
    - Job Code hyperlinks on Location Details.
16. **Work Orders**:
    - Toolbar includes a printer dropdown (Print Picking List / Batch Picking List). Warehouse Ops holds only Picking/Job Operations and Cancel Picking.
    - Operation Type chooser panel.
    - Edit Component modal.
    - **Create Kit 3-step drawer** with an inventory-delta preview. Partial kitting keeps the WO Open.
    - **Disassemble Kit 2-step drawer**.
    - Open pill colour is **teal**, not green.
17. **Dynamic Replenishment Report**: verified formula, filters, and the Saved-filter tab UI.
18. **Page sizes**: 100 / 300 / 500 / 700 / 1000, confirmed for the PO list too.

### Changed or corrected
- Spec 03 said "Clicking Next Step with empty required fields shows inline errors". In fact the button is disabled, and errors show on blur.
- Spec 03 said the status pencil is beside the pill on detail. It only appears when the status is not Pending.
- Spec 03 placed toasts at the bottom-right. They are at the top-centre as filled banners.
- Spec 02 §8 listed Warehouse Ops with 4 items. Live it has 2 items; the two picking-list prints sit under a separate printer-icon dropdown.

### Still unknown
- (i) tooltip text on PO type and Reference Number: hover did not render in automation.
- The Purchase Order document print (Label › Purchase Order) did not open a visible modal.
- The result of the async delete failure; it is probably in the top-bar Transactions popup.
- Count Update Inv. "Proceed" path with Completed lines: no count job type exists in MLT1, so no counted lines.
