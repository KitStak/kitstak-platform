/**
 * Copy for the /pulse product page. Every capability named here is something docs/pulse/SPEC.md
 * says KitStak Pulse does; keep it that way when editing. No customer names, no results, no
 * statistics, and no payroll, invoicing, accounting, email, AI or third party integration claims.
 * Copy rules: plain words, short sentences, and never an em dash, an en dash or a double hyphen
 * (src/lib/pulse-claims.test.ts checks every string in this file).
 * Every dollar figure is a sample number taken from a worked example in the spec, and the test
 * proves the sums add up.
 */
import type { Feature } from '../product/chapter';
import type { FaqItem } from '../product/cta';
import type { IntegrationGroup } from '../product/integrations';
import type { HeroFact } from '../product/product-hero';
import type { SubNavSection } from '../product/sub-nav';

/* Lists the counts come from */

/** The four money out buckets (SPEC 4.1). */
export const MONEY_OUT: readonly string[] = ['Labor', 'Materials', 'Other costs', 'Time not on a job'];

/** The five status words, the same in every KitStak app (SPEC 4.14). */
export const STATUSES: readonly string[] = [
  'On track',
  'Heads up',
  'At risk',
  'Losing money',
  'Not enough data',
];

/** Every kind of data with a CSV template, import and export (SPEC 7). */
export const CSV_STREAMS: readonly string[] = [
  'Clients',
  'Job types',
  'Jobs',
  'Quotes and budgets',
  'Labor rates',
  'Items',
  'Services',
  'Target pace',
  'Goals',
  'Production',
  'Other time',
  'Paid hours',
  'Time punches',
  'Materials',
  'Service entries',
  'Costs',
  'Revenue',
];

/** The ready made reports (SPEC 6, /reports). */
export const REPORTS: readonly string[] = [
  'Job profit',
  'Profit by client',
  'Profit by job type',
  'Profit by service',
  'Profit by site',
  'Monthly profit and loss',
  'Cost to serve',
  'Plan vs actual',
  'Quote vs actual',
  'Open jobs at risk',
  'Why profit changed',
  'Pace vs target',
  'Labor summary',
  'Paid time not on any job',
  'Material and scrap',
  'Daily production log',
  'Ready to bill',
  'Month close pack',
  'Audit log',
];

/** The first run checklist (SPEC 6, /welcome). */
export const FIRST_STEPS: readonly string[] = [
  'set a labor rate',
  'add a client',
  'add a job',
  'log a day',
  'see your profit',
];

function list(words: readonly string[]): string {
  return words.length < 2
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** US dollars from whole cents. Negative amounts use the minus sign the rest of the site uses. */
export function usd(cents: number, withCents = true): string {
  const amount = (Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: withCents ? 2 : 0,
    maximumFractionDigits: withCents ? 2 : 0,
  });
  return `${cents < 0 ? '−' : ''}$${amount}`;
}

/* Metadata and hero */

export const META = {
  title: 'KitStak Pulse - know which jobs make money',
  description:
    'Profit by job, job type, client and extra service for kitting, 3PL and contract packaging shops. Log units and hours each day. See which jobs are at risk or losing money, and why.',
  socialTitle: 'KitStak Pulse',
  socialDescription: 'Know which jobs make money. Profit by job, job type, client and extra service.',
  url: 'https://kitstak.com/pulse',
} as const;

export const HERO = {
  product: 'KitStak Pulse',
  lines: ['Know which', 'jobs make', 'money.'],
  lead: 'KitStak Pulse shows the profit on every job, job type, client and extra service. Log what got done each day. Pulse works out what the work earned and what it really cost, then tells you which open jobs are at risk or losing money, and why. Built for kitting, 3PL and contract packaging shops.',
  primaryLabel: 'Start with Pulse',
  secondaryLabel: 'Book a walkthrough',
} as const;

export const HERO_FACTS: readonly HeroFact[] = [
  { value: String(MONEY_OUT.length), label: 'kinds of cost in every profit number' },
  { value: String(STATUSES.length), label: 'plain statuses for every open job' },
  { value: String(CSV_STREAMS.length), label: 'kinds of data in and out by CSV' },
  { value: String(REPORTS.length), label: 'ready made reports' },
];

