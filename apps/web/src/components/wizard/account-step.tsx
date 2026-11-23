'use client';

import { TRIAL_LINE } from '@/lib/pricing';
import type { AccountDraft, AccountErrors } from '@/lib/stak';
import { LINKS } from '../site-links';
import styles from './wizard.module.css';

interface AccountStepProps {
  readonly account: AccountDraft;
  readonly errors: AccountErrors;
  readonly onChange: (patch: Partial<AccountDraft>) => void;
}

const FIELDS: readonly {
  readonly key: keyof AccountDraft;
  readonly label: string;
  readonly type: string;
  readonly autoComplete: string;
  readonly inputMode?: 'email';
  readonly maxLength: number;
  readonly enterKeyHint: 'next' | 'go';
}[] = [
  { key: 'name', label: 'Full name', type: 'text', autoComplete: 'name', maxLength: 100, enterKeyHint: 'next' },
  {
    key: 'email',
    label: 'Work email',
    type: 'email',
    autoComplete: 'email',
    inputMode: 'email',
    maxLength: 120,
    enterKeyHint: 'next',
  },
  {
    key: 'company',
    label: 'Company or team',
    type: 'text',
    autoComplete: 'organization',
    maxLength: 80,
    enterKeyHint: 'go',
  },
];

/** What the visitor does after this step. All three happen in the portal. */
const NEXT_STEPS: readonly { readonly title: string; readonly note: string }[] = [
  {
    title: 'Pick a password',
    note: 'On the next screen. Your name, email and company are already filled in.',
  },
  { title: 'Start your free trial', note: TRIAL_LINE },
  {
    title: 'Follow your setup plan',
    note: 'A short checklist, built from your answers, for your first steps in each app.',
  },
];

/**
 * Account details. They are kept in memory only, never in storage. On "Create my account" they ride
 * to the portal after the "#" in the link, the one part of a link that no server or log ever sees,
 * so sign-up opens with them filled in.
 */
export function AccountStep({ account, errors, onChange }: AccountStepProps) {
  return (
    <div className={styles.fields}>
      {FIELDS.map((field) => {
        const error = errors[field.key];
        const id = `account-${field.key}`;
        return (
          <div key={field.key} className={styles.field} data-invalid={error ? true : undefined}>
            <label htmlFor={id}>{field.label}</label>
            <input
              id={id}
              name={field.key}
              type={field.type}
              inputMode={field.inputMode}
              autoComplete={field.autoComplete}
              autoCapitalize={field.key === 'email' ? 'none' : undefined}
              spellCheck={field.key === 'email' ? false : undefined}
              enterKeyHint={field.enterKeyHint}
              maxLength={field.maxLength}
              required
              value={account[field.key]}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              data-testid={`wizard-${field.key}`}
              onChange={(event) => onChange({ [field.key]: event.target.value })}
            />
            {error ? (
              <p id={`${id}-error`} className={styles.error} role="alert">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
      <p className={styles.reassure}>
        Already have an account? <a href={`${LINKS.portal}/login`}>Sign in</a>
      </p>

      <section className={styles.after} aria-labelledby="after-heading">
        <h2 id="after-heading" className={styles.afterTitle}>
          What happens next
        </h2>
        <ol className={styles.plan}>
          {NEXT_STEPS.map((step, i) => (
            <li key={step.title} style={{ '--i': i } as React.CSSProperties}>
              <span className={styles.planMark} aria-hidden>
                {i + 1}
              </span>
              <span>
                <span className={styles.planTitle}>{step.title}</span>
                <span className={styles.tileNote}>{step.note}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
