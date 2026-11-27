# @kitstak/programs-engine

The pure money and planning engine for KitStak Programs (`docs/programs/SPEC.md` section 3).
Every app that shows program numbers computes them here, so Projects, Pulse, CRM and WMS always
show the same cents for the same rows.

Pure TypeScript, zero runtime dependencies, no database, no `Date.now()` inside math (callers pass
`asOf`). Safe in the browser and on the server. Source shipped: apps transpile it through Next
`transpilePackages`.

## Rules

| Rule | What it means here |
| --- | --- |
| Money is whole cents | `bigint` in TS (`Cents`), decimal strings across JSON and SQL (`"153000"`). No `Number` math on money. |
| Scales | Unit prices 4 decimals (`"1.9500"`), quantities 3, hours 2, the Pulse scales. |
| One rounding rule | `divRound`, half away from zero, once at the step that lands on cents. |
| Per unit grain (M1) | One output row (one build, one work date) is rounded once: `divRound(qty1000 * price10000, 100000)`. Sums are sums of row cents. |
| Price in force (M3) | The published version with the latest `effectiveFrom` on or before the work date. First match wins: build rate, variant rate, card rate, job price, no price. |
| Fixed lines (A6, Appendix B.1) | Monthly fee and minimum: `B` is the billable days (active days less paused days when the line does not charge while paused). Segments of billable days on the same terms merge; `W = sum(a * d)`; one rounding per line per month, `divRound(W, D)` with prorate on and `divRound(W, B)` with prorate off; pieces by `allocate`. Prorate off is the whole fee for any month with a billable day. |
| Minimum (A5, M6) | During the month: the gap so far, as a preview. After the month ends: a posted top up dated the last active day. |
| Dates | `YYYY-MM-DD` strings in UTC day numbers; a time zone is used only by `todayIn`. |
| ES2017 | `BigInt(n)`, never `10n` literals. |

## Modules

