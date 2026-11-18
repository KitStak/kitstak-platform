# KitStak Pulse: competitive research

Date: 2026-11-17. Author: research agent.

## How to read this file (evidence levels)

- **[S]** = seen in web search result snippets this session (vendor pages, press releases, listings). Mostly vendor marketing, not independently verified.
- **[K]** = from general industry knowledge of the product category. Not verified this session.
- **[U]** = unverified inference. Treat as a reasonable guess.

Network limit: direct page fetches of `www.easymetrics.com` were blocked in this session (host not in the allowed network list), so nothing below was read from a full page. Everything about Easy Metrics comes from search snippets plus prior knowledge. No screenshots or UI walkthroughs were seen. No independent user reviews exist to cite: G2 says it has too few reviews for EasyMetrics, SourceForge shows 0.0 with no reviews, and no Capterra listing surfaced [S]. So the "complaints" in section 3 are structural weaknesses inferred from how the product is built and sold, not quotes from unhappy users.

Sources used (search snippets only):
- easymetrics.com/profit-management and /warehouse-performance-management-platform/profit-management/
- easymetrics.com/news: Profit Management launch release (also on Yahoo Finance and SDC Exec), Targeted Cost to Serve (TCTS) launch
- easymetrics.com/solutions/cost-to-serve/, /what-is-cost-to-serve/, /labor-management-system/, /platform-overview/opsfm/, /rapid-implementation-powered-by-streamlined-data-integration/
- easymetrics.com whitepaper "Automating 3PL Profit Management" (2025)
- g2.com/sellers/easymetrics, sourceforge.net Easy Metrics listing, deposco.com alternatives posts (competitor written)
- nulogy.com/solutions/shop-floor, /co-packing-software/, softwarefinder.com Nulogy listing
- extensiv.com 3PL reports and Billing Manager pages, datexcorp.com billing posts

---

## 1. Easy Metrics Profit Management: feature checklist

### 1.1 Positioning and packaging
| Item | What it does | Evidence |
|---|---|---|
| Product type | Cloud SaaS. Launched as an **add-on** for 3PLs that plugs into an existing Easy Metrics subscription | [S] |
| Requires an LMS feed | Needs Easy Metrics ProTrack / LMS, or "any LMS that allocates time spent on a process". 3PLs with no LMS are told to buy OpsFM alongside it | [S] |
| Tiers | OpsFM (entry, operations and finance view), LMS (full labor management), Profit Management as add-on | [S] |
| Headline claim | "Boost operating margins by up to 3%". LMS claims: up to 40% productivity gain, 15 to 25% labor cost savings | [S] vendor claim |
| Buyer | 3PL operators, multi site warehouse networks, finance and ops leaders | [S] |
| Pricing | Not published. Quote only. Vendor contrasts itself with "traditional LMS at $250K to $1M per facility" | [S] |
| Marketing page quality | The live Profit Management page was reported to contain leftover "FPO Subhead Placeholder" text | [S] |

### 1.2 Data inputs
| Input | Detail | Evidence |
|---|---|---|
| WMS transactions | Picks, putaways, receipts, loads, units, lines, by customer and process. Pulled by file feed or integration | [S] |
| Time and attendance | Clock in and out hours and pay from timeclock or payroll | [S]/[K] |
| Process time allocation | Time each employee spends on each process (from LMS, kiosk, or scans) | [S] |
| Financial data | Revenue or billing by customer, wage and cost data, to build a customer account level cost model | [S] |
| Manual data entry | Not promoted. Product is integration fed. Kiosk or tablet entry exists in the LMS for indirect time | [K] |
| CSV self service import | Not promoted as a self service feature. Data mapping is done by the vendor team ("mapping of client data takes about two weeks once received") | [S] |

