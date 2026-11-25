# Projects seed

`pnpm --filter kitstak-projects db:seed [-- --org=<slug>]` fills the KitStak and Northwind Robotics
orgs through the domain layer, then backdates the rows so history reads like real weeks.

Run the seeds in order: CRM, then Projects, then Pulse (see `docs/DEPLOYMENT.md`, Demo seeds).

- `--org=northwind-robotics` (or `kitstak`): seed one org.
- `--check-only`: skip seeding and print the seed check again.
- `--with-pulse`: add the facts that need the Pulse seed (All linked work, the Pulse match).

## Programs (docs/programs/SPEC.md 7)

`program-builder.ts` walks the calendar one day at a time on the program clock from the first
program start to today. Each day: programs that start that day are made from a wizard payload
(variants, card, one time charges, schedule, CRM links, members); the program sweep makes the
next builds and settles finished months; each program's `day` hook in `data/northwind-programs.ts`
or `data/kitstak-programs.ts` logs output, closes builds short, adds rows, overrides rates and logs
time; org hooks publish card v2, close September and October for GLOVE and add the ECOMM credit.
Rows written on a past day get that day's time. At the end every program row gets a uuidv5 id
(`program-ids.ts`): program (org, key), variant (program, key), build (program, variant, date, n),
output (build, date, n), one time charge (program, label, date), prep task (program, title, n) and
the FRA project build, so Pulse `pmb`, `pmf` and `pmt` refs and `core.record_links` edges stay the
same across reseeds. Two full runs (CRM, Projects, Pulse) give identical counts and ids.

| Key | Customer | Story |
|---|---|---|
| GLOVE | Gripwell Safety Supply | 8 size by color kits every weekday, exact numbers (7.4). Card v1 $1.85 with XL set $2.10, v2 from the 1st $1.95 with XL add $0.25, draft v3 from Jan 1 waiting for review. Slow week at 50 per build (comments on its first day), a rush rate of $2.05, one build 12 over plan. September and October closed. |
| DUDE | Dude Brothers Outfitters | Monday, Wednesday and Friday, 250 each, $45 batch fee, one Pro build closed short at 230 and one unplanned Refill row of 40. |
| MAHCO | Mahco Hardware Supply | One Monday run of 500 each built over three days, billable recount time at $42 an hour, $12,000 minimum with top ups and a projected gap. |
| ECOMM | Brightcart Online | Monday to Saturday orders, Saturday and Monday quantities, Black Friday planned by hand, a $550 credit. No Pulse job. |
| TEES | Apex Threads Co. (KitStak org) | M linked to the WMS kit APX-KIT-TEE3 at 40 percent of its kitting capacity, so the planner tint shows. |

Also: the FRA project build "Sample kits for trade show" (Not billed), Maya's wizard draft "Winter
liner add on" at step 2, and the template "Glove style kitting".

## Seed check (run date 2026-11-25)

The Projects seed prints these facts through the same domain calls the screens use, and fails when
a GLOVE value differs from SPEC 7.4 on a 2026-11-25 run. On other dates it checks that each
month's parts add up and the forecast covers the money so far. `vs last month at this point` is
rounded to the nearest percent and `Avg ... a work day` counts the work days before today, as 7.4
does. The `(screen)` lines are what the Overview prints, from the same helpers the screen uses;
the check fails when they differ from the 7.4 lines (any program) or when a program shows On track
while its minimum alert is up. `Planned work still to come` leaves out a projected minimum top up;
`Forecast incl. top up` splits a forecast that includes one (MAHCO).

