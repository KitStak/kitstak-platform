import { describe, expect, it } from 'vitest';
import type { UserSummaryDto } from '@/server/services/contracts/dto';
import { searchEmojis } from './emoji';
import { rankMentionCandidates } from './mentions';

const user = (id: string, name: string, email: string): UserSummaryDto => ({ id, name, email, image: null, title: null });
const USERS = [
  user('1', 'Maya Chen', 'maya@x.co'),
  user('2', 'Ethan Brooks', 'ethan@x.co'),
  user('3', 'Hannah Müller', 'hannah@x.co'),
  user('4', 'Jonathan Mayer', 'jm@x.co'),
];

describe('rankMentionCandidates', () => {
  it('ranks name prefix over word prefix over substring', () => {
    expect(rankMentionCandidates(USERS, 'may').map((entry) => entry.name)).toEqual(['Maya Chen', 'Jonathan Mayer']);
    expect(rankMentionCandidates(USERS, 'bro').map((entry) => entry.id)).toEqual(['2']);
    expect(rankMentionCandidates(USERS, 'jm').map((entry) => entry.id)).toEqual(['4']);
  });

  it('returns everyone alphabetically for an empty query, capped by the limit', () => {
    expect(rankMentionCandidates(USERS, '').map((entry) => entry.id)).toEqual(['2', '3', '4', '1']);
    expect(rankMentionCandidates(USERS, '', 2)).toHaveLength(2);
    expect(rankMentionCandidates(USERS, 'zzz')).toEqual([]);
  });
});

describe('searchEmojis', () => {
  it('filters by name and returns all for an empty query', () => {
    expect(searchEmojis('rocket').map((emoji) => emoji.char)).toEqual(['🚀']);
    expect(searchEmojis('').length).toBeGreaterThan(30);
  });
});
