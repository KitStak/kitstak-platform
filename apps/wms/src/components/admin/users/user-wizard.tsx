'use client';

/**
 * Add User (4 steps: User info · Roles · Warehouse · Client) and Edit User (same tabs, free
 * navigation, password optional). Every step validates on Next and can go back; a stale edit
 * shows the Reload prompt (409).
 */
import * as React from 'react';
import { Building2, KeyRound, ShieldCheck, UserRound, Users2 } from 'lucide-react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { apiRequest, isApiError } from '@/lib/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { applyServerFieldErrors, useApiQuery } from '@/lib/query-client';
import {
  CREATABLE_USER_TYPES,
  EMAIL_TAKEN_MESSAGE,
  isFreshDetail,
  looksLikeEmail,
  normalizeEmail,
  USER_FORM_DEFAULTS,
  userClientsStepSchema,
  userInfoSchemaFor,
  userRolesStepSchema,
  userWarehousesStepSchema,
  type UserFormValues,
} from '@/lib/grid-defs/admin/users';
import { USER_TYPES } from '@/lib/enums';
import { welcomeToastText, type MailTransport } from '@/lib/grid-defs/admin/company-mail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField, FormGrid, FormSection } from '@/components/ui/form';
import { RadioCards } from '@/components/ui/radio-cards';
import { Skeleton } from '@/components/ui/skeleton';
import { TextField } from '@/components/ui/text-field';
import { toast } from '@/components/ui/toast';
import { Wizard, type WizardStep } from '@/components/ui/wizard';
import { AccessGrid } from '../access-grid';
import { useAdminOptions, type AdminOptions } from '../admin-shared';
import { SelectField, TextInput, YesNoField } from '../form-controls';
import { PasswordMeter, usePasswordPolicy } from '../password-meter';
import { describeSaveError, needsRetryPanel, SAVE_TIMEOUT_MS } from './save-error';
import type { UserDetail } from '@/server/repositories/users';

type F = UserFormValues;