export const SECTIONS: readonly SubNavSection[] = [
  { id: 'problem', label: 'The problem' },
  { id: 'answer', label: 'The math' },
  { id: 'profit', label: 'Profit' },
  { id: 'log', label: 'Log work' },
  { id: 'plan', label: 'Plan vs actual' },
  { id: 'costs', label: 'Real costs' },
  { id: 'risk', label: 'At risk' },
  { id: 'csv', label: 'CSV' },
  { id: 'stack', label: 'Connects' },
  { id: 'together', label: 'Bundle' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'faq', label: 'FAQ' },
];

/* Chapters */

interface ChapterCopy {
  readonly id: string;
  readonly index: string;
  readonly label: string;
  readonly title: string;
  readonly lead: string;
}

export const CHAPTERS = {
  problem: {
    id: 'problem',
    index: '01',
    label: 'The problem',
    title: 'Busy is not the same as profitable.',
    lead: 'You finish the work and send the bill. Weeks later, or never, you learn which jobs paid. By then the job is done and the price is set.',
  },
  answer: {
    id: 'answer',
    index: '02',
    label: 'The answer',
    title: 'Money in. Money out. Profit.',
    lead: 'Pulse answers one question for every job, client and service: are we making money, and if not, why? You log units, people and hours each day. Pulse does the sums and shows them to you.',
  },
  profit: {
    id: 'profit',
    index: '03',
    label: 'Profit',
    title: 'Profit, cut four ways.',
    lead: 'See profit and margin by job, job type, client and extra service (value added services). Rank them best to worst. Then click down to the days behind any number.',
  },
  log: {
    id: 'log',
    index: '04',
    label: 'Daily production entry',
    title: 'The whole day in one grid.',
    lead: 'Profit starts with what happened on the floor. Log work is one row for each active job: units, people and hours. A supervisor can type the whole day at the end of a shift.',
  },
  plan: {
    id: 'plan',
    index: '05',
    label: 'Budget and quote vs actual',
    title: 'Quote. Budget. Actual.',
    lead: 'The quote is what you told the client. The budget is what you think it will cost you. Actual is what happened. Pulse puts them side by side and shows where the gap came from.',
  },
  costs: {
    id: 'costs',
    index: '06',
    label: 'Labor rate and material cost',
    title: 'What an hour really costs.',
    lead: 'The wage is only part of it. The real cost of an hour is the wage, plus payroll taxes and benefits, plus overhead per hour. Pulse builds that rate with you, then costs your materials with the same care.',
  },
  risk: {
    id: 'risk',
    index: '07',
    label: 'At risk and losing money',
    title: 'Catch it before it ends.',
    lead: 'Pulse watches every open job and gives it one of five statuses. Each status comes with the reason in a sentence, the dollar impact and a next step.',
  },
  csv: {
    id: 'csv',
    index: '08',
    label: 'CSV import and export',
    title: 'Your data in. Your data out.',
    lead: `Pulse reads and writes CSV for ${CSV_STREAMS.length} kinds of data, from clients and jobs to production, rates and costs. You do it yourself, and you see a full check before anything is saved.`,
  },
  proof: {
    id: 'proof',
    index: '09',
    label: 'Show the math',
    title: 'Every number shows its work.',
    lead: 'Open any money figure, margin or status in Pulse. It tells you how it was worked out: the formula in words, the same formula with your figures, and a link to the rows behind it.',
  },
  stack: {
    id: 'stack',
    index: '10',
    label: 'With the other KitStak apps',
    title: 'It knows the rest of the stack.',
    lead: 'Run Pulse beside KitStak CRM, WMS and Projects and the data comes to it: jobs from won deals, units from the warehouse, hours from project time. Those apps show Pulse numbers on their own screens too. Pulse never changes your CRM or WMS data.',
  },
} as const satisfies Readonly<Record<string, ChapterCopy>>;

