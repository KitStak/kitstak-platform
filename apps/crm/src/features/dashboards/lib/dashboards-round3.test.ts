import { describe, expect, it } from 'vitest';
import type { RealtimeEvent } from '@/server/realtime/events';
import { insightBatchSchema, layoutUpdateSchema } from '@/server/services/contracts/dashboard-insights';
import { dashboardStreamFilter } from '@/server/services/dashboards-realtime';
import { formatGrouped, parseFormattedNumber } from '../components/config-fields';
import { updatedAgo } from '../dashboards-list';
import { formatWithUnit, numberStyleOf } from '../widgets/table-widget';
import { planRealtimeRefresh } from './realtime';
import { kpiIconKey } from './kpi-icons';
import type { ColumnDto } from '@/server/services/contracts/dto';

const ORG = '7f0c1b9e-4a7b-4c55-9a51-2c8a6c3f4d10';
const DASH = '1a0c1b9e-4a7b-4c55-9a51-2c8a6c3f4d11';
const BOARD = '2b0c1b9e-4a7b-4c55-9a51-2c8a6c3f4d12';
const OTHER_BOARD = '3c0c1b9e-4a7b-4c55-9a51-2c8a6c3f4d13';
const ME = '4d0c1b9e-4a7b-4c55-9a51-2c8a6c3f4d14';
const YOU = '5e0c1b9e-4a7b-4c55-9a51-2c8a6c3f4d15';
const WIDGET = '6f0c1b9e-4a7b-4c55-9a51-2c8a6c3f4d16';

function event(partial: Partial<RealtimeEvent>): RealtimeEvent {
  return { type: 'items.changed', orgId: ORG, boardId: null, ids: [], userIds: [], actorId: null, at: new Date(0).toISOString(), ...partial };
}

describe('planRealtimeRefresh', () => {
  const context = { dashboardId: DASH, userId: ME, boardIds: [BOARD] };

  it('refetches the dashboard and pulses widgets changed by someone else', () => {
    const plan = planRealtimeRefresh(event({ type: 'dashboard.changed', ids: [DASH, WIDGET], actorId: YOU }), context);
    expect(plan).toEqual({ dashboard: true, data: false, pulseWidgetIds: [WIDGET] });
  });

  it('does not pulse my own changes from another tab', () => {
    const plan = planRealtimeRefresh(event({ type: 'dashboard.changed', ids: [DASH, WIDGET], actorId: ME }), context);
    expect(plan.dashboard).toBe(true);
    expect(plan.pulseWidgetIds).toEqual([]);
  });

  it('refetches widget data only for item changes on source boards', () => {
    expect(planRealtimeRefresh(event({ boardId: BOARD }), context).data).toBe(true);
    expect(planRealtimeRefresh(event({ boardId: OTHER_BOARD }), context).data).toBe(false);
    expect(planRealtimeRefresh(event({ type: 'dashboard.changed', ids: [WIDGET] }), context).dashboard).toBe(false);
  });
});

describe('dashboardStreamFilter', () => {
  const deliver = dashboardStreamFilter(ORG, DASH, [BOARD]);
  it('forwards this dashboard and its boards only', () => {
    expect(deliver(event({ type: 'dashboard.changed', ids: [DASH] }))).toBe(true);
    expect(deliver(event({ type: 'dashboard.changed', ids: [WIDGET] }))).toBe(false);
    expect(deliver(event({ type: 'columns.changed', boardId: BOARD }))).toBe(true);
    expect(deliver(event({ boardId: OTHER_BOARD }))).toBe(false);
    expect(deliver(event({ type: 'notifications.changed', boardId: BOARD }))).toBe(false);
    expect(deliver(event({ boardId: BOARD, orgId: YOU }))).toBe(false);
  });
});

describe('API validation', () => {
  it('rejects layouts that overflow the 12-column grid', () => {
    expect(layoutUpdateSchema.safeParse({ widgets: [{ id: WIDGET, x: 11, y: 0, w: 12, h: 2 }] }).success).toBe(false);
    expect(layoutUpdateSchema.safeParse({ widgets: [{ id: WIDGET, x: 6, y: 0, w: 6, h: 2 }] }).success).toBe(true);
  });

  it('rejects malformed filters and unknown widget kinds', () => {
    const widget = { key: 'a', type: 'number', config: {} };
    expect(insightBatchSchema.safeParse({ widgets: [widget], filters: { personIds: [], range: { from: 'garbage' } } }).success).toBe(false);
    expect(insightBatchSchema.safeParse({ widgets: [{ ...widget, config: { kind: 'nope' } }] }).success).toBe(false);
    expect(insightBatchSchema.safeParse({ widgets: [{ ...widget, config: { kind: 'numbers' } }] }).success).toBe(true);
  });
});

describe('formatted goal input', () => {
  it('parses grouped, currency and suffixed numbers', () => {
    expect(parseFormattedNumber('$30,000,000')).toBe(30_000_000);
    expect(parseFormattedNumber('30m')).toBe(30_000_000);
    expect(parseFormattedNumber('1.5k')).toBe(1_500);
    expect(parseFormattedNumber('')).toBeUndefined();
    expect(parseFormattedNumber('abc')).toBeUndefined();
  });
  it('formats with grouping and the unit', () => {
    expect(formatGrouped(30_000_000, '$')).toBe('$30,000,000');
    expect(formatGrouped(undefined, '$')).toBe('');
  });
});

describe('table number units', () => {
  const column = (settings: Record<string, unknown>): ColumnDto => ({ type: 'number', settings } as unknown as ColumnDto);
  it('shows percent and custom units from the column settings', () => {
    const percent = numberStyleOf(column({ unit: '%' }));
    expect(percent && formatWithUnit(40, percent)).toBe('40%');
    const prefixed = numberStyleOf(column({ unit: '€', unitPosition: 'prefix' }));
    expect(prefixed && formatWithUnit(1200, prefixed)).toBe('€1,200');
    const plain = numberStyleOf(column({}));
    expect(plain && formatWithUnit(7, plain)).toBe('7');
    expect(numberStyleOf({ type: 'text', settings: {} } as unknown as ColumnDto)).toBeNull();
  });
});

describe('list + KPI helpers', () => {
  it('describes a dashboard age', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    expect(updatedAgo('2026-11-06T11:59:30Z', now)).toBe('just now');
    expect(updatedAgo('2026-11-06T10:00:00Z', now)).toBe('2h ago');
    expect(updatedAgo('2026-11-03T12:00:00Z', now)).toBe('3d ago');
  });
  it('accepts only known KPI icon keys', () => {
    expect(kpiIconKey('trophy')).toBe('trophy');
    expect(kpiIconKey('constructor')).toBeNull();
    expect(kpiIconKey(3)).toBeNull();
  });
});
