import { describe, expect, it } from "vitest";
import { z } from "zod";
import { addTokens, splitTokens } from "@/components/ui/chip-input";
import { normalizeNumber, parseNumberText } from "@/components/ui/number-input";
import { formatBytes, validateFiles } from "@/components/ui/file-dropzone";
import { avatarColor, initialsOf } from "@/components/ui/avatar";
import { normalizeTime } from "@/components/ui/time-picker";
import { contrastOn, isHexColor } from "@/components/ui/color-swatch-picker";
import { filterOptions, minCharsMessage } from "@/components/ui/combobox-data";
import { activePageTab } from "@/components/ui/tabs";
import { clampPercent } from "@/components/ui/progress-bar";
import { submitDisabledReason } from "@/components/ui/form/submit-bar";
import { renderBarcodeSvg } from "@/components/ui/barcode";
import { formatRange } from "@/components/ui/date-range-picker";
import {
  canSelectStep,
  clearDraft,
  completionPercent,
  initialNavState,
  markValidation,
  moveTo,
  readDraft,
  stepMetas,
  validateStep,
  writeDraft,
} from "@/components/ui/wizard/wizard-state";

describe("chip input", () => {
  it("splits pasted lists", () => {
    expect(splitTokens("A1\nB2, C3;;D4\t")).toEqual(["A1", "B2", "C3", "D4"]);
  });

  it("dedupes case-insensitively, validates and caps", () => {
    expect(addTokens(["abc"], ["ABC", "def"], {})).toEqual({ value: ["abc", "def"], error: '"ABC" is already added.' });
    expect(addTokens([], ["x"], { validate: () => "Invalid" }).error).toBe("Invalid");
    expect(addTokens(["a"], ["b", "c"], { maxItems: 2 })).toEqual({ value: ["a", "b"], error: "You can add at most 2 items." });
  });
});

describe("number input helpers", () => {
  it("parses both separator styles", () => {
    expect(parseNumberText("1,234.5")).toBe(1234.5);
    expect(parseNumberText("1234,5")).toBe(1234.5);
    expect(parseNumberText("")).toBeNull();
    expect(Number.isNaN(parseNumberText("abc") as number)).toBe(true);
  });

  it("clamps and rounds", () => {
    expect(normalizeNumber(12.345, { decimals: 2 })).toBe(12.35);
    expect(normalizeNumber(-3, { min: 0 })).toBe(0);
    expect(normalizeNumber(99, { max: 10 })).toBe(10);
  });
});

