import { describe, expect, test } from 'vitest';
import { emailHint } from './email-hint';

describe('emailHint', () => {
  test('a slip in a well known mail host is offered back', () => {
    expect(emailHint('dana@gmial.com')).toEqual({ domain: 'gmail.com', email: 'dana@gmail.com' });
    expect(emailHint('dana@gmai.com')?.domain).toBe('gmail.com');
    expect(emailHint('dana@gmaill.com')?.domain).toBe('gmail.com');
    expect(emailHint('Dana.W@hotmial.com')).toEqual({ domain: 'hotmail.com', email: 'Dana.W@hotmail.com' });
    expect(emailHint('dana@outlok.com')?.domain).toBe('outlook.com');
    expect(emailHint('dana@yaho.com')?.domain).toBe('yahoo.com');
    expect(emailHint('dana@iclould.com')?.domain).toBe('icloud.com');
  });

  test('a slip on ".com" is offered back for any domain', () => {
    expect(emailHint('dana@whitlock-supply.con')).toEqual({ domain: 'whitlock-supply.com', email: 'dana@whitlock-supply.com' });
    expect(emailHint('dana@gmail.con')?.domain).toBe('gmail.com');
    expect(emailHint('dana@northwind.cmo')?.domain).toBe('northwind.com');
  });

  test('a right address, a company domain and a real ending are left alone', () => {
    for (const email of ['dana@gmail.com', 'dana@whitlock-supply.com', 'maya@northwind.example', 'dana@kitstak.io', 'dana@team.co', 'dana@mail.co.uk', 'dana@proton.me', 'dana@gmx.com', 'dana@gmx.net']) {
      expect(emailHint(email), email).toBeNull();
    }
  });

  test('nothing is offered while the address is still being typed', () => {
    for (const email of ['', 'dana', 'dana@', 'dana@gmial', 'dana@gmial.', 'dana@gmial.c', '@gmial.com', 'da na@gmial.com']) {
      expect(emailHint(email), email).toBeNull();
    }
  });
});
