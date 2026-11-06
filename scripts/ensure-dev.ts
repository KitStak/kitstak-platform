/**
 * Ensure embedded Postgres + the Next dev server on :3100 are running and healthy.
 *
 *   npx tsx scripts/ensure-dev.ts            start anything missing (background), wait for /api/v1/health
 *   npx tsx scripts/ensure-dev.ts --status   report only; exit 0 when healthy, 1 otherwise
 *   npx tsx scripts/ensure-dev.ts --stop     stop the dev server this harness started
 *   options: --timeout <seconds> (default 240), --json
 *
 * Safe to run concurrently from many agents (serialised via .qa/dev.lock).
 */
import { checkHealth, DB_PORT, ensureDevServer, isPortOpen, stopDevServer } from '../e2e/support/dev-server';
import { DEV_LOG_FILE, baseUrl } from '../e2e/support/paths';

interface Args {
  readonly mode: 'ensure' | 'status' | 'stop';
  readonly timeoutMs: number;
  readonly json: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let mode: Args['mode'] = 'ensure';
  let timeoutMs = 240_000;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--status') mode = 'status';
    else if (arg === '--stop') mode = 'stop';
    else if (arg === '--json') json = true;
    else if (arg === '--timeout') {
      const seconds = Number(argv[++i]);
      if (!Number.isFinite(seconds) || seconds <= 0)
        throw new Error('--timeout expects a positive number of seconds');
      timeoutMs = seconds * 1000;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'Usage: npx tsx scripts/ensure-dev.ts [--status|--stop] [--timeout <s>] [--json]\n',
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return { mode, timeoutMs, json };
}

const log = (message: string): void => {
  process.stderr.write(`[ensure-dev] ${message}\n`);
};

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === 'stop') {
    await stopDevServer(log);
    return 0;
  }

  if (args.mode === 'status') {
    const [health, dbUp] = await Promise.all([checkHealth(10_000), isPortOpen(DB_PORT)]);
    const report = {
      url: baseUrl(),
      app: health,
      database: { port: DB_PORT, listening: dbUp },
      log: DEV_LOG_FILE,
    };
    if (args.json) process.stdout.write(`${JSON.stringify(report)}\n`);
    else {
      process.stdout.write(`app      ${baseUrl()}  ${health.state.toUpperCase()}  (${health.detail})\n`);
      process.stdout.write(`database :${DB_PORT}  ${dbUp ? 'LISTENING' : 'DOWN'}\n`);
    }
    return health.state === 'ok' ? 0 : 1;
  }

  const started = Date.now();
  const result = await ensureDevServer({ timeoutMs: args.timeoutMs, log });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ...result, seconds: Number(seconds) })}\n`);
  } else {
    const actions = [
      result.startedDatabase ? 'started database' : null,
      result.startedServer ? `started dev server (pid ${result.pid})` : null,
    ].filter(Boolean);
    process.stdout.write(
      `READY ${result.url}  version=${result.health.version ?? '?'} db=${result.health.dbLatencyMs ?? '?'}ms ` +
        `${actions.length > 0 ? actions.join(', ') : 'already running'} (${seconds}s)\n`,
    );
  }
  return 0;
}

// Set exitCode rather than calling process.exit(): exiting while undici sockets are still
// closing trips a libuv assertion on Windows (Node 24) and turns success into exit 127.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`[ensure-dev] FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
