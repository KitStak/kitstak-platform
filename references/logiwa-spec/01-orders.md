# Logiwa iO Reference Spec: Shipment Orders and Shipping (cluster 01)

Captured 2026-11-05 from the my.logiwa.com sandbox, scoped to warehouse **MLT1 - Test Warehouse** (client **MLTest**). Other-warehouse data appeared only in read-only grids. It is anonymized below and used only to show value formats.

Test records created during capture (they stay in the sandbox):
- Shipment order **KS-TEST-SO-001**: MLT1, client MLTest, D2C Order, 1 x MLT-WIDGET-01, status Open, edit GUID `11c4f8da-2b25-4c61-a2eb-ece5d91578bc`.
- Shipment plan **KS-TEST-SP-001**: MLT1, client MLTest, Open, contains KS-TEST-SO-001.

The UI stack is Angular with Kendo UI grid and dropdowns. Side drawers use ng-zorro `ant-drawer`.

---

## 0. Shared platform patterns (apply to every grid below)

**Global header nav:** Fulfillment, Inventory, Automation, Integrations, Reports, Analytics, Settings. The right side holds Search, a video/help icon, refresh/sync, a printer (direct-print), help, and the user menu (Change Password, My Profile, Company Settings, Apps, Log Out).

The mega-menu items found in the DOM give the full nav map:
- **Fulfillment:** Shipment Orders, Shipped Orders, Carrier Shipment Details, End Of The Day, Packing Station, Job Management, Order Operations Task Details, Count Task Details, Replenishment Task Details, Shipment History, Shipment Plan.
- **Inbound:** Purchase Orders, Receiving History, Return Station, Return Orders, Work Orders.
- **Inventory:** Total Inventory, Inventory by Location, Available To Promise (ATP), Count Plan, Count Location Details, Count SKU Details.
- **Automation:** Algorithms, Workflows, Rate Shopping, Wave Rules.
- **Integrations:** Channel Integrations, Carrier Integrations, Channel Methods, Channel History, Orders and Shipments, Products and Inventory, Channel Health Overview, Channel Setup Details, Missing Shipment Orders, Recent Errors, Workflow Blocked Shipment Orders, Product Listing Exceptions, Carrier Errors.
- **Reports:** Channel Sales Report, Shortage Report, Kit Inventory Report, Serial Number Report, Order Inventory, Dynamic Replenishment Report, Inventory Snapshot Report, Change Log, Transaction History, Integration Log, Missing Log, Serial Number Transaction History, Allocation Exceptions, Wave Log Report, Excel Export History, PO Receiving Report, User Performance Report.
- **Analytics:** Average Task Analysis, Associate Task Analysis, Performance Quadrant Analysis, Associate Analysis, Receiving Performance Analysis, Inbound & Inventory Dashboard, Fulfillment Dashboard, Management Dashboard, Productivity Dashboard.
- **Settings:** Products, Product Listings, Locations, Vendors, Customers, Retailers (BETA), Warehouse, Mobile Carts, LP Types, LP Numbers, Shipment Packages, Printouts & Labels, Data Setup, Job Types, Screen Configuration, Clients, 3PL Billing, Billing Report, VAS Operations, Users, Roles.

**Page header:** breadcrumb (`Home > Orders > Shipment Order`), H1 title, optional helper text, and primary/secondary header buttons on the right.

**Grid toolbar (left to right):**
1. **Search-mode button** (list icon with caret). It opens a "Search Content" popover with radios **Equal** (default) and **Starts With**, plus an **Apply** button.
2. **Search box** (placeholder "Search by code") with a magnifier button.
3. **Filter** toggle. It opens the "Select Filter Type" panel:
   - Tabs **New** and **Saved**.
   - A "Search Filter" box.
   - An alphabetical list of filterable fields. Each row has a bookmark icon (favorite) and **+** (add).
   - Adding a field shows its value editor and an **Add Filter** button:
     - enum fields: checkbox list (with an "Empty" option where relevant);
     - dates: presets plus "Custom" with From/To;
     - text and number fields: an input.
   - The **Saved** tab lists saved filters and is empty here.
   - There is a "Filter Name" input used for saving.
4. **Active filter chips.** Each shows field name and value (e.g. "Warehouse / in MLT1 - Test..."), truncated, with an x to remove it. When filters are hidden, the button shows "+1".
5. **Save filter** icon. Its dropdown has one item, **Create New**.
6. **Funnel icon** (quick filter / clear; behavior unknown).
7. Bulk-action dropdowns (page-specific). They are disabled until at least one row is selected.
8. **Tag** icon button.
9. **Refresh** icon button.

**Filters live in the URL.** Example: `?wn=%5B"<warehouseGuid>"%5D&wnqt=in&wnlbl=MLT1%20-%20Test%20Warehouse&ps=100`. Each filter has a key, an operator suffix `qt` (`in`, ...), a label suffix `lbl`, and `ps` holds the page size.

**Grid:**
- The first column is a select checkbox. The header checkbox has a tri-state "minus" for select-all.
- Column headers are UPPERCASE and sortable.
- A gear icon at the top right opens the **column chooser**: a checkbox list of every column plus **Apply**.
- The last column is a row "..." (three dots) action menu. Most grids are wider than the viewport and scroll horizontally.

**Footer:**
- Density toggle **Large / Small**. Small is the default.
- Page-size dropdown "Show 100 items" (default 100).
- Pager: |< < [page] / N > >|.
- **Export As Excel** button (green outline).
- "Total: N", and "Selected: N" once rows are selected.
- On report-style grids the toolbar adds **Clear Completed**, **Excel Export History** (navigates to `en/wms/report/excel-export-history`) and **Export as Excel**.

