# Logiwa iO — Master Data Cluster Spec (Products, Listings, Locations, Organization, Warehouse, Mobile Carts, Shipment Packages)

Captured 2026-11-05 from the my.logiwa.com sandbox. Scope: warehouse **MLT1 - Test Warehouse** (id `4a7c3492-8275-47ed-ae54-ac916a6e3b44`). Team 1 Supplier Service data was only read where it showed up in shared lists; nothing in it was selected or changed.

Test records created during capture (all prefixed KS-TEST):
- Product `KS-TEST-PROD-001` (client MLTest, Unit UOM 10x8x6 in, 2 lb, barcode `KSTEST0000001`)
- Location `KS-TEST-LOC-01` (MLT1, Shelves / Storage, aisle KS, rack 01, position A)
- Retailer `KS-TEST Retailer` (USA)
- Shipment package `KS-TEST-BOX-01` (MLT1, 12x10x8 in, empty 0.5 lb, max 40 lb, MLTest access only)

---

## 0. Cross-cutting UI patterns (apply to every page below)

### Global shell
- **Top nav** (purple bar), left to right: Fulfillment, Inventory, Automation, Integrations, Reports, Analytics, Settings. On the right: Search pill, then icon buttons for video/help-tour, history/recent, printer, help, and user avatar.
- **Settings mega-menu** (the source of this cluster):
  - **Master Data:** Products (`en/wms/product`), Product Listings (`en/wms/listing-product/list`), Locations (`en/wms/location`), Vendors (`en/wms/vendor/list`), Customers (`en/wms/customer`), Retailers (`en/wms/retailer`).
  - **Configuration:** Warehouse (`en/wms/warehouse`), Mobile Carts (`en/wms/mobilecart`), LP Types (`en/wms/lp-types`), LP Numbers (`en/wms/lp-numbers/list`), Shipment Packages (`en/wms/shipmentpackage`), Printouts & Labels (`en/wms/printout`), Data Setup (`en/account/settings/datasetup/code-generation`), Job Types (`en/wms/job/types`), Screen Configuration (`en/wms/screen-configuration`).
  - **Client Setup:** Clients (`en/account/client`).
  - Also present in the menu: Billing, Users, Roles, Password, Profile, Company settings, Apps.
- Bare routes redirect to `/list`. For example, `en/wms/product` goes to `en/wms/product/list`.
- **Page header:** a breadcrumb (`Home > Settings > Location`), then an H1 title, a one-line helper text (center-grey), and primary buttons on the right. The primary button is solid blue; secondary buttons are grey outline and may open a dropdown.
- **Page-level tabs** appear as underline tabs in caps, for example `PRODUCTS | PRODUCT LISTINGS`, or `CLIENT | CUSTOMER | VENDORS | RETAILERS [BETA badge]`. Each tab is a separate route.

### Grid (Kendo grid, used on every list)
- **Toolbar:**
  - Search-mode button (list icon with a caret) opens "Search Content" with radio options **Equal / Starts With** and an **Apply** button.
  - Search input ("Search by SKU", etc.) with a magnifier button.
  - **Filter ▾** button.
  - Bulk-action buttons on the right, for example Delete and Label.
  - Refresh icon.
- Bulk buttons are **disabled until at least one row checkbox is selected**.
- **Column chooser:** a gear icon (`title="Columns"`) in the last header cell. It shows a checkbox list of every column with an **Apply** button. The visible set persists per user. Some lists default to only 3–4 visible columns.
- **Row:**
  - A checkbox on the left.
  - The primary key cell is a blue link (`.link-to-detail`). Clicking it opens the **Edit drawer**; there is no separate detail route.
  - The last cell holds a "•••" kebab that opens a popup of stacked full-width buttons: **Show Details / Edit / Change Log / Delete**. The set varies by entity (see each page).
- **Sortable columns** show a sort affordance. Headers with a leading blank cell, such as CLIENT, SKU, NAME, STATUS, SALES PRICE, PURCHASE PRICE, PRODUCT TYPE, PRODUCT GROUP, DESCRIPTION and CREATED DATE, are the sortable or filterable ones.
- **Footer:**
  - Density toggle **Large | Small** (Small is active by default).
  - Page size dropdown "Show 100 items".
  - Pager `|< < [n] / N > >|`.
  - **Export As Excel** button (green outline).
  - **Total: N** on the right.
- **Filter state lives in the URL query string.** Example: `?wn=["<warehouseId>"]&wnqt=in&wnlbl=MLT1 - Test Warehouse&ps=100`. The pattern is `<key>` for values, `<key>qt` for the operator, `<key>lbl` for the chip label, and `ps` for page size. Active filters render as chips next to the Filter button ("Warehouse / in MLT1 - Test Warehouse"). When the chips collapse, the button shows "+1".

### Filter popup (`myl-filter-popup`)
- The first screen is "Select Filter Type" with two tabs, **New | Saved** (saved filters), a "Search Filter" box, and an alphabetical list of fields.
- Clicking a field opens a sub-screen with a back arrow, the field title, an operator control, and an **Add Filter** button.
- Operator UIs by field type:
  - **Lookup / enum** (Client, Warehouse, etc.): operator dropdown `in | not in`, then a searchable checkbox list of values.
  - **Text** (Name, SKU, etc.): operator dropdown `equals | contains | starts with | ends with | exclude | empty`, then a text box.
  - **Date** (Created Date): preset dropdown `Custom | Today | Last 3 days | Last 7 days | Last 30 days | Last 90 days | Last 12 months | X Day(s) Ahead and More | X Day(s) Before and More | Within X Day(s) Past | Within X Next Day(s) | Sunday … Saturday`. It is followed by **From** and **To** date-time pickers ("Enter date/time") and an "X day" numeric input.
  - **Numeric range** (Price): **Min** and **Max** inputs.
  - **Boolean** (Fragile, Status, etc.): **Yes / No** radios.

