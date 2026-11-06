import { describe, expect, it } from 'vitest';
import {
  activityIsUpcoming,
  buildStages,
  clusterIds,
  computePipeline,
  domainFromUrl,
  emailDomain,
  hasConflictingEvidence,
  matchAccounts,
  matchContacts,
  normalizeCompanyName,
  observedProbabilities,
  pairKey,
  periodRange,
  suggestPrimary,
  type DealFacts,
  type DuplicateCandidate,
  type StageLabelInput,
} from './crm-model';

const LABELS: StageLabelInput[] = [
  { id: 'lead', name: 'Lead', color: 'sky', position: 0 },
  { id: 'discovery', name: 'Discovery', color: 'blue', position: 1 },
  { id: 'proposal', name: 'Proposal', color: 'purple', position: 2 },
  { id: 'won', name: 'Won', color: 'green', position: 3, isDone: true },
  { id: 'lost', name: 'Lost', color: 'red', position: 4 },
  { id: 'default', name: '', color: 'gray', position: 5, isDefault: true },
];

const TODAY = new Date('2026-11-05T12:00:00Z');

function deal(overrides: Partial<DealFacts> & { id: string }): DealFacts {
  return {
    name: overrides.id,
    stageId: 'lead',
    value: 1000,
    closeDate: '2026-11-20',
    ownerIds: ['u1'],
    createdAt: '2026-10-01T00:00:00Z',
    lastActivityAt: '2026-11-01T00:00:00Z',
    history: [],
    ...overrides,
  };
}

describe('normalisation', () => {
  it('extracts company domains and ignores free mail', () => {
    expect(emailDomain('Ann@Acme.COM')).toBe('acme.com');
    expect(emailDomain('ann@gmail.com')).toBeNull();
    expect(emailDomain('not-an-email')).toBeNull();
  });

  it('extracts bare hosts from urls', () => {
    expect(domainFromUrl('https://www.acme.com/about')).toBe('acme.com');
    expect(domainFromUrl('acme.io')).toBe('acme.io');
    expect(domainFromUrl('localhost')).toBeNull();
    expect(domainFromUrl(null)).toBeNull();
  });

  it('strips legal suffixes and punctuation from company names', () => {
    expect(normalizeCompanyName('Acme Robotics, Inc.')).toBe('acme robotics');
    expect(normalizeCompanyName('Smith & Sons LLC')).toBe('smith and sons');
  });
});

describe('buildStages', () => {
  it('orders open stages first, then won, then lost and drops the default label', () => {
    const stages = buildStages(LABELS);
    expect(stages.map((stage) => stage.label.id)).toEqual(['lead', 'discovery', 'proposal', 'won', 'lost']);
    expect(stages.map((stage) => stage.kind)).toEqual(['open', 'open', 'open', 'won', 'lost']);
  });

  it('uses saved overrides, then observed data, then a linear default', () => {
    const stages = buildStages(LABELS, { proposal: 55 }, { lead: 12, won: 50 });
    const byId = Object.fromEntries(stages.map((stage) => [stage.label.id, stage.probability]));
    expect(byId).toEqual({ lead: 12, discovery: 50, proposal: 55, won: 100, lost: 0 });
  });

  it('averages a probability column per stage', () => {
    expect(
      observedProbabilities([
        { stageId: 'lead', probability: 10 },
        { stageId: 'lead', probability: 20 },
        { stageId: null, probability: 90 },
        { stageId: 'won', probability: null },
      ]),
    ).toEqual({ lead: 15 });
  });
});

