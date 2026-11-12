/**
 * Per-automation serialized writes with "latest wins" bookkeeping. Rapid on/off toggles send
 * their PATCHes one after another (so the server ends in the last state the user chose) and
 * only the newest toggle may write its server response or roll back the cache.
 */
export interface ToggleQueue {
  /**
   * Register a new toggle for `id`; returns its sequence number. `previous` is the value shown
   * before this click: when no toggle is in flight it becomes the server-confirmed baseline.
   */
  begin(id: string, previous?: boolean): number;
  /** Record that one queued write settled (`server` = the value the server confirmed, if any). */
  settle(id: string, server?: boolean): void;
  /** The last server-confirmed value: what a failed burst must roll back to. */
  confirmed(id: string): boolean | undefined;
  isLatest(id: string, seq: number): boolean;
  /** Run `task` after every earlier task for `id` settled. */
  enqueue<T>(id: string, task: () => Promise<T>): Promise<T>;
}

export function createToggleQueue(): ToggleQueue {
  const latest = new Map<string, number>();
  const tails = new Map<string, Promise<unknown>>();
  const inflight = new Map<string, number>();
  const baseline = new Map<string, boolean>();
  return {
    begin(id, previous) {
      const seq = (latest.get(id) ?? 0) + 1;
      latest.set(id, seq);
      const pending = inflight.get(id) ?? 0;
      if (pending === 0 && previous !== undefined) baseline.set(id, previous);
      inflight.set(id, pending + 1);
      return seq;
    },
    settle(id, server) {
      inflight.set(id, Math.max(0, (inflight.get(id) ?? 1) - 1));
      if (server !== undefined) baseline.set(id, server);
    },
    confirmed(id) {
      return baseline.get(id);
    },
    isLatest(id, seq) {
      return latest.get(id) === seq;
    },
    enqueue(id, task) {
      const previous = tails.get(id) ?? Promise.resolve();
      const run = previous.then(task, task);
      const tail = run.catch(() => undefined);
      tails.set(id, tail);
      void tail.then(() => {
        if (tails.get(id) === tail) tails.delete(id);
      });
      return run;
    },
  };
}
