import { describe, expect, it } from 'vitest';
import { buildTemplateGallery, type GalleryBoard } from '@/server/services/wizards-gallery';
import { countLabel, entrySummary, navForTemplateId } from './gallery';
import { describeParseProblems, parseInvitees } from './invites';
import { findCommittedOrg } from './onboarding';
import {
  buildPreviewGroups,
  previewDate,
  probabilityForStage,
  quarterRange,
  thumbnailLayout,
  viewForLayout,
} from './preview-data';

/** 6 Nov 2026: Q4 runs Oct 1 – Dec 31, next quarter Jan 1 – Mar 31 2027. */
const NOW = Date.UTC(2026, 10, 6);
const gallery = buildTemplateGallery();
const board = (id: string): GalleryBoard => {
  const entry = gallery.find((item) => item.id === id);
  if (!entry?.boards[0]) throw new Error(`missing ${id}`);
  return entry.boards[0];
};

describe('probabilityForStage', () => {
  it('maps pipeline stages to a monotonic close probability', () => {
    expect(probabilityForStage('Lead')).toBe(10);
    expect(probabilityForStage('Discovery')).toBe(25);
    expect(probabilityForStage('Proposal')).toBe(50);
    expect(probabilityForStage('Negotiation')).toBe(75);
    expect(probabilityForStage('Won')).toBe(100);
    expect(probabilityForStage('Lost')).toBe(0);
    expect(probabilityForStage('Something else')).toBeNull();
  });

  it('Deals preview probabilities always follow the row stage', () => {
    const deals = board('crm-deals');
    const status = deals.columns.find((column) => column.type === 'status')!;
    const prob = deals.columns.find((column) => column.type === 'number' && /prob/i.test(column.title))!;
    expect(prob).toBeTruthy();
    for (const { rows } of buildPreviewGroups(deals, { now: NOW })) {
      for (const row of rows) {
        const labelId = (row.values[status.key] as { labelId?: string } | undefined)?.labelId;
        const stage = status.labels?.find((label) => label.id === labelId);
        const expected = stage ? probabilityForStage(stage.name) : null;
        if (expected !== null) expect(row.values[prob.key]).toBe(expected);
      }
    }
  });
});

describe('previewDate / quarterRange', () => {
  it('computes calendar quarter boundaries', () => {
    const [start, end] = quarterRange(NOW, 0);
    expect(new Date(start).toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(new Date(end).toISOString().slice(0, 10)).toBe('2026-12-31');
    const [nextStart, nextEnd] = quarterRange(NOW, 1);
    expect(new Date(nextStart).toISOString().slice(0, 10)).toBe('2027-01-01');
    expect(new Date(nextEnd).toISOString().slice(0, 10)).toBe('2027-03-31');
  });

  it('keeps group dates inside their window and never in the past for open work', () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const thisQ = previewDate({ key: 'this_quarter', title: 'This quarter' }, seed, NOW, false);
      expect(thisQ > '2026-11-06' && thisQ <= '2026-12-31').toBe(true);
      const nextQ = previewDate({ key: 'next_quarter', title: 'Next quarter' }, seed, NOW, false);
      expect(nextQ >= '2027-01-01' && nextQ <= '2027-03-31').toBe(true);
      const open = previewDate({ key: 'new', title: 'New' }, seed, NOW, false);
      expect(open > '2026-11-06').toBe(true);
    }
  });

  it('applies to the Deals preview: next-quarter rows close after this-quarter rows', () => {
    const deals = board('crm-deals');
    const dateColumns = deals.columns.filter((column) => column.type === 'date');
    for (const { group, rows } of buildPreviewGroups(deals, { now: NOW })) {
      const key = `${group.key} ${group.title}`.toLowerCase();
      if (!/quarter/.test(key)) continue;
      for (const row of rows) {
        for (const column of dateColumns) {
          const date = (row.values[column.key] as { date: string }).date;
          if (/next/.test(key)) expect(date >= '2027-01-01').toBe(true);
          else expect(date > '2026-11-06' && date <= '2026-12-31').toBe(true);
        }
      }
    }
  });
});

describe('blank board preview', () => {
  it('numbers generic rows top to bottom and gives Status real labels', () => {
    const blank = board('blank');
    const names = buildPreviewGroups(blank, { now: NOW }).flatMap((group) => group.rows.map((row) => row.name));
    expect(names).toEqual(names.map((_, index) => `Item ${index + 1}`));
    const status = blank.columns.find((column) => column.type === 'status');
    expect(status?.labels?.map((label) => label.name)).toEqual(['Working on it', 'Done', 'Stuck']);
    expect(gallery.find((entry) => entry.id === 'blank')?.tags).toEqual(['any workflow', 'custom process']);
  });
});

describe('quote ids', () => {
  it('never repeats a quote number in the preview', () => {
    const quotes = board('sales-quotes');
    const heads = buildPreviewGroups(quotes, { now: NOW })
      .flatMap((group) => group.rows.map((row) => row.name.split(' · ')[0]))
      .filter((head): head is string => Boolean(head && /^Q-\d+/.test(head)));
    expect(new Set(heads).size).toBe(heads.length);
  });
});

describe('thumbnail tab matches layout', () => {
  it('highlights the view the thumbnail draws', () => {
    for (const entry of gallery.filter((item) => item.type === 'board')) {
      const first = entry.boards[0]!;
      const layout = thumbnailLayout(first);
      const view = viewForLayout(first, layout);
      if (layout === 'kanban' || layout === 'timeline' || layout === 'calendar' || layout === 'form') {
        expect(view?.type).toBe(layout);
      }
    }
  });
});

describe('copy helpers', () => {
  it('pluralizes counts', () => {
    expect(countLabel(1, 'view')).toBe('1 view');
    expect(countLabel(2, 'group')).toBe('2 groups');
    const blank = gallery.find((entry) => entry.id === 'blank')!;
    expect(entrySummary(blank)).toContain('1 view');
  });

  it('maps template id prefixes to a category', () => {
    expect(navForTemplateId('crm-old')).toBe('crm');
    expect(navForTemplateId('mkt-x')).toBe('marketing');
    expect(navForTemplateId('cs-y')).toBe('customer-success');
    expect(navForTemplateId('does-not-exist')).toBe('recommended');
  });
});

describe('invite validation', () => {
  it('flags your own address instead of adding it', () => {
    const parsed = parseInvitees('Maya@Northwind.example, bo@y.io', [], 'member', new Set(), new Set(), 'maya@northwind.example');
    expect(parsed.added.map((invitee) => invitee.email)).toEqual(['bo@y.io']);
    expect(parsed.self).toBe(true);
    expect(describeParseProblems(parsed)).toMatch(/That’s you/);
  });
});

describe('findCommittedOrg', () => {
  const orgs = [
    { id: 'a', name: 'Northwind', slug: 'northwind', role: 'viewer' },
    { id: 'b', name: 'Wizard Test Co', slug: 'wizard-test-co', role: 'owner' },
  ];

  it('finds the org a lost POST created', () => {
    expect(findCommittedOrg(orgs, new Set(['a']), ' wizard test co ')?.slug).toBe('wizard-test-co');
  });

  it('ignores orgs that existed before, or that the user does not own', () => {
    expect(findCommittedOrg(orgs, new Set(['a', 'b']), 'Wizard Test Co')).toBeNull();
    expect(findCommittedOrg(orgs, new Set(), 'Northwind')).toBeNull();
  });
});