function PasswordInput({
  name,
  label,
  required,
  info,
  describedBy,
}: {
  readonly name: 'password' | 'confirmPassword';
  readonly label: string;
  readonly required: boolean;
  readonly info?: string;
  readonly describedBy?: string;
}) {
  return (
    <FormField<F> name={name} label={label} required={required} info={info}>
      {(c) => (
        <TextField
          id={c.id}
          name={c.name}
          ref={c.ref as React.Ref<HTMLInputElement>}
          type="password"
          autoComplete="new-password"
          value={(c.value as string | null) ?? ''}
          onChange={(e) => c.onChange(e.target.value)}
          onBlur={c.onBlur}
          invalid={c.invalid}
          aria-invalid={c['aria-invalid']}
          aria-describedby={[c['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined}
        />
      )}
    </FormField>
  );
}

function InfoStep({
  form,
  isEdit,
  isOwner,
  checkEmail,
  taken,
  checking,
}: {
  readonly form: UseFormReturn<F>;
  readonly isEdit: boolean;
  readonly isOwner: boolean;
  readonly checkEmail: (email: string) => void;
  readonly taken: ReadonlySet<string>;
  readonly checking: string | null;
}) {
  const policy = usePasswordPolicy();
  const password = useWatch({ control: form.control, name: 'password' }) ?? '';
  const email = useWatch({ control: form.control, name: 'email' }) ?? '';
  const typeOptions = (isOwner ? USER_TYPES : CREATABLE_USER_TYPES).map((t) => ({ value: t, label: t }));
  // Debounced uniqueness check, so a used address is flagged on the field before Next.
  React.useEffect(() => {
    const norm = normalizeEmail(email);
    if (form.getFieldState('email').error?.message === EMAIL_TAKEN_MESSAGE && !taken.has(norm))
      form.clearErrors('email');
    if (taken.has(norm)) {
      form.setError('email', { type: 'server', message: EMAIL_TAKEN_MESSAGE });
      return;
    }
    const timer = window.setTimeout(() => checkEmail(email), 350);
    return () => window.clearTimeout(timer);
  }, [email, taken, checkEmail, form]);
  const isChecking = checking !== null && checking === normalizeEmail(email);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <FormGrid>
          <TextInput<F>
            name="firstName"
            label="First name"
            required
            maxLength={60}
            placeholder="e.g. Jordan"
          />
          <TextInput<F> name="lastName" label="Last name" required maxLength={60} placeholder="e.g. Reyes" />
          <div className="flex flex-col gap-1">
            <TextInput<F>
              name="email"
              label="Email"
              required
              maxLength={254}
              placeholder="name@company.com"
              type="email"
              inputMode="email"
              autoComplete="off"
              transform={(v) => v.trim()}
            />
            <p aria-live="polite" className="min-h-4 text-2xs text-faint">
              {isChecking ? "Checking that this email isn't already used…" : ''}
            </p>
          </div>
          <SelectField<F>
            name="userType"
            label="User type"
            required
            options={typeOptions}
            disabled={isOwner}
            info={
              isOwner
                ? "The account owner's type can't change"
                : "Client users only see their own clients' data"
            }
          />
        </FormGrid>
      </div>
      <FormSection
        title={isEdit ? 'Change password' : 'Password'}
        description={
          isEdit
            ? 'Leave both fields blank to keep the current password. A new password signs the user out everywhere.'
            : undefined
        }
      >
        <FormGrid>
          <div>
            <PasswordInput
              name="password"
              label={isEdit ? 'New password' : 'Password'}
              required={!isEdit}
              describedBy="user-password-meter"
            />
            {password || !isEdit ? (
              <PasswordMeter id="user-password-meter" password={password} policy={policy} />
            ) : null}
          </div>
          <PasswordInput name="confirmPassword" label="Confirm password" required={!isEdit} />
        </FormGrid>
      </FormSection>
      <FormSection title="Access">
        <FormGrid>
          {!isEdit ? (
            <YesNoField<F>
              name="sendWelcomeEmail"
              label="Send welcome email"
              info="Emails an invite with a link to choose their own password (valid 3 days). Needs Company Settings › Email delivery."
            />
          ) : null}
          <YesNoField<F>
            name="isActive"
            label="Active"
            info="Inactive users can't sign in. Deactivating signs them out on their next click."
          />
        </FormGrid>
      </FormSection>
    </div>
  );
}

function ArrayStep({
  name,
  items,
  noun,
  columnLabel,
  title,
  description,
  loading,
  nested,
}: {
  readonly name: 'roleIds' | 'warehouseIds' | 'clientIds';
  readonly items: Parameters<typeof AccessGrid>[0]['items'];
  readonly noun: string;
  readonly columnLabel: string;
  readonly title: string;
  readonly description: string;
  readonly loading: boolean;
  readonly nested?: boolean;
}) {
  // A top-level step already shows its label as the heading; only nested lists get a section title.
  if (!nested) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-secondary">{description}</p>
        <FormField<F> name={name}>
          {(c) => (
            <AccessGrid
              items={items}
              value={(c.value as string[] | null) ?? []}
              onChange={(ids) => c.onChange(ids)}
              noun={noun}
              columnLabel={columnLabel}
              invalid={c.invalid}
              describedBy={c['aria-describedby']}
              loading={loading}
            />
          )}
        </FormField>
      </div>
    );
  }
  return (
    <FormSection title={title} description={description}>
      <FormField<F> name={name}>
        {(c) => (
          <AccessGrid
            items={items}
            value={(c.value as string[] | null) ?? []}
            onChange={(ids) => c.onChange(ids)}
            noun={noun}
            columnLabel={columnLabel}
            invalid={c.invalid}
            describedBy={c['aria-describedby']}
            loading={loading}
          />
        )}
      </FormField>
    </FormSection>
  );
}

