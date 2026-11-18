/**
 * Copy for the /pulse product page. Every capability named here is something docs/pulse/SPEC.md
 * says KitStak Pulse does; keep it that way when editing. No customer names, no results, no
 * statistics, and no payroll, invoicing, accounting, email, AI or third party integration claims.
 * Copy rules: plain words, short sentences, and never an em dash, an en dash or a double hyphen
 * (src/lib/pulse-claims.test.ts checks every string in this file).
 * Words for a screen are the words on that screen: Revenue and Cost, Quote vs actual, the five
 * statuses in the order the Jobs page lists them. The chapters with a real screenshot quote no
 * sample figures, because the demo data moves with every retake. The only dollar figures are in the
 * worked job, a coded example taken from the spec, and the test proves its sums add up.
 */
import { PULSE_IS_LIVE } from '../site-links';
import type { Feature } from '../product/chapter';
import type { FaqItem } from '../product/cta';
import type { HeroFact } from '../product/product-hero';
import type { SubNavSection } from '../product/sub-nav';

/* Lists the counts come from */

/** The four kinds of cost, named the way the Profit and Plan vs actual screens name them (SPEC 4.1). */
export const COSTS: readonly string[] = ['Labor cost', 'Material cost', 'Other cost', 'Time not on a job'];

/** The five roles (SPEC 3). */
export const ROLES: readonly string[] = ['owner', 'admin', 'manager', 'supervisor', 'viewer'];

/** The four cuts of profit the page leads with (SPEC 6, /profit). */
export const PROFIT_CUTS: readonly string[] = ['job', 'job type', 'client', 'extra service'];

/** The tabs across the top of the Profit page, in screen order. The first four are the cuts above. */
export const PROFIT_TABS: readonly string[] = [
  'Jobs',
  'Clients',
  'Job types',
  'Extra services',
  'Sites',
  'Months',
  'Weeks',
  'Days',
];

/** The five status words, in the order the Jobs page lists them, worst first (SPEC 4.14). */
export const STATUSES: readonly string[] = [
  'Losing money',
  'At risk',
  'Not enough data',
  'Heads up',
  'On track',
];

/** The six counters on step 3, Check, of an import, in screen order. */
export const IMPORT_COUNTERS: readonly string[] = [
  'New',
  'Changed',
  'No change',
  'Look the same',
  'Left out',
  'Problems',
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

/** US dollars from whole cents. A loss takes the plain hyphen Pulse itself uses: "-$125.00" (SPEC 4.11). */
export function usd(cents: number, withCents = true): string {
  const amount = (Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: withCents ? 2 : 0,
    maximumFractionDigits: withCents ? 2 : 0,
  });
  return `${cents < 0 ? '-' : ''}$${amount}`;
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
  lead: 'For kitting, 3PL and contract packaging shops. Log units and hours each day. Pulse shows the profit on every job, job type, client and extra service. It tells you which open jobs are losing money, and why.',
  startLabel: 'Start with Pulse',
  walkthroughLabel: 'Book a walkthrough',
  /** Jumps to the worked job. It is the second button while the app is not open yet. */
  mathLabel: 'See a worked job',
} as const;

/** The system alert rules that come ready to tune or turn off (SPEC 6, /alerts/rules). */
export const ALERT_RULES = 12;

/** Four things a buyer can count. Each value is the length of the list it counts. A phone shows the first two. */
export const HERO_FACTS: readonly HeroFact[] = [
  { value: String(PROFIT_TABS.length), label: 'ways to cut profit, from jobs and clients to weeks and days' },
  { value: String(STATUSES.length), label: 'plain statuses for every open job' },
  { value: String(CSV_STREAMS.length), label: 'kinds of data in and out by CSV' },
  { value: String(REPORTS.length), label: 'ready made reports' },
];

/**
 * The sticky sub navigation: the eight stops a buyer jumps to, in page order. Each label is the
 * same word as the small label over its chapter. "Other apps" is the bundle band, which carries the
 * links to the other KitStak apps. The first chapter, the problem, sits straight under the bar, so
 * it has no stop: nine stops do not fit a 1440 pixel screen beside the button.
 */
