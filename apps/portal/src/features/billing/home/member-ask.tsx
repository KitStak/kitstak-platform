'use client';
/**
 * The member's side of Billing (review round 5). A member cannot change the plan, so each app that
 * is not in it gets one button: "Ask Dana to add Projects". One click emails the people who manage
 * billing. The button then reads "Asked today", so nobody wonders whether it worked.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert } from 'lucide-react';
import { AppIcon } from '@kitstak/ui/app-icon';
import type { ProductId } from '@kitstak/billing/catalog';
import { Button } from '@/components/ui';
import { askForAppAction } from '@/server/ask-actions';

export interface MemberAskApp {
  readonly id: ProductId;
  readonly name: string;
  readonly tagline: string;
  readonly askedToday: boolean;
}

export function MemberAsk({
  apps,
  askName,
  focus,
}: {
  readonly apps: readonly MemberAskApp[];
  /** The first name of the person to ask ("Dana"), or null when the owner has no name on file. */
  readonly askName: string | null;
  /** The app a lock screen sent the person here for. Its button holds the focus. */
  readonly focus: ProductId | null;
}) {
  const [asked, setAsked] = useState<ReadonlySet<ProductId>>(() => new Set(apps.filter((app) => app.askedToday).map((app) => app.id)));
  const [pending, setPending] = useState<ProductId | null>(null);
  const [error, setError] = useState<{ readonly id: ProductId; readonly text: string } | null>(null);
  const focusButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    focusButton.current?.focus({ preventScroll: false });
  }, []);

  const ask = async (id: ProductId) => {
    if (pending) return;
    setPending(id);
    setError(null);
    try {
      const result = await askForAppAction({ product: id });
      if (result.ok) setAsked((current) => new Set([...current, id]));
      else setError({ id, text: result.error ?? 'We could not send your ask. Try again.' });
    } catch {
      setError({ id, text: 'We could not reach KitStak. Check your connection and try again.' });
    }
    setPending(null);
  };

  if (apps.length === 0) return null;
  return (
    <section aria-labelledby="member-ask-heading" data-testid="member-ask">
      <h2 id="member-ask-heading" className="text-sm font-semibold text-fg">
        Apps you do not have yet
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {apps.map((app) => {
          const done = asked.has(app.id);
          return (
            <li key={app.id} data-testid={`member-ask-${app.id}`} className="flex flex-col gap-3 rounded-xl border border-border-default bg-panel p-4 shadow-xs sm:flex-row sm:items-center">
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-sunken">
                  <AppIcon app={app.id} size={32} />
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-fg">{app.name}</span>
                  <span className="block text-sm text-fg-secondary">{app.tagline}</span>
                </span>
              </span>
              <span className="flex flex-col gap-1.5 sm:items-end">
                {done ? (
                  <span role="status" data-testid={`member-asked-${app.id}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-success-text">
                    <Check aria-hidden className="size-4" />
                    Asked today
                  </span>
                ) : (
                  <Button
                    ref={focus === app.id ? focusButton : undefined}
                    variant={focus === app.id ? 'primary' : 'secondary'}
                    size="lg"
                    loading={pending === app.id}
                    disabled={pending !== null && pending !== app.id}
                    onClick={() => void ask(app.id)}
                    data-testid={`member-ask-button-${app.id}`}
                    className="w-full sm:w-auto"
                  >
                    {askName ? `Ask ${askName} to add ${app.name}` : `Ask for ${app.name}`}
                  </Button>
                )}
                {error?.id === app.id ? (
                  <span role="alert" className="flex items-start gap-1.5 text-xs font-medium text-danger-text">
                    <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
                    {error.text}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-fg-muted">
        {askName ? `We email ${askName} your ask. You can ask once a day for each app.` : 'We email the people who manage billing. You can ask once a day for each app.'}
      </p>
    </section>
  );
}
