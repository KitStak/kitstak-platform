# Logiwa iO LIVE capture: Global Shell, Settings, Automation and Integrations

Captured live on 2026-11-09 from https://my.logiwa.com. The session was already signed in as Mike Lunsford (Supervisor), and the MLT1 - Test Warehouse scope was used.

This file **adds to** `references/logiwa-spec/08-settings-shell.md` and `06-automation-integrations.md`. Where those files already describe a screen accurately, this file says "unchanged" and gives only the new or corrected detail.

Records created during the capture (prefixed `KS-REF-`):
- LP Type **KS-REF-LPT1** (MLT1, prefix `KSR-`, length 1). It was saved, which produced the success toast below. It was **not deleted**: the delete confirmation was not captured because deletion was blocked by policy.
- Nothing else was saved. The Mobile Cart, Shipment Package, Custom Carrier and Shipment Order Type wizards were walked and then closed.

---

## Navigation map

### Top bar (WMS module pages, `en/wms/*`)
- Logo links to `en/`.
- Mega-menus (they open on hover): Fulfillment · Inventory · Automation · Integrations · Reports · Analytics · Settings.
- Right cluster, in order:
  1. Search ("Search in pages")
  2. Screen Recording
  3. Transactions (`myl-transaction-popup`)
  4. Printers
  5. **Help (in-app panel, NEW)**
  6. User (hover menu)
- The mega-menu link set was re-verified live. It is **identical** to 08-settings-shell.md, including the Automation menu: Algorithms `en/wms/algorithm` · Workflows `en/wms/workflow` · Rate Shopping `en/wms/rate-shopping-presets` · Wave Rules `en/wms/job/wave-rules`.

### Top bar (Account module pages, `en/account/*`)
This covers Company Settings, Data Setup, Clients, Users and Profile. The right cluster shows **only Search and User**: the Screen Recording, Transactions, Printers and Help icons are missing. Logiwa's chrome is inconsistent here. KitStaks should use one shell everywhere.

### Breadcrumb patterns observed
- `Home > Settings > Warehouse`, `Home > Settings > Mobile Carts`, `Home > Settings > LP Types`
- `Home > Settings > Packages LP Numbers` (sic: the LP Numbers page shows "Packages LP Numbers")
- `Home > Settings > Shipment Packages`, `Home > Settings > Algorithms`
- `Home > Orders > Job Wave Rules`
- Data Setup pages: `Home > Settings > <Lookup Name>`. Defect: on the code-generation route the breadcrumb leaf reads "Purchase Order Type" instead of "Auto Code Generation Preferences".

### Drilldown / sub-route map

| Screen | Route(s) | Opens |
|---|---|---|
| Warehouse | `/wms/warehouse` → `/wms/warehouse/list` | Edit drawer (code link, Show Details, Edit), Change Log drawer |
| Mobile Carts | `/wms/mobilecart` → `/wms/mobilecart/list` | 2-step drawer |
| LP Types | `/wms/lp-types` → `/wms/lp-types/list` | 3-step drawer, plus Custom Field sub-drawer. Page tabs: LP TYPES / LP NUMBERS |
| LP Numbers | `/wms/lp-numbers/list` | Create drawer. Import goes to `/wms/import/lp-number/8` |
| Shipment Packages | `/wms/shipmentpackage` → `/list` | 4-step drawer |
| Data Setup | `/account/settings/datasetup/<slug>` | Right sub-nav with 18 lookups. Each lookup has a create drawer |
| Algorithms | `/wms/algorithm` → `/wms/algorithm/type` (splash) → `/wms/algorithm/allocation` or `/putaway` | Page tabs PUTAWAY ALGORITHM / ALLOCATION ALGORITHM |
| Workflows | `/wms/workflow` | **Still redirects** to `/en/public/signin`, then back to `/en/wms/dashboard` (not accessible to this user) |
| Wave Rules | `/wms/job/wave-rules` | Page tabs WAVE RULES / JOB MANAGEMENT / ALLOCATION EXCEPTIONS / WAVE LOG REPORT / SHORTAGE REPORT |
| Company Settings | `/account/settings/company/basic` | The "Account defaults" link `/en/account/settings` redirects back to basic (it is dead) |

