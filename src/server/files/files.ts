/**
 * File storage (BUILD_PLAN F6 `files.ts`).
 *
 * - Bytes go through a `BlobStorage` adapter: local disk at `.data/files/<id>` by default
 *   (override the root with `KITSTAK_FILES_DIR`), or Supabase Storage (private bucket
 *   `wms-files`, object key = file id) when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set
 *   (Vercel has no persistent disk). The `files` row keeps name, sniffed mime, size and sha256.
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
  export: { maxBytes: MAX_GENERATED_BYTES, mimes: [MIME.xlsx, MIME.csv], description: "an Excel (.xlsx) or CSV file" }, // CSV: scheduled report deliveries (M13)
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

/** Where file bytes live. Keys are file ids (UUIDs). */
export interface BlobStorage {
  readonly kind: "local" | "supabase";
  /** Stores the bytes; returns the value kept in `files.storage_path`. */
  put(key: string, bytes: Uint8Array, mime: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  /** Best effort; never throws for a missing object. */
  remove(key: string): Promise<void>;
}

export interface FileStoreOptions {
  /** Absolute directory for file bytes (local storage). */
  readonly root?: string;
  readonly now?: () => Date;
  /** Explicit adapter (tests); default: Supabase Storage when configured, else local disk at `root`. */
  readonly storage?: BlobStorage;
}

export const SUPABASE_FILES_BUCKET = "wms-files";

type Env = Readonly<Record<string, string | undefined>>;

/** Supabase Storage is used when both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set. */
export function supabaseStorageConfigured(env: Env = process.env): boolean {
  return Boolean(env.SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

/** Local-disk adapter: `<root>/<id>`, written atomically (temp file + rename). */
export function localBlobStorage(root: string): BlobStorage {
  const absolutePath = (id: string): string => {
    if (!UUID_RE.test(id)) throw notFoundError("File");
    const resolved = path.resolve(/* turbopackIgnore: true */ root, id);
    if (path.dirname(resolved) !== path.resolve(/* turbopackIgnore: true */ root)) throw notFoundError("File");
    return resolved;
  };
  return {
    kind: "local",
    async put(id, bytes) {
      fs.mkdirSync(/* turbopackIgnore: true */ root, { recursive: true });
      const target = absolutePath(id);
      const temp = `${target}.tmp`;
      fs.writeFileSync(/* turbopackIgnore: true */ temp, bytes, { flag: "wx" });
      fs.renameSync(/* turbopackIgnore: true */ temp, target);
      return path.relative(process.cwd(), target).split(path.sep).join("/");
    },
    async get(id) {
      return fs.readFileSync(/* turbopackIgnore: true */ absolutePath(id));
    },
    async remove(id) {
      try {
        fs.rmSync(/* turbopackIgnore: true */ absolutePath(id), { force: true });
      } catch {
        // Best effort: an orphaned blob is harmless and swept by deleteExpired on next run.
      }
    },
  };
}

/** Supabase Storage adapter (private bucket, service-role key; server only). */
export function supabaseBlobStorage(env: Env = process.env, bucket: string = SUPABASE_FILES_BUCKET): BlobStorage {
  type Client = ReturnType<typeof import("@supabase/supabase-js").createClient>;
  let client: Promise<Client> | undefined;
  const storage = async () => {
    client ??= import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(env.SUPABASE_URL ?? "", env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false, autoRefreshToken: false } }),
    );
    return (await client).storage;
  };
  const checkKey = (id: string): void => {
    if (!UUID_RE.test(id)) throw notFoundError("File");
  };
  return {
    kind: "supabase",
    async put(id, bytes, mime) {
      checkKey(id);
      const s = await storage();
      const upload = () => s.from(bucket).upload(id, bytes, { contentType: mime, upsert: false });
      let { error } = await upload();
      if (error && /bucket not found/i.test(error.message)) {
        await s.createBucket(bucket, { public: false });
        ({ error } = await upload());
      }
      if (error) throw new AppError("INTERNAL", "The file could not be stored", { cause: error });
      return `supabase://${bucket}/${id}`;
    },
    async get(id) {
      checkKey(id);
      const { data, error } = await (await storage()).from(bucket).download(id);
      if (error || !data) throw new AppError("NOT_FOUND", "File content is no longer available", { cause: error ?? undefined });
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(id) {
      if (!UUID_RE.test(id)) return;
      try {
        await (await storage()).from(bucket).remove([id]);
      } catch {
        // Best effort, as on disk.
      }
    },
  };
}

/**
 * Vercel has a read-only, non-persistent file system: without Supabase Storage every write
 * would fail with an opaque EROFS. Writes fail with a clear configuration error instead.
 */
function unconfiguredServerlessStorage(local: BlobStorage): BlobStorage {
  const error = (): AppError =>
    new AppError("INTERNAL", "File storage is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Vercel has no persistent disk)");
  return {
    kind: "local",
    async put() {
      throw error();
    },
    get: (id) => local.get(id),
    remove: (id) => local.remove(id),
  };
}

/** The default adapter for this environment. */
export function defaultBlobStorage(root: string = defaultFilesRoot(), env: Env = process.env): BlobStorage {
  if (supabaseStorageConfigured(env)) return supabaseBlobStorage(env);
  const local = localBlobStorage(root);
  return env.VERCEL && !env.KITSTAK_FILES_DIR?.trim() ? unconfiguredServerlessStorage(local) : local;
}

export function defaultFilesRoot(): string {
  return process.env.KITSTAK_FILES_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "files");
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
  readonly storage: BlobStorage;
  store(db: AppDb, input: StoreFileInput): Promise<FileRecord>;
  get(db: AppDb, id: string): Promise<FileRecord>;
  read(db: AppDb, id: string): Promise<{ readonly record: FileRecord; readonly bytes: Buffer }>;
  remove(db: AppDb, id: string): Promise<void>;
  deleteExpired(db: AppDb): Promise<number>;
}

