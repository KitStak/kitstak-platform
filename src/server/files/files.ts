/**
 * File storage (BUILD_PLAN F6 `files.ts`).
 *
 * - Bytes live at `.data/files/<id>` (override the root with `KITSTAK_FILES_DIR`); the
 *   `files` row keeps name, sniffed mime, size and sha256.
 * - Every write declares a `purpose`, whose policy caps the size and allows a mime set:
 *   attachments are images or PDF, imports are xlsx or csv (10 MB max for uploads).
 * - Export files expire after 7 days; `deleteExpiredFiles` removes them (scheduler task
 *   `exports-cleanup`).
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { AppError, notFoundError, validationError } from "@/server/api/errors";
import type { AppDb } from "@/server/api/db";
import { backgroundTasks, files } from "@/server/db/schema";
import { MIME, sniffMime } from "./mime";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_GENERATED_BYTES = 50 * 1024 * 1024;
export const EXPORT_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_NAME_LENGTH = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FILE_PURPOSES = ["attachment", "import", "export", "print", "import-errors"] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

export interface FilePolicy {
  readonly maxBytes: number;
  readonly mimes: readonly string[];
  readonly description: string;
}

export const FILE_POLICIES: Readonly<Record<FilePurpose, FilePolicy>> = {
  attachment: {
    maxBytes: MAX_UPLOAD_BYTES,
    mimes: [MIME.png, MIME.jpeg, MIME.gif, MIME.webp, MIME.pdf],
    description: "an image (PNG, JPEG, GIF, WebP) or a PDF",
  },
  import: { maxBytes: MAX_UPLOAD_BYTES, mimes: [MIME.xlsx, MIME.csv], description: "an Excel (.xlsx) or CSV file" },
  export: { maxBytes: MAX_GENERATED_BYTES, mimes: [MIME.xlsx], description: "an Excel (.xlsx) file" },
  "import-errors": { maxBytes: MAX_GENERATED_BYTES, mimes: [MIME.xlsx], description: "an Excel (.xlsx) file" },
  print: { maxBytes: MAX_GENERATED_BYTES, mimes: [MIME.pdf, MIME.zpl, MIME.png], description: "a PDF, ZPL or PNG file" },
};

export type FileRecord = typeof files.$inferSelect;

export interface StoreFileInput {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly purpose: FilePurpose;
  readonly ownerEntityType?: string | null;
  readonly ownerEntityId?: string | null;
  readonly uploadedBy?: string | null;
  /** ISO timestamp; defaults to now + 7 days for `export`, otherwise never. */
  readonly expiresAt?: string | null;
}

export interface FileStoreOptions {
  /** Absolute directory for file bytes. */
  readonly root?: string;
  readonly now?: () => Date;
}

export function defaultFilesRoot(): string {
  return process.env.KITSTAK_FILES_DIR ?? path.join(process.cwd(), ".data", "files");
}