---

## Shared primitives (verified live)

### Row kebab
- The kebab is `div.myl-grid-action-three-dots` (three spans).
- It opens `.myl-grid-menu-popup`.
- Menu items per entity:

| Entity | Menu items |
|---|---|
| Warehouse | Show Details · Edit · Change Log · Delete |
| Mobile Carts | Show Details · Edit · Duplicate · Delete (no Change Log) |
| LP Types | Show Details · Edit · Change Log · Delete |
| LP Numbers | Edit · Change Log (no delete: LPs are permanent) |
| Shipment Packages | Show Details · Edit · Delete (no Change Log) |
| Allocation Algorithms | Show Details · Edit · Change Log · Delete |
| Wave Rules | Show Details · Edit · Change Log · Delete |

### Show Details defect
In Logiwa, "Show Details" opens the **same editable drawer** as Edit. For Warehouse, the drawer is even titled "Edit Warehouse" and every input is enabled. KitStaks should make Show Details a read-only view with an "Edit" button.

### Toolbar bulk buttons
Bulk buttons are disabled until a row is checked:
- Mobile Carts: `Label`, `Delete`
- LP Types: `Delete`
- LP Numbers: `Print Barcode`
- Wave Rules: `Run`

### Toast
- Container: `notification-place-container top`, holding a child `notification-container success`.
- Content: title **"Success"** and body **"LP Type has been created successfully."**
- Message pattern: `<Entity> has been created successfully.`
- The drawer closes automatically on success and the grid refreshes.

### Validation
- **Inline red text under the field** appears on some forms, e.g. "Warehouse is required." under the LP Type warehouse dropdown after Next is clicked with the field empty.
- On other forms the primary button simply stays disabled until the form is valid. Examples: Mobile Cart Next, Mobile Cart Type Save, Return Reason Save, SO Type Create, Order Merge Rule Create, Packing Warning Create, Custom Carrier Next.

### Yes/No segmented toggle
- Markup: `.lw-toggle-option` with `true-option` / `false-option`; the selected option has `active`.
- Most defaults are **No**.

### Status pills (computed colors)

| Pill | Background | Text |
|---|---|---|
| Available (mobile cart) | rgba(40,181,115,0.24) | rgb(40,181,115) |
| Occupied (mobile cart) | rgba(237,99,74,0.24) | rgb(237,99,74) |

- Active pills follow the same green recipe: a 24%-alpha background with the solid color as text.

### Kendo switch
- Used for Active on Damage Reasons and for the Return Parameters.
- The switch shows ON/OFF labels inside the track.

### Change Log drawer
- Title: "<Entity> Change Log".
- Columns: TYPE | MESSAGE | OPERATION DATE | SOURCE.
- Example row: `Create | MLT1 - Test Warehouse -> Warehouse is created. | 10/16/2026 11:19:06 AM | mike@team-01.com`.
- Footer: Show 100 items, pager, Total: 1.

### Custom Fields sub-drawer
- Reached from the "Other Info" step of LP Types and Shipment Packages via "Add/Edit Custom Field".
- Title: "Create Custom Field".
- Fields:
  - Custom Field Type* (Text Box / Drop Down / Date Picker / Toggle)
  - Custom Field Name*
  - Is Active (Yes/No)
- Buttons: "+ Add More Custom Field" (disabled until the row is valid), Cancel, **Add To Form**.

### Import page pattern
- Example: `/wms/import/lp-number/8`.
- Title "Import LP Number", with the helper "You can bulk import lp number by using an Excel file. Excel file import history will be listed below…".
- A "‹ Go back to lp number" link.
- A card "Download our excel template" with a Download button.
- A dropzone "Drop files here to upload / Drag your files here or click here".
- A history grid: STATUS | MASTER ROW COUNT | SUCCESS COUNT | ERROR COUNT | UPLOADED BY | CREATED DATE TIME | ACTIONS (empty state "No records to display").

---

