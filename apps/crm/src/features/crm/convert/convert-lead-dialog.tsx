'use client';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Building2, CheckCircle2, Handshake, UserRound } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  Input,
  Select,
  WizardFooter,
  WizardSteps,
  cn,
  toast,
} from '@/components/ui';
import { useOrg } from '@/features/shell/org-context';
import { routes } from '@/features/shell/routes';
import { errorMessage } from '@/lib/hooks/cache';
import type {
  ConversionPreviewDto,
  ConversionResultDto,
  ConvertLeadInput,
  MatchCandidateDto,
} from '@/server/services/crm-contracts';
import { useConversionPreview, useConvertLead } from '../api';
import { CardSkeleton, ErrorBlock, Radio, StagePill } from '../components/crm-ui';
import { todayIso } from '../lib/format';

export interface ConvertLeadDialogProps {
  readonly itemId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConverted?: (result: ConversionResultDto) => void;
}

const STEPS = [
  { id: 'account', title: 'Account' },
  { id: 'contact', title: 'Contact' },
  { id: 'deal', title: 'Deal' },
] as const;

interface Draft {
  accountChoice: string; // match id or 'new'
  accountName: string;
  website: string;
  contactChoice: string;
  contactName: string;
  email: string;
  phone: string;
  title: string;
  fillEmpty: boolean;
  createDeal: boolean;
  dealName: string;
  amount: string;
  stageId: string;
  closeDate: string;
  ownerId: string;
}

function initialDraft(preview: ConversionPreviewDto): Draft {
  const { lead } = preview;
  const strongAccount = preview.accountMatches.find((match) => match.confidence === 'high');
  const strongContact = preview.contactMatches.find((match) => match.confidence === 'high');
  const closeDate = new Date();
  closeDate.setDate(closeDate.getDate() + 45);
  return {
    accountChoice: strongAccount?.id ?? 'new',
    accountName: lead.company ?? '',
    website: lead.domain ?? '',
    contactChoice: strongContact?.id ?? 'new',
    contactName: lead.name,
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    title: lead.title ?? '',
    fillEmpty: true,
    createDeal: Boolean(preview.boards.deals),
    dealName: `${lead.company ?? lead.name}: New deal`,
    amount: '',
    stageId: preview.defaultStageId ?? '',
    closeDate: todayIso(closeDate),
    ownerId: lead.owner?.id ?? '',
  };
}

const REASON_TEXT: Readonly<Record<MatchCandidateDto['reason'], string>> = {
  email: 'Same email',
  domain: 'Same domain',
  name: 'Same name',
};

/** Inline validation for the optional deal amount (null when valid). */
export function amountError(raw: string): string | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 'Enter a number';
  if (value < 0) return 'Amount can’t be negative';
  return null;
}

