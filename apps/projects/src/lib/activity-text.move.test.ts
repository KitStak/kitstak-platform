import { describe, expect, it } from 'vitest';
import { describeActivity } from './activity-text';
import type { ActivityDTO } from './types';

const moved = (before: unknown, after: unknown): ActivityDTO => ({
  id: 'a',
  projectId: 'p',
  taskId: 't',
  actorId: 'u',
  actorKind: 'user',
  verb: 'task.moved',
  entityType: 'task',
  entityId: 't',
  field: null,
  before,
  after,
  meta: {},
  createdAt: '2026-11-13T10:00:00.000Z',
});

describe('task.moved wording', () => {
  it('says where a plain reorder went', () => {
    expect(describeActivity(moved({ position: 'b', parentTaskId: null }, { position: 'a', parentTaskId: null, direction: 'up', statusName: 'To do' }))).toBe('moved this up in To do');
    expect(describeActivity(moved({ position: 'a', parentTaskId: null }, { position: 'b', parentTaskId: null }))).toBe('moved this down in the order');
  });
  it('describes a new parent', () => {
    expect(describeActivity(moved({ position: 'a', parentTaskId: null }, { position: 'a', parentTaskId: 'x' }))).toBe('made this a subtask');
    expect(describeActivity(moved({ position: 'a', parentTaskId: 'x' }, { position: 'a', parentTaskId: null }))).toBe('made this a top-level task');
  });
});