## Help Center panel (NEW vs spec)
- The "?" icon now opens an **in-app overlay panel** titled "Help". It no longer opens a new tab directly.
- The panel starts with a hero link "**Help Center** – Everything you need to know about Logiwa." pointing to `intercom.help/mylogiwa/en`.
- Below it is "Main Articles (8)". Each item is a title plus a one-line description, linking to an Intercom collection:
  - Process Manuals: "Everything you need to learn about how Logiwa handles inventory."
  - Reports: "See explanations for the main inventory management reports."
  - Integrations: "We explain marketplace, e-commerce, and shipping integrations."
  - Workflow Rules (Automation Rules): "Learn about how you can use workflows in Logiwa."
  - Client Management: "A resource for 3PL companies using Logiwa."
  - Setup: "Setup warehouse, location, product, master data definitions, and shipment packages."
  - Release Notes: "Keep up with the release features, updates, and fixes."
  - Account Management: "Learn about how you can manage your account"
- Footer link: Privacy Policy.
- A floating vertical tab "Feedback & Updates" (birdie widget) is pinned to the right edge of every page.

---

## Warehouse — `/en/wms/warehouse/list`
- The header copy has two help paragraphs with links: "On the Warehouse screen, you can edit or create a warehouse. Before creating a new warehouse, we highly suggest you to read this document: Create a Warehouse." and "To learn how to define locations… Create a Location."
- CTA: **Create Warehouse**.
- Toolbar: search-mode selector, "Search by code", and Filter.
- Grid: WAREHOUSE CODE (link) | ADDRESS (a single concatenated line `2908 SE I St Ste 2,Bentonville,72712,US,`) | CONTACT | TYPE (Internal) | •••.
- Rows: MLT1 - Test Warehouse; Team 1 Supplier Service.

### Warehouse drawer (Create and Edit): tabs **Information | Settings**

**Information tab**

| Field | Control | Notes |
|---|---|---|
| Code* | text | — |
| Prefix | text | e.g. `MLT1`; used for location and code prefixes |
| Address line 1* | text | counter `18 / 250` |
| Address line 2 | text | counter `0 / 250` |
| Postal Code* | text | — |
| City* | text | — |
| Country* | dropdown | United States of America |
| State* | dropdown | dependent on Country (Arkansas). Defect: one placeholder leaks raw HTML `<span alt="Form.Region">Region*</span>` |
| Contact name* | text | — |
| Contact Phone Number* | text | — |
| Email | text | — |

- **Day Shift** section, "Enter working hours to track daily productivity.":
  - Start Time* (time `08:00`) with Day Zone* (AM/PM)
  - End Time* (time `05:00`) with Day Zone* (PM)
  - These feed the Dashboard "Progress for Today" Day Shift bar.
- Footer: Cancel / **Next**.

**Settings tab**
- **Measurement Settings**:
  - Default dimension unit* (Inch / Foot / Centimeter / Meter)
  - Default weight unit* (Pound / Ounce / Kilogram / Gram)
  - Use LP Dimensions for Volumetric Putaway Yes/No (currently Yes)
- **Default Locations**:
  - Default receiving location (`MLT1-RECV`)
  - Default ship location (`MLT1-SHIP`)
  - Both are location pickers.
- **Inventory Adjustment Settings**:
  - Mandatory Reason for Manual Adjustments Yes/No (Yes)
  - Mandatory Reason for Cycle Count Updates Yes/No (Yes)
- **Security**:
  - Checkbox "Automatically log out mobile users after a period of inactivity." (unchecked).
  - Checking it reveals **Inactivity Timeout* (Min)** (number).
- Footer: Back / **Save**.

---

## Mobile Carts — `/en/wms/mobilecart/list`
- Helper "You can edit or create a Mobile Cart here". CTA **Create Mobile Cart**.
- Toolbar: Filter; bulk **Label** and **Delete**.
- Grid: ☐ | CART CODE | CART DESCRIPTION | WAREHOUSE | STATUS (pill: Available green / Occupied red-orange) | NUM. OF CELLS | NUM. OF LEVELS | NUM. OF COLUMNS | NUM. OF TASKS | JOB CODE | NUM. OF ORDERS | OPERATION TYPE (Picking) | ALLOW MULTIPLE JOB (No) | •••.

