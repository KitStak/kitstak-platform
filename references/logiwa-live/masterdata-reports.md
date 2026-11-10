# Logiwa iO — LIVE capture: Master Data, Billing, Dashboard, Reports

Captured 2026-11-09 from https://my.logiwa.com (signed in, warehouse filter **MLT1 - Test Warehouse**, id `4a7c3492-8275-47ed-ae54-ac916a6e3b44`). The browser pane was hidden, so the capture used DOM text, computed styles and JS-driven clicks instead of screenshots. Colors come from `getComputedStyle`.

This file supplements `references/logiwa-spec/05-master-data.md` and `07-reports-analytics.md`. Anything already documented there is only referenced here. The **Delta** section at the bottom lists what is new or different.

## Records created or changed during this capture
- **Customer `KS-REF Customer`** (client MLTest, ksref-customer@example.com, 5555550100), with address "KS-REF Ship" (Shipping, 2908 SE I St, Bentonville AR 72712 US).
- **Product listing `zEzujrkAZS`** (giftshoppers-usa) was accidentally unlinked by a single click on the Unlink icon, then re-matched with "Match these products". It is back in Linked Listing, so the net change is zero.
- **Product MLT-WIDGET-01:** the Description was edited and the drawer was then closed with X, so the edit was discarded and not saved.
- **Abandoned drafts, nothing saved:** a VAS Operation (rejected by the server), a Billing Contract (validation failed) and a Billing Fee (inline form).
- **Excel export:** one export of Customers was run, which added a row to Excel Export History.

---

## 0. Navigation map

### Top nav mega-menus (exact item labels → route, all under `/en/…`)

**Fulfillment**
| Item | Route |
|---|---|
| Shipment Orders | `wms/shipment-order/list` |
| Shipped Orders | `wms/shipment-order/shipped/list` |
| Carrier Shipment Details | `wms/shipment` |
| End Of The Day | `wms/shipment/end-of-day` |
| Packing Station | `wms/packing-station` |
| Job Management | `wms/job/management` |
| Order Operations Task Details | `wms/task-details/order-operations/list` |
| Count Task Details | `wms/task-details/count/list` |
| Replenishment Task Details | `wms/task-details/replenishment/list` |
| Shipment History | `wms/shipment-order/shipment-history/list` |
| Shipment Plan | `wms/shipment-plan` |

**Inventory**
| Item | Route |
|---|---|
| Purchase Orders | `wms/purchase-order` |
| Receiving History | `wms/purchase-order/receipt/list` |
| Return Station | `wms/return-station/dashboard` |
| Return Orders | `wms/shipment-order/return/list` |
| Work Orders | `wms/work-order/list` |
| Total Inventory | `wms/inventory/total` |
| Inventory by Location | `wms/inventory/list` |
| Available To Promise (ATP) | `wms/report/available-to-promise` |
| Count Plan | `wms/count/plan/list` |
| Count Location Details | `wms/count/location/list` |
| Count SKU Details | `wms/count/product/list` |

**Automation**
| Item | Route |
|---|---|
| Algorithms | `wms/algorithm` |
| Workflows | `wms/workflow` |
| Rate Shopping | `wms/rate-shopping-presets` |
| Wave Rules | `wms/job/wave-rules` |

**Integrations**
| Item | Route |
|---|---|
| Channel Integrations | `wms/integration/list/1` |
| Carrier Integrations | `wms/integration/list/2` |
| Channel Methods | `wms/integration/analytics/integration-status` |
| Channel History | `wms/integration/analytics/integration-history` |
| Orders and Shipments | `wms/integration/analytics/order-shipments` |
| Products and Inventory | `wms/integration/analytics/products-inventory` |
| Channel Health Overview | `wms/integration-monitoring/integration-health-overview` |
| Channel Setup Details | `wms/integration-monitoring/channel-setup-details` |
| Missing Shipment Orders | `wms/integration-monitoring/list/missing-orders` |
| Recent Errors | `wms/integration-monitoring/list/recent-errors` |
| Workflow Blocked Shipment Orders | `wms/integration-monitoring/list/workflow-blocked-orders` |
| Product Listing Exceptions | `wms/integration-monitoring/list/product-listing-exceptions` |
| Carrier Errors | `wms/carrier-monitoring/carrier-errors` |

**Reports:** the same items as spec 07 §1 (21 links, including Shipment History and Receiving History).

**Analytics:** the same items as spec 07 §2 (9 links; still gated behind add-ons).

