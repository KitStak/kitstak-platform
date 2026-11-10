# Logiwa iO LIVE capture: Outbound (Shipment Orders, Jobs/Tasks, Shipment Plans, Shipping/EOD, Packing & Return stations, Returns)

Captured 2026-11-09 from the my.logiwa.com sandbox while signed in. Records created by earlier runs carry the `KS-REF-` prefix (KS-REF-SO-001, KS-REF-RET-01). Nothing was deleted, shipped or cancelled during this pass.
Coverage note: this pass was read-heavy and broad. Deep modal text for bulk actions was not re-triggered, because `references/logiwa-spec/01-orders.md` §1 already records it verbatim and the live menu items match it exactly (see Delta).

## Navigation map

- Top nav: Fulfillment | Inventory | Automation | Integrations | Reports | Analytics | Settings, plus a global Search.
- Fulfillment mega-menu (outbound part):
  - Shipment Orders `/en/wms/shipment-order/list`
  - Shipped Orders `/en/wms/shipment-order/shipped/list`
  - Carrier Shipment Details `/en/wms/shipment`
  - End Of The Day `/en/wms/shipment/end-of-day`
  - Packing Station `/en/wms/packing-station`
  - Job Management `/en/wms/job/management`
  - Order Operations Task Details `/en/wms/task-details/order-operations/list` (also Count `/count/list` and Replenishment `/replenishment/list`)
  - Shipment History `/en/wms/shipment-order/shipment-history/list`
  - Shipment Plan `/en/wms/shipment-plan`
  - Return Station `/en/wms/return-station/dashboard`
  - Return Orders `/en/wms/shipment-order/return/list`
  - Work Orders `/en/wms/work-order/list`
- Automation: Wave Rules `/en/wms/job/wave-rules`.
- Reports: Allocation Exceptions `/en/wms/job/allocation-exceptions` and Wave Log Report `/en/wms/job/wave-log`.
- Page-level tab strips (these act as sibling routes):
  - Shipment Order: ORDER BACKLOG | SHIPPED & CANCELED ORDERS | RETURN ORDERS
  - Jobs: WAVE RULES | JOB MANAGEMENT | ALLOCATION EXCEPTIONS | WAVE LOG REPORT | SHORTAGE REPORT
  - Task Details: ORDER OPERATIONS | COUNT | REPLENISHMENT
  - Carrier Shipment Details: CARRIER SHIPMENT DETAILS | END OF THE DAY
  - Shipment Plan: SHIPMENT PLAN | SHIPMENT PLAN ORDERS | SHIPMENT PLAN LPS
- Drilldowns:
  - Order Code cell (blue link) -> `/en/wms/shipment-order/form/edit/{guid}`. This is the Edit wizard; there is no separate read-only detail page.
  - Create Shipment Order button -> `/en/wms/shipment-order/form/add`. The route `/form/create` returns a 404.
  - Edit right rail: Assigned Jobs shows the job code, and "Show Change Log" opens the change-log modal.
- Breadcrumbs:
  - "Home > Orders > Shipment Order" and "Home > Orders > Edit Shipment Order"
  - "Home > Orders > Jobs > Job Management"
  - "Home > Fulfillment > Task Details > Order Operations"
  - "Home > Fulfillment > Shipment > Shipment Plan"
  - "Home > Orders > Carrier Shipment Details > End Of The Day"
  - "Home > Fulfillment > Outbound > Packing Station"
- 404 page: "We couldn't find the page you're looking for. / Maybe it doesn't exist anymore or never existed at all. / Error code: 404". It offers helpful links to Dashboard, Products, Purchase Order and Inventory.

## 1. Shipment Order: Order Backlog

- **Header:**
  - H1 "Shipment Order".
  - **Import** dropdown: Bulk Import Shipment Orders, Bulk Update Shipment Orders, Import Serial Numbers.
  - Primary **Create Shipment Order** button.
- **Toolbar** (left to right):
  - view switcher (list icon);
  - "Search by code" with a search button;
  - **Filter**;
  - **Label**, **Warehouse Ops**, Print (printer icon), Delete (trash icon) and Tag (bookmark icon). All of these are disabled until a row is selected;
  - Refresh.