### Create Mobile Cart drawer: steps **1.Mobile Cart | 2.Cell List**

**Step 1**
- Code* (text)
- Select Warehouse* (MLT1 / Team 1)
- Description
- Mobile Cart Type (dropdown filtered by warehouse)
  - It is effectively required: the form stays invalid without it.
  - MLT1 has **no cart types**, so the list shows "NO DATA FOUND" and Next stays disabled. The type must first be created in Data Setup › Mobile Cart Type.
- Once a type is chosen, a read-only summary appears: "Mobile Cart Type : Picking Cart 1", Number of Levels 4, Number of Columns 6, Mobile Cart Dimensions (HxLxW) `55x36x25in`, Cell Dimensions (HxLxW) `11x8.25x15in`.

**Step 2, Cell List**
- An auto-generated, read-only grid: CELL NAME | COLUMN | LEVEL | SUGGESTION SEQUENCE | DISPLAY NAME | CELL COLOR.
- Cell names follow `<Cart>_<col>_<level>`, e.g. `Cart 1_1_1`.
- The sequence runs column-first within each level.
- Colors cycle Orange, Green, Red, Blue, Pink, Light Blue, Purple.
- Footer: Back / Save.

---

## LP Types — `/en/wms/lp-types/list`
- Helper "Packages (LP Types) are used for custom shipment packages. You'll be able to use them when getting labels or at the packing station. Learn more about LP types here."
- CTA **Add New LP Type**. Page tabs **LP TYPES | LP NUMBERS**.
- Toolbar: Filter; bulk Delete.
- Grid (21 columns): ☐ | CODE | DESCRIPTION | WAREHOUSE | NUMBER PREFIX | NUMBER LENGTH | LENGTH | WIDTH | HEIGHT | DIMENSION UNIT | EMPTY WEIGHT | MAX WEIGHT | WEIGHT UNIT | IS PREVENT MULTI CLIENT | IS PREVENT MULTI EXPIRY DATE | IS PREVENT MULTI JOB | IS PREVENT MULTI LOT BATCH NUMBER | IS PREVENT MULTI ORDER | IS PREVENT MULTI SKU | SSCC18 | SUITABLE FOR PARENT LP | IS USE FOR AI JOB | •••.

### Add & Edit LP Type drawer: **1.General | 2.Parameters | 3.Other Info**

**1. General**

| Field | Control | Default / options |
|---|---|---|
| Warehouse* | dropdown | — |
| Code* | text | — |
| Number length* | numeric | default 1 |
| Number prefix* | text | — |
| Description | text | — |
| Length / Width / Height | numeric | 0.00 |
| Dimension Unit* | dropdown | Inch (Inch/Foot/Centimeter/Meter) |
| Weight Unit* | dropdown | Ounce (Pound/Ounce/Kilogram/Gram) |
| Empty Weight | numeric | 0.00 |
| Max Weight | numeric | 0.00 |
| Volume Unit* | dropdown | Cubic Inch (Cubic Inch/Cubic Meter/Cubic Foot/Liter/Gallon/Cubic Centimeter) |
| Max Volume | numeric | — |

- Clicking Next with the form empty shows "Warehouse is required." in red under the dropdown.

**2. Parameters**
- Nine Yes/No toggles, all defaulting to No:
  - Only 1 Expiry Date
  - Only 1 Production Date
  - Only 1 Lot Batch Number
  - Only 1 SKU
  - Only 1 Client
  - Only 1 Order
  - Only 1 Job
  - Suitable for Parent LP
  - Use For AI Job

**3. Other Info**
- Copy: "You can optionally add or edit custom fields under "Other Info" tab".
- Button **Add/Edit Custom Field** opens the Custom Field sub-drawer.
- Footer: Back / **Finish**.
- On save: toast "Success / LP Type has been created successfully." The drawer closes and the new row appears at the top.

---

