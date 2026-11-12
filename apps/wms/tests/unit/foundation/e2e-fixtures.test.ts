import { describe, expect, it } from "vitest";
import { formatViolations, meetsImpact } from "../../e2e/fixtures/a11y";
import { parseRetryAfter } from "../../e2e/fixtures/login";
import { DEFAULT_BASE_URL, ROLES, ROLE_EMAILS, e2eBaseUrl, e2ePassword, isRole, storageStatePath } from "../../e2e/fixtures/roles";

describe("roles", () => {
  it("defines a seeded account for each of the four roles", () => {
    expect(ROLES).toEqual(["admin", "manager", "operator", "viewer"]);
    expect(ROLE_EMAILS.admin).toBe("admin@kitstak.io");
    for (const role of ROLES) expect(ROLE_EMAILS[role]).toMatch(/@kitstak\.io$/);
  });

  it("resolves password and base URL from env with fallbacks", () => {
    expect(e2ePassword({ E2E_PASSWORD: "a", SEED_PASSWORD: "b" })).toBe("a");
    expect(e2ePassword({ SEED_PASSWORD: "b" })).toBe("b");
    expect(e2ePassword({})).toBe("KitStak!demo2026");
    expect(e2eBaseUrl({})).toBe(DEFAULT_BASE_URL);
    expect(e2eBaseUrl({ E2E_BASE_URL: "http://staging.test" })).toBe("http://staging.test");
  });

  it("stores auth state under the gitignored .data dir", () => {
    expect(storageStatePath("viewer")).toMatch(/[\\/]\.data[\\/]e2e-auth[\\/]viewer\.json$/);
    expect(isRole("operator")).toBe(true);
    expect(isRole("root")).toBe(false);
  });
});

describe("login retry", () => {
  it("parses Retry-After with a sane default and cap", () => {
    expect(parseRetryAfter("12")).toBe(12);
    expect(parseRetryAfter(undefined)).toBe(5);
    expect(parseRetryAfter("nope")).toBe(5);
    expect(parseRetryAfter("9999")).toBe(65);
  });
});

describe("a11y helper", () => {
  it("filters by minimum impact, treating unknown as serious", () => {
    expect(meetsImpact("critical", "serious")).toBe(true);
    expect(meetsImpact("moderate", "serious")).toBe(false);
    expect(meetsImpact(null, "serious")).toBe(true);
    expect(meetsImpact(undefined, "critical")).toBe(false);
  });

  it("formats violations with targets and overflow count", () => {
    const text = formatViolations([
      { id: "color-contrast", impact: "serious", help: "Contrast", helpUrl: "https://x", targets: ["a", "b", "c", "d", "e", "f"] },
    ]);
    expect(text).toContain("[serious] color-contrast: Contrast");
    expect(text).toContain("(+1 more)");
  });
});
