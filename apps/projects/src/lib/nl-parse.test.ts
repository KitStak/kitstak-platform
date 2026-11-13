import { describe, expect, it } from 'vitest';
import { describeDueDate, parseQuickAdd, segmentQuickAdd, tokenId, type QuickAddParseOptions } from './nl-parse';

// Wednesday, November 11 2026 (weeks start on Monday Nov 9).
const TODAY = '2026-11-11';

const people = [
  { id: 'u-maya', name: 'Maya Chen', email: 'maya@northwind.example' },
  { id: 'u-marco', name: 'Marco Diaz', email: 'mdiaz@northwind.example' },
  { id: 'u-sam', name: 'Sam Okafor', email: 'sam.okafor@northwind.example' },
  { id: 'u-me', name: 'Avery Admin', email: 'admin@kitstak.io' },
];
const projects = [
  { id: 'p-ops', key: 'OPS', name: 'Operations' },
  { id: 'p-web', key: 'WEB', name: 'Website relaunch' },
  { id: 'p-wh', key: 'WH', name: 'Warehouse go-live' },
];
const labels = [
  { id: 'l-sales', name: 'Sales' },
  { id: 'l-lead', name: 'Sales lead' },
  { id: 'l-bugfix', name: 'Bugfix' },
];

const base: QuickAddParseOptions = { today: TODAY, people, projects, labels, meId: 'u-me' };
const parse = (text: string, extra: Partial<QuickAddParseOptions> = {}) => parseQuickAdd(text, { ...base, ...extra });
const due = (text: string, today = TODAY) => parseQuickAdd(text, { ...base, today }).dueDate;

describe('parseQuickAdd: the spec example', () => {
  it('parses "Call Acme tomorrow !high @maya #sales"', () => {
    const result = parse('Call Acme tomorrow !high @maya #sales');
    expect(result.title).toBe('Call Acme');
    expect(result.dueDate).toBe('2026-11-12');
    expect(result.priority).toBe('high');
    expect(result.assigneeId).toBe('u-maya');
    expect(result.labelIds).toEqual(['l-sales']);
    expect(result.newLabels).toEqual([]);
    expect(result.tokens.map((t) => t.kind)).toEqual(['date', 'priority', 'assignee', 'label']);
  });

  it('leaves plain text alone', () => {
    const result = parse('Write the onboarding guide');
    expect(result).toMatchObject({ title: 'Write the onboarding guide', dueDate: null, priority: null, assigneeId: null, projectId: null });
    expect(result.tokens).toHaveLength(0);
  });

  it('handles an empty string', () => {
    expect(parse('').title).toBe('');
    expect(parse('   ').tokens).toEqual([]);
  });
});

