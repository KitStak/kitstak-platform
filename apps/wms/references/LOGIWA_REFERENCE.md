# Logiwa iO — Observed Design Language & IA (captured 2026-11-05, MLT1 sandbox)

Screenshots in `references/logiwa/*.jpg`. Every build agent MUST read the relevant
screenshot(s) before writing UI, and every critic compares against them.

## Shell

- **Top app bar, dark indigo-navy** (~#3E4784 / indigo-800 family), 56px tall.
  Left: white Logiwa mark + wordmark. Center-left: nav items (Fulfillment, Inventory,
  Automation, Integrations, Reports, Analytics, Settings) — 13px semibold white, mega-menu
  flyouts on click. Right: pill-shaped Search (dark translucent, magnifier icon), then icon
  cluster: video/help, history, print, help, user avatar — all ghost icons in a rounded group.
- **No left sidebar.** Content canvas is very light gray (#F7F8FA).
- **Breadcrumb** below bar: `Home > Orders > Shipment Order` — 11px gray, chevron separators.
- **Dashboard filter row**: two bordered white selects "Filter by [Warehouse ▾] [Client ▾]"
  with checkbox-list dropdowns, search-within-filter, and a full-width blue "Add Filter" button.

## Page header pattern (list pages)

- Page title 20px/600 dark slate + tiny centered helper text (gray, 11px) + right side:
  secondary bordered button ("Import ▾") and primary solid blue button ("Create Shipment Order").
- **Underline tabs** below title: 12px uppercase, active = blue text + 2px blue underline
  (e.g. ORDER BACKLOG | SHIPPED & CANCELED ORDERS | RETURN ORDERS).

## Toolbar (above grid)

Left: density/view icon-dropdown, search input "Search by code" with attached square icon
button, "Filter ▾" chip button. Right: contextual bulk actions **disabled until selection**
(Label ▾, Warehouse Ops ▾, Tag, Cancel Order, Receive PO, Delete ▾), then print/trash/bookmark
icons and a refresh icon. All 32px height, white, 1px #E3E6EB border, 6px radius.

## Data grid

- 11px uppercase gray (#8A94A6) column headers, white header bg, hairline row dividers.
- Rows ~40px ("Small" density; "Large" toggle exists). First col checkbox; second col
  **blue link** (order code / SKU / PO number). Row-end "•••" actions. Column gear icon top-right.
- **Status pills**: soft bg + dark text — Completed/green (#E6F6EC/#1E8E3E), Started/blue,
  Pending/gray, Ready to Pick/blue, Open/amber-ish, High priority/red w/ ↑ arrow.
- Store/channel cells show **brand badges** (Shopify green bag + store name, ShipStation logo,
  "Created Manually" green doc icon).
- Horizontal scroll with MANY columns (shipment orders has 60+; defaults visible: Order Code,
  Store Order Number, Company Name, Channel Payment Status, Store, Age, Order Processing Age…).
- **Footer bar**: left `Large | Small` segmented toggle + "Show 100 items ▾"; center pager
  `|< < 1/33 > >|` with editable page box; right green-outline "Export As Excel" + "Total: 3,234".

## Detail/edit pages

Wizard stepper card across top: Step 1 Order Details → Step 2 Customer & Address → Step 3
Products → Step 4 Shipping → Step 5 Other Info → Step 6 Confirm. Each step = icon + colored
label + green check when complete / yellow ! when attention. Main form card (2-col, labeled
inputs with * required, char counters, date pickers) + blue "Next Step" bottom-right.
**Right rail**: primary "Save Shipment Order" button, "Other Actions ▾", Summary card
(Order Code, Warehouse, Order Type, Status pill, Last Update + "Show Change Log" link,
Price/Discount/Total), Assigned Jobs card (+ add), Billing Charges card.

## Dashboard widgets

- "Progress for Today" card: Day Shift header w/ date + time range (12:43 green - 17:00),
  blue progress bar w/ sun/moon icons; stacked metric rows (Tasks 23% Completed 18-80,
  Order Lines, Orders to be Shipped Today) each with thin progress bar, green current value.
- "Unfulfilled Orders": big donut (Total Order count center) + legend rows Total/Open/In
  Progress with Total Order & Total Pack Quantity columns; Open label amber, In Progress blue.
- "Order Breakdown by Status": 4-column text grid `Status : count` (Open: 3191, Ready to
  Pick: 16 …).
- Rank cards row (Channels / Clients / Carriers / Order By Country): icon tile + title +
  gray description, then ranked list "1. Others — 100% of All Orders — 2".
- "Jobs" card with Priority/Status/Type tab filters and mini table (Name, Product Qty,
  Order Qty, Percentage, Job Qty).

## IA / route map (observed)

- Fulfillment: Shipment Orders, Shipped Orders, Carrier Shipment Details, End Of The Day,
  Packing Station, Job Management, Task Details (Order Ops/Count/Replenishment), Shipment
  History, Shipment Plan, Purchase Orders, Receiving History, Return Station, Return Orders,
  Work Orders.
- Inventory: Total Inventory, Inventory by Location, ATP, Count Plan, Count Location/SKU
  Details, Products, Product Listings, Locations, Vendors, Customers, Retailers, Warehouse,
  LP Types, LP Numbers.
- Automation: Algorithms, Workflows, Rate Shopping, Wave Rules.
- Integrations: Channel/Carrier Integrations, monitoring, health.
- Reports: Channel Sales, Shipment History, Shortage, ATP, Kit Inventory, Serial Numbers,
  Inventory Snapshot, Change Log, Transaction History, User Performance, Billing.
- Settings: Warehouse, Mobile Carts, Printouts & Labels, Job Types, Screen Config, 3PL
  Billing, Apps, Users.

## Example data flavor (MLT1 / Team 1 sandbox)

Clients: Kitt Solutions Inc., Hoot Foods LLC, Ultra Marketing Inc., Paqari, Smiley Coffee
LLC, Rapid Prototype, Todson Inc., Explore Scientific LLC, SENS Coffee, BigFace Coffee…
Order codes: `SO0006`, `SHP-811074158`, `SPY-7583336956065`; Jobs `Job6212280` typed
"Single Unit Orders / Multi Item Orders / Cycle Count / Dynamic Replenishment"; SKUs like
`BMS-2Hole_Flange`, `FL-AR1021000…`; carriers "FedEx Home (3-5 Business Days)",
"USPS Economy"; statuses Open / Ready to Pick / Shortage / Cancelled.

## Login page

Split layout: left photo panel w/ overlay copy ("Ecommerce Fulfillment Made Easy"),
right white panel: logo + tagline, "Log In" 24px bold, Email*/Password* labeled inputs,
full-width primary Sign In (disabled until valid), "Forgot Password?" link, divider "or",
bordered "Log In With SSO" button.
