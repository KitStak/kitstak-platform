/**
 * Time-ordered event queue for the history replay. Events run strictly by time (ties in
 * insertion order); handlers may schedule further events. Events after `endMs` are dropped,
 * which is how the replay "stops at now" and leaves work in progress.
 */
export type EventHandler = () => void | Promise<void>;

export interface DrainHooks {
  /** Called with the event time before each handler (the seed moves its clock here). */
  readonly before?: (at: number) => void;
  /** A failing event is reported and the replay continues. */
  readonly onError: (label: string, error: unknown) => void;
}

interface QueuedEvent {
  readonly at: number;
  readonly seq: number;
  readonly label: string;
  readonly run: EventHandler;
}

export interface EventQueue {
  /** Schedules `run` at `at`; returns false (and drops it) when `at` is after the end. */
  schedule(at: number, label: string, run: EventHandler): boolean;
  /** Runs every event in order until the queue is empty. Returns the number executed. */
  drain(hooks: DrainHooks): Promise<number>;
  readonly endMs: number;
  size(): number;
}

function before(a: QueuedEvent, b: QueuedEvent): boolean {
  return a.at < b.at || (a.at === b.at && a.seq < b.seq);
}

export function createEventQueue(endMs: number): EventQueue {
  const heap: QueuedEvent[] = [];
  let seq = 0;

  const swap = (i: number, j: number): void => {
    const t = heap[i];
    heap[i] = heap[j];
    heap[j] = t;
  };
  const up = (start: number): void => {
    let i = start;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(heap[i], heap[parent])) break;
      swap(i, parent);
      i = parent;
    }
  };
  const down = (start: number): void => {
    let i = start;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let best = i;
      if (l < heap.length && before(heap[l], heap[best])) best = l;
      if (r < heap.length && before(heap[r], heap[best])) best = r;
      if (best === i) return;
      swap(i, best);
      i = best;
    }
  };
  const pop = (): QueuedEvent | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop() as QueuedEvent;
    if (heap.length > 0) {
      heap[0] = last;
      down(0);
    }
    return top;
  };

  return {
    endMs,
    size: () => heap.length,
    schedule(at, label, run) {
      if (!Number.isFinite(at) || at > endMs) return false;
      heap.push({ at, seq: seq++, label, run });
      up(heap.length - 1);
      return true;
    },
    async drain(hooks) {
      let executed = 0;
      for (let ev = pop(); ev; ev = pop()) {
        try {
          hooks.before?.(ev.at);
          await ev.run();
        } catch (error) {
          hooks.onError(ev.label, error);
        }
        executed += 1;
      }
      return executed;
    },
  };
}
