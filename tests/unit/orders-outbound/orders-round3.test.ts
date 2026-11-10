/** Round 3: order-code sequence advances on create, regenerate skips taken codes, one Create entry per line, wizard rules. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { createOrder, createOrderBodySchema, peekOrderCode } from "@/server/repositories/orders-commands";
import { customerStepSchema, defaultOrderValues, requiredCompletion } from "@/components/orders/wizard/order-form-model";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
beforeEach(() => {
  w = createWorld();
});
afterEach(() => w.close());

const make = (code?: string) =>
  createOrder(w.db, w.ctx, createOrderBodySchema.parse(orderInput(w, [{ productId: w.productId, quantity: 1 }], code ? { code } : {})));

describe("order code sequence", () => {
  it("consumes the sequence when the client sends back the peeked code", () => {
    const first = peekOrderCode(w.db);
    const a = make(first);
    expect(a.code).toBe(first);
    const second = peekOrderCode(w.db);
    expect(second).not.toBe(first);
    expect(make(second).code).toBe(second);
  });

  it("never proposes a code that already exists (hand-typed collision)", () => {
    const p1 = peekOrderCode(w.db);
    const m = /^(\D*)(\d+)$/.exec(p1);
    if (!m) throw new Error(`unexpected code ${p1}`);
    const bump = (n: number) => `${m[1]}${String(Number(m[2]) + n).padStart(m[2]!.length, "0")}`;
    make(bump(1)); // someone hand-types the next sequence value
    expect(make(p1).code).toBe(p1);
    expect(peekOrderCode(w.db)).toBe(bump(2));
    expect(make().code).toBe(bump(2));
  });

  it("rejects a hand-typed duplicate with a field error on code", () => {
    make("KS-DUP-1");
    try {
      make("KS-DUP-1");
      throw new Error("expected duplicate");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("DUPLICATE");
      expect((e as { fieldErrors?: Record<string, string[]> }).fieldErrors?.code?.[0]).toMatch(/taken/);
    }
  });

  it("writes one Create entry per line and no quantity-update entries", () => {
    const o = make();
    const lineLogs = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.parentEntityId, o.id)).all();
    expect(lineLogs).toHaveLength(1);
    expect(lineLogs[0]?.type).toBe("Create");
    expect(lineLogs[0]?.message).toMatch(/^MLT-WIDGET-01 -> .* is created\.$/);
  });
});

describe("wizard rules", () => {
  it("rejects a malformed customer email", () => {
    const v = { ...defaultOrderValues(), customerEmail: "not-an-email" } as never;
    const res = customerStepSchema.safeParse(v);
    expect(res.success).toBe(false);
    expect(res.error?.issues.some((i) => i.path[0] === "customerEmail")).toBe(true);
  });

  it("reports 0% completion on a blank form", () => {
    expect(requiredCompletion(defaultOrderValues() as never)).toBe(0);
  });
});