**Empty state:** search icon, "Could not find any shipment order / Try changing the filters or search term", plus two CTA cards:
- "No products? Create products before creating a shipment order."
- "OR You can create shipment orders here."

**Status pill style:** rounded 12px, padding .4rem 1rem, bold 12px label. Colors are below.

**Shipment order status pill colors** (CSS class `so-table-status-container table-status-{id}`, background / text):

| id | Observed / inferred status | Background | Text |
|---|---|---|---|
| 2 | Shortage | #F7E9E4 | #A13406 (burnt orange) |
| 4 | (gray, likely On Hold) | #D7D9DD | #394357 |
| 6 | Open | #D3F0E3 | #17874D (green) |
| 8 | Ready to Pick | #D5E5F2 | #0D36A3 (blue) |
| 9, 10, 12, 13, 14, 15 | in-process statuses (Picking Started, Ready to Pack, Packing Started, Ready to Sort, Sorting Started, Ready To Load / Loading Started) | #D5E5F2 | #0D36A3 |
| 11, 16 | 16 = Ready to Ship (11 likely Ready to Load) | #DFCEF5 | #621DB8 (purple) |
| 18, 20 | Shipped / Partially Shipped. A partial order shows an extra small "P" pill. | #D3F0E3 | #17874D |
| 30 | Cancelled | #FBDBDE | #B20B1C (red) |

**Shipment order statuses** (full filter list): Cancelled, Loading Started, On Hold, Open, Packing Started, Partially Shipped, Picking Started, Ready To Load, Ready to Pack, Ready to Pick, Ready to Ship, Ready to Sort, Shipped, Shortage, Sorting Started.

**Lifecycle observed in the change log:**
1. A new manual order is **Open**.
2. Creating a picking job sets the line AllocatedUOMQuantity (0 -> qty), status Open -> **Ready to Pick**, and sets WarehouseJobCode (e.g. `Job6044624`) and WarehouseJobTypeCode (`MLT1 D2C Picking`).
3. Address verification runs on save. It normalizes the state name (Arkansas -> AR) and merges address line 2 into line 1 ("2908 SE I St" + "Ste 2" -> "2908 SE I St Ste 2"). It writes AddressVerificationNotes such as "Some parts of the address (such as the street and ZIP code) are valid." and "The address is deliverable".

**Pick Short Status / Pack Short Status values:** None, Open, Resolved.

**Toasts** appear at the bottom right, e.g. "Success / 1 product with SKU MLT-WIDGET-01 added successfully".

---

## 1. Shipment Order: Order Backlog tab

- **URL:** `en/wms/shipment-order/list`. Page title "Shipment Order - Logiwa". Breadcrumb Home > Orders > Shipment Order.
- **Tabs** (route links): **ORDER BACKLOG** (`/list`), **SHIPPED & CANCELED ORDERS** (`/shipped/list`), **RETURN ORDERS** (`/return/list`).
- **Header buttons:**
  - **Import** dropdown:
    - **Bulk Import Shipment Orders** -> `en/wms/import/shipmentorder/4`
    - **Bulk Update Shipment Orders** -> `en/wms/import/shipmentorder/7`
    - **Import Serial Numbers** -> `en/wms/import/shipmentorder-serialnumber/17`
  - **Create Shipment Order** (primary) -> `en/wms/shipment-order/form/add`
- **Default filter:** none. Total across all warehouses was 3,264. With Warehouse = MLT1 the total is 3.

### Columns (all 58 are visible by default; all are in the column chooser)
Order Code (link), Store Order Number, Company Name, Channel Payment Status, Store (channel logo plus store name, e.g. "Created Manually" with an icon, or the ShipStation logo plus "Bulletpoint Mo..."), Age (days), Order Processing Age, Total Weight ("1.5 Pound", "0 Ounce"), Client, Warehouse, Status (pill), Pick Short Status, Pack Short Status, Tags (colored tag chips), Total Quantity, SKU (slash-joined list of SKUs), Job Code, Customer ("Name / State"), Requested Shipping Option, Carrier, Shipping Service, Is Auto Ship (Yes/No), Tracking Numbers, Rate, Sales Price ("66.03 USD"), Pick List Printed (Yes/No), Order Date, Expected Shipment Date, Carrier Expected Delivery Date, Country, Order Type, Note, Created Date, Actual Delivery Date, Actual Pickup Date, Actual Shipment Date, Charged Account Number, Tax & Duties Account Number, Prime Order (Yes/No), Priority (int), Scheduled Pickup Date, Expected Delivery Date, Extra Note 1, Extra Note 2 (can hold channel line-item properties rendered with `<br/>`), Fraud, Order Code Grouping Reference, Gift Note, Back Order (Yes/No), Scheduled Shipment Date, State(Region), Retailer, BOL, PRO, PO, DEPT, Mark For, Customer Account Number, Is UCC Label Generated (Yes/No), row actions.

Date format: `11/5/2026 3:44:40 PM`.

**Sample MLT1 rows**
- `KS-TEST-SO-001` | Created Manually | Age 0 | 1.5 Pound | MLTest | MLT1 - Test Warehouse | **Open** | None/None | Qty 1 | MLT-WIDGET-01 | KS-TEST Customer / Arkansas | Is Auto Ship No | 0.00 USD | D2C Order | Priority 0
- `MLT-B2B-001` | Company "MLT Test Retailer" | Age 16 | 3 Pound | **Ready to Pick** | Qty 2 | Job6073219 | MLT Retail Test / Arkansas | **B2B Order** | Note "MLTest B2B label free ship test"
- `SO0000` | Age 20 | **Ready to Pick** | Job6044624 | MLT Customer / AR | D2C Order | Note "MLTest order, do not ship"

