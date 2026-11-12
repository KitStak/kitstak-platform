# Logiwa iO — Automation & Integrations (cluster 06)

Captured 2026-11-05 from the my.logiwa.com sandbox (warehouse scope MLT1 - Test Warehouse). Integration records in the sandbox all belong to "Team 1 Supplier Service". I only read them and saved nothing.
Logiwa UI stack: Angular, Kendo dropdowns/grids, Ant Design drawers and modals. The top nav is a mega-menu.

## 0. Navigation (mega-menu) for this cluster

**Automation** menu (one column, header "Workflows & Algorithms" with an icon):
- Algorithms → `/en/wms/algorithm` (redirects to `/en/wms/algorithm/type`)
- Workflows → `/en/wms/workflow`
- Rate Shopping → `/en/wms/rate-shopping-presets` (redirects to `/rate-shopping-presets/list`)
- Wave Rules → `/en/wms/job/wave-rules` (belongs to the Jobs/Fulfillment cluster; a short note is in section 17)

**Integrations** menu (multi-column submenu `integrations-layout`):
- **Plugin Integrations**: Channel Integrations (`/integration/list/1`), Carrier Integrations (`/integration/list/2`)
- **Channel Logs**: Channel Methods (`/integration/analytics/integration-status`), Channel History (`/integration/analytics/integration-history`), Orders and Shipments (`/integration/analytics/order-shipments`), Products and Inventory (`/integration/analytics/products-inventory`)
- **Channel Monitoring**: Channel Health Overview, Channel Setup Details, Missing Shipment Orders, Recent Errors, Workflow Blocked Shipment Orders, Product Listing Exceptions (all under `/integration-monitoring/...`)
- **Carrier Monitoring**: Carrier Errors (`/carrier-monitoring/carrier-errors`, redirects to `/label-generation`)
- An extra link labelled "Integration Log" also points to `/integration/analytics/integration-history`. It sits in another menu, probably Reports.

Header utility icons on every page: Search pill, video/help, background-tasks (tooltip: "View the progress and status of your background tasks. Completed transactions are cleared daily."), print, help (?), user.

### Common list-grid conventions (used on almost every page below)
- **Page header**: breadcrumb (`Home > Section > Page`), H1 title, centered grey helper text, primary CTA top-right (blue filled).
- **Toolbar**: a search box with a leading "≡ ⌄" mode button. That button opens a **Search Content** popover with radio **Equal / Starts With** and an **Apply** button. Next to it are a magnifier button and a **Filter ⌄** button. Bulk-action buttons sit on the right and stay disabled until a row is selected (e.g. Delete, Test Algorithm, Retry Download, Run). Some grids also have a refresh icon button.
- **Filter panel** (dropdown under the Filter button): title "Select Filter Type", a segmented **New | Saved** control (Saved = saved filter sets), a "Search Filter" input, and a list of filterable fields. Each field row has a bookmark icon (save) and a "+" icon. Clicking + opens a field editor with a back arrow, the field name, an operator/value UI, and a blue **Add Filter** button.
  - Text operators: `equals, contains, starts with, ends with, exclude, empty`.
  - Enum fields: a checkbox list of values.
  - Date fields: a preset dropdown (`Custom, Today, Last 3 days, Last 7 days, Last 30 days, Last 90 days, Last 12 months, X Day(s) Ahead and More, X Day(s) Before and More, Within X Day(s) Past, Within X Next Day(s), Sunday … Saturday`). Custom shows **From** / **To** datetime pickers, defaulting to today 00:00 and 23:59, in the format `2026/11/05 00:00`.
- **Footer**: density toggle **Large | Small** (on some grids), a page-size dropdown "Show 100 items" with options `100, 300, 500, 700, 1000`, a pager (`|< < [n] / N > >|`), a green **Export As Excel** button (on some grids), and "Total: N" on the right.
- **Row actions**: a "•••" button at the right end of each row opens a small floating menu.
- **Column chooser**: a gear icon at the right end of the header row (tooltip "Columns"). It opens a popover listing columns plus an **Apply** button.
- **Status pills**: Active = green-tint pill with green text; Inactive/Passive = grey pill; Yes = green pill; No = grey pill; Completed = solid green; Test = purple pill.
- **Required fields**: a `*` after the label. Invalid required fields get a red border on Next/Save, with no message text. On Create wizards the **Next** button stays disabled until the required fields are filled.

---

## 1. Algorithm Type picker — `/en/wms/algorithm/type`
- Title: "Algorithm Type - Logiwa". A full-page illustration (circuit lines and a laptop).
- H1 "Select Algorithm Type". Helper: "Select an algorithm type to build your own algorithm."
- Two large buttons:
  - **Putaway Algorithm** (green) → `/algorithm/putaway`
  - **Allocation Algorithm** (purple) → `/algorithm/allocation`

## 2. Algorithms list — `/en/wms/algorithm/putaway` and `/en/wms/algorithm/allocation`
- Title "Putaway Algorithms - Logiwa" / "Allocation Algorithms - Logiwa". Breadcrumb `Home > Settings > Algorithms`. H1 "Algorithms". Helper "You can view a list of your algorithms and create new ones here."
- Tabs (underlined): **PUTAWAY ALGORITHM | ALLOCATION ALGORITHM**. Each tab has its own route.
- Primary CTA: **Create Putaway Algorithm** or **Create Allocation Algorithm**, depending on the tab.
- Toolbar: search "Search by name" with the Equal/Starts With mode, then **Filter**.
  - On the Putaway tab, the bulk buttons **Delete** and **Test Algorithm** are disabled until a row is selected.
  - The Allocation tab has no bulk buttons.
