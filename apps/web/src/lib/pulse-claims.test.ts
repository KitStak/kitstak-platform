/**
 * Guards for the /pulse product page (src/app/pulse/page.tsx, src/components/pulse/pulse-content.ts).
 *
 * 1. Copy rules, always on: no em dash, en dash or double hyphen anywhere in the Pulse copy, no
 *    placeholder text, no claims we cannot back up, and sentences short enough to read in one go.
 * 2. Numbers, always on: every count is derived from its list, and the worked examples add up.
 * 3. Claims, when the evidence is in the tree: each claim on the page maps to wording in
 *    docs/pulse/SPEC.md and, where the app already has it, to code under apps/pulse/src. If the
 *    product drops a feature, this fails and the copy must change with it.
 *
 * The Pulse spec and app live on their own branch until they merge, so the claim suites are
 * skipped when those paths are missing. To run them early, point PULSE_SPEC_PATH and
 * PULSE_SRC_PATH at a copy.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRODUCT_NAV } from '@/components/nav/nav-data';
import * as content from '@/components/pulse/pulse-content';
import {
  ALERT_RULES,
  CHAPTERS,
  COSTS,
  COST_FEATURES,
  CSV_FEATURES,
  CSV_STREAMS,
  FAQ,
  FIRST_STEPS,
  HERO,
  HERO_FACTS,
  IMPORT_COUNTERS,
  MATH_EXPLAIN,
  MATH_JOB,
  PLAN_FEATURES,
  PROFIT_CUTS,
  PROFIT_TABS,
  REPORTS,
  RISK_FEATURES,
  ROLES,
  SECTIONS,
  STATUSES,
  usd,
} from '@/components/pulse/pulse-content';
import { PULSE_SHOTS } from '@/components/pulse/pulse-shots';

const webRoot = path.resolve(__dirname, '../..');
const pulseComponents = path.join(webRoot, 'src/components/pulse');
const pulsePage = path.join(webRoot, 'src/app/pulse/page.tsx');

/** Every string reachable from the content module's exports. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => strings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => strings(item, out));
  return out;
}

const COPY = strings(content);

/** The page and every hand-written Pulse page file, as source text (comments and CSS included). */
const OWN_SOURCES: readonly string[] = [
  pulsePage,
  ...readdirSync(pulseComponents)
    .filter((name) => /^pulse-(content|section|page)/.test(name))
    .map((name) => path.join(pulseComponents, name)),
];

const EM_DASH = '\u2014';
const EN_DASH = '\u2013';

