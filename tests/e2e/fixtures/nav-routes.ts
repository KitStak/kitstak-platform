/**
 * Reads nav routes from the app's nav config so the audit covers menu items
 * that are only rendered while a dropdown is open. Checks the F4 location
 * first and falls back to the legacy one.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { extractHrefs } from "./dead-click-core";

export const NAV_CONFIG_CANDIDATES: readonly string[] = [
  "src/config/nav-config.ts",
  "src/components/layout/nav-config.ts",
];

export function loadNavConfigHrefs(cwd: string = process.cwd()): readonly string[] {
  // require (not import()) so Playwright's TypeScript transform handles the file.
  const load = createRequire(path.join(cwd, "package.json"));
  for (const candidate of NAV_CONFIG_CANDIDATES) {
    const file = path.join(cwd, candidate);
    if (!fs.existsSync(file)) continue;
    const hrefs = extractHrefs(load(file) as unknown);
    if (hrefs.length > 0) return hrefs;
  }
  return [];
}