- Filter fields: **Name** (text operators) and **Warehouse**.
- Columns: [checkbox] | NAME (blue link, truncated with ellipsis) | TYPE NAME (e.g. "Putaway"; blank for allocation) | WAREHOUSE | ACTIVE (pill Active/Inactive) | RULE QUANTITY (blank in the sandbox) | •••
- Row ••• menu: **Delete** only.
- Clicking the row or the name opens the edit page.
- Footer: Large/Small, Show 100 items, pager, Total.
- Sample data (MLT1):
  - Putaway: `REPLENISHMENT_ALGORITHM` (MLT1, Active) and `SAME_SKU_EMPTY_LOCATION_ALGORITHM` (MLT1, Active).
  - Allocation: `Default` (MLT1, Active).
  - Other warehouses had D2C Default, B2B Default, test, AfternoonTest, and so on.
- **Business rule** (from the edit page): each warehouse comes seeded with a REPLENISHMENT_ALGORITHM and a SAME_SKU_EMPTY_LOCATION_ALGORITHM putaway algorithm and a "Default" allocation algorithm.

## 3. Putaway Algorithm create/edit — `/algorithm/create/putaway`, `/algorithm/edit/putaway/{uuid}`
Layout: a left panel about 260px wide with a two-step segmented control, and a right **visual rule canvas** (dotted grid, pannable, zoomable, with a minimap button and a "− 100% +" zoom control at bottom-right).
Breadcrumb `Home > Settings > Algorithms > Algorithm Details`. H1 "Create Algorithm" or "Edit Algorithm".

