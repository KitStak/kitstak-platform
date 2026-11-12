/** Round 4: stepper reconciles stale "attention" on fixed steps; cancel requests time out instead of spinning forever. */
import { describe, expect, it, vi } from "vitest";
import { reconcileStepStatus, withAttention } from "@/components/orders/wizard/order-wizard-shell";
import { withTimeout } from "@/components/orders/bulk/order-modals";
import type { StepMeta } from "@/components/ui/wizard";

const meta = (key: string, status: StepMeta["status"]): StepMeta => ({ key, label: key, status, clickable: true });

describe("reconcileStepStatus", () => {
  it("turns a reached, now-valid attention step green and keeps the current step as is", () => {
    const metas = [meta("details", "complete"), meta("customer", "attention"), meta("products", "attention"), meta("shipping", "active")];
    const out = reconcileStepStatus(metas, [true, true, true, true], 3, 3);
    expect(out.map((m) => m.status)).toEqual(["complete", "complete", "complete", "active"]);
  });

  it("keeps attention on a step that is still invalid, and leaves unreached steps upcoming", () => {
    const metas = [meta("details", "complete"), meta("products", "attention"), meta("shipping", "active"), meta("other", "upcoming")];
    const out = reconcileStepStatus(metas, [true, false, true, true], 2, 2);
    expect(out.map((m) => m.status)).toEqual(["complete", "attention", "active", "upcoming"]);
  });

  it("external address attention still wins after reconciling", () => {
    const metas = reconcileStepStatus([meta("customer", "attention"), meta("products", "active")], [true, true], 1, 1);
    expect(withAttention(metas, ["customer"]).map((m) => m.status)).toEqual(["attention", "active"]);
  });
});

describe("withTimeout", () => {
  it("resolves when the promise settles in time", async () => {
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
  });

  it("rejects with a readable message when the request hangs", async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise<never>(() => undefined), 30_000);
    vi.advanceTimersByTime(30_000);
    await expect(p).rejects.toThrow(/did not respond within 30s/);
    vi.useRealTimers();
  });
});