describe('dates', () => {
  it('today, tonight, tomorrow and short forms', () => {
    expect(due('Ship today')).toBe('2026-11-11');
    expect(due('Ship tonight')).toBe('2026-11-11');
    expect(due('Ship tomorrow')).toBe('2026-11-12');
    expect(due('Ship tmr')).toBe('2026-11-12');
    expect(due('Ship tmrw')).toBe('2026-11-12');
    expect(due('Ship day after tomorrow')).toBe('2026-11-13');
  });

  it('weekdays mean the next one after today', () => {
    expect(due('Demo fri')).toBe('2026-11-13');
    expect(due('Demo friday')).toBe('2026-11-13');
    expect(due('Demo mon')).toBe('2026-11-16');
    // Same weekday as today → a week from now.
    expect(due('Demo wednesday')).toBe('2026-11-18');
    expect(due('Demo Thu')).toBe('2026-11-12');
  });

  it('"this <day>" includes today, "next <day>" is in next week', () => {
    expect(due('Demo this wed')).toBe('2026-11-11');
    expect(due('Demo this fri')).toBe('2026-11-13');
    expect(due('Demo next fri')).toBe('2026-11-20');
    expect(due('Demo next mon')).toBe('2026-11-16');
    expect(due('Demo next sunday')).toBe('2026-11-22');
  });

  it('only treats "sat" and "sun" as days with a lead-in word', () => {
    expect(due('Buy sun screen')).toBeNull();
    expect(due('Sat down with the team')).toBeNull();
    expect(due('Inventory count on sat')).toBe('2026-11-14');
    expect(due('Inventory count by sun')).toBe('2026-11-15');
    expect(due('Inventory count saturday')).toBe('2026-11-14');
  });

  it('relative offsets', () => {
    expect(due('Follow up in 3 days')).toBe('2026-11-14');
    expect(due('Follow up in 1 day')).toBe('2026-11-12');
    expect(due('Follow up in two weeks')).toBe('2026-11-25');
    expect(due('Follow up in a week')).toBe('2026-11-18');
    expect(due('Follow up in 2w')).toBe('2026-11-25');
    expect(due('Renew in a month')).toBe('2026-12-11');
    expect(due('Renew in 3 months')).toBe('2027-02-11');
    expect(due('Renew in 1 year')).toBe('2027-11-11');
  });

  it('month math clamps to the last day of short months', () => {
    expect(due('Invoice in 1 month', '2027-01-31')).toBe('2027-02-28');
  });

  it('next week / month / year, end of week / month, weekend', () => {
    expect(due('Plan next week')).toBe('2026-11-16');
    expect(due('Plan next month')).toBe('2026-12-01');
    expect(due('Plan next year')).toBe('2027-01-01');
    expect(due('Report end of week')).toBe('2026-11-13');
    expect(due('Report eow')).toBe('2026-11-13');
    expect(due('Report end of month')).toBe('2026-11-30');
    expect(due('Report eom')).toBe('2026-11-30');
    expect(due('Clean garage this weekend')).toBe('2026-11-14');
    expect(due('Clean garage weekend', '2026-11-15')).toBe('2026-11-15');
  });

  it('month and day in both orders, with suffixes and years', () => {
    expect(due('Launch dec 5')).toBe('2026-12-05');
    expect(due('Launch December 5th')).toBe('2026-12-05');
    expect(due('Launch dec. 5')).toBe('2026-12-05');
    expect(due('Launch 5 dec')).toBe('2026-12-05');
    expect(due('Launch 5th of december')).toBe('2026-12-05');
    expect(due('Launch dec 5 2027')).toBe('2027-12-05');
    expect(due('Launch dec 5, 2027')).toBe('2027-12-05');
    expect(due('Launch 21 jan 2028')).toBe('2028-01-21');
  });

  it('month/day that already passed rolls to next year', () => {
    expect(due('Taxes mar 3')).toBe('2027-03-03');
    expect(due('Taxes nov 11')).toBe('2026-11-11');
    expect(due('Taxes nov 10')).toBe('2027-11-10');
  });

  it('numeric dates (month first) and ISO', () => {
    expect(due('Audit 12/5')).toBe('2026-12-05');
    expect(due('Audit 12/5/2027')).toBe('2027-12-05');
    expect(due('Audit 1/15/27')).toBe('2027-01-15');
    expect(due('Audit 2026-12-24')).toBe('2026-12-24');
  });

  it('rejects impossible dates', () => {
    expect(due('Audit 2/30/2027')).toBeNull();
    expect(due('Audit 13/5')).toBeNull();
    expect(due('Audit feb 31')).toBeNull();
    expect(due('Audit 2026-02-30')).toBeNull();
  });

  it('needs a day number with a month name ("may" is a word)', () => {
    expect(due('You may need this')).toBeNull();
    expect(due('March forward')).toBeNull();
    expect(due('Review may 4')).toBe('2027-05-04');
  });

  it('swallows a lead-in word: on, by, due, before', () => {
    expect(parse('Send invoice by friday').title).toBe('Send invoice');
    expect(parse('Send invoice due tomorrow').title).toBe('Send invoice');
    expect(parse('Board meeting on dec 5').title).toBe('Board meeting');
    expect(parse('Pay rent before eom').title).toBe('Pay rent');
  });

  it('does not match inside words', () => {
    expect(due('Fix the monday.com import')).toBe('2026-11-16'); // "monday" is a real word here; users can dismiss
    expect(due('Update Fridays newsletter')).toBeNull();
    expect(due('Send todays numbers')).toBeNull();
    expect(due('Mondays are hard')).toBeNull();
  });

  it('prefers the longest phrase ("next fri" over "fri", full date over month+day)', () => {
    const result = parse('Demo next fri');
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]).toMatchObject({ raw: 'next fri', value: '2026-11-20' });
    expect(parse('Launch dec 5 2027').tokens[0]?.raw).toBe('dec 5 2027');
  });

  it('when there are two dates, the last one wins and the first stays in the title', () => {
    const result = parse('Move Tuesday standup to tomorrow');
    expect(result.dueDate).toBe('2026-11-12');
    expect(result.title).toBe('Move Tuesday standup to');
  });

  it('describes dates in friendly words', () => {
    expect(describeDueDate('2026-11-11', TODAY)).toBe('Today');
    expect(describeDueDate('2026-11-12', TODAY)).toBe('Tomorrow');
    expect(describeDueDate('2026-11-20', TODAY)).toBe('Fri, Nov 20');
    expect(describeDueDate('2027-01-04', TODAY)).toBe('Mon, Jan 4, 2027');
    expect(parse('Ship next fri').tokens[0]?.display).toBe('Fri, Nov 20');
  });
});