describe('/pulse copy rules', () => {
  it('finds the copy', () => {
    expect(COPY.length).toBeGreaterThan(150);
  });

  it.each(COPY.map((text) => [text]))('has no em dash, en dash or double hyphen: %s', (text) => {
    expect(text).not.toContain(EM_DASH);
    expect(text).not.toContain(EN_DASH);
    expect(text).not.toContain('--');
  });

  it.each(OWN_SOURCES.map((file) => [path.relative(webRoot, file), file]))(
    '%s has no dashes in source',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain(EM_DASH);
      expect(source).not.toContain(EN_DASH);
      // The only "--" allowed in source is the start of a CSS custom property, such as --reveal-delay.
      expect(source).not.toMatch(/--(?![a-z])/);
    },
  );

  it('has no placeholder text', () => {
    for (const text of COPY)
      // "Coming soon" is not placeholder text: it is the owner's wording while PULSE_IS_LIVE is false.
      expect(text).not.toMatch(/lorem|ipsum|\bTODO\b|\bTBD\b|placeholder/i);
  });

  it('makes no claim the product cannot back up', () => {
    const banned = [
      /\bAI\b/,
      /machine learning|artificial intelligence/i,
      /real[- ]time|\binstant(ly)?\b|\bautomatic(ally)?\b/i,
      /\bunlimited\b|\bguarantee[ds]?\b|free trial|free tier/i,
      /\bROI\b|payback|\bsave(s|d)? (you )?\d|\bup to \d/i,
      /Easy ?Metrics|QuickBooks|Jobber|Xero|NetSuite|Gusto|\bADP\b|Shopify|Zapier|Slack/i,
      /SOC ?2|\bISO\b|GDPR|HIPAA|\bSSO\b|\bSLA\b|uptime/i,
      /testimonial|case study|trusted by|customers (love|say)|\bbest\b in|world class|seamless|revolutionary/i,
      /\bapi\b|webhook/i,
    ];
    for (const text of COPY) for (const pattern of banned) expect(text).not.toMatch(pattern);
  });

  it('uses the product word for extra services, and explains it once for searchers', () => {
    const all = COPY.join('\n');
    expect(all.match(/value added services/g)).toHaveLength(1);
    expect(all).not.toMatch(/\bVAS\b/);
    expect(all).not.toMatch(/\bUPH\b|loaded rate|indirect time/i);
  });

  it('keeps sentences short', () => {
    const prose = COPY.filter((text) => /\s/.test(text) && /[.?]$/.test(text));
    const sentences = prose
      .flatMap((text) => text.split(/(?<=[.?!])\s+/))
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0);
    const words = sentences.map((sentence) => sentence.split(/\s+/).length);
    const average = words.reduce((total, n) => total + n, 0) / words.length;
    expect(average).toBeLessThanOrEqual(14);
    expect(Math.max(...words)).toBeLessThanOrEqual(32);
  });

  it('starts every FAQ answer with the answer', () => {
    expect(FAQ.length).toBeGreaterThanOrEqual(8);
    expect(FAQ.length).toBeLessThanOrEqual(10);
    expect(new Set(FAQ.map((item) => item.question)).size).toBe(FAQ.length);
    for (const item of FAQ) {
      expect(item.question.endsWith('?')).toBe(true);
      const first = item.answer.split(/(?<=[.?!])\s+/)[0]!;
      expect(first.split(/\s+/).length).toBeLessThanOrEqual(22);
    }
    expect(FAQ.some((item) => /not do\?$/.test(item.question))).toBe(true);
  });
});

describe('/pulse structure', () => {
  const chapterIds = Object.values(CHAPTERS).map((chapter) => chapter.id);
  const anchorIds = new Set([...chapterIds, 'together', 'pricing', 'faq']);

  it('numbers the chapters in order with unique ids', () => {
    expect(new Set(chapterIds).size).toBe(chapterIds.length);
    expect(Object.values(CHAPTERS).map((chapter) => chapter.index)).toEqual(
      chapterIds.map((_, i) => String(i + 1).padStart(2, '0')),
    );
    for (const [key, chapter] of Object.entries(CHAPTERS)) expect(chapter.id).toBe(key);
  });

  it('renders every chapter on the page', () => {
    const page = readFileSync(pulsePage, 'utf8');
    for (const key of Object.keys(CHAPTERS)) expect(page).toContain(`{...CHAPTERS.${key}}`);
  });

  it('points every sub navigation entry at a real section', () => {
    expect(new Set(SECTIONS.map((section) => section.id)).size).toBe(SECTIONS.length);
    for (const section of SECTIONS) expect(anchorIds.has(section.id)).toBe(true);
    expect(SECTIONS.slice(-2).map((section) => section.id)).toEqual(['pricing', 'faq']);
  });

  it('points every Pulse deep link in the site navigation at a real section', () => {
    const nav = PRODUCT_NAV.find((product) => (product.id as string) === 'pulse');
    expect(nav, 'PRODUCT_NAV needs a Pulse entry').toBeDefined();
    for (const link of nav?.links ?? []) {
      const [route, hash] = link.href.split('#');
      expect(route).toBe('/pulse');
      if (hash !== undefined) expect(anchorIds.has(hash), `${link.href} has no section`).toBe(true);
    }
  });

  it('keeps list keys unique', () => {
    const lists = (Object.values(content) as readonly unknown[]).filter(
      (value): value is readonly { name: string }[] =>
        Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && 'name' in value[0],
    );
    expect(lists.length).toBeGreaterThanOrEqual(9);
    for (const items of lists) expect(new Set(items.map((item) => item.name)).size).toBe(items.length);
    expect(new Set(HERO_FACTS.map((fact) => fact.label)).size).toBe(HERO_FACTS.length);
    expect(new Set(HERO.lines).size).toBe(HERO.lines.length);
  });
});