**Settings**
| Group | Item | Route |
|---|---|---|
| Master Data | Products | `wms/product` |
| Master Data | Product Listings | `wms/listing-product/list` |
| Master Data | Locations | `wms/location` |
| Master Data | Vendors | `wms/vendor/list` |
| Master Data | Customers | `wms/customer` |
| Master Data | Retailers | `wms/retailer` |
| Configuration | Warehouse | `wms/warehouse` |
| Configuration | Mobile Carts | `wms/mobilecart` |
| Configuration | LP Types | `wms/lp-types` |
| Configuration | LP Numbers | `wms/lp-numbers/list` |
| Configuration | Shipment Packages | `wms/shipmentpackage` |
| Configuration | Printouts & Labels | `wms/printout` |
| Configuration | Data Setup | `account/settings/datasetup/code-generation` |
| Configuration | Job Types | `wms/job/types` |
| Configuration | Screen Configuration | `wms/screen-configuration` |
| Client Setup | Clients | `account/client` |
| **Billing (new group)** | **3PL Billing** | `wms/billing` → `/billing/list` |
| **Billing (new group)** | **Billing Report** | `wms/billing/report/list` |
| **Billing (new group)** | **VAS Operations** | `wms/billing/operations/list` |
| Users | Users | `account/user/list` |
| Users | Roles | `account/user/role` |

### Header utilities
- A **background-task tray** icon with the tooltip "View the progress and status of your background tasks. Completed transactions are cleared daily."
- A **Printers** popover (`<details id="directPrint">`). Its header is "Printers", followed by "Warehouse Selection" with a warehouse dropdown. Direct printing goes through this popover.

### Page-level tab strips (each tab is its own route)
- **Products:** PRODUCTS | PRODUCT LISTINGS
- **Organization:** CLIENT | CUSTOMER | VENDORS | RETAILERS [BETA]
- **Billing:** 3PL BILLING | BILLING REPORT | VAS OPERATIONS
- **Job:** Wave Rules | Job Management | Allocation Exceptions | Wave Log | Shortage. See spec 07.
- **Inventory family:** Total | By Location | ATP | Kit Inventory | Kit Component. See spec 07.

### Drilldowns and hyperlinks observed
- **Grid primary-key cells** (`.link-to-detail`, blue) open the **Edit drawer** in place. The URL does not change. This holds for products, locations and clients.
- **Billing list:** **Show Details / Edit** routes to a **full page** `/billing/form/edit/<uuid>`. This is the only master record in this area with its own URL.
- **Billing Report:** **View / Edit** opens a full-width drawer, "Billing Report Details". The URL does not change.
- **Shortage Report:** ORDER CODE and SKU are `span.shortage-link` (color rgb(81,137,215)). Clicking spawned a new browser tab, which closed before it could be read, so this is unverified.
- **Shipment History:** there are **no** hyperlinks in its cells.
- **Dashboard:** there are **no navigational drilldowns**. Clicking a ranking line (`.myl-dashboard-summary-card-item-line`) only toggles an `active` highlight; the URL does not change and nothing opens.
- **Breadcrumbs:** examples are `Home > Settings > Billing Report`, `Home > Inventory > Products`, `Home > Orders > Shipment History`, and `Home > Settings > Organization > Clients`.

---

## 1. Dashboard — `/en/wms/dashboard`

### Filter bar
- The bar reads "Filter by", then **Warehouse** and **Client** dropdown chips.
- Each chip is a popover: a "Search Filter" input, a checkbox list (Warehouse has 2 options; Client has 31, unsorted), and an **Add Filter** button.
- After apply, the chip label becomes the selected value, for example "MLT1 - Test Warehouse".
- The filter is **not** written to the URL.

### Cards, top to bottom, with numbers after filtering to MLT1

**1. Progress for Today** (info tooltip)
- Tooltip: "Shows the progress of the tasks, order lines, and orders that have been created today and prior to this day."
- **Day Shift**
  - With several warehouses selected, it shows the empty state "Select just one warehouse to see Day Shift data."
  - With one warehouse, it shows the date "Mon, Nov 9", the current time against the end time "20:14 - 17:00", a progress bar, and start "08:00" and end "17:00" labels with icons.
  - **Bug:** the bar width went to `136.111%` after the shift ended, overflowing the bar.
- **Progress rows:** each row shows "X% <verb>", a count "done - total" and a bar.
  - Tasks: "0% Completed", 0 - 3.
  - Order Lines: "0% Packed", 0 - 3.
  - Orders to be Shipped Today: "0% Packed", 0 - 3.
  - Unfiltered, the same rows read 18 - 8,835, 5 - 8,943 and 4 - 3,113.

**2. Unfulfilled Orders** (info tooltip)
- Tooltip: "Total number of orders with no action taken, regardless of a specific time interval."
- A donut chart (CSS conic-gradient) with the center label "Total Order" and the value 3.
  - The legend has two items: "Ready to Pack & Ship" in `--primary-color` #2d62cc and "Open" in #ebac00.