export const SECTIONS: readonly SubNavSection[] = [
  { id: 'answer', label: 'The math' },
  { id: 'profit', label: 'Profit' },
  { id: 'risk', label: 'At risk' },
  { id: 'log', label: 'Log work' },
  { id: 'plan', label: 'Quote vs actual' },
  { id: 'together', label: 'Other apps' },
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

/**
 * In page order. The one thing a spreadsheet cannot do, catching a losing job before it ends,
 * comes straight after the first profit screens. The proof follows it. The plumbing (CSV) comes
 * last, and the other apps follow in the bundle band.
 */
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
    label: 'The math',
    title: 'Revenue. Cost. Profit.',
    lead: 'Revenue is the money a job earns. Cost is what the work took. Profit is what is left. You log units, people and hours. Pulse does the sums and shows them.',
  },
  profit: {
    id: 'profit',
    index: '03',
    label: 'Profit',
    title: 'Profit, any way you cut it.',
    lead: 'See revenue, cost, profit and margin by job, client, job type and extra service. Or by site, month, week and day.',
  },
  risk: {
    id: 'risk',
    index: '04',
    label: 'At risk',
    title: 'Catch it before it ends.',
    lead: 'Pulse works out where each open job is heading, from your recent pace and the plan. Ongoing work is judged on its last 30 days. Each job gets one of five statuses, with the reason in a sentence.',
  },
  proof: {
    id: 'proof',
    index: '05',
    label: 'How we got this',
    title: 'Every number shows its work.',
    lead: 'Open any money figure, margin or status. Pulse says in words how it got the number, shows each step with your figures, and links to what is behind it.',
  },
  log: {
    id: 'log',
    index: '06',
    label: 'Log work',
    title: 'The whole day on one screen.',
    lead: 'Log work lists every active job for the day. Type the units, the people and the hours. A floor lead can do the whole day at the end of a shift.',
  },
  plan: {
    id: 'plan',
    index: '07',
    label: 'Quote vs actual',
    title: 'See where the gap came from.',
    lead: 'The quote is what you told the client. Actual is what happened. Pulse puts them side by side and splits the gap by cause. You can add your own budget and compare with that too.',
  },
  costs: {
    id: 'costs',
    index: '08',
    label: 'Real cost of an hour',
    title: 'What an hour really costs.',
    lead: 'The real cost of an hour is the wage, plus payroll taxes and benefits, plus overhead for each hour. Pulse builds that rate with you for each labor class, such as packer or line lead.',
  },
  csv: {
    id: 'csv',
    index: '09',
    label: 'CSV import and export',
    title: 'Your data in. Your data out.',
    lead: `Pulse reads and writes CSV for ${CSV_STREAMS.length} kinds of data, each with its own template. You do it yourself.`,
  },
} as const satisfies Readonly<Record<string, ChapterCopy>>;

/* Feature lists. Three rows at most in each one: the page is a pitch, not a manual. */

export const PROBLEM_TILES: readonly Feature[] = [
  {
    name: 'The busy month that made no money',
    note: 'The floor ran flat out and the bank balance did not move. Without profit by job, you cannot tell which work to blame.',
  },
  {
    name: 'The wage is not the cost',
    note: 'An hour costs more than the wage. Payroll taxes, benefits and overhead ride on top.',
  },
  {
    name: 'The surprise at the end',
    note: 'A job can look fine until the last unit ships. By then it is too late to change the crew or the price.',
  },
];

/** Two rows only. The worked job beside them already spells out revenue, profit and margin. */
export const ANSWER_FEATURES: readonly Feature[] = [
  {
    name: 'Four kinds of cost',
    note: 'Labor at what an hour really costs. Materials you pay for. Other costs like freight. And time not on a job, such as meetings and cleanup.',
  },
  {
    name: 'Same day numbers',
    note: 'Save an entry and the profit updates. There is no nightly run to wait for.',
  },
];

/** The screenshot is the Jobs tab as a table. The other rows name what the other tabs add. */
export const PROFIT_FEATURES: readonly Feature[] = [
  {
    name: 'Every job in one table',
    note: 'Each job shows its revenue, profit and margin. A wide screen adds its status and the four costs. Sort by any column, or switch to a chart.',
  },
  {
    name: 'Clients and extra services',
    note: 'Open a client to see cost to serve. That is what the client costs you for each unit and each job. You also see what is not billed yet. Open an extra service to see its revenue, cost and margin.',
  },
  {
    name: 'Drill down that adds up',
    note: 'Open a client to see its jobs. Open a job to see its days. Totals always match the level above.',
  },
];

/** Two rows. The real "How we got this" panel beside them shows both: the steps and the warning lines. */
export const PROOF_FEATURES: readonly Feature[] = [
  {
    name: 'Honest about gaps',
    note: 'A number with no warning line is complete. One that is not complete says why.',
  },
  {
    name: 'Job profit and company profit',
    note: 'Two numbers. The company also pays for rent, salaried staff and paid hours nobody logged. Pulse shows each step from job profit to company profit.',
  },
];

export const LOG_FEATURES: readonly Feature[] = [
  {
    name: 'Units, people, hours',
    note: 'Type the good units, scrap and rework. Pick the crew, then type how many people and how many hours each. Add a second crew line for a line lead. Pulse works out the labor hours.',
  },
  {
    name: 'Pace as you type',
    note: 'A filled job shows its pace against the target, as On pace or Too slow, with the labor cost and margin for the day.',
  },
  {
    name: 'Floor tablet',
    note: 'A shared tablet with a 4 digit PIN. It never shows money. If the wifi drops, entries wait and send later.',
  },
];