- **Label menu:** Create Label, Reprint Label, Void Label, Create Return Label, Create Retailer Label, Reprint Retailer Label.
- **Warehouse Ops menu:** Ship Order, Create Backorder, Picking/Job Operations, Cancel Picking, Change Warehouse, Cancel Order, Resolve Pick Short, Resolve Pack Short, Unmerge Order.
- **Print menu:** Print Picking List, Batch Picking List, Print Packing Slip, Print Manifest / BOL, Pick/Pack Short Label.
- **Delete menu:** Delete Shipment Order, Remove Serial Number.
- **Tag:** Create Tag.
- **Columns** (58):
  - Order and channel: ORDER CODE, STORE ORDER NUMBER, COMPANY NAME, CHANNEL PAYMENT STATUS, STORE, AGE, ORDER PROCESSING AGE, TOTAL WEIGHT, CLIENT, WAREHOUSE, STATUS, PICK SHORT STATUS, PACK SHORT STATUS, TAGS, TOTAL QUANTITY, SKU, JOB CODE, CUSTOMER
  - Shipping and price: REQUESTED SHIPPING OPTION, CARRIER, SHIPPING SERVICE, IS AUTO SHIP, TRACKING NUMBERS, RATE, SALES PRICE, PICK LIST PRINTED
  - Dates: ORDER DATE, EXPECTED SHIPMENT DATE, CARRIER EXPECTED DELIVERY DATE, COUNTRY, ORDER TYPE, NOTE, CREATED DATE, ACTUAL DELIVERY DATE, ACTUAL PICKUP DATE, ACTUAL SHIPMENT DATE
  - Accounts and scheduling: CHARGED ACCOUNT NUMBER, TAX & DUTIES ACCOUNT NUMBER, PRIME ORDER, PRIORITY, SCHEDULED PICKUP DATE, EXPECTED DELIVERY DATE
  - Notes and references: EXTRA NOTE 1, EXTRA NOTE 2, FRAUD, ORDER CODE GROUPING REFERENCE, GIFT NOTE, BACK ORDER, SCHEDULED SHIPMENT DATE, STATE(REGION)
  - Retail: RETAILER, BOL, PRO, PO, DEPT, MARK FOR, CUSTOMER ACCOUNT NUMBER, IS UCC LABEL GENERATED
  - A gear icon at the right end opens the column chooser.
- **Cell formats:**
  - SKU lists are joined with "/ " (e.g. `testAutomationSKU-1/ shortageItem2`).
  - Customer shows as "Name / ST".
  - Weight keeps its native unit ("1.5 Pound", "4500 Gram").
  - Price shows as "150.00 USD".
  - Dates use "11/9/2026 8:42:33 AM".
  - Booleans show as Yes/No.
  - The Store column for manual orders reads "Created Manually".
- **Status pills** (computed; text color on a tinted background):

| Status | Text | Background |
|---|---|---|
| Open | rgb(23,135,77) | rgb(211,240,227) (green) |
| Ready to Pick | rgb(13,54,163) | rgb(213,229,242) (blue) |
| Ready to Ship | rgb(98,29,184) | rgb(223,206,245) (purple) |
| Shortage | rgb(161,52,6) | rgb(247,233,228) (orange/brown) |

- **Filter popover:**
  - Header "Select Filter Type", with a **New | Saved** segmented control and a "Search Filter" box.
  - Each item has a bookmark icon (save) and a "+" (add).
  - There are 67 fields: Actual Shipment Date, Address Verification Status, Age, BOL, Cancel Date, Canceled By Merge, Carrier, Carrier Expected Delivery Date, Carrier Setup Name, Channel, Client, Code, Country, Create Date, Custom Field Date 1-3, Custom Field Drop Down 1-2, Custom Field Text Box 1-3, Custom Field Toggle 1-2, Customer Account Number, Customer Name, Department, Expected Shipment Date, Has Allocated Inventory, Has Label, Has Pick Short Label Printed, Is Auto Ship, Is Back Order, Job Code, Kit SKU, Mark For, Merged Order, Merged Shipment Order Code, Order Code Grouping Reference, Order Date, Order Type, Pack Short Status, Partial, Pick List Printed, Pick Short Status, PO, Priority, PRO, Processing Age, Rate, Requested Shipping Option, Retailer, Sales Price, Shipping Service, Single Item Order, SKU, State (Region), Status, Store, Store Order Number, Tag, Total Quantity, Tracking Number, UCC Label Generated, Warehouse.
  - **Status filter values** (checkbox list with search, "< Status" back header, [Add Filter] disabled until one is checked): Cancelled, Loading Started, On Hold, Open, Packing Started, Partially Shipped, Picking Started, Ready To Load, Ready to Pack, Ready to Pick, Ready to Ship, Ready to Sort, Shipped, Shortage, Sorting Started. There are 15 values; note the casing "Ready To Load".