export const PROBLEM_TILES: readonly Feature[] = [
  {
    name: 'The busy month that made no money',
    note: 'The floor ran flat out and the bank balance did not move. With no profit by job, you cannot tell which work to blame.',
  },
  {
    name: 'The job quoted from memory',
    note: 'You priced this job from how the last one felt. Nobody checked what the last one really cost.',
  },
  {
    name: 'The wage is not the cost',
    note: 'An hour costs more than the wage. Payroll taxes, benefits and overhead ride on top. A sheet with only the wage leaves them out.',
  },
  {
    name: 'The good client with a bad job',
    note: 'A client can look fine in total while one of their jobs loses money every day it runs.',
  },
  {
    name: 'Paid time that is on no job',
    note: 'Meetings, cleanup and waiting are paid too. If no job carries that time, every job looks better than it is.',
  },
  {
    name: 'The surprise at the end',
    note: 'A job can look fine until the last unit ships. Then the numbers come in, and it is too late to change the crew or the price.',
  },
];

export const ANSWER_FEATURES: readonly Feature[] = [
  {
    name: 'Money in',
    note: 'What the client pays: the price per unit times the units finished, plus any extra services and other fees.',
  },
  { name: 'Labor', note: 'Hours times what an hour really costs you, not just the wage.' },
  { name: 'Materials', note: 'The parts and supplies you pay for. Parts the client owns cost you nothing.' },
  { name: 'Other costs', note: 'Freight, packaging and outside help.' },
  {
    name: 'Time not on a job',
    note: 'Meetings, cleanup and waiting, spread across the jobs that ran that week.',
  },
  {
    name: 'Profit and margin',
    note: 'Profit is money in minus money out. Margin is profit as a share of money in.',
  },
];

export const PROFIT_FEATURES: readonly Feature[] = [
  {
    name: 'By job',
    note: 'Revenue, cost, profit and margin for each job, with units done of planned and cost per unit against what it should cost.',
  },
  { name: 'By job type', note: 'See which kinds of work pay best, and which ones cost you.' },
  {
    name: 'By client',
    note: 'The profit trend, the cost to serve per unit and per job, and what is earned, billed and not billed yet.',
  },
  {
    name: 'By extra service',
    note: 'Each service in your catalog gets revenue per unit, cost per unit, margin and the clients who use it.',
  },
  {
    name: 'Drill down that adds up',
    note: 'Click a client to see its jobs. Click a job to see its daily entries. Totals always match the level above.',
  },
  {
    name: 'By site and by time',
    note: 'Compare sites, months, weeks or days, against the period before or against the plan.',
  },
];

export const LOG_FEATURES: readonly Feature[] = [
  {
    name: 'Units, people, hours',
    note: 'Type good units, scrap and rework, then the number of people and the hours each. Pulse works out the labor hours.',
  },
  {
    name: 'Crew lines',
    note: "Open a row to split the crew by labor class, like packers, temps and a lead. Copy yesterday's crew in one step.",
  },
  {
    name: 'Keyboard first',
    note: 'Tab and Enter move through the grid. Paste rows from a spreadsheet. Each row saves itself, and you can undo.',
  },
  {
    name: 'A check, not a block',
    note: 'If the hours look wrong, Pulse asks. For example: "12 people for 8 hours is 96 labor hours. You typed 9.6. Is that right?"',
  },
  {
    name: 'Review the day',
    note: 'Mark the day complete. A manager sees the odd rows flagged, then approves the day or sends it back with a note.',
  },
  {
    name: 'Floor tablet',
    note: 'A shared tablet with a 4 digit PIN and a number pad. It never shows money. If the wifi drops, entries wait and send later.',
  },
  {
    name: 'Hours from a file',
    note: 'Bring in hours from a time clock or payroll file, by person, day and job.',
  },
];

export const PLAN_FEATURES: readonly Feature[] = [
  {
    name: 'Plan vs actual',
    note: 'Units, labor hours, pace, each cost, revenue, profit and margin. You see the plan, the actual, the difference and where the job is heading.',
  },
  {
    name: 'Fair to a half done job',
    note: 'For an open job, the plan is scaled to the units finished so far. Switch to the whole job any time.',
  },
  {
    name: 'Why profit changed',
    note: 'One chart splits the gap into price, labor rate, labor efficiency, scrap, material, time not on a job and other. The bars always add up.',
  },
  {
    name: 'A plain reading on every bar',
    note: 'For example: "Labor efficiency: the crew needed 25 more hours than planned for this many units. That cost $550."',
  },
  {
    name: 'Projected finish',
    note: 'For an open job with planned units, Pulse projects profit, margin, labor hours and a finish date from your recent pace. It says what it assumed.',
  },
  {
    name: 'Quote calculator',
    note: 'Price the next job from your real costs. See the cost per unit, the price for your target margin and the lowest price worth taking.',
  },
];

