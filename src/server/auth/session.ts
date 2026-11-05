import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "kitstak_session";

const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours
const JWT_ALG = "HS256";

export type SessionRole = "admin" | "manager" | "operator" | "viewer";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: SessionRole;
}

const ROLES: readonly SessionRole[] = ["admin", "manager", "operator", "viewer"];

function isSessionRole(value: unknown): value is SessionRole {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

let warnedMissingSecret = false;

/**
 * Resolve the signing secret. In production a missing SESSION_SECRET is fatal;
 * in development we derive a stable (but insecure) fallback and warn once.
 */
function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) {
    return new TextEncoder().encode(secret);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is not configured. Set a strong random value (64 hex chars) in the environment."
    );
  }
  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    console.error(
      "[kitstak:auth] SESSION_SECRET is missing — using an insecure, derived dev-only fallback. " +
        "Create .env.local with SESSION_SECRET (see .env.example)."
    );
  }
  const derived = createHash("sha256")
    .update("kitstak-dev-fallback-session-secret")
    .digest("hex");
  return new TextEncoder().encode(derived);
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Sign a session JWT for the user and set it as an httpOnly cookie. */
export async function createSession(user: SessionUser): Promise<void> {
  const token = await new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: JWT_ALG })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** Clear the session cookie. */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: 0,
  });
}

/**
 * Verify the session JWT from the request cookie.
 * Returns the session user, or null on any failure (missing, expired, tampered).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!token) return null;

    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: [JWT_ALG],
    });

    const id: unknown = payload.sub;
    const email: unknown = payload.email;
    const name: unknown = payload.name;
    const role: unknown = payload.role;

    if (
      typeof id !== "string" ||
      typeof email !== "string" ||
      typeof name !== "string" ||
      !isSessionRole(role)
    ) {
      return null;
    }

    return { id, email, name, role };
  } catch {
    return null;
  }
}