function ClientStep({
  form,
  options,
}: {
  readonly form: UseFormReturn<F>;
  readonly options: AdminOptions & { loading: boolean };
}) {
  const allClients = useWatch({ control: form.control, name: 'allClients' });
  return (
    <div className="flex flex-col gap-4">
      <FormField<F> name="allClients" label="Client access" required>
        {(c) => (
          <RadioCards<'all' | 'manual'>
            ariaLabel="Client access"
            columns={2}
            value={c.value ? 'all' : 'manual'}
            onChange={(v) => c.onChange(v === 'all')}
            options={[
              {
                value: 'all',
                title: 'All clients',
                description: 'Give access to all existing and future clients.',
                icon: Building2,
              },
              {
                value: 'manual',
                title: 'Select manually',
                description: 'List clients and give access to them by selection.',
                icon: Users2,
              },
            ]}
          />
        )}
      </FormField>
      {allClients ? null : (
        <ArrayStep
          name="clientIds"
          items={options.clients.map((cl) => ({ id: cl.id, label: cl.name, description: cl.code }))}
          noun="client"
          columnLabel="Client"
          title="Clients"
          description="The user sees orders, inventory and reports of these clients only."
          loading={options.loading}
          nested
        />
      )}
    </div>
  );
}

export function detailToUserForm(d: UserDetail): F {
  return {
    firstName: d.firstName ?? d.name.split(' ')[0] ?? '',
    lastName: d.lastName ?? d.name.split(' ').slice(1).join(' '),
    email: d.email,
    userType: d.userType as F['userType'],
    password: '',
    confirmPassword: '',
    sendWelcomeEmail: false,
    isActive: d.isActive,
    roleIds: [...d.roleIds],
    warehouseIds: [...d.warehouseIds],
    allClients: d.allClients,
    clientIds: [...d.clientIds],
  };
}

