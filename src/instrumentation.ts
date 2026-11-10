/**
 * Next.js instrumentation hook — runs once per server instance before requests.
 *
 * Starts the in-process scheduler (F6) in the Node.js runtime only; the Edge
 * runtime (proxy) has no SQLite access. The Node-only work lives in
 * `instrumentation-node.ts` behind a dynamic import so the scheduler, its native
 * dependencies and Node APIs never enter the Edge bundle.
 */

export function shouldStartScheduler(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.NEXT_RUNTIME === "nodejs" && env.SCHEDULER_ENABLED !== "0";
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !shouldStartScheduler(process.env)) {
    return;
  }
  const { startNodeScheduler } = await import("./instrumentation-node");
  await startNodeScheduler();
}