### 1.3 Cost model
| Capability | Detail | Evidence |
|---|---|---|
| Activity based costing (ABC) | Apportions labor cost to customers based on actual workflow activities | [S] |
| Starts from actual spend | Uses real payroll spend, not estimates, so missing time and indirect labor show up | [S] |
| Missing time | Gap between paid hours and hours tied to work. First 30 days of rollout focus on finding it | [S] |
| Indirect labor | Tracked and allocated across customers and processes. Exact allocation rules not public | [S]/[U] |
| Loaded labor rate | Wage plus burden per hour. Method not documented publicly | [K]/[U] |
| Overhead / facility cost | Allocation model "apportions costs by customer and process". Depth of non labor cost (rent, equipment, materials) unclear | [S]/[U] |
| Material cost per job | **Not a feature.** Model is labor and warehouse activity centered, not job or BOM centered | [U] |
| Labor standards | Engineered or historical standards per process in the LMS, used for performance % | [K] |

### 1.4 Cost to serve and profit views
| Capability | Detail | Evidence |
|---|---|---|
| Cost to serve by customer | Actual labor cost per process per customer versus estimate | [S] |
| Slices | Customer, process, site (facility). Also order profile, fulfillment path, service tier | [S] |
| Margin by customer and product | Listed on the solutions page | [S] |
| Labor cost as % of revenue by customer | Named dashboard metric | [S] |
| Planned vs actual operational profitability | Variance dashboard | [S] |
| Targeted Cost to Serve (TCTS) | Newer metric. Recalculates a workload adjusted target cost from order profile, process complexity, product mix and workflow variability, then compares actual to target | [S] |
| Cost and margin variance drivers | "Identify drivers of cost and margin variance" | [S] |
| Pricing support | Adjust pricing based on true cost to serve. A "Price Discovery Guide" PDF exists | [S] |
| Quote vs actual per job | **Not a named feature.** Closest is planned vs actual at customer level | [U] |
| Profit per job / work order | **Not a named feature.** Unit of analysis is customer, process, site | [U] |
| VAS / kitting line profit | Handled only if VAS is mapped as a process. No kitting specific view | [U] |

### 1.5 Dashboards, alerts, reports
| Capability | Detail | Evidence |
|---|---|---|
| Real time dashboards | "Real time profitability by customer, process and site". In practice refresh depends on feed cadence, often daily | [S]/[U] |
| Ops plus finance shared view | Same cost and performance data for both teams | [S] |
| Employee and team performance | Productivity %, utilization, scorecards, pay for performance bonus maths (LMS) | [S] |
| Alerts | Not prominently marketed for profit. LMS has exception and coaching reports | [K]/[U] |
| Report export | Standard export to Excel or CSV and scheduled emails are typical | [K] |
| Forecast / at risk prediction | Not marketed for Profit Management | [U] |
| Network benchmarking | Compare sites across the network | [K] |

### 1.6 Integrations and rollout
| Capability | Detail | Evidence |
|---|---|---|
| WMS agnostic | "Adaptable to any WMS" via file feeds | [S] |
| Implementation time | OpsFM insights "in as little as four weeks". LMS "about 1 month", with 2 weeks of data mapping | [S] |
| Who does setup | Vendor implementation team plus ongoing training and periodic reviews | [S] |
| CRM or project system link | None promoted | [U] |
| Standalone, no other system | **No.** Needs WMS and time data feeds plus an Easy Metrics base product | [S] |

---

## 2. Three strongest peers (brief)

### 2.1 Nulogy Shop Floor (strongest peer for kitting and contract packaging)
- **What it is:** co-packer and contract manufacturer platform: production control, scheduling, job costing, materials planning, inventory, quality, shipping [S].
- **Data inputs:** barcode scans and mobile screens on the line. Output, labor, materials and yield captured per job per line as it runs [S].
- **Cost model:** labor and materials recorded against each job, so "cost per job is a number instead of an estimate". Plan and cost materials per job before it starts [S].
- **Profit views:** real time job and customer profitability (per third party listing), line performance per shift [S].
- **Strengths:** true job level actuals, customer owned inventory, BOM changes mid run, quote estimating [S]/[K].
- **Weaknesses:** it is a full shop floor ERP replacement. Heavy rollout, enterprise price, needs scanners and floor discipline. Not usable as a light profit layer on spreadsheets. No public pricing [K]/[U].

