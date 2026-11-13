import { describe, expect, it } from 'vitest';
import { extractMentions, mentionToken, plainMentions, splitMentions } from './mentions';

const MAYA = '11111111-1111-4111-8111-111111111111';
const LIAM = '22222222-2222-4222-8222-222222222222';

describe('mentions', () => {
  it('round-trips tokens', () => {
    const body = `Hey ${mentionToken('Maya', MAYA)} and ${mentionToken('Liam', LIAM)}, ping ${mentionToken('Maya', MAYA)}`;
    expect(extractMentions(body)).toEqual([MAYA, LIAM]);
    expect(plainMentions(body)).toBe('Hey @Maya and @Liam, ping @Maya');
    const segments = splitMentions(body);
    expect(segments[0]).toEqual({ type: 'text', text: 'Hey ' });
    expect(segments[1]).toEqual({ type: 'mention', name: 'Maya', userId: MAYA });
  });
});
