import { describe, expect, it } from 'vitest';
import { automationEventHeadline, type EngineTask } from '@/server/automations/engine';
import { describeRecordTrigger, RECORD_TRIGGER_RECIPES } from '@/lib/record-trigger-types';
import type { IntegrationLinkDTO, TaskSummary } from '@/lib/types';
import { NO_GROUP } from '@/lib/task-filters';
import { hasLinkLane, linkLaneKeys } from './link-lanes';

const engineTask: EngineTask = {
  id: 't1',
  projectId: 'p1',
  title: 'Assign storage locations',
  statusId: 'done',
  statusCategory: 'done',
  priority: 'medium',
  assigneeId: null,
  sectionId: null,
  dueDate: null,
  labelIds: [],
  parentTaskId: null,
};

function link(taskId: string, targetType: IntegrationLinkDTO['targetType'], targetId: string, status: string | null, title = 'Record'): IntegrationLinkDTO {
  return { id: `${taskId}-${targetId}`, projectId: null, taskId, targetType, targetId, title, status, url: null, cachedAt: null, meta: {} };
}

const task = (id: string) => ({ id }) as TaskSummary;

describe('automation inbox headline', () => {
  it('says what happened, not the rule name', () => {
    expect(automationEventHeadline({ type: 'status_changed', task: engineTask }, 'QAA-3 Assign storage locations')).toBe('QAA-3 Assign storage locations was marked done');
    expect(automationEventHeadline({ type: 'overdue', task: engineTask }, 'OPS-7 Fix the dock leveler')).toBe('OPS-7 Fix the dock leveler is overdue');
  });
});

describe('cross-app recipes', () => {
  it('reads as a plain sentence', () => {
    expect(describeRecordTrigger('crm_deal_won', { templateId: 'builtin:client-onboarding' }, { template: 'Client onboarding' })).toBe(
      'When a CRM deal is won, create a project from Client onboarding',
    );
    expect(describeRecordTrigger('wms_receipt_discrepancy', { projectId: 'p' }, { project: 'Warehouse operations', person: 'Renata' })).toBe(
      'When a WMS receipt has discrepancies, create an urgent task for Renata in Warehouse operations',
    );
    expect(describeRecordTrigger('wms_count_variance', { projectId: 'p', thresholdPercent: 1.5 }, { project: 'Ops' })).toBe(
      'When a cycle count variance is over 1.5%, open a task in Ops',
    );
  });

  it('library copy has no em dashes or double dashes', () => {
    for (const recipe of RECORD_TRIGGER_RECIPES) {
      for (const text of [recipe.title, recipe.description, recipe.defaultName]) {
        expect(text.includes(String.fromCharCode(0x2014))).toBe(false);
        expect(text.includes('--')).toBe(false);
      }
    }
  });
});

describe('board lanes by linked records', () => {
  const links = new Map<string, IntegrationLinkDTO[]>([
    ['a', [link('a', 'crm_item', 'deal-1', 'Won'), link('a', 'wms_order', 'so-1', 'Shipped')]],
    ['b', [link('b', 'wms_receipt', 'po-1', 'Started'), link('b', 'wms_order', 'so-2', 'shipped')]],
  ]);

  it('groups by CRM record and by WMS status (case-insensitive)', () => {
    expect(linkLaneKeys(task('a'), 'crm', links)).toEqual(['crm_item:deal-1']);
    expect(linkLaneKeys(task('a'), 'wms', links)).toEqual(['shipped']);
    expect(linkLaneKeys(task('b'), 'wms', links)).toEqual(['started', 'shipped']);
  });

  it('puts unlinked tasks in the no-link lane', () => {
    expect(linkLaneKeys(task('b'), 'crm', links)).toEqual([NO_GROUP]);
    expect(linkLaneKeys(task('z'), 'wms', links)).toEqual([NO_GROUP]);
  });

  it('only offers a lane when something is linked', () => {
    expect(hasLinkLane('crm', links)).toBe(true);
    expect(hasLinkLane('crm', new Map([['b', links.get('b') ?? []]]))).toBe(false);
  });
});