### Filterable fields (67)
Actual Shipment Date, Address Verification Status, Age, BOL, Cancel Date, Canceled By Merge, Carrier, Carrier Expected Delivery Date, Carrier Setup Name, Channel, Client, Code, Country, Create Date, Custom Field Date 1-3, Custom Field Drop Down 1-2, Custom Field Text Box 1-3, Custom Field Toggle 1-2, Customer Account Number, Customer Name, Department, Expected Shipment Date, Has Allocated Inventory, Has Label, Has Pick Short Label Printed, Is Auto Ship, Is Back Order, Job Code, Kit SKU, Mark For, Merged Order, Merged Shipment Order Code, Order Code Grouping Reference, Order Date, Order Type, Pack Short Status, Partial, Pick List Printed, Pick Short Status, PO, Priority, PRO, Processing Age, Rate, Requested Shipping Option, Retailer, Sales Price, Shipping Service, Single Item Order, SKU, State (Region), Status, Store, Store Order Number, Tag, Total Quantity, Tracking Number, UCC Label Generated, Warehouse.

**Value examples**
- **Channel:** Empty, Amazon, AmazonFBA, BigCommerce, CartRover, Custom, eBay, Etsy, Loop Returns, Magento, QuickBooks Online, ShipStation, Shopify, Squarespace, Tiktok, Walmart, WooCommerce.
- **Warehouse:** MLT1 - Test Warehouse, plus one other.
- **Client:** a checkbox list of about 31 clients.
- **Store:** Empty plus store names.
- **Order Date:** Custom / From / To.
- **Priority:** numeric input.

### Bulk actions (disabled until a row is selected)
Enabled state was checked with an Open order and a Ready to Pick order.

**Label** dropdown:
- **Create Label:** POSTs to `myintegrationcommand.logiwa.com/api/carrierbatch` (creates a carrier label batch), shows a loading overlay, then opens a new browser tab (the label batch / print view).
- **Reprint Label:** with no label, the "Warning" modal says "The orders which you have selected has no label to reprint." [OK].
- **Void Label:** with no tracking, the "Warning" modal says "You can't void the labels for orders without a tracking number." [OK].
- **Create Return Label:** no modal appeared (likely opens a new tab or a carrier call).
- **Create Retailer Label:** disabled unless the order has a retailer.
- **Reprint Retailer Label:** disabled unless the order has a retailer.

**Warehouse Ops** dropdown:
- **Ship Order:** confirm modal "Are you sure you want to ship orders? / N orders will be shipped. Orders will move to "Shipments" screen." It shows an Order Code table and [No] [Yes].
- **Create Backorder:** "Create Backorder" modal (blue hero header with an illustration) saying "1 of 1 order is eligible for creating picking job and backorder", then [Merge Into Existing Job] (orange) and [Create New Job] (blue). The flow continues the same as Picking/Job Operations.
- **Picking/Job Operations:** the **Create Job wizard**:
  - Step A: "Create Job / X of Y order is eligible for creating picking job", with [Merge Into Existing Job] and [Create New Job].
  - **Create New Job** form:
    - Select Job Type* (dropdown, e.g. "MLT1 D2C Picking", clearable)
    - Batch Size* (numeric spinner, default 1)
    - Assign to (user search)
    - A preview card "Below Jobs will be created", with a row such as "No User is assigned to / MLT1 D2C Picking with 1 order / 1 order"
    - Footer "0 Person Assigned | Total Job"
    - Buttons [Back] [Create Job]
  - **Merge Into Existing Job**: "Select Job From List / Orders will be added to the selected Job List". Its grid has columns JOB CODE, JOB TYPE, QUANTITY, PROGRESS ("0 Picked"), ASSIGNEE, with a pager, "Total: 2", and buttons [Back] [Select Job]. Example rows: Job6073219 / MLT1 D2C Picking / 2 / 0 Picked.
- **Cancel Picking:** modal "The Cancel Picking operation is only available for the orders that have active picking/packing tasks." [OK] (eligibility guard).
- **Change Warehouse:** modal "You are about to change 1 order's warehouse. It may cause shortage for orders. This operation does not cause any changes to the orders that have picking jobs." It has Warehouse* (dropdown) and [Cancel] [Change Warehouse].
- **Cancel Order:** red-header modal "Are you sure you want to cancel selected order(s)?" with "Please select **cancel reason** for the selected order(s)", a Cancel Reason dropdown (empty, "NO DATA FOUND", for this tenant; values come from Data Setup), a table of Order Code / Order Status / Order date, and [Go Back] [Cancel Order(S)].
- **Resolve Pick Short:** disabled unless Pick Short Status = Open.
- **Resolve Pack Short:** disabled unless Pack Short Status = Open.
- **Unmerge Order:** disabled unless the order was merged.

**Print** (printer icon) dropdown:
- **Print Picking List:** guard modal "The picking list cannot be printed for the orders that have no active picking task." [OK].
- **Batch Picking List:** same guard.
- **Print Packing Slip:** no modal; opens a document or new tab.
- **Print Manifest / BOL:** no modal; opens a document.
- **Pick/Pack Short Label:** "Information / Ineligible Order(s) Selected / Issue label cannot be printed for the selected order(s). To print an issue label, the order must have an active Pick or Pack Short issue and be in Open or Resolved status." [OK].

**Delete** (trash icon) dropdown:
- **Delete Shipment Order:** "Are you sure you want to delete your order?" with an Order code / Order date / Status table and [No] [Yes].
- **Remove Serial Number:** "Are You Sure? All serial numbers in this Shipment Order will be removed." [Cancel] [Remove].

