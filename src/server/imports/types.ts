/**
 * Import framework contracts (BUILD_PLAN F6 `imports/`).
 *
 * Foundation owns the registry (title, back link, template columns, permission) and the
 * pipeline (parse → validate → chunked apply → `import_rows` → error file). Each module
 * owns its handler file under `handlers/` (0.6); until replaced a handler is a stub with
 * `configured: false`, and the import page shows "Not configured yet".
 */
import type { z } from "zod";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";

export const IMPORT_COLUMN_TYPES = ["text", "integer", "number", "boolean", "date", "enum"] as const;
export type ImportColumnType = (typeof IMPORT_COLUMN_TYPES)[number];

export interface ImportColumn {
  /** Property name handlers receive. */
  readonly key: string;
  /** Header text in the template (required columns get a trailing " *"). */
  readonly header: string;
  readonly type: ImportColumnType;
  readonly required?: boolean;
  /** Allowed values for `enum` columns (case-insensitive match, canonical casing kept). */
  readonly options?: readonly string[];
  readonly maxLength?: number;
  readonly min?: number;
  readonly max?: number;
  /** Example value for the template's sample row. */
  readonly example: string;
  /** Notes sheet description. */
  readonly description?: string;
}

export type ImportValue = string | number | boolean | null;
export type ImportRowValues = Readonly<Record<string, ImportValue>>;

export interface ImportApplyContext {
  /** Savepoint inside the chunk transaction: a failing row rolls back alone. */
  readonly db: AppDb;
  readonly auth: AuthContext;
  readonly actor: { readonly userId: string; readonly source: string };
  readonly batchId: string;
  readonly rowNumber: number;
}

export interface ImportApplyResult {
  readonly entityId?: string | null;
  readonly message?: string;
}

export interface ImportHandler {
  /** False for a 0.6 stub: uploads are refused with "not configured yet". */
  readonly configured: boolean;
  /** Owning module id (0.6). */
  readonly owner: string;
  /** Optional cross-field validation over the typed row (runs after column checks). */
  readonly rowSchema?: z.ZodType;
  /** Applies one valid row (synchronous: better-sqlite3 transaction). */
  apply(ctx: ImportApplyContext, row: ImportRowValues): ImportApplyResult;
}

export interface ImportDefinition {
  readonly key: string;
  readonly title: string;
  /** Helper text for the import page. */
  readonly description: string;
  readonly backHref: string;
  readonly backLabel: string;
  readonly permission: string;
  readonly templateColumns: readonly ImportColumn[];
  readonly handler: ImportHandler;
}

/** Thrown by stub handlers (BUILD_PLAN 0.6). Maps to INVALID_STATE in the envelope. */
export class NotImplementedError extends AppError {
  constructor(what: string) {
    super("INVALID_STATE", `${what} is not configured yet`);
    this.name = "NotImplementedError";
  }
}

/** Builds a 0.6 stub handler. */
export function createStubHandler(owner: string, what: string): ImportHandler {
  return {
    configured: false,
    owner,
    apply() {
      throw new NotImplementedError(what);
    },
  };
}
