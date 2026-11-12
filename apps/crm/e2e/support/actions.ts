/**
 * Scripted page actions for the screenshot CLI: `--action '<verb>:<arg>'`.
 *
 * Selectors are Playwright selectors: CSS (`.foo`), `text=Deals`, `role=button[name="New item"]`,
 * `[data-testid=board-table]`, or `testid=board-table` (shorthand added here).
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';

export type ActionVerb =
  | 'click'
  | 'dblclick'
  | 'rightclick'
  | 'hover'
  | 'fill'
  | 'type'
  | 'press'
  | 'wait'
  | 'waitfor'
  | 'goto'
  | 'scroll'
  | 'focus'
  | 'shot';

export interface PageAction {
  readonly verb: ActionVerb;
  readonly arg: string;
  readonly raw: string;
}

const VERBS: readonly ActionVerb[] = [
  'click',
  'dblclick',
  'rightclick',
  'hover',
  'fill',
  'type',
  'press',
  'wait',
  'waitfor',
  'goto',
  'scroll',
  'focus',
  'shot',
];

export const ACTION_HELP = `Actions (repeat --action, run in order):
  click:<selector>          click an element (also dblclick:, rightclick:, hover:, focus:)
  fill:<selector>=<value>   replace an input's value
  type:<text>               type into the focused element
  press:<key>               keyboard press, e.g. press:Escape, press:Control+K
  wait:<ms>                 fixed pause (prefer waitfor:)
  waitfor:<selector>        wait until visible
  goto:<path>               navigate (supports @/ org-relative paths)
  scroll:<selector>|<y>     scroll element into view, or window to y px
  shot:<label>              save an intermediate screenshot (<out>-<label>.png)
Selectors: CSS, text=…, role=button[name="…"], testid=<id>`;

export function parseAction(raw: string): PageAction {
  const index = raw.indexOf(':');
  const verb = (index === -1 ? raw : raw.slice(0, index)).trim().toLowerCase() as ActionVerb;
  const arg = index === -1 ? '' : raw.slice(index + 1);
  if (!VERBS.includes(verb)) {
    throw new Error(`Unknown action "${raw}". Known verbs: ${VERBS.join(', ')}`);
  }
  const needsArg = verb !== 'type' && verb !== 'shot';
  if (needsArg && arg.trim().length === 0)
    throw new Error(`Action "${raw}" needs an argument (${verb}:<…>).`);
  return { verb, arg, raw };
}

function toSelector(selector: string): string {
  const trimmed = selector.trim();
  return trimmed.startsWith('testid=') ? `[data-testid="${trimmed.slice('testid='.length)}"]` : trimmed;
}

function locate(page: Page, selector: string): Locator {
  return page.locator(toSelector(selector)).first();
}

export interface ActionContext {
  readonly page: Page;
  readonly timeoutMs: number;
  readonly resolvePath: (target: string) => Promise<string>;
  readonly settle: () => Promise<void>;
  readonly capture: (file: string) => Promise<void>;
  readonly outFile: string;
}

async function interact(context: ActionContext, action: PageAction): Promise<void> {
  const { page, timeoutMs } = context;
  const target = () => locate(page, action.arg);
  switch (action.verb) {
    case 'click':
      return target().click({ timeout: timeoutMs });
    case 'dblclick':
      return target().dblclick({ timeout: timeoutMs });
    case 'rightclick':
      return target().click({ button: 'right', timeout: timeoutMs });
    case 'hover':
      return target().hover({ timeout: timeoutMs });
    case 'focus':
      return target().focus({ timeout: timeoutMs });
    case 'fill': {
      const eq = action.arg.indexOf('=');
      if (eq === -1) throw new Error(`fill expects <selector>=<value>, got "${action.arg}"`);
      return locate(page, action.arg.slice(0, eq)).fill(action.arg.slice(eq + 1), { timeout: timeoutMs });
    }
    case 'type':
      return page.keyboard.type(action.arg, { delay: 15 });
    case 'press':
      return page.keyboard.press(action.arg.trim());
    case 'wait': {
      const ms = Number(action.arg);
      if (!Number.isFinite(ms) || ms < 0) throw new Error(`wait expects milliseconds, got "${action.arg}"`);
      return page.waitForTimeout(Math.min(ms, 30_000));
    }
    case 'waitfor':
      await target().waitFor({ state: 'visible', timeout: timeoutMs });
      return;
    case 'goto':
      await page.goto(await context.resolvePath(action.arg), { waitUntil: 'domcontentloaded' });
      return;
    case 'scroll': {
      const y = Number(action.arg);
      if (Number.isFinite(y)) {
        await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
        return;
      }
      return target().scrollIntoViewIfNeeded({ timeout: timeoutMs });
    }
    case 'shot': {
      const label = (action.arg.trim() || 'step').replace(/[^a-z0-9-_]+/gi, '-');
      const parsed = path.parse(context.outFile);
      const file = path.join(parsed.dir, `${parsed.name}-${label}${parsed.ext}`);
      await mkdir(parsed.dir, { recursive: true });
      await context.capture(file);
      process.stdout.write(`SCREENSHOT ${file}\n`);
      return;
    }
  }
}

/** Run actions in order; after each, let the UI settle (animations, data fetches). */
export async function runActions(context: ActionContext, actions: readonly PageAction[]): Promise<void> {
  for (const [index, action] of actions.entries()) {
    try {
      await interact(context, action);
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
      throw new Error(`Action #${index + 1} "${action.raw}" failed: ${message}`);
    }
    if (action.verb !== 'shot' && action.verb !== 'wait') await context.settle();
  }
}
