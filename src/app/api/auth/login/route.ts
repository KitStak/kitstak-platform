import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, type SessionUser } from "@/server/auth/session";
import { checkRateLimit } from "@/server/auth/rate-limit";

const loginSchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
});

const INVALID_CREDENTIALS = "Invalid email or password";

/**
 * Dummy bcrypt hash compared against when the user does not exist, so the
 * response time does not reveal whether an email is registered.
 */
const TIMING_PAD_HASH = hashPassword("kitstak-timing-pad");

interface LoginResponseData {
  user: SessionUser;
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "local";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const limit = checkRateLimit(`login:${clientIp(request)}`);
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many login attempts. Please try again shortly." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const parsed = loginSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: INVALID_CREDENTIALS },
        { status: 401 }
      );
    }

    const email = parsed.data.email.toLowerCase();
    const user = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .get();

    const passwordOk = verifyPassword(
      parsed.data.password,
      user?.passwordHash ?? TIMING_PAD_HASH
    );
    if (!user || !user.isActive || !passwordOk) {
      return NextResponse.json(
        { success: false, error: INVALID_CREDENTIALS },
        { status: 401 }
      );
    }

    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    await createSession(sessionUser);

    db.insert(schema.auditLog)
      .values({
        id: randomUUID(),
        userId: user.id,
        action: "auth.login",
        entity: "user",
        entityId: user.id,
        detail: JSON.stringify({ email: user.email }),
        at: new Date().toISOString(),
      })
      .run();

    const data: LoginResponseData = { user: sessionUser };
    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error: unknown) {
    console.error("[kitstak:auth] login failed", error);
    return NextResponse.json(
      { success: false, error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