describe("file validation", () => {
  const file = (name: string, size: number, type = "") => new File([new Uint8Array(size)], name, { type });

  it("rejects wrong types, large files and extras", () => {
    const { accepted, rejected } = validateFiles([file("a.xlsx", 10), file("b.exe", 10), file("c.csv", 5000), file("d.xlsx", 10)], {
      accept: [".xlsx", ".csv"],
      maxSizeBytes: 1024,
      maxFiles: 1,
    });
    expect(accepted.map((f) => f.name)).toEqual(["a.xlsx"]);
    expect(rejected.map((r) => r.file.name)).toEqual(["b.exe", "c.csv", "d.xlsx"]);
    expect(validateFiles([file("p.png", 1, "image/png")], { accept: ["image/*"] }).accepted).toHaveLength(1);
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});

describe("small helpers", () => {
  it("avatar initials and stable colours", () => {
    expect(initialsOf("Mike Lunsford")).toBe("ML");
    expect(initialsOf("admin@kitstak.io")).toBe("AI");
    expect(initialsOf("")).toBe("?");
    expect(avatarColor("x")).toBe(avatarColor("x"));
  });

  it("time normalisation", () => {
    expect(normalizeTime("930")).toBe("09:30");
    expect(normalizeTime("9:05")).toBe("09:05");
    expect(normalizeTime("24:00")).toBeNull();
  });

  it("swatch contrast", () => {
    expect(isHexColor("#2E5CE6")).toBe(true);
    expect(contrastOn("#FFFFFF")).toBe("#101828");
    expect(contrastOn("#101828")).toBe("#FFFFFF");
  });

  it("combobox filtering puts prefix matches first", () => {
    const options = [{ value: "1", label: "Blue Widget" }, { value: "2", label: "Widget Pro" }];
    expect(filterOptions(options, "wid").map((o) => o.value)).toEqual(["2", "1"]);
    expect(minCharsMessage(3)).toBe("You have to enter at least 3 characters to search.");
  });

  it("page tabs pick the longest match", () => {
    const tabs = [{ href: "/jobs", label: "Jobs" }, { href: "/jobs/waves", label: "Waves" }];
    expect(activePageTab(tabs, "/jobs/waves/12")).toBe("/jobs/waves");
    expect(activePageTab(tabs, "/jobs")).toBe("/jobs");
    expect(activePageTab(tabs, "/orders")).toBeNull();
  });

  it("progress clamps", () => {
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(5, 10)).toBe(50);
    expect(clampPercent(Number.NaN)).toBe(0);
  });

  it("submit bar reasons", () => {
    const base = { isSubmitting: false, pending: false, hasErrors: false, requireDirty: false, isDirty: false };
    expect(submitDisabledReason(base)).toBeNull();
    expect(submitDisabledReason({ ...base, hasErrors: true })).toBe("Fix the highlighted fields first");
    expect(submitDisabledReason({ ...base, requireDirty: true })).toBe("No changes to save");
  });

  it("barcodes render to SVG and report bad data", () => {
    expect(renderBarcodeSvg({ value: "SO000123" }).svg).toContain("<svg");
    expect(renderBarcodeSvg({ value: "abc", type: "ean13" }).error).toBeTruthy();
  });

  it("date range label", () => {
    expect(formatRange({ from: new Date(2026, 0, 2), to: new Date(2026, 0, 9) })).toBe("2026/01/02 – 2026/01/09");
    expect(formatRange({ from: null, to: null })).toBe("");
  });
});

describe("wizard state", () => {
  const steps = [{ key: "general", label: "General" }, { key: "lines", label: "Lines" }, { key: "review", label: "Review" }];

  it("linear mode only allows reached steps", () => {
    let s = initialNavState("linear", 3);
    expect(canSelectStep(s, 1, "linear", 3)).toBe(false);
    s = moveTo(s, 1);
    expect(canSelectStep(s, 1, "linear", 3)).toBe(true);
    expect(canSelectStep(s, 2, "linear", 3)).toBe(false);
    expect(canSelectStep(s, 2, "free", 3)).toBe(true);
  });

  it("free mode starts with every step reachable", () => {
    const metas = stepMetas(steps, initialNavState("free", 3), "free");
    expect(metas.every((m) => m.clickable)).toBe(true);
  });

  it("tracks complete / attention statuses and percent", () => {
    let s = markValidation(initialNavState("linear", 3), "general", true);
    s = moveTo(s, 1);
    s = markValidation(s, "lines", false);
    expect(stepMetas(steps, s, "linear").map((m) => m.status)).toEqual(["complete", "attention", "upcoming"]);
    expect(completionPercent(s, 3)).toBe(33);
  });

  it("validates a step slice", () => {
    const schema = z.object({ name: z.string().min(1, "Name is required") });
    expect(validateStep(schema, { name: "", other: 1 })).toEqual([{ path: "name", message: "Name is required" }]);
    expect(validateStep(schema, { name: "x" })).toEqual([]);
    expect(validateStep(undefined, {})).toEqual([]);
  });

  it("persists drafts and tolerates corrupt storage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    writeDraft(storage, "/orders/new", { values: { name: "A" }, nav: initialNavState("linear", 3) });
    expect(readDraft<{ name: string }>(storage, "/orders/new")?.values.name).toBe("A");
    store.set("ks:wizard-draft:/bad", "{not json");
    expect(readDraft(storage, "/bad")).toBeNull();
    clearDraft(storage, "/orders/new");
    expect(readDraft(storage, "/orders/new")).toBeNull();
  });
});
