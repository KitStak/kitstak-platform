import { describe, expect, it } from 'vitest';
import {
  extractThemeHandoff,
  parseStoredTheme,
  THEME_COOKIE,
  THEME_URL_PARAM,
  themeCookieString,
} from './theme';

describe('parseStoredTheme', () => {
  it('accepts the two explicit themes', () => {
    expect(parseStoredTheme('light')).toBe('light');
    expect(parseStoredTheme('dark')).toBe('dark');
  });

  it('rejects anything else', () => {
    expect(parseStoredTheme('system')).toBeNull();
    expect(parseStoredTheme('DARK')).toBeNull();
    expect(parseStoredTheme('')).toBeNull();
    expect(parseStoredTheme(null)).toBeNull();
    expect(parseStoredTheme(undefined)).toBeNull();
  });
});

describe('themeCookieString', () => {
  it('writes a year-long explicit preference', () => {
    const cookie = themeCookieString('dark');
    expect(cookie).toContain(`${THEME_COOKIE}=dark`);
    expect(cookie).toContain('Max-Age=31536000');
    expect(cookie).toContain('SameSite=Lax');
  });

  it("clears the cookie for 'system'", () => {
    expect(themeCookieString('system')).toContain('Max-Age=0');
  });
});

describe('extractThemeHandoff', () => {
  it('returns the theme and a clean redirect URL', () => {
    const url = new URL(`https://portal.example.com/billing?module=crm&${THEME_URL_PARAM}=light`);
    const handoff = extractThemeHandoff(url);
    expect(handoff?.theme).toBe('light');
    expect(handoff?.cleanUrl.toString()).toBe('https://portal.example.com/billing?module=crm');
  });

  it('does not mutate the URL it is given', () => {
    const url = new URL(`https://portal.example.com/?${THEME_URL_PARAM}=dark`);
    extractThemeHandoff(url);
    expect(url.searchParams.get(THEME_URL_PARAM)).toBe('dark');
  });

  it('returns null when the param is absent', () => {
    expect(extractThemeHandoff(new URL('https://portal.example.com/'))).toBeNull();
  });

  it('returns null for an invalid value', () => {
    expect(extractThemeHandoff(new URL(`https://portal.example.com/?${THEME_URL_PARAM}=hotdog`))).toBeNull();
  });
});
