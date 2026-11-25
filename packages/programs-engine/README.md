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
| Fixed lines (A6) | Monthly fee and minimum split by days across versions, SPEC 3.5 step 5: each segment's frame is `D` (prorate on) or `A`, the active days with paused days included (prorate off); paused days that do not charge leave only `d`. Neighboring segments with the same amount and frame round once as a group and split by days, then the groups add up, held to one month of the largest amount. Versions that keep the fee add back to exactly one month. |
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
| `./month` | `monthCharges` (refuses a bad `asOf` or `month` and inputs that would repeat a ref; a charge worth 0 cents makes no line; the monthly fee is one charge for the month, dated the first active day and posted from that day, E16), `ledgerRows` (never a 0 cent row), `fixedLineForMonth` (SPEC 3.5 step 5: the frame is `D` for prorate on and `A`, the active days with paused days included, for prorate off; paused days that do not charge only leave `d`; one rounding per group of neighboring segments with the same amount and frame, then the sum, never more than one month of the largest amount, A6; returns `inForce` so a minimum paused all month reads met, not none; see Fixed lines below), stable refs (`buildDayRef`, `feeRef`, `laborRef`, `parseRef`) |
| `./rollup` | `rollupByVariant`, `rollupByDay`, `rangeRollup` and `programHeadline` (a month passed twice is a RangeError, so revenue is never counted twice), `avgUnitPrice` |
| `./forecast` | `forecastMonth` (refuses a bad `asOf`, `month` or a result of another month, and a trailing day, planned build or one time charge listed twice; takes every one time charge dated in the month as the optional `oneTime: readonly OneTimeCharge[]` (a field this package adds to the SPEC 3.8 `ForecastInput` type, so setup fees and adjustments dated after `asOf` count), else the ones in `result`; the planned estimate is SPEC 3.8 exactly: actual work plus the open builds dated `asOf` to month end, so past due builds and hours still to come are not added), `programHealth` |
| `./variants` | `cartesian`, `applyPattern`, `defaultPatterns` (from the real axis names), `patternProblem`, `axisNameProblem` (names must differ, case aside), `generateVariants` (codes in other scripts get `V`, `V2`; refuses an empty key or a SKU of only the program key), `findConflicts` (empty keys clash; a key over 16 characters is `key_length` and a name over 80 is `name_length`, the database rules), `suggestCode`, `inferAxes` (tab, comma or semicolon sheets; a number column with no header is the qty or the rate; a repeated column name becomes `Size 2` with a note; hyphenated labels stay columns, a SKU header line is dropped, extra decimals, a qty of 100,000,000 or more and a rate of $1,000,000 or more are refused; a repeated SKU, or the same values again, goes to `unmatched` so no variant is made twice; a list of names such as "Small Brown" or "Extra Large Yellow" is read as names, with labels as typed, no SKU and a note; every value code fits the `^[A-Z0-9]{1,6}$` CHECK; a shared first part is dropped only when it looks like a program code; a row with more filled cells than the header, or with no header than most rows, goes to `unmatched` with "This row has 4 cells. The header has 3." and the fix, and never adds an axis), `readQtyCell` and `qtyMessage` (every qty and scrap message, built once, so the paste and the imports use the same words), `extraCellsMessage` |
| `./import` | `matchVariant`, `parseDateCell` and `dateCellProblem` (a weekday word that does not match the date is refused: "Nov 30 is a Monday, not a Tuesday."), `parsePlanPaste`, `parsePlanCsv`, `parseOutputCsv` (all three add up repeated date and variant lines and list them in `merged`). A header of dates keeps a paste in grid mode even when a date is outside the planning days: that column is reported once and the others are read. Every reader returns `notes`, `dateOrder` and `dateOrderNeeded`: slash dates that could mean two days are flagged (pass `dateOrder: 'day_first'` to read them again), an unknown header is read as one with the note "Line 1 was read as a header." and the columns are found from the data, a qty with more than 3 decimals, or of 100,000,000 or more (the database CHECK), is refused, and so is a qty with a `$` (a price column read as the qty). A variant and day that add up to 100,000,000 or more is left out whole, and every line that fed it is listed in `unmatched` naming the other lines, so every line read ends up in exactly one of the rows, `merged` or `unmatched`. A long plan row with a qty of 0 is listed too. Tab, comma and semicolon files are all read. A row with a filled cell past the header (or, with no header, past the columns read) is never read in part: it goes to `unmatched` with "This row has 4 cells. The header has 3. Put "1,200" in quotes, or type it as 1200.", so an unquoted 1,200 is never saved as 1. A scrap column is guessed only when more than half the rows fill it. A date that is not real reads "2026-02-30 is not a real date. Use dates like 2026-11-30." |
| `./schedule` | `occurrences`, `nextOccurrence`, `qtyFor`, `generationWindow`, `describeRule`, `todayIn`, `nextWorkDay`, `nextOccurrenceDate` |
| `./runs` | `runId`, `parseRunId`, `groupRuns`, `runState` (planned and built from the same live builds) |
| `./deal` | `isWonStage` (A12 exactly: the done flag, else the whole word "won"), `dealValueToCents` (a comma must group thousands, so `1,23` and `1.234,56` are null, never a 100 times misread), `monthlyFromDeal`, `dealPrefill`, `dealCallout` |
| `./format` | `formatCents`, `formatMarginBp` (rounds to a tenth half away from zero, never "-0%"), `formatUnitPrice`, `formatQty`, `unitLabel`, `formatHours`, `formatPercentBp` (cuts toward zero, so 9999 is "99%" next to "At risk", never "100%"; fixed `en-US`; compact money rolls over to the next unit, `$999,500` is `$1M`; bad stored text shows the empty text, never throws) |
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
`month.ts`: the exact share of the month in rationals, day by day, `sum(a / frame)` over the days
that charge, with `frame = prorate ? D : A`. The result must be within half a cent per segment of
it, never above the largest amount in force, and exactly the amount when every version has the
same amount, the program is active all month and nothing is paused. A second property checks A6
directly: with the program active all month, turning prorate on or off for every line changes
nothing, over random pauses. `test:coverage` checks the shared thresholds from
`@kitstak/config/vitest/base`.

