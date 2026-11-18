'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { accountErrors } from '@/lib/stak';
import type { AccountErrors } from '@/lib/stak';
import { CONTACT } from '../site-links';
import { TOPICS, buildMailto, parseProduct, parseTopic, starterMessage } from './contact-model';
import type { ContactDraft } from './contact-model';
import styles from './contact.module.css';

const MAX_MESSAGE = 1200;

/**
 * Contact form. PLACEHOLDER transport: there is no backend yet, so submitting opens the visitor's
 * own email app with the message filled in. Nothing is sent from this page.
 */
export function ContactForm() {
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState<ContactDraft>(() => {
    const topic = parseTopic(searchParams.get('topic'));
    return {
      topic,
      name: '',
      email: '',
      company: '',
      message: starterMessage(topic, parseProduct(searchParams.get('product'))),
    };
  });
  const [errors, setErrors] = useState<AccountErrors>({});
  const [isOpened, setIsOpened] = useState(false);

  const topic = TOPICS.find((t) => t.id === draft.topic) ?? TOPICS[TOPICS.length - 1]!;
  const set = (patch: Partial<ContactDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setIsOpened(false);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const found = accountErrors(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const first = (['name', 'email', 'company'] as const).find((field) => found[field]);
      window.requestAnimationFrame(() => document.getElementById(`contact-${first}`)?.focus());
      return;
    }
    window.location.href = buildMailto(draft);
    setIsOpened(true);
  };

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <fieldset className={styles.topics}>
        <legend>What can we help with?</legend>
        <div className={styles.topicList}>
          {TOPICS.map((option) => (
            <label key={option.id} className={styles.topic} data-checked={option.id === draft.topic || undefined}>
              <input
                type="radio"
                name="topic"
                className="visually-hidden"
                checked={option.id === draft.topic}
                onChange={() => set({ topic: option.id })}
              />
              {option.label}
            </label>
          ))}
        </div>
        <p className={styles.topicNote} key={topic.id}>
          {topic.note}
        </p>
      </fieldset>

      <p className={styles.fine}>Name, email and company are required.</p>
      <div className={styles.row}>
        <Field id="contact-name" label="Full name" error={errors.name}>
          <input
            id="contact-name"
            type="text"
            autoComplete="name"
            maxLength={120}
            required
            value={draft.name}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? 'contact-name-error' : undefined}
            onChange={(event) => set({ name: event.target.value })}
          />
        </Field>
        <Field id="contact-email" label="Work email" error={errors.email}>
          <input
            id="contact-email"
            type="email"
            autoComplete="email"
            maxLength={120}
            required
            value={draft.email}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'contact-email-error' : undefined}
            onChange={(event) => set({ email: event.target.value })}
          />
        </Field>
      </div>
      <Field id="contact-company" label="Company" error={errors.company}>
        <input
          id="contact-company"
          type="text"
          autoComplete="organization"
          maxLength={120}
          required
          value={draft.company}
          aria-invalid={errors.company ? true : undefined}
          aria-describedby={errors.company ? 'contact-company-error' : undefined}
          onChange={(event) => set({ company: event.target.value })}
        />
      </Field>
      <Field id="contact-message" label={topic.prompt}>
        <textarea
          id="contact-message"
          rows={5}
          maxLength={MAX_MESSAGE}
          value={draft.message}
          onChange={(event) => set({ message: event.target.value })}
        />
      </Field>

      <div className={styles.submit}>
        <button type="submit" className="btn btn-primary btn-lg">
          {topic.action} <span className="btn-arrow" aria-hidden>→</span>
        </button>
        <p className={styles.fine}>
          Opens your email app with this message addressed to {CONTACT.email}. Nothing is sent from this page.
        </p>
      </div>
      <div role="status">
        {isOpened ? (
          <p className={styles.opened}>
            Your email app should have opened with the message ready. If it did not, write to{' '}
            <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>.
          </p>
        ) : null}
      </div>
    </form>
  );
}

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly error?: string;
  readonly children: React.ReactNode;
}

function Field({ id, label, error, children }: FieldProps) {
  return (
    <div className={styles.field} data-invalid={error ? true : undefined}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
