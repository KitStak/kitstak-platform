import { describe, expect, it } from 'vitest';
import { actsOnBuilds, conditionKey, conditionOptionByKey, messageVariables } from './catalog';

const programs = new Set(['prog-1']);

describe('automation catalog for programs (5.17)', () => {
  it('shows a project rule on a program as "the program"', () => {
    expect(conditionKey({ field: 'project', op: 'is', value: 'prog-1' }, programs)).toBe('program');
    expect(conditionKey({ field: 'project', op: 'is', value: 'proj-9' }, programs)).toBe('project');
    expect(conditionKey({ field: 'project', op: 'is', value: '' }, programs, 'program')).toBe('program');
    expect(conditionKey({ field: 'variant', op: 'is', value: 'v1' }, programs)).toBe('variant');
    expect(conditionOptionByKey('program').field).toBe('project');
  });

  it('knows when a rule acts on builds', () => {
    expect(actsOnBuilds({ type: 'run_done' }, [])).toBe(true);
    expect(actsOnBuilds({ type: 'task_completed' }, [], { programIds: programs, projectId: 'prog-1' })).toBe(true);
    expect(actsOnBuilds({ type: 'task_completed' }, [{ field: 'project', op: 'is', value: 'prog-1' }], { programIds: programs })).toBe(true);
    expect(actsOnBuilds({ type: 'task_completed' }, [{ field: 'priority', op: 'is', value: 'high' }], { programIds: programs })).toBe(false);
  });

  it('offers build words on build rules', () => {
    expect(messageVariables({ type: 'run_done' }, true).map((v) => v.label)).toEqual(['Build', 'Program']);
    expect(messageVariables({ type: 'task_completed' }, false).map((v) => v.label)).toEqual(['Task', 'Project']);
    expect(messageVariables({ type: 'crm_stage_changed' }, false).map((v) => v.label)).toEqual(['Task', 'Project', 'CRM stage']);
  });
});
