'use client';

/**
 * Company Settings › Email delivery: SMTP server for invite and password emails, with a
 * "Send test email" check. "Server log only" keeps development installs working and is named
 * plainly wherever an email would be sent (the Add user toast says so too).
 */
import * as React from 'react';
import { Mail, Send } from 'lucide-react';
import { useWatch } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, isApiError } from '@/lib/api-client';
import { applyServerFieldErrors, useApiQuery } from '@/lib/query-client';
import {
  MAIL_SECURITY_OPTIONS,
  mailSettingsSchema,
  type MailSecurity,
  type MailSettingsView,
} from '@/lib/grid-defs/admin/company-mail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { EmptyState } from '@/components/ui/empty-state';
import { Form, FormField, FormGrid, FormSection, SubmitBar, useZodForm } from '@/components/ui/form';
import { RadioCards } from '@/components/ui/radio-cards';
import { Skeleton } from '@/components/ui/skeleton';
import { TextField } from '@/components/ui/text-field';
import { toast } from '@/components/ui/toast';
import { NumberField, SelectField, TextInput } from '../form-controls';

type V = {
  transport: 'log' | 'smtp';
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
  password?: string;
  clearPassword?: boolean;
  fromAddress: string;
  fromName: string;
  version?: number;
};

function toForm(m: MailSettingsView): V {
  return {
    transport: m.transport,
    host: m.host,
    port: m.port,
    security: m.security,
    username: m.username,
    password: '',
    clearPassword: false,
    fromAddress: m.fromAddress,
    fromName: m.fromName,
    version: m.version,
  };
}

