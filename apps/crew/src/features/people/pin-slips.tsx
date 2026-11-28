'use client';
/**
 * PIN slips (docs/crew/SPEC.md section 7): a print view with name, number and a random starting
 * PIN per person. The PINs come from the server once and live only in this view: close it and they
 * are gone. Printing shows only the slips (globals.css hides the rest of the page).
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound, Printer, X } from 'lucide-react';
import { Button, type ButtonVariant } from '@/components/ui';
import { issuePinSlipsAction } from '@/server/actions/people';
import type { PinSlip } from '@/server/domain/people';
import { useRun } from './bits';

export function PinSlipsView({ slips, onClose }: { readonly slips: readonly PinSlip[]; readonly onClose: () => void }) {
  return createPortal(
    <div id="crew-pin-slips" role="dialog" aria-modal="true" aria-label="PIN slips" className="fixed inset-0 z-[var(--z-modal)] overflow-auto bg-app p-6 print:static print:overflow-visible print:bg-white print:p-0" data-testid="pin-slips">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div>
            <h2 className="text-xl font-semibold text-fg">PIN slips for {slips.length} {slips.length === 1 ? 'person' : 'people'}</h2>
            <p className="text-sm text-fg-secondary">These PINs show only now. Print them before you close this, then hand each slip to its person.</p>
          </div>
          <div className="flex gap-2">
            <Button leadingIcon={<Printer aria-hidden />} onClick={() => window.print()} data-testid="pin-slips-print">
              Print
            </Button>
            <Button variant="secondary" leadingIcon={<X aria-hidden />} onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-2">
          {slips.map((slip) => (
            <li key={slip.personId} className="break-inside-avoid rounded-lg border border-dashed border-border-strong bg-panel p-4 text-fg print:border-black print:text-black" data-testid="pin-slip">
              <p className="text-xs font-medium tracking-wide text-fg-muted uppercase print:text-black">KitStak Crew time clock</p>
              <p className="mt-1 text-lg font-semibold">{slip.name}</p>
              <p className="text-sm text-fg-secondary print:text-black">{slip.siteName ?? ''}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <dt className="text-xs text-fg-muted print:text-black">Number</dt>
                  <dd className="font-mono text-xl font-semibold tabular-nums">{slip.number}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted print:text-black">Starting PIN</dt>
                  <dd className="font-mono text-xl font-semibold tracking-[0.2em] tabular-nums" data-testid="pin-slip-pin">
                    {slip.pin}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-fg-muted print:text-black">Type your number, then this PIN, at the time clock. Keep it to yourself.</p>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

/** A button that makes new starting PINs for the people and opens the print view. */
export function PinSlipsButton({ personIds, label = 'Print PIN slips', variant = 'secondary', disabled, testId = 'print-pin-slips' }: { readonly personIds: readonly string[]; readonly label?: string; readonly variant?: ButtonVariant; readonly disabled?: boolean; readonly testId?: string }) {
  const { run, pending } = useRun();
  const [slips, setSlips] = useState<readonly PinSlip[] | null>(null);
  const open = async () => {
    const made = await run('slips', () => issuePinSlipsAction({ personIds: [...personIds] }), { failure: 'Could not make PIN slips', refresh: false });
    if (made) setSlips(made);
  };
  return (
    <>
      <Button variant={variant} leadingIcon={<KeyRound aria-hidden />} loading={pending === 'slips'} disabled={disabled || personIds.length === 0} onClick={() => void open()} data-testid={testId}>
        {label}
      </Button>
      {slips ? <PinSlipsView slips={slips} onClose={() => setSlips(null)} /> : null}
    </>
  );
}