## LP Numbers — `/en/wms/lp-numbers/list`
- Breadcrumb `Home > Settings > Packages LP Numbers`.
- Helper "You can create new or edit existing license plates (LP Numbers) on this page".
- Buttons: **Import LP Number** (secondary) and **Create LP Number** (primary).
- Toolbar: Filter; bulk **Print Barcode**.
- Grid: NUMBER | WAREHOUSE | LP TYPE | LOCATION | LENGTH | WIDTH | HEIGHT | WEIGHT | ACTUAL VOLUME | PARENT LP TYPE | PARENT LP NUM. | ORIGINAL LP NUMBER | ALTERNATE BARCODE | IS SSCC18 (raw `false`, a Logiwa defect: it should be a Yes/No pill) | •••.
- Rows:
  - `KST-00001` / `KST-00002` (KS-TEST-TOTE, MLT1-RECV)
  - `PT-0117…PT-0154` (Picking Tote, PrimaryLoc)
- The number is the prefix plus a zero-padded sequence of the LP type's Number Length.

### Create LP Number drawer (single page)
- Warehouse*
- LP Type* (options are labelled `<code> (<warehouse prefix>)`, e.g. "KS-TEST-TOTE (MLT1)", filtered by warehouse)
- Location (search dropdown)
- **LP Number Creation Settings**, LP Number Creation Method radio:
  - **From Sequence** (default): shows LP Number Count (numeric, default 1), Created as SSCC18 (radio No/Yes, default No) and Client (dropdown).
  - **Custom Numbers**: replaces those fields with LP Number* (text) and Alternate Barcode (text).
- Footer: Cancel / Save.

---

## Shipment Packages — `/en/wms/shipmentpackage/list`
- Helper "Create and list shipment packages you will use for shipping orders". CTA **Create Shipment Package**.
- Grid: CODE | DESCRIPTION | WAREHOUSE | TRACK INVENTORY | INVENTORY REDUCTION LOCATION | LENGTH | WIDTH | HEIGHT | DIMENSION UNIT | EMPTY WEIGHT | MAX WEIGHT | WEIGHT UNIT | MAX VOLUME | VOLUME UNIT ID | ACTIVE? | •••.

### Create drawer: **1.General | 2.Client Access | 3.Inv. Tracking | 4.Other Info**

**1. General**
- Warehouse*, Code*, Description
- Weight Unit* (Pound default), Empty Weight, Max Weight
- Dimension Unit* (Inch), Length*, Width*, Height*
- Volume Unit (Cubic Inch), Max Volume
- **Currency*** (18 options: AUD, CAD, EUR, INR, IDR, MYR, MXN, MAD, NZD, NGN, PKR, PHP, GBP, SGD, THB, TRY, USD default, XOF), each displayed as "U.S. Dollar (USD) $"
- **Purchase Price** (0.00)
- Active? Yes/No (Yes)

**2. Client Access**
- Radio cards:
  - "All Clients — Give access to this shipment package to all existing and future clients." (default)
  - "Select Manually — List all clients to manually select shipment package access."
- Choosing Select Manually shows bulk buttons **Disable / Enable** and a grid ☐ CLIENT | ACCESS ("Disabled" for all 31 clients by default).

**3. Inv. Tracking**
- Enable Inventory Tracking Yes/No (No). Yes reveals:
  - Inventory Owner* (Client dropdown; "Client is required." shown in red)
  - Inventory Tracking Method (Matched SKU)* radio: Auto-create new SKU / Match with an existing SKU
  - Inventory Reduction Location* (Packing Station / Specific Location / Any Location)

**4. Other Info**
- Custom Fields; footer Back / Finish.

---

## Data Setup — `/en/account/settings/datasetup/<slug>`
- Uses the account-module header (Search and User only).
- A right-side sub-nav lists the 18 lookups. Live contents:

