/**
 * Resolves how to launch Chromium on this machine without downloading anything.
 *
 * Order of preference:
 *   1. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (explicit override)
 *   2. The browser bundled with the installed @playwright/test version, if present
 *   3. `PLAYWRIGHT_CHANNEL` or system Google Chrome / Microsoft Edge (channel launch)
 *   4. The newest `chromium-*` build already in the local ms-playwright cache
 *
 * Run `npx playwright install chromium` to get (2) if none of the others work.
 */
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

export interface ChromiumLaunchConfig {
  readonly channel?: string;
  readonly executablePath?: string;
  /** Human-readable explanation of the choice (printed by tools). */
  readonly source: string;
}

function playwrightCacheDir(): string {
  const override = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (override && override !== '0') return override;
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
      'ms-playwright',
    );
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'ms-playwright');
}

const SYSTEM_CHANNELS: readonly { channel: string; paths: readonly string[] }[] = [
  {
    channel: 'chrome',
    paths: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/opt/google/chrome/chrome',
    ],
  },
  {
    channel: 'msedge',
    paths: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/opt/microsoft/msedge/msedge',
    ],
  },
];

const CACHED_EXECUTABLES: readonly string[] = [
  path.join('chrome-win64', 'chrome.exe'),
  path.join('chrome-win', 'chrome.exe'),
  path.join('chrome-linux64', 'chrome'),
  path.join('chrome-linux', 'chrome'),
  path.join(
    'chrome-mac-arm64',
    'Google Chrome for Testing.app',
    'Contents',
    'MacOS',
    'Google Chrome for Testing',
  ),
  path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
];

function newestCachedChromium(): string | undefined {
  const dir = playwrightCacheDir();
  if (!existsSync(dir)) return undefined;
  const revisions = readdirSync(dir)
    .map((name) => /^chromium-(\d+)$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ name: match[0], revision: Number(match[1]) }))
    .sort((a, b) => b.revision - a.revision);
  for (const { name } of revisions) {
    for (const relative of CACHED_EXECUTABLES) {
      const candidate = path.join(dir, name, relative);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

let cached: ChromiumLaunchConfig | undefined;

export function resolveChromium(): ChromiumLaunchConfig {
  if (cached) return cached;
  cached = computeChromium();
  return cached;
}

function computeChromium(): ChromiumLaunchConfig {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim();
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`PLAYWRIGHT_CHROMIUM_EXECUTABLE points to a missing file: ${explicit}`);
    }
    return { executablePath: explicit, source: `PLAYWRIGHT_CHROMIUM_EXECUTABLE (${explicit})` };
  }

  // Headless runs use the headless shell; it ships alongside the full build.
  const bundled = chromium.executablePath();
  const bundledShell = bundled.replace(/chromium-(\d+)/, 'chromium_headless_shell-$1');
  if (existsSync(bundled) && existsSync(path.dirname(path.dirname(bundledShell)))) {
    return { source: 'bundled Playwright Chromium' };
  }

  const channelOverride = process.env.PLAYWRIGHT_CHANNEL?.trim();
  if (channelOverride) return { channel: channelOverride, source: `PLAYWRIGHT_CHANNEL=${channelOverride}` };

  for (const { channel, paths } of SYSTEM_CHANNELS) {
    if (paths.some((candidate) => candidate.length > 0 && existsSync(candidate))) {
      return { channel, source: `system browser (channel "${channel}")` };
    }
  }

  const fallback = newestCachedChromium();
  if (fallback) return { executablePath: fallback, source: `cached Chromium (${fallback})` };

  throw new Error(
    'No Chromium available. Run `npx playwright install chromium`, install Google Chrome, ' +
      'or set PLAYWRIGHT_CHROMIUM_EXECUTABLE.',
  );
}

/** Launch options fragment for `chromium.launch()` / Playwright `use.launchOptions`. */
export function chromiumLaunchOptions(): { channel?: string; executablePath?: string } {
  const { channel, executablePath } = resolveChromium();
  return {
    ...(channel ? { channel } : {}),
    ...(executablePath ? { executablePath } : {}),
  };
}