- **Row kebab "•••":** Edit and Delete appear as stacked white buttons in a popover. The spec also lists Show Details above them, which was clipped at the top of the grid.
- **Footer:** "Show 100 items" select, pager "1 / 36" with first/prev/next/last buttons, a green **Export As Excel** button, and "Total: 3544".

## 2. Shipped & Canceled Orders tab (`/shipment-order/shipped/list`)

- The header action is **Bulk Update Return Info** (it replaces Import and Create).
- The default filter chip is "Actual Shipment Date: Last 7 days".
- The toolbar has Label and **Create RMA**; Tag holds Create Tag.
- The columns are the Backlog set plus MERGED SO CODE, MERGED ORDER STATUS, CANCEL REASON and CANCEL DATE.
- Empty state:
  - "Could not find any shipment order"
  - "Try changing the filters or search term"
  - "No products? Create products before creating a shipment order. OR You can create shipment orders here."

## 3. Return Orders tab (`/shipment-order/return/list`)

- Subtitle: "You can monitor all the activities related to your return operations".
- The toolbar has Filter and **Change Status**; Tag holds Create Tag.
- Columns: SHIPMENT ORDER CODE, RMA CODE, STORE ORDER NUMBER, STORE, COMPANY NAME, RETURN ADDRESS, FROM COUNTRY NAME, STATUS, REQUESTED QUANTITY, RETURNED QUANTITY, SKU, CUSTOMER NAME, CARRIER NAME, CARRIER SHIPPING OPTION NAME, TRACKING NUMBER, PACK TYPE, RETURN ORDER CREATED DATE, SHIPMENT ORDER DATE, SHIPMENT ORDER DELIVERY DATE, EXPECTED RETURN DATE, ACTUAL RETURN DATE, CREATED BY, WAREHOUSE, CLIENT, TAGS.
- There is one row per SKU line. Example: team1testT7 / RMATRAINING1 / **Completed** / requested 2 / returned 2 / SKU2.

## 4. Create Shipment Order wizard (`/form/add`)

- **Header:** H1 "Create Shipment Order" with a back arrow and a top-right **Cancel Order** button.
- **Stepper:**
  1. Order Details
  2. Customer & Address
  3. Products
  4. Shipping
  5. Other Info
  6. Confirm
- **Step 2 indicator:** Step 2 shows a yellow "!" icon. Its tooltip reads **"Not Available for Verification"** (the address verification state).
- **Right rail:** an "Order Status" card ("Follow all the steps to complete the order", "%0" progress), a Summary card (Price, Discount $0.00, Total $0.00) and a **Save Order** button.
- **Step 1, "Enter the order details along with mandatory fields to proceed to Customer tab":**
  - Warehouse* (select, "Select warehouse")
  - Client* (select, "Select client")
  - Order Code* (text, max 50 with a counter; defaults to the next sequence "SO0009"; an "auto generated" link sits inline)
  - Order Type* (select, placeholder 'Select "Order Type" or create a new one from the data setup under the settings', with an info icon)
  - Order Date* (datetime, default now, format `2026/11/09 20:31`)
  - Expected Shipment Date* (datetime, default now)
  - Expected Delivery Date (datetime)
  - Carrier Expected Delivery Date (**disabled**)
  - Scheduled Pickup Date
  - Scheduled Shipment Date
  - Note (max 500)
  - Priority (numeric spinner, default 0)
- **Validation:** clicking Next Step with Warehouse, Client and Order Type empty does nothing. There is no toast and no inline text was detected; the step stays put.
- **Step 2, "Customer Information" ("Enter the customer's information and the corresponding shipment address."):**
  - Customer select with **New**; First name; Last name; Customer e-mail (type=email, placeholder example@email.com); Phone Number.
  - Shipment Address block:
    - Address Title (select)
    - Skip Address Verification (Yes/No)
    - Address Type (select)
    - Address line 1 (max 256)
    - Address line 2 (max 256)
    - Postal Code (max 10)
    - City
    - **Country*** (select)
    - Company Name
    - Tax Type (select)
    - Tax ID (disabled until Tax Type is chosen)
  - Billing choices: "Use Shipment Address As Billing Address" / "Enter a New Address For The Billing".
  - Buttons: Back, Next Step.
