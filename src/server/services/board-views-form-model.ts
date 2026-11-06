/**
 * Board form model (Form view ↔ public form). PURE and CLIENT-SAFE: the builder, the public
 * renderer and the submit endpoint all share these schemas, the question/column mapping,
 * conditional logic and answer → cell value conversion.
 *
 * The form lives in `view.config.form`. Only the publish endpoint mints `token`.
 */
import { z } from 'zod';
import { labelColorSchema, type Label, type LabelColor } from '@/server/db/schema/column-types';
import { validateCellValue, type ColumnType } from '@/server/db/schema/cell-values';

export const FORM_QUESTION_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
  'name',
  'text',
  'long_text',
  'number',
  'currency',
  'email',
  'phone',
  'link',
  'date',
  'timeline',
  'status',
  'dropdown',
  'checkbox',
  'rating',
  'tags',
  'location',
]);

export const NAME_QUESTION_KEY = 'name';

const conditionSchema = z.object({
  columnKey: z.string().max(64),
  operator: z.enum(['is', 'is_not', 'contains', 'is_empty', 'is_not_empty']),
  value: z.string().max(200).optional(),
});
export type FormCondition = z.infer<typeof conditionSchema>;

export const formQuestionSchema = z.object({
  columnKey: z.string().max(64),
  label: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  required: z.boolean().default(false),
  hidden: z.boolean().default(false),
  placeholder: z.string().max(200).optional(),
  condition: conditionSchema.nullish(),
});
export type FormQuestion = z.infer<typeof formQuestionSchema>;

export const formSettingsSchema = z.object({
  title: z.string().max(200).default(''),
  description: z.string().max(4000).default(''),
  accent: labelColorSchema.default('blue'),
  align: z.enum(['left', 'center']).default('left'),
  questions: z.array(formQuestionSchema).max(100).default([]),
  submitLabel: z.string().max(60).default('Submit'),
  thankYouTitle: z.string().max(200).default('Thanks — we got it!'),
  thankYouMessage: z.string().max(2000).default('Your response was recorded. Someone from the team will follow up shortly.'),
  allowAnother: z.boolean().default(true),
  redirectUrl: z.string().max(2048).nullish(),
  groupId: z.string().max(64).nullish(),
  hideBranding: z.boolean().default(false),
  closed: z.boolean().default(false),
  closeAt: z.string().max(10).nullish(),
  maxResponses: z.number().int().min(1).max(1_000_000).nullish(),
  responseCount: z.number().int().min(0).default(0),
  published: z.boolean().default(false),
  token: z.string().max(80).nullish(),
});
export type FormSettings = z.infer<typeof formSettingsSchema>;

export interface FormColumn {
  readonly key: string;
  readonly title: string;
  readonly type: ColumnType;
  readonly settings: unknown;
  readonly description?: string | null;
}

export function isFormColumn(column: Pick<FormColumn, 'type'>): boolean {
  return FORM_QUESTION_TYPES.has(column.type);
}

/** Parse stored settings; seeds questions from the board columns when none exist yet. */
export function parseFormSettings(raw: unknown, columns: readonly FormColumn[], fallbackTitle = ''): FormSettings {
  const parsed = formSettingsSchema.safeParse(raw ?? {});
  const settings = parsed.success ? parsed.data : formSettingsSchema.parse({});
  const known = new Map(columns.filter(isFormColumn).map((column) => [column.key, column]));
  let questions = settings.questions.filter((question) => known.has(question.columnKey));
  if (!questions.some((question) => question.columnKey === NAME_QUESTION_KEY)) {
    questions = [{ columnKey: NAME_QUESTION_KEY, required: true, hidden: false }, ...questions];
  }
  if (settings.questions.length === 0) {
    const seeded = columns
      .filter((column) => isFormColumn(column) && column.type !== 'name')
      .slice(0, 5)
      .map((column) => ({ columnKey: column.key, required: false, hidden: false }));
    questions = [...questions, ...seeded];
  }
  // The name question is always required and visible.
  questions = questions.map((question) =>
    question.columnKey === NAME_QUESTION_KEY ? { ...question, required: true, hidden: false, condition: null } : question,
  );
  return { ...settings, title: settings.title || fallbackTitle, questions };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function labelsOf(settings: unknown): Label[] {
  if (!isRecord(settings) || !Array.isArray(settings.labels)) return [];
  return (settings.labels as Label[])
    .filter((label) => isRecord(label) && typeof label.id === 'string' && !label.isDefault)
    .sort((a, b) => a.position - b.position);
}

export type FormAnswers = Readonly<Record<string, unknown>>;

function answerText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (value === true) return 'true';
  if (value === false || value === undefined || value === null) return '';
  if (isRecord(value)) return Object.values(value).map(String).join(' ');
  return String(value);
}

