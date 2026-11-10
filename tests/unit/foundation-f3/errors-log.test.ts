import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, fromZodError, rateLimitedError, toAppError } from "@/server/api/errors";
import { created, failureBody, isRouteResult, listResult, successBody } from "@/server/api/envelope";
import { createLogger, sanitize, type LogLevel } from "@/server/log";

describe("errors", () => {
  it("maps codes to HTTP statuses", () => {
    expect(new AppError("CONFLICT", "x").status).toBe(409);
    expect(new AppError("NOT_FOUND", "x").status).toBe(404);
    expect(rateLimitedError(2.2).headers).toEqual({ "Retry-After": "3" });
  });

  it("converts zod errors into fieldErrors", () => {
    const parsed = z.object({ name: z.string(), qty: z.number() }).safeParse({ qty: "x" });
    if (parsed.success) throw new Error("expected failure");
    const err = fromZodError(parsed.error);
    expect(err.code).toBe("VALIDATION");
    expect(Object.keys(err.fieldErrors ?? {}).sort()).toEqual(["name", "qty"]);
  });

  it("duck-types domain errors and hides unknown errors", () => {
    const domain = Object.assign(new Error("Only Pending POs can be received"), { code: "INVALID_STATE" });
    expect(toAppError(domain)).toMatchObject({ code: "INVALID_STATE", status: 409, message: "Only Pending POs can be received" });
    const internal = toAppError(new Error("SQLITE_CORRUPT at /secret/path"));
    expect(internal).toMatchObject({ code: "INTERNAL", message: "Internal server error" });
  });
});

describe("envelope", () => {
  it("builds success/failure bodies", () => {
    expect(successBody([1], { total: 1, page: 1, pageSize: 100 })).toEqual({ success: true, data: [1], meta: { total: 1, page: 1, pageSize: 100 } });
    expect(failureBody(new AppError("VALIDATION", "Bad", { fieldErrors: { a: ["x"] } }), "r1")).toEqual({
      success: false, error: "Bad", code: "VALIDATION", fieldErrors: { a: ["x"] }, requestId: "r1",
    });
    expect(isRouteResult(created({ id: 1 }))).toBe(true);
    expect(created({}).status).toBe(201);
    expect(listResult([], { total: 0, page: 1, pageSize: 100 }).meta?.total).toBe(0);
    expect(isRouteResult({ data: 1 })).toBe(false);
  });
});

describe("structured logger", () => {
  it("writes one JSON line with redaction and level filtering", () => {
    const lines: { level: LogLevel; line: string }[] = [];
    const logger = createLogger({ sink: (level, line) => lines.push({ level, line }), minLevel: "info", now: () => new Date(0) });
    logger.debug("hidden");
    logger.child({ route: "/api/x" }).info("request", { userId: "u1", ms: 3, status: 200, password: "p", nested: { token: "t" } });
    logger.error("boom", { err: new Error("bad") });
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]?.line ?? "{}") as Record<string, unknown>;
    expect(first).toMatchObject({ ts: "1970-01-01T00:00:00.000Z", level: "info", msg: "request", route: "/api/x", userId: "u1", ms: 3, status: 200, password: "[redacted]" });
    expect(first.nested).toEqual({ token: "[redacted]" });
    const second = JSON.parse(lines[1]?.line ?? "{}") as { err: { message: string } };
    expect(second.err.message).toBe("bad");
  });

  it("sanitize truncates deep structures", () => {
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 10; i += 1) deep = { d: deep };
    expect(JSON.stringify(sanitize(deep))).toContain("[truncated]");
  });
});