/** Lead → Account + Contact (+ Deal) conversion wizard with duplicate detection. */
export function ConvertLeadDialog({ itemId, open, onOpenChange, onConverted }: ConvertLeadDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="crm-convert-dialog">
        {open ? <ConvertBody itemId={itemId} onClose={() => onOpenChange(false)} onConverted={onConverted} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ConvertBody({
  itemId,
  onClose,
  onConverted,
}: {
  readonly itemId: string;
  readonly onClose: () => void;
  readonly onConverted?: (result: ConversionResultDto) => void;
}) {
  const preview = useConversionPreview(itemId);
  // Lives here (not in the wizard): the success handler marks the cached preview as converted,
  // and the summary of *this* conversion must win over the generic "Already converted" view.
  const [result, setResult] = useState<ConversionResultDto | null>(null);
  const data = preview.data;
  if (result) return <Summary result={result} onClose={onClose} />;
  if (preview.isError) {
    return (
      <>
        <DialogHeader title="Convert lead" />
        <DialogBody className="pb-6">
          <ErrorBlock error={preview.error} title="Couldn’t prepare the conversion" onRetry={() => void preview.refetch()} />
        </DialogBody>
      </>
    );
  }
  // Always wait for a fresh preview: a cached pre-conversion snapshot must never re-open the wizard.
  if (!data || (preview.isFetching && !preview.isFetchedAfterMount)) {
    return (
      <>
        <DialogHeader title="Convert lead" description="Checking for existing accounts and contacts…" />
        <DialogBody className="pb-6">
          <div aria-busy="true">
            <CardSkeleton rows={4} height={56} />
          </div>
        </DialogBody>
      </>
    );
  }
  if (data.converted) return <AlreadyConverted preview={data} onClose={onClose} />;
  return (
    <Wizard
      preview={data}
      onClose={onClose}
      onConverted={(converted) => {
        setResult(converted);
        onConverted?.(converted);
      }}
    />
  );
}

function Wizard({
  preview,
  onClose,
  onConverted,
}: {
  readonly preview: ConversionPreviewDto;
  readonly onClose: () => void;
  readonly onConverted: (result: ConversionResultDto) => void;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(preview));
  const [error, setError] = useState<string | null>(null);
  const convert = useConvertLead(preview.lead.id);
  // Synchronous guard: a double-click fires twice before React re-renders with isPending.
  const submittingRef = useRef(false);
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));

  const stepValid = [
    draft.accountChoice !== 'new' || draft.accountName.trim().length > 0,
    draft.contactChoice !== 'new' || (draft.contactName.trim().length > 0 && (draft.email === '' || /\S+@\S+\.\S+/.test(draft.email))),
    !draft.createDeal || (draft.dealName.trim().length > 0 && amountError(draft.amount) === null),
  ];

  const submit = async () => {
    if (submittingRef.current || convert.isPending) return;
    submittingRef.current = true;
    setError(null);
    const input: ConvertLeadInput = {
      account:
        draft.accountChoice === 'new'
          ? { mode: 'new', name: draft.accountName.trim(), website: draft.website.trim() || undefined }
          : { mode: 'existing', itemId: draft.accountChoice },
      contact:
        draft.contactChoice === 'new'
          ? {
              mode: 'new',
              name: draft.contactName.trim(),
              email: draft.email.trim() || undefined,
              phone: draft.phone.trim() || undefined,
              title: draft.title.trim() || undefined,
            }
          : { mode: 'existing', itemId: draft.contactChoice, fillEmpty: draft.fillEmpty },
      deal: draft.createDeal
        ? {
            name: draft.dealName.trim(),
            amount: draft.amount === '' ? undefined : Number(draft.amount),
            stageLabelId: draft.stageId || undefined,
            closeDate: draft.closeDate || undefined,
          }
        : undefined,
      ownerId: draft.ownerId || undefined,
    };
    try {
      const converted = await convert.mutateAsync(input);
      toast.success('Lead converted', `${converted.contact.name} · ${converted.account.name}${converted.deal ? ` · ${converted.deal.name}` : ''}`);
      onConverted(converted);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      submittingRef.current = false;
    }
  };

  const isLast = step === STEPS.length - 1;
  return (
    <>
      <DialogHeader
        title={`Convert ${preview.lead.name}`}
        description={[preview.lead.title, preview.lead.company, preview.lead.email].filter(Boolean).join(' · ') || 'Turn this lead into a customer record.'}
      />
      <WizardSteps steps={STEPS} current={step} />
      <DialogBody className="pb-4">
        <div key={step} className="animate-fade-in">
        {!preview.canEdit ? (
          <p role="alert" className="mb-3 rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning-text">
            You need edit access to the Leads, Accounts and Contacts boards to convert leads.
          </p>
        ) : null}
        {step === 0 ? <AccountStep preview={preview} draft={draft} patch={patch} /> : null}
        {step === 1 ? <ContactStep preview={preview} draft={draft} patch={patch} /> : null}
        {step === 2 ? <DealStep preview={preview} draft={draft} patch={patch} /> : null}
        </div>
        {error ? (
          <p role="alert" className="mt-3 rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger-text">
            {error}
          </p>
        ) : null}
      </DialogBody>
      <WizardFooter
        step={step}
        totalSteps={STEPS.length}
        onBack={() => setStep((current) => Math.max(0, current - 1))}
        onCancel={onClose}
        onNext={() => (isLast ? void submit() : setStep((current) => current + 1))}
        canProceed={Boolean(stepValid[step]) && preview.canEdit}
        loading={convert.isPending}
        finishLabel="Convert lead"
        hideDots
      />
    </>
  );
}