describe('priority', () => {
  it.each([
    ['!urgent', 'urgent'],
    ['!high', 'high'],
    ['!HIGH', 'high'],
    ['!medium', 'medium'],
    ['!med', 'medium'],
    ['!low', 'low'],
    ['!none', 'none'],
    ['!p1', 'urgent'],
    ['!p2', 'high'],
    ['!p3', 'medium'],
    ['!p4', 'low'],
    ['!1', 'urgent'],
    ['!4', 'low'],
    ['!!!!', 'urgent'],
    ['!!!', 'high'],
    ['!!', 'medium'],
  ])('%s → %s', (raw, expected) => {
    const result = parse(`Fix login ${raw}`);
    expect(result.priority).toBe(expected);
    expect(result.title).toBe('Fix login');
  });

  it('ignores exclamation marks that are just punctuation', () => {
    expect(parse('Ship it!').priority).toBeNull();
    expect(parse('Ship it!').title).toBe('Ship it!');
    expect(parse('Wow ! nice').priority).toBeNull();
    expect(parse('Try !important-ish').priority).toBeNull();
    expect(parse('Hello!high').priority).toBeNull();
  });

  it('works at the start and before punctuation', () => {
    expect(parse('!high Fix login').title).toBe('Fix login');
    expect(parse('Fix login !high, then deploy').priority).toBe('high');
  });

  it('the last priority wins', () => {
    expect(parse('Fix !low login !urgent').priority).toBe('urgent');
  });
});