- **Step 3, Products:**
  - Toolbar: "Create New Product" link, Export, "Enter SKU and Add Product (At least 3 char.)", "Find SO Detail by SKU".
  - KPI strip: Number of SKU, Number of Kits, Total Qty.
  - Columns: IMAGE, SKU, NAME, PACK TYPE, UOM PACK TYPE, UOM RATIO, QUANTITY, PRICE PER ITEM, TOTAL PRICE, ORIGINAL SO CODE, STORE UPDATE NOTES, IS STORE UPDATED, KIT SKU NAME, EXPIRY DATE, LOT BATCH NUMBER, DAMAGE REASON, INVENTORY LOCATION, INVENTORY LP, ALLOCATED/CANCELLED/SORTED/PICKED/PACKED/SHIPPED/LOADED UOM QTY, PRODUCTION DATE, LINE NOTES 1-3.
- **Step 4, Shipping ("Select the Carrier and Shipment Service if available"):**
  - Carrier, Shipping Service, Shipping Charges Billing Type, Tax & Duties Billing Type.
  - Shipping Charges Account Number and Tax & Duties Account Number, each with a "Use Custom Account" toggle.
  - Packing Instructions (max 1000) and Shipment Package (select).
  - Total Shipping Cost (disabled), Current Tracking Number (disabled), Carrier Reason For Export (default "Sale").
  - Tracking Numbers: "Enter and add tracking number" plus [Add].
  - **Return (BETA)** section: Return Address Name, Return Carrier, Return Shipping Option, Return Shipping Cost (disabled), Return Tracking Numbers with [Add].
- **Step 5, Other Info:**
  - Extra Note 1-5 (each max 500), Client Reference Code, Fraud (max 500).
  - Packing Warning Type (select), Gift (Yes/No), Order Code Grouping Reference (disabled).
  - Retailer subsection: Retailer select, BOL, PRO, PO, Dept, Mark For, Retailer Customer Account Number.
  - "Add/Edit Custom Field" link.
- **Step 6, Confirm ("Do your final check and complete the order"):** a PRODUCTS list (SKU, name, "1 Each", price), Customer, Shipment Address, Billing Address, an Order Details block (code, Order Type, Client, Order Date, Expected Shipment Date, warehouse) and Shipment. The only button is Back; saving happens from the rail.

## 5. Edit Shipment Order (`/form/edit/{guid}`), example KS-REF-SO-001 (Ready to Ship)

- This is the same wizard. Warehouse and Client display as read-only text. All steps are navigable with Next Step / Back.
- Step 2 accepted Next with Country empty in edit mode.
- **Rail:**
  - **Save Shipment Order** (primary blue, full width).
  - **Other Actions** for a Ready to Ship order: Ship Order (enabled), Delete Order (disabled), Cancel Order (disabled).
  - Summary card: Order Code, Warehouse, Order Type, Store Order Number, Status pill, Last Update Date, **Show Change Log**, Price/Discount/Total in USD.
  - Assigned Jobs: Job6249022, "MLT1 D2C Picking".
  - Billing Charges: "Download Billing Charges / Click to download the latest billing charges".
  - Printouts: Shipment Label Not Available, Other Documents Not Available, Packing Slip Available, Picking List Not Available.
- **Narrow layout:** at narrow widths the rail stacks below the form, and a second Save button appears at the bottom.
- **Step 3 in edit mode:** shows live allocation counts, e.g. Packed UOM Qty = 1 for the Ready to Ship order.

## 6. Job Management (`/job/management`)

