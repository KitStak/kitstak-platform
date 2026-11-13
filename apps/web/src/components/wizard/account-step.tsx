'use client';

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
  readonly placeholder: string;
}[] = [
  { key: 'name', label: 'Full name', type: 'text', autoComplete: 'name', placeholder: 'Dana Reyes' },
  { key: 'email', label: 'Work email', type: 'email', autoComplete: 'email', placeholder: 'dana@northwind.example' },
  { key: 'company', label: 'Company or team', type: 'text', autoComplete: 'organization', placeholder: 'Northwind Supply' },
];

/** Account details. Held in memory only; never written to storage or put in a URL. */
export function AccountStep({ account, errors, onChange }: AccountStepProps) {
  return (
    <div className={styles.fields}>
      <p className={styles.reassure}>All three fields are required.</p>
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
              autoComplete={field.autoComplete}
              placeholder={field.placeholder}
              maxLength={120}
              required
              value={account[field.key]}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
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
        You will choose a password on the next screen. Already have an account? <a href={LINKS.portal}>Sign in</a>
      </p>
    </div>
  );
}