/** Whether a conditional question is shown for the current answers. */
export function isQuestionVisible(question: FormQuestion, answers: FormAnswers): boolean {
  if (question.hidden) return false;
  const condition = question.condition;
  if (!condition) return true;
  const raw = answers[condition.columnKey];
  const text = answerText(raw).toLowerCase();
  const target = (condition.value ?? '').toLowerCase();
  const values = Array.isArray(raw) ? raw.map((entry) => String(entry).toLowerCase()) : [text];
  switch (condition.operator) {
    case 'is':
      return values.includes(target);
    case 'is_not':
      return !values.includes(target);
    case 'contains':
      return text.includes(target);
    case 'is_empty':
      return text.trim() === '';
    case 'is_not_empty':
      return text.trim() !== '';
  }
}

export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.values(value).every(isBlank);
  return false;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Convert one raw answer to a stored cell value (or an error message). */
export function answerToCell(column: FormColumn, raw: unknown): { value: unknown } | { error: string } {
  const settings = isRecord(column.settings) ? column.settings : {};
  const text = typeof raw === 'string' ? raw.trim() : raw;
  let value: unknown;
  switch (column.type) {
    case 'name':
    case 'text':
    case 'long_text':
      value = typeof text === 'string' ? text : String(text ?? '');
      break;
    case 'number':
    case 'currency': {
      const number = typeof text === 'number' ? text : Number(String(text).replace(/[, $€£]/g, ''));
      if (!Number.isFinite(number)) return { error: 'Enter a number' };
      value =
        column.type === 'currency'
          ? { amount: number, currency: typeof settings.currency === 'string' ? settings.currency : 'USD' }
          : number;
      break;
    }
    case 'email':
      if (typeof text !== 'string' || !EMAIL_RE.test(text)) return { error: 'Enter a valid email address' };
      value = { email: text };
      break;
    case 'phone':
      value = { phone: String(text) };
      break;
    case 'link': {
      const url = String(text);
      const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      value = { url: withScheme };
      break;
    }
    case 'date':
      value = { date: String(text) };
      break;
    case 'timeline': {
      const range = isRecord(raw) ? raw : {};
      value = { from: String(range.from ?? ''), to: String(range.to ?? range.from ?? '') };
      break;
    }
    case 'status': {
      const id = String(text);
      if (!labelsOf(settings).some((label) => label.id === id)) return { error: 'Choose one of the options' };
      value = { labelId: id };
      break;
    }
    case 'dropdown': {
      const ids = (Array.isArray(raw) ? raw : [raw]).map(String);
      const allowed = new Set(labelsOf(settings).map((label) => label.id));
      if (ids.some((id) => !allowed.has(id))) return { error: 'Choose from the listed options' };
      value = { labelIds: ids };
      break;
    }
    case 'checkbox':
      value = raw === true || raw === 'true' || raw === 'on';
      break;
    case 'rating': {
      const max = typeof settings.max === 'number' ? settings.max : 5;
      const rating = Number(raw);
      if (!Number.isInteger(rating) || rating < 1 || rating > max) return { error: `Pick 1 to ${max}` };
      value = rating;
      break;
    }
    case 'tags': {
      const tags = (Array.isArray(raw) ? raw.map(String) : String(raw).split(','))
        .map((tag) => tag.trim())
        .filter(Boolean);
      value = { tags: [...new Set(tags)].slice(0, 100) };
      break;
    }
    case 'location':
      value = { address: String(text) };
      break;
    default:
      return { error: 'This question type cannot be answered here' };
  }
  if (column.type === 'name') return String(value).length > 0 ? { value } : { error: 'This field is required' };
  const checked = validateCellValue(column.type, value);
  if (!checked.ok) return { error: column.type === 'link' ? 'Enter a valid web address' : column.type === 'phone' ? 'Enter a valid phone number' : 'Check this answer' };
  return { value: checked.value };
}