/** Strips directories, control and reserved characters; keeps the extension. */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim();
  const safe = cleaned.replace(/^\.+/, "");
  if (safe.length === 0) return "file";
  if (safe.length <= MAX_NAME_LENGTH) return safe;
  const dot = safe.lastIndexOf(".");
  const ext = dot > 0 && safe.length - dot <= 10 ? safe.slice(dot) : "";
  return `${safe.slice(0, MAX_NAME_LENGTH - ext.length)}${ext}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Validates `bytes` against the purpose policy and returns the sniffed mime. */
export function validateFile(purpose: FilePurpose, name: string, bytes: Uint8Array): string {
  const policy = FILE_POLICIES[purpose];
  if (bytes.length === 0) throw validationError("The file is empty", { file: ["The file is empty"] });
  if (bytes.length > policy.maxBytes) {
    const mb = Math.round(policy.maxBytes / (1024 * 1024));
    throw validationError(`The file is larger than ${mb} MB`, { file: [`Maximum size is ${mb} MB`] });
  }
  const mime = sniffMime(bytes, name);
  if (!policy.mimes.includes(mime)) {
    throw validationError(`Unsupported file type: upload ${policy.description}`, {
      file: [`Upload ${policy.description}`],
    });
  }
  return mime;
}

function defaultExpiry(purpose: FilePurpose, now: Date): string | null {
  if (purpose === "export" || purpose === "print" || purpose === "import-errors") {
    return new Date(now.getTime() + EXPORT_RETENTION_DAYS * DAY_MS).toISOString();
  }
  return null;
}

export interface FileStore {
  readonly root: string;
  store(db: AppDb, input: StoreFileInput): FileRecord;
  get(db: AppDb, id: string): FileRecord;
  read(db: AppDb, id: string): { readonly record: FileRecord; readonly bytes: Buffer };
  remove(db: AppDb, id: string): void;
  deleteExpired(db: AppDb): number;
}

export function createFileStore(options: FileStoreOptions = {}): FileStore {
  const root = options.root ?? defaultFilesRoot();
  const now = options.now ?? (() => new Date());

  const absolutePath = (id: string): string => {
    if (!UUID_RE.test(id)) throw notFoundError("File");
    const resolved = path.resolve(/* turbopackIgnore: true */ root, id);
    if (path.dirname(resolved) !== path.resolve(/* turbopackIgnore: true */ root)) throw notFoundError("File");
    return resolved;
  };

  const writeBytes = (id: string, bytes: Uint8Array): string => {
    fs.mkdirSync(root, { recursive: true });
    const target = absolutePath(id);
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, bytes, { flag: "wx" });
    fs.renameSync(temp, target);
    return target;
  };

  const unlinkQuietly = (target: string): void => {
    try {
      fs.rmSync(target, { force: true });
    } catch {
      // Best effort: an orphaned blob is harmless and swept by deleteExpired on next run.
    }
  };

  const get = (db: AppDb, id: string): FileRecord => {
    const row = db.select().from(files).where(eq(files.id, id)).get();
    if (!row) throw notFoundError("File");
    return row;
  };

  const store = (db: AppDb, input: StoreFileInput): FileRecord => {
    const name = sanitizeFileName(input.name);
    const mime = validateFile(input.purpose, name, input.bytes);
    const id = randomUUID();
    const target = writeBytes(id, input.bytes);
    try {
      return db.insert(files).values({
        id,
        name,
        mime,
        size: input.bytes.length,
        sha256: sha256Hex(input.bytes),
        storagePath: path.relative(process.cwd(), target).split(path.sep).join("/"),
        ownerEntityType: input.ownerEntityType ?? null,
        ownerEntityId: input.ownerEntityId ?? null,
        uploadedBy: input.uploadedBy ?? null,
        createdAt: now().toISOString(),
        expiresAt: input.expiresAt === undefined ? defaultExpiry(input.purpose, now()) : input.expiresAt,
      }).returning().get();
    } catch (error: unknown) {
      unlinkQuietly(target);
      throw error;
    }
  };

  const read = (db: AppDb, id: string): { record: FileRecord; bytes: Buffer } => {
    const record = get(db, id);
    if (record.expiresAt && record.expiresAt <= now().toISOString()) throw notFoundError("File");
    try {
      return { record, bytes: fs.readFileSync(/* turbopackIgnore: true */ absolutePath(id)) };
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      throw new AppError("NOT_FOUND", "File content is no longer available", { cause: error });
    }
  };

  const remove = (db: AppDb, id: string): void => {
    db.update(backgroundTasks).set({ fileId: null }).where(eq(backgroundTasks.fileId, id)).run();
    db.delete(files).where(eq(files.id, id)).run();
    unlinkQuietly(absolutePath(id));
  };

  const deleteExpired = (db: AppDb): number => {
    const cutoff = now().toISOString();
    const expired = db.select({ id: files.id }).from(files)
      .where(and(isNotNull(files.expiresAt), lte(files.expiresAt, cutoff))).all();
    for (const row of expired) remove(db, row.id);
    return expired.length;
  };

  return { root, store, get, read, remove, deleteExpired };
}

let defaultStore: FileStore | undefined;

/** Process-wide store rooted at `.data/files`. */
export function fileStore(): FileStore {
  defaultStore ??= createFileStore();
  return defaultStore;
}