type StepProps = {
  readonly preview: ConversionPreviewDto;
  readonly draft: Draft;
  readonly patch: (next: Partial<Draft>) => void;
};

function ChoiceCard({
  name,
  value,
  checked,
  onChange,
  title,
  detail,
  badge,
  children,
  testId,
}: {
  readonly name: string;
  readonly value: string;
  readonly checked: boolean;
  readonly onChange: (value: string) => void;
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  readonly badge?: ReactNode;
  readonly children?: ReactNode;
  readonly testId?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border transition-[border-color,background-color,box-shadow] duration-[var(--duration-fast)]',
        checked ? 'border-primary bg-primary-subtle/40 shadow-[0_0_0_1px_var(--primary)]' : 'border-border-default hover:border-border-strong hover:bg-hover',
      )}
    >
      <label className="flex cursor-pointer items-start gap-3 p-3" data-testid={testId}>
        <Radio name={name} value={value} checked={checked} onChange={onChange} className="mt-1" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 flex-wrap items-center gap-2 text-base font-medium text-fg">
            {title}
            {badge}
          </span>
          {detail ? <span className="truncate text-sm text-fg-secondary">{detail}</span> : null}
        </span>
      </label>
      {checked && children ? <div className="animate-fade-in border-t border-border-subtle px-3 pt-3 pb-3 sm:pl-10">{children}</div> : null}
    </div>
  );
}

function MatchBadge({ match }: { readonly match: MatchCandidateDto }) {
  return (
    <Badge tone={match.confidence === 'high' ? 'primary' : 'neutral'} size="sm">
      {match.confidence === 'high' ? 'Recommended' : 'Possible match'} · {REASON_TEXT[match.reason]}
    </Badge>
  );
}

function AccountStep({ preview, draft, patch }: StepProps) {
  const matches = preview.accountMatches;
  return (
    <fieldset className="flex flex-col gap-3" data-testid="crm-convert-account">
      <legend className="mb-2 flex items-center gap-2 text-base text-fg-secondary">
        <Building2 aria-hidden className="size-4 text-icon" />
        {matches.length > 0
          ? `We found ${matches.length === 1 ? 'an account that matches' : `${matches.length} accounts that match`} this lead. Link to it to avoid a duplicate.`
          : 'No existing account matches this lead’s company or email domain.'}
      </legend>
      {matches.map((match) => (
        <ChoiceCard
          key={match.id}
          name="account"
          value={match.id}
          checked={draft.accountChoice === match.id}
          onChange={(value) => patch({ accountChoice: value })}
          title={`Link to ${match.name}`}
          detail={match.detail}
          badge={<MatchBadge match={match} />}
        />
      ))}
      <ChoiceCard
        name="account"
        value="new"
        checked={draft.accountChoice === 'new'}
        onChange={(value) => patch({ accountChoice: value })}
        title="Create a new account"
        detail={draft.accountName || 'Enter the company name'}
        testId="crm-convert-account-new"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Account name" required error={draft.accountName.trim() ? null : 'Account name is required'}>
            {({ inputId, describedBy, invalid }) => (
              <Input id={inputId} aria-describedby={describedBy} invalid={invalid} value={draft.accountName} onChange={(event) => patch({ accountName: event.target.value })} />
            )}
          </Field>
          <Field label="Website" hint="Used to match future leads">
            {({ inputId, describedBy }) => (
              <Input id={inputId} aria-describedby={describedBy} value={draft.website} placeholder="acme.com" onChange={(event) => patch({ website: event.target.value })} />
            )}
          </Field>
        </div>
      </ChoiceCard>
    </fieldset>
  );
}