### 2.2 Extensiv 3PL Warehouse Manager + Billing Manager (strongest peer for 3PL revenue side)
- **What it is:** 3PL WMS with automated billing [S].
- **Data inputs:** WMS transactions, billable events captured automatically ("never miss a chargeable event") [S].
- **Cost model:** revenue side is strong (rate cards, storage, handling, VAS charges). Cost side is thin: labor productivity metrics "allow leaders to track cost to serve" but there is no loaded labor cost model or job budget [S]/[U].
- **Profit views:** 60 standard reports including Customer Pricing. Custom reports need paid professional services [S].
- **Weaknesses:** knows what you billed, not what it cost you. No quote vs actual. No daily production entry with headcount. Reports are tabular and dated [U].

### 2.3 Takt (strongest peer for modern labor management UX)
- **What it is:** cloud labor management for warehouses, real time in shift visibility and coaching alerts [S, from a competitor written post].
- **Data inputs:** WMS and timeclock integrations, tablet time tracking [K].
- **Cost model:** labor cost per unit and per process, cost to serve style allocation by customer [K]. The competitor post says finance and multi client needs are partly out of scope [S, biased source].
- **Profit views:** labor cost by customer and activity. No materials, no quotes, no job P&L [K]/[U].
- **Weaknesses:** labor only, integration led setup, no standalone CSV mode marketed, no kitting concepts [U].

### 2.4 Others, one line each
- **Rebus:** labor management plus warehouse analytics on top of WMS data, real time dashboards. Labor only, enterprise sale [K]. No results surfaced this session.
- **Datex Footprint:** WMS with per client charge tracking, revenue and cost projections per client, cost splitting between entities [S]. Billing first, not margin first.
- **Katana / MRPeasy / Fishbowl:** small manufacturer MRP. Manufacturing order cost = materials (BOM, moving average) + operations time x hourly rate, planned vs actual per order [K]. Weak for 3PL: no customer owned material, no per client P&L, no VAS billing, labor rate usually a flat station rate not a loaded rate. Details unverified this session.
- **Cost to serve BI tools (Advantive, ChannelDock dashboards, spreadsheets):** dashboards on top of exported data. Spreadsheets are still the dominant tool for 3PL profit analysis [S].

---

## 3. Known weaknesses and complaints

No independent complaint data exists publicly (see evidence note). These are structural gaps, each tagged.

| # | Weakness | Why it matters to a kitting shop | Evidence |
|---|---|---|---|
| 1 | **Not standalone.** Profit Management is an add-on that needs Easy Metrics LMS or OpsFM plus WMS and timeclock feeds | A shop with only spreadsheets cannot start | [S] |
| 2 | **Setup takes weeks and a vendor team.** About 4 weeks, 2 of them data mapping by the vendor | No same day value | [S] |
| 3 | **No public pricing, sales led** | Small and mid shops cannot self qualify | [S] |
| 4 | **Weak manual data entry.** Built for feeds, not for a supervisor typing in units, headcount and hours at end of shift | Daily production entry is the core habit for kitting | [K]/[U] |
| 5 | **No job as a first class object.** Unit of analysis is customer, process, site. No job budget, no quote vs actual per job | Kitting is sold and run by the job | [U] |
| 6 | **No material cost.** Labor centered ABC. Kitting margin often lives in materials, scrap and rework | Margin is wrong without it | [U] |
| 7 | **Concept heavy.** ABC, cost to serve, TCTS, missing time, utilization vs productivity. Needs training and "ongoing periodic reviews" | Fails the 8th grader test | [S]/[U] |
| 8 | **Trust in labor data.** Vendor's own 2026 research says trust in warehouse labor data is a major barrier to cost to serve adoption | Users cannot see how a number was built | [S] |
| 9 | **No CRM or quoting link.** Cannot pull the quoted price or estimate | Quote vs actual impossible without re keying | [U] |
| 10 | **Lagging, not predictive.** Shows what happened. No "this open job will lose money at the current pace" | Too late to fix | [U] |
| 11 | **No self service CSV in and out per stream** | Locked to integrations | [U] |
| 12 | **Little market proof.** No G2 or Capterra reviews, marketing page with placeholder text | Buyer risk | [S] |
| 13 | **Peers have the opposite gap.** Nulogy has jobs but is a heavy ERP. Extensiv has revenue but not cost. Takt has labor but not materials or quotes | Nobody offers a light, job level profit tool | [S]/[U] |

