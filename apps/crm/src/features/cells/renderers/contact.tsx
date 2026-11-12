'use client';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, Copy, ExternalLink, Flag as FlagIcon, Link2, Mail, Phone } from 'lucide-react';
import { Button, Field, Input, cn, toast } from '@/components/ui';
import type { CellRenderContext, CellRenderer } from '../cell-context';
import { countryByCode, countryFromNumber, formatPhone, formatPhoneNational, telHref } from '../lib/countries';
import { isValidEmail, normalizeUrl, prettyUrl } from '../lib/format';
import { readCountry, readEmail, readLink, readPhone } from '../lib/values';
import { EmptyGhost, TruncText } from '../parts/common';
import { CountryList } from '../parts/country-list';
import { Flag } from '../parts/flag';

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy", 'Your browser blocked clipboard access.');
  }
}

/** Link-styled value + a copy button that appears on hover/focus. */
function LinkValue({
  href,
  external,
  children,
  copyText,
  copyWhat,
  leading,
}: {
  readonly href: string;
  readonly external?: boolean;
  readonly children: ReactNode;
  readonly copyText: string;
  readonly copyWhat: string;
  readonly leading?: ReactNode;
}) {
  return (
    <span className="relative flex min-w-0 flex-1 items-center gap-1.5 pr-2 pl-2.5">
      {leading}
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        onClick={(event) => event.stopPropagation()}
        tabIndex={-1}
        className="min-w-0 truncate rounded-xs text-fg-link tabular-nums underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus"
      >
        <TruncText>{children}</TruncText>
      </a>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Copy ${copyWhat.toLowerCase()}`}
        title={`Copy ${copyWhat.toLowerCase()}`}
        onClick={(event) => {
          event.stopPropagation();
          void copy(copyText, copyWhat);
        }}
        // Overlays the value's end on hover instead of reserving width, so values aren't truncated at rest.
        className="absolute top-1/2 right-1 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm bg-[var(--surface-hover)] text-icon opacity-0 shadow-[-8px_0_8px_-2px_var(--surface-hover)] transition-opacity duration-[var(--duration-fast)] group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100 group-data-[force-hover=true]/cell:opacity-100 hover:bg-hover hover:text-icon-strong"
      >
        <Copy aria-hidden className="size-3.5" />
      </button>
    </span>
  );
}

/** Two-field editor form shared by email and link. */
function PairForm({
  ctx,
  primary,
  secondary,
  initial,
  validate,
  build,
}: {
  readonly ctx: CellRenderContext;
  readonly primary: { label: string; placeholder: string; type: string };
  readonly secondary: { label: string; placeholder: string };
  readonly initial: [string, string];
  readonly validate: (value: string) => string | null;
  readonly build: (primary: string, secondary: string) => unknown;
}) {
  const [main, setMain] = useState(initial[0]);
  const [extra, setExtra] = useState(initial[1]);
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!main.trim()) {
      if (initial[0]) ctx.commit(null);
      return ctx.endEdit();
    }
    const message = validate(main);
    if (message) return setError(message);
    ctx.commit(build(main, extra) as never);
    ctx.endEdit();
  };
  return (
    <form className="flex w-[300px] flex-col gap-3" onSubmit={submit} noValidate>
      <Field label={primary.label} error={error}>
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            autoFocus
            type={primary.type}
            value={main}
            invalid={invalid}
            aria-describedby={describedBy}
            placeholder={primary.placeholder}
            onChange={(event) => {
              setMain(event.target.value);
              setError(null);
            }}
          />
        )}
      </Field>
      <Field label={secondary.label} hint="Optional">
        {({ inputId, describedBy }) => (
          <Input id={inputId} aria-describedby={describedBy} value={extra} placeholder={secondary.placeholder} onChange={(event) => setExtra(event.target.value)} />
        )}
      </Field>
      <div className="-mx-3 -mb-3 flex items-center gap-2 border-t border-border-subtle px-3 py-2.5">
        {initial[0] ? (
          <Button
            variant="danger-ghost"
            size="sm"
            onClick={() => {
              ctx.commit(null);
              ctx.endEdit();
            }}
          >
            Remove
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => ctx.endEdit()}>
          Cancel
        </Button>
        <Button size="sm" type="submit">
          Save
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------------------------

function EmailDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const value = readEmail(ctx.value);
  if (!value) return ctx.readOnly ? null : <EmptyGhost icon={<Mail aria-hidden />} label="Add email" />;
  return (
    <LinkValue href={`mailto:${value.email}`} copyText={value.email} copyWhat="Email">
      {value.label || value.email}
    </LinkValue>
  );
}

function EmailEditor({ ctx }: { readonly ctx: CellRenderContext }) {
  const value = readEmail(ctx.value);
  return (
    <PairForm
      ctx={ctx}
      primary={{ label: 'Email', placeholder: 'name@company.com', type: 'email' }}
      secondary={{ label: 'Text to display', placeholder: 'e.g. Jordan Lee' }}
      initial={[ctx.seed ? (value?.email ?? '') + ctx.seed : (value?.email ?? ''), value?.label ?? '']}
      validate={(email) => (isValidEmail(email) ? null : 'Enter a valid email, like name@company.com')}
      build={(email, label) => (label.trim() ? { email: email.trim(), label: label.trim() } : { email: email.trim() })}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------------------------

function LinkDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const value = readLink(ctx.value);
  if (!value) return ctx.readOnly ? null : <EmptyGhost icon={<Link2 aria-hidden />} label="Add link" />;
  return (
    <LinkValue
      href={value.url}
      external
      copyText={value.url}
      copyWhat="Link"
      leading={<ExternalLink aria-hidden className="size-3.5 shrink-0 text-icon" />}
    >
      {value.text || prettyUrl(value.url)}
    </LinkValue>
  );
}

function LinkEditor({ ctx }: { readonly ctx: CellRenderContext }) {
  const value = readLink(ctx.value);
  return (
    <PairForm
      ctx={ctx}
      primary={{ label: 'Web address', placeholder: 'www.example.com', type: 'url' }}
      secondary={{ label: 'Text to display', placeholder: 'e.g. Pricing page' }}
      initial={[ctx.seed ? (value?.url ?? '') + ctx.seed : (value?.url ?? ''), value?.text ?? '']}
      validate={(url) => (normalizeUrl(url) ? null : 'Enter a web address starting with http:// or https://')}
      build={(url, text) => {
        const normalized = normalizeUrl(url) ?? url;
        return text.trim() ? { url: normalized, text: text.trim() } : { url: normalized };
      }}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------------------------

function PhoneDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const value = readPhone(ctx.value);
  if (!value) return ctx.readOnly ? null : <EmptyGhost icon={<Phone aria-hidden />} label="Add phone" />;
  const country = countryFromNumber(value.phone, value.country) ?? countryByCode(value.country);
  const formatted = formatPhone(value.phone, country?.code ?? value.country);
  // Narrow columns drop the country code: the flag already says which country it is.
  const narrow = country !== undefined && (ctx.column.width ?? 160) < PHONE_FULL_WIDTH;
  const shown = narrow ? formatPhoneNational(value.phone, country.code) : formatted;
  return (
    <LinkValue
      href={telHref(value.phone, country?.code)}
      copyText={formatted}
      copyWhat="Phone number"
      leading={country ? <Flag code={country.code} /> : <Phone aria-hidden className="size-3.5 shrink-0 text-icon" />}
    >
      {shown}
      {narrow ? <span className="sr-only"> ({formatted})</span> : null}
    </LinkValue>
  );
}

/** Below this column width phone numbers show in national format. */
const PHONE_FULL_WIDTH = 200;

const PHONE_PATTERN = /^\+?[0-9 ().-]{3,32}$/;

function PhoneEditor({ ctx }: { readonly ctx: CellRenderContext }) {
  const value = readPhone(ctx.value);
  const defaultCountry = (ctx.column.settings as { defaultCountry?: string }).defaultCountry ?? 'US';
  const [country, setCountry] = useState(value?.country ?? countryFromNumber(value?.phone ?? '')?.code ?? defaultCountry);
  const [phone, setPhone] = useState(ctx.seed ? (value?.phone ?? '') + ctx.seed : (value?.phone ?? ''));
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = countryByCode(country);
  const preview = useMemo(() => (phone.replace(/\D/g, '').length >= 4 ? formatPhone(phone, country) : ''), [country, phone]);

  if (picking) {
    return (
      <div className="w-[300px]">
        <CountryList
          value={country}
          showDial
          onSelect={(next) => {
            setCountry(next.code);
            setPicking(false);
          }}
        />
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = phone.trim();
    if (!trimmed) {
      if (value) ctx.commit(null);
      return ctx.endEdit();
    }
    if (!PHONE_PATTERN.test(trimmed) || trimmed.replace(/\D/g, '').length < 4) return setError('Use digits, spaces, (), . or -');
    ctx.commit({ phone: trimmed, country });
    ctx.endEdit();
  };

  return (
    <form className="flex w-[300px] flex-col gap-2" onSubmit={submit} noValidate>
      <Field label="Phone number" error={error} hint={preview ? `Shows as ${preview}` : undefined}>
        {({ inputId, describedBy, invalid }) => (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setPicking(true)}
            aria-label={`Country: ${selected?.name ?? country}. Change`}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-border-input bg-panel px-2 text-sm text-fg transition-colors hover:border-border-input-hover hover:bg-muted focus-visible:outline-2 focus-visible:outline-focus"
          >
            <Flag code={country} />
            <span className="tabular-nums">+{selected?.dial ?? ''}</span>
            <ChevronDown aria-hidden className="size-3.5 text-icon" />
          </button>
          <Input
            id={inputId}
            aria-describedby={describedBy}
            autoFocus
            type="tel"
            inputMode="tel"
            value={phone}
            invalid={invalid}
            placeholder="214 555 0163"
            onChange={(event) => {
              setPhone(event.target.value);
              setError(null);
            }}
          />
        </div>
        )}
      </Field>
      <div className="-mx-3 -mb-3 mt-1 flex items-center gap-2 border-t border-border-subtle px-3 py-2.5">
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => ctx.endEdit()}>
          Cancel
        </Button>
        <Button size="sm" type="submit">
          Save
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Country
// ---------------------------------------------------------------------------------------------

function CountryDisplay({ ctx }: { readonly ctx: CellRenderContext }) {
  const code = readCountry(ctx.value);
  if (!code) return ctx.readOnly ? null : <EmptyGhost icon={<FlagIcon aria-hidden />} label="Pick a country" />;
  const country = countryByCode(code);
  return (
    <span className={cn('flex min-w-0 flex-1 items-center gap-2 px-2.5')}>
      <Flag code={code} />
      <TruncText>{country?.name ?? code}</TruncText>
    </span>
  );
}

function CountryEditor({ ctx }: { readonly ctx: CellRenderContext }) {
  const code = readCountry(ctx.value);
  return (
    <div className="flex w-[260px] flex-col gap-2">
      <CountryList
        value={code}
        onSelect={(country) => {
          if (country.code !== code) ctx.commit({ code: country.code });
          ctx.endEdit();
        }}
      />
      {code ? (
        <Button
          variant="danger-ghost"
          size="sm"
          className="self-start"
          onClick={() => {
            ctx.commit(null);
            ctx.endEdit();
          }}
        >
          Clear
        </Button>
      ) : null}
    </div>
  );
}

export const emailRenderer: CellRenderer = {
  behavior: { mode: 'popover', clearable: true, typeToEdit: true, width: 300 },
  Display: EmailDisplay,
  Editor: EmailEditor,
};
export const linkRenderer: CellRenderer = {
  behavior: { mode: 'popover', clearable: true, typeToEdit: true, width: 300 },
  Display: LinkDisplay,
  Editor: LinkEditor,
};
export const phoneRenderer: CellRenderer = {
  behavior: { mode: 'popover', clearable: true, typeToEdit: true, width: 300 },
  Display: PhoneDisplay,
  Editor: PhoneEditor,
};
export const countryRenderer: CellRenderer = {
  behavior: { mode: 'popover', clearable: true, width: 260, popup: 'listbox' },
  Display: CountryDisplay,
  Editor: CountryEditor,
};
