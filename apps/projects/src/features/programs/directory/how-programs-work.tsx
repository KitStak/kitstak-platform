'use client';
/**
 * "How programs work" (docs/programs/SPEC.md 5.3 empty state): a 3 step explainer with drawings
 * and no numbers: "Add the kits you build", "Set one price card", "Log what you build each day".
 */
import { useRouter } from 'next/navigation';
import { ClipboardCheck, Layers, Receipt, type LucideIcon } from 'lucide-react';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui';
import { routes } from '@/lib/routes';

const STEPS: readonly { readonly icon: LucideIcon; readonly title: string; readonly text: string; readonly tone: string }[] = [
  { icon: Layers, title: 'Add the kits you build', text: 'Make every size and color at once with the variant maker, or paste the SKUs you already have.', tone: 'blue' },
  { icon: Receipt, title: 'Set one price card', text: 'One rate for every kit, or a rate per kit. Add a monthly fee or a minimum when the deal has one.', tone: 'green' },
  { icon: ClipboardCheck, title: 'Log what you build each day', text: 'Each day the floor logs what got built. Revenue, the statement and Pulse stay up to date on their own.', tone: 'orange' },
];

function StepArt({ icon: Icon, tone, index }: { readonly icon: LucideIcon; readonly tone: string; readonly index: number }) {
  return (
    <div aria-hidden className="relative flex h-24 items-center justify-center overflow-hidden rounded-lg border border-border-subtle" style={{ background: `var(--label-${tone}-subtle)` }}>
      <div className="absolute inset-x-4 bottom-3 flex gap-1.5">
        {Array.from({ length: 4 }, (_, bar) => (
          <span key={bar} className="h-2 flex-1 rounded-full bg-panel/80" style={{ opacity: bar <= index + 1 ? 1 : 0.45 }} />
        ))}
      </div>
      <span className="flex size-12 items-center justify-center rounded-xl bg-panel shadow-sm" style={{ color: `var(--label-${tone}-text)` }}>
        <Icon className="size-6" />
      </span>
    </div>
  );
}

export function HowProgramsWork({ open, onOpenChange, canCreate }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly canCreate: boolean }) {
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader title="How programs work" description="A program is ongoing work for one customer: the same kits, built again and again, under one price card." />
        <DialogBody>
          <ol className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-2.5">
                <StepArt icon={step.icon} tone={step.tone} index={index} />
                <p className="flex items-center gap-2 text-sm font-semibold text-fg">
                  <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold text-fg-secondary">{index + 1}</span>
                  {step.title}
                </p>
                <p className="text-sm text-fg-secondary">{step.text}</p>
              </li>
            ))}
          </ol>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {canCreate ? (
            <Button
              onClick={() => {
                onOpenChange(false);
                router.push(routes.newProgram());
              }}
            >
              New program
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