export type SubmissionResult =
  | { readonly ok: true; readonly name: string; readonly values: Record<string, unknown> }
  | { readonly ok: false; readonly errors: Record<string, string> };

/**
 * Validate a full submission. Only visible, configured questions are read, so a crafted
 * payload can never write a column that isn't on the form.
 */
export function answersToValues(
  questions: readonly FormQuestion[],
  columns: readonly FormColumn[],
  answers: FormAnswers,
): SubmissionResult {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const errors: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  let name = '';
  for (const question of questions) {
    const column = byKey.get(question.columnKey);
    if (!column || !isFormColumn(column) || !isQuestionVisible(question, answers)) continue;
    const raw = answers[question.columnKey];
    const required = question.required || column.type === 'name';
    if (isBlank(raw) || (column.type === 'checkbox' && raw !== true && required)) {
      if (required) errors[question.columnKey] = column.type === 'checkbox' ? 'Please confirm to continue' : 'This field is required';
      continue;
    }
    const result = answerToCell(column, raw);
    if ('error' in result) {
      errors[question.columnKey] = result.error;
      continue;
    }
    if (column.type === 'name') name = String(result.value);
    else values[column.key] = result.value;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, name: name.slice(0, 500), values };
}

/** Why a published form refuses responses (null = open). */
export function formClosedReason(settings: FormSettings, today: string): string | null {
  if (settings.closed) return 'closed';
  if (settings.closeAt && today > settings.closeAt) return 'expired';
  if (settings.maxResponses && settings.responseCount >= settings.maxResponses) return 'full';
  return null;
}