export function createFileStore(options: FileStoreOptions = {}): FileStore {
  const root = options.root ?? defaultFilesRoot();
  const now = options.now ?? (() => new Date());
  // An explicit root (tests) always means local disk.
  const storage = options.storage ?? (options.root ? localBlobStorage(root) : defaultBlobStorage(root));

  const get = async (db: AppDb, id: string): Promise<FileRecord> => {
    const row = (await db.select().from(files).where(eq(files.id, id)).limit(1))[0];
    if (!row) throw notFoundError("File");
    return row;
  };

  const store = async (db: AppDb, input: StoreFileInput): Promise<FileRecord> => {
    const name = sanitizeFileName(input.name);
    const mime = validateFile(input.purpose, name, input.bytes);
    const id = randomUUID();
    const storagePath = await storage.put(id, input.bytes, mime);
    try {
      const [row] = await db.insert(files).values({
        id,
        name,
        mime,
        size: input.bytes.length,
        sha256: sha256Hex(input.bytes),
        storagePath,
        ownerEntityType: input.ownerEntityType ?? null,
        ownerEntityId: input.ownerEntityId ?? null,
        uploadedBy: input.uploadedBy ?? null,
        createdAt: now().toISOString(),
        expiresAt: input.expiresAt === undefined ? defaultExpiry(input.purpose, now()) : input.expiresAt,
      }).returning();
      if (!row) throw new Error("files insert returned no row");
      return row;
    } catch (error: unknown) {
      await storage.remove(id);
      throw error;
    }
  };

  const read = async (db: AppDb, id: string): Promise<{ record: FileRecord; bytes: Buffer }> => {
    const record = await get(db, id);
    if (record.expiresAt && record.expiresAt <= now().toISOString()) throw notFoundError("File");
    try {
      return { record, bytes: await storage.get(id) };
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      throw new AppError("NOT_FOUND", "File content is no longer available", { cause: error });
    }
  };

  const remove = async (db: AppDb, id: string): Promise<void> => {
    await db.update(backgroundTasks).set({ fileId: null }).where(eq(backgroundTasks.fileId, id));
    await db.delete(files).where(eq(files.id, id));
    if (!UUID_RE.test(id)) throw notFoundError("File");
    await storage.remove(id);
  };

  const deleteExpired = async (db: AppDb): Promise<number> => {
    const cutoff = now().toISOString();
    const expired = await db.select({ id: files.id }).from(files)
      .where(and(isNotNull(files.expiresAt), lte(files.expiresAt, cutoff)));
    for (const row of expired) await remove(db, row.id);
    return expired.length;
  };

  return { root, storage, store, get, read, remove, deleteExpired };
}

let defaultStore: FileStore | undefined;

/** Process-wide store (`.data/files` locally, Supabase Storage when configured). */
export function fileStore(): FileStore {
  defaultStore ??= createFileStore();
  return defaultStore;
}
