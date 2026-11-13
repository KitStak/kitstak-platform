import { describe, expect, it } from 'vitest';
import { describeAutomation, planAutomations, type EngineRule, type EngineTask, type TaskEvent } from './engine';

const base: EngineTask = {
  id: 't1',
  projectId: 'p1',
  title: 'Ship pallets to Acme',
  statusId: 'done',
  statusCategory: 'done',
  priority: 'high',
  assigneeId: 'u1',
  sectionId: null,
  dueDate: '2026-11-10',
  labelIds: ['l-ship'],
  parentTaskId: null,
};

function rule(overrides: Partial<EngineRule>): EngineRule {
  return {
    id: overrides.id ?? 'r',
    projectId: null,
    enabled: true,
    trigger: { type: 'task_completed' },
    conditions: [],
    actions: [{ type: 'notify', target: 'project_owner' }],
    ...overrides,
  };
}

const completed: TaskEvent = {
  type: 'status_changed',
  task: base,
  previous: { statusId: 'doing', statusCategory: 'in_progress' },
};

describe('automation engine', () => {
  it('fires task_completed only on the transition into done', () => {
    expect(planAutomations(completed, [rule({})], '2026-11-13')).toHaveLength(1);
    const already: TaskEvent = { ...completed, previous: { statusId: 'done2', statusCategory: 'done' } };
    expect(planAutomations(already, [rule({})], '2026-11-13')).toHaveLength(0);
  });

  it('respects project scope, enabled flag and conditions', () => {
    const rules = [
      rule({ id: 'scoped-other', projectId: 'p2' }),
      rule({ id: 'disabled', enabled: false }),
      rule({ id: 'cond-ok', conditions: [{ field: 'priority', op: 'is', value: 'high' }] }),
      rule({ id: 'cond-no', conditions: [{ field: 'label', op: 'is', value: 'l-other' }] }),
      rule({ id: 'scoped-same', projectId: 'p1' }),
    ];
    expect(planAutomations(completed, rules, '2026-11-13').map((run) => run.ruleId)).toEqual(['cond-ok', 'scoped-same']);
  });

  it('matches status targets by id or category', () => {
    const byId = rule({ trigger: { type: 'status_changed', toStatusId: 'done' } });
    const byCategory = rule({ trigger: { type: 'status_changed', toCategory: 'in_progress' } });
    expect(planAutomations(completed, [byId, byCategory], '2026-11-13')).toHaveLength(1);
  });

  it('evaluates overdue against open tasks only', () => {
    const open: TaskEvent = { type: 'priority_changed', task: { ...base, statusCategory: 'todo' } };
    const r = rule({ trigger: { type: 'priority_changed' }, conditions: [{ field: 'dueDate', op: 'overdue' }] });
    expect(planAutomations(open, [r], '2026-11-13')).toHaveLength(1);
    expect(planAutomations({ ...open, task: base }, [r], '2026-11-13')).toHaveLength(0);
  });

  it('writes plain-language sentences', () => {
    const sentence = describeAutomation(
      {
        trigger: { type: 'status_changed', toStatusId: 's-review' },
        conditions: [{ field: 'priority', op: 'is', value: 'urgent' }],
        actions: [
          { type: 'notify', target: 'project_owner' },
          { type: 'add_label', labelId: 'l1' },
        ],
      },
      { status: () => 'In review', label: () => 'Needs QA' },
    );
    expect(sentence).toBe(
      'When a task moves to “In review” and the priority is urgent, notify the project owner and add the label “Needs QA”.',
    );
  });

  it('fires due-soon rules within their window only', () => {
    const open = { ...base, statusCategory: 'todo' as const };
    const r = rule({ trigger: { type: 'due_date_approaching', days: 2 } });
    const event = (days: number): TaskEvent => ({ type: 'due_soon', task: open, daysUntilDue: days, dedupeKey: 'k' });
    expect(planAutomations(event(0), [r], '2026-11-13')).toHaveLength(1);
    expect(planAutomations(event(2), [r], '2026-11-13')).toHaveLength(1);
    expect(planAutomations(event(3), [r], '2026-11-13')).toHaveLength(0);
    expect(planAutomations({ type: 'overdue', task: open }, [rule({ trigger: { type: 'task_overdue' } })], '2026-11-13')).toHaveLength(1);
  });

  it('matches CRM stage names without caring about case', () => {
    const anyStage = rule({ id: 'any', trigger: { type: 'crm_stage_changed' } });
    const won = rule({ id: 'won', trigger: { type: 'crm_stage_changed', toStage: 'Closed won' } });
    const event: TaskEvent = { type: 'crm_stage_changed', task: base, stage: 'closed WON', previousStage: 'Proposal' };
    expect(planAutomations(event, [anyStage, won], '2026-11-13').map((run) => run.ruleId)).toEqual(['any', 'won']);
    expect(planAutomations({ ...event, stage: 'Negotiation' }, [anyStage, won], '2026-11-13').map((run) => run.ruleId)).toEqual(['any']);
    expect(planAutomations({ type: 'wms_order_shipped', task: base }, [rule({ trigger: { type: 'wms_order_shipped' } })], '2026-11-13')).toHaveLength(1);
  });

  it('checks the project condition', () => {
    const r = rule({ conditions: [{ field: 'project', op: 'is', value: 'p1' }] });
    const other = rule({ id: 'x', conditions: [{ field: 'project', op: 'is', value: 'p2' }] });
    expect(planAutomations(completed, [r, other], '2026-11-13').map((run) => run.ruleId)).toEqual(['r']);
  });

  it('describes the new triggers and actions in plain words', () => {
    expect(
      describeAutomation(
        {
          trigger: { type: 'due_date_approaching', days: 1 },
          conditions: [{ field: 'project', op: 'is', value: 'p1' }],
          actions: [
            { type: 'create_follow_up', title: 'Check on {task}', dueInDays: 2, assignTo: 'assignee' },
            { type: 'move_to_project', projectId: 'p2' },
          ],
        },
        { project: (id) => (id === 'p1' ? 'Launch' : 'Archive') },
      ),
    ).toBe(
      'When a task is due tomorrow and it is in the “Launch” project, create the follow-up task “Check on task name” for the assignee, due in 2 days and move it to the “Archive” project.',
    );
    expect(describeAutomation({ trigger: { type: 'wms_order_shipped' }, conditions: [], actions: [{ type: 'notify', target: 'assignee' }] })).toBe(
      'When a linked WMS order ships, notify the assignee.',
    );
  });
});
