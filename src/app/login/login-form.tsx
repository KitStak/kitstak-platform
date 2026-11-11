"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SsoButton } from "./sso-sign-in";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { validateLogin, type LoginField, type LoginFieldErrors } from "./login-schema";

const INVALID_INPUT = "border-danger focus:border-danger focus:ring-danger/20";

interface LoginSuccessResponse {
  success: true;
  data: { user: { id: string; email: string; name: string; role: string } };
}

interface LoginFailureResponse {
  success: false;
  error?: string;
}

type LoginResponse = LoginSuccessResponse | LoginFailureResponse;

function isLoginResponse(value: unknown): value is LoginResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    typeof (value as { success: unknown }).success === "boolean"
  );
}


/** Only allow same-origin relative paths as a post-login destination. */
function safeNextPath(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  return "/dashboard";
}

const noopSubscribe = (): (() => void) => () => undefined;

/** False during SSR and before hydration; true once React owns the form. */
function useHydrated(): boolean {
  return React.useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** Explicit `<label htmlFor>` so "Email*" / "Password*" are the accessible names (not the placeholder). */
function LabeledField({ id, label, error, children }: { readonly id: string; readonly label: string; readonly error?: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-body">
        {label}
        <span className="text-danger" aria-hidden>*</span>
      </label>
      {children}
      {error ? <span id={`${id}-error`} className="text-2xs text-danger">{error}</span> : null}
    </div>
  );
}

export interface LoginFormProps {
  /** Show the seeded demo credentials (non-production builds only). */
  readonly showDemoCredentials?: boolean;
}

export function LoginForm({ showDemoCredentials = false }: LoginFormProps): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();

  const hydrated = useHydrated();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<LoginFieldErrors>({});
  const emailRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);

  const clearFieldError = (field: LoginField): void => {
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    // Validate locally first: an empty submit never reaches the server or the rate limiter.
    const invalid = validateLogin({ email, password });
    setFieldErrors(invalid);
    if (invalid.email || invalid.password) {
      (invalid.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        // Wrong credentials come back as 200 + success:false (no console 401 for an expected outcome).
        headers: { "Content-Type": "application/json", "x-ks-soft-auth-failure": "1" },
        body: JSON.stringify({ email, password }),
      });

      const body: unknown = await response.json().catch(() => null);
      if (response.ok && isLoginResponse(body) && body.success) {
        router.push(safeNextPath(searchParams.get("next")));
        router.refresh();
        return;
      }

      const message =
        isLoginResponse(body) && !body.success && body.error
          ? body.error
          : "Unable to sign in. Please try again.";
      setError(message);
      setIsSubmitting(false);
    } catch {
      setError("Network error. Check your connection and try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-[400px]">
      <div className="rounded-xl border border-border bg-surface p-8 shadow-lg">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Log in</h1>
        <p className="mt-1 text-sm text-secondary">
          Welcome back. Enter your credentials to access your warehouse.
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5 text-xs text-danger"
          >
            <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        {/* method/action: a submit before hydration is a POST (never a GET that puts the password in the URL). */}
        <form method="post" action="/api/auth/login" onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4" noValidate>
          <LabeledField id="login-email" label="Email" error={fieldErrors.email}>
            <Input
              id="login-email"
              aria-label="Email"
              ref={emailRef}
              aria-required
              aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
              aria-invalid={fieldErrors.email ? true : undefined}
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
              autoFocus
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearFieldError("email");
              }}
              className={cn("h-9", fieldErrors.email && INVALID_INPUT)}
            />
          </LabeledField>

          <LabeledField id="login-password" label="Password" error={fieldErrors.password}>
            <div className="relative">
              <Input
                id="login-password"
                aria-label="Password"
                ref={passwordRef}
                aria-required
                aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
                aria-invalid={fieldErrors.password ? true : undefined}
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                placeholder="Password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearFieldError("password");
                }}
                className={cn("h-9 pr-9", fieldErrors.password && INVALID_INPUT)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-faint transition-colors hover:text-secondary focus-visible:text-secondary"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden />
                )}
              </button>
            </div>
          </LabeledField>

          <div className="flex items-center justify-end">
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-primary transition-colors hover:text-primary-hover hover:underline"
            >
              Forgot password?
            </Link>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={isSubmitting || !hydrated}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        <div className="mt-5 flex items-center gap-3" role="separator" aria-label="or">
          <span className="h-px flex-1 bg-border" />
          <span className="text-2xs font-mediumr text-faint">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <SsoButton />
      </div>

      {showDemoCredentials ? (
      <div className="mt-4 rounded-lg border border-border bg-surface-sunken px-4 py-3 text-xs text-secondary shadow-xs">
        <span className="font-semibold text-body">Demo workspace</span> — sign in with{" "}
        <code className="rounded bg-neutral-soft px-1 py-px font-mono text-2xs text-body">
          admin@kitstak.io
        </code>{" "}
        /{" "}
        <code className="rounded bg-neutral-soft px-1 py-px font-mono text-2xs text-body">
          KitStak!demo2026
        </code>
      </div>
      ) : null}
    </div>
  );
}