describe('assignee', () => {
  it('matches first name, full name, dotted name and email name', () => {
    expect(parse('Call @maya').assigneeId).toBe('u-maya');
    expect(parse('Call @Maya').assigneeId).toBe('u-maya');
    expect(parse('Call @mayachen').assigneeId).toBe('u-maya');
    expect(parse('Call @maya.chen').assigneeId).toBe('u-maya');
    expect(parse('Call @maya_chen').assigneeId).toBe('u-maya');
    expect(parse('Call @mdiaz').assigneeId).toBe('u-marco');
    expect(parse('Call @sam.okafor').assigneeId).toBe('u-sam');
    expect(parse('Call @mchen').assigneeId).toBe('u-maya'); // first initial + last name
  });

  it('accepts a unique prefix but not an ambiguous one', () => {
    expect(parse('Call @sa').assigneeId).toBe('u-sam');
    const ambiguous = parse('Call @ma');
    expect(ambiguous.assigneeId).toBeNull();
    expect(ambiguous.tokens[0]).toMatchObject({ kind: 'assignee', value: null, unresolved: true });
  });

  it('@me assigns to the viewer', () => {
    const result = parse('Book flights @me');
    expect(result.assigneeId).toBe('u-me');
    expect(result.tokens[0]?.display).toBe('Me');
  });

  it('keeps unknown names in the title as typed and flags them', () => {
    const result = parse('Ask @nobody about it');
    expect(result.assigneeId).toBeNull();
    expect(result.title).toBe('Ask @nobody about it');
    expect(result.tokens[0]).toMatchObject({ unresolved: true, display: 'No one named nobody' });
  });

  it('never treats an email address as a mention', () => {
    const result = parse('Email bob@maya.com');
    expect(result.assigneeId).toBeNull();
    expect(result.tokens).toHaveLength(0);
  });

  it('drops trailing punctuation from the name', () => {
    const result = parse('Ping @maya, then lunch');
    expect(result.assigneeId).toBe('u-maya');
    expect(result.title).toBe('Ping, then lunch');
  });

  it('ignores accents when matching', () => {
    const result = parseQuickAdd('Call @jose', { today: TODAY, people: [{ id: 'u-jose', name: 'José Ruiz' }] });
    expect(result.assigneeId).toBe('u-jose');
  });
});

describe('labels', () => {
  it('matches existing labels by exact name, ignoring case and separators', () => {
    expect(parse('Pitch #sales').labelIds).toEqual(['l-sales']);
    expect(parse('Pitch #SALES').labelIds).toEqual(['l-sales']);
    expect(parse('Pitch #sales-lead').labelIds).toEqual(['l-lead']);
    expect(parse('Pitch #sales_lead').labelIds).toEqual(['l-lead']);
    expect(parse('Pitch #saleslead').labelIds).toEqual(['l-lead']);
  });

  it('supports several labels and dedupes them', () => {
    const result = parse('Pitch #sales #bugfix #Sales');
    expect(result.labelIds).toEqual(['l-sales', 'l-bugfix']);
    expect(result.title).toBe('Pitch');
  });

  it('unknown labels wait for a confirmation and never fuzzy match', () => {
    const unconfirmed = parse('Fix #bug and #design-review');
    expect(unconfirmed.newLabels).toEqual([]);
    expect(unconfirmed.title).toBe('Fix #bug and #design-review');
    expect(unconfirmed.tokens.find((t) => t.raw === '#bug')).toMatchObject({ value: null, unresolved: true, display: 'No label called bug', name: 'bug' });
    const result = parse('Fix #bug and #design-review #Design-Review', { createLabels: ['bug', 'Design Review'] });
    expect(result.labelIds).toEqual([]);
    expect(result.newLabels).toEqual(['bug', 'design review']);
    expect(result.tokens.find((t) => t.raw === '#bug')).toMatchObject({ value: null, display: 'bug (new)', name: 'bug' });
    expect(result.title).toBe('Fix and');
  });

  it('skips numeric references and hashes inside words', () => {
    expect(parse('Follow up on #42').tokens).toHaveLength(0);
    expect(parse('Learn C# basics').tokens).toHaveLength(0);
  });
});

describe('project', () => {
  it('matches by key, name or unique prefix', () => {
    expect(parse('Order boxes +OPS').projectId).toBe('p-ops');
    expect(parse('Order boxes +ops').projectId).toBe('p-ops');
    expect(parse('Order boxes +operations').projectId).toBe('p-ops');
    expect(parse('Order boxes +website').projectId).toBe('p-web');
    expect(parse('Order boxes +warehouse-go-live').projectId).toBe('p-wh');
    expect(parse('Order boxes +WH').projectId).toBe('p-wh');
  });

  it('flags unknown projects and keeps them in the title as typed', () => {
    const result = parse('Order boxes +nope');
    expect(result.projectId).toBeNull();
    expect(result.title).toBe('Order boxes +nope');
    expect(result.tokens[0]).toMatchObject({ unresolved: true });
  });

  it('does not treat math as a project', () => {
    expect(parse('Check 1+1 totals').tokens).toHaveLength(0);
  });
});

