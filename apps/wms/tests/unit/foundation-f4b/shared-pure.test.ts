import { describe, expect, it } from 'vitest';
import {
  addressSchema,
  EMPTY_ADDRESS,
  formatAddressLines,
  normalizePostal,
  postalError,
} from '@/components/shared/address-model';
import {
  assignSlots,
  draftErrors,
  emptyCustomFieldDraft,
  remainingSlots,
  slotType,
} from '@/components/shared/custom-fields-model';
import { createJobReason, nounFor, planJobBatches } from '@/components/shared/create-job-model';
import {
  bulkSummary,
  eligibilitySchema,
  parseList,
  tagSchema,
  type CustomFieldDef,
} from '@/components/shared/contracts';
import { pageTags } from '@/components/shared/tag-popover';
import { changeLogMessage } from '@/components/shared/change-log-drawer';
import { buildTimeline } from '@/components/shared/activity-timeline';
import { defaultTemplates, filterTemplates } from '@/components/shared/print-options-modal';

describe('address validation', () => {
  const valid = {
    ...EMPTY_ADDRESS,
    name: 'Ann',
    line1: '1 Main St',
    city: 'Austin',
    state: 'TX',
    postalCode: '78701',
    country: 'US',
  };

  it('accepts a valid US address and applies defaults', () => {
    const parsed = addressSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it('enforces US ZIP and state', () => {
    const r = addressSchema.safeParse({ ...valid, postalCode: '787', state: '' });
    expect(r.success).toBe(false);
    if (r.success) return;
    const paths = r.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('postalCode');
    expect(paths).toContain('state');
  });

  it('validates Canadian postal codes and provinces', () => {
    expect(postalError('CA', 'K1A 0B1')).toBeNull();
    expect(postalError('CA', 'D1A 0B1')).toMatch(/Canadian/);
    expect(postalError('US', '12345-6789')).toBeNull();
    expect(normalizePostal('CA', 'k1a0b1')).toBe('K1A 0B1');
    expect(
      addressSchema.safeParse({ ...valid, country: 'CA', state: 'ON', postalCode: 'K1A 0B1' }).success,
    ).toBe(true);
    expect(
      addressSchema.safeParse({ ...valid, country: 'CA', state: 'TX', postalCode: 'K1A 0B1' }).success,
    ).toBe(false);
  });

  it('allows free-form regions elsewhere and requires a tax type with a tax ID', () => {
    expect(addressSchema.safeParse({ ...valid, country: 'DE', state: '', postalCode: '' }).success).toBe(
      true,
    );
    const r = addressSchema.safeParse({ ...valid, taxId: 'DE123' });
    expect(r.success).toBe(false);
    expect(addressSchema.safeParse({ ...valid, taxId: 'DE123', taxType: 'VAT' }).success).toBe(true);
    expect(addressSchema.safeParse({ ...valid, email: 'nope' }).success).toBe(false);
  });

  it('formats display lines', () => {
    expect(
      formatAddressLines({
        company: 'Acme',
        line1: '1 Main',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701',
        country: 'United States',
      }),
    ).toEqual(['Acme', '1 Main', 'Austin, TX 78701', 'United States']);
  });
});

describe('custom field slots', () => {
  const defs: CustomFieldDef[] = [
    { id: '1', entityType: 'product', slot: 'textBox1', name: 'Color', options: null, isActive: true },
    { id: '2', entityType: 'product', slot: 'dropDown1', name: 'Grade', options: ['A'], isActive: true },
  ];

  it('maps slots to types and counts what is left', () => {
    expect(slotType('toggle2')).toBe('toggle');
    expect(slotType('weird')).toBeNull();
    expect(remainingSlots(defs, [{ type: 'dropDown' }])).toEqual({
      textBox: 2,
      dropDown: 0,
      date: 3,
      toggle: 2,
    });
  });

  it('assigns free slots and flags over-limit drafts inline', () => {
    expect(assignSlots(defs, [{ type: 'textBox' }, { type: 'dropDown' }, { type: 'dropDown' }])).toEqual([
      'textBox2',
      'dropDown2',
      null,
    ]);
    const errors = draftErrors(
      [
        { ...emptyCustomFieldDraft('dropDown'), name: 'Size', options: [] },
        { ...emptyCustomFieldDraft('textBox'), name: 'color' },
        { ...emptyCustomFieldDraft('textBox'), name: 'X' },
        { ...emptyCustomFieldDraft('dropDown'), name: 'Y', options: ['b'] },
      ],
      defs,
    );
    expect(errors[0]?.options).toBe('Add at least one option');
    expect(errors[1]?.name).toBe('A field with this name already exists');
    expect(errors[2]).toEqual({});
    expect(errors[3]?.type).toMatch(/Only 2 Dropdown/);
  });
});

describe('create job model', () => {
  it('batches records and explains missing fields', () => {
    expect(planJobBatches(10, 4)).toEqual([4, 4, 2]);
    expect(planJobBatches(8, 4)).toEqual([4, 4]);
    expect(planJobBatches(0, 4)).toEqual([]);
    expect(planJobBatches(5, 0)).toEqual([]);
    expect(createJobReason({ jobTypeId: null, batchSize: 5, assigneeUserId: null })).toBe(
      'Choose a job type',
    );
    expect(createJobReason({ jobTypeId: 'jt', batchSize: null, assigneeUserId: null })).toBe(
      'Enter a batch size',
    );
    expect(createJobReason({ jobTypeId: 'jt', batchSize: 5, assigneeUserId: null })).toBeNull();
    expect(nounFor('order', 1)).toBe('order');
    expect(nounFor('work-order', 3)).toBe('work orders');
  });

  it('parses eligibility with defaults', () => {
    const e = eligibilitySchema.parse({
      total: 4,
      eligible: ['a', 'b', 'c'],
      ineligible: [{ id: 'd', reason: 'On Hold' }],
    });
    expect(e.jobTypes).toEqual([]);
    expect(
      bulkSummary(
        { succeeded: ['a', 'b', 'c'], failed: [{ id: 'd', code: 'INVALID_STATE', message: 'x' }] },
        'orders',
        'shipped',
      ),
    ).toBe('3 of 4 orders shipped · 1 failed');
    expect(bulkSummary({ succeeded: ['a'], failed: [] }, 'orders', 'merged')).toBe('1 of 1 orders merged');
  });
});

describe('tags, change log, timeline, printouts', () => {
  const tags = parseList(
    tagSchema,
    Array.from({ length: 21 }, (_, i) => ({ id: String(i), name: `Tag ${i + 1}`, color: '#2E5CE6' })),
  );

  it('pages tags 10 at a time with search', () => {
    expect(pageTags(tags, '', 1)).toMatchObject({ from: 1, to: 10, total: 21, pageCount: 3 });
    expect(pageTags(tags, '', 3)).toMatchObject({ from: 21, to: 21 });
    expect(pageTags(tags, 'tag 2', 1).total).toBe(3);
    expect(pageTags([], '', 1)).toMatchObject({ from: 0, to: 0, pageCount: 1 });
    expect(parseList(tagSchema, 'bad')).toEqual([]);
  });

  it('builds human change-log messages with line prefixes', () => {
    const base = {
      id: '1',
      type: 'Update' as const,
      message: '',
      source: 'a@b.c',
      at: '2026-01-01T00:00:00Z',
    };
    // Rebuilt only when the stored message is empty (shipping R10-4: stored sentences win).
    expect(
      changeLogMessage({
        ...base,
        fieldLabel: 'Received Qty',
        fromValue: '0',
        toValue: '24',
        lineLabel: 'MLT-WIDGET-01',
      }),
    ).toBe('MLT-WIDGET-01 -> Received Qty is modified. 0 → 24');
    expect(
      changeLogMessage({ ...base, message: 'Added orders SO1, SO2.', fieldLabel: 'Orders', lineLabel: null }),
    ).toBe('Added orders SO1, SO2.');
    expect(
      changeLogMessage({
        ...base,
        field: 'status',
        fieldLabel: 'Status',
        fromValue: '',
        toValue: 'Ready To Count',
      }),
    ).toBe('Status is modified. None → Ready to Count');
    expect(
      changeLogMessage(
        { ...base, message: 'Loading Started At is modified.  --> 2026-11-10T09:26:15.767Z' },
        { formatIso: () => 'LOCAL' },
      ),
    ).toBe('Loading Started At is modified. None → LOCAL');
    expect(changeLogMessage({ ...base, type: 'Create', message: 'Order created' })).toBe('Order created');
  });

  it('merges change log and ledger newest first, never synthesising', () => {
    const items = buildTimeline(
      [{ id: 'c', type: 'Create', message: 'Created', source: 'x', at: '2026-01-01T00:00:00Z' }],
      [{ id: 'l', type: 'Receipt', quantity: 10, at: '2026-01-02T00:00:00Z', sku: 'SKU1', source: 'y' }],
    );
    expect(items.map((i) => i.id)).toEqual(['l:l', 'c:c']);
    expect(items[0]?.title).toBe('Receipt · SKU1: +10');
    expect(buildTimeline([], [])).toEqual([]);
  });

  it('filters printout templates by type and client access', () => {
    const defaults = defaultTemplates(['packing-slip', 'nope']);
    expect(defaults.map((t) => t.typeKey)).toEqual(['packing-slip']);
    const restricted = { ...defaults[0]!, id: 'r', allClients: false, clientIds: ['c1'] };
    expect(filterTemplates([restricted], ['packing-slip'], 'c2')).toEqual([]);
    expect(filterTemplates([restricted], ['packing-slip'], 'c1')).toHaveLength(1);
    expect(filterTemplates(defaults, ['picking-list'], null)).toEqual([]);
  });
});