- Subtitle: "From this section, you can create new jobs or manage created jobs."
- Toolbar: Filter (with a "+1" chip count), **Update Priority**, **Cancel**, User Actions, Label. The footer has Export As Excel.
- Columns: WAREHOUSE, CLIENT, WAVE NO, RULE NAME, JOB CODE, JOB TYPE, ORIGINAL IO JOB TYPE, STATUS, PRIORITY, OPERATION TYPE, ASSIGNEE, ORDER COUNT, PRODUCT COUNT, NUMBER OF TASKS, PENDING TASKS, COMPLETED TASKS, ACTUAL START/FINISH DATE, CREATED DATE, CREATED BY USER, PENDING PICKING TASKS, PENDING PACKING TASKS, MOBILE CART, PICKING ZONE, START DATE, END DATE, NUMBER OF LOCATIONS, NUMBER OF SKUS, LABEL STATUS ("No Label"), PICK LIST STATUS ("Not Printed"), RESOLUTION JOB, PRE-CARTONIZATION JOB.
- Example row: wave "20696-7", Job6239729, type "AI-OrderBasedPickPack", original type "Multi Item Orders", status **Pending**, operation "Picking", created by "Integration".

## 7. Task Details: Order Operations

- The default filter is "Job Status in Pending, Started". The toolbar has Task Operations and User Actions.
- There are about 60 columns, including WAVE ID, TASK ID, JOB CODE/TYPE, AI JOB DESCRIPTION, ORDER CODE, TASK TYPE (Picking), TASK STATUS (Pending), TASK PRIORITY, AI TASK SEQUENCE, SKU, PRODUCT NAME, BARCODE, SUGGESTED SHIPMENT PACKAGE TYPE, TARGET LP TYPE, PACK TYPE, TASK UOM QTY, ACTUAL QTY, PLANNED QTY, SOURCE/TARGET LOCATION (+ZONE, display member), SOURCE/TARGET LPN, TARGET CART, ASSIGNEE, EXECUTED BY USER, PLANNED START/FINISH, LOT/BATCH, EXPIRY, CHANNEL, CARRIER, CUSTOMER, CUSTOMER ADDRESS, and the parent LP / original LP fields.

## 8. Shipment Plan (`/shipment-plan`)

- Header: **Create Shipment Plan**. Tabs: SHIPMENT PLAN | SHIPMENT PLAN ORDERS | SHIPMENT PLAN LPS.
- Toolbar: Filter, **Delete**, **Ship**, Print, **Picking/Job Operations**.
- Columns: PLAN CODE, STATUS, WAREHOUSE, CUSTOMER, CUSTOMER ADDRESS, CREATED DATE, PLANNED SHIPMENT DATE, ACTUAL SHIPMENT DATE, CARRIER, TRUCK PLATE NUMBER, LOADING GATE, RETAILER, LOADING START DATE, LOADING COMPLETE DATE, TRUCK DEPART DATE.
- A "Large/Small" density toggle sits in the footer. Example row: KS-TEST-SP-001, **Open**, MLT1.

## 9. Carrier Shipment Details (`/shipment`)

- Default filter: "Label Create Date: Last 30 days".
- Columns: WAREHOUSE, INVENTORY LOCATION, CLIENT, ORDER CODE, ORDER STATUS, CUSTOMER, PRODUCTS, CUSTOMER ADDRESS ("812 Shelton Beach Rd,,Saraland,AL,36571,US"), LABEL CREATE DATE, CARRIER EXPECTED DELIVERY DATE, CARRIER ("UPS - UPS-TEST Logiwa"), SHIPMENT METHOD (Ground), RATE SHOPPING, RATE SHOPPING NAME, RATE, LABEL TYPE ("Shipping Label"), MASTER TRACKING NUMBER, TRACKING NUMBER, ACTUAL SHIPMENT DATE, DELIVERY DATE, VOID DATE/TIME, INSURANCE TYPE/VALUE, CONFIRMATION TYPE, WEIGHT/HEIGHT/WIDTH/LENGTH, DIMENSION UNIT, SHIPMENT PACKAGE TYPE, WEIGHT UNIT, SHIPPING COST, ZONE, OTHER COST, CURRENCY, IS ALLOW SATURDAY DELIVERY, LABEL STATUS (Active), SCHEDULED/ACTUAL PICKUP DATE, INVENTORY PARENT LPN, EXTERNAL REFERENCE.
- There is one row per package/label.

## 10. End Of The Day (`/shipment/end-of-day`)

