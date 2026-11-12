/**
 * Create-job modal model (BUILD_PLAN F4.4). PURE.
 */
import { z } from 'zod';
import type { JobOperation } from './contracts';

export const MAX_BATCH_SIZE = 1000;

export const OPERATION_NOUNS: Readonly<
  Record<JobOperation, { readonly one: string; readonly many: string }>
> = {
  order: { one: 'order', many: 'orders' },
  // The shipment-plan operation counts and receives the plans' orders (shipping R9-2).
  'shipment-plan': { one: 'order', many: 'orders' },
  'work-order': { one: 'work order', many: 'work orders' },
  count: { one: 'count plan', many: 'count plans' },
};

export function nounFor(operation: JobOperation, count: number): string {
  const n = OPERATION_NOUNS[operation];
  return count === 1 ? n.one : n.many;
}

/** Splits `count` records into job batches of at most `batchSize`. */
export function planJobBatches(count: number, batchSize: number): readonly number[] {
  if (count <= 0 || !Number.isInteger(batchSize) || batchSize < 1) return [];
  const full = Math.floor(count / batchSize);
  const rest = count % batchSize;
  return [...Array.from({ length: full }, () => batchSize), ...(rest ? [rest] : [])];
}

export const createJobFormSchema = z.object({
  jobTypeId: z.string({ message: 'Choose a job type' }).min(1, 'Choose a job type'),
  batchSize: z
    .number({ message: 'Enter a batch size' })
    .int('Whole numbers only')
    .min(1, 'At least 1')
    .max(MAX_BATCH_SIZE, `At most ${MAX_BATCH_SIZE}`),
  assigneeUserId: z.string().nullable(),
});
export type CreateJobForm = z.infer<typeof createJobFormSchema>;

export function createJobReason(form: {
  readonly jobTypeId: string | null;
  readonly batchSize: number | null;
  readonly assigneeUserId: string | null;
}): string | null {
  const parsed = createJobFormSchema.safeParse(form);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Complete the form');
}
