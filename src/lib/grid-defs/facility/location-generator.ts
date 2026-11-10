/**
 * Bulk Location Generator (M10, beyond Logiwa). PURE: expands a pattern of
 * aisle × rack × level × position ranges into location codes. Shared by the client
 * preview and the server create path, so both always agree.
 *
 *   zone "P", aisles A–B, racks 01–03, levels 1–2  →  P-A-01-1 … P-B-03-2 (12 codes)
 */
import { z } from "zod";
import { AREA_TYPES, LOCATION_TYPES } from "@/lib/enums";
import { requiredId } from "./common";

export const GENERATOR_MAX = 5000;
export const GENERATOR_BACKGROUND_ABOVE = 500;
export const GENERATOR_PREVIEW_COUNT = 20;
export const GENERATOR_SEPARATORS = ["-", ".", "", "_"] as const;

/** One range segment: letters (A..F) or numbers (1..10, padded to the wider bound). */
export interface RangeSpec {
  readonly from: string;
  readonly to: string;
}

const LETTERS = /^[A-Z]{1,2}$/;
const DIGITS = /^\d{1,4}$/;

function letterIndex(s: string): number {
  return [...s].reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
}

function letterOf(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Why a range is invalid, or null. Empty `from` and `to` = segment unused. */
export function rangeError(range: RangeSpec | null | undefined, label: string, required: boolean): string | null {
  const from = (range?.from ?? "").trim().toUpperCase();
  const to = (range?.to ?? "").trim().toUpperCase();
  if (!from && !to) return required ? `${label} range is required` : null;
  if (!from || !to) return `Enter both ends of the ${label.toLowerCase()} range`;
  const letters = LETTERS.test(from) && LETTERS.test(to);
  const digits = DIGITS.test(from) && DIGITS.test(to);
  if (!letters && !digits) return `${label} range must be letters (A–F) or numbers (01–10)`;
  const a = letters ? letterIndex(from) : Number(from);
  const b = letters ? letterIndex(to) : Number(to);
  if (b < a) return `${label} range must go from low to high`;
  if (b - a + 1 > 200) return `${label} range can span at most 200 values`;
  return null;
}

/** Expands a valid range; an unused segment expands to `[null]`. */
export function expandRange(range: RangeSpec | null | undefined): readonly (string | null)[] {
  const from = (range?.from ?? "").trim().toUpperCase();
  const to = (range?.to ?? "").trim().toUpperCase();
  if (!from && !to) return [null];
  if (LETTERS.test(from) && LETTERS.test(to)) {
    const out: string[] = [];
    for (let i = letterIndex(from); i <= letterIndex(to); i += 1) out.push(letterOf(i));
    return out;
  }
  const width = Math.max(from.length, to.length);
  const out: string[] = [];
  for (let i = Number(from); i <= Number(to); i += 1) out.push(String(i).padStart(width, "0"));
  return out;
}

const rangeSchema = z.object({ from: z.string().trim().max(4), to: z.string().trim().max(4) });

export const generatorSchema = z.object({
  warehouseId: requiredId("Warehouse"),
  zone: z.string().trim().max(10, "Use at most 10 characters").regex(/^[A-Za-z0-9]*$/, "Letters and numbers only").default(""),
  separator: z.enum(GENERATOR_SEPARATORS).default("-"),
  aisles: rangeSchema,
  racks: rangeSchema,
  levels: rangeSchema,
  positions: rangeSchema,
  locationType: z.enum(LOCATION_TYPES),
  areaType: z.enum(AREA_TYPES),
  locationZoneId: z.string().trim().max(64).nullable().optional().transform((v) => v || null),
  locationGroupId: z.string().trim().max(64).nullable().optional().transform((v) => v || null),
  walkingPathStart: z.number().int().min(0).max(999_999).default(0),
  walkingPathStep: z.number().int().min(0).max(1000).default(1),
}).superRefine((v, ctx) => {
  const checks: [keyof typeof v, string, boolean][] = [["aisles", "Aisle", true], ["racks", "Rack", true], ["levels", "Level", false], ["positions", "Position", false]];
  for (const [key, label, required] of checks) {
    const message = rangeError(v[key] as RangeSpec, label, required);
    if (message) ctx.addIssue({ code: "custom", path: [key, "from"], message });
  }
  const total = generatorCount(v);
  if (total > GENERATOR_MAX) ctx.addIssue({ code: "custom", path: ["aisles", "from"], message: `This pattern makes ${total.toLocaleString("en-US")} locations; the limit is ${GENERATOR_MAX.toLocaleString("en-US")}` });
});

export type GeneratorInput = z.input<typeof generatorSchema>;
export type GeneratorSpec = z.output<typeof generatorSchema>;

type PatternParts = Pick<GeneratorSpec, "zone" | "separator" | "aisles" | "racks" | "levels" | "positions">;

function safeExpand(range: RangeSpec): readonly (string | null)[] {
  return rangeError(range, "x", false) ? [] : expandRange(range);
}

export function generatorCount(spec: PatternParts): number {
  return safeExpand(spec.aisles).length * safeExpand(spec.racks).length * safeExpand(spec.levels).length * safeExpand(spec.positions).length;
}

export interface GeneratedLocation {
  readonly code: string;
  readonly aisle: string;
  readonly rack: string;
  readonly level: string;
  readonly position: string | null;
  /** 0-based order (drives the walking path). */
  readonly index: number;
}

/** Every code, in walking order (aisle → rack → level → position). */
export function expandPattern(spec: PatternParts): readonly GeneratedLocation[] {
  const zone = spec.zone.trim().toUpperCase();
  const out: GeneratedLocation[] = [];
  for (const aisle of safeExpand(spec.aisles)) {
    for (const rack of safeExpand(spec.racks)) {
      for (const level of safeExpand(spec.levels)) {
        for (const position of safeExpand(spec.positions)) {
          const parts = [zone, aisle, rack, level, position].filter((p): p is string => Boolean(p));
          out.push({ code: parts.join(spec.separator), aisle: aisle ?? "", rack: rack ?? "", level: level ?? "0", position, index: out.length });
        }
      }
    }
  }
  return out;
}

export const GENERATOR_DEFAULTS: GeneratorInput = {
  warehouseId: "",
  zone: "",
  separator: "-",
  aisles: { from: "A", to: "B" },
  racks: { from: "01", to: "03" },
  levels: { from: "1", to: "2" },
  positions: { from: "", to: "" },
  locationType: "Shelves",
  areaType: "Picking",
  locationZoneId: null,
  locationGroupId: null,
  walkingPathStart: 1,
  walkingPathStep: 1,
};
