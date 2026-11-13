import { describe, expect, it } from 'vitest';
import { IMPORT_DEFINITIONS } from '@/server/imports/registry';
import { IMPORT_PERMISSIONS } from '@/server/imports/permissions';
import { bulkDisabledReason, bulkVariant } from '@/components/grid/bulk-actions';
import { humanize, messageSide } from '@/server/domain/change-log';
import { formatLogDateTime, isIsoDateTime, localizeIsoInText } from '@/lib/format-zone';
import { parseGridQuery, serializeGridQuery } from '@/server/query/grid-query';
import { parseTzOffset } from '@/server/query/request-tz';
import { stateMachines } from '@/server/domain/state-machines';
import { validityPercent } from '@/components/ui/wizard/wizard-state';
import { defaultGridPrefs, reconcileGridPrefs } from '@/components/grid/grid-prefs';

describe('foundation round 2', () => {
  it('keeps the import permission leaf map equal to the registry', () => {
    expect(IMPORT_PERMISSIONS).toEqual(
      Object.fromEntries(IMPORT_DEFINITIONS.map((d) => [d.key, d.permission])),
    );
  });

  it('renders a disabled destructive bulk action with the neutral variant', () => {
    const action = { key: 'delete', label: 'Delete', destructive: true, onSelect: () => undefined };
    expect(bulkVariant(action, bulkDisabledReason(action, []))).toBe('secondary');
    expect(bulkVariant(action, bulkDisabledReason(action, ['a']))).toBe('danger');
    expect(bulkDisabledReason({ ...action, pending: true }, ['a'])).toBe('Working…');
  });

  it('humanizes field names and message sides', () => {
    expect(humanize('isLocked')).toBe('Locked');
    expect(humanize('maxSkuQty')).toBe('Max SKU Qty');
    expect(humanize('jobId')).toBe('Job');
    expect(humanize('shipCity')).toBe('Ship City');
    expect(messageSide('')).toBe('None');
    expect(messageSide('2026-11-10T06:16:20.639Z', 'America/Chicago')).toMatch(
      /^11\/10\/2026 12:16:20 AM CST$/,
    );
  });

  it('localizes ISO date-times inside text', () => {
    expect(isIsoDateTime('2026-11-10T06:16:20.639Z')).toBe(true);
    expect(isIsoDateTime('2026-11-10')).toBe(false);
    expect(localizeIsoInText('Shipped At is modified. — --> 2026-11-10T06:16:20Z', () => 'X')).toBe(
      'Shipped At is modified. — --> X',
    );
    expect(formatLogDateTime('not a date')).toBe('not a date');
  });

  it('accepts pageSize / limit as ps aliases and keeps qm without text', () => {
    expect(parseGridQuery('pageSize=2').query.pageSize).toBe(2);
    expect(parseGridQuery('limit=3').query.pageSize).toBe(3);
    expect(parseGridQuery('ps=5&pageSize=2').query.pageSize).toBe(5);
    expect(serializeGridQuery({ ...parseGridQuery('').query, qm: 'eq' })).toContain('qm=eq');
  });

  it('parses the viewer offset header', () => {
    expect(parseTzOffset('-300')).toBe(-300);
    expect(parseTzOffset('9999')).toBeNull();
    expect(parseTzOffset(null)).toBeNull();
  });

  it('allows the PO re-open and a guarded return re-open', () => {
    expect(stateMachines.purchaseOrder.canTransition('Completed', 'Started').ok).toBe(true);
    expect(stateMachines.returnOrder.canTransition('Completed', 'Started', { shortQty: 2 }).ok).toBe(true);
    expect(stateMachines.returnOrder.canTransition('Completed', 'Started', { shortQty: 0 }).ok).toBe(false);
    expect(stateMachines.returnOrder.canTransition('Completed', 'Started').ok).toBe(false);
  });

  it('counts only visited steps in the wizard ring', () => {
    const steps = [{}, {}, {}];
    expect(validityPercent(steps, [true, true, true], 0)).toBe(33);
    expect(validityPercent(steps, [true, true, true])).toBe(100);
  });

  it('seeds default pins from column meta until the user changes pins', () => {
    const cols = [
      { id: 'code', defaultVisible: true, alwaysVisible: false, defaultPinned: true },
      { id: 'name', defaultVisible: true, alwaysVisible: false },
    ];
    expect(defaultGridPrefs(cols).pinned).toEqual(['code']);
    expect(reconcileGridPrefs({ visible: ['code'], order: ['code', 'name'] }, cols).pinned).toEqual(['code']);
    expect(
      reconcileGridPrefs({ visible: ['code'], order: ['code', 'name'], pinned: [] }, cols).pinned,
    ).toEqual([]);
  });
});