**Tag** button: popover "Tags" with:
- a pencil (manage tags) icon;
- "Search Tags";
- "1-10 of 21 Items / Selected: 0";
- a checkbox list of colored tag chips (e.g. 123 red, 1234 pink, 2345 green, Climbing green, DO-NOT-SHIP red, Logiwa, MergeTag, ...), paginated "1 / 3";
- an [Apply] button.

The empty state reads "Create new tags to differentiate your lines from others." with a **Create Tag** button.

### Row "..." menu and row click
- The menu has **Show Details**, **Edit** and **Delete**. Show Details and Edit both open `en/wms/shipment-order/form/edit/{guid}`.
- Clicking the order code cell did not navigate in testing; use the row menu.

---

## 2. Create Shipment Order wizard

- **URL:** `en/wms/shipment-order/form/add`. Title "Create Shipment Order". Breadcrumb Home > Orders > Create Shipment Order.
- **Layout:**
  - back arrow plus H1;
  - top-right **Cancel Order** button;
  - a horizontal stepper with 6 steps, each with an icon, "Step N" and a label. Step states: active (bold), complete (green check), warning (yellow "!" icon, seen on Step 2 when the address is unverified);
  - a right rail with:
    - **Order Status** card: "Follow all the steps to complete the order", "%0" through "%100" (20% per step), and a circular progress ring with a truck icon;
    - **Summary** card: Price, Discount $0.00, Total $0.00;
    - a **Save Order** button (disabled until valid; enabled on step 6).
- Each step has a "Step N / Title" heading and helper text on the right. Navigation is [Back] and [Next Step].

### Step 1: Order Details
Helper text: "Enter the order details along with mandatory fields to proceed to Customer tab."

| Field | Type | Req | Default / Options |
|---|---|---|---|
| Warehouse | dropdown | * | MLT1 - Test Warehouse, Team 1 Supplier Service. Read-only in edit mode. |
| Client | dropdown | * | about 31 clients (MLTest, testclient, ...). Read-only in edit mode. |
| Order Code | text, max 50 with counter "6 / 50" | * | Auto-filled with the next sequence (e.g. `SO0008`), with an "auto generated" link to regenerate. |
| Order Type | dropdown with an info tooltip "Select 'Order Type' or create a new one from the data setup under the settings" | * | D2C Order, B2B Order, BackOrder D2C, Partial Allocation D2C (tenant data setup) |
| Order Date | datetime `YYYY/MM/DD HH:mm` with a calendar icon | * | now |
| Expected Shipment Date | datetime | * | now |
| Expected Delivery Date | datetime | | |
| Carrier Expected Delivery Date | datetime | | disabled (carrier-populated) |
| Scheduled Pickup Date | datetime | | |
| Scheduled Shipment Date | datetime | | |
| Note | text, max 500 with counter | | |
| Priority | numeric spinner | | 0 |

### Step 2: Customer & Address ("Customer Information")
Helper text: "Enter the customer's information and the corresponding shipment address."

- **Customer:** dropdown whose default is "New". Searching existing customers needs at least 3 characters ("You have to enter at least 3 characters to search."). Choosing an existing customer would pre-fill the fields below.
- First name, Last name, Customer e-mail (placeholder example@email.com), Phone Number.
- **Shipment Address section:**
  - Address Title (dropdown "Select address type"; disabled until a customer is chosen; saved addresses);
  - **Skip Address Verification**: Yes/No segmented toggle, default **No** (red when No), with an info tooltip;
  - **Address Type**: Residential / Commercial / Military, with an info tooltip;
  - Address line 1 (max 256), Address line 2 (max 256), Postal Code (max 10), City;
  - State: dropdown that appears after Country; 62 options for the US, including territories;
  - **Country\*** (247 countries);
  - Company Name;
  - **Tax Type**: OTHER, VAT, TIN, IOSS, CNPJ/CPF, EORI, GST;
  - Tax ID.
- **Billing radio:** "Use Shipment Address As Billing Address" (default) or "Enter a New Address For The Billing". The second option reveals Address Title, Billing First Name, Billing Last Name, Billing e-mail, Billing Phone Number, Billing Address Line 1, Billing Address Line 2, Postal Code, City, Country, Billing Company Name.

### Step 3: Products
- **Product search combobox:** "Enter SKU and Add Product (At least 3 char.)". After 3 characters, results are scoped to the selected client (API `mywmsquery.logiwa.com/api/product/search/client/{clientId}/i/0/s/20`). Each result row shows an image thumbnail, SKU, name, a quantity spinner (default 1) and a **+** button. Example results: MLT-KIT-2PK (MLTest 2 Pack Kit), MLT-WIDGET-01, MLT-KITTEST-COMPA, MLT-KITTEST-COMPB, MLT-KITTEST-KIT1. Clicking + adds the line and shows a toast.
- **Create New Product** button. It opens a right drawer, "Product Category / Please select the type of product category to proceed.", with three cards:
  - **Product:** "Select this category to create standard products."
  - **Kit:** "...kit-to-order or kit-to-stock products."
  - **Packaging Material:** "...match with your shipment packages for inventory tracking."