export const PLAN_FEATURES: readonly Feature[] = [
  {
    name: 'Quote vs actual',
    note: 'For an open job, the quote is scaled to the units finished so far. A half done job is judged fairly.',
  },
  {
    name: 'Why profit changed',
    note: 'One chart splits the gap by cause: price, labor rate, labor efficiency, scrap, material, time not on a job and other. The bars always add up.',
  },
  {
    name: 'The reading in words',
    note: 'Beside the chart, Pulse names the gap, the biggest drag and the biggest lift, each in a plain sentence.',
  },
];

/**
 * Two rows. The screenshot carries the numbers, so the copy quotes none. A phone shows the Rates tab
 * and a wide screen the dialog behind "Change the rate", so the first row holds for both.
 */
export const COST_FEATURES: readonly Feature[] = [
  {
    name: 'See it before you save',
    note: 'Change the rate, then type the wage and what you pay on top. Pulse shows what one hour really costs, what an overtime hour costs, and how many logged entries the new rate changes.',
  },
  {
    name: 'Raises start on a date',
    note: 'Every rate has a start date. A raise changes costs only from that day on.',
  },
];

export const RISK_FEATURES: readonly Feature[] = [
  {
    name: 'Five plain statuses',
    note: `${list(STATUSES)}. Always an icon and a word, never color alone.`,
  },
  {
    name: 'The money at stake',
    note: 'Each row shows the margin now and the profit the job is heading for at the finish. A wide screen adds your target.',
  },
  {
    name: 'Alerts you can tune',
    note: 'Each alert says what happened, the money impact and the next step. Twelve rules come ready to tune or turn off.',
  },
];

export const CSV_FEATURES: readonly Feature[] = [
  {
    name: 'Check before you save',
    note: `Step 3, Check, sorts every row of the file: ${list(IMPORT_COUNTERS)}. Each problem is named on its cell, with how to fix it.`,
  },
  {
    name: 'Export you can import again',
    note: 'Export any kind of data in the same columns as its template. Or download everything as one zip.',
  },
];

/* Worked examples (sample numbers) */

export interface MathLine {
  readonly label: string;
  readonly detail: string;
  readonly cents: number;
}

/**
 * One open job, worked out. It is a coded example, not a screenshot, and says so. The numbers are
 * the worked example in SPEC 4.11, 4.13 and 4.14: a 10,000 unit job at $1.75 a unit, 4,000 units
 * done. The labels are the ones the Plan vs actual screen uses.
 */
export const MATH_JOB = {
  title: 'One job, worked out',
  sub: '4,000 of 10,000 units done · a worked example',
  moneyIn: { label: 'Revenue', detail: '4,000 units × $1.75 a unit', cents: 700_000 },
  moneyOut: [
    { label: COSTS[0]!, detail: '125 hours × $23.00 an hour, the crew average', cents: 287_500 },
    { label: COSTS[1]!, detail: 'Parts and supplies you paid for, $90.00 of it scrap', cents: 190_000 },
    { label: COSTS[2]!, detail: 'Freight and other costs put on this job', cents: 40_000 },
    { label: COSTS[3]!, detail: "This job's share of meetings, cleanup and waiting", cents: 26_000 },
  ],
  totalOutLabel: 'Total cost',
  profitLabel: 'Profit so far',
  profitCents: 156_500,
  marginLabel: 'Margin',
  status: 'At risk',
  /** The reason sentence in the product's own words (SPEC 4.14). The 25% is labor hours. */
  reason: 'Labor is heading 25% over the plan.',
  /** Hours used so far and the plan for the units done, so a reader can see where 25% comes from. */
  laborHours: { actual: 125, plan: 100 },
  projectedProfitCents: 391_250,
  budgetProfitCents: 600_000,
  caption: 'A worked example with sample numbers, not a screenshot. Check the sum with a calculator.',
} as const satisfies {
  readonly moneyIn: MathLine;
  readonly moneyOut: readonly MathLine[];
  readonly [key: string]: unknown;
};

/**
 * "How we got this" for the labor cost of the same job (SPEC 4.15): the formula in words, the same
 * formula with the figures, and a note about the rows behind it. One figure is enough to show the
 * pattern: the worked job two chapters up already spells out the margin sum.
 */
