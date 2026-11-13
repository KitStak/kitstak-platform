import { describe, expect, test } from 'vitest';
import { MAX_MAILTO_LENGTH, buildMailto, parseTopic } from './contact-model';
import type { ContactDraft } from './contact-model';

const draft = (patch: Partial<ContactDraft> = {}): ContactDraft => ({
  topic: 'founder',
  name: 'Dana Reyes',
  email: 'dana@example.com',
  company: 'Northwind & Co',
  message: 'Two warehouses, 12 people.\nTuesday works.',
  ...patch,
});

describe('parseTopic', () => {
  test('accepts a known topic', () => {
    expect(parseTopic('demo')).toBe('demo');
  });

  test('falls back to "other" for anything else', () => {
    expect(parseTopic('refund')).toBe('other');
    expect(parseTopic(null)).toBe('other');
  });
});

describe('buildMailto', () => {
  test('addresses the message and names the topic and company in the subject', () => {
    const url = new URL(buildMailto(draft()));

    expect(url.protocol).toBe('mailto:');
    expect(url.searchParams.get('subject')).toBe('Talk to the founder: Northwind & Co');
  });

  test('puts the message first and the sender details after it', () => {
    const body = new URL(buildMailto(draft())).searchParams.get('body');

    expect(body).toBe(
      'Two warehouses, 12 people.\r\nTuesday works.\r\n\r\nDana Reyes\r\nNorthwind & Co\r\ndana@example.com',
    );
  });

  test('encodes spaces as %20 so mail apps do not show plus signs', () => {
    expect(buildMailto(draft())).not.toContain('+');
  });

  test('shortens a very long message so the link stays within mail app limits', () => {
    const href = buildMailto(draft({ message: 'café au lait\n'.repeat(300) }));

    expect(href.length).toBeLessThanOrEqual(MAX_MAILTO_LENGTH);
    expect(new URL(href).searchParams.get('body')).toContain('dana@example.com');
  });

  test('leaves out the message block when there is no message', () => {
    const body = new URL(buildMailto(draft({ message: '  ' }))).searchParams.get('body');

    expect(body).toBe('Dana Reyes\r\nNorthwind & Co\r\ndana@example.com');
  });

  test('cannot be broken out of by header-like input', () => {
    const href = buildMailto(draft({ company: 'Acme&cc=evil@example.com', message: 'hi\r\nBcc: evil@example.com' }));
    const url = new URL(href);

    expect([...url.searchParams.keys()].sort()).toEqual(['body', 'subject']);
  });
});
