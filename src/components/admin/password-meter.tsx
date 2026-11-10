"use client";

/**
 * Live password policy meter: a 4-segment strength bar plus the company policy checklist
 * (`password-checks.ts`). Policy hints come from `GET /api/account/password-policy`.
 */
import * as React from "react";
import { Check, Circle } from "lucide-react";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { useApiQuery } from "@/lib/query-client";
import { passwordChecks, type PasswordPolicyHints } from "@/components/layout/password-checks";

const DEFAULT_HINTS: PasswordPolicyHints = { minLength: 10, requireUpper: true, requireNumber: true, requireSymbol: true };
const hintsSchema = z.object({ minLength: z.number(), requireUpper: z.boolean(), requireNumber: z.boolean(), requireSymbol: z.boolean() });

export function usePasswordPolicy(): PasswordPolicyHints {
  const q = useApiQuery<unknown>(["password-policy"], "/api/account/password-policy", { staleTime: 300_000 });
  const parsed = hintsSchema.safeParse(q.data?.data);
  return parsed.success ? parsed.data : DEFAULT_HINTS;
}

const LEVELS = [
  { label: "Too weak", bar: "bg-danger", text: "text-danger" },
  { label: "Weak", bar: "bg-danger", text: "text-danger" },
  { label: "Fair", bar: "bg-warning", text: "text-warning" },
  { label: "Good", bar: "bg-info", text: "text-info" },
  { label: "Strong", bar: "bg-success", text: "text-success" },
] as const;

/** 0–4: share of policy checks met, +1 for length well past the minimum. */
export function passwordStrength(password: string, policy: PasswordPolicyHints): number {
  if (!password) return 0;
  const checks = passwordChecks(password, policy);
  const met = checks.filter((c) => c.ok).length / checks.length;
  const bonus = password.length >= policy.minLength + 4 ? 1 : 0;
  if (met < 1) return Math.max(1, Math.min(3, Math.round(met * 3)));
  return Math.min(4, 3 + bonus);
}

export function PasswordMeter({ password, policy, id }: { readonly password: string; readonly policy: PasswordPolicyHints; readonly id?: string }) {
  const strength = passwordStrength(password, policy);
  const level = LEVELS[strength] ?? LEVELS[0];
  const checks = passwordChecks(password, policy);
  return (
    <div id={id} className="mt-1.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden>
          {[1, 2, 3, 4].map((i) => <span key={i} className={cn("h-1 rounded-full transition-colors", i <= strength ? level.bar : "bg-neutral-soft")} />)}
        </div>
        <span className={cn("w-16 text-right text-[11px] font-semibold", password ? level.text : "text-faint")} aria-live="polite">{password ? level.label : "—"}</span>
      </div>
      <ul aria-label="Password requirements" className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
        {checks.map((c) => (
          <li key={c.key} className={cn("flex items-center gap-1 text-[11.5px]", c.ok ? "text-success" : "text-faint")}>
            {c.ok ? <Check className="h-3 w-3" aria-hidden /> : <Circle className="h-2.5 w-2.5" aria-hidden />}
            {c.label}
            <span className="sr-only">{c.ok ? "(met)" : "(not met)"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
