import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

/**
 * src/styles/tokens.css is shared byte-for-byte with KitStak CRM (same path there).
 * This hash is pinned in BOTH repos. To change a token: edit the file, update the hash,
 * then copy the file and the hash to the other repo. A one-sided edit fails here.
 */
const SHARED_TOKENS_SHA256 = "8c7c20388dca3dc9496937683d1bb018f77624eb459337314f1a8c7150dc45e5";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8").replace(/\r\n/g, "\n");

const tokens = read("src/styles/tokens.css");
const globals = read("src/app/globals.css");

/** Legacy WMS names that must keep resolving, each as an alias of a shared token. */
const LEGACY_ALIASES = [
  "background",
  "surface",
  "border",
  "foreground",
  "text-body",
  "text-faint",
  "nav",
  "nav-hover",
  "nav-active",
  "primary-soft",
  "success-soft",
  "warning-soft",
  "danger-soft",
  "info-soft",
  "neutral",
  "neutral-soft",
  "ring",
] as const;

/** Legacy names the shared file defines itself, so no alias is needed. */
const SHARED_SAME_NAME = [
  "surface-sunken",
  "border-strong",
  "primary",
  "primary-hover",
  "success",
  "warning",
  "danger",
  "info",
  "text-secondary",
] as const;

/** Tailwind colour names existing components rely on (bg-surface, text-secondary, ...). */
const LEGACY_UTILITIES = [
  "background",
  "surface",
  "surface-sunken",
  "border",
  "border-strong",
  "foreground",
  "body",
  "secondary",
  "faint",
  "nav",
  "nav-hover",
  "primary",
  "primary-hover",
  "primary-soft",
  "success",
  "success-soft",
  "warning",
  "warning-soft",
  "danger",
  "danger-soft",
  "info",
  "info-soft",
  "neutral",
  "neutral-soft",
] as const;

function aliasBlock(): string {
  const start = globals.indexOf(":root {");
  const end = globals.indexOf("}", start);
  return globals.slice(start, end);
}

describe("shared design tokens", () => {
  it("matches the hash pinned in both KitStak repos (no drift)", () => {
    const actual = createHash("sha256").update(tokens).digest("hex");
    expect(
      actual,
      "src/styles/tokens.css changed. Update SHARED_TOKENS_SHA256 here AND copy the file and hash to the other KitStak repo."
    ).toBe(SHARED_TOKENS_SHA256);
  });

  it("is imported by globals.css", () => {
    expect(globals).toContain('@import "../styles/tokens.css";');
  });

  it("ships light, forced dark and OS-preference dark themes", () => {
    expect(tokens).toContain(":root {");
    expect(tokens).toContain(":root[data-theme='dark']");
    expect(tokens).toContain(":root:not([data-theme='light'])");
  });
});

describe("legacy WMS token aliases", () => {
  it("keeps every legacy custom property, defined from shared tokens only", () => {
    const block = aliasBlock();
    for (const name of LEGACY_ALIASES) {
      const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
      expect(match, `--${name} alias missing`).not.toBeNull();
      expect(match?.[1], `--${name} must reference a shared token`).toMatch(/var\(--[a-z0-9-]+\)/);
    }
  });

  it("defines no literal colours outside the shared file's vocabulary", () => {
    expect(aliasBlock()).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it("relies on the shared file for names both systems use", () => {
    for (const name of SHARED_SAME_NAME) {
      expect(tokens, `--${name}`).toMatch(new RegExp(`\\n\\s*--${name}:`));
      expect(aliasBlock(), `--${name} must not be redefined`).not.toMatch(new RegExp(`\\n\\s*--${name}:`));
    }
  });

  it("references only tokens that exist in the shared file", () => {
    const local = new Set<string>(LEGACY_ALIASES);
    for (const [, name] of aliasBlock().matchAll(/var\(--([a-z0-9-]+)\)/g)) {
      if (name && !local.has(name)) expect(tokens, `--${name}`).toMatch(new RegExp(`\\n\\s*--${name}:`));
    }
  });

  it("keeps the legacy Tailwind colour utilities", () => {
    for (const name of LEGACY_UTILITIES) {
      expect(globals, `--color-${name}`).toMatch(new RegExp(`\\n\\s*--color-${name}:`));
    }
  });
});

describe("cn", () => {
  it("keeps a shared-scale font size next to a text colour", () => {
    expect(cn("text-2xs", "text-fg")).toBe("text-2xs text-fg");
    expect(cn("text-md", "text-fg-muted")).toBe("text-md text-fg-muted");
    expect(cn("text-sm", "text-secondary")).toBe("text-sm text-secondary");
  });

  it("still lets a later size or colour win over an earlier one", () => {
    expect(cn("text-sm", "text-md")).toBe("text-md");
    expect(cn("text-2xs", "text-xs")).toBe("text-xs");
    expect(cn("px-2", false, "px-3")).toBe("px-3");
  });
});
