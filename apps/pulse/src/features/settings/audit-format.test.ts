import { describe, expect, it } from 'vitest';
import type { ActivityDTO } from '@/lib/types';
import { AUDIT_CSV_HEADERS, actorLabel, auditChanges, auditCsvRow, auditSummary, fieldLabel, thingLabel, valueText, verbLabel } from './audit-format';

const row = (patch: Partial<ActivityDTO>): ActivityDTO => ({ id: '1', actor: null, actorKind: 'user', verb: 'job.updated', entityType: 'job', entityId: null, jobId: null, clientId: null, field: null, before: null, after: null, meta: {}, body: null, createdAt: '2026-11-18T09:14:00.000Z', ...patch });

describe('audit wording', () => {
  it('names actions in plain words', () => {
    expect(verbLabel('job.updated')).toBe('Changed a job');
    expect(verbLabel('production.logged')).toBe('Logged a production entry');
    expect(verbLabel('import.committed')).toBe('Saved an import');
    expect(verbLabel('item.created')).toBe('Added an item');
    expect(verbLabel('paid_hours.deleted')).toBe('Deleted paid hours');
    expect(verbLabel('gizmo.frobbed')).toBe('Frobbed a gizmo');
    expect(thingLabel('service_entry')).toBe('service entry');
  });

  it('labels fields and values', () => {
    expect(fieldLabel('unitsGood')).toBe('Units good');
    expect(fieldLabel('default_labor_class_id')).toBe('Default labor class');
    expect(fieldLabel('amountCents')).toBe('Amount');
    expect(valueText('amountCents', 197853)).toBe('1978.53');
    expect(valueText('targetMarginBp', 3150)).toBe('31.5%');
    expect(valueText('value', '31.5000')).toBe('31.5');
    expect(valueText('active', true)).toBe('yes');
    expect(valueText('note', null)).toBe('empty');
  });

  it('lists the before and after of a change and sums it up', () => {
    const change = row({ before: { unitsGood: '720.000' }, after: { unitsGood: '800.000' } });
    expect(auditChanges(change)).toEqual([{ key: 'unitsGood', label: 'Units good', before: '720', after: '800' }]);
    expect(auditSummary(change)).toBe('Units good: 720 to 800');
    expect(auditSummary(row({ body: 'Called the client.' }))).toBe('Called the client.');
    expect(auditSummary(row({ verb: 'export.run', meta: { stream: 'costs', rows: 12, withMoney: false } }))).toBe('File: costs, 12 rows, no money columns');
  });

  it('says who did it, and writes a CSV row in header order', () => {
    expect(actorLabel(row({ actorKind: 'system' }))).toBe('Pulse');
    expect(actorLabel(row({ actor: { id: 'u', name: 'Mike Lunsford', email: 'm@x.example', image: null } }))).toBe('Mike Lunsford');
    const cells = auditCsvRow(row({ before: { status: 'planned' }, after: { status: 'active' }, entityId: 'abc' }));
    expect(cells).toHaveLength(AUDIT_CSV_HEADERS.length);
    expect(cells.slice(1, 8)).toEqual(['Someone who has left', 'Changed a job', 'job', 'abc', '', 'Status: planned', 'Status: active']);
  });
});
