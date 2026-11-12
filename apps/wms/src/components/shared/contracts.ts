/**
 * Client-side contracts for the foundation API routes the shared components call
 * (BUILD_PLAN F7). Responses are parsed with zod at the boundary; unknown extra fields
 * pass through untouched. PURE (no React).
 */
import { z } from 'zod';

const nullishString = z.string().nullish();

/* ---------------- change log (/api/change-log?entityType&entityId&page&ps) ---------------- */
export const changeLogEntrySchema = z.object({
  id: z.string(),
  type: z.enum(['Create', 'Update', 'Delete']),
  field: nullishString,
  fieldLabel: nullishString,
  fromValue: nullishString,
  toValue: nullishString,
  message: z.string(),
  source: z.string(),
  at: z.string(),
  entityCode: nullishString,
  parentEntityType: nullishString,
  parentEntityId: nullishString,
  /** Line-level prefix (SKU) when the entry belongs to a line. */
  lineLabel: nullishString,
  /** Acting user's display name (the stored source stays the tooltip). */
  userName: nullishString,
});
export type ChangeLogEntry = z.infer<typeof changeLogEntrySchema>;

/* ---------------- tags (/api/tags, /api/tags/apply) ---------------- */
export const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  scope: z.string().default('any'),
});
export type Tag = z.infer<typeof tagSchema>;
export const TAG_NAME_MAX = 30;
export type TagApplyMode = 'add' | 'remove' | 'set';

/* ---------------- custom fields (/api/custom-fields?entityType=) ---------------- */
export const customFieldDefSchema = z.object({
  id: z.string(),
  entityType: z.string(),
  slot: z.string(),
  name: z.string(),
  options: z.array(z.string()).nullish(),
  isActive: z.boolean().default(true),
});
export type CustomFieldDef = z.infer<typeof customFieldDefSchema>;

/* ---------------- attachments + notes ---------------- */
export const attachmentSchema = z.object({
  id: z.string(),
  documentType: z.string(),
  fileId: z.string(),
  fileName: nullishString,
  mime: nullishString,
  size: z.number().nullish(),
  uploadedBy: nullishString,
  uploadedByName: nullishString,
  createdAt: z.string(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const noteSchema = z.object({
  id: z.string(),
  body: z.string(),
  userId: nullishString,
  userName: nullishString,
  createdAt: z.string(),
});
export type Note = z.infer<typeof noteSchema>;

/* ---------------- files (/api/files POST multipart → { id }) ---------------- */
export const uploadedFileSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  mime: z.string().optional(),
  size: z.number().optional(),
});
export function fileUrl(fileId: string, download = false): string {
  return `/api/files/${encodeURIComponent(fileId)}${download ? '?download=1' : ''}`;
}

/* ---------------- imports (/api/imports/[key]) ---------------- */
export const importBatchSchema = z.object({
  id: z.string(),
  status: z.string(),
  masterRowCount: z.number().default(0),
  successCount: z.number().default(0),
  errorCount: z.number().default(0),
  uploadedBy: nullishString,
  uploadedByName: nullishString,
  createdAt: z.string(),
  fileId: nullishString,
  errorFileId: nullishString,
});
export type ImportBatch = z.infer<typeof importBatchSchema>;

export const importRowSchema = z.object({
  rowNumber: z.number(),
  success: z.boolean(),
  message: nullishString,
  data: z.unknown().optional(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const importInfoSchema = z.object({
  key: z.string(),
  title: z.string(),
  description: nullishString,
  backHref: nullishString,
});
export type ImportInfo = z.infer<typeof importInfoSchema>;

/* ---------------- print (/api/print → { fileId }) ---------------- */
export const printTemplateSchema = z.object({
  id: z.string(),
  typeKey: z.string(),
  name: z.string(),
  description: z.string().default(''),
  printerType: z.string().optional(),
  isDefault: z.boolean().default(false),
  allClients: z.boolean().default(true),
  clientIds: z.array(z.string()).optional(),
});
export type PrintTemplate = z.infer<typeof printTemplateSchema>;
export const printResultSchema = z.object({ fileId: z.string(), mime: z.string().optional() });

/* ---------------- pickers (/api/pickers/<kind>?q=&limit=) ---------------- */
export const pickerItemSchema = z
  .object({ id: z.string(), label: z.string(), description: nullishString })
  .passthrough();
export type PickerItem = z.infer<typeof pickerItemSchema>;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Accepts both the product-pick shape and the `/api/pickers/products` option shape
 * `{ id, label: sku, sublabel: name, meta: { clientId, name, uom, imageUrl, isKit, atp? } }`.
 */
function fromPickerOption(raw: unknown): unknown {
  if (!isObj(raw) || 'sku' in raw || typeof raw.label !== 'string') return raw;
  const meta = isObj(raw.meta) ? raw.meta : {};
  return { ...meta, id: raw.id, sku: raw.label, name: meta.name ?? raw.sublabel ?? raw.label };
}

export const productPickSchema = z.preprocess(
  fromPickerOption,
  z.object({
    id: z.string(),
    sku: z.string(),
    name: z.string(),
    imageUrl: nullishString,
    atp: z.number().nullish(),
    uom: nullishString,
    clientId: nullishString,
  }),
);
export type ProductPick = z.infer<typeof productPickSchema>;

/* ---------------- jobs (/api/ops/jobs, /api/ops/jobs/eligibility) ---------------- */
export const JOB_OPERATIONS = ['order', 'shipment-plan', 'work-order', 'count'] as const;
export type JobOperation = (typeof JOB_OPERATIONS)[number];

export const jobTypeOptionSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string().nullish(),
  defaultBatchSize: z.number().int().positive().nullish(),
});
export type JobTypeOption = z.infer<typeof jobTypeOptionSchema>;

/** `POST /api/ops/jobs/eligibility { operation, ids }`. */
export const eligibilitySchema = z.object({
  total: z.number(),
  eligible: z.array(z.string()),
  ineligible: z
    .array(z.object({ id: z.string(), code: nullishString, recordCode: nullishString, reason: z.string() }))
    .default([]),
  /** Job types applicable to the eligible records (warehouse + operation). */
  jobTypes: z.array(jobTypeOptionSchema).default([]),
});
export type Eligibility = z.infer<typeof eligibilitySchema>;

export const mergeableJobSchema = z.object({
  id: z.string(),
  code: z.string(),
  jobType: z.string(),
  quantity: z.number().default(0),
  progress: z.number().default(0),
  assigneeName: nullishString,
  status: z.string().optional(),
});
export type MergeableJob = z.infer<typeof mergeableJobSchema>;

export const bulkResultSchema = z.object({
  succeeded: z.array(z.string()).default([]),
  failed: z.array(z.object({ id: z.string(), code: z.string(), message: z.string() })).default([]),
  jobIds: z.array(z.string()).optional(),
});
export type BulkResultData = z.infer<typeof bulkResultSchema>;

/** Parses a list payload; returns [] (never throws) when the shape is wrong. */
export function parseList<S extends z.ZodTypeAny>(schema: S, data: unknown): readonly z.infer<S>[] {
  const parsed = z.array(schema).safeParse(data);
  return parsed.success ? parsed.data : [];
}

/** "3 of 4 orders shipped · 1 failed" (BUILD_PLAN 0.2). */
export function bulkSummary(result: BulkResultData, noun: string, verb: string): string {
  const ok = result.succeeded.length;
  const all = ok + result.failed.length;
  const base = `${ok} of ${all} ${noun} ${verb}`;
  return result.failed.length ? `${base} · ${result.failed.length} failed` : base;
}