export const COST_FEATURES: readonly Feature[] = [
  {
    name: 'Rate builder',
    note: 'Set the wage, payroll taxes, benefits and overhead for each labor class. In the sample, a packer on a $16.00 wage really costs $21.76 an hour.',
  },
  {
    name: 'Rates with start dates',
    note: 'A raise changes costs only from the day it starts. The history is kept.',
  },
  {
    name: 'Overtime and temps',
    note: 'Overtime has its own rate. Temp agency classes use the agency bill rate.',
  },
  {
    name: 'See it before you save',
    note: 'Any rate change shows how many entries and jobs it touches, and what it does to profit.',
  },
  {
    name: 'Who buys the parts',
    note: 'When the client owns the parts, they cost you nothing. Pulse still counts what was used and scrapped.',
  },
  {
    name: 'Material and scrap',
    note: 'Use one material cost per unit, or log what each job really used. Scrap of your own parts is costed apart.',
  },
  {
    name: 'Wages stay private',
    note: 'Managers see the real cost of an hour, never the wage.',
  },
];

export const RISK_FEATURES: readonly Feature[] = [
  {
    name: 'Five plain statuses',
    note: `${list(STATUSES)}. Always an icon and a word, never color alone.`,
  },
  {
    name: 'The reason, in a sentence',
    note: 'For example: "Margin is heading for 14%. Your target is 30%." Or: "Labor is heading 25% over the plan."',
  },
  {
    name: 'Worst first',
    note: 'The open jobs list starts with the job that needs you most, with margin so far and projected margin on each row.',
  },
  {
    name: 'No false alarm on day one',
    note: 'A job is only called Losing money after 2 days of data, or once it is 20% done.',
  },
  {
    name: 'Alerts inbox',
    note: 'Each alert says what happened, the money impact and the next step. Snooze it, assign it or dismiss it. It closes itself when the problem clears.',
  },
  {
    name: 'Rules you can tune',
    note: 'Twelve rules come ready. Change a threshold and see how many jobs it would flag before you save.',
  },
  {
    name: 'Things to fix',
    note: 'A list of gaps that make a number incomplete, like hours with no rate or days with units and no hours.',
  },
];

export const CSV_FEATURES: readonly Feature[] = [
  {
    name: 'A template for each',
    note: 'Every template has a header row, two example rows and a note on how to fill it in.',
  },
  {
    name: 'Match your columns',
    note: 'Pulse matches columns by their header names and remembers the match for next time.',
  },
  {
    name: 'Check before import',
    note: 'See what is new, changed, the same or wrong before you save. Each problem is named on its cell, like "Row 14, labor_hours: 9x is not a number."',
  },
  {
    name: 'No double counting',
    note: 'A row that looks the same as one already there is skipped unless you say to add it. Pulse warns you if you import the same file twice.',
  },
  {
    name: 'Undo for 7 days',
    note: 'Take an import back, unless a later edit touched those rows.',
  },
  {
    name: 'Export you can import again',
    note: 'Export any kind of data in the same columns as its template. Or download everything as one zip.',
  },
];

export const CSV_WALL: readonly IntegrationGroup[] = [
  {
    title: 'Kinds of data, in and out',
    note: 'Each one has a template, an import with a check step, and an export in the same columns.',
    names: CSV_STREAMS,
  },
  {
    title: 'Ready made reports',
    note: 'Each one has filters, a chart, a table, a print view and a CSV export.',
    names: REPORTS,
  },
];