describe('/pulse numbers', () => {
  it('derives each count from the list it counts, at the size the spec states', () => {
    expect(COSTS).toHaveLength(4);
    expect(STATUSES).toHaveLength(5);
    expect(PROFIT_TABS).toHaveLength(8);
    expect(IMPORT_COUNTERS).toHaveLength(6);
    expect(CSV_STREAMS).toHaveLength(17);
    expect(REPORTS).toHaveLength(19);
    expect(FIRST_STEPS).toHaveLength(5);
    for (const items of [COSTS, STATUSES, CSV_STREAMS, REPORTS, PROFIT_TABS, IMPORT_COUNTERS])
      expect(new Set(items).size).toBe(items.length);
    expect(ROLES).toHaveLength(5);
    // Every hero fact is a count of something real: Profit tabs, statuses, CSV kinds of data, reports.
    expect(HERO_FACTS.map((fact) => fact.value)).toEqual(['8', '5', '17', '19']);
    expect(HERO_FACTS.map((fact) => Number(fact.value))).toEqual([
      PROFIT_TABS.length,
      STATUSES.length,
      CSV_STREAMS.length,
      REPORTS.length,
    ]);
    expect(PROFIT_CUTS).toHaveLength(4);
    expect(ALERT_RULES).toBe(12);
    expect(COPY.some((text) => text.includes('Twelve rules'))).toBe(true);
    // A count written out by hand in a sentence would drift; none may appear that the lists do not back.
    for (const text of COPY) {
      for (const match of text.matchAll(/\b(\d+) (kinds of data|reports|CSV templates)\b/g)) {
        expect(Number(match[1])).toBe(match[2] === 'reports' ? REPORTS.length : CSV_STREAMS.length);
      }
    }
  });

  it('formats money the way Pulse does, with a plain hyphen for a loss', () => {
    expect(usd(156_500)).toBe('$1,565.00');
    expect(usd(-26_000)).toBe('-$260.00');
    expect(usd(3_990_000, false)).toBe('$39,900');
  });

  it('works the sample job out exactly (SPEC 4.11, 4.13, 4.14)', () => {
    const out = MATH_JOB.moneyOut.reduce((total, line) => total + line.cents, 0);
    expect(MATH_JOB.moneyOut.map((line) => line.label)).toEqual(COSTS);
    expect(MATH_JOB.moneyIn.cents).toBe(4_000 * 175);
    expect(MATH_JOB.moneyOut[0].cents).toBe(125 * 2_300);
    expect(out).toBe(543_500);
    expect(MATH_JOB.moneyIn.cents - out).toBe(MATH_JOB.profitCents);
    expect(MATH_JOB.profitCents).toBe(156_500);
    // Cost at finish $13,587.50 against revenue at finish $17,500.00.
    expect(1_750_000 - 1_358_750).toBe(MATH_JOB.projectedProfitCents);
    // Budget: revenue $17,500 less labor $5,500, material $4,500, shared $500 and other $1,000.
    expect(1_750_000 - 550_000 - 450_000 - 50_000 - 100_000).toBe(MATH_JOB.budgetProfitCents);
    // Projected labor hours 312.5 against a plan of 250 is 25% over.
    expect((312.5 / 250 - 1) * 100).toBe(25);
    expect(MATH_JOB.status).toBe('At risk');
    expect(STATUSES).toContain(MATH_JOB.status);
  });

  it('shows where "25% over the plan" comes from: labor hours, not labor dollars', () => {
    const { actual, plan } = MATH_JOB.laborHours;
    expect(MATH_JOB.reason).toBe('Labor is heading 25% over the plan.');
    // 125 hours used where the plan for 4,000 of 10,000 units was 100: the same 25% as at finish.
    expect((actual / plan - 1) * 100).toBe(25);
    expect(plan).toBe((250 * 4_000) / 10_000);
    expect(actual / plan).toBe(312.5 / 250);
    // The labor line of the worked job states the same hours the reason is explained with.
    expect(MATH_JOB.moneyOut[0].detail).toContain(`${actual} hours`);
    expect(actual).toBe(MATH_EXPLAIN.labor.hours);
  });

  it('explains figures of the same worked job, in the spec wording (SPEC 4.15)', () => {
    const { labor } = MATH_EXPLAIN;
    expect(labor.hours * labor.rateCents).toBe(MATH_JOB.moneyOut[0].cents);
    // The worked job states the same hours and the same rate.
    expect(MATH_JOB.moneyOut[0].detail).toContain(`${labor.hours} hours`);
    expect(MATH_JOB.moneyOut[0].detail).toContain(usd(labor.rateCents));
    expect(MATH_EXPLAIN.gaps).toEqual(['2 days have no hours', 'Uses the default rate', 'Early guess']);
    // No other hourly rate is quoted as an example anywhere in the copy.
    for (const text of COPY) expect(text).not.toMatch(/\$26\.00|\$4,212/);
  });

  it('quotes sample dollar figures only in the worked job, never beside a real screenshot', () => {
    // The demo data moves with every retake, so copy next to a screenshot describes it and quotes no
    // figure. The worked job and its "How we got this" panel are coded examples and say so.
    const worked = new Set([...strings(MATH_JOB), ...strings(MATH_EXPLAIN)]);
    for (const text of COPY) if (!worked.has(text)) expect(text, text).not.toMatch(/\$\s?\d/);
    for (const shot of Object.values(PULSE_SHOTS)) expect(shot.alt, shot.name).not.toMatch(/\$\s?\d/);
    // The old stand-in rate ($16.00 wage, $21.76 an hour) and the old sample month are gone.
    for (const text of COPY) expect(text).not.toMatch(/\$16\.00|\$21\.76|\$48,210|6 jobs need/);
    expect(MATH_JOB.sub).toMatch(/worked example/);
    expect(MATH_JOB.caption).toMatch(/not a screenshot/);
    expect(MATH_EXPLAIN.sub).toMatch(/worked example/);
  });

  it('uses one multiply sign', () => {
    for (const text of COPY) expect(text).not.toMatch(/\d x \$|hours x /);
    expect(MATH_EXPLAIN.labor.words).toContain('×');
  });
});

