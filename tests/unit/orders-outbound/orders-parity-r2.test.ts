/** Parity loop round 2: stale auto codes, wizard double-create, human API messages, permission gate, ATP tone, reprint pick list. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { createOrder, createOrderBodySchema, peekOrderCode } from "@/server/repositories/orders-commands";
import { parseOrderBody } from "@/server/repositories/orders-validation";
import { createBody, defaultOrderValues } from "@/components/orders/wizard/order-form-model";
import { CHECKING_PERMISSIONS, NO_PERMISSION, permissionGate } from "@/components/orders/use-order-permissions";
import { atpTone } from "@/components/orders/wizard/order-product-search";
import { orderLocks } from "@/components/orders/detail/order-detail-page";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
beforeEach(() => {
  w = createWorld();
});
afterEach(() => w.close());

const nextValue = () => w.db.select().from(schema.codeSequences).where(eq(schema.codeSequences.key, "so")).get()?.nextValue ?? 0;

/** What the wizard posts: the peeked code plus `autoCode` while the user kept the suggestion. */
function wizardCreate(suggested: string) {
  return createOrder(w.db, w.ctx, createOrderBodySchema.parse({ ...orderInput(w, [{ productId: w.productId, quantity: 1 }], { code: suggested }), autoCode: true }));
}

describe("auto order code (blocker regression)", () => {
  it("two wizard creates in a row with auto codes both succeed and advance the sequence", () => {
    const suffix = (c: string) => Number(/([0-9]+)$/.exec(c)?.[1]);
    const s1 = peekOrderCode(w.db);
    const a = wizardCreate(s1);
    expect(a.code).toBe(s1);
    expect(nextValue()).toBe(suffix(s1) + 1);
    const s2 = peekOrderCode(w.db);
    expect(s2).not.toBe(s1);
    const b = wizardCreate(s2);
    expect(b.code).toBe(s2);
    expect(nextValue()).toBe(suffix(s2) + 1);
  });

  it("a stale auto code (another user saved it first) gets the next free code instead of a DUPLICATE error", () => {
    const stale = peekOrderCode(w.db);
    wizardCreate(stale); // user A
    const b = wizardCreate(stale); // user B still holds the same suggestion
    expect(b.code).not.toBe(stale);
    expect(b.code).toBe(peekOrderCodeMinusOne());
  });

  it("a hand-typed taken code still fails with DUPLICATE", () => {
    const code = peekOrderCode(w.db);
    wizardCreate(code);
    expect(() => createOrder(w.db, w.ctx, createOrderBodySchema.parse(orderInput(w, [{ productId: w.productId, quantity: 1 }], { code })))).toThrow(/already exists/);
  });

  it("createBody sends autoCode only while the code equals the suggestion", () => {
    const v = { ...defaultOrderValues(), code: "SO000123", codeSuggested: "SO000123" };
    expect(createBody(v).autoCode).toBe(true);
    expect(createBody({ ...v, code: "MY-CODE" }).autoCode).toBe(false);
    expect(createBody({ ...v, codeSuggested: "" }).autoCode).toBe(false);
  });
});

function peekOrderCodeMinusOne(): string {
  // The code assigned to B is the one just consumed: one below the current peek.
  const peek = peekOrderCode(w.db);
  const m = /^(\D*)(\d+)$/.exec(peek) as RegExpExecArray;
  return `${m[1]}${String(Number(m[2]) - 1).padStart((m[2] as string).length, "0")}`;
}

describe("human API validation messages", () => {
  it("never leaks raw zod text for missing fields", () => {
    let fieldErrors: Record<string, string[]> = {};
    try {
      parseOrderBody(createOrderBodySchema, { warehouseId: "x" });
    } catch (error) {
      fieldErrors = (error as { fieldErrors: Record<string, string[]> }).fieldErrors;
    }
    const all = Object.values(fieldErrors).flat();
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((m) => /Invalid input|expected .* received/.test(m))).toBe(false);
    expect(fieldErrors.shipAddress).toEqual(["Enter address line 1"]);
    expect(fieldErrors.clientId).toEqual(["Choose a client"]);
    expect(fieldErrors.lines?.[0]).toMatch(/product|line/i);
  });
});

describe("permission gate", () => {
  it("never shows denial copy while permissions load", () => {
    const loading = permissionGate(new Set(), false);
    expect(loading.can("x")).toBe(true);
    expect(loading.reason("x")).toBe(CHECKING_PERMISSIONS);
    const ready = permissionGate(new Set(["x"]), true);
    expect(ready.reason("x")).toBeNull();
    expect(ready.reason("y")).toBe(NO_PERMISSION);
  });

  it("orderLocks uses a neutral lock while loading", () => {
    const detail = { order: { status: "Open" }, lines: [], actions: { editLines: null } } as unknown as Parameters<typeof orderLocks>[0];
    expect(orderLocks(detail, true, false).header).toBe(CHECKING_PERMISSIONS);
    expect(orderLocks(detail, false, true).header).toMatch(/permission/);
    expect(orderLocks(detail, true, true)).toEqual({ header: null, lines: null });
  });
});

describe("search ATP tone", () => {
  it("green / amber / red / none", () => {
    expect(atpTone(null, 1)).toBe("none");
    expect(atpTone(0, 1)).toBe("out");
    expect(atpTone(5, 6)).toBe("over");
    expect(atpTone(5, 5)).toBe("ok");
  });
});
