import { describe, expect, it } from 'vitest';
import { pickableTasks, type PmTask } from './projects';

const task = (id: string, projectId: string, sectionName: string | null, extra: Partial<PmTask> = {}): PmTask => ({
  id, projectId, projectKey: projectId.toUpperCase(), number: Number(id.replace(/\D/g, '')) || 1, title: id, done: false, gone: false, sectionName, ...extra,
});

describe('pickableTasks', () => {
  it('offers only Floor tasks when the project has a Floor section', () => {
    const list = [task('t1', 'a', 'Floor'), task('t2', 'a', 'Office'), task('t3', 'a', null)];
    expect(pickableTasks(list).map((t) => t.id)).toEqual(['t1']);
  });

  it('matches the Floor section name loosely', () => {
    const list = [task('t1', 'a', '  floor '), task('t2', 'a', 'Buying')];
    expect(pickableTasks(list).map((t) => t.id)).toEqual(['t1']);
  });

  it('offers every task in a project without a Floor section', () => {
    const list = [task('t1', 'a', 'Office'), task('t2', 'a', null), task('t3', 'b', 'Floor')];
    expect(pickableTasks(list).map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('hides done and removed tasks unless a line already uses them', () => {
    const list = [task('t1', 'a', null, { done: true }), task('t2', 'a', null, { gone: true }), task('t3', 'a', null), task('t4', 'a', null, { done: true })];
    expect(pickableTasks(list, new Set(['t4'])).map((t) => t.id)).toEqual(['t3', 't4']);
  });

  it('keeps a used office task visible in a Floor project', () => {
    const list = [task('t1', 'a', 'Floor'), task('t2', 'a', 'Office')];
    expect(pickableTasks(list, new Set(['t2'])).map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('ignores a Floor section that only holds removed tasks', () => {
    const list = [task('t1', 'a', 'Floor', { gone: true }), task('t2', 'a', 'Office')];
    expect(pickableTasks(list).map((t) => t.id)).toEqual(['t2']);
  });
});