- KPI chips: **Number of SKU**, **Number of Kits**, **Total Qty**, plus a density/columns icon. "Find SO Detail by SKU" search filters the lines. In edit mode an **Export** button appears.
- **Lines grid columns:** IMAGE, SKU, NAME, PACK TYPE, UOM PACK TYPE, UOM RATIO, QUANTITY, PRICE PER ITEM, TOTAL PRICE, ORIGINAL SO CODE, STORE UPDATE NOTES, IS STORE UPDATED, KIT SKU NAME, EXPIRY DATE, LOT BATCH NUMBER, DAMAGE REASON, INVENTORY LOCATION, INVENTORY LP, ALLOCATED UOM QTY, CANCELLED UOM QTY, SORTED UOM QTY, PICKED UOM QUANTITY, PACKED UOM QTY, SHIPPED UOM QTY, LOADED UOM QTY, PRODUCTION DATE, LINE NOTES 1, LINE NOTES 2, LINE NOTES 3, plus "...".
- Empty state: "No product has been created yet." with a [Create Product] button.
- **Line "..." menu:** Show Details, Edit, Delete.
- **Edit Product drawer:**
  - read-only: SKU, Name;
  - **UOM Pack Type\***: Each / Case;
  - UOM Ratio (read-only), Price Per Item, Total Price (read-only), Quantity (spinner);
  - **Available Pack Quantity** (read-only, live ATP, e.g. 54);
  - Line Notes 1-3;
  - **Order Details** (read-only spinners): Allocated / Cancelled / Sorted / Picked / Packed / Shipped UOM Quantity;
  - **Inventory Details** (lot/location pinning):
    - Expiry Date, Production Date, Lot Batch Number;
    - Damage Reason: Damaged, Broken, OnHold, Bad Packaging, Leaking, Extra, Quarantined;
    - Inventory Location: search, 3+ characters;
    - Inventory LP: search, 3+ characters;
  - **Add/Edit Custom Field** link;
  - [Cancel] [Apply].

### Step 4: Shipping
Helper text: "Select the Carrier and Shipment Service if available."

- **Carrier:** dropdown of carriers configured for the warehouse. MLT1 has none ("NO DATA FOUND").
- **Shipping Service:** depends on Carrier.
- **Shipping Charges Billing Type** and **Tax & Duties Billing Type:** Sender, Recipient, Third Party, Collect, Prepaid.
- **Shipping Charges Account Number:** "Use Custom Account" toggle, otherwise a select.
- **Tax & Duties Account Number:** "Use Custom Account" toggle, otherwise a select.
- **Packing Instructions:** text, max 1000.
- **Shipment Package:** dropdown of Settings > Shipment Packages.
- **Total Shipping Cost:** number.
- **Current Tracking Number:** text.
- **Carrier Reason For Export:** Sale, Gift, Personal Effects, Documents, Sample, Return, Repair, InterCompany, Other.
- **Tracking Numbers:** "Enter and add tracking number" input with an [Add] button; a multi-value list.
- **Return** section (BETA badge):
  - Return Address Name (dropdown);
  - Return Carrier;
  - Return Shipping Option;
  - Return Shipping Cost;
  - Return Tracking Numbers (input plus [Add]).

### Step 5: Other Info
Helper text: "You can create your Shipment order manually after providing the necessary information."

- Extra Note through Extra Note 5 (max 500 each).
- Client Reference Code.
- Fraud (max 500).
- Packing Warning Type (dropdown; empty for this tenant).
- **Gift:** Yes/No toggle, default No. Yes reveals **Gift Note** (max 500).
- Order Code Grouping Reference (read-only).
- **Retailer section:** Retailer (dropdown), BOL, PRO, PO, Dept, Mark For, Retailer Customer Account Number. Each has an info tooltip.
- **Add/Edit Custom Field** opens the "Create Custom Field" drawer:
  - Custom Field Type\*: Text Box, Drop Down, Date Picker, Toggle;
  - Custom Field Name\*;
  - Is Active: Yes/No, default Yes;
  - "+ Add More Custom Field";
  - [Cancel] [Add To Form].

### Step 6: Confirm
Helper text: "Do your final check and complete the order."

- PRODUCTS list: thumbnail, SKU, name, "1 Each", "0.00 USD".
- **Customer** card: name, Shipment Address, Billing Address.
- **Order Details** card: code, Order Type, Client, Order Date, Expected Shipment Date, and the warehouse name with a warehouse illustration.
- **Shipment** card.
- **Save Order** turns enabled at 100%.

**On save:**
- A full-page success screen: "You have successfully created a new shipment order: KS-TEST-SO-001 / What can you do next?"
- Two cards: **Go Back To Shipment Order List** ("Turn to Shipment Order screen to see a full list of orders.") and **Create Another Order** ("Turn to the create order form and continue your operation nonstop.").
- The new order is **Open**, Store = "Created Manually". Total weight is computed from product master data (1.5 lb).

---

## 3. Edit Shipment Order / order detail
- **URL:** `en/wms/shipment-order/form/edit/{guid}`. Title "Edit Shipment Order". It uses the same 6-step wizard with every step clickable.
- Warehouse and Client are locked in edit mode.
- **Right rail:**
  - **Save Shipment Order** (primary).
  - **Other Actions** dropdown:
    - Open order: Ship Order, Delete Order, Cancel Order.
    - Ready to Pick order: **Ship Order** enabled; Delete Order and Cancel Order **disabled** once a job is assigned.
  - **Summary** card: Order Code (large), Warehouse (with a copy/edit icon), Order Type, Store Order Number, Status pill (with an icon), Last Update Date, **Show Change Log** link, Price, Discount, Total.
  - **Assigned Jobs** card:
    - "+" opens the same Create Job modal (Merge Into Existing Job / Create New Job).
    - Empty: "No Job Assigned / Press the + button to assign a new job".
    - Assigned: a job code (Job6044624), the job type (MLT1 D2C Picking) and an **x** to unassign.
  - **Billing Charges:** [Download Billing Charges] "Click to download the latest billing charges".
  - **Printouts:** rows with availability:
    - Shipment Label (Not Available)
    - Other Documents (Not Available)
    - Packing Slip (Available)
    - Picking List (Available once a job exists, otherwise Not Available)
