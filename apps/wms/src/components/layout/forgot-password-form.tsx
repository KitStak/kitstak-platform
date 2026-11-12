"use client";

import * as React from "react";
import { MailCheck } from "lucide-react";
import { z } from "zod";
import { apiRequest, isApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { TextField } from "@/components/ui/text-field";
import { Spinner } from "@/components/ui/spinner";

export const forgotSchema = z.object({ email: z.string().trim().min(1, "Enter your email address").email("Enter a valid email address").max(254) });

/** Requests a reset link. The answer never reveals whether the account exists. */
export function ForgotPasswordForm() {
  const [email, setEmail] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [status, setStatus] = React.useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const parsed = forgotSchema.safeParse({ email });
  const fieldError = touched && !parsed.success ? parsed.error.issues[0]?.message : undefined;

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setTouched(true);
    if (!parsed.success || status === "sending") return;
    setStatus("sending");
    setError(null);
    try {
      await apiRequest("/api/auth/forgot", { method: "POST", body: parsed.data, skipAuthRedirect: true });
      setStatus("sent");
    } catch (err) {
      setStatus("idle");
      setError(isApiError(err) ? err.message : "Network error. Check your connection and try again.");
    }
  };

  if (status === "sent") {
    return (
      <Callout variant="success" title="Check your inbox">
        If an account exists for <span className="font-semibold">{parsed.success ? parsed.data.email : email}</span>, a reset link is on its way. The link expires soon and can be used once.
      </Callout>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {error ? <Callout variant="error">{error}</Callout> : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="forgot-email" className="text-xs font-semibold text-body">Email <span className="text-danger">*</span></label>
        <TextField id="forgot-email" type="email" autoComplete="email" autoFocus placeholder="you@company.com" value={email} invalid={Boolean(fieldError)} aria-describedby={fieldError ? "forgot-email-error" : undefined} onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched(true)} />
        {fieldError ? <p id="forgot-email-error" className="text-2xs text-danger">{fieldError}</p> : null}
      </div>
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={status === "sending"}>
        {status === "sending" ? <Spinner className="h-4 w-4" label="Sending" /> : <MailCheck className="h-4 w-4" aria-hidden />}
        {status === "sending" ? "Sending link…" : "Send reset link"}
      </Button>
    </form>
  );
}