describe('dismissing chips', () => {
  it('an ignored token stays in the title as plain text', () => {
    const id = tokenId('date', 'friday');
    const result = parse('Plan Friday party', { ignore: [id] });
    expect(result.dueDate).toBeNull();
    expect(result.title).toBe('Plan Friday party');
    expect(result.tokens).toHaveLength(0);
  });

  it('ignoring the last date lets an earlier one win', () => {
    const result = parse('Move Tuesday standup to tomorrow', { ignore: new Set([tokenId('date', 'tomorrow')]) });
    expect(result.dueDate).toBe('2026-11-17');
    expect(result.title).toBe('Move standup to tomorrow');
  });

  it('token ids are stable regardless of case and position', () => {
    expect(tokenId('label', '#Sales')).toBe(tokenId('label', '#sales'));
    expect(parse('A !high').tokens[0]?.id).toBe(parse('!HIGH b').tokens[0]?.id);
  });
});

describe('everything together', () => {
  it('parses a busy line in any order', () => {
    const result = parse('+web !!! @sam Review homepage copy #sales-lead in 2 days');
    expect(result).toMatchObject({
      title: 'Review homepage copy',
      dueDate: '2026-11-13',
      priority: 'high',
      assigneeId: 'u-sam',
      projectId: 'p-web',
      labelIds: ['l-lead'],
    });
  });

  it('tidies spaces and punctuation left behind', () => {
    expect(parse('Call Acme, tomorrow').title).toBe('Call Acme');
    expect(parse('  Call   Acme   tomorrow  !high ').title).toBe('Call Acme');
    expect(parse('Call Acme - tomorrow').title).toBe('Call Acme');
  });

  it('returns tokens in input order with accurate ranges', () => {
    const text = 'Call Acme tomorrow !high @maya';
    const result = parse(text);
    for (const token of result.tokens) expect(text.slice(token.start, token.end)).toBe(token.raw);
    expect(result.tokens.map((t) => t.start)).toEqual([...result.tokens.map((t) => t.start)].sort((a, b) => a - b));
  });
});

describe('segmentQuickAdd', () => {
  it('splits text into plain and token segments that join back to the input', () => {
    const text = 'Call Acme tomorrow !high';
    const result = parse(text);
    const segments = segmentQuickAdd(text, result.tokens);
    expect(segments.map((s) => s.text).join('')).toBe(text);
    expect(segments.filter((s) => s.token).map((s) => s.text)).toEqual(['tomorrow', '!high']);
  });

  it('handles no tokens', () => {
    expect(segmentQuickAdd('Plain', [])).toEqual([{ text: 'Plain', token: null }]);
  });
});

describe('spec example and fuzzy people', () => {
  it('keeps an unresolved token in the title as typed (its chip warns)', () => {
    const result = parseQuickAdd('Call Acme tomorrow !high @maya #sales', { today: TODAY, people: [], labels: [] });
    expect(result.title).toBe('Call Acme @maya #sales');
    expect(result.assigneeId).toBeNull();
    expect(result.newLabels).toEqual([]);
    expect(result.tokens.filter((t) => t.unresolved).map((t) => t.kind)).toEqual(['assignee', 'label']);
  });

  it('matches people by initials and last name', () => {
    const team = [{ id: 'u-jo', name: 'Jonah Okafor' }, { id: 'u-ml', name: 'Mike Lunsford' }];
    expect(parseQuickAdd('Ping @jo', { today: TODAY, people: team }).assigneeId).toBe('u-jo');
    expect(parseQuickAdd('Ping @okafor', { today: TODAY, people: team }).assigneeId).toBe('u-jo');
    expect(parseQuickAdd('Ping @ml', { today: TODAY, people: team }).assigneeId).toBe('u-ml');
  });
});