export const MATH_EXPLAIN = {
  title: 'How we got this',
  sub: 'The same job · a worked example',
  wordsLabel: 'In words',
  figuresLabel: 'With your figures',
  rowsLabel: 'In Pulse, a link here opens the entries behind the number.',
  labor: {
    label: 'Labor cost',
    words: 'Labor hours × the real cost of an hour',
    hours: 125,
    rateCents: 2_300,
  },
  gapsLabel: 'When a number is not complete, a line under it says why:',
  gaps: ['2 days have no hours', 'Uses the default rate', 'Early guess'],
} as const;

/* Bundle, pricing, FAQ, closing */

export const BUNDLE = {
  title: 'On its own. Or on the stack.',
  body: 'Pulse does not need any other KitStak app. Add the CRM, the WMS or Projects and Pulse pulls in what they know. They show Pulse numbers on their own screens. Pulse never changes your CRM or WMS data.',
  primaryLabel: 'Build the bundle',
  startLabel: 'Start with Pulse alone',
  /** The second button while Pulse is coming soon. The setup wizard it opens leaves Pulse out. */
  othersLabel: 'Set up the other apps today',
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
      'Pulse is profit management for shops that work by the job: kitting, 3PL and contract packaging. A 3PL is a warehouse that ships for other companies. Pulse shows what each job earned, what it really cost, and the profit by job, job type, client and extra service. An extra service is work you bill on top of a job. Some shops call these value added services. Owners and finance or operations leads read the profit. Managers watch their jobs. Floor leads log the day.',
  },
  {
    question: 'What do I have to enter each day?',
    answer:
      'Units finished, the number of people and the hours, for each job that ran. That is the daily habit Pulse needs. You can type it, paste it from a spreadsheet, enter it on a floor tablet or import a time clock or payroll file. Prices and labor rates are set once, then changed when they change.',
  },
  {
    question: 'How does Pulse work out the real cost of an hour?',
    answer:
      'It adds the wage, payroll taxes, benefits and overhead for each hour, for each labor class. Rates have start dates, so a raise only changes costs from that day on.',
  },
  {
    question: 'How does Pulse decide a job is at risk or losing money?',
    answer:
      'For a job with a plan, it works out where the job will finish, from your recent pace and the plan. Ongoing work is judged on the last 30 days. It is plain math on your own numbers. A job is At risk when it is heading well under your target margin. It is also At risk when labor is heading well over the plan. A job is Losing money when it is heading for a loss. Pulse waits for 2 days of data, or until the job is 20% done, before it says so. You can change the limits.',
  },
  {
    question: 'Why is job profit different from company profit?',
    answer:
      'Jobs carry only the costs you put on them. The company also pays for overhead and for paid time nobody logged to a job, and Pulse shows each step from job profit to company profit.',
  },
  {
    question: 'Do I need the other KitStak apps?',
    answer: `No. Pulse works on its own. Every screen works, and CSV goes in and out for all ${CSV_STREAMS.length} kinds of data. If you also run KitStak CRM, WMS or Projects, Pulse links to them, and you share one sign-in.`,
  },
  {
    question: 'Can I bring in my own data and get it back out?',
    answer:
      'Yes. Each kind of data has a CSV template. You upload a file, match the columns and see a check before anything is saved. You can undo an import for 7 days, unless someone has edited those rows since. Exports use the same columns, so what you take out can go back in.',
  },
  {
    question: 'Who can see money and wages?',
    answer: `Owners, admins and managers see money. Nobody else does unless you turn it on. Of the ${ROLES.length} roles, supervisors (your floor leads) and viewers see units, hours and pace, not dollars. Managers see the real cost of an hour but never the wage.`,
  },
  {
    question: 'How do I start?',
    answer: PULSE_IS_LIVE
      ? `You can load sample data and see a job's profit right away, import your spreadsheets, or type your first job. Then a short checklist walks you through it: ${list(FIRST_STEPS)}. Pulse is a web app that fits a phone screen, with no app to install.`
      : `Pulse is coming soon. Book a walkthrough and we will show it to you on sample data. When it opens, you can load sample data, import your spreadsheets or type your first job. Then a short checklist walks you through it: ${list(FIRST_STEPS)}. Pulse is a web app that fits a phone screen, with no app to install.`,
  },
  {
    question: 'What does Pulse not do?',
    answer:
      'Pulse has no time clock of its own. Hours are typed in or come from a file. It does not send bills, and it is not payroll or accounting software. Each job has one kind of unit and one price. It has no scorecard for each worker. It does not send email, so alerts and reports stay inside Pulse. It links to the other KitStak apps only, and everything else comes in and goes out by CSV.',
  },
];

export const CLOSING = {
  title: 'Know which jobs pay.',
  note: PULSE_IS_LIVE
    ? 'Runs on its own, or alongside the CRM, the WMS and Projects with one sign-in.'
    : 'Coming soon. Book a walkthrough and we will show you Pulse on sample data.',
} as const;