- **Step 3 in edit mode:** an Export button; the allocation columns are populated, e.g. Allocated UOM Qty 2, Cancelled 0, Sorted 0, Picked 0, Packed 0, Shipped 0, Loaded 0.
- **Shipment Order Change Log modal:**
  - Columns TYPE (Create/Update), MESSAGE, OPERATION DATE, SOURCE (user email).
  - Footer "Show 100 items", pager, "Total: 17".
  - Message format: "`<Field> is modified. <old> --> <new>`" or "`<SKU> -> Shipment Order Line is created.`".

---

## 4. Shipped & Canceled Orders tab
- **URL:** `en/wms/shipment-order/shipped/list`.
- **Default filter chip:** "Actual Shipment Date: Last 7 days" (removable).
- **Header button:** **Bulk Update Return Info**, with an info icon.
- **Toolbar:**
  - **Label** dropdown: Create Return Label, Void Return Label, Reprint Label.
  - **Create RMA** button: disabled until selection; this is the entry point for creating a return order from a shipped order.
  - **Print** dropdown: Reprint Label, Print Packing Slip, Print Manifest / BOL.
  - Tag, refresh.
- **Columns:** the same as the backlog, plus MERGED SO CODE, MERGED ORDER STATUS, CANCEL REASON and CANCEL DATE (62 total).
- **MLT1 data:** no shipped or canceled orders exist for MLT1 (the empty state shows), so the shipped-order detail and the Create RMA wizard could not be walked in scope.

---

## 5. Return Orders tab
- **URL:** `en/wms/shipment-order/return/list`.
- No create button here. Returns are created from the Shipped tab (**Create RMA**) or from Inbound > **Return Station**. A "Loop Returns" channel also exists.
- **Toolbar:** **Change Status** (disabled until selection), Create Tag, Export as Excel.
- **Columns:** SHIPMENT ORDER CODE, RMA CODE, STORE ORDER NUMBER, STORE, COMPANY NAME, RETURN ADDRESS, FROM COUNTRY NAME, STATUS, REQUESTED QUANTITY, RETURNED QUANTITY, SKU, CUSTOMER NAME, CARRIER NAME, CARRIER SHIPPING OPTION NAME, TRACKING NUMBER, PACK TYPE, RETURN ORDER CREATED DATE, SHIPMENT ORDER DATE, SHIPMENT ORDER DELIVERY DATE, EXPECTED RETURN DATE, ACTUAL RETURN DATE, CREATED BY, WAREHOUSE, CLIENT, TAGS.
- There is one row per RMA line (SKU). Example (non-MLT1, anonymized): RMA `RMATRAINING1`, From Country US, **Completed**, Requested 2, Returned 2, SKU2, Pack Type Unit, Created 10/22/2026, Expected Return 10/23/2026, Actual Return 10/22/2026.
- **Filters:** Actual Return Date, Actual Return Quantity, Carrier, Carrier Shipping Option Service, Client, Created By User, Customer Name, Delivery Date, Expected Return Date, From Country Code, Line Status, Requested Quantity, RMA Code, RMA Create Date, Shipment Order Code, Shipment Order Date, SKU, Status, Store, Store Order Number, Tag, Tracking Number, Warehouse.
- **Statuses:** Pending, Started, In Transit, Completed, Cancelled.
- **Return pill colors** (class `return-order-table-status-container table-status-N`):

| N | Background | Text | Status |
|---|---|---|---|
| 1 | #E3E6E8 | #50575C | gray |
| 2 | rgba(235,172,0,.16) | #EBAC00 | amber |
| 3 | #D5E5F2 | #0D36A3 | blue |
| 4 | #D3F0E3 | #00874D | green, Completed |
| 9 | #FBDBDE | #B20B1C | red, Cancelled |

---

