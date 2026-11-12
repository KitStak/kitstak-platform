'use client';
/** Shared auth-form pieces, adapted from apps/crm/src/app/(auth)/_components/form-parts.tsx. */
import { forwardRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Eye, EyeOff } from 'lucide-react';
import { Input, cn, type InputProps } from '@/components/ui';

/** Mirrors PASSWORD_*_LENGTH in @kitstak/auth options (kept local so the browser bundle stays lean). */
export const PASSWORD_MIN_LENGTH = 10;
/** 72, not 128: bcrypt-compat credentials ignore bytes past the 72nd (auth review L3). */
export const PASSWORD_MAX_LENGTH = 72;

export function AuthHeading({ title, subtitle }: { readonly title: string; readonly subtitle?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">{title}</h1>
      {subtitle ? <p className="text-md text-fg-secondary">{subtitle}</p> : null}
    </div>
  );
}

export function FormAlert({
  tone = 'error',
  children,
}: {
  readonly tone?: 'error' | 'success';
  readonly children: ReactNode;
}) {
  const Icon = tone === 'error' ? CircleAlert : CircleCheck;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-base animate-fade-in',
        tone === 'error'
          ? 'border-danger/25 bg-danger-subtle text-danger-text'
          : 'border-success/25 bg-success-subtle text-success-text',
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Password input with a show/hide toggle. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type' | 'trailing'>>(
  function PasswordInput(props, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <Input
        ref={ref}
        type={visible ? 'text' : 'password'}
        size="lg"
        spellCheck={false}
        trailing={
          <button
            type="button"
            onClick={() => setVisible((value) => !value)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            className="-mr-1 inline-flex size-7 items-center justify-center rounded-sm text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
          >
            {visible ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </button>
        }
        {...props}
      />
    );
  },
);

export interface PasswordStrength {
  readonly score: 0 | 1 | 2 | 3 | 4;
  readonly label: string;
}

/** Lightweight heuristic strength meter (length + character variety). */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: '' };
  let score = 0;
  if (password.length >= 10) score += 1;
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  const clamped = Math.min(4, score) as PasswordStrength['score'];
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;
  return { score: clamped, label: labels[clamped] };
}

export function StrengthMeter({ password }: { readonly password: string }) {
  const { score, label } = passwordStrength(password);
  if (!password) return null;
  const colors = ['bg-danger', 'bg-danger', 'bg-warning-accent', 'bg-success', 'bg-success'];
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-[var(--duration-normal)]',
              step <= Math.max(1, score) ? colors[score] : 'bg-sunken',
            )}
          />
        ))}
      </div>
      <span className="w-16 text-right text-xs font-semibold text-fg-secondary">{label}</span>
    </div>
  );
}

/** Maps Better Auth error codes to friendly copy. */
export function authErrorMessage(
  error: { readonly code?: string; readonly message?: string; readonly status?: number } | null | undefined,
): string {
  if (!error) return 'Something went wrong. Please try again.';
  if (error.status === 429) return 'Too many attempts. Wait a minute, then try again.';
  switch (error.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'That email and password don’t match. Check them and try again.';
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'An account with this email already exists. Sign in instead.';
    case 'PASSWORD_TOO_SHORT':
      return 'Your password is too short.';
    case 'PASSWORD_TOO_LONG':
      return 'Your password is too long.';
    case 'EMAIL_NOT_VERIFIED':
      return 'Verify your email address before signing in.';
    default:
      return error.message || 'Something went wrong. Please try again.';
  }
}
