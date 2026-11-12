import { describe, expect, it } from 'vitest';
import type { DuplicateClusterDto, DuplicateRecordDto } from '@/server/services/crm-contracts';
import { differingFields, fieldChoicesToSend, initialChoices, initialIncluded } from './merge-plan';

const record = (id: string, fields: Record<string, string | null>): DuplicateRecordDto => ({
  id,
  name: `R ${id}`,
  boardId: 'b',
  email: null,
  domain: null,
  secondary: null,
  owner: null,
  linkCount: 0,
  filledFields: 0,
  updatedAt: '2026-11-01T00:00:00Z',
  fields,
});

const cluster = (confidence: 'high' | 'medium'): DuplicateClusterDto => ({
  key: 'k',
  reason: confidence === 'high' ? 'email' : 'name',
  confidence,
  suggestedPrimaryId: 'a',
  fields: [
    { key: 'email', title: 'Email', conflict: true },
    { key: 'title', title: 'Title', conflict: false },
    { key: 'phone', title: 'Phone', conflict: false },
  ],
  records: [
    record('a', { email: 'a@x.com', title: 'CTO', phone: null }),
    record('b', { email: 'b@x.com', title: 'cto', phone: '+1' }),
    record('c', { email: null, title: null, phone: null }),
  ],
});

describe('merge plan', () => {
  it('pre-ticks every other record only for high-confidence groups', () => {
    expect(initialIncluded(cluster('high'), 'a')).toEqual(['b', 'c']);
    expect(initialIncluded(cluster('medium'), 'a')).toEqual([]);
  });

  it('defaults each field to the kept record, else the first donor', () => {
    expect(initialChoices(cluster('high'), 'a')).toEqual({ email: 'a', title: 'a', phone: 'b' });
  });

  it('sends only conflicting fields won by a merged duplicate', () => {
    const c = cluster('high');
    expect(fieldChoicesToSend(c, { email: 'b', phone: 'b' }, 'a', ['b'])).toEqual({ email: 'b' });
    expect(fieldChoicesToSend(c, { email: 'b' }, 'a', [])).toEqual({});
  });

  it('lists the fields that differ from the kept record (case-insensitive)', () => {
    expect(differingFields(cluster('high'), 'b', 'a')).toEqual(['Email']);
    expect(differingFields(cluster('high'), 'a', 'a')).toEqual([]);
  });
});
