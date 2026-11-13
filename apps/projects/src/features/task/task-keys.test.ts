import { describe, expect, it } from 'vitest';
import { taskKeyAction } from './task-keys';

const press = (key: string, mods: Partial<Record<'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {}) =>
  taskKeyAction({ key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe('taskKeyAction (one key map everywhere)', () => {
  it('maps the property keys', () => {
    expect(press('s')).toBe('status');
    expect(press('a')).toBe('assignee');
    expect(press('p')).toBe('priority');
    expect(press('d')).toBe('due');
    expect(press('#', { shiftKey: true })).toBe('labels');
    expect(press('i')).toBe('assign-me');
  });
  it('never uses D or M for done', () => {
    expect(press('d')).not.toBe('toggle-done');
    expect(press('m')).toBeNull();
    expect(press('Enter', { ctrlKey: true })).toBe('toggle-done');
    expect(press('Enter', { metaKey: true })).toBe('toggle-done');
  });
  it('dates and links', () => {
    expect(press('t')).toBe('due-today');
    expect(press('T', { shiftKey: true })).toBe('due-tomorrow');
    expect(press('.', { metaKey: true })).toBe('copy-link');
    expect(press('k', { metaKey: true })).toBeNull();
    expect(press('s', { altKey: true })).toBeNull();
  });
});