export const PROOF_FEATURES: readonly Feature[] = [
  {
    name: 'How we got this',
    note: 'For example: "Labor cost $4,212.00 = 162.0 labor hours x $26.00 an hour. See 14 entries."',
  },
  {
    name: 'Honest about gaps',
    note: 'When a number is not complete, Pulse says so, with a line like "2 days have no hours" or "Early guess".',
  },
  {
    name: 'Job profit and company profit',
    note: 'They are two numbers. Jobs carry the costs you put on them. The company also pays for rent, salaried staff and paid time nobody logged. Pulse shows the walk from one to the other.',
  },
  {
    name: 'Right to the cent',
    note: 'Every total equals the sum of the rows under it.',
  },
  {
    name: 'Month close',
    note: 'Close a month and its rows lock. Opening it again needs a reason, and that is logged.',
  },
  {
    name: 'Audit log',
    note: 'A record of who changed what, with the before and the after.',
  },
];

export const STACK_FEATURES: readonly Feature[] = [
  {
    name: 'Two way',
    note: 'Pulse pulls data in from the other apps. They show Pulse numbers on their own screens.',
  },
  {
    name: 'Kept in step',
    note: 'Linked data syncs when you ask, when a linked record changes, and every 15 minutes.',
  },
  {
    name: 'No copies of copies',
    note: 'Syncing twice never makes a second row. If you edit a pulled value in Pulse, your edit wins.',
  },
  {
    name: 'Money stays private',
    note: 'The other apps show Pulse money only to people who may see money in Pulse.',
  },
  {
    name: 'Only what you license',
    note: 'If an app is not there, Pulse hides that link and keeps working.',
  },
];

/* Worked examples (sample numbers) */

export interface MathLine {
  readonly label: string;
  readonly detail: string;
  readonly cents: number;
}

/**
 * One open job, worked out. The numbers are the worked example in SPEC 4.11, 4.13 and 4.14:
 * a 10,000 unit job at $1.75 a unit, 4,000 units done.
 */
export const MATH_JOB = {
  title: 'One job, worked out',
  sub: '4,000 of 10,000 units done · sample numbers',
  moneyIn: { label: 'Money in', detail: '4,000 units × $1.75 a unit', cents: 700_000 },
  moneyOut: [
    { label: MONEY_OUT[0]!, detail: '125 hours × $23.00 an hour', cents: 287_500 },
    { label: MONEY_OUT[1]!, detail: 'Parts and supplies you paid for, $90.00 of it scrap', cents: 190_000 },
    { label: MONEY_OUT[2]!, detail: 'Other costs put on this job', cents: 40_000 },
    { label: MONEY_OUT[3]!, detail: "This job's share of meetings, cleanup and waiting", cents: 26_000 },
  ],
  totalOutLabel: 'Money out',
  profitLabel: 'Profit so far',
  profitCents: 156_500,
  marginLabel: 'Margin',
  status: STATUSES[2]!,
  reason: 'Labor is heading 25% over the plan.',
  projectedProfitCents: 391_250,
  budgetProfitCents: 600_000,
  caption: 'Sample numbers. Check the sum with a calculator.',
} as const satisfies {
  readonly moneyIn: MathLine;
  readonly moneyOut: readonly MathLine[];
  readonly [key: string]: unknown;
};

/** The walk from job profit to company profit, with the worked example in SPEC 4.9. */
export const MATH_BRIDGE = {
  title: 'From job profit to company profit',
  sub: 'One month · sample numbers',
  start: { label: 'Profit on jobs', detail: 'What your jobs made', cents: 4_821_000 },
  steps: [
    {
      label: 'Time not on a job that no job carried',
      detail: 'Meetings, cleanup and waiting',
      cents: -115_000,
    },
    { label: 'Paid time not on any job', detail: 'Hours you paid for that nobody logged', cents: -236_000 },
    {
      label: 'Overhead your hourly rate did not cover',
      detail: 'Company costs of $21,000 less the $16,200 your rates covered',
      cents: -480_000,
    },
  ],
  endLabel: 'Company profit',
  endCents: 3_990_000,
  caption: 'Sample numbers. Pulse never shows job profit as if it were company profit.',
} as const satisfies {
  readonly start: MathLine;
  readonly steps: readonly MathLine[];
  readonly [key: string]: unknown;
};

/* Bundle, pricing, FAQ, closing */

