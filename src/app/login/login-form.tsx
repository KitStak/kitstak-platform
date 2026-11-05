"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

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

export function LoginForm(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        <h1 className="text-[22px] font-bold tracking-tight text-foreground">Log in</h1>
        <p className="mt-1 text-[13px] text-secondary">
          Welcome back. Enter your credentials to access your warehouse.
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5 text-[12.5px] text-danger"
          >
            <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4" noValidate>
          <Field label="Email" required>
            <Input
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9"
            />
          </Field>

          <Field label="Password" required>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                placeholder="••••••••••"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-9 pr-9"
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
          </Field>

          <div className="flex items-center justify-end">
            <a
              href="#"
              className="text-[12.5px] font-medium text-primary transition-colors hover:text-primary-hover hover:underline"
            >
              Forgot password?
            </a>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={isSubmitting}
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
          <span className="text-[11px] font-medium uppercase tracking-wider text-faint">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button type="button" size="lg" className="mt-5 w-full">
          <KeyRound className="h-4 w-4 text-secondary" aria-hidden />
          Log in with SSO
        </Button>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-surface-sunken px-4 py-3 text-[12px] text-secondary shadow-xs">
        <span className="font-semibold text-body">Demo workspace</span> — sign in with{" "}
        <code className="rounded bg-neutral-soft px-1 py-px font-mono text-[11.5px] text-body">
          admin@kitstak.io
        </code>{" "}
        /{" "}
        <code className="rounded bg-neutral-soft px-1 py-px font-mono text-[11.5px] text-body">
          KitStak!demo2026
        </code>
      </div>
    </div>
  );
}