/** Safe redirect target (http/https only). */
export function safeRedirect(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

// Public DTOs ------------------------------------------------------------------------------------

export interface PublicFormQuestionDto {
  readonly key: string;
  readonly type: ColumnType;
  readonly label: string;
  readonly description: string | null;
  readonly required: boolean;
  readonly placeholder: string | null;
  readonly options: readonly { id: string; name: string; color: LabelColor }[];
  readonly max: number | null;
  readonly currency: string | null;
  /** Number unit affix (e.g. "%"), with its side. */
  readonly unit: { readonly text: string; readonly position: 'prefix' | 'suffix' } | null;
  readonly condition: FormCondition | null;
}

export interface PublicFormDto {
  readonly title: string;
  readonly description: string;
  readonly accent: LabelColor;
  readonly align: 'left' | 'center';
  readonly submitLabel: string;
  readonly thankYouTitle: string;
  readonly thankYouMessage: string;
  readonly allowAnother: boolean;
  readonly redirectUrl: string | null;
  readonly hideBranding: boolean;
  readonly closedReason: string | null;
  readonly questions: readonly PublicFormQuestionDto[];
  /** Server-signed render stamp; echo it back on submit (time trap). */
  readonly renderToken?: string;
}

function numberUnit(type: ColumnType, settings: Record<string, unknown>): PublicFormQuestionDto['unit'] {
  if (type !== 'number') return null;
  const position = settings.unitPosition === 'prefix' ? 'prefix' : 'suffix';
  if (typeof settings.unit === 'string' && settings.unit.trim()) return { text: settings.unit.trim(), position };
  return settings.format === 'percent' ? { text: '%', position: 'suffix' } : null;
}

/** The public projection of a form: only what a respondent needs to see. */
export function toPublicForm(settings: FormSettings, columns: readonly FormColumn[], today: string): PublicFormDto {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const questions: PublicFormQuestionDto[] = [];
  for (const question of settings.questions) {
    const column = byKey.get(question.columnKey);
    if (!column || !isFormColumn(column) || question.hidden) continue;
    const columnSettings = isRecord(column.settings) ? column.settings : {};
    questions.push({
      key: column.key,
      type: column.type,
      label: question.label?.trim() || column.title,
      description: question.description?.trim() || null,
      required: question.required || column.type === 'name',
      placeholder: question.placeholder?.trim() || null,
      options: labelsOf(column.settings).map((label) => ({ id: label.id, name: label.name || 'Untitled', color: label.color })),
      max: column.type === 'rating' ? (typeof columnSettings.max === 'number' ? columnSettings.max : 5) : null,
      currency: column.type === 'currency' ? (typeof columnSettings.currency === 'string' ? columnSettings.currency : 'USD') : null,
      unit: numberUnit(column.type, columnSettings),
      condition: question.condition ?? null,
    });
  }
  return {
    title: settings.title || 'Untitled form',
    description: settings.description,
    accent: settings.accent,
    align: settings.align,
    submitLabel: settings.submitLabel || 'Submit',
    thankYouTitle: settings.thankYouTitle,
    thankYouMessage: settings.thankYouMessage,
    allowAnother: settings.allowAnother,
    redirectUrl: safeRedirect(settings.redirectUrl),
    hideBranding: settings.hideBranding,
    closedReason: formClosedReason(settings, today),
    questions,
  };
}

export const publicSubmissionSchema = z.object({
  answers: z.record(z.string().max(64), z.unknown()).refine((value) => Object.keys(value).length <= 100, 'Too many answers'),
  /** Honeypot: real people never see or fill this field. */
  website: z.string().max(500).optional(),
  /** Server-signed render stamp from the GET (time trap; verified server side). */
  renderToken: z.string().max(200).optional(),
  /** Legacy client hint; ignored by the server (the signed render stamp is authoritative). */
  elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
});
export type PublicSubmission = z.infer<typeof publicSubmissionSchema>;

/** Minimum human fill time and maximum age of a render stamp. */
export const MIN_FILL_MS = 1200;
export const MAX_RENDER_AGE_MS = 86_400_000;

/**
 * Bot heuristics: honeypot filled, or the server-verified fill time is missing / too fast /
 * stale. `elapsedMs` is the value the server derived from the signed render stamp (null when the
 * stamp is absent or invalid), never a client-supplied number.
 */
export function looksAutomated(input: Pick<PublicSubmission, 'website'>, verifiedElapsedMs: number | null): boolean {
  if (input.website && input.website.trim().length > 0) return true;
  if (verifiedElapsedMs === null) return true;
  return verifiedElapsedMs < MIN_FILL_MS || verifiedElapsedMs > MAX_RENDER_AGE_MS;
}

// Server-owned form keys -------------------------------------------------------------------------

/** Keys inside `view.config.form` that only the publish endpoint / submit counter may write. */
export const SERVER_FORM_KEYS = ['token', 'published', 'responseCount'] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Guard a view-config write: `config.form` is deep-merged onto the stored form and the
 * server-owned keys (token, published, responseCount) always keep their stored values, so a
 * PATCH can neither forge / copy a public token nor reset the response counter.
 * `merge` mirrors the PATCH `mergeConfig` flag (shallow top-level merge vs replace).
 */
export function guardViewConfigWrite(
  previous: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
  merge: boolean,
): Record<string, unknown> {
  const prev = previous ?? {};
  const next: Record<string, unknown> = merge ? { ...prev, ...incoming } : { ...incoming };
  const prevForm = asRecord(prev.form);
  const incomingForm = asRecord(incoming.form);
  if (!prevForm && !incomingForm) {
    if ('form' in incoming) delete next.form;
    return next;
  }
  const base = merge && prevForm ? { ...prevForm, ...(incomingForm ?? {}) } : { ...(incomingForm ?? prevForm ?? {}) };
  for (const key of SERVER_FORM_KEYS) {
    if (prevForm && key in prevForm) base[key] = prevForm[key];
    else delete base[key];
  }
  next.form = base;
  return next;
}

/** A brand-new view never inherits a public token (e.g. duplicating a published form). */
export function stripServerFormKeys(config: Record<string, unknown>): Record<string, unknown> {
  const form = asRecord(config.form);
  if (!form) return config;
  const clean = { ...form };
  for (const key of SERVER_FORM_KEYS) delete clean[key];
  return { ...config, form: clean };
}

/** Resolve a public token to exactly one form; zero or several matches fail closed. */
export function pickUniqueForm<T>(rows: readonly T[]): T | null {
  return rows.length === 1 ? (rows[0] ?? null) : null;
}
