import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline } from './markdown';
import {
  decodeMentions,
  encodeMentions,
  formatBytes,
  formatClock,
  mentionQueryAt,
  parseDuration,
  prefixLines,
  rankPeople,
  wrapSelection,
} from './task-utils';

const MAYA = '5f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const ANN = '11111111-2222-4333-8444-555555555555';

describe('parseDuration', () => {
  it.each([
    ['90', 90],
    ['1h', 60],
    ['1h 30m', 90],
    ['1h30m', 90],
    ['1.5h', 90],
    ['45m', 45],
    ['45 min', 45],
    ['2:15', 135],
    ['1 hour 5 mins', 65],
    ['2 hours', 120],
  ])('%s → %d minutes', (text, minutes) => {
    expect(parseDuration(text)).toBe(minutes);
  });

  it.each(['', 'abc', '0', '1h banana', '-5', '2:75', '0m'])('rejects %j', (text) => {
    expect(parseDuration(text)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats a running clock', () => {
    expect(formatClock(0)).toBe('0:00:00');
    expect(formatClock(249_000)).toBe('0:04:09');
    expect(formatClock(3_753_000)).toBe('1:02:33');
  });

  it('formats file sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
  });
});

describe('mentions in the composer', () => {
  it('encodes picked names into tokens and back', () => {
    const mentions = [
      { name: 'Maya Lopez', id: MAYA },
      { name: 'Ann', id: ANN },
    ];
    const body = encodeMentions('Hey @Maya Lopez and @Ann, see email@Ann.com', mentions);
    expect(body).toBe(`Hey @[Maya Lopez](user:${MAYA}) and @[Ann](user:${ANN}), see email@Ann.com`);
    expect(decodeMentions(body)).toEqual({ text: 'Hey @Maya Lopez and @Ann, see email@Ann.com', mentions });
  });

  it('finds the @query before the caret', () => {
    expect(mentionQueryAt('Hi @ma', 6)).toEqual({ query: 'ma', start: 3 });
    expect(mentionQueryAt('@', 1)).toEqual({ query: '', start: 0 });
    expect(mentionQueryAt('mail@ma', 7)).toBeNull();
    expect(mentionQueryAt('Hi @ma there', 12)).toBeNull();
  });

  it('ranks people by how well they match', () => {
    const people = [
      { name: 'Sam Maya', email: 'sam@x.io' },
      { name: 'Maya Lopez', email: 'maya@x.io' },
      { name: 'Omar', email: 'omar@x.io' },
    ];
    expect(rankPeople(people, 'maya').map((p) => p.name)).toEqual(['Maya Lopez', 'Sam Maya']);
    expect(rankPeople(people, '').length).toBe(3);
  });
});

describe('markdown selection helpers', () => {
  it('wraps and unwraps the selection', () => {
    const wrapped = wrapSelection('make it bold', 8, 12, '**');
    expect(wrapped.text).toBe('make it **bold**');
    const unwrapped = wrapSelection(wrapped.text, wrapped.selectionStart, wrapped.selectionEnd, '**');
    expect(unwrapped.text).toBe('make it bold');
  });

  it('prefixes lines for lists', () => {
    expect(prefixLines('one\ntwo', 0, 7, () => '- ').text).toBe('- one\n- two');
    expect(prefixLines('- one\n- two', 0, 11, () => '- ').text).toBe('one\ntwo');
  });
});

describe('comment markdown', () => {
  it('parses blocks', () => {
    const blocks = parseBlocks(
      'Hello\nworld\n\n- [x] done\n- [ ] next\n\n1. a\n2. b\n\n> quoted\n\n```\ncode\n```',
    );
    expect(blocks.map((b) => b.type)).toEqual(['p', 'ul', 'ol', 'quote', 'code']);
    expect(blocks[1]).toEqual({
      type: 'ul',
      items: [
        { text: 'done', checked: true },
        { text: 'next', checked: false },
      ],
    });
  });

  it('parses inline formatting, links and mentions', () => {
    const inline = parseInline(
      `**Bold** _it_ \`x\` [site](https://a.io) @[Maya](user:${MAYA}) https://b.io/x.`,
    );
    expect(inline.map((i) => i.type)).toEqual([
      'strong',
      'text',
      'em',
      'text',
      'code',
      'text',
      'link',
      'text',
      'mention',
      'text',
      'link',
      'text',
    ]);
  });

  it('never links unsafe protocols', () => {
    const inline = parseInline('[x](javascript:alert(1))');
    expect(inline.every((i) => i.type === 'text')).toBe(true);
  });
});
