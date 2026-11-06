/**
 * Screenshot CLI for builders and critics — see docs/QA.md.
 *
 *   npx tsx scripts/screenshot.ts <path|url> [--out file.png] [--width 1440] [--height 900]
 *       [--theme light|dark] [--action 'click:<selector>' ...] [--full-page] [--no-auth]
 *       [--wait-for <selector>] [--timeout <s>] [--retries <n>] [--show-dev-overlay] [--json]
 *
 * <path> may be absolute ("/acme/boards/123"), a full URL, or org-relative ("@/boards/123",
 * resolved by following "/" to the signed-in user's org). Ensures the dev server is up,
 * reuses e2e/.auth/admin.json (logs in if missing/expired), waits for the page to settle
 * (network quiet, no skeletons, fonts loaded) and writes PNGs to .qa/screens/.
 * Final stdout line: `SCREENSHOT <absolute path>`.
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ACTION_HELP, parseAction, runActions, type PageAction } from '../e2e/support/actions';
import { ensureAdminStorageState } from '../e2e/support/auth';
import { chromiumLaunchOptions } from '../e2e/support/browser';
import { ensureDevServer } from '../e2e/support/dev-server';
import { ADMIN_STORAGE_STATE, SCREENS_DIR, baseUrl } from '../e2e/support/paths';

interface Options {
  readonly target: string;
  readonly out?: string;
  readonly width: number;
  readonly height: number;
  readonly theme: 'light' | 'dark';
  readonly actions: readonly PageAction[];
  readonly fullPage: boolean;
  readonly auth: boolean;
  readonly waitFor?: string;
  readonly timeoutMs: number;
  readonly retries: number;
  readonly showDevOverlay: boolean;
  readonly json: boolean;
}

const USAGE = `Usage: npx tsx scripts/screenshot.ts <path|url|@/org-relative> [options]
  --out <file.png>        output (relative names go to .qa/screens/)
  --width <px> --height <px>   viewport (default 1440x900)
  --theme light|dark      color scheme + data-theme on <html> (default light)
  --action '<verb>:<arg>' scripted interaction, repeatable (see below)
  --wait-for <selector>   wait for this element before capturing
  --full-page             capture the full scroll height
  --no-auth               run logged out
  --timeout <s>           per-step timeout (default 20)
  --retries <n>           retry the whole capture on failure (default 2)
  --show-dev-overlay      keep the Next.js dev indicator visible
  --json                  print a JSON result line
${ACTION_HELP}`;

function positiveInt(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${flag} expects a positive integer, got "${value}"`);
  return parsed;
}

function parseOptions(argv: readonly string[]): Options {
  let target: string | undefined;
  let out: string | undefined;
  let width = 1440;
  let height = 900;
  let theme: Options['theme'] = 'light';
  const actions: PageAction[] = [];
  let fullPage = false;
  let auth = true;
  let waitFor: string | undefined;
  let timeoutMs = 20_000;
  let retries = 2;
  let showDevOverlay = false;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} expects a value`);
      return value;
    };
    switch (arg) {
      case '--out':
        out = next();
        break;
      case '--width':
        width = positiveInt(arg, next());
        break;
      case '--height':
        height = positiveInt(arg, next());
        break;
      case '--theme': {
        const value = next();
        if (value !== 'light' && value !== 'dark')
          throw new Error(`--theme must be light or dark, got "${value}"`);
        theme = value;
        break;
      }
      case '--action':
        actions.push(parseAction(next()));
        break;
      case '--wait-for':
        waitFor = next();
        break;
      case '--full-page':
        fullPage = true;
        break;
      case '--no-auth':
        auth = false;
        break;
      case '--timeout':
        timeoutMs = positiveInt(arg, next()) * 1000;
        break;
      case '--retries':
        retries = Number(next());
        break;
      case '--show-dev-overlay':
        showDevOverlay = true;
        break;
      case '--json':
        json = true;
        break;
      case '-h':
      case '--help':
        process.stdout.write(`${USAGE}\n`);
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}\n\n${USAGE}`);
        if (target !== undefined) throw new Error(`Unexpected extra argument "${arg}"`);
        target = arg;
    }
  }
  if (!target) throw new Error(`Missing <path>.\n\n${USAGE}`);
  if (!Number.isInteger(retries) || retries < 0) throw new Error('--retries expects an integer >= 0');
  target = normaliseTarget(target);
  return {
    target,
    out,
    width,
    height,
    theme,
    actions,
    fullPage,
    auth,
    waitFor,
    timeoutMs,
    retries,
    showDevOverlay,
    json,
  };
}

function slugify(target: string): string {
  const slug = target
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/^[~@]\//, 'org-')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug.length > 0 ? slug.slice(0, 80) : 'root';
}

function outputFile(options: Options): string {
  const name =
    options.out ?? `${slugify(options.target)}-${options.theme}-${options.width}x${options.height}.png`;
  const withExt = name.toLowerCase().endsWith('.png') ? name : `${name}.png`;
  return path.isAbsolute(withExt) || withExt.includes('/') || withExt.includes('\\')
    ? path.resolve(withExt)
    : path.join(SCREENS_DIR, withExt);
}

const SKELETON_SELECTOR = '[data-skeleton], [aria-busy="true"], .animate-pulse';

/**
 * Init script (as a string: tsx/esbuild would inject `__name` helpers into a serialized
 * function, which do not exist in the page). Forces the requested theme on <html>.
 */