### Forms
- Create and edit happen in a **right-side drawer** (antd drawer, about 45% width, X button top-right).
  - Multi-step drawers show **numbered step pills** across the top: "1.General 2.Packing 3.Pack Type 4.Advanced 5.Other Info". The active step is filled blue and future steps are grey.
  - Edit drawers show the same pills without numbers on some entities, for example "Information | Product Capacity | LP Capacity".
  - The footer holds full-width **Back** (grey) and **Next** (blue) buttons. The last step's button reads **Save**, **Create**, or **Finish** depending on the entity.
  - On some forms the first step's Back button is labelled **Cancel**.
- Closing a drawer with the X **discards the draft silently**. There is no unsaved-changes prompt (observed on product, kit, packaging and location drawers).
- **Validation:** clicking Next or Save with empty required fields does **not advance and shows no toast**. Required inputs only get a red invalid style. Required labels carry a trailing `*`.
- **Yes/No segmented toggles:** the selected Yes is green and the selected No is red.
- Kendo switches render "ON/OFF" text.
- Number inputs are spinners with up and down arrows and are formatted on blur (`10` becomes `10.00`, volume uses 5 decimals `0.00000`).
- Text inputs with limits show a counter, for example "0 / 250" or "0 / 100".
- **Toasts** appear top-right as "Success" plus a message, for example "Product created successfully.", "Retailer has been created successfully." and "You have successfully created pack type." The last one is a Logiwa copy bug shown when a *shipment package* is created.
- **Confirm-delete modal:** the title is "Are you sure you want to delete your product?", followed by a mini-table of the selected rows (# | SKU | Name | Pack type | Sales price | Purchase Price) and buttons **No / Yes**.
- **Change Log drawer:** title "<Entity> Change Log", a grid with columns TYPE | MESSAGE | OPERATION DATE | SOURCE, and a paged footer. Example row: `Create | KS-TEST-PROD-001 -> Product is created. | 11/5/2026 3:54:51 PM | mike@team-01.com`.
- **Print Options modal (Label):** the title "Print Options" has a printer icon. Below it is a selectable template card (subtitle "Default", title "Product Label"), a **Print Quantity** numeric input (min 1, default 1), **Preview** and **Download** secondary buttons, and a full-width primary **Print** button.
- **Custom fields:** each entity has an "Other Info" step with an **Add/Edit Custom Field** link. It opens "Create Custom Field" with:
  - Custom Field Type* (Text Box | Drop Down | Date Picker | Toggle)
  - Custom Field Name*
  - Is Active (Yes/No)
  - "+ Add More Custom Field"
  - Cancel / Add To Form

  Existing custom fields render as inputs. The product entity has a text-box custom field "Training" (`customFieldTextBox1`). Filter lists expose generic slots: Custom Field Date 1–3, Drop Down 1–2, Text Box 1–3, Toggle 1–2. Each entity has a **fixed slot model of 3 text, 2 dropdown, 3 date and 2 toggle fields**.
- **Bulk import pages** share one template (`en/wms/import/<entity>/<templateId>`):
  - Title "Bulk Import X", a helper paragraph, and a "Go back to X" link.
  - "Download our excel template" card with a **Download** button, plus a link to the "Import X Manual".
  - Upload dropzone ("Select", "Drop files here to upload / Drag your files here or click here").
  - Import history grid: STATUS | MASTER ROW COUNT | SUCCESS COUNT | ERROR COUNT | UPLOADED BY | CREATED DATE TIME | ACTIONS. The empty state reads "No records to display".

---

## 1. Products — `en/wms/product/list`

- **Title:** "Products". **Helper text:** "You can create, edit, or delete your products here." **Breadcrumb:** Home > Inventory > Products.
- Tabs: **PRODUCTS** (active) | **PRODUCT LISTINGS** (routes to `en/wms/listing-product/list`).
- Products are **client-scoped, not warehouse-scoped**: the list shows all clients and there is no warehouse filter. Sandbox total: 5,773.

### Header buttons
- **Bulk Import/Update ▾** (secondary, with an info icon) opens an action menu with section headers:
  - **Import:** Products · Pack Types & Barcodes (`en/wms/import/pack-type-barcode/15`) · Warehouse Replenishment Levels · Sku Based Inventory Allocation
  - **Update:** Products · Kit-Components
- **Create New Product** (primary) opens the **Product Category** chooser, described below.

### Toolbar
- Search-mode button (Equal / Starts With), "Search by SKU" input, Filter ▾.
- Bulk buttons **Delete** and **Label**, disabled until a row is selected.
- Refresh icon.

### Columns
All 29 columns, in order; all are visible in a full view:

IMAGE (thumbnail placeholder icon) · CLIENT · SKU (blue link) · BARCODE · NAME · STATUS (Active/Inactive text) · FRAGILE · OVERSIZED · DIGITAL PRODUCT · HAZARDOUS · INSERT · LIQUID · NON-RETURNABLE · PACKAGING MATERIAL · POSTER · FOLDABLE · STACKABLE (Yes/No) · SALES PRICE ($0.00) · PURCHASE PRICE · UOM PACK TYPE (Unit/Each/Case/Pallet) · LOT BATCH NUMBER TRACKING · EXPIRY DATE TRACKING · PRODUCT TYPE · PRODUCT GROUP · DESCRIPTION · TAX RATE (0) · FNSKU · CREATED DATE (M/D/YYYY) · PRODUCTION DATE TRACKING.

- The chooser labels some columns in sentence case: "Sales price", "UOM Pack type", "Product type", "Created date".
- Text cells truncate with an ellipsis. The SKU cell shows the barcode as a tooltip.
- **Sample rows:**
  - `DUDE Products LLC | 1107904 | 1107904 | 12.5x10.25x14 Box | Active | … PACKAGING MATERIAL=Yes | $0.00 | $0.00 | Each | … | Pratt 12.5x10.25x14 Box | 0 | 11/5/2026`
  - `Explore Scientific LLC | FL-AR1021000EQ3 | 812257018062 | FirstLight AR102mm… | $124.00 | $124.00 | Unit`

### Filter fields
Barcode, Client, Created Date, Custom Field Date 1–3, Custom Field Drop Down 1–2, Custom Field Text Box 1–3, Custom Field Toggle 1–2, FNSKU, Foldable, Fragile, Kit, Name, Oversized, Pack Type, Price, Product Group, Product Type, Returnable, Sales Price, Shelf Life, Sku, Stackable, Status, Track Expiry Date, Track Lot Batch Number, Track Production Date, Track Serial Number.

Operators per type are as in §0. For example, Client is `in | not in` over a checklist of all 31 clients, Name is a text operator, and Price is Min/Max.

### Row actions and behavior
- Kebab menu: **Show Details · Edit · Change Log · Delete**.
- SKU link click and Show Details both open the **Edit Product** drawer, the same wizard as create with the Client field locked as text.
- Change Log opens "Product Change Log".
- **Delete** (bulk or row) opens the confirm modal with the selected-rows table and No/Yes.
- **Label** (bulk) opens Print Options with the template "Default / Product Label" and Print Quantity.

### Create New Product — Product Category chooser
A drawer titled **"Product Category"** with the subtitle "Please select the type of product category to proceed." and an illustration. It offers three clickable cards with chevrons:
1. **Product**: "Select this category to create standard products."
2. **Kit**: "Select this category to proceed with creating kit-to-order or kit-to-stock products."
3. **Packaging Material**: "Select this category to create packaging materials to match with your shipment packages for inventory tracking."

The drawer title then shows a category badge: `Create Product [Product]`, `[Kit]` or `[Packaging Material]`.

### Wizard A — Standard Product (5 steps)

#### Step 1 · General

| Field | Type | Req | Default / notes |
|---|---|---|---|
| Client | dropdown (all clients) | * | "Select client". Locked (text) in Edit mode. |
| SKU (Stock Keeping Unit) | text, max 100 | * | "Enter SKU" |
| Name | text, max 200 | * | "Enter Name" |
| Description | text, max 500 | | |
| Product Image | url input | | "Paste URL address of the image to add" |
| (hidden) Product barcode | text, max 100 | | `upc`, "Enter product barcode code". Shown on Kit and Packaging; on Product the barcode lives in Pack Type. |
| Product Type | dropdown | | **Client-scoped list**. MLTest has "Packaging". |
| Product Group | dropdown | | Client-scoped. Empty state "No product group found." |
| Currency | dropdown | | Options listed below. Placeholder "Currency". |
| Purchase Price | numeric | | "$0" |
| Tax Rate | numeric with "%" prefix | | |
| Sales Price | numeric | | "$0" |
| Minimum safety stock | numeric spinner | | |
| FNSKU | text, max 100 | | |
| Active? | Yes/No | | Yes |
| Digital? | Yes/No | | No |

Currency options: AUD $, CAD $, EUR €, INR ₹, IDR Rp, MYR RM, MXN $, MAD .د.م., NZD NZ$, NGN ₦, PKR Rs, PHP ₱, GBP £, SGD $, THB ฿, TRY ₺, **USD $**, XOF F.CFA. Each option reads like "U.S. Dollar (USD) $".

#### Step 2 · Packing
- **Packing Instructions** (textarea, max 250) and **Return Instructions** (textarea).
- Yes/No toggles, all defaulting to No: Foldable, Fragile, Oversized, Insert, Stackable, Poster, Liquid, Non-Returnable.

#### Step 3 · Pack Type (UOM model)
- Helper text: "Add and edit pack types here. Barcodes can also be defined for each pack type. Click here to create a pack type." The link goes to pack-type master data.
- Segmented tabs: **Unit of Measure | Irregulars (n) | Hierarchicals (n)**.
- With no UOM yet, the step shows a full-width outline button **"Add Primary(UOM) Pack Type"**. It opens the modal below.

**Add Primary(UOM) Pack Type modal**

| Field | Notes |
|---|---|
| Pack Type* | Dropdown: **Unit, Case, Each, Pallet** (from the pack-type master) |
| UOM Quantity | Locked at 1 |
| Dimension Unit | Inch, Foot, Centimeter, Meter |
| Length / Width / Height | 0.00 |
| Volume Unit | Cubic Inch, Cubic Meter, Cubic Foot, Liter, Gallon, Cubic Centimeter |
| Volume | 0.00000. **Not auto-computed** from L×W×H; it stays 0 when you enter dims. |
| Use This Shipping Box Only | Dropdown of shipment packages, e.g. "SHB 6X8X10" |
| Weight Unit | Pound, Ounce, Kilogram, Gram |
| Weight | 0.00 |
| Use Item's Own Box For Shipping | Yes/No (default No). Info tooltip: "This parameter is only informational, it is not supported functionally at the packing station." |
| Barcode(s) | Input "Enter and add barcode" with an **Add** button. Added barcodes show as removable chips (`KSTEST0000001 ×`), and several are allowed. |

The modal buttons are Cancel and **Add** (disabled until Pack Type is chosen).

**After adding, the step shows:**
- A **Primary(Uom)** card: a box icon, a "Pack Type" dropdown (Unit) with a collapse chevron, and edit (pencil) and delete (×) icons.
- A Details section ("View and add details with edit button") listing Barcode(s), Use This Shipping Box Only, Length/Width/Height with units, Use Item's Own Box for Shipping, and Volume.
- Two cards with box illustrations, each with an **Add** button:
  - **Irregular**: "Link to irregular card description"
  - **Hierarchical**: "Link to hierarchical card description"

**Add Hierarchical Pack Type modal**
- Pack Type*, **Child Qty** (default 2), UOM Quantity (derived and locked, for example 2).
- Dimension Unit with L/W/H, Volume Unit with Volume, Use This Shipping Box Only, Weight Unit with Weight, Use Item's Own Box For Shipping.
- **Use Primary(Uom) Barcode(s)** Yes/No (default No) and a Barcode(s) chip input.
- Cancel / Add. Represents Case = n × Unit, Pallet = n × Case, and so on.

**Add Irregular Pack Type modal**
- Same fields as primary plus **Use Primary(Uom) Barcode(s)**.
- It also has a UOM Quantity input, used for alternate packs that are not nested.

Tab counters update: "Irregulars (0)" and "Hierarchicals (0)".

#### Step 4 · Advanced (accordion; each section has a + toggle)

1. **Add Custom Declarations**
   - Declared Value (0.00), HS Tariff Code, Origin Country Code.
   - "Is not declared to customs?" Yes/No.
   - Manufacturer (max 200), Manufacturer Product Identifier (max 300), Description (max 200).

2. **Expiry Tracking**
   - Expiry date tracking Yes/No and Receiving-Only Expiry Tracking Yes/No.
   - Expiry date format dropdown: yyyyMMdd, ddMMyyyy, MMddyyyy, yyyy-MM-dd, yyyy-dd-MM, yyyy/MM/dd, yyyy/dd/MM, yyyy.MM.dd, yyyy.dd.MM.
   - Expiry Date Scan Method: **During Picking | During Packing** (default During Picking).
   - Use production date Yes/No and Shelf life in days (0.00).

3. **Hazmat Information**
   - "Mark this item as hazardous" switch (OFF by default). All fields below are disabled until it is ON.
   - Hazmat ID (text).
   - Hazmat Type: FR, EQ, LR, LQ, BATTERY, ORMD.
   - Hazmat Attribute: Contains Lithium Ion, Contains Lithium Metal, Packaged Lithium Ion, Packaged Lithium Metal, Lithium Ion Battery Only, Lithium Metal Battery Only.
   - Quantity (0.000).
   - Quantity Type: Gross, Net.
   - Quantity Unit: Pound, Ounce, Kilogram, Gram, Milliter [sic], Liter.
   - Hazmat Container Type: Fiberboard Box, Wooden Box, Plastic Jerrican, Metal Box, Steel Drum, Plastic Box, Plastic Drum, Other, Styrofoam Box, Cylinder, Envirotainer, Plywood Box, Aluminum Drum, Aluminum Cylinder, Plastic Pail, Plywood Drum, Fiber Drum, Steel Jerrican, Aluminum Jerrican, Steel Box, Carton, Aluminum Box.
   - Proper Shipping Name and Class Division (text). Every field has an info tooltip icon.

4. **Inventory Channel Allocation**
   - "Allocations" header with an **Add Allocation** (purple) button.
   - Grid columns: CHANNEL SETUP | WAREHOUSE | STATIC QTY | RESERVE QTY | ALLOCATION PERC. | SYNCED QTY. Empty state "No records to display".
   - Add Allocation opens the "Add Inventory Channel Allocation" modal with Sales Channel Setup* (dropdown of store setups, for example giftshoppers-usa, bcaq75-7z, david-653, vroomtec) and Cancel / Save.
   - The grid columns imply the model behind this: per channel setup, per warehouse, either a static quantity to publish or a reserve quantity plus an allocation percentage. Synced Qty is read-only.

5. **Lot/Batch Tracking**
   - Lot/Batch tracking Yes/No, Receiving-Only Lot/Batch Tracking Yes/No, Auto create lot/batch number Yes/No.
   - Regex (text).
   - Lot/Batch Number Scan Method: During Picking | During Packing.

6. **Production Date Tracking**
   - Active Yes/No and Receiving-Only Prod. Date Tracking Yes/No.
   - Production Date Format (same 9 formats as expiry).
   - Production Date Scan Method: During Picking | During Packing.

7. **Replenishment Levels**
   - Select Replenishment Strategy radios: **Global | Per Warehouse**.
   - Global shows Min. Replenishment Level and Max. Replenishment Level (0).
   - Per Warehouse shows an **Add Replenishment Level** button and a grid (WAREHOUSE | MIN. REP. LEVEL | MAX. REP. LEVEL). The modal has Warehouse(s)* (multi-select: MLT1 - Test Warehouse, Team 1 Supplier Service), Min/Max, and Cancel / Save.

8. **Serial Number Tracking**
   - Track Serial Number Yes/No and Track Secondary Serial Number Yes/No.
   - Tracking Method dropdown: None (placeholder), **Both Receiving and Packing**, **Only Packing**.
   - Skip Scan Serial Number Yes/No and Serial Number Regex.

#### Step 5 · Other Info
- Helper text: "You can optionally add or edit custom fields under 'Other Info' tab".
- A Custom Fields block lists existing fields (for example "Training") and an **Add/Edit Custom Field** link.
- Footer: **Back / Save**.
- Save shows the toast "Success – Product created successfully." The drawer stays open on the last step and the grid refreshes with the new row first (sorted by Created desc).

### Wizard B — Kit (5 steps: 1.General 2.Components 3.Packing 4.Advanced 5.Other Info)
- **General:** at the top, **Kit Type** segmented control **Kit to Order | Kit to Stock**. Then the same fields as Product plus a visible product barcode input and **UOM Pack Type*** (Unit/Case/Each/Pallet, default Unit).
- **Components:** "Search & Add Component — Find and add the components that make up the kit."
  - A searchable combobox, "Search and Add Kit-to-Stock Product", limited to the **selected client's** products. It shows "NO DATA FOUND" when the client has none.
  - Grid: IMAGE | ITEM | QUANTITY | (remove).
  - In the sandbox, Next advanced with zero components; there was no validation.
- **Packing:**
  - Weight Unit* (Pound) with Weight, Dimension Unit* (Inch) with L/W/H, and Volume Unit* (Cubic Inch) with Volume.
  - Use This Shipping Box Only.
  - Packing and Return Instructions, plus the same 8 Yes/No flags.
  - The kit has **no Pack Type step**; its dims and weight live here.
- **Advanced:** only Add Custom Declarations, Hazmat Information and Inventory Channel Allocation. There is no lot, expiry, serial or replenishment tracking for kits.
- **Other Info:** custom fields, then Back / Save.

### Wizard C — Packaging Material (3 steps: 1.General 2.Packing 3.Other Info)
- **General:** Client*, SKU*, Name*, Description, Product Image, barcode, Product Type, Product Group, UOM Pack Type*, Currency, Purchase Price, Minimum safety stock, FNSKU, Active?. There is no Sales Price, Tax or Digital.
- **Packing:**
  - Weight Unit*, Dimension Unit* with L/W/H, Volume Unit* with Volume (all units default to "Select an option").
  - Use This Shipping Box Only.
  - Instructions and flags, with Foldable, Fragile, Oversized, Insert, Stackable, Poster and Non-Returnable. There is **no Liquid flag**.
- Saved rows show PACKAGING MATERIAL = Yes in the grid. These products are what Shipment Package "Inv. Tracking" decrements.

### Business logic inferred
- A SKU is unique per client.
- The barcode lives on the pack type, and several barcodes per pack type are allowed.
- UOM hierarchy is Primary (qty 1), then Hierarchical (Child Qty × parent), plus Irregular alternates.
- The tracking flags (lot, expiry, production date, serial) drive scan prompts during picking or packing, according to each "Scan Method" setting.
- The "Receiving-Only" variants capture the value at receipt only.

---

## 2. Product Listings — `en/wms/listing-product/list`

- **Title:** "Product Listings". **Helper text:** "Product listings act as a record of the products you're selling across your sales channels. You'll be able to see all listings of a product here."
- Tabs: PRODUCTS | **PRODUCT LISTINGS**.
- **Header:** **Import** (dropdown button). It navigates to `en/wms/import/productlisting/21` ("Bulk Import Product Listings", standard import template, "Go back to product listings").

### Toolbar
- Filter ▾.
- **Tag** button (disabled until selection). It opens a Tags popover: "Search Tags", an empty state "Create new tags to differentiate your lines from others.", and a **+ Create Tag** primary button.
- A segmented radio, **Unlinked Listing** (default) | **Linked Listing**. This splits channel listings that are not yet mapped to a Logiwa product from those that are.

### Columns
IMAGE | PRODUCT NAME | STORE NAME | SELLER SKU | CHANNEL ID | DESCRIPTION | STORE PRICE | TAGS | LOGIWA PRODUCT | NEVER SYNC | PRODUCT TYPE | PRODUCT GROUP.

### Filter fields
Channel Product Price, Client, Never Sync, Seller SKU, SKU, Store, Store Name, Store Product Name, Store SKU, Tag.

### Notes
- The grid stayed on "Loading" for more than 2 minutes in the sandbox, so **row-level actions could not be captured**.
- Inferred behavior: link and unlink a listing to a Logiwa SKU, a Never Sync flag that excludes the listing from inventory push, and tags.

---

## 3. Locations — `en/wms/location/list`

- **Title:** "Location". **Helper text:** "You can edit or create a location from this screen." **Breadcrumb:** Home > Settings > Location.
- Locations are **warehouse-scoped**. The default list shows all warehouses (3,927 total). Use Filter → Warehouse → in "MLT1 - Test Warehouse" to scope it; MLT1 had 6 locations, then 7 after the test.

### Header buttons
- **Import ▾** (details dropdown):
  - Bulk Import Locations → `en/wms/import/location/5`
  - Bulk Update Locations → `en/wms/import/location/9`
- **Create Location** (primary). There is **no in-app range or bulk location generator**; bulk creation is done by Excel import.

### Toolbar
- Filter ▾.
- **Label** (prints location labels; disabled until selection).
- **Assign Capacity ▾** (dropdown):
  - Bulk Import Product Capacity → `en/wms/import/product-capacity/10`
  - Bulk Update Product Capacity → `.../11`
  - Bulk Import LP Capacity → `en/wms/import/lp-capacity/12`
  - Bulk Update LP Capacity → `.../13`
- **Delete**.

### Columns
All 21 columns: LOCATION CODE · CELL DISPLAY MEMBER · LOCATION BARCODE · WAREHOUSE · LOCATION GROUP · LOCATION ZONE · LOCATION TYPE · REPLENISHMENT LOCATION TYPE · AREA TYPE · ASSIGNED MOBILE CART · WALKING PATH PRIORITY · LEVEL · MEZZANINE · AISLE · RACK · POSITION · COLUMN · HEIGHT · LOCKED (Yes/No) · INVENTORY STATUS (**Available / Occupied**) · PREVENT ALLOCATION (Yes/No).

The default visible set is only Location Code, Location Group and Location Type.

### MLT1 data

| Code | Type | Area | Level | Inv. status |
|---|---|---|---|---|
| MLT1-SHIP | Ramps | Shipment | 0 | Available |
| MLT1-PACK | Business Station | Packing | 0 | Available |
| MLT1-B-01 | Racks | Storage | 2 | Occupied |
| MLT1-A-01 | Shelves | Picking | 1 | Occupied |
| MLT1-RECV | Ramps | Receiving | 0 | Occupied |
| PrimaryLoc | — | — | — | Available |

Team 1 shows the naming convention: aisle letter + column + level, for example `O905` is aisle O, column 9, level 5, Racks, Picking. Other examples are T1001, "Shipping A–G" (Shipment), R01–R03 (Receiving), RTS (Returns), QC HOLD and OFFICE (Storage), PS1–PS4 (Packing).

### Filter fields
ABC Code, Aisle, Area Type, Assigned Mobile Cart, Client, Code, Column, Custom Field Date 1–3 / Drop Down 1–2 / Text Box 1–3 / Toggle 1–2, Display Member, Has Inventory, Height, Level, Location Barcode, Location Group, Location Type, Location Zone, Locked Location, Path Priority, Position, Prevent Allocation, Rack, Replenishment Type, Volume, Warehouse.

### Row actions
- Kebab: **Show Details · Edit · Change Log · Delete**.
- Show Details opens the **Edit Location** drawer, with the steps "Information | Product Capacity | LP Capacity".

### Create Location drawer (3 steps: 1.Information 2.Product Capacity 3.LP Capacity)

#### Step 1 · Information

| Field | Type | Options / default |
|---|---|---|
| Location Code* | text | |
| Warehouse* | dropdown | MLT1 - Test Warehouse, Team 1 Supplier Service |
| Location Group | dropdown | Warehouse-scoped master. MLT1 has none. |
| Location Zone | dropdown | Warehouse-scoped master. MLT1 has none. |
| Location Type | dropdown | Racks, Shelves, Bins, Virtual, BusinessStation, Ramps |
| Area Type | dropdown | Picking, Storage, Receiving, Returns, Packing, Shipment, Kitting, Loading |
| Replenishment Location Type | dropdown | Source, Target |
| Walking Path Priority | numeric | 0 (pick-path sequence) |
| Location Capacity Type | dropdown | None (default), Maximum Unit Quantity, Maximum Pack Quantity |
| Maximum Capacity Quantity | numeric | 0 |
| Maximum SKU Quantity | numeric | |

**Dimensions**

| Field | Type | Options / default |
|---|---|---|
| Mezzanine | text, max 100 | |
| Aisle | text | |
| Rack | text | |
| Column | numeric | 0 |
| Level | numeric | 0 |
| Position | text | |
| Dimension Unit | dropdown | Inch (default), Foot, Centimeter, Meter |
| Height / Width / Length | numeric | 0.00 |
| Volume Unit | dropdown | Cubic Inch (default), … |
| Volume | numeric | 0.00000 |

**Other Information**

| Field | Type | Options / default |
|---|---|---|
| Cell Display Member | text | Placeholder "Display Member" |
| Location Barcode | text | Defaults to Location Code if blank (observed after save) |
| ABC Code | dropdown | None, A, B, C |
| Single Client | Yes/No | |
| Lock Location | Yes/No | |
| Client | dropdown | All clients. Dedicates the location to a client. |
| Print & Apply on Packing | Yes/No | |
| Color Code | text | "Enter Color Code" |
| Add/Edit Custom Field | link | |

**Location Rules**: "Select the rules that define how this location can be used." These are checkboxes, all off by default:
- Prevent Allocation
- Prevent Inventory Sync to Stores
- Only 1 Lot Number
- Only Damaged Items
- Only 1 Expiration Date
- Only 1 SKU
- Only 1 LP
- Only 1 Production Date
- Auto Remove LP After Replenishment
- Auto Remove LP After Transfer

Footer: Cancel / Next.

#### Step 2 · Product Capacity
- "Products" header with an **Add Capacity** button.
- Grid: PRODUCT | PACK TYPE | MIN QTY | MAX QTY.
- **Add Product Capacity modal:** Client*, Product* ("Search Product", client-scoped), Pack type*, Min Qty, Max Qty, Save. This defines replenishment min and max for a pick face.

#### Step 3 · LP Capacity
- "LP's" header with **Add Capacity**.
- Grid: LP | MIN QTY. | MAX QTY. | PRODUCT SKU.
- **Add LP Capacity modal:** LP Type* (warehouse-scoped LP types, for example "KS-TEST-TOTE (MLT1)"), Min Qty, Max Qty.
- Inside the modal, **Assign Product for this LP** reveals Client* and Product*, then Save.
- Footer: Back / **Save**. On save the drawer closes and the row appears; Barcode is populated with the code.

### Hierarchy model inferred
Warehouse → Zone → Group → (Mezzanine → Aisle → Rack → Column → Level → Position) → Location.

- Area Type drives which workflows can use the location: putaway, pick, pack, ship and so on.
- Location Type is the physical kind.
- Walking Path Priority orders pick paths.
- Inventory Status (Available or Occupied) is derived from on-hand stock.

---

## 4. Customers — `en/wms/customer/list`

- **Title:** "Organization". The helper text is placeholder copy, "Customer description comes here" (a Logiwa bug). **Breadcrumb:** Home > Settings > Organization > Customers.
- Organization tabs: **CLIENT** (`en/account/client/list`) | **CUSTOMER** | **VENDORS** (`en/wms/vendor/list`) | **RETAILERS** with a BETA badge (`en/wms/retailer/list`).
- **Header:** **Create Customer**. **Toolbar:** Filter ▾ only.
- **Columns:** CUSTOMER NAME | E-MAIL | PHONE | CLIENT | CITY | COUNTRY | STATE | IS ACTIVE.
- **Empty state:** "No records to display". The sandbox has 0 customers.
- **Filter fields:** Active, Client, Email, Full Name.

### Create Customer drawer (single page)
- First Name* · Last Name* · E-mail* · Phone* (all plain text boxes) · Client* (dropdown of all clients) · Active Yes/No (default Yes).
- **Addresses** section: "Add the customer's addresses." with an **Add** button and the empty state "No addresses have been added yet. Click the add button to add."
- **Add Address modal:**
  - Subtitle "Enter and set the customer's address to use on operations."
  - Address name*, Usage Type* (**Shipping | Billing | Return**), City*.
  - Country* (247 countries). **State*** appears once a country with states is chosen; the USA has 62 entries, including territories.
  - Postal Code*, Address line 1*, Address line 2.
  - Active Yes/No, **Set Default Address** Yes/No, then Cancel / Add.
- Footer: Cancel / Save.
- **Save was not achieved.** The sandbox rendered duplicate drawer instances and the save gave no feedback, so it is unknown whether an address is mandatory.

---

## 5. Retailers (BETA) — `en/wms/retailer/list`

- **Title:** "Organization". **Breadcrumb:** Home > Settings > Organization > Retailer.
- **Header:** **Create Retailer**. **Toolbar:** Filter ▾ and **Delete** (bulk).
- **Columns:** NAME | LOGO | COUNTRY | ADDRESS | STATUS (Active).
- **Filter fields:** Name only.
- **Row kebab:** **Edit** only.
- Retailers are **not client-scoped**; the form has no client field. They model big-box retailers for EDI / B2B labeling.

### Create Retailer drawer (3 steps: 1.General 2.Advanced 3.Other Info)

**1 · General**
- Name* · Description · Status Yes/No (default Yes) · Business Name.
- Retailer Logo (file upload, "Upload retailer logo").
- **Address:** Address Line 1, Address Line 2, Postal Code, City, Country* (247), State (enabled after country; 62 for the USA), Email, Phone Number.

**2 · Advanced**
- **Label Generation:** switch "Create case labels for single item LPs/Parent LPs".
- **Label Print Settings:** Case Label Print Quantity (1) and LP Label Print Quantity (1).
- **Documents:** "You can upload and download documents for Retailer as needed." with an **Upload document** file input.

**3 · Other Info**
- Custom fields.
- Footer: Back / **Create**.
- Toast: "Retailer has been created successfully."

---

## 6. Vendors — `en/wms/vendor/list` (reachable from the Organization tabs)

- **Helper text:** "You can create, edit, and delete vendors from this screen. A vendor refers to a supplier of any goods or service…"
- **Header:** Create Vendor.
- **Columns:** VENDOR DISPLAY NAME | VENDOR NAME | CLIENT.
- **Sample:** "MLTest Vendor | MLTest Vendor | MLTest". The sandbox total is 4.

### Create Vendor drawer (single page)
- Client* (dropdown) · Display name* (max 100) · Vendor name* (max 255; `officialIdentity`).
- Checkbox **Use shipment address as billing address**, checked by default.
- **Shipment address:** Address name (max 50), Address line 1 (max 256), Address line 2 (max 256), Postal Code, City, Phone Number, Country* (default USA), State* (default Alabama).
- When the checkbox is unchecked, a separate billing address block appears (inferred).
- Footer: Cancel / Save.

---

## 7. Clients — `en/account/client/list` (Organization › CLIENT tab)

- **Helper text:** "Define your customers (clients) and set up preferences."
- **Header:** Bulk Import/Update ▾ · **Create Client**. **Toolbar:** Filter, Delete.
- **Columns:** CLIENT | OFFICIAL NAME | FULL NAME | TAX ID. The sandbox has 31 clients, for example "SENS Coffee | Single Origin Inc (SENS Coffee)" and "Clear2o | Applica Water Products LLC".

### Create Client drawer (4 steps: 1.Information 2.Settings 3.Addresses 4.Others)

**1 · Information:** Display name* and Official name*.

**2 · Settings:** Currency* (dropdown), then groups of kendo switches. All defaulted OFF in the draft.

| Group | Switches |
|---|---|
| Notification Email Settings | Received PO notification · Daily inventory notification · Daily inventory by location notification · Safety stock notification |
| Fulfillment Settings | Prevent reallocation if missing · Retain Allocation During Missing · Allow Different Location/LPN |
| Packing Settings | Direct print pack list · Enable pack all · Disable shipping option change · Disable package change · Disable batch order packing · Disable carrier rate · Do not allow multiple shipment packages · Disable packing without label · Enable enter quantity · Enable package suggestion · Force package type validation · Direct Print Attached Documents · Scan Only Pack Type Barcodes · Capture Label Images for Packing List · Auto Complete Packing On Last Scan · Use Pre-produced labels in Multi Box Packing · Force Cartonization Instructions on Packing |
| Advanced Settings | Keep Receiving Date on Inventory · Allow unique SKU barcodes · Keep PO Number on Inventory · Activate receiving verification for physical attributes |

**3 · Addresses** and **4 · Others:** not captured. Walking further needs a Currency value, and no client was saved.

---

## 8. Warehouse — `en/wms/warehouse/list` (read-only capture, nothing saved)

- **Title:** "Warehouse". **Helper text:** "On the Warehouse screen, you can edit or create a warehouse. Before creating a new warehouse, we highly suggest you to read this document: Create a Warehouse. To learn how to define locations in a warehouse, please see this document: Create a Location." The two document names are links.
- **Header:** **Create Warehouse**. **Toolbar:** Filter.
- **Columns:** WAREHOUSE CODE | ADDRESS | CONTACT | TYPE.
  - `MLT1 - Test Warehouse | 2908 SE I St Ste 2,Bentonville,72712,US, | MLT Test | Internal`
  - `Team 1 Supplier Service | … | Chris | Internal`
- **Row kebab:** Show Details · Edit · Change Log · Delete. Show Details opens **Edit Warehouse**.

### Edit Warehouse drawer (2 steps: Information | Settings)

**Information**
- Code* (`MLT1 - Test Warehouse`) and **Prefix** (`MLT1`, used in generated document numbers).
- Address line 1* (counter 18/250), Address line 2 (0/250), Postal Code*, City*, Country* (United States of America), State* (Arkansas).
- Contact name*, Contact Phone Number*, Email.
- **Day Shift** ("Enter working hours to track daily productivity."): Start Time* (08:00) with Day Zone* AM, and End Time* (05:00) with Day Zone* PM.
- Footer: Cancel / Next.

**Settings**
- **Measurement Settings:** Default dimension unit* (Inch, Foot, Centimeter, Meter; MLT1 = Inch) and Default weight unit* (Pound, Ounce, Kilogram, Gram).
- **Use LP Dimensions for Volumetric Putaway** Yes/No.
- **Default Locations:**
  - Default receiving location. Options are the warehouse's Receiving-area locations; MLT1-RECV is the only one.
  - Default ship location. Options are the Shipment-area locations; MLT1-SHIP is the only one.
- **Inventory Adjustment Settings:** Mandatory Reason for Manual Adjustments Yes/No and Mandatory Reason for Cycle Count Updates Yes/No.
- **Security:** checkbox "Automatically log out mobile users after a period of inactivity." (checked). The timeout field was not visible.
- Footer: Back / Save. **Not saved.**

---

## 9. Mobile Carts — `en/wms/mobilecart/list`

- **Title:** "Mobile Carts". **Helper text:** "You can edit or create a Mobile Cart here".
- **Header:** **Create Mobile Cart**. **Toolbar:** Filter, Label, Delete.
- **Columns:** CART CODE | CART DESCRIPTION | WAREHOUSE | STATUS (**Available / Occupied**) | NUM. OF CELLS | NUM. OF LEVELS | NUM. OF COLUMNS | NUM. OF TASKS | JOB CODE | NUM. OF ORDERS | OPERATION TYPE (Picking) | ALLOW MULTIPLE JOB (Yes/No).
- **Sample (Team 1):** `Cart 1 | Cart 1 (24 bins) | … | Available | 24 | 4 | 6 | 0 | | 0 | Picking | No`. The rule is cells = levels × columns. MLT1 has no carts.
- **Filter fields:** Code, Dynamic?, Job Code, Mobile Cart Type, Number of Cells, Number of Columns, Number of Levels, Number of Orders, Number of Tasks, Occupied?, Warehouse.

### Create Mobile Cart drawer (2 steps: 1.Mobile Cart 2.Cell List)
- **1 · Mobile Cart:** Code*, Select Warehouse* (MLT1 / Team 1), Description, **Mobile Cart Type*** (`warehouseMobileCartTypeIdentifier`).
  - The Mobile Cart Type list is warehouse-scoped and **empty for MLT1**, so the wizard cannot advance. Its required asterisk appears only after a Next attempt.
  - The type presumably defines the levels × columns grid and the operation type. Where it is configured is unknown; possibly Job Types or a hidden master.
- **2 · Cell List:** not reachable. Inferred: an auto-generated list of cells (level/column) with barcodes, printable via Label.

---

## 10. Shipment Packages — `en/wms/shipmentpackage/list`

- **Title:** "Shipment Packages". **Helper text:** "Create and list shipment packages you will use for shipping orders".
- **Header:** **Create Shipment Package**. **Toolbar:** Filter only, with no bulk buttons.
- **Columns:** CODE | DESCRIPTION | WAREHOUSE | TRACK INVENTORY (Yes/No) | INVENTORY REDUCTION LOCATION (e.g. "Packing Station") | LENGTH | WIDTH | HEIGHT | DIMENSION UNIT | EMPTY WEIGHT | MAX WEIGHT | WEIGHT UNIT | MAX VOLUME | VOLUME UNIT ID | ACTIVE?.
- **Samples:**
  - `10X8X6 | 10X8X6 BULLETPOINT BRANDED BOX (PRATT) | Team 1 … | Yes | Packing Station | 10 | 8 | 6 | Inch | 0.4 | | Pound | | Cubic Inch | Yes`
  - Envelopes are modeled with height 0.01: `9X12 | 9X12 TYVEK ENVELOPE | … | 12 | 9 | 0.01`.
- **Filter fields:** Code, Warehouse.
- **Row kebab:** Show Details · Edit · Delete. There is no Change Log here.

### Create Shipment Package drawer (4 steps: 1.General 2.Client Access 3.Inv. Tracking 4.Other Info)

**1 · General**
- Warehouse* · Code* · Description.
- Weight Unit* (Pound default; Pound/Ounce/Kilogram/Gram), Empty Weight, Max Weight.
- Dimension Unit* (Inch default), Length*, Width*, Height*.
- Volume Unit (Cubic Inch), Max Volume.
- Currency* (USD default; same 18 currencies), Purchase Price (0.00).
- Active? Yes/No.

**2 · Client Access** (radio cards)
- **All Clients:** "Give access to this shipment package to all existing and future clients." This is the default.
- **Select Manually:** "List all clients to manually select shipment package access." It reveals:
  - A grid with checkbox | CLIENT | ACCESS (Disabled/Enabled), listing all 31 clients.
  - **Disable** and **Enable** bulk buttons that flip ACCESS for the selected rows, plus a pager.

**3 · Inv. Tracking**
- **Enable Inventory Tracking** Yes/No (default No).
- When Yes it reveals:
  - Inventory Owner (Client).
  - SKU (a packaging-material product of that client).
  - **Inventory Reduction Location**: Packing Station | Specific Location | Any Location. When Specific Location is chosen, a Location dropdown appears.
- Packing consumes one unit of the packaging SKU from that location.

**4 · Other Info**
- Custom fields.
- Footer: Back / **Finish**.
- Toast: "You have successfully created pack type." (sic). The row appears with TRACK INVENTORY = No.

The package list also feeds Product → Pack Type → "Use This Shipping Box Only" and packing-station package suggestion.

---

## 11. Feature / wizard inventory for KitStaks parity (checklist)

1. Product Category chooser (Product / Kit / Packaging Material) feeding three different wizards.
2. 5-step Product wizard with the UOM pack-type builder (Primary, Hierarchical with child qty, Irregular), multiple barcodes per pack, and the "Use this shipping box only" link.
3. Advanced accordion:
   - Customs declarations.
   - Expiry, lot/batch and production-date tracking, each with scan-method and receiving-only variants and a date-format list.
   - Hazmat, with full option lists.
   - Channel inventory allocation (static, reserve and percentage per channel setup and warehouse).
   - Replenishment min/max, Global or Per-Warehouse.
   - Serial tracking (method, secondary serial, regex, skip scan).
4. Kit wizard: Kit to Order vs Kit to Stock, a client-scoped component picker with quantities, and kit-level packing dims.
5. Custom-field framework (Text, Dropdown, Date, Toggle) with fixed filterable slots on every entity.
6. Grid framework: column chooser, URL-persisted filters with typed operators, saved filters, Equal or Starts-With search, density toggle, Excel export, total count, row kebab (Show Details / Edit / Change Log / Delete), and bulk actions gated on selection.
7. Change Log drawer per record (type, message, timestamp, user).
8. Label printing modal (template, quantity, Preview, Download, Print) for products, locations and carts.
9. Excel import/update pages per entity with history grids: products, pack types and barcodes, replenishment levels, SKU-based allocation, kit-components update, locations import and update, product and LP capacity import and update, and product listings.
10. Location wizard: structure fields (mezzanine, aisle, rack, column, level, position), area and type enums, capacity type, 10 location-rule flags, ABC code, single-client dedication, color code, plus Product Capacity and LP Capacity sub-steps.
11. Product Listings: Unlinked vs Linked toggle, Tags with create, Never Sync, and listing import.
12. Organization hub tabs: Client (4-step wizard with about 28 behavior switches), Customer (with a multi-address modal and usage types), Vendor (shipping and billing address), and Retailer (BETA: logo, label-generation settings, documents).
13. Warehouse settings: prefix, day shift hours, default units, volumetric putaway, default receive and ship locations, mandatory adjustment reasons, and mobile auto-logout.
14. Mobile carts: type-driven cell grid, status, and job linkage.
15. Shipment packages: per-client access matrix, inventory-tracked packaging consumption, and the reduction-location rule.

## 12. Could not access / unknown
- **Product Listings grid** never finished loading, so its rows and row actions are unknown.
- **Customer save** gave no feedback, so the required-address rule and the customer row actions are unknown.
- **Mobile Cart:** no cart types exist for MLT1, so step 2 (Cell List) and the cart-type master location are unknown.
- **Client wizard** steps 3 (Addresses) and 4 (Others) were not walked.
- **Location Label:** clicking it produced no visible modal (it may print directly); unconfirmed.
- **Product "Show Details"** opens the same Edit drawer; there is no standalone detail page or inventory sub-tabs on the product record.
- **Location Group and Location Zone** masters: no admin page was found in the Settings menu, and MLT1 has none.
