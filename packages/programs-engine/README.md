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
| Fixed lines (A6) | Monthly fee and minimum split by days across versions; "Charge part of it in a partial month" (`prorate`) picks days of the month or active days. |
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
| `./month` | `monthCharges` (refuses a bad `asOf` or `month` and inputs that would repeat a ref; a charge worth 0 cents makes no line; the monthly fee is dated and posted from the first day a fee version is in force), `ledgerRows` (never a 0 cent row), `fixedLineForMonth` (one frame for every prorate off line and one rounding per month, split back over the versions by largest remainder: never more than one month of the largest amount, and exactly one month for any number of same amount versions; E48 and E49 pin this rule, see the note below), stable refs (`buildDayRef`, `feeRef`, `laborRef`, `parseRef`) |
| `./rollup` | `rollupByVariant`, `rollupByDay`, `rangeRollup` and `programHeadline` (a month passed twice is a RangeError, so revenue is never counted twice), `avgUnitPrice` |
| `./forecast` | `forecastMonth` (refuses a bad `asOf`, `month` or a result of another month; takes every one time charge dated in the month as `oneTime`, else the ones in `result`; the planned estimate is SPEC 3.8 exactly: actual work plus the open builds dated `asOf` to month end, so past due builds and hours still to come are not added), `programHealth` |
| `./variants` | `cartesian`, `applyPattern`, `defaultPatterns` (from the real axis names), `patternProblem`, `axisNameProblem` (names must differ, case aside), `generateVariants` (codes in other scripts get `V`, `V2`; refuses an empty key or a SKU of only the program key), `findConflicts` (empty keys clash; a key over 16 characters is `key_length` and a name over 80 is `name_length`, the database rules), `suggestCode`, `inferAxes` (tab, comma or semicolon sheets; a number column with no header is the qty or the rate; a repeated column name becomes `Size 2` with a note; hyphenated labels stay columns, a SKU header line is dropped, extra decimals, a qty of 100,000,000 or more and a rate of $1,000,000 or more are refused; a repeated SKU, or the same values again in a sheet, goes to `unmatched` so no variant is made twice) |
| `./import` | `matchVariant`, `parseDateCell` and `dateCellProblem` (a weekday word that does not match the date is refused: "Nov 30 is a Monday, not a Tuesday."), `parsePlanPaste`, `parsePlanCsv`, `parseOutputCsv` (all three add up repeated date and variant lines and list them in `merged`). A header of dates keeps a paste in grid mode even when a date is outside the planning days: that column is reported once and the others are read. Every reader returns `notes`, `dateOrder` and `dateOrderNeeded`: slash dates that could mean two days are flagged (pass `dateOrder: 'day_first'` to read them again), an unknown header is read as one with the note "Line 1 was read as a header." and the columns are found from the data, a qty with more than 3 decimals, or of 100,000,000 or more (the database CHECK), is refused (also when lines add up to it), and tab, comma and semicolon files are all read. |
| `./schedule` | `occurrences`, `nextOccurrence`, `qtyFor`, `generationWindow`, `describeRule`, `todayIn`, `nextWorkDay`, `nextOccurrenceDate` |
| `./runs` | `runId`, `parseRunId`, `groupRuns`, `runState` (planned and built from the same live builds) |
| `./deal` | `isWonStage`, `dealValueToCents`, `monthlyFromDeal`, `dealPrefill`, `dealCallout` |
| `./format` | `formatCents`, `formatMarginBp`, `formatUnitPrice`, `formatQty`, `unitLabel`, `formatHours`, `formatPercentBp` (fixed `en-US`; compact money rolls over to the next unit, `$999,500` is `$1M`; bad stored text shows the empty text, never throws) |
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
no dash copy rule) and `test` must all pass. `test` runs every case E1 to E47 from SPEC 3.15, E48 and E49 (below), plus the
property tests and the money and calendar tests moved from Pulse. `test:coverage` checks the
shared thresholds from `@kitstak/config/vitest/base`.

## Fixed lines: E48 and E49

`fixedLineForMonth` adds the exact share of every segment over one frame and rounds the month
once, then splits it back over the segments by largest remainder. A line that charges part of a
partial month (`prorate`) shares `a * d / D`; one that does not shares `a * d / N`, where `N` is
the charging days of the month under whichever line is in force. So mixed options never charge
more than one month of the largest amount.

- E48: December, $1,500.00 for Dec 1 to 10 then $1,800.00 for Dec 11 to 31 gives 170323 cents
  (rounding each segment first would give 170322).
- E49: November paused Nov 1 to 15 under a $1,000.00 line that does not charge while paused, then
  a $3,000.00 line from Nov 16 that charges while paused with prorate off, gives 300000 cents
  (one full month of the only line that charged).