function themeInitScript(theme: 'light' | 'dark'): string {
  const value = JSON.stringify(theme);
  return `(() => {
    try { localStorage.setItem('kitstak.theme', ${value}); localStorage.setItem('theme', ${value}); } catch (e) {}
    var apply = function () {
      var root = document.documentElement;
      if (root.getAttribute('data-theme') !== ${value}) root.setAttribute('data-theme', ${value});
      root.style.colorScheme = ${value};
    };
    var watch = function () {
      if (!document.documentElement) return false;
      apply();
      new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      return true;
    };
    if (!watch()) {
      // Init scripts can run before <html> exists; wait for it.
      var pending = new MutationObserver(function () { if (watch()) pending.disconnect(); });
      pending.observe(document, { childList: true });
    }
  })();`;
}

/**
 * Normalise a target path. Git Bash (MSYS) rewrites "/login" into "C:/…/Git/login"; undo that.
 * "@/x" and "~/x" are org-relative.
 */
export function normaliseTarget(target: string): string {
  // Also covers "@/x" → "@C:/…/Git/x" (the org-relative prefix survives in front of the drive).
  const msys = /^([@~]?)[A-Za-z]:[\\/](?:.*[\\/])?Git(?:[\\/]usr)?([\\/].*)?$/.exec(target);
  if (msys) return `${msys[1] ?? ''}${(msys[2] ?? '/').replace(/\\/g, '/')}`;
  return target;
}

interface Capture {
  readonly file: string;
  readonly finalUrl: string;
  readonly warnings: string[];
}

class CaptureSession {
  private orgPrefix: string | undefined;
  readonly warnings: string[] = [];
  readonly pageErrors: string[] = [];

  constructor(
    private readonly page: Page,
    private readonly options: Options,
  ) {
    page.on('pageerror', (error) => this.pageErrors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') this.pageErrors.push(`console.error: ${message.text().slice(0, 300)}`);
    });
  }

  async resolvePath(target: string): Promise<string> {
    if (/^https?:\/\//.test(target)) return target;
    if (!target.startsWith('~') && !target.startsWith('@/'))
      return target.startsWith('/') ? target : `/${target}`;
    if (!this.orgPrefix) {
      await this.page.goto('/', { waitUntil: 'domcontentloaded' });
      const first = new URL(this.page.url()).pathname.split('/').filter(Boolean)[0];
      if (!first || ['login', 'welcome', 'signup'].includes(first)) {
        throw new Error(
          `Cannot resolve org-relative "${target}" — "/" redirected to ${this.page.url()} (no org for this user?)`,
        );
      }
      this.orgPrefix = `/${first}`;
    }
    return `${this.orgPrefix}/${target.replace(/^(~|@)\/?/, '')}`;
  }

  async settle(): Promise<void> {
    const { page } = this;
    // Open SSE streams keep the network busy forever, so network-idle is best effort.
    await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => undefined);
    try {
      await page.locator(SKELETON_SELECTOR).first().waitFor({ state: 'detached', timeout: 15_000 });
    } catch {
      const count = await page
        .locator(SKELETON_SELECTOR)
        .count()
        .catch(() => 0);
      if (count > 0) this.warnings.push(`${count} skeleton/busy element(s) still visible after 15s`);
    }
    await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await page.waitForTimeout(200);
  }

  async capture(file: string): Promise<void> {
    await this.page.screenshot({
      path: file,
      fullPage: this.options.fullPage,
      animations: 'disabled',
      caret: 'hide',
    });
  }

  async devErrorOverlay(): Promise<string | null> {
    return this.page.evaluate(() => {
      const portal = document.querySelector('nextjs-portal');
      const root = portal?.shadowRoot;
      const dialog = root?.querySelector('[data-nextjs-dialog], [data-nextjs-dialog-overlay]');
      return dialog
        ? (dialog.textContent ?? 'error overlay').replace(/\s+/g, ' ').trim().slice(0, 500)
        : null;
    });
  }
}