---

## 4. Capability targets for Pulse

Each line is a testable statement. A critic can mark pass or fail.

### 4.1 Must match (25, ranked by importance)

1. Pulse shows revenue, cost, profit and margin % for every job, with cost split into labor, material and other.
2. Pulse shows the same four numbers rolled up by client, by job type and by VAS (service line), for any date range.
3. A user can record daily production for a job: date, kits or units finished, headcount, hours, and it saves in under 3 clicks after typing.
4. Pulse computes loaded labor cost per hour (wage plus burden %) and applies it to every hour entered. Rates can differ by role or labor class and have effective dates.
5. Pulse computes labor cost per unit and units per labor hour for every job and day.
6. Each job has a budget (revenue, labor hours, labor cost, material cost, units) and a budget vs actual view with variance in dollars and percent.
7. Pulse shows planned vs actual profit for a client over a period (Easy Metrics "planned vs actual operational profitability").
8. Pulse shows labor cost as a percent of revenue by client.
9. Pulse records material cost per job (item, quantity, unit cost, scrap) and totals it into job cost.
10. Pulse supports indirect time (meetings, cleanup, waiting) and shows it apart from direct job time.
11. Pulse shows "missing time": paid hours minus hours tied to jobs, per day.
12. Pulse spreads overhead or indirect cost across jobs by a clear rule (per labor hour or percent) that the user can set and see.
13. Pulse shows cost to serve per client: total cost divided across the units or orders served.
14. Pulse supports a target cost per unit per job type and flags actuals above target (TCTS style).
15. The home dashboard shows period revenue, cost, profit, margin, and trend vs the prior period.
16. Every chart and table can be filtered by date range, client, job type, site and status, and filters persist in the URL.
17. Pulse supports more than one site or facility, with profit by site.
18. Every list and report exports to CSV with the filters applied.
19. Pulse shows productivity vs standard (units per hour vs a target rate) per job and per day.
20. A user can drill from any total to the rows behind it (client to jobs to daily entries).
21. Pulse ranks clients and jobs by profit and by margin, best and worst.
22. Pulse shows a variance breakdown for a job: how much of the miss came from rate, hours (efficiency), material and price.
23. Role based access: floor lead can enter production, only managers and finance see money. Org scoped data.
24. Edits to money data (rates, budgets, entries) are logged with who and when.
25. Pulse supports a what if price check: given actual cost, show the price needed to hit a target margin.

### 4.2 Where Pulse can clearly beat them (15, ranked)

1. **Standalone in minutes.** With no other KitStak app and no integrations, a new org can import CSV or type data and see a job profit number within 10 minutes of first login.
2. **CSV in and out for every stream.** Jobs, production entries, labor rates, materials, budgets, quotes and clients each have a downloadable template, an import with row level error messages and a preview before save, and an export. A round trip (export then import) creates no duplicates.
3. **Quote vs actual per job.** Each job shows quoted price, quoted hours, quoted material and quoted margin next to actuals, line by line. Easy Metrics has no job quote view.
4. **Open jobs risk list.** One screen lists all open jobs with a status of On track, At risk or Losing money, sorted worst first, with the plain reason ("Labor is 22% over budget with 40% of units left").
5. **Projected final margin.** For every open job Pulse projects cost and margin at completion from the current pace (units per hour so far and units left), and shows it before the job ends.
6. **Plain language everywhere.** No screen uses the terms "activity based costing", "TCTS" or "burden" without a one line plain explanation. Every number has a "How we got this" popover that shows the formula with the real figures.
7. **Fast daily entry built for a supervisor.** A grid for the whole day (all jobs in one view), keyboard only entry, copy yesterday's crew, works on a tablet, and inline checks ("12 people x 8 hours is 96 hours, you typed 9.6").
8. **Material cost in the margin.** Job margin includes materials, scrap and rework. Easy Metrics is labor centered.
9. **Deep suite links.** When bundled: jobs come from Projects, clients and quotes from CRM, kit builds, picks and material usage from WMS, and each Pulse record links back to its source record in one click. Portal shows the Pulse tile and client facing summaries where allowed. With the other apps absent, the same screens work with typed or imported data and no broken links.
10. **VAS profit view.** Profit by service line (kitting, labeling, rework, assembly, bundling) with revenue per unit, cost per unit and margin. Neither Easy Metrics nor Extensiv has this as a first class view.
11. **Labor rate builder.** A user builds the loaded rate from wage, payroll tax %, benefits %, and overhead per hour, sees the result update live, and can keep temp agency and overtime rates apart.
12. **Alerts that say what to do.** Rules (margin below X%, labor over budget by Y%, no production entry for an open job for N days) create items in an inbox with a suggested next step and a link to the job.
13. **Same day truth.** A production entry changes job, client and dashboard numbers on the next page load, with no nightly batch.
14. **Demo data and guided setup.** A new org gets a 5 step checklist (set a labor rate, add a client, add a job, enter a day, see profit) and can load or clear sample data with one click.
15. **Transparent, auditable numbers.** Every rollup total equals the sum of its drill down rows to the cent, proven by automated tests, and money is stored in integer cents.

