import { describe, expect, test } from 'vitest';
import { cleanCode, companyIssue, emailIssue, firstNameOf, nameIssue, signupIssues, SIGNUP_FIELDS } from './fields';

describe('signup fields', () => {
  test('there are four fields, in the order the form shows them', () => {
    expect(SIGNUP_FIELDS).toEqual(['name', 'email', 'password', 'company']);
  });

  test('the messages are the exact ones in the spec', () => {
    expect(nameIssue(' M ')).toBe('Enter your full name.');
    expect(emailIssue('maya@')).toBe('Enter a valid work email.');
    expect(companyIssue('')).toBe('Enter your company or team name.');
    expect(nameIssue('x'.repeat(101))).toBe('Use 100 characters or fewer.');
    expect(companyIssue('x'.repeat(81))).toBe('Use 80 characters or fewer.');
  });

  test('good values pass', () => {
    expect(nameIssue('Maya Chen')).toBeNull();
    expect(emailIssue(' maya@northwind.example ')).toBeNull();
    expect(companyIssue('Northwind Robotics')).toBeNull();
    expect(
      signupIssues({ name: 'Maya Chen', email: 'maya@northwind.example', password: 'Good-Password-1', company: 'Northwind' }),
    ).toEqual({});
  });

  test('an empty form flags every field', () => {
    expect(Object.keys(signupIssues({ name: '', email: '', password: '', company: '' }))).toEqual([...SIGNUP_FIELDS]);
  });

  test('emails with spaces, no dot or two at signs are refused', () => {
    for (const bad of ['maya', 'maya@northwind', 'ma ya@northwind.example', 'maya@@northwind.example', '@northwind.example']) {
      expect(emailIssue(bad)).not.toBeNull();
    }
  });
});

describe('cleanCode', () => {
  test('a pasted code with spaces, dashes or words works', () => {
    expect(cleanCode('123 456')).toBe('123456');
    expect(cleanCode('123-456')).toBe('123456');
    expect(cleanCode('Your KitStak code: 123456')).toBe('123456');
    expect(cleanCode('1234567890')).toBe('123456');
    expect(cleanCode('abc')).toBe('');
  });
});

describe('firstNameOf', () => {
  test('takes the first word', () => {
    expect(firstNameOf('  Maya   Chen ')).toBe('Maya');
    expect(firstNameOf('Cher')).toBe('Cher');
    expect(firstNameOf('')).toBe('');
  });
});