- Three count groups, each with Total Order and Total Pack Quantity:

| Group | Total Order | Total Pack Quantity |
|---|---|---|
| **Total** | 3 | 5 |
| **Open** | 1 | 1 |
| **In Progress** | 2 | 4 |

**3. Order Breakdown by Status** (info tooltip)
- Tooltip: "Shows the number of orders according to their current status. Orders with an expected shipment date set to today or prior to this day will be displayed in this section."
- Plain "Label : value" lines with no pills and no links:

| Status | MLT1 |
|---|---|
| Open | 1 |
| Ready to Pick | 2 |
| Picking Started | 0 |
| Ready to Pack | 0 |
| Packing Started | 0 |
| Ready to Load | 0 |
| Ready to Ship | 0 |
| Cancelled | 0 |
| Shortage | 0 |
| On Hold | 0 |
| Already Shipped Today | 0 |
| Orders to be Shipped Today | 3 |
| Orders to be Shipped Tomorrow | 0 |

**4. Ranking cards** (four in a row)
- Each line shows "n. Name", "xx.xx% of All Orders" and a count.
- **Channels:** "Order details coming from Channels." Unfiltered: ShipStation 95.77% (3393), Shopify 3.08%, Others 1.16%.
- **Clients:** "Client’s order details and rank". Shows the top 5; unfiltered: Bulletpoint 95.94%, …
- **Carriers:** "Ranking of carriers to which orders are shipped".
- **Order By Country:** "Rank of the regions where orders are shipped".
- The tail is rolled up into **"Others"**.

**5. Jobs**
- Subtitle: "You can manage and review the details of the jobs with the tabs on the right."
- A segmented radio, **Priority | Status | Type**, picks the grouping.
- Table columns: Name | (bar) | Product Qty | Order Qty | Percentage | Job Qty.
- Group values seen:
  - **Priority:** None, High.
  - **Status:** Pending, Completed, Cancelled.
  - **Type:** the job-type names, for example AI-OrderBasedPickPack, Single Unit Orders, AI-IdenticalOrderBatchPick, Work Order Picking, Multi Item Orders, MLT1 D2C Picking, B2B Order Picking, AI-SingleItemBatchPick, Identical SKU- Single Unit.
- **Bug:** the Jobs card **ignores the warehouse filter**. It showed identical totals (2102 jobs) both filtered and unfiltered.

---

## 2. 3PL Billing — `/en/wms/billing/list` (NEW)