function Body({
  initial,
  detail,
  onDone,
  onCancel,
  onDirtyChange,
}: {
  readonly initial: F;
  readonly detail: UserDetail | null;
  readonly onDone: () => void;
  readonly onCancel: () => void;
  readonly onDirtyChange: (d: boolean) => void;
}) {
  const options = useAdminOptions();
  const formRef = React.useRef<UseFormReturn<F> | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const [failure, setFailure] = React.useState<{ message: string; values: F } | null>(null);
  const [retrying, setRetrying] = React.useState(false);
  const editId = detail?.id ?? null;
  // The version the form was seeded from, pinned at mount: a background refetch of `detail`
  // must never pair stale form values with a fresh version (that silently overwrote edits).
  const [seedVersion] = React.useState(() => detail?.version);
  const isOwner = detail?.userType === 'Owner';
  const roleItems = options.roles.map((r) => ({
    id: r.id,
    label: r.name,
    description: r.description ?? `${r.category} role`,
    badge: r.isSystem ? (
      <Badge size="sm" tone="neutral">
        System
      </Badge>
    ) : null,
  }));
  const warehouseItems = options.warehouses.map((w) => ({ id: w.id, label: w.name, description: w.code }));
  const policy = usePasswordPolicy();
  const policyKey = JSON.stringify(policy);
  const goToRef = React.useRef<((key: string) => void) | null>(null);
  const [taken, setTaken] = React.useState<ReadonlySet<string>>(() => new Set());
  const [checking, setChecking] = React.useState<string | null>(null);
  const checked = React.useRef(new Map<string, boolean>());
  const ownEmail = normalizeEmail(detail?.email);
  const markTaken = React.useCallback(
    (email: string) => setTaken((prev) => (prev.has(email) ? prev : new Set([...prev, email]))),
    [],
  );
  const checkEmail = React.useCallback(
    (raw: string) => {
      const email = normalizeEmail(raw);
      if (!looksLikeEmail(email) || (editId && email === ownEmail)) return;
      const known = checked.current.get(email);
      if (known !== undefined) {
        if (!known) markTaken(email);
        return;
      }
      setChecking(email);
      void apiRequest<{ available: boolean }>('/api/users/email-available', {
        method: 'POST',
        body: { email, ...(editId ? { exceptId: editId } : {}) },
      })
        .then(({ data }) => {
          checked.current.set(email, data.available);
          if (!data.available) markTaken(email);
        })
        .catch(() => {
          /* the create/save call still enforces uniqueness */
        })
        .finally(() => setChecking((c) => (c === email ? null : c)));
    },
    [editId, ownEmail, markTaken],
  );
  const takenKey = [...taken].join('|');
  const steps = React.useMemo<readonly WizardStep<F>[]>(
    () => [
      {
        key: 'info',
        label: 'User info',
        icon: UserRound,
        schema: userInfoSchemaFor(Boolean(editId), policy ?? undefined, taken),
        canProceed: (v) =>
          checking !== null && checking === normalizeEmail(v.email)
            ? "Checking that this email isn't already used…"
            : !policy && v.password
              ? "Loading your company's password policy…"
              : true,
        render: ({ form, goTo }) => {
          formRef.current = form;
          goToRef.current = goTo;
          return (
            <InfoStep
              form={form}
              isEdit={Boolean(editId)}
              isOwner={isOwner}
              checkEmail={checkEmail}
              taken={taken}
              checking={checking}
            />
          );
        },
      },
      {
        key: 'roles',
        label: 'Roles',
        icon: ShieldCheck,
        schema: userRolesStepSchema,
        render: ({ form, goTo }) => {
          formRef.current = form;
          goToRef.current = goTo;
          return (
            <ArrayStep
              name="roleIds"
              items={roleItems}
              noun="role"
              columnLabel="Role name"
              title="Roles"
              description="Permissions are the union of every assigned role."
              loading={options.loading}
            />
          );
        },
      },
      {
        key: 'warehouses',
        label: 'Warehouse',
        icon: KeyRound,
        schema: userWarehousesStepSchema,
        render: ({ form, goTo }) => {
          formRef.current = form;
          goToRef.current = goTo;
          return (
            <ArrayStep
              name="warehouseIds"
              items={warehouseItems}
              noun="warehouse"
              columnLabel="Warehouse"
              title="Warehouses"
              description="Data from other warehouses is hidden in every grid, report and API call."
              loading={options.loading}
            />
          );
        },
      },
      {
        key: 'clients',
        label: 'Client',
        icon: Building2,
        schema: userClientsStepSchema,
        render: ({ form, goTo }) => {
          formRef.current = form;
          goToRef.current = goTo;
          return <ClientStep form={form} options={options} />;
        },
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
    ],
    [
      editId,
      isOwner,
      policyKey,
      options.loading,
      options.roles.length,
      options.warehouses.length,
      options.clients.length,
      takenKey,
      checking,
      checkEmail,
    ],
  );

  const submit = async (values: F) => {
    setFailure(null);
    // A hung request (server down, dev compile error) must never leave the drawer stuck busy.
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), SAVE_TIMEOUT_MS);
    try {
      const body = { ...values, clientIds: values.allClients ? [] : values.clientIds, version: seedVersion };
      if (editId) {
        const { data } = await apiRequest<{ sessionsRevoked: boolean }>(`/api/users/${editId}`, {
          method: 'PATCH',
          body,
          signal: controller.signal,
        });
        toast.success(
          'User updated',
          data.sessionsRevoked
            ? `${values.firstName} ${values.lastName} was signed out so the new access applies.`
            : `${values.firstName} ${values.lastName} saved.`,
        );
      } else {
        const { data } = await apiRequest<{
          name: string;
          welcomeRequested: boolean;
          welcomeTransport: MailTransport | null;
          welcomeError: string | null;
        }>('/api/users', { method: 'POST', body, signal: controller.signal });
        const note = welcomeToastText({
          name: data.name,
          requested: data.welcomeRequested,
          transport: data.welcomeTransport,
          error: data.welcomeError,
        });
        if (note.tone === 'success') toast.success('User created', note.text);
        else toast.warning('User created', note.text);
      }
      onDone();
    } catch (error) {
      const message = describeSaveError(error, controller.signal.aborted);
      if (isApiError(error) && error.code === 'CONFLICT') setConflict(true);
      const emailClash = isApiError(error) && Boolean(error.fieldErrors.email?.length);
      if (emailClash) {
        // Back to step 1 with the message on the Email field (not a toast over the footer).
        const email = normalizeEmail(values.email);
        checked.current.set(email, false);
        markTaken(email);
        goToRef.current?.('info');
        window.setTimeout(() => {
          formRef.current?.setError('email', { type: 'server', message: EMAIL_TAKEN_MESSAGE });
          formRef.current?.setFocus('email');
        }, 60);
        throw error;
      }
      if (formRef.current) applyServerFieldErrors(formRef.current, error);
      if (needsRetryPanel(error)) setFailure({ message, values });
      // A full plan: the toast carries the next step, "Add a seat" in the Portal.
      const planUrl = isApiError(error) && error.code === 'PLAN_SEAT_LIMIT' ? error.planUrl : undefined;
      toast.error("Couldn't save the user", message, {
        action: planUrl ? { label: 'Add a seat', onClick: () => window.location.assign(planUrl) } : undefined,
      });
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  };
  const retry = async () => {
    if (!failure) return;
    setRetrying(true);
    try {
      await submit(failure.values);
    } catch {
      /* panel re-rendered with the new error */
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {failure ? (
        <Callout
          variant="error"
          title={editId ? "The user wasn't saved" : "The user wasn't created"}
          action={
            <Button size="sm" onClick={() => void retry()} disabled={retrying} aria-busy={retrying}>
              {retrying ? 'Retrying…' : 'Retry'}
            </Button>
          }
        >
          {failure.message} Everything you entered is kept.
        </Callout>
      ) : null}
      {conflict ? (
        <Callout
          variant="attention"
          title="This user changed since you opened it"
          action={
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        >
          Someone else saved this user. Reload to see their changes.
        </Callout>
      ) : null}
      <Wizard<F>
        steps={steps}
        variant="drawer"
        mode={editId ? 'free' : 'linear'}
        defaultValues={initial}
        draftScope={false}
        guardUnsaved={false}
        onDirtyChange={onDirtyChange}
        submitLabel={editId ? 'Save' : 'Create user'}
        onCancel={onCancel}
        onComplete={submit}
      />
    </div>
  );
}

export function UserWizardDrawer({
  open,
  onOpenChange,
  editId,
  onSaved,
}: {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly editId: string | null;
  readonly onSaved: () => void;
}) {
  const [dirty, setDirty] = React.useState(false);
  const queryClient = useQueryClient();
  const [openedAt, setOpenedAt] = React.useState(0);
  React.useEffect(() => {
    setOpenedAt(open ? Date.now() : 0);
  }, [open, editId]);
  const detail = useApiQuery<UserDetail>(
    ['user', editId ?? ''],
    open && editId && openedAt > 0 ? `/api/users/${editId}` : null,
    { staleTime: 0, gcTime: 0, refetchOnWindowFocus: false },
  );
  const close = () => {
    setDirty(false);
    onOpenChange(false);
  };
  // Latched per open: once seeded, a background refetch never unmounts the form mid-edit.
  const [seeded, setSeeded] = React.useState<{ at: number; data: UserDetail } | null>(null);
  const live = detail.data?.data;
  if (live && isFreshDetail(detail.dataUpdatedAt, openedAt, detail.isFetching) && seeded?.at !== openedAt)
    setSeeded({ at: openedAt, data: live });
  const d = seeded && seeded.at === openedAt ? seeded.data : undefined;
  const initial = editId ? (d ? detailToUserForm(d) : null) : USER_FORM_DEFAULTS;
  return (
    <Drawer
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      dirty={dirty}
      width={45}
      title={editId ? `Edit user${d ? ` · ${d.name}` : ''}` : 'Add user'}
      description={editId ? undefined : 'Create a sign-in, then choose roles, warehouses and clients.'}
    >
      {editId && detail.isError ? (
        <EmptyState
          title="Couldn't load this user"
          description={detail.error.message}
          action={<Button onClick={() => void detail.refetch()}>Retry</Button>}
        />
      ) : !initial ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Body
          key={`${editId ?? 'new'}:${openedAt}`}
          initial={initial}
          detail={editId ? (d ?? null) : null}
          onCancel={close}
          onDirtyChange={setDirty}
          onDone={() => {
            // Drop the cached copy of this user so the next Edit opens the saved values.
            if (editId) {
              queryClient.removeQueries({ queryKey: ['user', editId] });
              void queryClient.invalidateQueries({ queryKey: ['admin-change-log'] });
            }
            close();
            onSaved();
          }}
        />
      )}
    </Drawer>
  );
}
