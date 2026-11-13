import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '@/lib/nl-parse';
import { activeToken, applySuggestion, suggestFor } from './token-suggestions';

const data = {
  people: [
    { id: 'u1', name: 'Maya Chen', email: 'maya@x.test' },
    { id: 'u2', name: 'Marco Diaz', email: 'mdiaz@x.test' },
    { id: 'u3', name: 'Sam Okafor', email: 'sam@x.test' },
  ],
  labels: [
    { id: 'l1', name: 'Sales lead' },
    { id: 'l2', name: 'Bug' },
  ],
  projects: [
    { id: 'p1', key: 'OPS', name: 'Warehouse operations' },
    { id: 'p2', key: 'WEB', name: 'Website relaunch' },
  ],
  meId: 'me',
};

describe('activeToken', () => {
  it('finds the @/#/+ word at the caret', () => {
    expect(activeToken('Call @ma', 8)).toEqual({ sigil: '@', partial: 'ma', start: 5, end: 8 });
    expect(activeToken('Call @ma tomorrow', 7)).toEqual({ sigil: '@', partial: 'm', start: 5, end: 8 });
    expect(activeToken('Tag #', 5)).toEqual({ sigil: '#', partial: '', start: 4, end: 5 });
    expect(activeToken('Put in +op', 10)?.sigil).toBe('+');
  });
  it('ignores emails, math and finished words', () => {
    expect(activeToken('mail bob@acme', 13)).toBeNull();
    expect(activeToken('1+1', 3)).toBeNull();
    expect(activeToken('Call @maya now', 14)).toBeNull();
  });
});

describe('suggestFor', () => {
  it('people by first name, last name or email; me first', () => {
    expect(suggestFor({ sigil: '@', partial: 'ma', start: 0, end: 3 }, data).map((s) => s.id)).toEqual(['u1', 'u2']);
    expect(suggestFor({ sigil: '@', partial: 'diaz', start: 0, end: 5 }, data).map((s) => s.id)).toEqual(['u2']);
    expect(suggestFor({ sigil: '@', partial: '', start: 0, end: 1 }, data)[0]).toMatchObject({ id: 'me', insert: '@me' });
  });
  it('labels, with a create option for new names', () => {
    const out = suggestFor({ sigil: '#', partial: 'sal', start: 0, end: 4 }, data);
    expect(out[0]).toMatchObject({ id: 'l1', insert: '#Sales-lead' });
    expect(out.at(-1)).toMatchObject({ id: 'new:sal' });
    expect(suggestFor({ sigil: '#', partial: 'bug', start: 0, end: 4 }, data).map((s) => s.id)).toEqual(['l2']);
  });
  it('projects by key or name', () => {
    expect(suggestFor({ sigil: '+', partial: 'web', start: 0, end: 4 }, data).map((s) => s.insert)).toEqual(['+WEB']);
    expect(suggestFor({ sigil: '+', partial: 'ware', start: 0, end: 5 }, data).map((s) => s.insert)).toEqual(['+OPS']);
  });
});

describe('applySuggestion + parser round trip', () => {
  it('inserted text always resolves to the chosen item', () => {
    const text = 'Call @ma tomorrow';
    const token = activeToken(text, 8)!;
    const [maya] = suggestFor(token, data);
    const applied = applySuggestion(text, token, maya!);
    expect(applied.text).toBe('Call @Maya.Chen tomorrow');
    expect(applied.caret).toBe(16);
    const parsed = parseQuickAdd(applied.text, { today: '2026-11-11', people: data.people, labels: data.labels, projects: data.projects });
    expect(parsed.assigneeId).toBe('u1');

    const labelText = 'Fix #sa';
    const labelToken = activeToken(labelText, labelText.length)!;
    const label = suggestFor(labelToken, data)[0]!;
    const withLabel = applySuggestion(labelText, labelToken, label).text;
    expect(parseQuickAdd(withLabel, { today: '2026-11-11', labels: data.labels }).labelIds).toEqual(['l1']);
  });
});