- **Title:** "Billing". **Helper text:** "On the 3PL billing screen, you can edit or create a billing form for your clients." **Breadcrumb:** Home > Settings > Billing.
- **Header:** **Create Billing Contract** (primary).
- **Toolbar:**
  - Filter. Its fields are Billing Name, Client, Create Date, Period and Warehouse.
  - An **Actions ▾** dropdown (`<details>`) with Approve, Cancel Approval, and **Delete** (red: text #e71c30 on #fdecee). All are disabled until a row is selected.
  - **Duplicate** and **Calculate** buttons, disabled until a row is selected.
- **Columns:** (checkbox) BILLING NAME* | CLIENT* | APPROVAL STATUS | WAREHOUSE* | START DATE* | LAST CALCULATION DATE* | BILLING FREQUENCY* | CREATED BY NAME* | CREATED DATE TIME* | NEXT PERIOD START DATE* | (kebab).
- **Approval status pill:** "Approved" in purple text rgb(98,29,184) on bg rgb(223,206,245), radius 12px. An unapproved contract shows a **blank** cell.
- **Row kebab:** Show Details · Edit · Change Log · Delete.
- **Rows:**
  - `Training Contract | testclient | Approved | Team 1 | 8/1/2026 | 11/1/2026 4:11:49 AM | Monthly | Team 1 Supplier Admin | … | 11/30/2026 11:00:00 PM`
  - `Team 1 Standard 2026 | MLTest | (blank) | MLT1 …`
  - `MLTest Billing | MLTest | Approved | MLT1 …`

### Create / Edit Billing Form — full page `/billing/form/add`, `/billing/form/edit/<id>`

**Header**
- H1 "Create Billing" or "Edit Billing", and the subtitle "Create Billing Form" or "Edit Billing Form".
- A **Show Change Log** link.

**Contract fields**

| Field | Type | Notes |
|---|---|---|
| Billing Form Name* | text | max 100. In edit mode it is prefixed "Billing - …". |
| Client* | dropdown | 31 clients |
| Warehouse* | dropdown | |
| Calc. Start Date* | date input | "Enter date" |
| Billing Frequency* | dropdown | Monthly, Weekly, Daily, BiMonthly, SemiMonthly, BiWeekly |

**Buttons and validation:** Cancel / Save. Saving with empties shows no toast; each required `.form-group` gets `ng-invalid`. Cancel on the add page did nothing visible.

In Edit, the fields render read-only as label/value pairs (CLIENT, WAREHOUSE, BILLING START DATE, BILLING FREQUENCY).

**Fees section** (edit page)
- A "Fees" header with **Create Fee** and Filter.
- Each fee is a card: "Fee Name" plus the name, trash and edit-pen icon buttons top-right, then Fee Type / Fee Calculation Type (storage only) / Fee By / Charge By.
- Condition lines read like "Condition : If Shipment Order Type in D2C Order" or "Operation type : Cycle Count (hours)".
- **Charges block:** price on the left, unit on the right ("Per Unit", "Per SO", "Per LP", "Per RMA", "Per Recurring", "Per Product (Pack Quantity)"), or **tier rows** such as "16.00 | 1st to 99th", "13.50 | 100th to 499th", "11.00 | 500th to 999999th" and "0.00 | First Item".
- Paged with "Total : 20".

**Summary section**
- "Summary — You can check the billing information." and the contract name.
- A grid: NAME | TYPE NAME | FEE BY | CHARGE BY | CHARGE | FROM QTY. | TO QTY. | PERCENTAGE.
- **Print** button.

**Create Fee — inline form card** (not a drawer)

| Field | Notes |
|---|---|
| Fee Name* | text, max 100 |
| Select an operation type to manage fees* | Shipment, Recurring, VAS, Pick & Pack, Receiving, Storage, Return, Work Order |
| Fee Calculation Type* | Enabled for **Storage** only: Daily Accumulation, At Peak Inventory, At Period End, Distinct Period Count, Average Calculation, Split Month Storage |
| Fee By* | Depends on type (table below) |
| Use Minimum Price | Yes/No, plus Minimum Price. Hidden for Recurring. |
| Use Maximum Price | Yes/No, plus Maximum Price. Hidden for Recurring. |
| VAS Type | VAS only: Customer Pickup, Grade B Pallet, Programming (hours), Cycle Count (hours), Return Additional Item, Special Project. This is the client's VAS master. |
| Charge One Time | Recurring only |
| Charge By* | Depends on Fee By |
| Charge | Radio **For Each Unit / From Quantity / Tier Base**, a Unit price, "to" for ranges, and **Add** for more tiers |
| Add Condition | Opens a modal (below) |

Footer: Cancel / Save.

**Fee By and Charge By options by type**

| Fee type | Fee By options | Charge By options |
|---|---|---|
| Shipment | Per SO · Per Label · Per LP / Shipment Package · Per Product | Per Product → Product · Kit · Component |
| Pick & Pack | Per Picking · Per Packing | |
| Receiving | Per Product · Per LP · Per PO · Per SKU · Per Volume · Per Receiving Line | |
| Storage | Location · LP · Product · Total Volume · Parent LP (after a calc type is chosen) | |
| Return | Per RMA · Per SO · Per Product · Per SKU | |
| Work Order | Per WorkOrder · Per Kit · Per Component | |

**Split Month Storage** reveals:
- a "Split Month Settings" legend,
- Split Day of Month*,
- Standard Rate (Days 1-15)*,
- Alternate Rate (Days 16-Month End)*.

**Add Condition modal**
- Title "Add Condition" with an X.
- **Charge if** dropdown of attributes:
  - Carrier, CARRIER - Rate, Label Cost, Nof Lines.
  - Product Group, Product Type, Product Volume, Product Weight.
  - Shipment Method, Shipment Order Type, Shipment Package Type.
  - All 10 custom-field slots for LOCATION, LPTYPE, PRODUCT, SHIPMENT PLAN, SO and SO DETAIL.
  - PRODUCT flags: Expiration Date Tracking, Is Digital Product, Is Foldable, Is Fragile, Is Hazardous, Is Insert, Is Kit to Stock Item, Is Liquid, Is Oversized, Is Packing Material, Is Poster, Is Stackable, Lot/Batch Tracking, Serial Number Tracking, Sku.
  - SO fields: Carrier Billing Type, Carrier Int Billing Type, Discount, Nof Product, Order Tag, Packing Instructions, Priority, Store, Total Shipping Cost, Total Volume, Total Weight.
  - SO DETAIL - Line Notes 1–3.
- **Comparator:**
  - Lookups use `in | not in | is empty`.
  - Numerics use comparators such as "greater than or equal" and "lower than" (seen in existing fees).
- A value picker, for example "Select store".
- **Save** button.
- Several conditions can stack and are ANDed.

---

## 3. Billing Report — `/en/wms/billing/report/list` (NEW)

- **Title:** "Billing Report". The description is the placeholder "Billing report calculation description" (a Logiwa bug).
- **Toolbar:** Filter (Billing Number, Client, Create Date, Name, Warehouse), plus bulk **Cancel** and **Approve**, both disabled until a row is selected.
- **Columns:** (checkbox) BILLING FORM | BILL NUMBER (16 digits, e.g. 2611010000462207) | CALCULATION STATUS (pill) | CLIENT | WAREHOUSE | CALCULATION DATE TIME | CREATED BY USER ("—" for scheduled runs) | PERIOD START | PERIOD END | BILL STATUS (Draft) | PRICE ("500.00 USD") | EXPORTED TO INTEGRATION (No) | (kebab).
- **Calculation status pill:** "Successful" uses class `table-status-2`, text rgb(0,135,77) on bg rgb(211,240,227).
- **Row kebab:** **View / Edit** · Delete.

### Billing Report Details (full-width drawer)
- **Header block:** Selected Bill, Warehouse, Client, Issue Date ("11/1/2026, 4:06:33 AM"), Bill Number, Bill Status (Draft), Period ("10/1/2026 - 11/1/2026"), Total Price ("500.00 USD").
- Tabs **CONSOLIDATED BILLING REPORT** | **DETAILED BILLING REPORT**.
- **Consolidated tab:**
  - Columns: FEE NAME | OPERATION TYPE | FEE BY | CHARGE BY | FROM QTY | TO QTY | UNIT PRICE | QUANTITY | TOTAL PRICE | MIN MAX ADJUSTMENT | ADJUSTED PRICE.
  - **Print** and Export As Excel buttons.
- **Detailed tab:** adds SKU, BILLING FREQUENCY, ACTIVITY DATE, REFERENCE NUMBER, LP NUMBER, **INTEGRATION STATUS** ("Not Sent") and NOTE.
- **Calculation runs automatically** on the 1st of the month at about 04:06 for monthly contracts. Calculate can also be triggered from the list.

---

## 4. VAS Operations — `/en/wms/billing/operations/list` (NEW)

- **Header:** **Import** and **Create a VAS Operation** (the label is CSS-uppercased to "Create A VAS Operation").
- **Filter fields:** Calculation Type, Client, Created By, Created Date, Operation Date, Reference Number, Reference Order Type, VAS Type, Warehouse.
- **Columns:** VAS TYPE | CLIENT | WAREHOUSE | OPERATION DATE | CREATED BY | CREATED DATE | CALCULATION TYPE ("Vas Quantity" / "Total Price") | REFERENCE NUMBER | REFERENCE ORDER TYPE | VALUE | NOTE | (kebab).
- **Row kebab:** Show Details · Edit · Delete.

### Add a new VAS operation (drawer)

| Field | Type | Notes |
|---|---|---|
| Client* | dropdown | |
| Warehouse* | dropdown | |
| VAS Type* | dropdown | Same list as the fee VAS types |
| Operation Date* | date-time | Defaults to **now** ("2026/11/09 20:20") |
| Calculation Type | dropdown | **Disabled.** Auto-filled from the VAS type, for example "Total Price". |
| Operation Value* | numeric | Placeholder 'Enter "value" to be added', 0.00 |
| Add a Note | textarea | Max 200, with a counter |
| Reference Order Type | dropdown | Shipment Order, Purchase Order, Work Order |
| Reference Number | text | Max 100. **Disabled until a Reference Order Type is picked, then becomes required (*)** |

- **Empty save:** no toast; every required control gets `ng-invalid`.
- **Server-side validation:** a bad reference shows a red toast **"Error — This shipment order does not exist"**. The toast auto-dismisses in under 3 s.
- **Cancel** closes the drawer without a confirmation prompt.

---

## 5. Products (live re-check; see spec 05 §1 for the full wizard)

- The list, toolbar, kebab (Show Details · Edit · Change Log · Delete) and Bulk Import/Update menu are unchanged from spec 05.
- **Quick search writes to the URL:** `?sku=MLT-WIDGET-01&skuqt=eq&ps=100`.

### Edit Product drawer
- 700px wide. Title "Edit Product" with a category sub-badge "Product".
- **The stepper is clickable in edit mode.** The 5 steps are radio labels, and you can jump straight to any step.
- **Step styling:**
  - Visited steps get `completed-step`, with text rgb(78,90,103).
  - The current step gets `k-radio-checked`: bg #2d62cc with white text.
  - Future steps use rgba(78,90,103,.5).
- **Pack Type step** (MLT-WIDGET-01):
  - A Primary(Uom) "Each" card with Barcode MLT000001, L 10 / W 8 / H 4 Inch, Use Item’s Own Box No, and Volume 0.
  - **Weight is not shown in the details card.**
  - **Hierarchicals (1)** tab:
    - "Primary(Uom) — Pack Type Each".
    - "**Hierarchical Secondary (Parent of Primary)** — Pack Type Case, Child Qty, UOM Qty".
    - An "Add New Hierarchical Pack Type" link.
- **Closing with X after an edit discards it silently.** There is no unsaved-changes prompt (confirmed again).

---

## 6. Product Listings — `/en/wms/listing-product/list` (now loads; previously unknown)

- The toolbar and columns are as in spec 05. With Unlinked Listing selected the pager showed 73 pages.
- **There is no row kebab.** All actions live inside the **LOGIWA PRODUCT** cell (`.linked-myLogiwa-product-container`): a thumbnail, details, a status tag and icon actions with tooltips.

### Link states (tag pill: 10px, radius 12px, white text)

| State | Tag bg | Cell text | Icons (tooltip) |
|---|---|---|---|
| **No Match** | grey rgb(78,90,103); the name "No Match" is in red rgb(237,99,74) | "No Match / You can Search or Create Product to link" | add.png "Create a product", search.png "Search a product" |
| **Suggested** (tag class `…-tag-Matched`) | amber rgb(226,165,49) | Suggested product name / SKU / description | info "Info", reject "Don't match these products", approve "Match these products" |
| **Linked** | green rgb(40,181,115) | Product name, SKU, description | info "Info", unMatch "Unlink" |

### Icon behavior
- **Unlink is instant.** One click, no confirmation and no toast. The row leaves the Linked tab, and the listing then reappears under Unlinked as **Suggested**, pointing at the same SKU.
- **Approve (Match) is also instant, with no toast.** The current grid does not refresh, but the row reappears under Linked.

### Link Product drawer (568px)
Opened from the search or add icon. It has radio tabs **Search & Select | Create New | Suggested**; Suggested is disabled when there is no suggestion.

- **Search & Select:** "Search Product Name & SKU" (a dropdown "Select Product"), then Cancel / Save.
- **Create New** is a quick product form:
  - Client (prefilled from the store, e.g. Bulletpoint Mounting Solutions).
  - SKU*, Name*, Description (0/500), Product Image.
  - UOM Pack Type (Unit), **Initial Quantity**, Weight, Weight Unit.
  - Sales Price, Purchase Price.
  - Yes/No toggles: Active?, **Never Sync**, Fragile, Oversized.
  - Tax Rate %, barcode, Product Type, Product Group.
  - Cancel / Save.

---

## 7. Locations (live re-check; spec 05 §3 holds)

- **Warehouse filter in the URL:** `?wn=["<id>"]&wnqt=in&wnlbl=MLT1 - Test Warehouse&ps=100`. The chip area shows "+1".
- **MLT1 has 7 locations:** KS-TEST-LOC-01, MLT1-SHIP, MLT1-PACK, MLT1-B-01, MLT1-A-01, MLT1-RECV and PrimaryLoc.
- **Header menus:**
  - Import ▾: Bulk Import Locations · Bulk Update Locations.
  - Assign Capacity ▾: Bulk Import Product Capacity · Bulk Update Product Capacity · Bulk Import LP Capacity · Bulk Update LP Capacity.
- **Toolbar:** Label · Delete.
- **Edit Location drawer** (568px), steps Information | Product Capacity | LP Capacity:
  - Product Capacity has an "Add Capacity" grid: PRODUCT | PACK TYPE | MIN QTY | MAX QTY, empty state "No records to display", and Back / Next.
  - LP Capacity has the grid LP | MIN QTY. | MAX QTY. | PRODUCT SKU and Back / **Save**.
- **Location Change Log:**
  - The drawer is titled "Location Change Log", with columns TYPE | MESSAGE | OPERATION DATE | SOURCE.
  - Messages read like "Logiwa.NameKey.RemainingVolume is modified. 0.0 --> -1.00" (a raw i18n key) or "MLT1-RECV -> Warehouse Location is created."
- **Delete confirm modal:**
  - The text is "Are you sure you want to delete this location?" (rendered twice: title plus body).
  - Buttons: **No** (bg #f7f7f7) and **Yes** (red, bg rgb(231,28,48)).
- **Label:** clicking it with a row checked produced no modal and no network request. It probably needs a selected printer, set through the header Printers popover.

---

## 8. Clients — `/en/account/client/list` (steps 3–4 now captured)

- **Header:** Bulk Import/Update ▾ (**Import Clients · Update Clients**) and Create Client.
- **Toolbar:** Filter, whose only field is **Display Name**, and Delete.
- **Row kebab:** Show Details · Edit · Change Log · Delete.

### Edit Client drawer (568px)
- Steps Information | Settings | Addresses | Others. The footer in edit mode is **Back / Save on every step**.

**Addresses step**
- Three sub-grids, each with a **Create** button:
  - **Shipment Address (n):** ADDRESS NAME | CONTACT NAME | ADDRESS. For MLTest: "MLTest Ship From | Test | 2908 SE I St".
  - **Billing Address:** ADDRESS NAME | CONTACT NAME | ADDRESS.
  - **Return Address** [BETA]: ADDRESS NAME | CONTACT NAME | STATUS | ADDRESS.
- Each address row has a kebab: Show Details · Edit · Delete.
- **"Create New Shipment Address" modal:**
  - Address name*, Contact first name*, Contact last name*, Contact email*.
  - Contact Phone Number, Contact mobile phone number.
  - Address line 1*, Address line 2, Postal Code*, City*.
  - Country* (default United States of America) and State* (default Alabama).
  - Cancel / Save.

**Others step**
- "SSCC18 Barcode Creation", with a diagram labelled Extension Digit · GS1 Company Prefix · Serial Number.
- Inputs: GS1 Company Prefix, Serial Number and Extension Digit.

---

## 9. Customers — save behaviour resolved

- **At least one address is mandatory.** Saving with valid fields and zero addresses does nothing at all: no toast and no error.
- **The Add Address modal** reads "Enter and set the customer's address to use on operations."
  - Fields: Address name*, Usage Type* (Shipping/Billing/Return), City*, Country*, Postal Code*, Address line 1*, Address line 2.
  - Toggles: Active Yes/No and Set Default Address Yes/No.
  - Buttons: Cancel / Add.
  - State* appears after the country is chosen; the USA has 62 entries.
- **The added address renders as a card:** a pin icon, an h5 with the name, the address line "2908 SE I St Bentonville Arkansas 72712 US", and the usage type "Shipping".
- **On Save** the drawer closes and the grid shows the new row. No success toast was seen.
- **Bug:** the CITY, COUNTRY and STATE columns stay **blank** even though the address exists.
- **IS ACTIVE** renders as the text "Active" in green rgb(40,181,115) (`.myl-customer-status.active`).
- **Row kebab:** Show Details · Edit · Delete. There is no Change Log.

## 10. Vendors / Retailers / Warehouse / Shipment Packages — row menus and filters

| Entity | Row kebab | Bulk / toolbar | Filter fields |
|---|---|---|---|
| Vendors | **Edit · Change Log** (no Delete) | Create Vendor | Client, Company Name, Company Nickname |
| Retailers | **Edit** | Create Retailer, Delete (disabled until a row is selected) | Name |
| Warehouse | Show Details · Edit · Change Log · Delete | Create Warehouse | Code |
| Shipment Packages | Show Details · Edit · Delete | Create Shipment Package | Code, Warehouse |
| Billing contracts | Show Details · Edit · Change Log · Delete | Actions ▾ (Approve / Cancel Approval / Delete), Duplicate, Calculate | Billing Name, Client, Create Date, Period, Warehouse |
| Billing reports | View / Edit · Delete | Cancel, Approve | Billing Number, Client, Create Date, Name, Warehouse |
| VAS operations | Show Details · Edit · Delete | Import, Create a VAS Operation | (9 fields; see §4) |

---

## 11. Reports (live spot checks)

### Shipment History — `/shipment-order/shipment-history/list`
- **Description:** "Shipment history is a report which lists all past ship order actions and remove inventory actions."
- The breadcrumb is Home > Orders > Shipment History.
- **Toolbar:** Filter only; there is no quick search. Footer: Export.
- **Columns:**
  - ORDER CODE, ORIGINAL ORDER CODE, STORE ORDER NUMBER*, SKU*, PRODUCT NAME*, BARCODE
  - PO NUMBER, LOT/BATCH NUMBER, TRACKING NUMBER, EXPIRY DATE
  - QUANTITY*, PACK TYPE*, UOM PACK TYPE, SHIPMENT PACKAGE
  - KIT SKU NAME*, RETAILER*, PACKAGE WEIGHT* ("2 Ounce"), MASTER SHIPMENT ORDER CODE
  - IS BACK ORDER (rendered as raw "false"; a bug)
  - SHIPMENT DATE*, SHIPMENT TYPE* ("Shipment Order"), NOTE
  - CLIENT*, WAREHOUSE*, LOCATION* ("Packing"), LPN
  - ORIGINAL LP NUMBER, ORIGINAL PARENT LP, PARENT LP, PARENT LP TYPE
  - RECEIVING DATE, PRODUCTION DATE
- **Filter fields:** Client, Expiry Date, Location, Lot Batch Number, LP Number, Order Code, Original Shipment Order Code, Pack Type, Parent LP Number, Parent LP Type, Product Name, Product SKU, Purchase Order Number, Quantity, Shipment Date, Shipment Type, Store Order Number, Tracking Number, Warehouse.
- There are no cell links and no row kebab.

### Shortage Report
- Matches spec 07. ORDER CODE and SKU are `span.shortage-link` (rgb(81,137,215)) and open in a **new tab**.

### Excel Export History
- Clicking **Export as Excel** on Customers wrote a new top row:
  - `Customers | Download | 11/9/2026 8:31:35 PM | 1 | | Completed`
  - The Export Type is the source page name. The export took under 3 s.
- **Row kebab:** Download. The status pill is "Completed"; colors are in spec 07.

### Other reports
The remaining report pages (ATP, Kit Inventory, Change Log, Transaction History, Order Inventory, Replenishment, Snapshot, Missing Log, Wave Log, Allocation Exceptions, PO Receiving, User Performance, Serial reports, Integration Log) were captured on 2026-11-05 in `logiwa-spec/07-reports-analytics.md`. Nothing contradicting that capture was seen today.

---

## Delta vs existing spec (`logiwa-spec/05`, `07`)

1. **The whole Billing module is new:**
   - The Settings menu has a "Billing" group: 3PL Billing, Billing Report and VAS Operations.
   - Contract list with an Actions menu (Approve / Cancel Approval / Delete), Duplicate and Calculate.
   - Full-page contract form with fee cards, an inline fee builder (8 fee types, storage calc types, split-month, min/max price, tiered charges) and a condition builder covering about 95 attributes.
   - Bill runs with a Consolidated / Detailed drawer, Approve / Cancel, and an Integration Status per line.
   - A VAS operation log with reference-order validation.
2. **Dashboard specifics**, which are not in any spec:
   - Five cards and a Warehouse/Client filter that is not in the URL.
   - The Day Shift needs exactly one warehouse.
   - Exact tooltips (captured above).
   - The donut uses #2d62cc and #ebac00.
   - 13 status lines.
   - The Jobs card groups by Priority, Status or Type.
   - **No drilldowns** (lines only highlight).
   - Bugs: the Jobs card ignores the warehouse filter, and the day-shift bar overflows past 100%.
3. **Product Listings works:**
   - Three link states with tag colors (No Match, Suggested, Linked).
   - In-cell icon actions instead of a kebab.
   - One-click Unlink and Match with no confirm or toast.
   - The Link Product drawer (Search & Select / Create New with Initial Quantity and Never Sync / Suggested).
4. **Customer:** an address is required, and the save fails silently without one. The grid's address columns stay blank (a Logiwa bug). The kebab has no Change Log.
5. **Client wizard steps 3–4:**
   - Shipment, Billing and Return (BETA) address grids with a contact-based address modal.
   - The Others step holds the SSCC-18 settings (GS1 Company Prefix, Serial Number, Extension Digit).
   - In edit mode the footer is Back / Save on every step.
   - Client Bulk menu: Import Clients / Update Clients. The filter has only Display Name.
6. **Edit drawers have a clickable stepper**, with `completed-step` styling and the active step at #2d62cc. Drawer widths are **700px** for product and **568px** for location, client and listing.
7. **Product pack-type details omit Weight**, and the Hierarchical tab labels the level "Hierarchical Secondary (Parent of Primary)".
8. **Location delete confirm:** "Are you sure you want to delete this location?" with No (grey) / Yes (red #e71c30).
9. **Location Label** does nothing without a printer. Direct printing goes through the header Printers popover (Warehouse Selection).
10. **Vendor kebab is only Edit · Change Log** (no Delete). The vendor filter fields are Client, Company Name and Company Nickname, not "Display name".
11. **Shipment History report** was not in spec 07: 37 columns and 19 filters (listed above). IS BACK ORDER shows raw "false".
12. **Full Fulfillment, Inventory, Automation and Integrations menu routes** are now listed. Integrations has 13 monitoring and analytics pages.
13. **Toast style:** the error toast reads "Error / <message>" and auto-dismisses in under 3 s. No success toasts were observed on customer save or listing link actions.
14. **The Billing Report description is a placeholder** ("Billing report calculation description"). This is another copy bug KitStaks can beat.
