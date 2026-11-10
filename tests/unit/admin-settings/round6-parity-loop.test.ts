/**
 * M14 round 6 (parity loop): fresh user detail before an edit, audit KPI filters and labels,
 * honest welcome-email outcome, invite template, SMTP message framing, Data Setup nav without
 * duplicate lookups, and human notification chip labels.
 */
import { describe, expect, it } from "vitest";
import { isFreshDetail } from "@/lib/grid-defs/admin/users";
import { auditActionLabel, auditCategory, kpiFilters } from "@/lib/grid-defs/admin/audit";
import { INVITE_TTL_HOURS, inviteEmail, mailSettingsSchema, welcomeToastText } from "@/lib/grid-defs/admin/company-mail";
import { dataSetupNavDefs, EMBEDDED_LOOKUPS, LOOKUP_DEFS } from "@/lib/grid-defs/admin/lookups";
import { kindGroupLabel } from "@/lib/grid-defs/admin/notifications";
import { RESTRICTION_COVERAGE } from "@/lib/grid-defs/admin/roles";
import { roleLabel } from "@/components/layout/role-label";
import { buildMessage } from "@/server/repositories/company-mail";
import { summarizeDetail } from "@/server/repositories/audit";

describe("isFreshDetail (Edit user never opens a pre-save copy)", () => {
  it("rejects data cached before the drawer opened", () => {
    expect(isFreshDetail(1_000, 2_000, false)).toBe(false);
  });
  it("waits while a refetch is in flight", () => {
    expect(isFreshDetail(3_000, 2_000, true)).toBe(false);
  });
  it("accepts data fetched after opening", () => {
    expect(isFreshDetail(3_000, 2_000, false)).toBe(true);
  });
  it("is false before the open time is known", () => {
    expect(isFreshDetail(3_000, 0, false)).toBe(false);
  });
});

describe("audit", () => {
  it("KPI tile replaces category/outcome filters in one list and keeps the rest", () => {
    const current = [
      { field: "category", op: "in", values: ["Sign-in"] },
      { field: "outcome", op: "in", values: ["failure"] },
      { field: "userId", op: "in", values: ["u1"] },
    ] as const;
    expect(kpiFilters(current, "Permission denied")).toEqual([
      { field: "userId", op: "in", values: ["u1"] },
      { field: "category", op: "in", values: ["Permission denied"] },
    ]);
    expect(kpiFilters([], "Sign-in", "failure")).toEqual([
      { field: "category", op: "in", values: ["Sign-in"] },
      { field: "outcome", op: "in", values: ["failure"] },
    ]);
  });
  it("labels a rejected password change as its own action in the Password category", () => {
    expect(auditActionLabel("auth.password_change_rejected")).toBe("Password change rejected");
    expect(auditCategory("auth.password_change_rejected")).toBe("Password");
    expect(auditActionLabel("lookup.create")).toBe("Data Setup value created");
  });
  it("shows the lookup type and printout type as names, not keys", () => {
    expect(summarizeDetail(JSON.stringify({ type: "so_type", name: "Retail" }))).toBe("type: Shipment Order Type");
    expect(summarizeDetail(JSON.stringify({ type: "packing-list" }))).toBe("type: Packing List");
  });
});

describe("welcome email", () => {
  it("never claims an email that was not sent", () => {
    expect(welcomeToastText({ name: "Jo", requested: true, transport: "log" })).toMatchObject({ tone: "attention" });
    expect(welcomeToastText({ name: "Jo", requested: true, transport: "log" }).text).toMatch(/server log only/);
    expect(welcomeToastText({ name: "Jo", requested: true, transport: null, error: "timeout" }).text).toMatch(/failed: timeout/);
    expect(welcomeToastText({ name: "Jo", requested: true, transport: "smtp" })).toMatchObject({ tone: "success" });
    expect(welcomeToastText({ name: "Jo", requested: false, transport: null }).text).toMatch(/can sign in now/);
  });
  it("uses an invite template with a multi-day link, not the reset wording", () => {
    const m = inviteEmail({ companyName: "Acme", firstName: "Jo", invitedBy: "Mike", link: "https://x/reset-password?token=t" });
    expect(INVITE_TTL_HOURS).toBeGreaterThanOrEqual(48);
    expect(m.subject).toContain("invited");
    expect(m.text).toContain("3 days");
    expect(m.text).not.toMatch(/did not ask/i);
  });
  it("SMTP settings require a valid From address when given", () => {
    expect(mailSettingsSchema.safeParse({ transport: "smtp", host: "smtp.x.com", port: 587, security: "starttls", fromAddress: "nope" }).success).toBe(false);
    expect(mailSettingsSchema.safeParse({ transport: "smtp", host: "smtp x", port: 587, security: "starttls", fromAddress: "a@b.co" }).success).toBe(false);
    expect(mailSettingsSchema.safeParse({ transport: "log", port: 587, security: "starttls" }).success).toBe(true);
  });
  it("frames the SMTP message: dot-stuffing, CRLF, no header injection", () => {
    const msg = buildMessage({ address: "no-reply@k.io", name: "K" }, { to: "a@b.co\r\nBcc: evil@x.io", subject: "Hi\nBcc: evil@x.io", text: "line1\n.dot line\nend" }, new Date(0));
    const [head, body] = msg.split("\r\n\r\n");
    expect(head).not.toMatch(/\r\nBcc:/);
    expect(body).toBe("line1\r\n..dot line\r\nend");
  });
});

describe("data setup nav", () => {
  it("lists each data set once; Return Reason lives inside Return Process", () => {
    const nav = dataSetupNavDefs();
    expect(nav.map((n) => n.slug)).not.toContain("return-reason");
    expect(EMBEDDED_LOOKUPS["return-reason"]).toBe("return-process");
    expect(nav.find((n) => n.slug === "return-process")?.countType).toBe("return_reason");
    expect(nav).toHaveLength(LOOKUP_DEFS.length); // + code generation, - return reason
  });
});

describe("labels", () => {
  it("notification chips are human labels", () => {
    expect(kindGroupLabel("eod")).toBe("End of day");
    expect(kindGroupLabel("work-order")).toBe("Work orders");
    expect(kindGroupLabel("cycle-count")).toBe("Cycle count");
  });
  it("user menu role names match the Roles grid", () => {
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("operator")).toBe("Warehouse Clerk");
  });
  it("restriction copy states its real coverage", () => {
    // REQ-R6-1 shipped: restrictions apply to every API response and to Excel exports.
    expect(RESTRICTION_COVERAGE).toMatch(/every screen and API response, and Excel exports/);
  });
});
