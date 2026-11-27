/**
 * The Pulse cost model (docs/pulse/SPEC.md section 4) as small pure functions. Everything here
 * runs on the server and in the browser: no database, no React, no floats for money.
 *
 * Map of the folder:
 * - `rates`       real cost of an hour (loaded, overtime and pay rates), which rate applies
 * - `labor`       labor cost, overhead and gross pay of an entry
 * - `shared`      time not on a job: the spread, missing time, the payroll check, utilization
 * - `materials`   who buys the parts, standard and actual material cost
 * - `revenue`     per unit, fixed price by progress, hourly, services, billed and not billed yet
 * - `summary`     cost, profit, both margins, per unit numbers, the company profit bridge
 * - `plan`        quote and budget, the plan for the work done so far, plan vs actual rows
 * - `variance`    why profit changed: the waterfall whose bars always add up
 * - `pace`        units per person per hour, target pace, productivity
 * - `projection`  projected finish: cost, revenue, margin, hours and date
 * - `risk`        on track, heads up, at risk or losing money, with the reason in plain words
 * - `calculator`  breakeven and the what if quote calculator
 * - `clients`     cost to serve and profit rankings
 * - `trends`      period over period comparison and trend helpers
 * - `program`     the program tracker: month figures, the plan from Projects, cost forecast, target
 * - `program-risk` program alerts P1 to P7
 * - `calendar`    date math on YYYY-MM-DD strings
 */
export * from './types';
export * from './calendar';
export * from './rates';
export * from './labor';
export * from './shared';
export * from './materials';
export * from './revenue';
export * from './summary';
export * from './plan';
export * from './variance';
export * from './pace';
export * from './projection';
export * from './risk';
export * from './calculator';
export * from './clients';
export * from './trends';
export * from './words';
export * from './program';
export * from './program-risk';