export const BUNDLE = {
  title: 'On its own. Or on the stack.',
  body: 'Pulse does not need any other KitStak app. License it alone and bring your data in by typing or by CSV. Add the other apps later and Pulse pulls in what they already know.',
  primaryLabel: 'Build the bundle',
  secondaryLabel: 'Start with Pulse alone',
} as const;

export const PRICE_INCLUDED: readonly string[] = [
  'Profit by job, job type, client and extra service',
  'Log work, the floor tablet and the wall display',
  'Quote, budget and actual, with the quote calculator',
  'Alerts, goals and month close',
  `All ${REPORTS.length} reports and ${CSV_STREAMS.length} CSV templates`,
  'Links to the CRM, the WMS and Projects when you run them',
];

export const FAQ_TITLE = 'Straight answers.';

export const FAQ: readonly FaqItem[] = [
  {
    question: 'What is KitStak Pulse, and who is it for?',
    answer:
      'Pulse is profit management for shops that work by the job: kitting, 3PL and contract packaging. It shows what each job earned, what it really cost, and the profit by job, job type, client and extra service. Owners and finance or operations leads read the profit. Managers watch their jobs. Floor leads log the day.',
  },
  {
    question: 'What do I have to enter each day?',
    answer:
      'Units finished, the number of people and the hours, for each job that ran. That is the daily habit Pulse needs. You can type it, paste it from a spreadsheet, enter it on a floor tablet or import a time clock or payroll file. Prices and labor rates are set once, then changed when they change.',
  },
  {
    question: 'How does Pulse work out the real cost of an hour?',
    answer:
      'It adds the wage, payroll taxes, benefits and overhead per hour for each labor class. In the sample on this page, a packer on a $16.00 wage costs $21.76 an hour. Rates have start dates, so a raise only changes costs from that day on.',
  },
  {
    question: 'How does Pulse decide a job is at risk or losing money?',
    answer:
      'It works out where the job will finish, from your recent pace and the plan. It is plain math on your own numbers. A job is At risk when, for example, margin is heading well under your target or labor is heading well over the plan. It is Losing money when it is heading for a loss. You can change the thresholds.',
  },
  {
    question: 'Why is job profit different from company profit?',
    answer:
      'They are two numbers. Jobs carry the costs you put on them. The company also pays for rent, salaried staff and paid time nobody logged. Pulse shows both, and the walk from one to the other, line by line.',
  },
  {
    question: 'Do I need the other KitStak apps?',
    answer: `No. Pulse works on its own. Every screen works, and CSV goes in and out for all ${CSV_STREAMS.length} kinds of data. If you also run KitStak CRM, WMS or Projects, Pulse links to them, and you share one sign-in.`,
  },
  {
    question: 'Can I bring in my own data and get it back out?',
    answer:
      'Yes. Each kind of data has a CSV template. You upload a file, match the columns and see a check before anything is saved. You can undo an import for 7 days. Exports use the same columns, so what you take out can go back in.',
  },
  {
    question: 'Who can see money and wages?',
    answer:
      'Seeing money is opt in. Pulse has five roles: owner, admin, manager, supervisor and viewer. Supervisors and viewers see units, hours and pace by default, not dollars. Managers see the real cost of an hour but never the wage. Only the owner and admins see wage detail.',
  },
  {
    question: 'How do I start?',
    answer: `You can load sample data and see a job's profit right away, import your spreadsheets, or type your first job. Then a short checklist walks you through it: ${list(FIRST_STEPS)}. The sample data can be cleared when you are done.`,
  },
  {
    question: 'What does Pulse not do?',
    answer:
      'Pulse is not payroll, invoicing or accounting software. It does not pay people, send bills or send email. Alerts and reports stay inside Pulse. It has no time clock of its own and no scorecard for each worker. It is a web app that fits a phone screen, with no app to install. Each job has one kind of unit and one price. It links to the other KitStak apps, and everything else comes in and goes out by CSV.',
  },
];

export const CLOSING = {
  title: 'Know which jobs pay.',
  startLabel: 'Start with Pulse',
  note: 'Runs on its own, or alongside the CRM, the WMS and Projects with one sign-in.',
} as const;
