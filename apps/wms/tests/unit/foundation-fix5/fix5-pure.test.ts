import { describe, expect, it } from "vitest";
import { demoCredentialsEnabled } from "@/app/login/demo-credentials";
import { PLACEHOLDER_TITLE, shipsInLabel } from "@/components/layout/module-placeholder-copy";
import { changePasswordSchema, dateFormatOptions, preferencesFormSchema, preferencesPreview } from "@/components/layout/account/account-options";
import { roleLabel } from "@/components/layout/role-label";
import { PENDING_DIM_MS } from "@/components/layout/route-progress";
import { todayValue } from "@/components/ui/date-picker";

const POLICY = { minLength: 10, requireUpper: true, requireNumber: true, requireSymbol: true } as const;

describe("demoCredentialsEnabled (login demo card guard)", () => {
  it.each([
    [{ NODE_ENV: "production", DEMO_MODE: "1" }, false],
    [{ NODE_ENV: "production" }, false],
    [{ NODE_ENV: "development" }, false],
    [{ NODE_ENV: "development", DEMO_MODE: "" }, false],
    [{ NODE_ENV: "development", DEMO_MODE: "0" }, false],
    [{ NODE_ENV: "development", DEMO_MODE: "1" }, true],
    [{ NODE_ENV: "test", DEMO_MODE: "true" }, true],
    [{ DEMO_MODE: " YES " }, true],
  ])("%o -> %s", (env, expected) => {
    expect(demoCredentialsEnabled(env)).toBe(expected);
  });
});

describe("module placeholder copy", () => {
  it("uses the F8.2 title and names the owning module", () => {
    expect(PLACEHOLDER_TITLE).toBe("Module in progress");
    expect(shipsInLabel("M14")).toBe("Ships in M14");
    expect(shipsInLabel("m03")).toBe("Ships in M03");
    expect(shipsInLabel("foundation")).toBe("Ships with foundation");
  });
});

describe("change password schema", () => {
  const schema = changePasswordSchema(POLICY);

  it("accepts a policy-compliant, matching new password", () => {
    expect(schema.safeParse({ currentPassword: "Old!pass2026", newPassword: "New!pass2027", confirmPassword: "New!pass2027" }).success).toBe(true);
  });

  it("flags a weak password, a mismatch and an unchanged password on the right fields", () => {
    const weak = schema.safeParse({ currentPassword: "x", newPassword: "short", confirmPassword: "short" });
    expect(weak.success).toBe(false);
    expect(weak.error?.issues.map((i) => i.path.join("."))).toContain("newPassword");

    const mismatch = schema.safeParse({ currentPassword: "x", newPassword: "New!pass2027", confirmPassword: "New!pass2028" });
    expect(mismatch.error?.issues.map((i) => i.path.join("."))).toEqual(["confirmPassword"]);

    const same = schema.safeParse({ currentPassword: "New!pass2027", newPassword: "New!pass2027", confirmPassword: "New!pass2027" });
    expect(same.error?.issues[0]?.message).toBe("Must differ from the current password");
  });

  it("requires the current password", () => {
    const missing = schema.safeParse({ currentPassword: "", newPassword: "New!pass2027", confirmPassword: "New!pass2027" });
    expect(missing.error?.issues.map((i) => i.path.join("."))).toEqual(["currentPassword"]);
  });
});

describe("preferences form", () => {
  it("validates the enum fields", () => {
    expect(preferencesFormSchema.safeParse({ dateFormat: "M/D/YYYY h:mm:ss A", timeFormat: "24h", numberFormat: "1.025,00" }).success).toBe(true);
    expect(preferencesFormSchema.safeParse({ dateFormat: "", timeFormat: "24h", numberFormat: "1.025,00" }).success).toBe(false);
    expect(preferencesFormSchema.safeParse({ dateFormat: "M/D/YYYY", timeFormat: "13h", numberFormat: "1.025,00" }).success).toBe(false);
  });

  it("keeps a custom stored pattern selectable", () => {
    expect(dateFormatOptions("M/D/YYYY h:mm:ss A").some((o) => o.label.includes("custom"))).toBe(false);
    expect(dateFormatOptions("YYYY.MM.DD").at(-1)).toEqual({ value: "YYYY.MM.DD", label: "YYYY.MM.DD (custom)" });
  });

  it("previews date-time and number formats", () => {
    const at = new Date(2026, 10, 5, 16, 5, 9);
    expect(preferencesPreview({ dateFormat: "M/D/YYYY h:mm:ss A", timeFormat: "12h", numberFormat: "1,025.00" }, at)).toEqual({ dateTime: "11/5/2026 4:05:09 PM", number: "1,025.00" });
    const eu = preferencesPreview({ dateFormat: "DD/MM/YYYY h:mm A", timeFormat: "24h", numberFormat: "1.025,00" }, at);
    expect(eu.number).toBe("1.025,00");
    expect(eu.dateTime).toContain("05/11/2026");
    expect(eu.dateTime).toContain("16:05");
  });
});

describe("misc fix5 helpers", () => {
  it("roleLabel maps legacy roles", () => {
    expect(roleLabel("manager")).toBe("Supervisor");
    expect(roleLabel("auditor")).toBe("Auditor");
  });

  it("route progress dims after 400ms", () => {
    expect(PENDING_DIM_MS).toBe(400);
  });

  it("date picker Today is midnight for dates and the current minute for date-times", () => {
    const now = new Date(2026, 10, 6, 9, 41, 27, 500);
    expect(todayValue(false, now)).toEqual(new Date(2026, 10, 6, 0, 0, 0, 0));
    expect(todayValue(true, now)).toEqual(new Date(2026, 10, 6, 9, 41, 0, 0));
  });
});
