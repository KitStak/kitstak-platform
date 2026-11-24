'use client';
/**
 * Shared pieces of the signup and sign in forms. Every control here is at least 44 px tall and
 * types at 16 px on phones, so a thumb can hit it and iOS never zooms the page on focus.
 */
import { forwardRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import Link from 'next/link';
import { Check, CircleAlert, Eye, EyeOff, X } from 'lucide-react';
import { Badge, Button, Input, Spinner, cn, type ButtonProps, type InputProps } from '@/components/ui';
import { emailHint } from '@/features/signup/email-hint';
import { meterStrength, passwordWarning } from '@/features/signup/password-meter';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PASSPHRASE_LENGTH,
  isPassphrase,
  isRulesIssue,
  passwordRules,
  passwordStrength,
  type PasswordContext,
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
/**
 * A quiet text button that stands in a row of its own ("Email me a code instead"). It reads as a
 * link (underlined), it is a real 44 px tall so a thumb can hit it, and the row gives it room, so
 * its focus ring never runs through the text above or below it (review round 4). Use it inside
 * `QuietRow`. For a link in the middle of a sentence use `TAP_BUTTON`.
 */
export const ROW_LINK =
  'inline-flex min-h-11 items-center rounded-md px-1 font-medium text-fg-link underline decoration-border-strong underline-offset-4 hover:decoration-fg disabled:cursor-not-allowed disabled:text-fg-muted disabled:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
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

/**
 * A quiet row under a form's main button: a few plain words, then one `ROW_LINK` button. The row is
 * 44 px tall and sits a full form gap away from its neighbours, so the button's focus ring touches
 * no other text.
 */
export function QuietRow({ lead, children, className, ...props }: { readonly lead?: string; readonly children: ReactNode; readonly className?: string } & HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('flex min-h-11 flex-wrap items-center justify-center gap-x-1.5 text-center text-sm text-fg-secondary', className)} {...props}>
      {lead ? <span>{lead}</span> : null}
      {children}
    </p>
  );
}

/**
 * The test mode hint on every screen that waits for an emailed code (verify email, reset password,
 * sign in with a code): the "Test mode" pill and the way to the dev outbox, where the code is. One
 * look on all three (review round 4). Only rendered when emails land in the dev outbox.
 */
export function OutboxHint({ testId }: { readonly testId?: string }) {
  return (
    <div data-testid={testId} className="flex flex-wrap items-center gap-2 rounded-lg border border-border-default bg-sunken/60 px-3.5 py-3 text-sm text-fg-secondary">
      <Badge tone="info">
        <span data-testid="test-mode-label">Test mode</span>
      </Badge>
      <span>
        <Link href="/dev/outbox" target="_blank" className={`${TAP_LINK} font-semibold text-fg-link underline underline-offset-2`}>
          Open the email outbox
        </Link>{' '}
        to see your code.
      </span>
    </div>
  );
}

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

/**
 * The strength bar. With `context` (the email, the company) it never says "Good" or "Strong" for a
 * password the server would refuse: one built on the email name or the company name, a repeated
 * word, a run of keys, a common password.
 */
