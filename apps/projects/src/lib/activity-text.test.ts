import { describe, expect, it } from 'vitest';
import { describeActivity, describeActivityParts, describeSubtaskAdded } from './activity-text';
import type { ActivityDTO } from './types';

const event = (patch: Partial<ActivityDTO>): ActivityDTO =>
  ({ id: 'a1', verb: 'task.created', entityType: 'task', meta: {}, before: null, after: null, field: null, taskId: 't1', projectId: 'p1', actorId: 'u1', actorKind: 'user', createdAt: '2026-11-01T10:00:00Z', ...patch }) as unknown as ActivityDTO;

describe('describeActivityParts (project scope)', () => {
  it('names the task right after the verb', () => {
    expect(describeActivityParts(event({}))).toEqual({ before: 'created', after: '' });
    expect(describeActivityParts(event({ verb: 'task.updated', field: 'status', meta: { toName: 'Done' } }))).toEqual({ before: 'moved', after: 'to Done' });
    expect(describeActivityParts(event({ verb: 'comment.added' }))).toEqual({ before: 'commented on', after: '' });
  });
  it('does not repeat "automation" after the Automation actor', () => {
    expect(describeActivityParts(event({ verb: 'automation.ran', meta: { name: 'Nudge' } })).before).toBe('ran “Nudge” on');
    expect(describeActivity(event({ verb: 'automation.ran', meta: { name: 'Nudge' } }))).toBe('ran the rule “Nudge”');
  });
});

describe('time and subtasks', () => {
  it('drops a zero minute part', () => {
    expect(describeActivity(event({ verb: 'time.logged', after: { minutes: 180 } }))).toBe('logged 3h');
    expect(describeActivity(event({ verb: 'time.logged', after: { minutes: 45 } }))).toBe('logged 45m');
    expect(describeActivity(event({ verb: 'time.logged', after: { minutes: 90 } }))).toBe('logged 1h 30m');
  });
  it('describes a subtask added to its parent', () => {
    expect(describeSubtaskAdded(event({ after: { number: 16, title: 'Get label specs' } }), 'QAA')).toBe('added the subtask QAA-16 Get label specs');
  });
});

describe('assignments and templates', () => {
  const people = { personName: (id: string) => ({ u1: 'Mike Lunsford', u2: 'Thao Nguyen' })[id] };
  it('says themselves for a self-assignment, and you for the viewer', () => {
    expect(describeActivity(event({ verb: 'task.updated', field: 'assignee', after: 'u1' }), people)).toBe('assigned this to themselves');
    expect(describeActivity(event({ verb: 'task.updated', field: 'assignee', after: 'u2' }), { ...people, viewerId: 'u2' })).toBe('assigned this to you');
    expect(describeActivity(event({ verb: 'task.updated', field: 'assignee', after: 'u2' }), people)).toBe('assigned this to Thao Nguyen');
    expect(describeActivityParts(event({ verb: 'task.updated', field: 'assignee', after: 'u1' }), people)).toEqual({ before: 'assigned', after: 'to themselves' });
  });
  it('names the template a project was created from', () => {
    expect(describeActivity(event({ verb: 'template.used', entityType: 'template', meta: { template: 'Warehouse go-live' } }))).toBe('created this project from the Warehouse go-live template');
    expect(describeActivity(event({ verb: 'template.used', meta: { template: 'Client onboarding template' } }))).toBe('created this project from the Client onboarding template');
    expect(describeActivity(event({ verb: 'template.used', meta: {} }))).toBe('created this project from a template');
  });
});
