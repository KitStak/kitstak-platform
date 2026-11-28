/** PINs, badges and link tokens (docs/crew/SPEC.md 5.2 and 6.2). */
import { describe, expect, it } from 'vitest';
import { generatePin, hashBadge, hashPin, isWeakPin, newLinkToken, sha256, verifyPin } from './pins';

describe('PINs', () => {
  it('makes PINs of the asked length that are never easy to guess', () => {
    for (let i = 0; i < 300; i += 1) {
      const four = generatePin(4);
      const six = generatePin(6);
      expect(four).toMatch(/^\d{4}$/);
      expect(six).toMatch(/^\d{6}$/);
      expect(isWeakPin(four)).toBe(false);
      expect(isWeakPin(six)).toBe(false);
    }
  });

  it('knows the weak ones', () => {
    for (const pin of ['0000', '1111', '1234', '4321', '7890', '0987', '123456']) expect(isWeakPin(pin), pin).toBe(true);
    for (const pin of ['2468', '1357', '9021']) expect(isWeakPin(pin), pin).toBe(false);
  });

  it('hashes with a salt and verifies in the Pulse format', () => {
    const first = hashPin('2468');
    const second = hashPin('2468');
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(verifyPin(first, '2468')).toBe(true);
    expect(verifyPin(first, '2469')).toBe(false);
    expect(verifyPin(null, '2468')).toBe(false);
    expect(verifyPin('broken', '2468')).toBe(false);
  });
});

describe('badges and tokens', () => {
  it('keeps only a hash of the trimmed badge, and null for an empty one', () => {
    expect(hashBadge(' 004512 ')).toBe(sha256('004512'));
    expect(hashBadge('')).toBeNull();
    expect(hashBadge(null)).toBeNull();
  });

  it('makes URL safe tokens and keeps their hash and prefix', () => {
    const link = newLinkToken();
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(link.hash).toBe(sha256(link.token));
    expect(link.prefix).toBe(link.token.slice(0, 6));
    expect(newLinkToken().token).not.toBe(link.token);
  });
});