function TestSend({ disabled, defaultTo }: { readonly disabled: string | null; readonly defaultTo: string }) {
  const [to, setTo] = React.useState(defaultTo);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{
    tone: 'success' | 'attention' | 'error';
    text: string;
  } | null>(null);
  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const { data } = await apiRequest<{ delivered: boolean }>('/api/company/mail/test', {
        method: 'POST',
        body: { to },
      });
      setResult(
        data.delivered
          ? {
              tone: 'success',
              text: `The mail server accepted the test email for ${to}. Check that inbox (and its spam folder).`,
            }
          : {
              tone: 'attention',
              text: 'Saved setting is "Server log only", so the test email was written to the server log, not sent.',
            },
      );
    } catch (error) {
      setResult({ tone: 'error', text: isApiError(error) ? error.message : 'The test email failed' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormSection title="Send a test email" description="Uses the saved settings. Save your changes first.">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-xs font-medium text-secondary">
          Send to
          <TextField
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
          />
        </label>
        <Button
          variant="secondary"
          onClick={() => void send()}
          disabled={busy || Boolean(disabled) || !to.includes('@')}
          aria-busy={busy}
          title={disabled ?? undefined}
        >
          <Send className="h-4 w-4" aria-hidden />
          {busy ? 'Sending…' : 'Send test email'}
        </Button>
      </div>
      {result ? (
        <Callout
          className="mt-3"
          variant={result.tone === 'error' ? 'error' : result.tone}
          title={
            result.tone === 'success'
              ? 'Test email sent'
              : result.tone === 'error'
                ? 'Test email failed'
                : 'Not sent'
          }
        >
          {result.text}
        </Callout>
      ) : null}
    </FormSection>
  );
}

function Editor({
  settings,
  canEdit,
  defaultTo,
}: {
  readonly settings: MailSettingsView;
  readonly canEdit: boolean;
  readonly defaultTo: string;
}) {
  const qc = useQueryClient();
  const initial = toForm(settings);
  const form = useZodForm(mailSettingsSchema, initial);
  const w = useWatch({ control: form.control });
  const [conflict, setConflict] = React.useState(false);
  const smtp = w.transport === 'smtp';
  const submit = async (values: V) => {
    try {
      const { data } = await apiRequest<MailSettingsView>('/api/company/mail', {
        method: 'PUT',
        body: { ...values, version: settings.version },
      });
      toast.success(
        'Email delivery saved',
        data.ready
          ? `Invites and password emails go out through ${data.host}.`
          : 'Emails are written to the server log only.',
      );
      // The company row version moved: every section must reload it before its next save.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['company-mail'] }),
        qc.invalidateQueries({ queryKey: ['company'] }),
      ]);
    } catch (error) {
      if (isApiError(error) && error.code === 'CONFLICT') setConflict(true);
      applyServerFieldErrors(form, error);
      toast.error("Couldn't save email delivery", isApiError(error) ? error.message : 'Something went wrong');
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <Form form={form} onSubmit={submit} className="flex flex-col gap-5" guardUnsaved>
        {conflict ? (
          <Callout
            variant="attention"
            title="These settings changed since you opened them"
            action={
              <Button size="sm" onClick={() => window.location.reload()}>
                Reload
              </Button>
            }
          >
            Reload to see the latest settings.
          </Callout>
        ) : null}
        <FormField<V> name="transport" label="Delivery" required>
          {(c) => (
            <RadioCards<'log' | 'smtp'>
              ariaLabel="Email delivery"
              columns={2}
              value={(c.value as 'log' | 'smtp') ?? 'log'}
              onChange={(v) => c.onChange(v)}
              options={[
                {
                  value: 'smtp',
                  title: 'SMTP server',
                  description:
                    'Send real email through your mail provider (Microsoft 365, Google Workspace, SendGrid, Postmark…).',
                  icon: Send,
                  disabled: !canEdit,
                },
                {
                  value: 'log',
                  title: 'Server log only',
                  description:
                    'Development: emails are written to the server log and never leave the server.',
                  icon: Mail,
                  disabled: !canEdit,
                },
              ]}
            />
          )}
        </FormField>
        {smtp ? (
          <>
            <FormSection title="SMTP server">
              <FormGrid>
                <TextInput<V>
                  name="host"
                  label="Server"
                  required
                  placeholder="smtp.example.com"
                  maxLength={253}
                  disabled={!canEdit}
                  transform={(v) => v.trim()}
                />
                <SelectField<V>
                  name="security"
                  label="Security"
                  required
                  disabled={!canEdit}
                  options={MAIL_SECURITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  onValueChange={(v) => {
                    const o = MAIL_SECURITY_OPTIONS.find((x) => x.value === v);
                    if (o) form.setValue('port', o.port, { shouldDirty: true });
                  }}
                />
                <NumberField<V> name="port" label="Port" required min={1} max={65535} disabled={!canEdit} />
                <TextInput<V>
                  name="username"
                  label="User name"
                  placeholder="Leave blank for no sign-in"
                  maxLength={254}
                  autoComplete="off"
                  disabled={!canEdit}
                />
                <FormField<V>
                  name="password"
                  label="Password"
                  info={
                    settings.passwordSet
                      ? `A password is saved (ends in ••${settings.passwordHint ?? ''}). Leave blank to keep it.`
                      : 'Stored encrypted; never shown again.'
                  }
                >
                  {(c) => (
                    <TextField
                      id={c.id}
                      name={c.name}
                      ref={c.ref as React.Ref<HTMLInputElement>}
                      type="password"
                      autoComplete="new-password"
                      disabled={!canEdit}
                      placeholder={settings.passwordSet ? '••••••••' : ''}
                      value={(c.value as string | undefined) ?? ''}
                      onChange={(e) => c.onChange(e.target.value)}
                      onBlur={c.onBlur}
                      invalid={c.invalid}
                    />
                  )}
                </FormField>
              </FormGrid>
            </FormSection>
            <FormSection
              title="Sender"
              description="Invites and password emails come from this address. Your provider must allow it."
            >
              <FormGrid>
                <TextInput<V>
                  name="fromAddress"
                  label="From address"
                  required
                  type="email"
                  placeholder="no-reply@company.com"
                  maxLength={254}
                  disabled={!canEdit}
                  transform={(v) => v.trim()}
                />
                <TextInput<V>
                  name="fromName"
                  label="From name"
                  placeholder="KitStaks"
                  maxLength={120}
                  disabled={!canEdit}
                />
              </FormGrid>
            </FormSection>
          </>
        ) : (
          <Callout variant="attention" title="No email leaves this server">
            Welcome invites and password reset emails are written to the server log. Choose SMTP server to
            send them to people.
          </Callout>
        )}
        {canEdit ? (
          <SubmitBar
            submitLabel="Save email delivery"
            cancelLabel="Reset"
            requireDirty
            onCancel={() => form.reset(initial)}
          />
        ) : null}
      </Form>
      {canEdit ? (
        <TestSend
          defaultTo={defaultTo}
          disabled={form.formState.isDirty ? 'Save your changes first' : null}
        />
      ) : null}
    </div>
  );
}

export function MailSection({
  canEdit,
  defaultTo,
}: {
  readonly canEdit: boolean;
  readonly defaultTo: string;
}) {
  const q = useApiQuery<MailSettingsView>(['company-mail'], '/api/company/mail', { staleTime: 0 });
  const m = q.data?.data;
  if (q.isPending) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !m)
    return (
      <EmptyState
        title="Couldn't load email delivery"
        description={q.error?.message}
        action={<Button onClick={() => void q.refetch()}>Retry</Button>}
      />
    );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-xs text-secondary">
        Status:
        {m.ready ? (
          <Badge tone="success" size="sm" shape="pill">
            Sending through {m.host}
          </Badge>
        ) : (
          <Badge tone="warning" size="sm" shape="pill">
            Server log only
          </Badge>
        )}
      </div>
      <Editor key={m.version} settings={m} canEdit={canEdit} defaultTo={defaultTo} />
    </div>
  );
}
