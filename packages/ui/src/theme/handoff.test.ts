// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_COOKIE, THEME_STORAGE_KEY, THEME_URL_PARAM } from './theme';
import { storedTheme, withThemeParam } from './handoff';

function clearStores(): void {
  document.cookie = `${THEME_COOKIE}=; Max-Age=0`;
  window.localStorage.clear();
}

afterEach(clearStores);

describe('storedTheme', () => {
  it('returns null when nothing is stored (user follows the OS)', () => {
    expect(storedTheme()).toBeNull();
  });

  it('reads the cookie', () => {
    document.cookie = `${THEME_COOKIE}=dark`;
    expect(storedTheme()).toBe('dark');
  });

  it('falls back to localStorage, with the cookie winning when both exist', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(storedTheme()).toBe('light');

    document.cookie = `${THEME_COOKIE}=dark`;
    expect(storedTheme()).toBe('dark');
  });

  it('ignores garbage values', () => {
    document.cookie = `${THEME_COOKIE}=hotdog`;
    expect(storedTheme()).toBeNull();
  });
});

describe('withThemeParam', () => {
  it('passes the href through when no preference is stored', () => {
    expect(withThemeParam('https://crm.example.com/pipeline')).toBe('https://crm.example.com/pipeline');
  });

  it('appends the stored preference, keeping existing params', () => {
    document.cookie = `${THEME_COOKIE}=light`;
    expect(withThemeParam('https://crm.example.com/pipeline?view=board')).toBe(
      `https://crm.example.com/pipeline?view=board&${THEME_URL_PARAM}=light`,
    );
  });

  it('returns the href unchanged when it cannot be parsed', () => {
    document.cookie = `${THEME_COOKIE}=dark`;
    expect(withThemeParam('http://')).toBe('http://');
  });
});