| Slug | Page title / CTA | Grid / content (live data) | Create drawer fields |
|---|---|---|---|
| code-generation | Auto Code Generation Preferences | Radio "Auto Generate Order Codes As" / "Keep Adding Codes Manually Each Time"; Prefix* `SO`, Code* `0009`; Save | — |
| purchase-order-type | **Create New PO Type** | NAME: Transfer Order, Purchase Order- Non Crossdock, Return Order, Open Order, Purchase Order | — |
| shipment-order-type | **Create New Shipment Order Type** | NAME: Partial Allocation D2C, BackOrder D2C, B2B Order, D2C Order | SO Type Name* plus 4 accordion sections of Yes/No toggles (all default No); see below |
| order-merge-rule | **Create Order Merge Rule** | ORDER MERGE RULE NAME: Order Merge Default | See below |
| work-order-type | Create New Work Order Type | NAME (it was still showing "Loading" at capture time) | — |
| damaged-reasons | **Create New Damage Reasons** | **2-column card grid**, not a table. Each card shows the name and an Active kendo-switch (ON): Missing, Quarantined, Extra, Leaking, Bad Packaging, OnHold, Broken, Damaged | "Create Damage Reason": Damage Reason* (text), Cancel/Save |
| pack-types | Create New Product Pack Type | PACK TYPE NAME: Unit, Case, Each, Pallet | — |
| product-types | Create New Product Type | NAME: Kit, Packaging | — |
| product-groups | Create New Product Group | NAME (empty: "No records to display") | — |
| location-group | Create New Location Group | NAME / WAREHOUSE / STATUS (empty) | — |
| location-zone | **Create New Location Zone** plus **Match With Product Groups** (disabled while there are no zones) | NAME / WAREHOUSE (sorted asc) / PRIORITY / MAX LOC. PER SKU / STATUS; Filter | Warehouse*, Location Zone Code*, Location Zone Name*, Zone Priority (num), Max Location per SKU (num), Status Active/Passive |
| vas-type | Create New VAS Type | unchanged vs spec | unchanged |
| mobile-cart-type | **Create Mobile Cart Type** | MOBILE CART TYPE CODE / WAREHOUSE / NUMBER OF LEVELS / NUMBER OF COLUMNS / OPERATION TYPE / ALLOW MULTIPLE JOB: Picking Cart 1 (4x6), Multiple Items Cart 1 (4x2), TEST Mobile Cart (2x5) | See below |
| packing-warning-type | **Create Packing Warning Type** | WARNING TYPE NAME / SHOW WARNING WHEN (empty) | Warning Type Name*, Warning Type Description, Packing Warning Text* (textarea, `0 / 1000`), Show Warning When* (Order is Displayed on Packing / Close Pack is Triggered / Product is Scanned), Skip Confirmation from Packer Yes/No (No), Upload Media: Image (file upload) + Media Link (text + Add); Cancel/**Create** (disabled until valid) |
| custom-carrier | "Custom Carriers", helper "Logiwa allows you to create carrier connections that are not pre-built in Logiwa", CTA **Create New** | CARRIER CODE / CARRIER NAME / LOGO / SERVICE QTY / PACKAGE QTY (empty) | 4-step wizard; see below |
| return-process | RMA Code Generation Preferences + Return Parameters + Return Reasons | See below | Return Reason drawer |
| inventory-adjustment-reason | Create Inv. Adj. Reason | INVENTORY ADJUSTMENT REASON: Inventory is missing, Inventory quantity discrepancy, Classic Migration | — |
| shipment-order-cancel-reason | Create New Cancel Reason | NAME / STATUS (empty) | — |

### Shipment Order Type drawer
- Field: **SO Type Name*** (placeholder "Enter SO type name").
- Below it are four collapsible section headers (`shipment-order-type-form__section-header` buttons). Each one expands its toggles, and all toggles default to No:
  - **Order Creation & Allocation**: Allow Order Being In Multiple Locations or LPNs · Create Back Order · Allow Partial Allocation · Validate Allocation Cancellation · Auto Generate Order Code via Excel Import
  - **Picking**: Allow LP Swap On Picking · Allow Lot Number Swap On Picking · Allow Expiry Date Swap On Picking · Allow Production Date Swap On Picking
  - **Packing**: Enable Partial Order Packing · Override Serial Number Scanning on Packing · Enable Individual Package Processing · Enable "Scan-to-Close" on Higher Pack Types · Auto-Print UCC Labels
  - **Shipping**: Allow Shipment Without Label · Allow Partial Shipment · Auto Create Loading Task After Unloading
- Footer: Cancel / **Create** (disabled until a name is entered).

### Order Merge Rule drawer
- Order Merge Rule Name* (text)
- Warehouse* (dropdown)
- **Merging Conditions**: "Orders will only merge if the selected fields are identical across all shipments."
  - Default Conditions (checked and **disabled**): Client, Customer Name, Channel, Shipping Address.
  - Additional Conditions (unchecked): Carrier, Shipping Option, Order Priority, Planned Delivery Date, Expected Shipment Date, Order Date, Order Tag, Retailer.
- **Data Inheritance**: "Select which order provides the metadata for the new Master Order." Radio cards:
  - Oldest Original Order (default): "Inherits fields from the first order created in the system."
  - Newest Original Order: "Inherits fields from the most recently created order."
  - Clean State: "Creates the merge order with empty metadata."
- Footer: Cancel / **Create**.

### Mobile Cart Type drawer
- Mobile Cart Type Code*, Warehouse*, Mobile Cart Type Description
- Number of Levels*, Number of Columns*
- Dimension Unit (Inch), Volume Unit (Cubic Inch)
- Operation Type* (Picking)
- Allow Multiple Jobs Yes/No (No)
- **Mobile Cart Dimensions**: Mobile Cart Height / Length / Width
- **Cell Dimensions**, with a Tip box: "To enhance AI job optimization accuracy, please ensure the cell dimensions are filled out correctly." Fields: Cell Height / Length / Width / Volume
- Footer: Cancel / Save (disabled until valid).

### Custom Carrier wizard: **1.General | 2.Services | 3.Package | 4.Advanced**
1. **General**: Carrier Code*, Carrier Name*, Logo URL. Next is disabled until both required fields are filled.
2. **Services**: "Shipping Services — Every custom carrier has their own shipping services and you can create and manage them below". Inline Service Code + Service Name + **Add**, then a grid OPTION CODE | OPTION NAME | ••• ("No records to display").
3. **Package**: "Carrier Packages — Every custom carrier has their own shipment package types…". Package Code + Package Name + Add, then a grid PACKAGE CODE | PACKAGE NAME.
4. **Advanced**: three inline-add lists, each with its own text input + Add:
   - Confirmation Types: "…(such as signature-required, adult signature, etc.)"
   - Insurance Types
   - Billing Types: "(i.e., Sender, Recipient, Third-Party, Collect)"

   Footer: Back / **Save**.

### Return Process page (single page with a Save button)
- **RMA Code Generation Preferences**: "Automate RMA codes to simplify your RMA traceability…". Prefix*, Code.
- **Return Parameters**: "Customize your return procedures with unique features." Kendo switches, all ON:
  - Expiry Date Match ("Return only the shipped expiry date.")
  - Production Date Match
  - Lot Batch Number Match
  - Serial Number Match
  - Pack Type Match
  - Prevent Unspecified SKU Returns ("Return only shipped SKUs.")
  - Prevent Exceeding Shipped Quantity
  - Enable Returns To Alternate Warehouses ("Allow returns to a warehouse different from the shipped warehouse.")
- **Return Reasons**: "Create customer/actual return reasons for receiving returns and RMA creation." **Add New** button.
  - Grid: RETURN REASON | CUSTOMER REASON | ACTUAL REASON | STATUS. Rows: Broken Yes Yes Active; Damaged Yes Yes Active.
  - The "Create New Return Reason" drawer has:
    - Name*
    - Use as a Customer Reason Yes/No (Yes)
    - Use as an Actual Reason Yes/No (Yes)
    - Active Yes/No (Yes)
    - Link with a Damage Reason Yes/No (No). Choosing Yes requires **Linked Damage Reason*** (dropdown of Damage Reasons).
    - Save is disabled until valid.

---

## Algorithms
- The type splash is unchanged: `/algorithm/type` shows "Select Algorithm Type / Select an algorithm type to build your own algorithm." with two buttons, Putaway Algorithm and Allocation Algorithm.
- List `/algorithm/allocation`:
  - Breadcrumb `Home > Settings > Algorithms`. Helper "You can view a list of your algorithms and create new ones here." CTA **Create Allocation Algorithm**.
  - Tabs PUTAWAY ALGORITHM / ALLOCATION ALGORITHM.
  - Grid NAME | TYPE NAME | WAREHOUSE | ACTIVE (pill) | RULE QUANTITY | •••.
  - Rows: D2C Default, B2B Default, Test 2, test, test2 (Team 1); **Default (MLT1)**.
- The rule-builder details are unchanged vs 06-automation-integrations.md §3–4.

## Workflows
- `/en/wms/workflow` is still not accessible: it redirects to sign-in, then to the dashboard.
- The builder spec must come from public docs. The Help panel links a "Workflow Rules (Automation Rules)" collection (intercom collection 2634189).

## Wave Rules (Automation menu) — `/en/wms/job/wave-rules`
- CTA **Create A New Wave Rule**. Bulk **Run** (disabled until a row is selected).
- Grid: WAVE RULE NAME | WAREHOUSE | SCHEDULED (Yes/No) | STATUS (Pending) | PRIORITY (High) | ASSIGNEE | OPERATION TYPE (Picking / Order Merge / Replenishment / Count) | LAST EXECUTED BY ("Auto Run" or a user name) | LAST RUN | LAST WAVE ID (`20697-7`) | NEXT RUN (a countdown such as `10:37:06`; Logiwa defect: one shows `1102:12:58:04`).
- The detail wizard is covered in 02-fulfillment-ops.md.

## Integrations
- Unchanged vs 06-automation-integrations.md §7–17 (the menu links were re-verified live).

## Company Settings
- Unchanged. "Account defaults" `/en/account/settings` still bounces back to `/company/basic`.

---

## Delta vs existing spec

1. **Help is now an in-app panel** with 8 categorized article links and a Privacy Policy link. The spec said "opens Intercom in a new tab".
2. **Account-module pages have a reduced header** (Search and User only). This was not noted in the spec.
3. **"Feedback & Updates"** is a vertical side tab on every page (new).
4. **Warehouse drawer fully captured**: Information and Settings tabs, Day Shift times, measurement defaults, default receive/ship locations, mandatory adjustment reasons, and the mobile inactivity auto-logout timeout. This was new; the spec had only a screenshot.
5. **Mobile Carts list and 2-step wizard**, including cell auto-generation (naming, sequence, color cycle) and the Available/Occupied pill colors. New.
6. **LP Types 3-step wizard** with every field, unit option list, the 9 parameter toggles and Finish. **LP Numbers** create (sequence vs custom, SSCC18, client) and the import page. New.
7. **Shipment Package wizard**: the Currency and Purchase Price fields and the Inv. Tracking reveal fields were confirmed. Mostly consistent with 05-master-data.md.
8. **Data Setup**: full create-drawer specs for SO Type (19 behaviour toggles in 4 accordions), Order Merge Rule (default and additional conditions plus data inheritance), Damage Reason (card grid with switches), Location Zone, Mobile Cart Type, Packing Warning Type (trigger options and media), Custom Carrier (4 steps) and Return Process (8 switches and Return Reason drawer). New.
9. **Toast copy and structure confirmed**: "Success / <Entity> has been created successfully."
10. **Inline validation exists** in some places ("Warehouse is required.", "Client is required."). The spec said Logiwa shows no text messages; that is now corrected to "inconsistent".
11. Kebab menus are per entity (see the table above). LP Numbers have no Delete. Mobile Carts and Shipment Packages have no Change Log.
12. **Show Details opens the editable drawer** (a Logiwa defect). Other defects: the raw HTML placeholder on Warehouse State, the code-generation breadcrumb, the IS SSCC18 column showing raw `false`, and the wave-rule countdown overflow.
13. Workflows remain inaccessible; there is no change.
