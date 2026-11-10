/**
 * Rule-condition evaluation shared by allocation and putaway algorithms, workflows,
 * job-type conditions and wave filters (BUILD_PLAN F5 `evaluateConditions`).
 *
 * Facts are a flat record: `{ client: "c1", sku: ["A","B"], orderQuantity: 4, ... }`.
 * Array-valued facts match when ANY element matches (e.g. "SKU equals A").
 * The literal value "Empty" in `in` / `notIn` lists matches null / "".
 */
import type { ConditionValue, FilterCondition, RuleCondition } from "@/lib/domain-types";
import type { RuleComparator } from "@/lib/enums";
import { parseDateSpec, resolveDateRange } from "@/server/query/date-presets";

export type FactValue = string | number | boolean | null | undefined | readonly (string | number | null)[];
export type Facts = Readonly<Record<string, FactValue>>;

const EMPTY_TOKEN = "empty";

const isBlank = (v: unknown): boolean => v === null || v === undefined || v === "";
const norm = (v: unknown): string => (isBlank(v) ? "" : String(v).toLowerCase());
const asList = (v: ConditionValue): (string | number)[] =>
  Array.isArray(v) ? v : v === null || typeof v === "boolean" ? [String(v)] : [v];

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function inList(fact: unknown, list: readonly (string | number)[]): boolean {
  const wanted = list.map(norm);
  if (isBlank(fact)) return wanted.includes(EMPTY_TOKEN) || wanted.includes("");
  return wanted.includes(norm(fact));
}

function compareScalar(fact: unknown, comparator: RuleComparator, value: ConditionValue): boolean {
  switch (comparator) {
    case "equals": return norm(fact) === norm(Array.isArray(value) ? value[0] : value);
    case "notEquals": return norm(fact) !== norm(Array.isArray(value) ? value[0] : value);
    case "contains": return !isBlank(fact) && norm(fact).includes(norm(value));
    case "notContains": return isBlank(fact) || !norm(fact).includes(norm(value));
    case "startsWith": return !isBlank(fact) && norm(fact).startsWith(norm(value));
    case "endsWith": return !isBlank(fact) && norm(fact).endsWith(norm(value));
    case "in": return inList(fact, asList(value));
    case "notIn": return !inList(fact, asList(value));
    case "isEmpty": return isBlank(fact);
    case "isNotEmpty": return !isBlank(fact);
    case "between": {
      const [lo, hi] = asList(value).map(toNumber);
      const n = toNumber(fact);
      return n !== null && lo !== null && hi !== null && n >= lo && n <= hi;
    }
    case "gt": case "gte": case "lt": case "lte": {
      const n = toNumber(fact);
      const v = toNumber(Array.isArray(value) ? value[0] : value);
      if (n === null || v === null) return false;
      if (comparator === "gt") return n > v;
      if (comparator === "gte") return n >= v;
      if (comparator === "lt") return n < v;
      return n <= v;
    }
  }
}

const NEGATIVE: ReadonlySet<RuleComparator> = new Set(["notEquals", "notContains", "notIn", "isEmpty"]);

export function evaluateCondition(condition: RuleCondition, facts: Facts): boolean {
  const fact = facts[condition.field];
  if (Array.isArray(fact)) {
    const items = fact as readonly (string | number | null)[];
    if (items.length === 0) return compareScalar(null, condition.comparator, condition.value);
    // Negative comparators must hold for every element; positive ones for any.
    return NEGATIVE.has(condition.comparator)
      ? items.every((item) => compareScalar(item, condition.comparator, condition.value))
      : items.some((item) => compareScalar(item, condition.comparator, condition.value));
  }
  return compareScalar(fact, condition.comparator, condition.value);
}

/** `[]` means "Applied to all". */
export function evaluateConditions(conditions: readonly RuleCondition[] | null | undefined, facts: Facts, match: "All" | "Any" = "All"): boolean {
  if (!conditions || conditions.length === 0) return true;
  return match === "All" ? conditions.every((c) => evaluateCondition(c, facts)) : conditions.some((c) => evaluateCondition(c, facts));
}

/** Evaluates a grid-grammar filter clause (job-type conditions, wave filters). */
export function evaluateFilter(filter: FilterCondition, facts: Facts, now: Date = new Date()): boolean {
  const fact = facts[filter.field];
  const value = filter.value;
  switch (filter.op) {
    case "in": return evaluateCondition({ field: filter.field, comparator: "in", value }, facts);
    case "nin": return evaluateCondition({ field: filter.field, comparator: "notIn", value }, facts);
    case "eq": return evaluateCondition({ field: filter.field, comparator: "equals", value }, facts);
    case "ct": return evaluateCondition({ field: filter.field, comparator: "contains", value }, facts);
    case "sw": return evaluateCondition({ field: filter.field, comparator: "startsWith", value }, facts);
    case "ew": return evaluateCondition({ field: filter.field, comparator: "endsWith", value }, facts);
    case "ex": return evaluateCondition({ field: filter.field, comparator: "notContains", value }, facts);
    case "empty": return value === false ? !isBlank(fact) : isBlank(fact);
    case "bool": return norm(fact) === norm(value) || (value === true && fact === 1) || (value === false && (fact === 0 || isBlank(fact)));
    case "rng": {
      const [lo, hi] = typeof value === "string" ? value.split("..") : asList(value).map(String);
      const n = toNumber(fact);
      if (n === null) return false;
      const loN = lo === undefined || lo === "" ? -Infinity : Number(lo);
      const hiN = hi === undefined || hi === "" ? Infinity : Number(hi);
      return n >= loN && n <= hiN;
    }
    case "date": {
      if (isBlank(fact) || typeof value !== "string") return false;
      const spec = parseDateSpec(value);
      const t = Date.parse(String(fact));
      if (!spec || Number.isNaN(t)) return false;
      const range = resolveDateRange(spec, now);
      return (!range.from || t >= Date.parse(range.from)) && (!range.to || t <= Date.parse(range.to));
    }
  }
}

export function evaluateFilters(filters: readonly FilterCondition[] | null | undefined, facts: Facts, now?: Date): boolean {
  return !filters || filters.every((f) => evaluateFilter(f, facts, now));
}