describe('periodRange', () => {
  it('returns inclusive quarter bounds', () => {
    expect(periodRange('this_quarter', TODAY)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(periodRange('next_quarter', TODAY)).toEqual({ from: '2027-01-01', to: '2027-03-31' });
    expect(periodRange('this_month', TODAY)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(periodRange('all', TODAY)).toBeNull();
  });
});

describe('computePipeline', () => {
  const stages = buildStages(LABELS, { lead: 10, discovery: 20, proposal: 50 });
  const deals: DealFacts[] = [
    deal({ id: 'a', stageId: 'lead', value: 1000 }),
    deal({
      id: 'b',
      stageId: 'proposal',
      value: 4000,
      history: [
        { labelId: 'lead', at: '2026-10-01T00:00:00Z' },
        { labelId: 'discovery', at: '2026-10-11T00:00:00Z' },
        { labelId: 'proposal', at: '2026-10-21T00:00:00Z' },
      ],
    }),
    deal({ id: 'c', stageId: 'won', value: 3000, closeDate: '2026-10-15', ownerIds: ['u2'] }),
    deal({
      id: 'd',
      stageId: 'lost',
      value: 500,
      closeDate: '2026-10-10',
      history: [
        { labelId: 'lead', at: '2026-09-01T00:00:00Z' },
        { labelId: 'discovery', at: '2026-09-05T00:00:00Z' },
        { labelId: 'lost', at: '2026-10-10T00:00:00Z' },
      ],
    }),
    deal({ id: 'e', stageId: 'discovery', value: 2000, closeDate: '2026-10-30', lastActivityAt: '2026-09-01T00:00:00Z' }),
    deal({ id: 'f', stageId: 'lead', value: 9999, closeDate: '2027-05-01' }),
  ];
  const base = {
    deals,
    stages,
    today: TODAY,
    range: periodRange('this_quarter', TODAY),
    owner: null,
    staleDays: 14,
    quotas: { u1: 10_000 },
    quarters: 1,
  } as const;

  it('summarises the period', () => {
    const { summary } = computePipeline(base);
    expect(summary.openCount).toBe(3);
    expect(summary.openValue).toBe(7000);
    expect(summary.weighted).toBe(100 + 2000 + 400);
    expect(summary.wonValue).toBe(3000);
    expect(summary.winRate).toBe(0.5);
    expect(summary.avgDealSize).toBe(3000);
  });

  it('computes funnel counts and stage conversion from history', () => {
    const { funnel } = computePipeline(base);
    const lead = funnel.find((stage) => stage.label.id === 'lead');
    const discovery = funnel.find((stage) => stage.label.id === 'discovery');
    const proposal = funnel.find((stage) => stage.label.id === 'proposal');
    expect(lead?.count).toBe(1);
    expect(lead?.conversion).toBeNull();
    // reached ≥ lead: a,b,c,d,e (5); ≥ discovery: b,c,d,e (4); ≥ proposal: b,c (2)
    expect(discovery?.conversion).toBeCloseTo(4 / 5);
    expect(proposal?.conversion).toBeCloseTo(2 / 4);
  });

  it('buckets the forecast by close month with an overdue bucket', () => {
    const { forecast } = computePipeline(base);
    expect(forecast[0]?.month).toBe('overdue');
    expect(forecast[0]?.bestCase).toBe(2000);
    const november = forecast.find((month) => month.month === '2026-11');
    expect(november?.weighted).toBe(100 + 2000);
    expect(forecast.find((month) => month.month === '2026-10')).toBeUndefined();
    expect(forecast).toHaveLength(7);
  });

  it('computes quota attainment per rep', () => {
    const { reps } = computePipeline(base);
    const u1 = reps.find((rep) => rep.userId === 'u1');
    const u2 = reps.find((rep) => rep.userId === 'u2');
    expect(u1?.quota).toBe(10_000);
    expect(u1?.attainment).toBe(0);
    expect(u2?.won).toBe(3000);
    expect(u2?.attainment).toBeNull();
  });

  it('flags stale and overdue open deals', () => {
    const { atRisk } = computePipeline(base);
    expect(atRisk.map((risk) => risk.deal.id)).toEqual(['e']);
    expect(atRisk[0]?.reasons).toEqual(['stale', 'overdue']);
  });

  it('measures stage velocity from transitions', () => {
    const { velocity } = computePipeline(base);
    const lead = velocity.find((entry) => entry.label.id === 'lead');
    expect(lead?.transitions).toBe(2);
    expect(lead?.avgDays).toBe(7); // (10 + 4) / 2
  });

  it('filters by owner', () => {
    const { summary, reps } = computePipeline({ ...base, owner: 'u2' });
    expect(summary.openCount).toBe(0);
    expect(summary.wonValue).toBe(3000);
    expect(reps.map((rep) => rep.userId)).toEqual(['u2']);
  });
});

describe('duplicates', () => {
  const candidate = (overrides: Partial<DuplicateCandidate> & { id: string }): DuplicateCandidate => ({
    name: 'Ann Lee',
    email: null,
    domain: null,
    accountId: null,
    linkCount: 0,
    filledFields: 1,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });

  it('clusters contacts by email first, then by name within an account', () => {
    const clusters = clusterIds('contacts', [
      candidate({ id: '1', email: 'ann@acme.com' }),
      candidate({ id: '2', email: 'ANN@acme.com', name: 'Annie Lee' }),
      candidate({ id: '3', name: 'Bob Ray', accountId: 'x' }),
      candidate({ id: '4', name: 'bob  ray', accountId: 'x' }),
      candidate({ id: '5', name: 'Solo' }),
    ]);
    expect(clusters.map((cluster) => [cluster.reason, cluster.records.map((r) => r.id)])).toEqual([
      ['email', ['1', '2']],
      ['name', ['3', '4']],
    ]);
  });

  it('respects dismissed pairs', () => {
    const clusters = clusterIds(
      'contacts',
      [candidate({ id: '1', email: 'a@x.com' }), candidate({ id: '2', email: 'a@x.com' })],
      new Set([pairKey('2', '1')]),
    );
    expect(clusters).toHaveLength(0);
  });

  it('clusters accounts by domain and normalized name', () => {
    const clusters = clusterIds('accounts', [
      candidate({ id: 'a', name: 'Acme Inc', domain: 'acme.com' }),
      candidate({ id: 'b', name: 'ACME', domain: 'acme.com' }),
      candidate({ id: 'c', name: 'Globex LLC' }),
      candidate({ id: 'd', name: 'Globex' }),
    ]);
    expect(clusters.map((cluster) => cluster.reason)).toEqual(['domain', 'name']);
  });

  it('never pairs same-name contacts whose email domains disagree', () => {
    const clusters = clusterIds('contacts', [
      candidate({ id: '1', name: 'Isabella Ferreira', email: 'isa@meridian.com', domain: 'meridian.com' }),
      candidate({ id: '2', name: 'Isabella Ferreira', email: 'i.ferreira@delta.io', domain: 'delta.io' }),
      candidate({ id: '3', name: 'Isabella Ferreira', email: 'isabella@beacon.co', domain: 'beacon.co' }),
    ]);
    expect(clusters).toHaveLength(0);
  });

  it('keeps same-name contacts as a medium match when nothing contradicts it', () => {
    const clusters = clusterIds('contacts', [
      candidate({ id: '1', name: 'Ann Lee', domain: 'acme.com', email: 'ann@acme.com' }),
      candidate({ id: '2', name: 'Ann Lee' }),
    ]);
    expect(clusters.map((cluster) => [cluster.confidence, cluster.records.length])).toEqual([['medium', 2]]);
  });

  it('does not cluster same-name accounts with different websites', () => {
    const clusters = clusterIds('accounts', [
      candidate({ id: 'a', name: 'Acme', domain: 'acme.com' }),
      candidate({ id: 'b', name: 'ACME Inc', domain: 'acme-robotics.io' }),
    ]);
    expect(clusters).toHaveLength(0);
  });

  it('flags conflicting evidence', () => {
    expect(hasConflictingEvidence([candidate({ id: '1', domain: 'a.com' }), candidate({ id: '2', domain: 'b.com' })])).toBe(true);
    expect(hasConflictingEvidence([candidate({ id: '1', domain: 'a.com' }), candidate({ id: '2' })])).toBe(false);
    expect(hasConflictingEvidence([candidate({ id: '1', accountId: 'x' }), candidate({ id: '2', accountId: 'y' })])).toBe(true);
  });

  it('suggests the most complete record as primary', () => {
    expect(
      suggestPrimary([
        candidate({ id: 'old', filledFields: 3, createdAt: '2025-01-01' }),
        candidate({ id: 'rich', filledFields: 6 }),
      ]),
    ).toBe('rich');
  });
});

describe('lead matching', () => {
  it('matches accounts by email domain, then name', () => {
    const matches = matchAccounts({ email: 'ann@acme.com', company: 'Globex Corp' }, [
      { id: '1', name: 'Acme Robotics', domain: 'acme.com' },
      { id: '2', name: 'Globex', domain: 'globex.io' },
      { id: '3', name: 'Other', domain: 'other.com' },
    ]);
    expect(matches.map((match) => [match.record.id, match.reason])).toEqual([
      ['1', 'domain'],
      ['2', 'name'],
    ]);
  });

  it('matches contacts by email (high) and name (medium)', () => {
    const matches = matchContacts({ name: 'Ann Lee', email: 'ann@acme.com' }, [
      { id: '1', name: 'Ann Lee', email: null, accountName: null },
      { id: '2', name: 'A. Lee', email: 'Ann@Acme.com', accountName: null },
    ]);
    expect(matches.map((match) => [match.record.id, match.confidence])).toEqual([
      ['2', 'high'],
      ['1', 'medium'],
    ]);
  });

  it('marks future or scheduled activities as upcoming', () => {
    expect(activityIsUpcoming('2026-11-06', 'completed', TODAY)).toBe(true);
    expect(activityIsUpcoming('2026-11-05', 'scheduled', TODAY)).toBe(true);
    expect(activityIsUpcoming('2026-11-01', 'completed', TODAY)).toBe(false);
  });
});