```
Seed check for northwind-robotics on 2026-11-25

DUDE
  September total: $14,300.00
  September closed: no
  October total: $37,280.00
  October closed: no
  November work charges through Nov 24: $28,203.00
  Today: 0 of 3 builds done · 0 of 750 kits · $0.00
  This month (MTD): $28,953.00
  Work charges this month: $28,203.00
  Monthly fee: $750.00
  Built this month: 7,520 kits · Avg 752 a work day
  Work days with output (incl. today): 10
  Built this month (screen): 7,520 kits · Avg 752 a work day
  vs last month at this point (screen): Same as last month at this point
  vs last month at this point: Same as last month at this point
  October through Oct 25: $28,850.00
  Forecast: $37,383.00 · 103% of $36,000.00 target
  Forecast basis: Based on planned builds
  Planned work still to come: $8,430.00
  Alerts: none
  Health: on_track (money_target)
  Schedule window: builds made through 2026-12-02
  Deal line: Deal $148,000.00 over 12 months · on track for $425,410.00

ECOMM
  September total: $7,494.67
  September closed: no
  October total: $22,265.25
  October closed: no
  November work charges through Nov 24: $16,591.25
  Today: 0 of 2 builds done · 0 of 280 orders · $0.00
  This month (MTD): $18,041.25
  Work charges this month: $16,591.25
  Monthly fee: $2,000.00
  Built this month: 5,849 orders · Avg 292 a work day
  Work days with output (incl. today): 20
  Built this month (screen): 5,849 orders · Avg 292 a work day
  vs last month at this point (screen): up 2% vs last month at this point
  vs last month at this point: up 2% vs last month at this point
  October through Oct 25: $17,683.00
  Forecast: $23,241.25 · 105% of $22,000.00 target
  Forecast basis: Based on planned builds
  Planned work still to come: $5,200.00
  Alerts: over_plan, over_plan, over_plan, over_plan, over_plan
  Health: on_track (money_target)
  Schedule window: builds made through 2026-12-02
  Deal line: Deal $210,000.00 over 12 months · on track for $262,172.42

GLOVE
  September total: $21,660.00
  September closed: yes
  October total: $31,500.00
  October minimum top up: $165.00
  October closed: yes
  November work charges through Nov 24: $27,378.40
  Today: 5 of 8 builds done · 560 of 800 kits · $1,092.00
  This month (MTD): $29,970.40
  Work charges this month: $28,470.40
  Monthly fee: $1,500.00
  Built this month: 14,172 kits · Avg 801 a work day
  Work days with output (incl. today): 18
  Built this month (screen): 14,172 kits · Avg 801 a work day
  vs last month at this point (screen): up 27% vs last month at this point
  vs last month at this point: up 27% vs last month at this point
  October through Oct 25: $23,685.00
  Forecast: $33,708.40 · 105% of $32,000.00 target
  Forecast basis: Based on planned builds
  Planned work still to come: $3,738.00
  Minimum: Below minimum by $1,529.60 so far · projected gap $0.00
  Alerts: over_plan
  Health: on_track (money_target)
  Schedule window: builds made through 2026-12-02
  Deal line: Deal $386,400.00 over 12 months · on track for $390,244.00

MAHCO
  September total: $6,800.00
  September minimum top up: $753.50
  September closed: no
  October total: $12,000.00
  October minimum top up: $3,801.50
  October closed: no
  November work charges through Nov 24: $7,713.50
  Today: 4 of 4 builds done · 2,000 of 2,000 packs · $1,900.00
  This month (MTD): $8,093.50
  Work charges this month: $8,093.50
  Built this month: 8,000 packs · Avg 691 a work day
  Work days with output (incl. today): 12
  Built this month (screen): 8,000 packs · Avg 691 a work day
  vs last month at this point (screen): up 32% vs last month at this point
  vs last month at this point: up 32% vs last month at this point
  October through Oct 25: $6,151.50
  Forecast: $12,000.00 · 100% of $12,000.00 target
  Forecast basis: Based on recent days
  Planned work still to come: $1,326.25
  Forecast incl. top up: $12,000.00 (work $9,419.75 plus a projected top up of $2,580.25)
  Minimum: Below minimum by $3,906.50 so far · projected gap $2,580.25
  Alerts: minimum_at_risk
  Health: at_risk (money_target)
  Schedule window: builds made through 2026-12-02
  Deal line: Deal $144,000.00 over 12 months · on track for $138,800.00

Floor today (2026-11-25)
  GLOVE: 5 of 8 builds done · 560 of 800 kits · 2.40 hours
  DUDE: 0 of 3 builds done · 0 of 750 kits · 10.83 hours
  MAHCO: 4 of 4 builds done · 2,000 of 2,000 packs · 0.00 hours
  ECOMM: 0 of 2 builds done · 0 of 280 orders · 7.66 hours
  Totals: 9 of 17 builds done · 1,550 kits, 2,000 packs, 280 orders planned · capacity 80.00 hours

Seed check passed for northwind-robotics.
```

The Pulse seed then prints program revenue per job and month and fails when Pulse and Projects
differ by a cent:

```
Program revenue in Pulse and Projects
  J-1040 GLOVE 2026-09: Pulse $21,660.00 · Projects $21,660.00 match
  J-1040 GLOVE 2026-10: Pulse $31,500.00 · Projects $31,500.00 match
  J-1040 GLOVE 2026-11: Pulse $29,970.40 · Projects $29,970.40 match
  J-1041 DUDE 2026-09: Pulse $14,300.00 · Projects $14,300.00 match
  J-1041 DUDE 2026-10: Pulse $37,280.00 · Projects $37,280.00 match
  J-1041 DUDE 2026-11: Pulse $28,953.00 · Projects $28,953.00 match
  J-1042 MAHCO 2026-09: Pulse $6,800.00 · Projects $6,800.00 match
  J-1042 MAHCO 2026-10: Pulse $12,000.00 · Projects $12,000.00 match
  J-1042 MAHCO 2026-11: Pulse $8,093.50 · Projects $8,093.50 match
```
