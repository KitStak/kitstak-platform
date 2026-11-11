import * as React from "react";
import Link from "next/link";
import { KeyRound, SlidersHorizontal, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

export type AccountSection = "profile" | "password" | "preferences";

const SECTIONS: readonly { readonly key: AccountSection; readonly label: string; readonly href: string; readonly icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "profile", label: "My Profile", href: "/account/profile", icon: UserRound },
  { key: "password", label: "Change Password", href: "/account/password", icon: KeyRound },
  { key: "preferences", label: "Preferences", href: "/account/preferences", icon: SlidersHorizontal },
];

interface AccountShellProps {
  readonly active: AccountSection;
  readonly title: string;
  readonly description: string;
  readonly children: React.ReactNode;
}

/** Shared two-column frame for the user-menu account screens. */
export function AccountShell({ active, title, description, children }: AccountShellProps) {
  return (
    <div className="grid gap-6 px-6 py-5 md:grid-cols-[200px_minmax(0,560px)]">
      <nav aria-label="Account" className="md:pt-1">
        <ul className="flex gap-1 md:flex-col md:gap-0.5">
          {SECTIONS.map((s) => {
            const isActive = s.key === active;
            const Icon = s.icon;
            return (
              <li key={s.key}>
                <Link
                  href={s.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition-colors hover:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40",
                    isActive ? "bg-primary-soft font-semibold text-primary" : "text-body"
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {s.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <section aria-labelledby="account-section-title" className="rounded-xl border border-border bg-surface p-5 shadow-xs">
        <h2 id="account-section-title" className="text-[16px] font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 text-[12px] text-secondary">{description}</p>
        <div className="mt-4">{children}</div>
      </section>
    </div>
  );
}