- Subtitle (typos are Logiwa's own): "End of the Day Report helps you monitor total packages of the shipments based on your clients and the carriers for espacially reconcillation".
- Toolbar: **Print Custom Report**, **Print End Of The Day Report**, **Reprint**.
- Columns: PREFIX, CARRIER (logo + "UPS"), SHIP FROM, SHIP DATE, CLOSE DATE, REPORT PRINTED? (No), TOTAL PACKAGE.
- Rows are grouped per carrier setup per ship date.

## 11. Shipment History

- Subtitle: "Shipment history is a report which lists all past ship order actions and remove inventory actions."
- Columns: ORDER CODE, ORIGINAL ORDER CODE, STORE ORDER NUMBER, SKU, PRODUCT NAME, BARCODE, PO NUMBER, LOT/BATCH, TRACKING, EXPIRY, QUANTITY, PACK TYPE, UOM PACK TYPE, SHIPMENT PACKAGE, KIT SKU NAME, RETAILER, PACKAGE WEIGHT, MASTER SHIPMENT ORDER CODE, IS BACK ORDER, SHIPMENT DATE, SHIPMENT TYPE ("Shipment Order"), NOTE, CLIENT, WAREHOUSE, LOCATION (Packing), LPN, the LP fields, RECEIVING DATE, PRODUCTION DATE.

## 12. Packing Station (`/packing-station`)

- Selectors: Warehouse* (MLT1 - Test Warehouse) and Packing Station* (MLT1-PACK).
- "Start Packing" panel text: "Please select one of the buttons below to start packing. You can start with scanning a tote or scanning a location/car or you can simply select an order from the list and start packing depending on your process."
- Four start buttons: **Scan a Tote**, **Scan a Location**, **Scan a Putwall/Mobile Cart**, **List and Select Order**.
- User card: initials avatar "ML", the name, the role "Supervisor", and stats "Number of Orders You Packed Today", "Number of Products You Packed Today" and "Total Number of Orders to be Packed".

## 13. Return Station (`/return-station/dashboard`)

- Selectors: Receiving Warehouse and Return Station (KS-REF-RET-01).
- "Return Target Locations": "Set target location/LP for returned items." It has Location | LP toggles and a "Select Location" field.
- "Start Return": "Choose a method to start the return process." with two buttons, **Return With RMA** and **Return Manually**.
- User stats: "Nof Returned Orders Today", "Nof Returned Products Today", "Total Nof Orders to be Return".

## Delta vs existing spec (references/logiwa-spec/01-orders.md, 02-fulfillment-ops.md)

1. **The order-code cell now navigates.** Clicking the code opens `/form/edit/{guid}`. Spec §1 says it "did not navigate"; make the code a link.
2. **Other Actions on a Ready to Ship order:** Ship Order is enabled, while Delete Order and Cancel Order are disabled. This extends the spec's Open and Ready to Pick cases.
3. **Step 2 "!" tooltip text** is exactly "Not Available for Verification".
4. **Next Step with Step 1 empty** gives silent non-advance: no toast and no inline messages.
5. **Edit mode does not require Country** to move past Step 2.
6. **Order code sequence** is now SO0009, which shows that the sequence keeps advancing even for abandoned drafts.
7. **`/form/create` returns 404**; the canonical route is `/form/add`.
8. **Status filter values:** 15 values captured (they include Ready to Sort, Sorting Started, Loading Started and Partially Shipped), with the casing "Ready To Load".
9. **Pill RGB values** were captured for Open, Ready to Pick, Ready to Ship and Shortage (table in §1). Verify they match the spec's 02 §0 table.
10. **Shipped tab:**
    - "Bulk Update Return Info" header action and "Create RMA" toolbar button;
    - default "Last 7 days" chip;
    - the exact empty-state copy recorded in §2.
11. **Return Orders:** the "Change Status" bulk action and the full 25-column list.
12. **Job Management:** "Update Priority" and "Cancel" are direct toolbar buttons. Columns include ORIGINAL IO JOB TYPE, RESOLUTION JOB and PRE-CARTONIZATION JOB.
13. **Shipment Plan:**
    - three sub-tabs (PLAN / ORDERS / LPS);
    - toolbar actions Delete, Ship, Print and Picking/Job Operations;
    - truck columns: plate, gate, loading start/complete, depart.
14. **End Of The Day:** three print actions (Custom / EOD / Reprint) and the "REPORT PRINTED?" column.
15. **Packing Station:** the fourth start mode, "Scan a Putwall/Mobile Cart".
16. **Return Station:** the Location/LP target toggle, plus two start modes (With RMA / Manually).