function ContactStep({ preview, draft, patch }: StepProps) {
  const matches = preview.contactMatches;
  const emailInvalid = draft.email !== '' && !/\S+@\S+\.\S+/.test(draft.email);
  return (
    <fieldset className="flex flex-col gap-3" data-testid="crm-convert-contact">
      <legend className="mb-2 flex items-center gap-2 text-base text-fg-secondary">
        <UserRound aria-hidden className="size-4 text-icon" />
        {matches.length > 0 ? 'This person may already be a contact. Merge into the existing contact or create a new one.' : 'No contact with this email or name exists yet.'}
      </legend>
      {matches.map((match) => (
        <ChoiceCard
          key={match.id}
          name="contact"
          value={match.id}
          checked={draft.contactChoice === match.id}
          onChange={(value) => patch({ contactChoice: value })}
          title={`Merge into ${match.name}`}
          detail={match.detail}
          badge={<MatchBadge match={match} />}
        >
          <Checkbox
            checked={draft.fillEmpty}
            onCheckedChange={(checked) => patch({ fillEmpty: checked === true })}
            label="Fill empty fields from the lead"
            description="Email, phone, title and owner are copied only where the contact has no value. Nothing is overwritten."
          />
        </ChoiceCard>
      ))}
      <ChoiceCard
        name="contact"
        value="new"
        checked={draft.contactChoice === 'new'}
        onChange={(value) => patch({ contactChoice: value })}
        title="Create a new contact"
        detail={[draft.contactName, draft.email].filter(Boolean).join(' · ')}
        testId="crm-convert-contact-new"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" required error={draft.contactName.trim() ? null : 'Name is required'}>
            {({ inputId, describedBy, invalid }) => (
              <Input id={inputId} aria-describedby={describedBy} invalid={invalid} value={draft.contactName} onChange={(event) => patch({ contactName: event.target.value })} />
            )}
          </Field>
          <Field label="Email" error={emailInvalid ? 'Enter a valid email' : null}>
            {({ inputId, describedBy, invalid }) => (
              <Input id={inputId} type="email" aria-describedby={describedBy} invalid={invalid} value={draft.email} onChange={(event) => patch({ email: event.target.value })} />
            )}
          </Field>
          <Field label="Phone">
            {({ inputId }) => <Input id={inputId} type="tel" value={draft.phone} onChange={(event) => patch({ phone: event.target.value })} />}
          </Field>
          <Field label="Title">
            {({ inputId }) => <Input id={inputId} value={draft.title} onChange={(event) => patch({ title: event.target.value })} />}
          </Field>
        </div>
      </ChoiceCard>
    </fieldset>
  );
}

function DealStep({ preview, draft, patch }: StepProps) {
  const stageOptions = useMemo(
    () =>
      preview.stages
        .filter((stage) => stage.kind === 'open')
        .map((stage) => ({ value: stage.id, label: `${stage.name} · ${stage.probability}%` })),
    [preview.stages],
  );
  const stage = preview.stages.find((entry) => entry.id === draft.stageId) ?? null;
  const ownerOptions = useMemo(
    () => [{ value: 'none', label: 'Keep lead owner' }, ...preview.users.map((user) => ({ value: user.id, label: user.name }))],
    [preview.users],
  );
  const amount = Number(draft.amount);
  const amountInvalid = amountError(draft.amount);
  if (!preview.boards.deals) {
    return <p className="text-base text-fg-secondary">There’s no Deals board you can add to, so the conversion will create the account and contact only.</p>;
  }
  return (
    <div className="flex flex-col gap-4" data-testid="crm-convert-deal">
      <Checkbox
        checked={draft.createDeal}
        onCheckedChange={(checked) => patch({ createDeal: checked === true })}
        label={
          <span className="inline-flex items-center gap-1.5">
            <Handshake aria-hidden className="size-4 text-icon" />
            Create a deal for this opportunity
          </span>
        }
        description="Linked to the account and contact, owned by the lead owner."
      />
      {draft.createDeal ? (
        <div className="grid animate-fade-in grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Deal name" required className="sm:col-span-2" error={draft.dealName.trim() ? null : 'Deal name is required'}>
            {({ inputId, describedBy, invalid }) => (
              <Input id={inputId} aria-describedby={describedBy} invalid={invalid} value={draft.dealName} onChange={(event) => patch({ dealName: event.target.value })} data-testid="crm-convert-deal-name" />
            )}
          </Field>
          <Field
            label={`Amount (${preview.currency})`}
            error={amountInvalid}
            hint={stage && draft.amount !== '' && !amountInvalid ? `Weighted ${new Intl.NumberFormat('en-US', { style: 'currency', currency: preview.currency, maximumFractionDigits: 0 }).format((amount * stage.probability) / 100)}` : undefined}
          >
            {({ inputId, describedBy, invalid }) => (
              <Input id={inputId} aria-describedby={describedBy} invalid={invalid} type="number" min={0} step="any" inputMode="decimal" value={draft.amount} placeholder="0" onChange={(event) => patch({ amount: event.target.value })} data-testid="crm-convert-deal-amount" />
            )}
          </Field>
          <Field label="Stage">
            {({ inputId }) => <Select id={inputId} value={draft.stageId || undefined} onValueChange={(value) => patch({ stageId: value })} options={stageOptions} />}
          </Field>
          <Field label="Expected close">
            {({ inputId }) => (
              <DatePicker
                id={inputId}
                value={draft.closeDate ? new Date(`${draft.closeDate}T00:00:00`) : null}
                onChange={(value) => patch({ closeDate: value ? todayIso(value) : '' })}
              />
            )}
          </Field>
          <Field label="Owner">
            {({ inputId }) => (
              <Select id={inputId} value={draft.ownerId || 'none'} onValueChange={(value) => patch({ ownerId: value === 'none' ? '' : value })} options={ownerOptions} />
            )}
          </Field>
        </div>
      ) : null}
      {stage ? (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          Starts in <StagePill label={stage} className="h-5 text-xs" />
        </p>
      ) : null}
    </div>
  );
}