**Step 1 "Primary Information"**:
- Algorithm name* (text, placeholder "Enter algorithm name")
- Warehouse* (dropdown, placeholder "Select warehouse"; options = the user's warehouses)
- Algorithm Status: segmented **Active | Passive** (default Active)
- Checkbox "Use this algorithm as **dynamic replenishment algorithm**."
- Checkbox "**Enforce suggested locations** on mobile directed putaway." (has an info tooltip)
- Info box shown on replenishment algorithms: "At least one replenishment algorithm must be active, so you cannot change the 'Algorithm Status' and 'Dynamic Replenishment Algorithm' options here. When you create or select a new algorithm for dynamic replenishment, this algorithm becomes passive. Algorithms used for dynamic replenishment are exclusive and cannot be used for putaway. Create or select a separate algorithm for putaway if needed." On that algorithm the checkbox is checked and disabled.
- Footer buttons:
  - Create mode: **Test Algorithm** (full width, disabled until valid), then **Cancel** and **Next**. Next stays disabled until the name and warehouse are filled.
  - Edit mode: **Test Algorithm**, then **Cancel** and **Save**.
- Empty canvas text: "Press 'Create New' button to Create a Rule. Select Rule to View Details."

**Step 2 "Rules"**:
- "Rule List" with helper "List of all the rules to be defined for this putaway algorithm" and a **Create New** (outline) button.
- Rules show as an ordered **If / 1. If else / 2. If else …** chain. Each rule row has a label chip on the left ("If", "1. If else"), a checkbox, the rule name, and a drag handle (≡) for reordering. A trash icon appears when the row is selected.
- A hint card below the list: "You can create a new if else rule with the Create New button." (with an info icon).
- Selecting a rule renders it on the canvas as a tree:
  - **Rule Name** node (text)
  - **Condition** section (info icon): condition nodes with edit (pencil) and delete (x). "+" buttons sit left and right of each node to add siblings. Example: "If Replenishment Type in Source".
  - **Action** section: action nodes joined by **AND**. Example: "Suggest a location that has the same SKU" AND "Suggest a location with the selected replenishment type in Target".
  - **Order By** section: order nodes joined by **THEN**. Example: "Asc - Walking Path Priority".
  - Canvas footer buttons: **Cancel Rule**, **Test Rule**, **Save Rule**.
- Sample MLT1 rules:
  - `If` "Replenishment Suggest Same SKU": Condition Replenishment Type in Source; Actions same SKU AND replenishment type in Target; Order By Asc Walking Path Priority.
  - `1. If else` "Replenishment Suggest Empty Location".

**Add Condition modal** (title "Add Condition", close x):
- Segmented **Apply To All | Specify Condition**. Apply To All creates an "Applied to all" condition.
- Specify Condition shows these fields:
  - `If*` dropdown with the following options: ABC Code, Aisle, Allocated Transfer Quantity, Area Type, Client, Column, Damage Reason, Expiry Date, Height, Is Prevent Allocation, Is Receiving Process, Length, Level, Location, Location Custom Field Date Picker 1-3, Location Custom Field Dropdown 1-2, Location Custom Field Text Box 1-3, Location Custom Field Toggle 1-2, Location Group, Location Type, Location Zone, Lot Batch Number, LP Carrier, LP Type, LP Type Custom Field (Date Picker 1-3, Dropdown 1-2, Text Box 1-3, Toggle 1-2), Parent LP based transfer, Product Custom Field (Date Picker 1-3, Dropdown 1-2, Text Box 1-3, Toggle 1-2), Product Group, Product Pack Type, Product Type, Production Date, Purchase Price, Receiving Date, Replenishment Type, SKU, Transfer Quantity, Volume, Weight, Width.
  - `Comparator*`. Options depend on the field type:
    - Lookup/enum fields (Location Zone, Client, Area Type, Replenishment Type, etc.): `in | not in`, followed by a multi-select value field whose placeholder is the field name.
    - Numeric fields (Weight, Transfer Quantity, etc.): `is greater than | is less than | is between | equals`.
    - Text fields (SKU): `equals | contains | starts with | ends with | exclude | is empty | is not empty`.
    - Date fields (Expiry Date): `Today | is between | Last 3 Days | Last 7 Days | Last 30 Days | Last 90 Days | Last 12 Months | X Days Ahead and More | X Days Before and More | Within Next X Days | Within Past X Days | Monday … Sunday`.
    - Boolean fields (Is Prevent Allocation): `equals`.
  - **Add** button, disabled until the fields are complete.

**Add Action modal** ("Add Action", field labelled `If*`, which is a Logiwa labelling quirk). The action list is:
Check Assigned SKUs; Check Damaged Locations; Check Location Capacity; Check Location Capacity Type; Check Max Locations per SKU; Check Max Sku Count; Check Product Group&Location Zone Match; Check Same Client; Check Same Damaged Reason; Check Same Expiry Date; Check Same Lot Batch Number; Check Same Product Group; Check Same Product Type; Check the same Production Date; Check the same Receiving Date; Configure Volumetric Putaway; Suggest a location that has inventory of the same SKU & same pack type; …of the selected product group; …of the selected product type; …of this selected pack type; Suggest a location that has the same SKU; Suggest a location where the allocation is prevented; Suggest a location where the inventory sync to stores is prevented; Suggest a location with the entered aisle / column / height / length / level / volume / width; Suggest a location with the selected ABC Code / area type / location group / location type / location zone / replenishment type; Suggest an empty location; Suggest exactly the selected location.
Parameterised actions (selected X / entered Y) show a value field once chosen.

**Add Order By modal**:
- `Order By Method*`: Aisle, Allocated Quantity, Column, Level, Location Empty Volume, LP Count in Location, SKU Count in Location, Total Inventory Quantity, Walking Path Priority, Zone Priority
- `Sort Method*`: Ascending / Descending
- Button label "Add Action" (Logiwa copy bug)

**Test Algorithm modal** (title "Test Algorithm" with the algorithm name as subtitle). It has two tabs:
- **Product Putaway**: Client (dropdown "Select client"), Location* ("Search Location"), Product* ("Search Product"), and a **Search** button. Result grid columns: INVENTORY STATUS, PACK TYPE, CLIENT, LP NUMBER, LOT NO, EXP DATE, PRODUCTION DATE, RECEIVING DATE, PO NUMBER, DAMAGE REASON, ALLOCATED QTY, QTY. Empty state: "No records to display".
- **LP Putaway**: "Search and Select LP or Parent LP *" with inputs "Search LP" and "Search Parent LP", plus a Search button. Grid columns: WAREHOUSE, LOCATION, LP TYPE, LP NUMBER, PARENT LP TYPE, PARENT LP NUM.
- Footer: **Cancel**, **Test**. Test presumably returns the suggested putaway location from the rule chain.

## 4. Allocation Algorithm create/edit — `/algorithm/edit/allocation/{uuid}`
- H1 "Edit Allocation Algorithm". Step 1 has Algorithm name*, Warehouse*, and Algorithm Status Active/Passive. It has no replenishment checkboxes and no Test Algorithm button.
- Step 2 Rules: "List of all the rules to be defined for this allocation algorithm". The empty canvas reads "Press the '+' button to Create a Rule."
- Canvas sections for an allocation rule:
  1. **Rule Name**
  2. **Order Conditions** (which orders the rule applies to). Default: "Applied to all".
  3. **Inventory Conditions** (which stock/locations are eligible; joined by AND). Default rule: "If Inventory Damage Reason in Empty" AND "If Is Allow Only Damaged equals false".
  4. **Order By** (joined by THEN). Default: Asc Area Type → Asc Walking Path Priority → Asc Lot Batch Number → Asc Expiry Date (FEFO-ish).
- **Order Condition `If*` options**: Client, Order Type, Product Group, Planned Shipment Date, Shipment Order Date, Priority, Fraud, Store, Carrier, Shipment Method, Country, City, Sku, Order Tag, Order Quantity, Order Price, Carrier Rate, Is Back Order, Is Gift, Is Oversized, Expected Shipment Date, SO Custom Field TextBox 1-3, SO Custom Field DateTime 1-2, SO Custom Field Toggle 1-2, SO Custom Field DropDown 1-2, Product PackType, Is Partial, Retailer, Precartonization Type, Number of Boxes, Shipment Package.
- **Add Target Condition (Inventory) `Then*` options**: Location Group, Location Zone, Area Type, Is Prevent Inventory Sync, Is Allow Only Damaged, Is Prevent Multi Client, Assigned Client, ABC Code, Replenishment Type, Location Type, Level, Column, Aisle, Location, LP Number, Inventory Damage Reason, Inventory Lot Batch Number, Inventory Expiry Date, Inventory UOM Pack Type, Inventory Pack Type, Prioritize Same Pack Type, Prioritize Higher Pack Type, Location Custom Field TextBox 1-3 / DateTime 1-2 / Toggle 1-2 / DropDown 1-2, Inventory Production Date, Inventory Receiving Date, Only Allocate Full LPs.
- **Edit Order By modal**: Order By Method* (Aisle, Level, Column, Walking Path Priority, ABC Code, Area Type, Free Inventory, Lot Batch Number, Expiry Date, Production Date, Receiving Date), Sort Method* (Ascending | Descending), and a **Save Action** button.
- Canvas footer: **Cancel Rule**, **Save Rule**. Left footer: **Cancel**, **Save**.
- **Business logic**:
  - At allocation time, rules are evaluated in If / If-else order.
  - The first rule whose Order Conditions match is used.
  - Its Inventory Conditions filter the eligible inventory.
  - Its Order By keys decide which inventory is picked first.

## 5. Workflows — `/en/wms/workflow`
**COULD NOT ACCESS.** Every time, whether opened by direct URL or from the Automation > Workflows menu, the route redirected to `/en/public/signin` and then auto-returned to `/en/wms/dashboard`. The workflow builder appears to be a separately authenticated module (or the sandbox user lacks permission). I entered no credentials.
Indirect evidence from other pages:
- The **Workflow Blocked Shipment Orders** report (section 15) shows that workflows can **block shipment orders fully or partially** at import time.
- That report has columns Workflow Name and Action Name. Workflows therefore have a name plus actions, and one action type is "block order".
- The Channel Setup Details tooltip says the report "Displays all shipment orders stopped by an automation rule within the last two weeks."
- Build expectation (from public Logiwa iO docs, not verified here): a trigger event (e.g. Shipment Order Created/Imported), AND/OR conditions on order fields similar to the Allocation Order Condition list in section 4, and actions such as Block order, Set carrier/shipping option, Set priority, Add tag, and Set warehouse.

## 6. Rate Shopping Presets — `/en/wms/rate-shopping-presets/list`
- Breadcrumb `Home > Settings > Rate Shopping Presets`. H1 "Rate Shopping Presets". Helper "Rate shopping presets can be created, viewed and edited on this screen." CTA **Create Rate Shopping Preset**.
- Toolbar: "Search by name" with search mode, **Filter**, **Delete** (disabled until selection), and a refresh icon.
- Filter fields: Client, Name, Warehouse.
- Columns: [checkbox] | PRESET NAME (link; sortable) | RATE CALCULATION METHOD | DESCRIPTION | SHOW ERROR MESSAGES (Yes/No pill) | USE ALL AVAILABLE SERVICES (Yes/No pill) | STATUS (sortable; Active pill) | TRANSIT TIME | CLIENT (sortable) | WAREHOUSE (sortable) | •••
- Row •••: **Edit**, **Change Log**, **Delete**.
- Footer: Show 100 items, pager, **Export As Excel**, Total. The grid scrolls horizontally.
- Sample row: Cheapest | Cheapest | Cheapest | Yes | No | Active | 3 | testclient | Team 1 Supplier Service.

**Create / Edit Rate Shopping Preset** opens in a right-side **drawer** (about 290px wide, title with close x). It has three steps (numbered in Create, plain tabs in Edit):
1. **General**:
   - RS Preset Name* (placeholder "Enter RS preset name")
   - Description*
   - Warehouse* (dropdown: MLT1 - Test Warehouse, Team 1 Supplier Service)
   - Client* (dropdown of the warehouse's clients, e.g. Kitt Solutions Inc., Hoot Foods LLC, MLTest, Paqari, testclient, …; filtered by warehouse)
   - Active? segmented Active | InActive (default Active)
   - Warehouse and Client are locked in Edit mode.
2. **Settings**:
   - "Rate Calculation Method / Select rate calculation method*" as radio cards:
     - **Cheapest**: "The system will find the cheapest rate among available shipment methods"
     - **Fastest**: "The system will find the fastest transit time among available shipment options"
     - **Cheapest In Time**: "The system will find the cheapest rate considering the given transit time among available shipment methods". Selecting it reveals **Transit Time(Day)*** (number).
   - "Error Messages / Enable to receive error notifications for failed shipments." with a checkbox "Show error message if any shipment method returns an error."
3. **Shipment Methods**:
   - Checkbox "Use all available services." (with an info icon)
   - "Search by shipping option" input
   - **Bulk Actions ⌄** menu: Activate Selected, Deactivate Selected
   - Grid: [checkbox] SETUP NAME (link) | CARRIER | SHIPPING OPTION | SELECT (toggle switch)
   - Rows are every service from the carrier setups that the client can access. Example: UPS-TEST Logiwa / UPS / Worldwide Economy DDP, Worldwide Economy DDU, Worldwide Saver, Worldwide Express Plus, Worldwide Expedited, Worldwide Express, GroundSaver, 3 Day, 2nd Day AM, 2nd Day, Next Day Air Saver, Next Day Early, Next Day, Standard, Ground.
   - If the client has no carrier setup, the grid shows "No records to display".
- Drawer footer: **Back** and **Next**. On the last step Next becomes **Save**.
- **Business logic**:
  - At label/rate time, the preset rate-shops across the selected services and picks the result according to the chosen method.
  - The presets are referenced as the "Rate Shopping Name" column in carrier logs.

## 7. Integration Management — Plugin Integrations — `/en/wms/integration/list/1` (channels), `/list/2` (carriers)
- Breadcrumb `Home > Integrations > Plugin Integrations`. H1 "Integration Management". Helper: "Connect Logiwa to e-commerce stores or carriers to streamline your process. To learn more about how to integrate your stores to Logiwa, visit the Logiwa Integration Help Center." (the last phrase is a link)
- Page tabs: **PLUGIN INTEGRATIONS | CHANNEL LOGS**
- Left vertical category menu: **All | Channel Integrations | Carrier Integrations**. The selected category has a grey background.
- Right side: a 3-column grid of logo cards. Each card has the logo, a small Logiwa badge at top-right, and one of two states:
  - Connected: green check icon, "CONNECTED", and a link "Show N Integrated Channels", "Show Integration 1 Channel 1 Carrier", or "Show 1 Integrated Carrier".
  - Not connected: blue **Connect Now!** button.
- Channel cards (15): Shopify (connected, 4), ShipStation (connected), Amazon, WooCommerce, TikTok, Magento, Walmart, Loop Returns, QuickBooks Online, CartRover, Squarespace, Amazon FBA, eBay, Big Commerce, Etsy. A further "Fulfillment…" logo is partly visible at the bottom.
- Carrier cards (list/2): ShipStation (connected), UPS (connected, 1), Fedex, Stamps.com, EasyPost, Techship, Custom Carrier, Ehub, Shipium, eShipper, BUKU, Shippo, iDrive Logistics.

### 7a. Channel Connection List — `/en/wms/integration/connection/list/{channelTypeId}` (Shopify = 1)
- H1 "Shopify Connection List". Helper: "A list of your available connections with Shopify's connected store. From this page, you can create another Shopify connection or configure any existing connections. Learn more about integrations." CTA **Connect Store**. Back link "‹ Go back to integration list".
- Columns: STORE NAME (link) | CLIENT | WAREHOUSE | STATUS (Completed = green pill) | CONNECTION (Activated = green text) | •••
- Row •••: **Show Details**, **Edit**, **Change Log**, **Delete**.
- Sample rows: giftshoppers-usa/testclient, bcaq75-7z/Paqari, david-653/Foam, vroomtec/Bulletpoint Mounting Solutions. All are Team 1 Supplier Service, Completed, Activated.
- **Connect Store** drawer:
  - "Select App Distribution Type": **Custom App | Public App**
  - Public App: "Select the Logiwa client this Shopify store will connect to." Client*. Note: "You'll be redirected to Shopify in a new tab to approve the Logiwa app. Simply click Install — no additional information is required. After installing, return to this tab to continue the setup." Button **Connect to Shopify**. Footer note about the Shopify App Privacy Policy.
  - Custom App: "Your Shopify Store Name *" (counter 0/60), "Select Authorization Method" **Access Token | Client ID & Secret**, Access Token*, Client*, API Version **Rest API | GraphQL**, and a **Continue** button.
- **Edit Store Connection** drawer (tabs **General | Warehouse | Advanced | Configuration**):
  - General: Connection Store Name (Store Name), Client* (locked), Active Yes|No, API Version Rest API|GraphQL, link "Customize Authorization Method".
  - Warehouse: "Link Shopify Fulfillment Locations with Logiwa". Helper: "Logiwa can send fulfillment, sync inventory and retrieve orders based on their fulfillment locations on Shopify. To be able to set this up please match them." Two dropdowns (Shopify Location List, Warehouse) plus **Add**. Mapping grid columns SHOPIFY LOCATION | WAREHOUSE | delete. Example: Chicago Location → Team 1 Supplier Service; Atlanta Store → Team 1 Supplier Service.
  - Advanced:
    - Payment Status (n)* as a multi-select (e.g. Paid)
    - Tax ID Mapping (dropdown)
    - "Filter Order By Order Tag" ("Logiwa can filter orders based on their tag and download them into Logiwa.")
      - Select Filter Method: Included order tags | Excluded order tags
      - Filter Condition (e.g. "All Following Tags")
      - Order Tag input + **Add**
      - Grid ORDER TAG, with the empty state "No order tag has been added yet."
  - Configuration (collapsible sections):
    - **Products***: Download Products Yes|No; Product UOM* (Unit)
    - **Orders***: Download Orders Yes|No; Shipment Order Type* (D2C Order); Download Open Orders From (Specific Date + Date/Time, or Let Logiwa Create); Partial Orders Yes|No; Create Nonexistent Products When Orders Are Downloaded Yes|No; Skip Address Verification Yes|No
    - **Inventory**: Sync Inventory Yes|No; Inventory Sync Method On Hand | Available
    - **Shipments**: Send Shipment Info to My Store Yes|No
  - Footer: **Cancel** and **Save**.
- **Business logic**:
  - Each connection spawns four scheduled "channel methods": Download Products, Download Orders, Sync Inventory, and Send Shipment Info to My Store. Their Active/Passive state follows the Configuration toggles (see section 8).

### 7b. Carrier Integration Configuration — `/en/wms/integration/form/carrier/configuration/{carrierId}` (UPS = 3)
- H1 "UPS Integration" with a back chevron. Helper: "Our integration with UPS enables you to connect your carriers to MyLogiwa. You will have access to your carriers, services, and packages. Learn more about UPS." CTA **Add New Connection** (green outline).
- Columns: SETUP NAME (link) | WAREHOUSE | STATUS (Active pill) | ENVIRONMENT (Test = purple pill / Production) | CONNECTION ("UPS-TEST Logiwa - UPS") | •••
- Row •••: **Edit**, **Delete**. Clicking the name opens the Edit drawer.
- **Add New Connection** drawer, titled "UPS Carrier API Keys" ("This is where you set up your UPS integration for shipping."):
  - API Key*, API Secret*, Payor Account Number*, Warehouse*, Test Account Yes|No
  - Button **Continue**
- **Edit Connection** drawer (tabs **General | Clients | Services | Packages | Advanced**):
  - General: Setup Name*, Warehouse* (locked), Api Key*, Api Secret*, Payor Account Number*, Active Yes|No.
  - Clients: a checkbox "Give access to all existing and future clients." When it is unchecked, a client picklist appears (inferred).
  - Services: a checkbox "Give access to all existing and future services", **Bulk Actions** (Activate/Deactivate Selected), and a grid CARRIER | SHIPPING SERVICE | ACTIVE toggle.
    - UPS services: MI-Economy Mail Innovations, MI-Priority Mail Innovations, MI-Expedited Mail Innovations, MI-Priority Mail, MI-First Class Mail, Worldwide Economy DDP/DDU, Worldwide Saver, Worldwide Express Plus, Worldwide Expedited, Worldwide Express, GroundSaver, 3 Day, 2nd Day AM, 2nd Day, Next Day Air Saver, Next Day Early, Next Day, Standard, Ground.
  - Packages: a checkbox "Give access to all existing and future packages.", Bulk Actions, and a grid CARRIER | PACKAGE | ACTIVE.
    - UPS packages: Letter, Tube, PAK, Express Box, 25KG Box, 10KG Box, Pallet, Small/Medium/Large Express Box, Flats, Parcels, BPM, First Class, Priority, Machinables, Irregulars, Parcel Post, BPM Parcel, Media Mail, BPM Flat, Standard Flat.
  - Advanced:
    - **Ship from Address***: a checkbox "Use the order's Retailer Address as the Ship From Address", followed by an address card (e.g. "2908 SE I St Ste 2, 72712, Bentonville, Arkansas — Chris / 8888888899").
    - **Third Party Account**: an **Add Account** button and a grid ACCOUNT NUMBER | BILLING COUNTRY | BILLING ZIP.
    - **Markup Rate**: info text "Set a general markup rate or specify client-based rates as needed. Client-based markup rates will take priority over the general rate if both are configured."
      - General Markup: Markup Rate Type* (Percentage | Fixed Price) and Enter Markup Amount.
      - Client-Based Markup: **Add** button and a grid CLIENT | MARKUP RATE TYPE | MARKUP AMOUNT. Examples: Kitt Solutions Inc. Percentage 15; Rapid Prototype Percentage 6.
    - **Label Settings**:
      - Label Format: PDF | ZPL | EPL
      - Label Size: 4x6
      - Label Messages 1/2/3, each with these tokens: OrderCode, StoreOrderNumber, ClientName, PlannedShipmentDate, OrderItemsWithQty, Notes, Tags, SKU1, SKU2, SKU3, StoreName, PackageDimension, CustomFieldTextBox1-3, CustomFieldDateTime1-3, CustomFieldToggle1-2, CustomFieldDropDown1-2, OriginalLPNumber, RetailerPO, ShipFromTaxType, ShipFromTaxId, ShipToTaxType, ShipToTaxId
    - **International Settings**:
      - Tax Type: EIN | DNS | FGN
      - Tax ID
      - Use Components on Commercial Invoice Yes|No
      - Customer Reference (Invoice Number): OrderCode, StoreOrderNumber, Note, Tags, CustomFieldTextBox1-3, CustomFieldDropDown1-2, RetailerPO, ShipFrom/ShipTo Tax Type/Id
      - Customer Reference (PO Number)
    - **Return Label Settings** (NEW badge): a checkbox "Generate Return Label with shipping label".
  - Footer: **Cancel** and **Save**.

## 8. Channel Logs › Channel Methods — `/en/wms/integration/analytics/integration-status`
- Title "Integration Analytics - Logiwa". Breadcrumb `Home > Integrations > Channel Logs > Channel Methods`. Same H1 and helper as Integration Management. The **CHANNEL LOGS** tab is active.
- Left vertical sub-nav: **Channel Methods | Channel History | Orders and Shipments | Products and Inventory**.
- Columns: METHOD | STORE NAME | CHANNEL (logo image) | STATUS (Active/Passive) | NEXT RUN IN (live countdown `HH:MM:SS`; blank when Passive) | **Run** button per row. Run triggers the method immediately; I did not click it.
- Filter fields: Channel, Channel Method (Download orders, Download products, Send shipment info to my store, Sync inventory), Job Status (Paused, Processing, Started, Waiting For Next), Store Name.
- Sample: "Download Orders / ShipStation-1 / Active / 00:13:26". "Download Products" runs about daily (next run around 15-22h away). "Download Orders" runs about every 15 minutes. Total 19 rows (4 methods × 5 setups, minus 1).

## 9. Channel Logs › Channel History — `/en/wms/integration/analytics/integration-history`
- Columns: STORE NAME | CHANNEL (logo) | METHOD | DATE | STATUS | SUCCESS | ERROR | TOTAL | •••
- Status values: **Successful**, **No Data**, **Partially Successful** (also Failed, inferred).
- Filter fields: Channel, Channel Method, Created Date, Store Name, Summary Status.
- Footer: 469 total, 5 pages, Export As Excel.
- Row •••: **Show Details** opens a modal titled "Downloaded Product Details". Logiwa shows this same title even for order runs, which is a bug.
  - Header block: Store, Success Qty, Error Qty, Total Qty, Start Date, End Date (shown as "0NaN/NaN/NaN" in Logiwa, another bug), Status.
  - Grid: SUCCESS (Yes/No) | PROPERTIES (e.g. "Code:779874 / OrderId:811074190") | ERROR MESSAGE (e.g. "'BMS-StarlinkMini20mmV2_7cmRed_Bronco' could not be created in the LogiwaIO"). Paged.
- Run cadence observed: ShipStation Download orders about every 15 minutes, 49-54 orders per run.

## 10. Channel Logs › Orders and Shipments — `/integration/analytics/order-shipments`
- Columns: CHANNEL | STORE NAME | CALL METHOD | CALL DATE | STORE ORDER NO | ERROR MESSAGE | SUCCESSFUL (Yes/No pill)
- Filter fields: Call Date, Call Method (same four values), Channel, Order Number, Store Name, Successful.
- This is a per-order call log: 29,895 rows in 299 pages. Export As Excel is available.

## 11. Channel Logs › Products and Inventory — `/integration/analytics/products-inventory`
- Columns: CHANNEL | STORE NAME | CALL METHOD | CALL DATE | SELLER SKU | QTY (populated for inventory sync) | ERROR MESSAGE | SUCCESSFUL
- Filter fields: Call Date, Call Method, Channel, Seller SKU, Store Name, Successful.
- 39,327 rows. Sample: giftshoppers-usa / Download products / Comp1 / Yes.

## 12. Channel Monitoring › Channel Health Overview — `/en/wms/integration-monitoring/integration-health-overview`
- H1 "Channel Monitoring" with an info icon (tooltip "Monitor and review integration-related issues to ensure smooth data flow between systems.").
- Tabs: **CHANNEL HEALTH OVERVIEW | CHANNEL SETUP DETAILS | ITEMS FOR REVIEW**.
- "Selected Channel: All Channels" (info icon), followed by **radio cards**:
  - All Channels: Average Success Rate 40%, Low-Performing Setups 3
  - Shopify: 25% and 3
  - ShipStation: 100% and 0
  - The selected card has a blue border. Low numbers show in red; 100% shows in green.
- The right side has a "Filter by Client" dropdown.
- Grid columns: CHANNEL | SETUP NAME (link to Setup Details) | CLIENT | DOWNLOAD ORDER STATUS (Active/Passive pill) | SUCCESS RATE (green 100% or red 0% with a warning icon) | NUM. OF ORDERS | NUM. OF LINES | LAST SUCCESSFUL CALL DATE | gear column chooser.
- Header tooltips:
  - Download Order Status: "Indicates whether the 'Download Order' service toggle is currently set to Active or Inactive for this channel integration setup."
  - Success Rate: "percentage of orders successfully imported from a sales channel compared to those that encountered errors within the last 24 hours. If there have been no sales channel orders created in Logiwa within the last 24 hours, the Success Rate will appear as 0%."
  - Num. of Orders/Lines: "total number of orders / order lines downloaded through the related channel integration within the last 24 hours."
  - Last Successful Call Date: "The date and time of the last successful 'Download Order' service run."
- Sample: ShipStation-1 | Bulletpoint Mounting Solutions | Active | 100% | 238 | 710 | 2026/11/05 3:43 PM.
- Footer: pager, Export As Excel, Total 5.
- Logic: a "Low-Performing Setup" appears to be any setup with a success rate below a threshold (0% setups counted).

## 13. Channel Monitoring › Channel Setup Details — `/integration-monitoring/channel-setup-details[?identifier={uuid}&channelName={name}]`
- Without query parameters: a "Setup Name" dropdown ("Select a setup", info "Select a setup from your store integrations"; options are the setup names) and an empty state with a gear icon: "No content has been loaded. Search and select a setup name to view data."
- With a setup selected, a header row shows Setup Name dropdown | Channel (logo) | Client (large text). A Select Warehouse dropdown also appears ("NO DATA FOUND" for the warehouse list).
- Dashboard cards:
  1. **SHIPMENT ORDER VOLUMES** (line/area chart over about 9 days, legend "Logiwa Orders Created" vs "Channel Orders Created"). Tooltip: daily comparison of orders created on the channel vs in Logiwa. Channel count is unfiltered, so Logiwa may be lower. Points to the Missing Shipment Orders module.
  2. **SUCCESS RATE** (donut, e.g. 0%) — same 24h definition as section 12.
  3. **MISSING SHIPMENT ORDERS** (Show All → section 14). Columns: ORDER CODE, CHANNEL SETUP NAME, ORDER DATE, CHANNEL UPDATED DATE, LAST ERROR CODE. Tooltip: channel orders that failed to download over the last two weeks.
  4. **WORKFLOW BLOCKED SHIPMENT ORDERS** (Show All). Columns: ORDER CODE, FULLY OR PARTIALLY, ORDER DATE, WORKFLOW NAME, ACTION NAME. Tooltip: orders stopped by an automation rule within two weeks.
  5. **PRODUCT LISTING EXCEPTIONS** (Show All). Columns: LOGIWA SKU, SELLER SKU, CHANNEL PRODUCT IDENTIFIER, ISSUE TYPE. Tooltip: flags SKU mismatches and multi-listings to prevent sync errors and overselling.
  6. **RECENT ERRORS** (Show All). Columns: ERROR REASON, OCCURENCE QTY, AFFECTED ORDER QTY, LAST OCCURENCE. Tooltip: order download errors in the past two weeks grouped by error type. Examples: "The Order includes custom products" 1/1 10/28/2026; "One or more SKUs could not be created in LogiwaIO" 5/5 10/30/2026.
- Each card shows the empty state "No records to display" when it has no data.

## 14. Items For Review › Missing Shipment Orders — `/integration-monitoring/list/missing-orders`
- Breadcrumb `Home > Channel Monitoring > Items For Review > Missing Shipment Orders`. Same three top tabs. Left sub-nav: **Missing Shipment Orders | Recent Errors | Workflow Blocked Shipment Orders | Product Listing Exceptions**.
- Toolbar: Filter, plus a bulk **Retry Download** button (disabled until rows are selected; re-downloads the selected orders from the channel).
- Columns: [checkbox] | ORDER CODE (e.g. SPY-7566157742241) | CHANNEL ORDER NUMBER (#39297) | CHANNEL SETUP NAME | CHANNEL | CLIENT | ORDER DATE | LAST UPDATED | LAST ERROR CODE (pill) | •••
- Row •••: **Show Details**, **Download Payload**.
- Filter fields: Channel, Channel Setup Name, Client, Created Date, Last Error Code, Order Code, Order Date, Store Order Number.
- **Last Error Code** enumeration (use it as the error catalog):
  - All products are Digital
  - Fulfillment Orders not found in the Order
  - Fulfillment Orders not found in the specified location
  - Line details not found in the Order
  - No Fulfillment Order found with a suitable status for fulfillment
  - One or more SKUs could not be created in LogiwaIO
  - One or more SKUs in the order were not found in LogiwaIO
  - Open Api Error
  - Order is Blocked by Archived Filter
  - Order is Blocked by Tag Filter
  - Order lines are already fulfilled on the Store
  - The Order includes custom products
  - The Order includes products without an SKU
  - Unexpected Error
- **Order Details** drawer (Show Details):
  - Subtitle "Full request, response, and error details for this carrier transaction." (Logiwa reuses the copy)
  - Fields: Channel, Order Code, Channel Order Number, Channel Setup Name, Last Updated, Status (Error)
  - **Error Details** block:
    - Title "One or more products could not be created in LogiwaIO"
    - Explanation (e.g. "The system attempted to create a product from a store order but failed… missing essential product information such as the product's Title…")
    - **Recommended Action** ("Open the product in your store, ensure it has both a Title and a unique SKU, save, and trigger the order download again.")
    - Link "View troubleshooting guide"
  - **Order Payload (JSON)** with a Download button and a pretty-printed raw channel JSON (Shopify order: line_items, billing_address, etc.).
- Build note: each error code needs a title, explanation, recommended action, and a guide link.

## 15. Items For Review › Workflow Blocked Shipment Orders — `/integration-monitoring/list/workflow-blocked-orders`
- Columns: ORDER CODE | FULLY OR PARTIALLY | CHANNEL SETUP NAME | CHANNEL | CLIENT | ORDER DATE | WORKFLOW NAME | ACTION NAME | WAREHOUSE
- Filter fields: Action Name, Block Type (Fully | Partially), Channel, Client, Order Date, SO Code, Store Name, Warehouse, Workflow Name.
- Empty in the sandbox ("No records to display").

## 16. Items For Review › Recent Errors — `/integration-monitoring/list/recent-errors`
- Columns: ERROR REASON | CHANNEL SETUP NAME | CHANNEL | CLIENT | NUM. OF OCCURENCE | NUM. OF AFFECTED ORDER | LAST OCCURENCE DATE
- No row actions, and clicking a row does nothing. The page has Export as Excel.
- Filter fields: Channel, Channel Setup Name, Client, Error Reason.
- Grouping appears to be by error reason + setup + day (the same reason appears on several rows with different dates). Total 12.

## 16b. Items For Review › Product Listing Exceptions — `/integration-monitoring/list/product-listing-exceptions`
- The H1 here reads "Integration Monitoring" instead of "Channel Monitoring", which is inconsistent.
- Columns: LOGIWA SKU | SELLER SKU (comma-joined when there are several) | CHANNEL SETUP NAME | CHANNEL | CLIENT | ISSUE TYPE (pill) | LISTING DATE
- Issue types:
  - **Multi Listing**: the same Logiwa SKU is listed several times on the channel, e.g. "tnt007,tnt007,tnt007".
  - **SKU Difference**: the Logiwa SKU and seller SKU differ, e.g. BMS-DualUSBC12VSocket vs BMS-60WCigarettePlugDualUSBC.
- Filter fields: Channel, Client, Created Date, Exception Issue Type (Multi Listing | SKU Difference), Seller SKU, SKU, Store Name.
- Export as Excel. Total 22.

## 17. Carrier Monitoring › Carrier Errors — `/en/wms/carrier-monitoring/carrier-errors/{label-generation|rate-call|void-cancel-label}`
- H1 "Carrier Monitoring". Tabs: **Label Generation | Rate Call | Void/Cancel Label**. Each tab has its own route and title, e.g. "Void/Cancel Label - Carrier Monitoring - Logiwa".
- **Label Generation** columns: TIMESTAMP | INTEGRATION STEP (LabelGeneration) | SHIPMENT ORDER (link) | DESTINATION TYPE (Domestic/International pill) | STATUS (Error) | HTTP CODE (400) | ERROR (pill text, e.g. "ShipFrom PhoneNumber must be at least 10 alphanumeric characters") | RESPONSE TIME (772 ms) | CARRIER (ups) | SHIPPING OPTION (Ground) | CARRIER CONNECTION | CARRIER SETUP (UPS-TEST Logiwa) | CLIENT | USER (email) | SOURCE (BatchPacking) | LABEL TYPE (Shipping Label / Return) | RATE SHOPPING NAME | •••
- **Rate Call** columns: the same as Label Generation minus Label Type.
- **Void/Cancel Label** columns: TIMESTAMP | INTEGRATION STEP | TRACKING NUMBER | SHIPMENT ORDER | STATUS | HTTP CODE | ERROR | RESPONSE TIME | CARRIER | SHIPPING OPTION | CARRIER CONNECTION | CARRIER SETUP | WAREHOUSE | CLIENT | LABEL TYPE | USER
- Filter fields:
  - Label/Rate: Carrier Connection, Carrier Setup Name, Client, Created Date, Is International?, Is Rate Shopping?, Return Label, Shipment Order Code, Warehouse.
  - Void: Carrier Connection, Client, Created Date, Return Label, Shipment Order Code, Tracking Number, Warehouse.
- Empty state: "No log have been recorded yet."
- Row •••: **Show Details**, **Download Request**, **Download Response**.
- **Transaction Details** drawer ("Full request, response, and error details for this carrier transaction."):
  - Integration Step, Created Date, Status, HTTP Code, Response Time, Shipment Order
  - **Error Details**: "Carrier-Return Error" plus the message
  - **API Log Details** with tabs **REQUEST | RESPONSE**, each "… Body (JSON)" with a Download button and pretty JSON (the UPS shipmentRequest: shipper, package weight/dimensions, service code 03, paymentInformation, shipTo, labelSpecification 4x6 GIF).

### Note: Wave Rules (`/en/wms/job/wave-rules`) — out of cluster; captured only briefly
- Tabs: WAVE RULES | JOB MANAGEMENT | ALLOCATION EXCEPTIONS | WAVE LOG REPORT | SHORTAGE REPORT. CTA "Create A New Wave Rule". Bulk **Run** (disabled until selection).
- Columns: Wave Rule Name, Warehouse, Scheduled (Yes/No), Status (Pending), Priority, Assignee, Operation Type (Picking / Order Merge / Replenishment / Count), Last Executed By (user or "Auto Run"), Last Run, Last Wave ID (e.g. 20522-94), NEXT RUN (countdown).

---

## Gaps and Logiwa defects KitStaks can beat
- The Workflows builder could not be reached (auth redirect).
- Copy bugs:
  - "Downloaded Product Details" title on order runs
  - End Date "0NaN/NaN/NaN"
  - "Add Action" label on the Order By modal
  - The `If*` label on actions
  - The carrier-transaction subtitle reused on order details
  - The H1 switching between "Channel Monitoring" and "Integration Monitoring"
- No inline validation messages: invalid fields only get red borders.
- Recent Errors rows have no drill-down to the affected orders.
- The Channel Health column chooser is empty.
