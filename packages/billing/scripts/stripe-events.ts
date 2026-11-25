/**
 * Forward real Stripe TEST events to the local Portal (docs/billing/DEV.md, "Real Stripe test
 * mode"). DEV ONLY. Use `deploy/dev/stripe-events.sh`, which loads the local env file first.
 *
 *   stripe:events                     forward every new event once, oldest first, then stop
 *   stripe:events watch               the same, every 3 seconds, until Ctrl C
 *   stripe:events since <minutes>     start again from events made in the last N minutes
 *   stripe:events replay <evt_id> ... send these events again (the Portal answers "duplicate")
 *   stripe:events status              show the cursor and what is waiting. Sends nothing.
 *
 *   --reverse      send this batch newest first (to test events that arrive out of order)
 *   --twice        send every event of this batch two times (to test duplicates)
 *   --to <url>     default http://localhost:3300/api/billing/webhooks/stripe (localhost only)
 *
 * Env: STRIPE_SECRET_KEY (a TEST key, or the placeholder a cloud proxy replaces), STRIPE_WEBHOOK_SECRET
 * (the local signing secret the Portal was started with). Behind a proxy also NODE_USE_ENV_PROXY=1.
 *
 * The tool remembers the last event it forwarded in deploy/dev/.run/stripe-events.cursor.json, so
 * running it again sends only what is new. The Portal's own ledger (core.billing_events) makes a
 * repeat harmless anyway. An event the Portal answers 500 for stops the run and is tried again next
 * time, so order is kept. This tool only reads from Stripe.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertLocalUrl,
  assertTestAccount,
  type ForwardResult,
  forwardEvent,
  getEvent,
  listNewEvents,
  type StripeEventBody,
  stripeReader,
} from './stripe-events-lib';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CURSOR_FILE = resolve(HERE, '../../../deploy/dev/.run/stripe-events.cursor.json');
const DEFAULT_URL = 'http://localhost:3300/api/billing/webhooks/stripe';
const USAGE = `Usage:
  stripe:events [watch | status | since <minutes> | replay <evt_id> ...] [--reverse] [--twice] [--to <url>]`;

interface Cursor {
  lastEventId: string | null;
  lastCreated: number;
}

function print(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function fail(message: string, code = 2): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function clock(): string {
  return new Date().toISOString().slice(11, 19);
}

function readCursor(file: string): Cursor | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Cursor>;
    if (typeof parsed.lastCreated !== 'number') return null;
    return { lastEventId: typeof parsed.lastEventId === 'string' ? parsed.lastEventId : null, lastCreated: parsed.lastCreated };
  } catch {
    return null;
  }
}

function writeCursor(file: string, cursor: Cursor): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(cursor)}\n`);
}

function line(result: ForwardResult): string {
  return `${clock()}  ${String(result.status)}  ${result.result.padEnd(13)} ${result.eventId}  ${result.type}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const flags = { reverse: false, twice: false, to: process.env.STRIPE_EVENTS_URL ?? DEFAULT_URL };
  const words: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--reverse') flags.reverse = true;
    else if (arg === '--twice') flags.twice = true;
    else if (arg === '--to') flags.to = args[(index += 1)] ?? '';
    else if (arg === '--help' || arg === '-h') {
      print(USAGE);
      return;
    } else if (arg.startsWith('--')) fail(`Unknown option ${arg}\n${USAGE}`);
    else words.push(arg);
  }
  const command = words[0] ?? 'once';
  if (!['once', 'watch', 'status', 'since', 'replay'].includes(command)) fail(USAGE);

  const key = process.env.STRIPE_SECRET_KEY;
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
  if (!key) fail('STRIPE_SECRET_KEY is not set. Run this through deploy/dev/stripe-events.sh.');
  if (!secret && command !== 'status') fail('STRIPE_WEBHOOK_SECRET is not set. Run this through deploy/dev/stripe-events.sh.');
  assertLocalUrl(flags.to);
  const get = stripeReader(key);
  await assertTestAccount(get);

  const cursorFile = process.env.STRIPE_EVENTS_CURSOR_FILE ?? DEFAULT_CURSOR_FILE;
  const send = async (events: readonly StripeEventBody[]): Promise<{ sent: number; stoppedAt: StripeEventBody | null }> => {
    let sent = 0;
    for (const event of events) {
      for (let round = 0; round < (flags.twice ? 2 : 1); round += 1) {
        let result = await forwardEvent(event, { url: flags.to, secret });
        // A 500 means the handler rolled back. Try twice more before giving up on this run.
        for (let retry = 0; retry < 2 && result.status >= 500; retry += 1) {
          print(line(result));
          await new Promise((done) => setTimeout(done, 1500));
          result = await forwardEvent(event, { url: flags.to, secret });
        }
        print(line(result));
        if (result.status === 503) fail('The Portal is not in Stripe mode. Start it with: KITSTAK_STRIPE=1 deploy/dev/app-start.sh portal', 1);
        if (result.status === 400) fail('The Portal refused the signature. It was started with another STRIPE_WEBHOOK_SECRET. Restart it.', 1);
        if (result.status >= 500) return { sent, stoppedAt: event };
        sent += 1;
      }
    }
    return { sent, stoppedAt: null };
  };

  if (command === 'replay') {
    const ids = words.slice(1);
    if (ids.length === 0) fail(USAGE);
    const events: StripeEventBody[] = [];
    for (const id of ids) events.push(await getEvent(get, id));
    const outcome = await send(flags.reverse ? [...events].reverse() : events);
    if (outcome.stoppedAt) process.exitCode = 1;
    return;
  }

  let cursor = readCursor(cursorFile);
  if (command === 'since') {
    const minutes = Number(words[1]);
    if (!Number.isFinite(minutes) || minutes <= 0) fail(USAGE);
    cursor = { lastEventId: null, lastCreated: Math.floor(Date.now() / 1000 - minutes * 60) };
  }
  // The first run starts now: old events of other people's work are not replayed by accident.
  cursor ??= { lastEventId: null, lastCreated: Math.floor(Date.now() / 1000) };

  const pass = async (): Promise<boolean> => {
    const current = cursor!;
    const events = await listNewEvents(get, { afterId: current.lastEventId, sinceSeconds: current.lastCreated });
    if (command === 'status') {
      print(`cursor   ${current.lastEventId ?? `(none, from ${new Date(current.lastCreated * 1000).toISOString()})`}`);
      print(`waiting  ${String(events.length)} event${events.length === 1 ? '' : 's'}`);
      for (const event of events) print(`         ${event.id}  ${event.type}`);
      return true;
    }
    if (events.length === 0) return true;
    const outcome = await send(flags.reverse ? [...events].reverse() : events);
    if (outcome.stoppedAt) {
      // Keep the cursor just before the event that failed, so the next run tries it again.
      const index = events.findIndex((event) => event.id === outcome.stoppedAt!.id);
      const before = flags.reverse ? null : (events[index - 1] ?? null);
      if (before) cursor = { lastEventId: before.id, lastCreated: before.created };
      writeCursor(cursorFile, cursor!);
      print(`Stopped at ${outcome.stoppedAt.id}: the Portal answered 500. Look at deploy/dev/.run/logs/portal.log, then run this again.`);
      return false;
    }
    const newest = events[events.length - 1]!;
    cursor = { lastEventId: newest.id, lastCreated: newest.created };
    writeCursor(cursorFile, cursor);
    return true;
  };

  if (command !== 'watch') {
    const ok = await pass();
    if (command !== 'status' && ok) writeCursor(cursorFile, cursor);
    if (!ok) process.exitCode = 1;
    return;
  }
  const interval = Math.max(1, Number(process.env.STRIPE_EVENTS_INTERVAL ?? 3)) * 1000;
  print(`Forwarding Stripe test events to ${flags.to} every ${String(interval / 1000)}s. Press Ctrl C to stop.`);
  writeCursor(cursorFile, cursor);
  for (;;) {
    try {
      await pass();
    } catch (error) {
      print(`${clock()}  ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise((done) => setTimeout(done, interval));
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
