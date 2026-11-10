/**
 * KitStaks grid query grammar (BUILD_PLAN 0.2) — parse + serialize. PURE (client-safe):
 * the same strings appear in page URLs, so filtered views are shareable deep links.
 *
 *   q=<text>&qm=eq|sw                quick search (Equal / Starts With; default sw)
 *   f.<field>=<op>:<value>           op ∈ in nin eq ct sw ew ex empty rng bool date
 *       in/nin   comma list (escape a literal comma as "\,")
 *       rng      <min>..<max> (either side optional)
 *       bool     true|false
 *       date     preset | custom:<from>..<to>  (see date-presets.ts)
 *       ex/empty no value ("f.notes=ex" or "f.notes=ex:")
 *   sort=<field>,-<field>            multi-sort; "-" = descending
 *   page=<n>                         1-based
 *   ps=<n>                           1..1000 (UI offers 100|300|500|700|1000)
 * A field may repeat (`f.qty=rng:1..&f.qty=rng:..9`); conditions are ANDed.
 */
import { GRID_FILTER_OPS, GRID_PAGE_SIZES, type GridFilterOp } from "@/lib/enums";
import { parseDateSpec, serializeDateSpec, type DateSpec } from "./date-presets";

export const QUICK_SEARCH_MODES = ["eq", "sw"] as const;
export type QuickSearchMode = (typeof QUICK_SEARCH_MODES)[number];

export const DEFAULT_PAGE_SIZE: number = GRID_PAGE_SIZES[0];
export const MAX_PAGE_SIZE = 1000;
export const MAX_FILTERS = 50;
export const MAX_SORTS = 5;
export const MAX_LIST_VALUES = 1000;
export const MAX_VALUE_LENGTH = 500;
export const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)?$/;

export type GridFilter =
  | { readonly field: string; readonly op: "in" | "nin"; readonly values: readonly string[] }
  | { readonly field: string; readonly op: "eq" | "ct" | "sw" | "ew"; readonly value: string }
  | { readonly field: string; readonly op: "ex" | "empty" }
  | { readonly field: string; readonly op: "rng"; readonly min?: string; readonly max?: string }
  | { readonly field: string; readonly op: "bool"; readonly value: boolean }
  | { readonly field: string; readonly op: "date"; readonly date: DateSpec };

export interface SortSpec {
  readonly field: string;
  readonly dir: "asc" | "desc";
}

export interface GridQuery {
  readonly q?: string;
  readonly qm: QuickSearchMode;
  readonly filters: readonly GridFilter[];
  readonly sort: readonly SortSpec[];
  readonly page: number;
  readonly pageSize: number;
}

export interface GridQueryIssue {
  readonly param: string;
  readonly message: string;
}

export interface GridQueryParseResult {
  readonly query: GridQuery;
  readonly issues: readonly GridQueryIssue[];
}

export const EMPTY_GRID_QUERY: GridQuery = { qm: "sw", filters: [], sort: [], page: 1, pageSize: DEFAULT_PAGE_SIZE };

type ParamSource = URLSearchParams | string | Readonly<Record<string, string | readonly string[] | undefined>>;

function toEntries(source: ParamSource): readonly (readonly [string, string])[] {
  if (typeof source === "string") return [...new URLSearchParams(source.startsWith("?") ? source.slice(1) : source).entries()];
  if (source instanceof URLSearchParams) return [...source.entries()];
  return Object.entries(source).flatMap(([k, v]) => (v === undefined ? [] : typeof v === "string" ? [[k, v] as const] : v.map((x) => [k, x] as const)));
}

function isFilterOp(value: string): value is GridFilterOp {
  return (GRID_FILTER_OPS as readonly string[]).includes(value);
}

/** Splits an in/nin list on unescaped commas. */
export function splitList(raw: string): string[] {
  const out: string[] = [];
  let current = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "\\" && raw[i + 1] === ",") {
      current += ",";
      i += 1;
    } else if (ch === ",") {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((v) => v.trim()).filter((v) => v.length > 0);
}

const escapeListValue = (v: string): string => v.replace(/,/g, "\\,");

/** Parses one `f.<field>` value. Returns the filter or an error message. */
export function parseFilter(field: string, raw: string): GridFilter | string {
  if (!FIELD_RE.test(field)) return `Unknown field name "${field}"`;
  const colon = raw.indexOf(":");
  const opText = colon < 0 ? raw : raw.slice(0, colon);
  const value = colon < 0 ? "" : raw.slice(colon + 1);
  if (!isFilterOp(opText)) return `Unknown operator "${opText}"`;
  if (value.length > MAX_VALUE_LENGTH * 10) return "Filter value is too long";
  switch (opText) {
    case "in":
    case "nin": {
      const values = splitList(value);
      if (values.length === 0) return "Select at least one value";
      if (values.length > MAX_LIST_VALUES) return `At most ${MAX_LIST_VALUES} values`;
      return { field, op: opText, values };
    }
    case "eq":
    case "ct":
    case "sw":
    case "ew":
      if (value.length === 0) return "Enter a value";
      if (value.length > MAX_VALUE_LENGTH) return "Filter value is too long";
      return { field, op: opText, value };
    case "ex":
    case "empty":
      return { field, op: opText };
    case "rng": {
      const sep = value.indexOf("..");
      if (sep < 0) return 'Range must look like "min..max"';
      const min = value.slice(0, sep).trim();
      const max = value.slice(sep + 2).trim();
      if (!min && !max) return "Enter a minimum or a maximum";
      return { field, op: "rng", ...(min ? { min } : {}), ...(max ? { max } : {}) };
    }
    case "bool":
      if (value !== "true" && value !== "false") return 'Use "true" or "false"';
      return { field, op: "bool", value: value === "true" };
    case "date": {
      const date = parseDateSpec(value);
      return date ? { field, op: "date", date } : `Invalid date filter "${value}"`;
    }
  }
}