| Import | Main functions |
| --- | --- |
| `./money` | `divRound`, `toScaled`, `fromScaled`, `mulQuantityPrice`, `mulHoursRate`, `allocate`, `ratioBp` (moved from Pulse) |
| `./calendar` | `addDays`, `isWorkDay` (Pulse form and program calendar form), `activeRange`, `workDaysInMonth`, month helpers (moved from Pulse and extended) |
| `./price` | `priceFor`, `versionFor`, `resolveUnitPrice`, `readRateText` (reads `$2.05` and `2,050.00`, refuses more than 4 decimals and any rate at or above $1,000,000, the database CHECK on every rate column, with "The rate is too large. Use up to $999,999.9999."), `buildRateProblem`, `cardLineProblem` and `isUsableLine` (one $0 floor for every line kind and job prices, and the database ceilings: fees up to 10,000,000,000,000 cents and hourly rates up to 10,000,000 cents; a line outside them is skipped, never charged), `resolveOrderCharge`, `resolveHourRate`, `compileRateRules` (reads every amount with `readRateText`: a bad amount, or a set plus add sum at or above $1,000,000, is a `bad_amount` conflict, never rounded; a default below $0 is no default), `rateConflictMessage`, `cardSummary` |
| `./accrual` | `accrueDay`, `perUnitRevenue`, `hourlyRevenue`, `minutesToHours`, `postingTarget`, `canLinkJob`, `POSTING_LABELS` (SPEC 2.2.17 word for word: "This program", "The program's Pulse job", "This build's Pulse job", "Not billed") |
| `./month` | `monthCharges` (refuses a bad `asOf` or `month` and inputs that would repeat a ref; a charge worth 0 cents makes no line; the monthly fee is one charge for the month, dated the first active day and posted from that day, E16; a minimum in force with no billable day is 0 cents and `met`, B.1.5), `ledgerRows` (never a 0 cent row), `fixedLineForMonth` (Appendix B.1, see Fixed lines below; returns the total, the statement pieces, `inForce` and `billableDays`), `PRORATE_SWITCH_HELP` (the prorate switch copy, B.1.4), stable refs (`buildDayRef`, `feeRef`, `laborRef`, `parseRef`) |
| `./rollup` | `rollupByVariant`, `rollupByDay`, `rangeRollup` and `programHeadline` (a month passed twice is a RangeError, so revenue is never counted twice), `avgUnitPrice` |
| `./forecast` | `forecastMonth` (refuses a bad `asOf`, `month` or a result of another month, and a trailing day, planned build or one time charge listed twice; takes every one time charge dated in the month as the optional `oneTime: readonly OneTimeCharge[]` (a field this package adds to the SPEC 3.8 `ForecastInput` type, so setup fees and adjustments dated after `asOf` count), else the ones in `result`; the planned estimate is SPEC 3.8 exactly: actual work plus the open builds dated `asOf` to month end, so past due builds and hours still to come are not added), `programHealth` |
| `./variants` | `cartesian`, `applyPattern`, `defaultPatterns` (from the real axis names), `patternProblem`, `axisNameProblem` (names must differ, case aside), `generateVariants` (codes in other scripts get `V`, `V2`; refuses an empty key or a SKU of only the program key), `findConflicts` (empty keys clash; a key over 16 characters is `key_length` and a name over 80 is `name_length`, the database rules), `suggestCode`, `inferAxes` (tab, comma or semicolon sheets; a number column with no header is the qty or the rate; a repeated column name becomes `Size 2` with a note; hyphenated labels stay columns, a SKU header line is dropped, extra decimals, a qty of 100,000,000 or more and a rate of $1,000,000 or more are refused; a repeated SKU, or the same values again, goes to `unmatched` so no variant is made twice; a list of names such as "Small Brown" or "Extra Large Yellow" is read as names, with labels as typed, no SKU and a note; every value code fits the `^[A-Z0-9]{1,6}$` CHECK; a shared first part is dropped only when it looks like a program code; a column whose every value is a number is the Qty column when no Qty header exists and is never an attribute, B.2.2; a row with more filled cells than the header, or with no header than most rows, is refused with "Row 4 has more cells than the header." and the fix, B.2.1), `readQtyCell` and `qtyMessage` (from the shared message table), `extraCellsMessage` |
| `./import` | `matchVariant`, `parseDateCell` and `dateCellProblem` (a weekday word that does not match the date is refused: "Nov 30 is a Monday, not a Tuesday."), `parsePlanPaste`, `parsePlanCsv`, `parseOutputCsv` (all three add up repeated date and variant lines and list them in `merged`). A header of dates keeps a paste in grid mode even when a date is outside the planning days: that column is reported once and the others are read. Every reader returns `notes`, `dateOrder` and `dateOrderNeeded`: slash dates that could mean two days are flagged (pass `dateOrder: 'day_first'` to read them again), an unknown header is read as one with the note "Line 1 was read as a header." and the columns are found from the data, a qty with more than 3 decimals, or of 100,000,000 or more (the database CHECK), is refused, and so is a qty with a `$` (a price column read as the qty). A variant and day that add up to 100,000,000 or more is left out whole, and every line that fed it is listed in `unmatched` naming the other lines, so every line read ends up in exactly one of the rows, `merged` or `unmatched`. A long plan row with a qty of 0 is listed too. Tab, comma and semicolon files are all read. A row with a filled cell past the header (or, with no header, past the columns read) is never read in part: it goes to `unmatched` with "This row has 4 cells. The header has 3. Put "1,200" in quotes, or type it as 1200.", so an unquoted 1,200 is never saved as 1. A scrap column is guessed only when more than half the rows fill it. A date that is not real reads "2026-02-30 is not a real date. Use dates like 2026-11-30." |
| `./schedule` | `occurrences`, `nextOccurrence`, `qtyFor`, `generationWindow`, `describeRule`, `todayIn`, `nextWorkDay`, `nextOccurrenceDate` |
| `./runs` | `runId`, `parseRunId`, `groupRuns`, `runState` (planned and built from the same live builds) |
| `./deal` | `isWonStage` (A12 exactly: the done flag, else the whole word "won"), `dealValueToCents` (a comma must group thousands, so `1,23` and `1.234,56` are null, never a 100 times misread), `monthlyFromDeal`, `dealPrefill`, `dealCallout` |
| `./format` | `formatCents`, `formatMarginBp` (rounds to a tenth half away from zero, never "-0%"), `formatUnitPrice`, `formatQty`, `unitLabel`, `formatHours`, `formatPercentBp` (cuts toward zero, so 9999 is "99%" next to "At risk", never "100%"; fixed `en-US`; compact money rolls over to the next unit, `$999,500` is `$1M`; bad stored text shows the empty text, never throws) |
| `./messages` | `valueMessage` (the one message table for qty, scrap, rate and build rate problems, Appendix B.2.3), `placeNote`, `MAX_QTY_TEXT`, `MAX_RATE_TEXT` |
| `./barcode` | `code128` (Code 128 B for build tickets) |
| `./projection` | `projectMonth` (the wizard's month at a schedule; `minutesPerOccurrence` projects hourly work, else `hoursNotProjected` with `HOURS_NOT_PROJECTED_NOTE`) |
| `./types` | `IsoDate`, `CardVersion`, `OutputRow`, `LedgerRow` and the other shared shapes |

## Using it in an app

1. Add `"@kitstak/programs-engine": "workspace:*"` to the app's dependencies and the package to
   `transpilePackages` in `next.config.ts` (already done for Projects, Pulse, CRM and WMS).
2. Read program inputs only through `@kitstak/db/programs` (`loadProgramMonthInputs`), so every
   app hands the engine the same rows with the same filters (SPEC 3.14).
3. Call `monthCharges` for a month, `ledgerRows` for the fees to store, the rollups for screens.
   Format with the engine format helpers so the text matches everywhere.

```ts
import { monthCharges, ledgerRows, formatCents } from '@kitstak/programs-engine';

const result = monthCharges({ programId, month: '2026-11', asOf, calendar, versions, output, finished, time, oneTime });
formatCents(result.totalCents, { cents: true }); // "$28,870.00"
```

## Parity rule

Pulse stamps each `pmb:` production row from its own copy of the unit price with
`round(units_good * unit_price * 100)`. The engine computes the same row with `accrueDay`, and
the test E26 checks `accrueDay` against a digit by digit reference of Postgres `round(numeric)`
over 2,000 random pairs. Any change to rounding here must keep E1 to E6 and E26 green, and the
Pulse seed parity assertion (SPEC 7.3) passing.

## Tests

`pnpm --filter @kitstak/programs-engine typecheck`, `lint` (the apps' TypeScript rules plus the
no dash copy rule) and `test` must all pass. `test` runs every case E1 to E47 from SPEC 3.15, the
proposed fixed line cases below, plus the property tests and the money and calendar tests moved
from Pulse. The fixed line math is also checked against an oracle that shares no code with
`month.ts`: Appendix B.1 in rationals, day by day. The result must be within half a cent of the
exact share (one rounding), never above the largest amount in force, exactly the amount when one
amount is in force with prorate off on any month with a billable day, and exactly the amount when
the program is active all month with nothing paused, whatever the flags. `test:coverage` checks
the shared thresholds from `@kitstak/config/vitest/base`.

## Fixed lines (Appendix B.1, replaces the rounding and pause text of SPEC 3.5 steps 5 and 7)

`fixedLineForMonth` works one line kind (monthly fee or monthly minimum) for one month:

1. Billable days. `D` is the days of the month. `B` is the active days, less the paused days when
   the line does not charge while paused. A paused day counts only when the line in force that day
   has "Charge while paused" on; a paused day with no line in force does not count. An active day
   that is not paused always counts, with or without the line, so a fee that starts mid month pays
   its share (E34). `B = 0` charges nothing.
2. Segments. Contiguous runs of billable days with the line in force. Neighbors with the same
   amount, `prorate` and `chargeWhilePaused` merge (the piece lists every version it covers in
   `versionIds`), so a version that only changes other lines never splits or moves the fee. A
   paused day that does not count stays inside its segment's dates.
3. One rounding per line per month. `W = sum(a * d)`. The total is `divRound(W, D)` with prorate
   on and `divRound(W, B)` with prorate off. A month that mixes the two keeps each segment on its
   own frame and still rounds once: `divRound(sum(a * d * (prorate ? B : D)), D * B)`, which is
   exactly the two rules when the setting is the same everywhere (E33).
4. Pieces. The total is split over the segments with `allocate` by `a * d` (times the frame factor
   when prorate is mixed), so the statement pieces add up to the total exactly.

So one version all month with prorate off is exactly `a`, even when a pause leaves only one
billable day (B.1.4: to charge less for a partly paused month, turn prorate on; the switch copy is
`PRORATE_SWITCH_HELP`). A mid month change splits by days and rounds once: December $1,500.00 for
10 days then $1,800.00 for 21 is `divRound(5280000, 31)` = 170323, pieces 48387 and 121936.
Prorate on pays the share of the month (E14, E36). The total never passes one month of the largest
amount in force.

A minimum line in force with `B = 0` is `minimumCents` 0, gap 0, status `met`, with no top up and
no preview charge, while the month is open too (B.1.5). Status `none` means no minimum line is in
force. A $0 minimum never tops up, in `monthCharges` and in the forecast.

## Imports (Appendix B.2)

- A data row with more cells than the header is refused with a row error ("Row 4 has more cells
  than the header." and the fix), in the variant paste, the output and plan CSVs, the plan paste
  and the plan grid. Cells are never dropped.
- In columns mode a column whose every value is a number is the Qty column when no Qty header
  exists (the Rate column when its cells look like prices), with or without a header row. It is
  never an attribute; when that role is taken it is left out with the reason.
- `messages.ts` holds the one message table (`valueMessage`) for qty, scrap and rate problems.
  `qtyMessage`, `readQtyCell`, `decimalProblem`, `rateTextMessage`, `buildRateProblem` and the
  price card constants all read it, so imports, the variant generator and the planner say the same
  words for the same problem.