---

## 5. Scoring rubric: Pulse vs Easy Metrics Profit Management

Score each category 0 to 10 for each product. Anchors: 0 = absent, 3 = exists but weak or needs workarounds, 5 = works for the common case, 7 = solid and complete, 9 = best in class, 10 = nothing left to add. Score Easy Metrics from public evidence in sections 1 and 3, and note it is not hands on. Pulse should be scored only on what was actually run and seen.

| # | Category | What to check | Easy Metrics baseline (estimate, not hands on) |
|---|---|---|---|
| 1 | **Profit visibility** | Revenue, cost, margin by job, job type, client, VAS, site. Drill down. Totals reconcile | 7 (strong by customer, process, site. No job or VAS view) |
| 2 | **Job costing and budget vs actual** | Job budget, quote vs actual, variance breakdown, projected final margin | 3 (planned vs actual at customer level only) |
| 3 | **Daily production entry** | Speed, grid entry, tablet use, validation, edit and history | 3 (feed driven. Manual entry is not the design) |
| 4 | **Cost model depth** | Loaded labor rates, effective dates, indirect and missing time, overhead rule, materials, targets | 7 (deep labor ABC and TCTS. No materials) |
| 5 | **Risk and alerts** | Open jobs at risk and losing money, reasons, alert rules, inbox, forecasting | 4 (variance dashboards, little proactive job alerting) |
| 6 | **Data in and out** | CSV template, import preview, error rows, export for every stream, round trip safe | 4 (vendor mapped feeds, standard exports) |
| 7 | **Integration depth** | Live links to WMS, CRM, Projects, Portal. Source links. Works when the others are absent | 6 (any WMS and timeclock by feed. No CRM, quote or project link. Not standalone) |
| 8 | **Ease of use** | 8th grade copy, explain this number, time to first insight, onboarding, empty states | 5 (concept heavy, weeks of setup, needs training) |
| 9 | **Visual and interaction quality** | Consistent with KitStak theme, charts, responsive, keyboard, loading and error states, accessibility, dark mode | 6 (modern BI style dashboards, unverified) |
| 10 | **Enterprise readiness** | Roles, org isolation, audit log, multi site, correctness tests, performance, no dead ends | 7 (mature SaaS, multi site, established customers) |

Easy Metrics estimated total: **52 / 100** for a kitting or contract packaging buyer. (For a large multi site 3PL with an LMS already in place it would score higher, around 65 to 70, because job, material and manual entry gaps matter less.)

**Pass bar for Pulse:** total of 80 or more, no category below 7, and a higher score than Easy Metrics in at least 8 of 10 categories. Categories 2, 3, 6 and 8 are where the gap should be widest. Categories 4 and 10 are where Easy Metrics is strongest and Pulse needs real depth, not screens.

**Honesty rules for the critic:**
- Do not give Pulse credit for a feature that was not clicked through with real data.
- Do not mark Easy Metrics down for things that could not be verified. Use the baseline above and say it is an estimate.
- Record every score with one sentence of evidence.