export function StrengthMeter({ password, context }: { readonly password: string; readonly context?: PasswordContext }) {
  const { score, label } = meterStrength(password, context);
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
 * What a password needs, said under the field. Every word here is true for what is typed
 * (review round 3):
 *   - Before typing: the easy way in one line (15 or more characters). From 640 px up the four
 *     short rules are listed too. On a phone they wait for the first key, so the fields under the
 *     password stay on the first screen.
 *   - While typing a short password: the four rules, each green only when it is really met.
 *   - 15 characters or more: the four rules fold away, because they are not needed. One green
 *     line stays: "15 or more characters. That is enough."
 *   - A password the server would refuse for another reason (the email name, easy to guess): a
 *     warning says so at once, and nothing reads "enough" or "done". When that password is 15
 *     characters or more, the warning stands alone: "15 is enough" is not true for it.
 * After the form said no (`showMissing`), the rules that are still missing turn red, all at once,
 * and the form adds no second sentence.
 *
 * One place for the red line (review round 4): right under the field and its meter, above the
 * rules, with nothing in between. While typing it is the live warning. After the form said no it
 * is the field's own error (`error`), in the same spot, so the sentence never jumps and never ends
 * up under some other control. The field prints that error for screen readers only.
 */
export function PasswordRules({
  password,
  id,
  showMissing = false,
  context,
  error = null,
}: {
  readonly password: string;
  readonly id?: string;
  readonly showMissing?: boolean;
  /** The email and the company the password must not be built on. */
  readonly context?: PasswordContext;
  /**
   * The field's error when it is not about the checklist ("Enter a password.", "Do not use your
   * company name in your password."). Shown here, in the warning's place. See `passwordFieldError`.
   */
  readonly error?: string | null;
}) {
  const rules = passwordRules(password);
  const long = isPassphrase(password);
  const warning = passwordWarning(password, context);
  // The refusal comes first. Else the live warning, which also stays when the refusal is about the
  // checklist (the missing rules turn red and the name warning is still true).
  const line = error || warning;
  const enough = long && warning === null && !error;
  const typing = password.length > 0 || showMissing;
  return (
    <div id={id} className="flex flex-col gap-1.5">
      {line ? (
        // The field already announces its error (`role="alert"`, for screen readers only), so the
        // same words are not announced twice here.
        <p
          role={error ? undefined : 'status'}
          aria-hidden={error ? true : undefined}
          data-testid={error ? 'password-error' : 'password-warning'}
          className="flex items-start gap-1.5 text-xs font-medium text-danger-text"
        >
          <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          {line}
        </p>
      ) : null}
      {enough ? (
        // The long rule is met: the short rules are not needed, so they are not listed as "done".
        <p data-testid="password-passphrase-hint" data-state="met" className="flex items-center gap-1.5 text-xs font-medium text-success-text">
          <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center rounded-full border border-success bg-success text-fg-inverse">
            <Check className="size-2.5" strokeWidth={3.5} />
          </span>
          {PASSWORD_PASSPHRASE_LENGTH} or more characters. That is enough.
        </p>
      ) : long ? null : (
        // (Long and still refused shows nothing here: the line above is the whole answer, and
        // "15 is enough" would not be true for that password.)
        // The easy way, said first: a long password needs nothing else (review round 2).
        // On a phone, before the first key, it is one line: the fields under the password and the
        // button stay on the first screen. The rest of the sentence shows with the first key.
        <p data-testid="password-passphrase-hint" data-state="open" className="text-xs text-fg-secondary">
          {PASSWORD_PASSPHRASE_LENGTH} or more characters is enough by itself.
          <span className={cn(!typing && 'max-sm:hidden')}> A few words work well.</span>
          <span className={cn(!typing && 'max-sm:hidden')}> Or use a shorter one with all of these:</span>
        </p>
      )}
      <ul
        className={cn('grid gap-x-4 gap-y-1 sm:grid-cols-2', long && 'hidden', !typing && 'max-sm:hidden')}
        aria-label="Your password needs"
        data-testid="password-rules"
      >
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
    </div>
  );
}

/**
 * The part of a password field's error that `PasswordRules` prints in the warning's place: every
 * error that is not about the checklist. A checklist error is shown by the rules turning red, so
 * it has no sentence. Pass the result to `PasswordRules` as `error`, and give the `Field`
 * `errorHidden` so the sentence is on screen once.
 */
export function passwordFieldError(password: string, error: string | null | undefined): string | null {
  if (!error) return null;
  return isRulesIssue(password) ? null : error;
}

/**
 * "Did you mean gmail.com?" under an email field, for an address with a likely typo
 * (`dana@gmial.com`). Pressing the name puts the fixed address in the field. Nothing changes by
 * itself, and a company domain the hint does not know is left alone. Renders nothing otherwise.
 */
export function EmailHintLine({ email, onUse }: { readonly email: string; readonly onUse: (fixed: string) => void }) {
  const hint = emailHint(email);
  if (!hint) return null;
  return (
    <span data-testid="email-hint" className="text-xs text-fg-secondary">
      Did you mean{' '}
      <button
        type="button"
        data-testid="email-hint-use"
        onClick={() => onUse(hint.email)}
        className={`${TAP_BUTTON} rounded-sm font-semibold text-fg-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus`}
      >
        {hint.domain}
      </button>
      ?
    </span>
  );
}

/** True when `EmailHintLine` would show something. For a field that only passes a hint when there is one. */
export function hasEmailHint(email: string): boolean {
  return emailHint(email) !== null;
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

/** "Too many tries" with the real wait: the length of the limit's window, so it is never too short. */
export function tooManyTries(waitMinutes: number): string {
  return `Too many tries. Wait ${waitMinutes === 1 ? '1 minute' : `${waitMinutes} minutes`} and try again.`;
}

/**
 * Maps Better Auth error codes to plain words that name the problem and the fix. `waitMinutes` is
 * the window of the form's rate limit (`createAuth` in @kitstak/auth): 1 minute for sign in and for
 * a password change, 10 minutes for the rest. The message says how long, not "a few minutes".
 */
export function authErrorMessage(
  error: { readonly code?: string; readonly message?: string; readonly status?: number } | null | undefined,
  waitMinutes: number = 10,
): string {
  if (!error) return 'Something went wrong. Please try again.';
  if (error.status === 429) return tooManyTries(waitMinutes);
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