describe('/pulse copy uses the words on the real screens', () => {
  const all = COPY.join('\n');

  it('says Revenue and Cost, the labels on the Home and Profit tiles', () => {
    expect(all).not.toMatch(/money in\b|money out\b/i);
    expect(MATH_JOB.moneyIn.label).toBe('Revenue');
    expect(MATH_JOB.totalOutLabel).toBe('Total cost');
    expect(COSTS).toEqual(['Labor cost', 'Material cost', 'Other cost', 'Time not on a job']);
  });

  it('lists the five statuses in the order of the chips on the Jobs page', () => {
    expect(STATUSES).toEqual(['Losing money', 'At risk', 'Not enough data', 'Heads up', 'On track']);
    expect(RISK_FEATURES[0]!.note).toContain('Losing money, At risk, Not enough data, Heads up and On track');
  });

  it('does not promise a next step on the Jobs list, which shows a status and a reason', () => {
    expect(CHAPTERS.risk.lead).not.toMatch(/next step/i);
    expect(CHAPTERS.risk.lead).toMatch(/reason in a sentence/);
  });

  it('names the Profit tabs as the Profit page does, with the four lead cuts first', () => {
    expect(PROFIT_TABS).toEqual([
      'Jobs',
      'Clients',
      'Job types',
      'Extra services',
      'Sites',
      'Months',
      'Weeks',
      'Days',
    ]);
    expect(all).not.toMatch(/cut four ways|4 ways to see profit/i);
  });

  it('names the plan table and the bars of "Why profit changed" as the screen does', () => {
    expect(PLAN_FEATURES[0]!.name).toBe('Quote vs actual');
    expect(PLAN_FEATURES[1]!.note).toContain(
      'price, labor rate, labor efficiency, scrap, material, time not on a job and other',
    );
  });

  it('names the six import counters as step 3 does', () => {
    expect(IMPORT_COUNTERS).toEqual(['New', 'Changed', 'No change', 'Look the same', 'Left out', 'Problems']);
    expect(CSV_FEATURES[0]!.note).toContain('New, Changed, No change, Look the same, Left out and Problems');
    expect(all).not.toMatch(/Unchanged|Possible repeats|Skipped/);
  });

  it('makes no promise about how often the apps sync', () => {
    expect(all).not.toMatch(/within minutes|every \d+ minutes|keeps in step/i);
  });

  it('keeps the rate chapter to two rows that describe the dialog', () => {
    expect(COST_FEATURES).toHaveLength(2);
    expect(CHAPTERS.costs.lead).toMatch(/labor class, such as packer or line lead/);
  });
});

