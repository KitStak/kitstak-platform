'use client';
/**
 * Email entry with chips + per-invitee role list. Typing Enter, comma, space or Tab commits
 * an address; pasting a list ("Ana <ana@x.com>, bo@y.io") adds them all; Backspace on an empty
 * field removes the last invitee. Invalid input stays in the field with an inline error.
 */
import { useId, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { AtSign, CircleAlert, X } from 'lucide-react';
import { Avatar, IconButton, Select, cn } from '@/components/ui';
import {
  MAX_INVITEES,
  describeParseProblems,
  parseInvitees,
  roleHint,
  type InviteRole,
  type InviteRoleOption,
  type Invitee,
} from '../model/invites';

export interface InviteeListProps {
  readonly invitees: readonly Invitee[];
  readonly onChange: (invitees: Invitee[]) => void;
  readonly roles: readonly InviteRoleOption[];
  readonly defaultRole: InviteRole;
  readonly onDefaultRoleChange: (role: InviteRole) => void;
  /** Addresses that cannot be invited again (already pending / members). */
  readonly blocked?: ReadonlySet<string>;
  /** Addresses of current members ("Already a member" before sending). */
  readonly members?: ReadonlySet<string>;
  /** Per-email server errors from the last send. */
  readonly rowErrors?: Readonly<Record<string, string>>;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  /** The signed-in user's address ("That's you" instead of a chip). */
  readonly selfEmail?: string | null;
  /** Called on Enter in an empty field (submit shortcut). */
  readonly onSubmitShortcut?: () => void;
}

export function InviteeList({
  invitees,
  onChange,
  roles,
  defaultRole,
  onDefaultRoleChange,
  blocked,
  members,
  rowErrors = {},
  selfEmail,
  disabled,
  autoFocus,
  onSubmitShortcut,
}: InviteeListProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const commit = (raw: string) => {
    if (!raw.trim()) return true;
    const parsed = parseInvitees(raw, invitees, defaultRole, blocked, members, selfEmail);
    if (parsed.added.length) onChange([...invitees, ...parsed.added]);
    setDraft(parsed.invalid.join(' '));
    setProblem(describeParseProblems(parsed));
    return parsed.invalid.length === 0;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!draft.trim()) onSubmitShortcut?.();
      else commit(draft);
      return;
    }
    if ((event.key === ',' || event.key === ' ' || event.key === ';' || event.key === 'Tab') && draft.trim()) {
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === 'Backspace' && !draft && invitees.length) {
      onChange(invitees.slice(0, -1));
      // The list changed: an earlier "up to 50" or duplicate message no longer applies.
      setProblem(null);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    if (!/[\s,;<]/.test(text)) return;
    event.preventDefault();
    commit(`${draft} ${text}`);
  };

  const setRole = (email: string, role: InviteRole) =>
    onChange(invitees.map((invitee) => (invitee.email === email ? { ...invitee, role } : invitee)));
  const remove = (email: string) => {
    onChange(invitees.filter((invitee) => invitee.email !== email));
    setProblem(null);
  };
  const roleOptions = roles.map((role) => ({ value: role.value, label: role.label, description: role.description }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={inputId} className="text-sm font-semibold text-fg-secondary">
            Email addresses
          </label>
          <span className="text-xs text-fg-muted tabular-nums" aria-live="polite">
            {invitees.length}/{MAX_INVITEES}
          </span>
        </div>
        {/* Grid with order: on phones the error/hint sits right under the email field, above the role select. */}
        <div className="grid grid-cols-1 gap-x-2 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <div
            data-invalid={problem ? 'true' : undefined}
            className={cn(
              // shrink-0 + basis-auto: in the stacked mobile layout flex-1 (basis 0) would collapse h-10.
              'order-1 flex h-10 min-h-10 min-w-0 items-center gap-2 rounded-sm border bg-panel px-3',
              'border-border-input transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-border-input-hover',
              'focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--focus-ring-soft)] focus-within:hover:border-primary',
              'data-[invalid=true]:border-danger',
              disabled && 'opacity-60',
            )}
          >
            <AtSign aria-hidden className="size-4 shrink-0 text-icon" />
            <input
              id={inputId}
              data-testid="invite-email-input"
              autoFocus={autoFocus}
              type="text"
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              value={draft}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? errorId : `${inputId}-hint`}
              onChange={(event) => {
                setDraft(event.target.value);
                if (problem) setProblem(null);
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onBlur={() => commit(draft)}
              placeholder={invitees.length ? 'Add another email' : 'name@company.com, teammate@company.com'}
              className="h-full min-w-0 flex-1 bg-transparent text-base text-fg outline-none"
            />
          </div>
          <Select
            aria-label="Role for new invitees"
            size="lg"
            value={defaultRole}
            onValueChange={(value) => onDefaultRoleChange(value as InviteRole)}
            options={roleOptions}
            className="order-3 max-sm:mt-1 sm:order-2"
            disabled={disabled}
          />
          {problem ? (
            <p id={errorId} role="alert" className="order-2 flex items-start gap-1 text-sm text-danger-text sm:order-3 sm:col-span-2">
              <CircleAlert aria-hidden className="mt-[3px] size-3.5 shrink-0" />
              {problem}
            </p>
          ) : (
            <p
              id={`${inputId}-hint`}
              className="order-2 flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-sm text-fg-muted sm:order-3 sm:col-span-2"
            >
              <span>Press Enter or comma after each address. You can paste a whole list.</span>
              <span className="text-fg-secondary max-sm:hidden" data-testid="invite-role-hint">
                {roleHint(defaultRole)}
              </span>
            </p>
          )}
        </div>
        <p className="text-sm text-fg-secondary sm:hidden" data-testid="invite-role-hint-mobile">
          {roleHint(defaultRole)}
        </p>
      </div>

      {invitees.length ? (
        <ul aria-label="People to invite" className="flex max-h-56 flex-col overflow-y-auto rounded-lg border border-border-subtle">
          {invitees.map((invitee) => {
            const error = rowErrors[invitee.email];
            return (
              <li
                key={invitee.email}
                data-testid="invitee-row"
                className="flex animate-fade-in flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border-subtle px-3 py-2 last:border-b-0 sm:flex-nowrap"
              >
                <Avatar name={invitee.name ?? invitee.email} colorKey={invitee.email} size="sm" />
                <div className="min-w-0 flex-1">
                  {invitee.name ? (
                    <>
                      <p className="truncate text-base font-medium text-fg" data-testid="invitee-name">
                        {invitee.name}
                      </p>
                      <p className="truncate text-xs text-fg-secondary" title={invitee.email}>
                        {invitee.email}
                      </p>
                    </>
                  ) : (
                    <p className="truncate text-base text-fg" title={invitee.email}>
                      {invitee.email}
                    </p>
                  )}
                  {error ? (
                    <p role="alert" className="truncate text-xs text-danger-text">
                      {error}
                    </p>
                  ) : null}
                </div>
                <IconButton
                  label={`Remove ${invitee.email}`}
                  icon={<X aria-hidden />}
                  size="sm"
                  onClick={() => remove(invitee.email)}
                  disabled={disabled}
                  className="sm:order-last"
                />
                {/* Phones: the email keeps the full row; the role moves to its own line. */}
                <span className="max-sm:basis-full max-sm:pl-9">
                  <Select
                    aria-label={`Role for ${invitee.email}`}
                    size="sm"
                    value={invitee.role}
                    onValueChange={(value) => setRole(invitee.email, value as InviteRole)}
                    options={roleOptions}
                    className="w-28"
                    disabled={disabled}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
