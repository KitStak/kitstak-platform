/**
 * Coalesces widget insight requests into one batch request per (dashboard, filters).
 *
 * Every widget keeps its own React Query entry (so caching, refetch and per-widget states are
 * unchanged), but the fetches that start in the same tick travel together: a dashboard with
 * 17 widgets makes one round trip, and the server computes all of them from one dataset load.
 */
import type {
  InsightBatchDto,
  InsightDto,
  InsightFilters,
} from '@/server/services/contracts/dashboard-insights';
import type { WidgetType } from '@/server/services/contracts/dto';

export const BATCH_WINDOW_MS = 8;
export const MAX_BATCH = 60;

export interface BatchWidget {
  readonly key: string;
  readonly type: WidgetType;
  readonly config: Record<string, unknown>;
}

export type BatchSender = (
  dashboardId: string,
  body: { widgets: BatchWidget[]; filters: InsightFilters; fresh: boolean },
) => Promise<InsightBatchDto>;

interface Waiter {
  readonly widget: BatchWidget;
  readonly resolve: (value: InsightDto) => void;
  readonly reject: (error: Error) => void;
}

interface Queue {
  readonly dashboardId: string;
  readonly filters: InsightFilters;
  readonly fresh: boolean;
  readonly waiters: Waiter[];
}

export class InsightBatcher {
  private readonly queues = new Map<string, Queue>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private freshUntil = 0;

  constructor(
    private readonly send: BatchSender,
    private readonly now: () => number = Date.now,
  ) {}

  /** The next loads (within ~1.5s) bypass the server's short dataset cache. */
  markFresh(): void {
    this.freshUntil = this.now() + 1500;
  }

  load(dashboardId: string, filters: InsightFilters, widget: BatchWidget): Promise<InsightDto> {
    const fresh = this.now() < this.freshUntil;
    const queueKey = `${dashboardId}|${fresh ? 1 : 0}|${JSON.stringify(filters)}`;
    return new Promise<InsightDto>((resolve, reject) => {
      const queue = this.queues.get(queueKey) ?? { dashboardId, filters, fresh, waiters: [] };
      queue.waiters.push({ widget, resolve, reject });
      this.queues.set(queueKey, queue);
      if (this.timer === null) this.timer = setTimeout(() => this.flush(), BATCH_WINDOW_MS);
    });
  }

  private flush(): void {
    this.timer = null;
    const queues = [...this.queues.values()];
    this.queues.clear();
    for (const queue of queues) {
      for (let start = 0; start < queue.waiters.length; start += MAX_BATCH) {
        void this.dispatch(queue, queue.waiters.slice(start, start + MAX_BATCH));
      }
    }
  }

  private async dispatch(queue: Queue, waiters: readonly Waiter[]): Promise<void> {
    const unique = new Map<string, BatchWidget>();
    for (const waiter of waiters) unique.set(waiter.widget.key, waiter.widget);
    try {
      const response = await this.send(queue.dashboardId, {
        widgets: [...unique.values()],
        filters: queue.filters,
        fresh: queue.fresh,
      });
      for (const waiter of waiters) {
        const result = response.results[waiter.widget.key];
        if (result?.ok) waiter.resolve(result.data);
        else waiter.reject(new Error(result && !result.ok ? result.error : 'Widget data is missing'));
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('Could not load widget data');
      for (const waiter of waiters) waiter.reject(failure);
    }
  }
}
