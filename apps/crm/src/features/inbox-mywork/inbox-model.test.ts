import { describe, expect, it } from 'vitest';
import { collapseText, isUnreadForMe, needsCollapse, plainTextToDoc, splitMentions } from './inbox-model';

describe('plainTextToDoc', () => {
  it('turns lines into paragraphs and trims outer whitespace', () => {
    expect(plainTextToDoc('  Hi\r\n\nthere  ')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'there' }] },
      ],
    });
  });
});

describe('collapse', () => {
  it('leaves short text alone', () => {
    expect(needsCollapse('short')).toBe(false);
    expect(collapseText('short')).toBe('short');
  });

  it('cuts long text on a word boundary', () => {
    const text = 'word '.repeat(100);
    const collapsed = collapseText(text, 50);
    expect(collapsed.endsWith('…')).toBe(true);
    expect(collapsed.length).toBeLessThanOrEqual(51);
    expect(collapsed).not.toMatch(/wor…$/);
  });

  it('collapses on line count', () => {
    const text = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n');
    expect(needsCollapse(text)).toBe(true);
    expect(collapseText(text)).toBe('a\nb\nc\nd\ne…');
  });
});

describe('splitMentions', () => {
  it('marks known @mentions, longest name first', () => {
    expect(splitMentions('Hey @Maya Chen and @Maya, look', ['Maya', 'Maya Chen'])).toEqual([
      { text: 'Hey ', mention: false },
      { text: '@Maya Chen', mention: true },
      { text: ' and ', mention: false },
      { text: '@Maya', mention: true },
      { text: ', look', mention: false },
    ]);
  });

  it('escapes regex characters and handles no names', () => {
    expect(splitMentions('@a.b c', ['a.b'])).toEqual([
      { text: '@a.b', mention: true },
      { text: ' c', mention: false },
    ]);
    expect(splitMentions('plain', [])).toEqual([{ text: 'plain', mention: false }]);
  });
});

describe('isUnreadForMe', () => {
  const author = (id: string) => ({ id, name: id, email: `${id}@x.test`, image: null, title: null });
  it('never marks my own posts unread', () => {
    expect(isUnreadForMe({ id: 'u1', readByMe: false, author: author('me') }, 'me')).toBe(false);
  });
  it('marks unread posts by others', () => {
    expect(isUnreadForMe({ id: 'u1', readByMe: false, author: author('ethan') }, 'me')).toBe(true);
    expect(isUnreadForMe({ id: 'u1', readByMe: true, author: author('ethan') }, 'me')).toBe(false);
  });
  it('ignores optimistic replies', () => {
    expect(isUnreadForMe({ id: 'temp-1', readByMe: false, author: author('ethan') }, 'me')).toBe(false);
  });
});