function ResultRow({
  icon,
  kind,
  name,
  created,
  href,
}: {
  readonly icon: ReactNode;
  readonly kind: string;
  readonly name: string;
  readonly created: boolean | null;
  readonly href: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 rounded-lg border border-border-subtle px-3 py-2.5 outline-none transition-colors duration-[var(--duration-fast)] hover:border-border-default hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span className="flex size-8 items-center justify-center rounded-md bg-primary-subtle text-primary-text [&_svg]:size-4">{icon}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs text-fg-muted">{kind}</span>
          <span className="truncate text-base font-medium text-fg">{name}</span>
        </span>
        {created === null ? null : <Badge tone={created ? 'success' : 'info'}>{created ? 'Created' : 'Linked existing'}</Badge>}
      </Link>
    </li>
  );
}

function Summary({ result, onClose }: { readonly result: ConversionResultDto; readonly onClose: () => void }) {
  const { org } = useOrg();
  return (
    <>
      <DialogHeader
        icon={<CheckCircle2 aria-hidden className="size-6 text-success-text" />}
        title="Lead converted"
        description={`${result.lead.name} is now a contact, linked to ${result.account.name}${result.deal ? ' with a new deal' : ''}. The lead was marked qualified.`}
      />
      <DialogBody className="pb-4">
        <ul className="flex flex-col gap-2" data-testid="crm-convert-summary">
          <ResultRow icon={<Building2 />} kind="Account" name={result.account.name} created={result.account.created} href={`/${org.slug}/crm/accounts/${result.account.id}`} />
          <ResultRow icon={<UserRound />} kind="Contact" name={result.contact.name} created={result.contact.created} href={`/${org.slug}/crm/contacts/${result.contact.id}`} />
          {result.deal ? (
            <ResultRow icon={<Handshake />} kind="Deal" name={result.deal.name} created href={routes.item(org.slug, result.deal.boardId, result.deal.id)} />
          ) : null}
        </ul>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose} data-testid="crm-convert-done">
          Done
        </Button>
      </DialogFooter>
    </>
  );
}

function AlreadyConverted({ preview, onClose }: { readonly preview: ConversionPreviewDto; readonly onClose: () => void }) {
  const { org } = useOrg();
  const converted = preview.converted;
  return (
    <>
      <DialogHeader
        icon={<CheckCircle2 aria-hidden className="size-6 text-success-text" />}
        title="Already converted"
        description={`${preview.lead.name} was converted on ${converted ? new Date(converted.at).toLocaleDateString() : ''}.`}
      />
      <DialogBody className="pb-4">
        <ul className="flex flex-col gap-2">
          {converted?.accountId ? (
            <ResultRow icon={<Building2 />} kind="Account" name="Open account" created={null} href={`/${org.slug}/crm/accounts/${converted.accountId}`} />
          ) : null}
          {converted?.contactId ? (
            <ResultRow icon={<UserRound />} kind="Contact" name="Open contact" created={null} href={`/${org.slug}/crm/contacts/${converted.contactId}`} />
          ) : null}
        </ul>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Close</Button>
      </DialogFooter>
    </>
  );
}
