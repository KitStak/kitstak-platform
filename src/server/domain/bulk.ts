/**
 * Bulk command runner (BUILD_PLAN 0.2): each id runs in its own savepoint, so one
 * failing record rolls back only its own writes and the rest still succeed.
 */
import { DomainError, describeError } from "./errors";
import { MAX_BULK_IDS, type BulkResult, type Tx } from "./types";
import { withWriteTx } from "../db/sql";

export async function runBulk(tx: Tx, ids: readonly string[], fn: (inner: Tx, id: string) => void | Promise<void>): Promise<BulkResult> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) throw new DomainError("VALIDATION", "Select at least one record");
  if (unique.length > MAX_BULK_IDS) throw new DomainError("VALIDATION", `At most ${MAX_BULK_IDS} records can be processed at once`);
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  for (const id of unique) {
    try {
      await withWriteTx(tx, async (inner) => { await fn(inner, id); });
      succeeded.push(id);
    } catch (error) {
      failed.push({ id, ...describeError(error) });
    }
  }
  return { succeeded, failed };
}