/* Claims against the spec and the app */

const specPath = process.env.PULSE_SPEC_PATH ?? path.resolve(webRoot, '../../docs/pulse/SPEC.md');
const pulseSrc = process.env.PULSE_SRC_PATH ?? path.resolve(webRoot, '../pulse/src');
const hasSpec = existsSync(specPath);
const hasPulseApp = existsSync(pulseSrc);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

interface Claim {
  readonly claim: string;
  /** Wording that must exist in docs/pulse/SPEC.md. */
  readonly spec: RegExp;
  /** Evidence that must exist in apps/pulse/src (non-test code), for the parts already built. */
  readonly source?: RegExp;
}

/** Claim on the page, then the evidence for it. */
const CLAIMS: readonly Claim[] = [
  {
    claim: 'Money out has four buckets',
    spec: /Money out\*\* has four buckets/,
    source: /Time not on a job/,
  },
  {
    claim: 'Profit by job, client, job type and service',
    spec: /job, client, type, service, site, month, week or day/,
    source: /job[-_ ]?type/i,
  },
  {
    claim: 'Two margins, before shared costs and after all costs',
    spec: /Margin before shared costs/,
    source: /Margin before shared costs/,
  },
  { claim: 'Drill down totals match the level above', spec: /[Tt]otals always match the level above/ },
  {
    claim: 'Client page: cost to serve, earned, billed, not billed yet',
    spec: /cost_to_serve|[Cc]ost to serve/,
    source: /cost-to-serve/,
  },
  { claim: 'Log work is a day grid of units, people and hours', spec: /Labor hours/, source: /Log work/ },
  { claim: 'Crew lines by labor class', spec: /crew lines?/i, source: /crew/i },
  { claim: "Copy yesterday's crew", spec: /Copy yesterday's crew/ },
  {
    claim: 'Inline sanity check wording',
    spec: /12 people for 8 hours is 96 labor hours\. You typed 9\.6\. Is that right\?/,
  },
  { claim: 'Review the day: approve or send back', spec: /Review the day/, source: /review/i },
  { claim: 'Floor tablet with a 4 digit PIN', spec: /4 digit PIN/, source: /kiosk/i },
  { claim: 'The floor tablet never shows money', spec: /[Nn]ever shows money/ },
  { claim: 'Hours from a time clock or payroll file', spec: /time clock or payroll/, source: /time_punches/ },
  {
    claim: 'Quote, budget and actual in plain words',
    spec: /The \*\*quote\*\* is what you told the client/,
    source: /budget/i,
  },
  {
    claim: 'The plan is scaled to the work done so far',
    spec: /[Ff]or the work done so far/,
    source: /flex/i,
  },
  {
    claim: 'Why profit changed always adds up',
    spec: /the bars always add up exactly/,
    source: /Why profit changed/,
  },
  {
    claim: 'A plain reading on every bar',
    spec: /the crew needed 25 more hours than planned for this many units\. That cost \$550\./,
  },
  { claim: 'Projected finish for open jobs', spec: /projected_finish_date/, source: /project/i },
  {
    claim: 'Quote calculator: lowest price worth taking',
    spec: /lowest price worth taking/,
    source: /[Cc]alculator/,
  },
  {
    claim: 'Real cost of an hour: $16.00 wage is $21.76',
    spec: /one hour really costs \$21\.76/,
    source: /[Rr]eal cost of an hour/,
  },
  { claim: 'Rates have start dates', spec: /effective[_ ]from/, source: /effective_from|effectiveFrom/ },
  { claim: 'Temp agency classes use the agency bill rate', spec: /agency bill rate/ },
  { claim: 'A rate change shows its effect before it is saved', spec: /This changes 212 entries/ },
  { claim: 'Who buys the parts', spec: /[Ww]ho buys the parts/ },
  { claim: 'Five status words', spec: /\*\*Losing money\*\*/, source: /Losing money/ },
  {
    claim: 'Reason sentence: margin against target',
    spec: /Margin is heading for 14%\. Your target is 30%\./,
  },
  { claim: 'Reason sentence: labor over the plan', spec: /Labor is heading 25% over the plan\./ },
  {
    claim: 'Losing money needs 2 days of data or 20% done',
    spec: /evidence_days >= 2. or .pct_complete >= 20%/,
  },
  { claim: 'Twelve rules come ready', spec: /Twelve system rules/ },
  {
    claim: 'Alerts can be snoozed, assigned and dismissed',
    spec: /snooze, assign, dismiss/,
    source: /snooze/i,
  },
  { claim: 'Things to fix', spec: /Things to fix/, source: /Things to fix/ },
  { claim: 'Time punches come in by CSV', spec: /time_punches\.csv/, source: /time_punches\.csv/ },
  { claim: 'Import errors are named on the cell', spec: /Row 14, labor_hours: 9x is not a number/ },
  { claim: 'Same file warning', spec: /You imported this same file/ },
  { claim: 'Undo an import for 7 days', spec: /7 day undo window/ },
  { claim: 'Download everything', spec: /Download everything/ },
  { claim: 'Month close pack report', spec: /Month close pack/, source: /month-close-pack/ },
  { claim: 'How we got this', spec: /How we got this/ },
  { claim: 'Explain example: labor cost', spec: /Labor cost \$4,212\.00 = 162\.0 labor hours x \$26\.00/ },
  { claim: 'Company profit bridge worked example', spec: /48210 - 1150 - 2360 - 4800 = \$39,900\.00/ },
  { claim: 'Data quality lines', spec: /"2 days have no hours",\s+"Uses the default rate", "Early guess"/ },
  { claim: 'A number with no warning line is complete', spec: /A number with no warning line is complete/ },
  { claim: 'Worked example: labor so far', spec: /125 hours, labor \$2,875\.00/ },
  { claim: 'Month close locks the month', spec: /Month close/, source: /close/i },
  { claim: 'Audit log', spec: /[Aa]udit log/, source: /audit/i },
  {
    claim: 'Five roles',
    spec: /owner.{0,40}admin.{0,40}manager.{0,40}supervisor.{0,40}viewer/s,
    source: /supervisor/,
  },
  { claim: 'A won CRM deal can become a job', spec: /[Ww]on deals? with no job yet/ },
  { claim: 'Warehouse work orders map to jobs', spec: /`work_orders` \+ kit `products` \| `pulse\.jobs`/ },
  { claim: 'Finished kits arrive as units and a person adds hours', spec: /From the warehouse/ },
  { claim: 'Projects time can count as labor hours', spec: /time import/ },
  { claim: 'Tasks made in Projects hold no money', spec: /the task text has no money/ },
  { claim: 'Portal tile counts', spec: /Open jobs, At risk, Losing money/ },
  { claim: 'Sync every 15 minutes', spec: /every 15 minutes/ },
  { claim: 'Runs standalone', spec: /standalone/ },
  { claim: 'Pulse does not send email', spec: /does not send email/ },
  { claim: 'Worked example: profit so far', spec: /profit \$1,565\.00/ },
  { claim: 'Worked example: projected profit', spec: /projected_profit = \$3,912\.50/ },
  { claim: 'First run checklist', spec: /set a labor rate/ },
];

describe.runIf(hasSpec)('/pulse claims are backed by docs/pulse/SPEC.md', () => {
  const spec = hasSpec ? readFileSync(specPath, 'utf8') : '';

  it.each(CLAIMS)('$claim', ({ spec: evidence }) => {
    expect(spec).toMatch(evidence);
  });

  it.each(STATUSES.map((status) => [status]))('status word "%s" is the spec word', (status) => {
    expect(spec).toContain(status);
  });
});

describe.runIf(hasPulseApp)('/pulse claims are backed by the Pulse app', () => {
  const corpus = hasPulseApp
    ? sourceFiles(pulseSrc)
        .map((file) => readFileSync(file, 'utf8'))
        .join('\n')
    : '';
  const built = CLAIMS.filter((claim): claim is Claim & { source: RegExp } => claim.source !== undefined);

  it.each(built)('$claim', ({ source }) => {
    expect(corpus).toMatch(source);
  });

  it.each(CSV_STREAMS.map((name) => [name]))('CSV stream "%s" exists in the app', (name) => {
    expect(corpus).toContain(`name: '${name}'`);
  });

  it.each(REPORTS.map((name) => [name]))('report "%s" exists in the app', (name) => {
    expect(corpus).toContain(`name: '${name}'`);
  });
});
