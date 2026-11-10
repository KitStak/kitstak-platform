import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRoute } from "@/config/route-registry";
import { BRAND_NAME, SANDBOX_CARRIER_NAME } from "@/config/brand";
import { NOTIFICATIONS } from "@/server/db/seed/platform";

const APP_DIR = path.resolve(__dirname, "../../../src/app/(app)");

function pageFileFor(pattern: string): string {
  return path.join(APP_DIR, ...pattern.split("/").filter(Boolean), "page.tsx");
}

describe("seeded notification deep links", () => {
  it.each(NOTIFICATIONS.map((n) => [n[2], n[4]] as const))("%s → %s resolves to a registered page", (_title, href) => {
    const route = resolveRoute(href);
    expect(route, `${href} is not in route-registry`).not.toBeNull();
    expect(existsSync(pageFileFor(route?.pattern ?? "")), `${route?.pattern} has no page.tsx`).toBe(true);
  });

  it("names the sandbox carrier with the brand constant", () => {
    expect(SANDBOX_CARRIER_NAME).toBe(`${BRAND_NAME} Sandbox`);
    const bodies = NOTIFICATIONS.map((n) => n[3]).join("\n");
    expect(bodies).not.toContain("KitStaks");
    expect(bodies).toContain(SANDBOX_CARRIER_NAME);
  });
});