async function attempt(browser: Browser, options: Options, file: string): Promise<Capture> {
  const context: BrowserContext = await browser.newContext({
    baseURL: baseUrl(),
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: 1,
    colorScheme: options.theme,
    reducedMotion: 'reduce',
    ...(options.auth && existsSync(ADMIN_STORAGE_STATE) ? { storageState: ADMIN_STORAGE_STATE } : {}),
  });
  context.setDefaultTimeout(options.timeoutMs);
  context.setDefaultNavigationTimeout(Math.max(options.timeoutMs, 60_000));
  await context.addInitScript({ content: themeInitScript(options.theme) });
  const page = await context.newPage();
  const session = new CaptureSession(page, options);
  try {
    const url = await session.resolvePath(options.target);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    const landed = new URL(page.url());
    if (options.auth && /^\/login\/?$/.test(landed.pathname) && !/^\/?login/.test(options.target)) {
      throw new AuthExpiredError(`Redirected to ${landed.pathname}${landed.search} — admin session invalid.`);
    }
    if (response && response.status() >= 500) session.warnings.push(`HTTP ${response.status()} for ${url}`);
    else if (response && response.status() === 404) session.warnings.push(`HTTP 404 for ${url}`);

    await session.settle();
    if (options.waitFor) await page.locator(options.waitFor).first().waitFor({ state: 'visible' });
    await runActions(
      {
        page,
        timeoutMs: options.timeoutMs,
        resolvePath: (target) => session.resolvePath(target),
        settle: () => session.settle(),
        capture: (out) => session.capture(out),
        outFile: file,
      },
      options.actions,
    );

    const overlay = await session.devErrorOverlay();
    if (overlay) session.warnings.push(`Next.js error overlay visible: ${overlay}`);
    else if (!options.showDevOverlay) {
      await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => undefined);
    }
    await mkdir(path.dirname(file), { recursive: true });
    await session.capture(file);
    return {
      file,
      finalUrl: page.url(),
      warnings: [...session.warnings, ...session.pageErrors.slice(0, 10)],
    };
  } catch (error) {
    const errorFile = file.replace(/\.png$/i, '-error.png');
    await mkdir(path.dirname(errorFile), { recursive: true });
    await page.screenshot({ path: errorFile }).catch(() => undefined);
    if (error instanceof Error && existsSync(errorFile))
      error.message += `\n  (state at failure: ${errorFile})`;
    if (session.pageErrors.length > 0 && error instanceof Error) {
      error.message += `\n  page errors:\n    ${session.pageErrors.slice(0, 5).join('\n    ')}`;
    }
    throw error;
  } finally {
    await context.close();
  }
}

class AuthExpiredError extends Error {}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const log = (message: string) => process.stderr.write(`[screenshot] ${message}\n`);
  const file = outputFile(options);

  await ensureDevServer({ log });
  if (options.auth) {
    const auth = await ensureAdminStorageState();
    if (!auth.ok)
      throw new Error(`Cannot sign in as demo admin: ${auth.reason}\n  (use --no-auth for public pages)`);
  }

  const browser = await chromium.launch({ headless: true, ...chromiumLaunchOptions() });
  try {
    let lastError: unknown;
    for (let run = 0; run <= options.retries; run += 1) {
      try {
        const result = await attempt(browser, options, file);
        for (const warning of result.warnings) log(`WARN ${warning}`);
        if (options.json) process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
        process.stdout.write(`SCREENSHOT ${result.file}\n`);
        return;
      } catch (error) {
        lastError = error;
        if (error instanceof AuthExpiredError && options.auth) {
          log('Session expired; logging in again.');
          const auth = await ensureAdminStorageState({ force: true });
          if (!auth.ok) throw new Error(`Re-login failed: ${auth.reason}`);
        }
        if (run < options.retries) {
          log(
            `Attempt ${run + 1} failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}; retrying…`,
          );
        }
      }
    }
    throw lastError;
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[screenshot] FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