function parseSort(raw: string, issues: GridQueryIssue[]): SortSpec[] {
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const specs: SortSpec[] = [];
  for (const part of parts.slice(0, MAX_SORTS)) {
    const desc = part.startsWith("-");
    const field = desc ? part.slice(1) : part.replace(/^\+/, "");
    if (!FIELD_RE.test(field)) {
      issues.push({ param: "sort", message: `Invalid sort field "${field}"` });
      continue;
    }
    if (!specs.some((s) => s.field === field)) specs.push({ field, dir: desc ? "desc" : "asc" });
  }
  if (parts.length > MAX_SORTS) issues.push({ param: "sort", message: `At most ${MAX_SORTS} sort fields` });
  return specs;
}

function parsePositiveInt(raw: string, max: number): number | null {
  if (!/^\d{1,7}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= max ? n : null;
}

/** Parses the grammar. Invalid parts are dropped and reported in `issues`. */
export function parseGridQuery(source: ParamSource): GridQueryParseResult {
  const issues: GridQueryIssue[] = [];
  const filters: GridFilter[] = [];
  let q: string | undefined;
  let qm: QuickSearchMode = "sw";
  let sort: SortSpec[] = [];
  let page = 1;
  let pageSize = DEFAULT_PAGE_SIZE;

  for (const [key, rawValue] of toEntries(source)) {
    if (key === "q") {
      const text = rawValue.trim();
      if (text.length > MAX_VALUE_LENGTH) issues.push({ param: "q", message: "Search text is too long" });
      else q = text || undefined;
    } else if (key === "qm") {
      if ((QUICK_SEARCH_MODES as readonly string[]).includes(rawValue)) qm = rawValue as QuickSearchMode;
      else issues.push({ param: "qm", message: 'Search mode must be "eq" or "sw"' });
    } else if (key === "sort") {
      sort = parseSort(rawValue, issues);
    } else if (key === "page") {
      const n = parsePositiveInt(rawValue, 1_000_000);
      if (n === null) issues.push({ param: "page", message: "Page must be a positive integer" });
      else page = n;
    } else if (key === "ps") {
      const n = parsePositiveInt(rawValue, MAX_PAGE_SIZE);
      if (n === null) issues.push({ param: "ps", message: `Page size must be between 1 and ${MAX_PAGE_SIZE}` });
      else pageSize = n;
    } else if (key.startsWith("f.")) {
      if (filters.length >= MAX_FILTERS) {
        issues.push({ param: key, message: `At most ${MAX_FILTERS} filters` });
        continue;
      }
      const parsed = parseFilter(key.slice(2), rawValue);
      if (typeof parsed === "string") issues.push({ param: key, message: parsed });
      else filters.push(parsed);
    }
  }
  return { query: { ...(q ? { q } : {}), qm, filters, sort, page, pageSize }, issues };
}

export function serializeFilterValue(filter: GridFilter): string {
  switch (filter.op) {
    case "in":
    case "nin":
      return `${filter.op}:${filter.values.map(escapeListValue).join(",")}`;
    case "eq":
    case "ct":
    case "sw":
    case "ew":
      return `${filter.op}:${filter.value}`;
    case "ex":
    case "empty":
      return filter.op;
    case "rng":
      return `rng:${filter.min ?? ""}..${filter.max ?? ""}`;
    case "bool":
      return `bool:${filter.value ? "true" : "false"}`;
    case "date":
      return `date:${serializeDateSpec(filter.date)}`;
  }
}

/** Canonical query string (no leading "?"); defaults are omitted. */
export function serializeGridQuery(query: Partial<GridQuery>): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.q && query.qm && query.qm !== "sw") params.set("qm", query.qm);
  for (const filter of query.filters ?? []) params.append(`f.${filter.field}`, serializeFilterValue(filter));
  if (query.sort && query.sort.length > 0) params.set("sort", query.sort.map((s) => (s.dir === "desc" ? `-${s.field}` : s.field)).join(","));
  if (query.page && query.page > 1) params.set("page", String(query.page));
  if (query.pageSize && query.pageSize !== DEFAULT_PAGE_SIZE) params.set("ps", String(query.pageSize));
  return params.toString();
}