## Fixed lines (SPEC 3.5 step 5 and A6)

`fixedLineForMonth` cuts the active days into segments where one version with the line is in
force. `A` is the active days of the month, paused days included, and is the same for every
line. A segment's `d` is its days that charge: a paused day counts only when its line has
"Charge while paused" on. That is the only place a pause counts: paused days only ever leave `d`.
A segment's frame is `D` (the days of the month) when its line has `prorate` on and `A` when it
is off. A6 says prorate only decides whether a month the program starts or ends in is charged in
part or in full, so in a month the program is active all month (`A == D`) it changes nothing,
and a pause bills the same with prorate on or off. Since every frame is at least `A` and the
`d` of all segments add up to at most `A`, the shares never add up to more than one month.

Rounding: neighboring segments with the same amount `a` and the same frame form one rounding
group. A group with `d` charging days in all adds `divRound(a * d, frame)`, and its cents are
split over its segments by days (`allocate`); a segment alone in its group is exactly
`divRound(a * d, frame)`. The month is the sum. So a version that only changes other lines never
moves the fee: three $1,500.00 versions in December (2, 2 and 27 days) bill 150000, not 9677 +
9677 + 130645 = 149999, and thirty daily $999.99 versions bill 99999. A sum above the largest
amount in force (only possible by rounding each group up half a cent) is held to that amount and
the segments are cut back by largest remainder.

`fixedLineForMonth` also returns `inForce`: true when a version has the line on some active day,
even when no day charges. A minimum in force in a month paused all month with "Charge while
paused" off is 0 cents and reads `met` once the month is over (`pending` while it is open), never
`none` ("No minimum"). A $0 minimum never tops up, in `monthCharges` and in the forecast.

Two parts of this are not in SPEC v2 word for word and wait on the spec owner: step 5 says
"paused days are removed from the segment and from `A` for that line" (here they leave `d`
only, which is what A6 asks for), and step 5 rounds each segment on its own (here neighboring
segments with the same amount and frame round once, so the parts add back to the whole month to
the cent, as A6 asks). The cases below are proposed for SPEC 3.15 and are tested here:

- Proposed E48: December, $1,500.00 for Dec 1 to 10 then $1,800.00 for Dec 11 to 31 gives
  48387 + 121935 = 170322 cents.
- Proposed E49: November paused Nov 1 to 15 under a $1,000.00 line that does not charge while
  paused, then a $3,000.00 line from Nov 16 with prorate off: `divRound(300000 * 15, 30)` =
  150000 cents, with "Charge while paused" on or off for that line (none of its days are paused).
- Proposed E50: November paused Nov 1 to 10. $1,500.00 prorate off, charging while paused, Nov 1
  to 15 is `divRound(150000 * 15, 30)` = 75000. $1,000.00 prorate off, not charging while paused,
  from Nov 16 has no paused days of its own, so it is `divRound(100000 * 15, 30)` = 50000.
- Proposed E50b: the same pauses with two $1,000.00 versions that both skip paused days: 20 days
  charge over `A = 30`, one group, `divRound(100000 * 20, 30)` = 66667, split 16667 + 50000.
- Proposed E51: a $1,500.00 line with prorate off and "Charge while paused" off, paused Nov 9 to
  15, bills `divRound(150000 * 23, 30)` = 115000, the same as E36 with prorate on. Paused Nov 2 to
  30 it bills 5000 with prorate on or off.
- Proposed E52: a $30,000.00 minimum in force in a month paused all month with "Charge while
  paused" off: `minimumCents` 0, status `met` after the month, no top up.