## 6. Carrier Shipment Details (Shipments)
- **URL:** `en/wms/shipment`, which redirects to `en/wms/shipment/list`. Title "Shipments - Logiwa". Breadcrumb Home > Orders > Carrier Shipment Details.
- **Tabs:** CARRIER SHIPMENT DETAILS (`/shipment/list`), END OF THE DAY (`/shipment/end-of-day`).
- **Default filter:** "Label Create Date: Last 30 days".
- **Toolbar:** Save filter (Create New), Export as Excel, Clear Completed, Excel Export History. There is one row per label/package.
- **Columns (41):** WAREHOUSE, INVENTORY LOCATION (e.g. "Packing"), CLIENT, ORDER CODE, ORDER STATUS (pill, plus a "P" partial pill), CUSTOMER, PRODUCTS, CUSTOMER ADDRESS ("812 ... Rd,,City,AL,36571,US"), LABEL CREATE DATE, CARRIER EXPECTED DELIVERY DATE, CARRIER ("UPS - <account prefix>"), SHIPMENT METHOD (Ground), RATE SHOPPING (true/false), RATE SHOPPING NAME, RATE (91.66), LABEL TYPE (pill "Shipping Label"), MASTER TRACKING NUMBER, TRACKING NUMBER, ACTUAL SHIPMENT DATE, DELIVERY DATE, VOID DATE/TIME, INSURANCE TYPE, INSURANCE VALUE, CONFIRMATION TYPE, WEIGHT, HEIGHT, WIDTH, LENGTH, DIMENSION UNIT (Inch), SHIPMENT PACKAGE TYPE ("SHB 6X8X10"), WEIGHT UNIT (Ounce), SHIPPING COST (76.39), ZONE, OTHER COST, CURRENCY (USD), IS ALLOW SATURDAY DELIVERY, LABEL STATUS (Active / Voided), SCHEDULED PICKUP DATE, ACTUAL PICKUP DATE, INVENTORY PARENT LPN, EXTERNAL REFERENCE.
- **Multi-package orders:** a master tracking number plus a child tracking number per package.
- **Filters:** Actual Shipment Date, Carrier, Carrier Expected Delivery Date, Client, Currency, Delivery Date, Delivery Mail Sent, Inventory Parent LPN, Label Create Date, Location, Master Tracking Number, Order Code, Order Status, Other Cost, Package, Rate, Return Label, Shipment Mail Sent, Shipment Method, Shipping Cost, Sync To Store, Tracking Number, Voided, Warehouse.
- **Label-type pill:** `carrier-shipment-details-table-status-container`. Value 1 = blue (#D5E5F2 / #0D36A3), Shipping Label. Value 2 = purple (#DFCEF5 / #621DB8), likely Return Label.
- **MLT1 has no carrier configured** and therefore no shipment rows. The data model above comes from other-warehouse rows.

## 7. End Of The Day
- **URL:** `en/wms/shipment/end-of-day`. Title "End Of The Day Report - Logiwa".
- **Helper text:** "End of the Day Report helps you monitor total packages of the shipments based on your clients and the carriers for especially reconciliation."
- **Toolbar** (disabled until selection): **Print Custom Report**, **Print End of the Day Report**, **Reprint**. Also Export as Excel.
- **Columns:** PREFIX (carrier account prefix), CARRIER (UPS), SHIP FROM (warehouse), SHIP DATE, CLOSE DATE, REPORT PRINTED? (Yes/No), TOTAL PACKAGE. There is one row per carrier account per ship date per warehouse; 4 rows total, none for MLT1.
- **Filters:** Carrier, Carrier Prefix, Close Date, Printed?, Ship Date, Total Package, Warehouse.
- **Status pill** (`end-of-day-table-status-container`): 1 = teal (#D0F3EE / #16C2AA), Open. 2 = green (#D3F0E3 / #00874D), Closed.
- **Logic:** printing the EOD report closes the manifest (sets the close date) for that carrier/day. This is inferred.

## 8. Shipment History
- **URL:** `en/wms/shipment-order/shipment-history/list`. Breadcrumb Home > Orders > Shipment History.
- **Helper text:** "Shipment history is a report which lists all past ship order actions and remove inventory actions."
- **Toolbar:** Export as Excel, Excel Export History, Clear Completed. No bulk actions.
- **Columns (32):** ORDER CODE, ORIGINAL ORDER CODE, STORE ORDER NUMBER, SKU, PRODUCT NAME, BARCODE, PO NUMBER, LOT/BATCH NUMBER, TRACKING NUMBER, EXPIRY DATE, QUANTITY, PACK TYPE, UOM PACK TYPE, SHIPMENT PACKAGE, KIT SKU NAME, RETAILER, PACKAGE WEIGHT ("50 Ounce"), MASTER SHIPMENT ORDER CODE, IS BACK ORDER, SHIPMENT DATE, SHIPMENT TYPE ("Shipment Order"; remove-inventory events also appear here), NOTE, CLIENT, WAREHOUSE, LOCATION ("Packing"), LPN, ORIGINAL LP NUMBER, ORIGINAL PARENT LP, PARENT LP, PARENT LP TYPE, RECEIVING DATE, PRODUCTION DATE.
- There is one row per shipped SKU, lot and LPN.
- **Filters:** Client, Expiry Date, Location, Lot Batch Number, LP Number, Order Code, Original Shipment Order Code, Pack Type, Parent LP Number, Parent LP Type, Product Name, Product SKU, Purchase Order Number, Quantity, Shipment Date, Shipment Type, Store Order Number, Tracking Number, Warehouse.

## 9. Shipment Plan (truck / load planning)
- **URL:** `en/wms/shipment-plan`, which redirects to `/shipment-plan/list`. Title "Shipment Plan List - Logiwa". Breadcrumb Home > Fulfillment > Shipment > Shipment Plan.
- **Tabs:** SHIPMENT PLAN (`/list`), SHIPMENT PLAN ORDERS (`/order`), SHIPMENT PLAN LPS (`/lp`).
- **Header:** **Create Shipment Plan**.
- **Bulk toolbar** (disabled until selection): **Delete**, **Ship**, **Print** (dropdown: Print Manifest / BOL), **Picking/Job Operations**.
- **Plan columns:** PLAN CODE, STATUS (pill plus a clickable status icon), WAREHOUSE, CUSTOMER, CUSTOMER ADDRESS, CREATED DATE, PLANNED SHIPMENT DATE, ACTUAL SHIPMENT DATE, CARRIER, TRUCK PLATE NUMBER, LOADING GATE, RETAILER, LOADING START DATE, LOADING COMPLETE DATE, TRUCK DEPART DATE, plus "...".
- **Row "..." menu:** Edit, Change Log, Delete.
- **Filters:** Code, Plan Status, Warehouse.
- **Plan statuses and pill colors** (class `shipment-plan-table-status-container table-status-N`):

| N | Status | Background | Text | Inferred |
|---|---|---|---|---|
| 2 | Open | #D0F3EE | #16C2AA (teal) | |
| 4 | In Progress | blue | | yes |
| 6 | Loading Started | blue | | yes |
| 8 | Loading Completed | green | | yes |
| 10 | Shipped | green | | yes |
| 20 | Cancelled | red | | yes |

- **Create Shipment Plan drawer** (3-step tabs **1.General**, **2.Others**, **3.Orders**; footer [Cancel]/[Back] [Next], and [Save] on the last step):
  1. **General:**
     - Shipment Plan Code\* (text)
     - Warehouse\*: MLT1 / other
     - Client: client list
     - Carrier: warehouse carriers; empty for MLT1
     - Truck Plate Number
     - Loading Gate: location search, 3+ characters
     - Status\*: Open (default), In Progress, Loading Started, Loading Completed, Shipped, Cancelled
     - Planned Shipment Date, Actual Shipment Date, Loading Started Date, Loading Completed Date, Truck Departed Date (datetimes)
     - Expected Total Volume ("0.00 m³"), Expected Total Weight ("0.00 kg")
     - Prevent LPN Edit During Loading: Yes/No
     - Note (textarea)
  2. **Others:**
     - Customer: search, 3+ characters
     - Customer Address: dependent dropdown
     - Custom Fields ("You can optionally add or edit custom fields"), with an Add/Edit Custom Field link
  3. **Orders:**
     - "Orders" grid (ORDER CODE, STATUS pill, TOTAL QTY) with [Remove] [Add] buttons; empty text "No order added yet." and an [Add Order] button.
     - **Add Order(s) drawer:** pre-filtered to the chosen warehouse. Grid columns: ORDER CODE, ORDER TYPE, STORE, WAREHOUSE, CREATED DATE, AGE, SKU, CLIENT, TAGS, CUSTOMER, TOTAL QUANTITY. Checkbox selection, then [Add Selected Order].
- **Save:** returns to the list. The new row shows Status Open with the created date.
- **Edit Shipment Plan:** the same drawer titled "Edit Shipment Plan", with non-numbered tabs General / Others / Orders.
- **Shipment Plan Orders tab:**
  - Columns: SHIPMENT PLAN CODE, ORDER CODE, ORDER STATUS, STATUS, WAREHOUSE, CUSTOMER, CUSTOMER ADDRESS, CARRIER, SHIPPING OPTION OF THE LPN, CLIENT, TRUCK PLATE NUMBER, CARRIER OF THE SHIPMENT ORDER, LOADING GATE, PLANNED SHIPMENT DATE, TRUCK DEPARTED DATE.
  - Filters: Carrier, Client, Loading Gate, Order Code, Planned Shipment Date, Shipment Plan, Shipping Service, Truck Departed Date, Truck Plate Number, Warehouse.
  - Sample row: KS-TEST-SP-001 / KS-TEST-SO-001 / Open / Open / MLT1 / MLTest.
- **Shipment Plan LPs tab:**
  - Columns: SHIPMENT PLAN CODE, ORDER CODE, ORDER STATUS, LP, PARENT LPN, SHIPMENT PLAN STATUS, WAREHOUSE, CUSTOMER, CUSTOMER ADDRESS, CARRIER, SHIPPING OPTION OF THE SO, CLIENT, TRUCK PLATE NUMBER, CARRIER OF THE LPN, ORIGINAL LP NUMBER, LOADING GATE, PLANNED SHIPMENT DATE, TRUCK DEPARTED DATE, LP ACTUAL WEIGHT, LP ACTUAL VOLUME.
  - Filters: Carrier, Client, Loading Gate, LP Number, Planned Shipment Date, Shipment Plan, Shipping Service, Truck Departed Date, Truck Plate Number, Volume, Warehouse, Weight.

## 10. Import pages (shared template)
- **Routes:**
  - `en/wms/import/shipmentorder/4`: "Bulk Import Shipment Orders"
  - `en/wms/import/shipmentorder/7`: "Bulk Update Shipment Orders"
  - `en/wms/import/shipmentorder-serialnumber/17`: "Import Serial Numbers"
- **Layout:**
  - Title on the left; helper text at top center: "You can bulk import shipment orders by using an Excel file. Excel file import history will be listed below. You can reach old import files there."
  - "< Go back to shipment orders" link.
  - Green Excel card "Download our excel template": "To import your shipment orders, download our template. If you want to use your own Excel file to import read the Import Shipment Order Manual (link). Excel file import history will be listed below." There is a [Download] button.
  - Large drag-and-drop zone: "Drag and drop or browse" / "Drop files here to upload".
  - Refresh icon.
  - History grid with columns STATUS, MASTER ROW COUNT, SUCCESS COUNT, ERROR COUNT, UPLOADED BY, CREATED DATE TIME, ACTIONS (likely downloading the error file). Empty text: "No records to display".

---

## Not accessible / unknown
- **No MLT1 shipped, canceled or returned orders, and no carrier labels or EOD rows.** As a result these could not be walked in MLT1 scope: the shipped-order detail, the **Create RMA** (create return order) wizard, the Change Status modal on returns, Bulk Update Return Info, and the void/reprint flows on real labels.
- **Not done on purpose:** shipping or cancelling the KS-TEST order. Shipping would deduct test inventory.
- **MLT1 has no carrier integration,** so the Carrier, Shipping Service, Shipment Package and Return dropdowns showed "NO DATA FOUND".
- **The Cancel Reason list is empty** for this tenant; its values come from Settings > Data Setup.
- **New-tab outputs were blocked** in the automation browser: Create Label (after the `carrierbatch` POST), Print Packing Slip, Print Manifest/BOL and Create Return Label. Their output pages are not captured.
- **Not inspected:**
  - the funnel icon next to Save filter (quick filter);
  - the clickable shipment-plan status icon (likely a status-change popover);
  - the warehouse/status pencil icons in the order-detail Summary;
  - the exact meaning of status ids 4, 9-15 and 11 (inferred from color only).
