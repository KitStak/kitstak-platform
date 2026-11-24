'use client';
/** Test tools (SPEC 6.1). Only rendered in test gateway mode, only for billing managers. */
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { FlaskConical } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { testFailNextPaymentAction, testRunDueAction, testShiftTimeAction } from '@/features/billing/actions';
import { plural } from '../format';

const SHIFTS = [1, 7, 14, 30] as const;

export function TestTools({ trialDaysLeft, hasSubscription }: { readonly trialDaysLeft: number | null; readonly hasSubscription: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (key: string, work: () => Promise<{ ok: boolean; text: string }>) => {
    if (busy) return;
    setBusy(key);
    setResult(null);
    try {
      setResult(await work());
      // The plan just moved on, so an older "Your plan is set to end" line no longer fits. The
      // router still remembers `?notice=` (the flash only cleaned the address bar), and a plain
      // refresh would bring that line back next to the new state. Load the page without it.
      router.replace(pathname);
      router.refresh();
    } catch {
      setResult({ ok: false, text: 'We could not reach KitStak. Check your connection and try again.' });
    }
    setBusy(null);
  };
  const shift = (days: number, key: string) =>
    run(key, async () => {
      const done = await testShiftTimeAction({ days });
      return done.ok ? { ok: true, text: `Moved ${plural(days, 'day', 'days')} ahead.` } : { ok: false, text: done.error.message };
    });

  return (
    <Card data-testid="test-tools" aria-labelledby="test-tools-heading" className="border-dashed border-warning/40 p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning-subtle text-warning-text">
          <FlaskConical aria-hidden className="size-4.5" />
        </span>
        <div className="min-w-0">
          <h2 id="test-tools-heading" className="text-base font-semibold text-fg">
            Test tools
          </h2>
          <p className="text-sm text-fg-secondary">No real money moves. Skip ahead in time to see what happens next.</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {SHIFTS.map((days) => (
          <Button
            key={days}
            variant="secondary"
            size="lg"
            data-testid={`test-tool-shift-${days}`}
            loading={busy === `shift-${days}`}
            disabled={busy !== null && busy !== `shift-${days}`}
            onClick={() => shift(days, `shift-${days}`)}
          >
            Skip ahead {plural(days, 'day', 'days')}
          </Button>
        ))}
        {trialDaysLeft !== null && trialDaysLeft > 0 ? (
          <Button
            variant="secondary"
            size="lg"
            data-testid="test-tool-shift-trial-end"
            loading={busy === 'trial-end'}
            disabled={busy !== null && busy !== 'trial-end'}
            onClick={() => shift(trialDaysLeft, 'trial-end')}
          >
            Skip to the end of the trial
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="lg"
          data-testid="test-tool-run-due"
          loading={busy === 'run'}
          disabled={busy !== null && busy !== 'run'}
          onClick={() =>
            run('run', async () => {
              const done = await testRunDueAction();
              return done.ok
                ? { ok: true, text: `Ran renewals. ${done.data.renewed} paid, ${done.data.failed} failed.` }
                : { ok: false, text: done.error.message };
            })
          }
        >
          Run renewals now
        </Button>
        {hasSubscription ? (
          <Button
            variant="secondary"
            size="lg"
            data-testid="test-tool-fail-next"
            loading={busy === 'fail'}
            disabled={busy !== null && busy !== 'fail'}
            onClick={() =>
              run('fail', async () => {
                const done = await testFailNextPaymentAction();
                return done.ok ? { ok: true, text: 'The next payment will fail.' } : { ok: false, text: done.error.message };
              })
            }
          >
            Make the next payment fail
          </Button>
        ) : null}
      </div>
      {result ? (
        <p role={result.ok ? 'status' : 'alert'} data-testid="test-tools-result" className={result.ok ? 'mt-3 text-sm font-medium text-success-text' : 'mt-3 text-sm font-medium text-danger-text'}>
          {result.text}
        </p>
      ) : null}
    </Card>
  );
}
