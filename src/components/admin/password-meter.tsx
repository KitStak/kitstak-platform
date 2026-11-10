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

const hintsSchema = z.object({ minLength: z.number(), requireUpper: z.boolean(), requireNumber: z.boolean(), requireSymbol: z.boolean() });

/**
 * Server-resolved company policy for the current request (set by the page's RSC guard), so
 * meters show the real rules on first paint even while the API is slow. Never a hard-coded
 * default: without a seed or a response the hook returns `null` and meters say "loading".
 */
const PolicySeedContext = React.createContext<PasswordPolicyHints | null>(null);

export function PasswordPolicySeed({ policy, children }: { readonly policy: PasswordPolicyHints; readonly children: React.ReactNode }) {
  return <PolicySeedContext.Provider value={policy}>{children}</PolicySeedContext.Provider>;
}

/** Pure pick: the live API response wins, then the server seed, else `null` (still loading). */
export function resolvePolicyHints(response: unknown, seed: PasswordPolicyHints | null): PasswordPolicyHints | null {
  const parsed = hintsSchema.safeParse(response);
  return parsed.success ? parsed.data : seed;
}

export function usePasswordPolicy(): PasswordPolicyHints | null {
  const seed = React.useContext(PolicySeedContext);
  const q = useApiQuery<unknown>(["password-policy"], "/api/account/password-policy", { staleTime: 300_000 });
  return resolvePolicyHints(q.data?.data, seed);
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

export function PasswordMeter({ password, policy, id }: { readonly password: string; readonly policy: PasswordPolicyHints | null; readonly id?: string }) {
  if (!policy) {
    return (
      <div id={id} className="mt-1.5 flex items-center gap-2" role="status" aria-live="polite">
        <span className="h-1 flex-1 animate-pulse rounded-full bg-neutral-soft" aria-hidden />
        <span className="text-[11.5px] text-faint">Loading your company&apos;s password policy…</span>
      </div>
    );
  }
  const strength = passwordStrength(password, policy);
  const level = LEVELS[strength] ?? LEVELS[0];
  const checks = passwordChecks(password, policy);
  return (
    <div id={id} className="mt-1.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden>
          {[1, 2, 3, 4].map((i) => <span key={i} className={cn("h-1 rounded-full transition-colors", i <= strength ? level.bar : "bg-neutral-soft")} />)}
        </div>
        <span className={cn("w-16 text-right text-[11px] font-semibold", password ? level.text : "text-faint")} aria-live="polite">{password ? level.label : ""}</span>
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
