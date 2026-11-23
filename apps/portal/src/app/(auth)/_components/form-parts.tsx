'use client';
/**
 * Shared pieces of the signup and sign in forms. Every control here is at least 44 px tall and
 * types at 16 px on phones, so a thumb can hit it and iOS never zooms the page on focus.
 */
import { forwardRef, useState } from 'react';
import { Check, Eye, EyeOff, X } from 'lucide-react';
import { Button, Input, Spinner, cn, type ButtonProps, type InputProps } from '@/components/ui';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordRules,
  passwordStrength,
} from '@/features/signup/password-rules';

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordStrength };
export { AuthHeading, FormAlert, StepEyebrow } from './heading';
export type { PasswordStrength } from '@/features/signup/password-rules';

/**
 * Classes that bring a portal input up to the form size used on every auth screen: 48 px tall on
 * phones (the field itself clears 44 px), 44 px from the small breakpoint up.
 */
export const AUTH_INPUT_CONTAINER = 'h-12 sm:h-11';
/** Buttons match: 48 px on phones, 44 px from the small breakpoint up. */
export const AUTH_BUTTON_HEIGHT = 'h-12 sm:h-11';
/**
 * Grows the tap area of a small text link or text button to 44 px without moving anything:
 * vertical padding on an inline link does not change the line, and the button form cancels its
 * padding with a negative margin.
 */
export const TAP_LINK = 'py-3.5';
export const TAP_BUTTON = '-my-3.5 py-3.5';
export const AUTH_INPUT_TEXT = 'text-md sm:text-base';

/** The portal input at auth form size: 44 px tall, 16 px type on phones. */
export const AuthInput = forwardRef<HTMLInputElement, InputProps>(function AuthInput(
  { className, containerClassName, ...props },
  ref,
) {
  return (
    <Input
      ref={ref}
      size="lg"
      className={cn(AUTH_INPUT_TEXT, className)}
      containerClassName={cn(AUTH_INPUT_CONTAINER, containerClassName)}
      {...props}
    />
  );
});

/** Password input with a show and hide button. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type' | 'trailing'>>(
  function PasswordInput(props, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <AuthInput
        ref={ref}
        type={visible ? 'text' : 'password'}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        trailing={
          <button
            type="button"
            onClick={() => setVisible((value) => !value)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            className="-mr-2.5 inline-flex size-11 items-center justify-center rounded-md text-icon hover:bg-hover hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
          >
            {visible ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </button>
        }
        {...props}
      />
    );
  },
);

export function StrengthMeter({ password }: { readonly password: string }) {
  const { score, label } = passwordStrength(password);
  if (!password) return null;
  const colors = ['bg-danger', 'bg-danger', 'bg-warning-accent', 'bg-success', 'bg-success'];
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-[var(--duration-normal)] motion-reduce:transition-none',
              step <= Math.max(1, score) ? colors[score] : 'bg-sunken',
            )}
          />
        ))}
      </div>
      <span className="w-16 text-right text-xs font-semibold text-fg-secondary">
        <span className="sr-only">Password strength: </span>
        {label}
      </span>
    </div>
  );
}

/**
 * The four password rules. They are on screen before the first key press, so nobody has to guess
 * what a password needs. Each one turns green as it is met. After the form said no (`showMissing`),
 * the rules that are still missing turn red, all at once, and the form adds no second sentence.
 */
export function PasswordRules({
  password,
  id,
  showMissing = false,
}: {
  readonly password: string;
  readonly id?: string;
  readonly showMissing?: boolean;
}) {
  const rules = passwordRules(password);
  return (
    <ul id={id} className="grid gap-x-4 gap-y-1 sm:grid-cols-2" aria-label="Your password needs" data-testid="password-rules">
      {rules.map((rule) => {
        const missing = showMissing && !rule.met;
        return (
          <li
            key={rule.id}
            data-rule={rule.id}
            data-state={rule.met ? 'met' : missing ? 'missing' : 'open'}
            className={cn(
              'flex items-center gap-1.5 text-xs transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none',
              rule.met ? 'text-success-text' : missing ? 'font-medium text-danger-text' : 'text-fg-muted',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                rule.met ? 'border-success bg-success text-fg-inverse' : missing ? 'border-danger text-danger-text' : 'border-border-strong',
              )}
            >
              {rule.met ? <Check className="size-2.5" strokeWidth={3.5} /> : missing ? <X className="size-2.5" strokeWidth={3.5} /> : null}
            </span>
            {rule.label}
            <span className="sr-only">{rule.met ? ', done' : ', still needed'}</span>
          </li>
        );
      })}
    </ul>
  );
}

export interface SubmitButtonProps extends Omit<ButtonProps, 'loading' | 'type' | 'size'> {
  /** Set while the form is working. The label stays visible, with a spinner beside it. */
  readonly busyLabel?: string | null;
}

/**
 * The main button of an auth form: 44 px tall, full width. While it works it keeps its words
 * ("Creating your account…") beside a spinner, and it cannot be pressed a second time.
 */
export function SubmitButton({ busyLabel, children, disabled, className, ...props }: SubmitButtonProps) {
  const busy = typeof busyLabel === 'string';
  return (
    <Button
      type="submit"
      size="lg"
      fullWidth
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(AUTH_BUTTON_HEIGHT, busy && 'disabled:opacity-100', className)}
      leadingIcon={busy ? <Spinner size="sm" label={null} /> : undefined}
      {...props}
    >
      {busy ? busyLabel : children}
    </Button>
  );
}

/** Maps Better Auth error codes to plain words that name the problem and the fix. */
export function authErrorMessage(
  error: { readonly code?: string; readonly message?: string; readonly status?: number } | null | undefined,
): string {
  if (!error) return 'Something went wrong. Please try again.';
  if (error.status === 429) return 'Too many tries. Wait a few minutes and try again.';
  switch (error.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'That email and password do not match. Check them and try again.';
    case 'INVALID_EMAIL':
      return 'Enter a valid work email.';
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'An account with this email already exists. Sign in to keep going.';
    case 'PASSWORD_TOO_SHORT':
      return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
    case 'PASSWORD_TOO_LONG':
      return `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`;
    case 'EMAIL_NOT_VERIFIED':
      return 'Verify your email address before signing in.';
    default:
      return error.message || 'Something went wrong. Please try again.';
  }
}

export const NO_NETWORK_MESSAGE = 'We could not reach KitStak. Check your connection and try again.';

/** True for the "this email already has an account" answers from Better Auth. */
export function isEmailTaken(error: { readonly code?: string } | null | undefined): boolean {
  return error?.code === 'USER_ALREADY_EXISTS' || error?.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL';
}
