'use client';
/** Admin → General: organization name, URL, logo, default workspace and data region. */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Globe2, Lock, TriangleAlert } from 'lucide-react';
import { Button, Field, Input, Select, toast } from '@/components/ui';
import { useOrg } from '@/features/shell/org-context';
import { updateOrgGeneralSchema } from '@/server/services/admin-contracts';
import { useOrgAdmin, useUpdateOrgGeneral } from '../api';
import { formatDate } from '../format';
import { ImageUpload } from '../image-upload';
import { ErrorPanel, SectionHeader, SettingRow, SettingsCard, SettingsSkeleton } from '../ui';
import { useUnsavedChangesGuard } from '../use-unsaved-guard';

const NO_DEFAULT = '__none__';

interface Draft {
  readonly name: string;
  readonly slug: string;
  readonly defaultWorkspaceId: string;
}

type DraftErrors = Partial<Record<keyof Draft, string>>;

function changedInput(draft: Draft, initial: Draft) {
  return {
    ...(draft.name !== initial.name ? { name: draft.name } : {}),
    ...(draft.slug !== initial.slug ? { slug: draft.slug } : {}),
    ...(draft.defaultWorkspaceId !== initial.defaultWorkspaceId
      ? { defaultWorkspaceId: draft.defaultWorkspaceId === NO_DEFAULT ? null : draft.defaultWorkspaceId }
      : {}),
  };
}

/** Live validation with the same Zod schema the API uses. */
function validateDraft(draft: Draft, initial: Draft): DraftErrors {
  const parsed = updateOrgGeneralSchema.safeParse(changedInput(draft, initial));
  if (parsed.success) return {};
  const next: DraftErrors = {};
  for (const issue of parsed.error.issues) next[issue.path[0] as keyof Draft] ??= issue.message;
  return next;
}

export function GeneralSection() {
  const router = useRouter();
  const { org } = useOrg();
  const query = useOrgAdmin();
  const save = useUpdateOrgGeneral();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [serverErrors, setServerErrors] = useState<DraftErrors>({});

  const initial = useMemo<Draft | null>(
    () =>
      query.data
        ? {
            name: query.data.name,
            slug: query.data.slug,
            defaultWorkspaceId: query.data.settings.defaultWorkspaceId ?? NO_DEFAULT,
          }
        : null,
    [query.data],
  );
  // Re-seed the form whenever the server copy changes (initial load, after save).
  const [seed, setSeed] = useState<Draft | null>(null);
  if (initial !== seed) {
    setSeed(initial);
    setDraft(initial);
  }

  const dirty = Boolean(
    draft &&
      initial &&
      (draft.name !== initial.name || draft.slug !== initial.slug || draft.defaultWorkspaceId !== initial.defaultWorkspaceId),
  );
  const slugChanged = Boolean(draft && initial && draft.slug !== initial.slug);
  const liveErrors = useMemo(() => (draft && initial ? validateDraft(draft, initial) : {}), [draft, initial]);
  const errors: DraftErrors = { ...liveErrors, ...serverErrors };
  const hasErrors = Object.keys(liveErrors).length > 0;
  const guard = useUnsavedChangesGuard(dirty && !save.isPending);

  const submit = () => {
    if (!draft || !initial) return;
    const parsed = updateOrgGeneralSchema.safeParse(changedInput(draft, initial));
    if (!parsed.success) return; // Save is disabled while live validation reports errors.
    setServerErrors({});
    save.mutate(parsed.data, {
      onSuccess: (data) => {
        toast.success('Organization settings saved');
        setDraft({
          name: data.name,
          slug: data.slug,
          defaultWorkspaceId: data.settings.defaultWorkspaceId ?? NO_DEFAULT,
        });
        if (data.slug !== org.slug) router.replace(`/${data.slug}/admin`);
        else router.refresh();
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : '';
        if (/URL/i.test(message)) setServerErrors({ slug: message });
      },
    });
  };

  const setLogo = async (logo: string | null) => {
    await save.mutateAsync({ logo });
    toast.success(logo ? 'Logo updated' : 'Logo removed');
    router.refresh();
  };

  return (
    <>
      <SectionHeader
        title="General"
        description="How your organization appears across KitStak, and where people land when they sign in."
      />
      {query.isError ? (
        <SettingsCard>
          <ErrorPanel title="Couldn't load organization settings" onRetry={() => void query.refetch()} />
        </SettingsCard>
      ) : (
        <>
          <SettingsCard
            title="Organization profile"
            description="Visible to everyone in the organization."
            testId="admin-general-card"
            footer={
              <>
                {dirty ? (
                  <span className="mr-auto text-sm text-fg-muted" aria-live="polite">
                    {hasErrors ? 'Fix the highlighted fields to save' : 'You have unsaved changes'}
                  </span>
                ) : null}
                <Button
                  variant="ghost"
                  disabled={!dirty || save.isPending}
                  onClick={() => {
                    setServerErrors({});
                    if (initial) setDraft(initial);
                  }}
                >
                  Discard
                </Button>
                <Button disabled={!dirty || hasErrors} loading={save.isPending && dirty} onClick={submit} data-testid="admin-general-save">
                  Save changes
                </Button>
              </>
            }
          >
            {!draft || !query.data ? (
              <SettingsSkeleton rows={4} />
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (dirty && !hasErrors) submit();
                }}
              >
                <SettingRow label="Logo" description="Shown in the sidebar, admin center and emails.">
                  <ImageUpload
                    name={draft.name || query.data.name}
                    src={query.data.logo}
                    shape="square"
                    size={64}
                    label="Change organization logo"
                    onChange={setLogo}
                    testId="admin-logo-upload"
                  />
                </SettingRow>
                <SettingRow label="Organization name" description="2 to 80 characters.">
                  <Field label={<span className="sr-only">Organization name</span>} error={errors.name}>
                    {({ inputId, describedBy, invalid }) => (
                      <Input
                        id={inputId}
                        aria-describedby={describedBy}
                        invalid={invalid}
                        value={draft.name}
                        maxLength={80}
                        onChange={(event) => {
                          setServerErrors({});
                          setDraft({ ...draft, name: event.target.value });
                        }}
                        data-testid="admin-org-name"
                      />
                    )}
                  </Field>
                </SettingRow>
                <SettingRow label="Organization URL" description="Changing it breaks links people have bookmarked.">
                  <Field label={<span className="sr-only">Organization URL</span>} error={errors.slug}>
                    {({ inputId, describedBy, invalid }) => (
                      <Input
                        id={inputId}
                        aria-describedby={describedBy}
                        invalid={invalid}
                        value={draft.slug}
                        maxLength={48}
                        leadingIcon={<Globe2 aria-hidden />}
                        onChange={(event) => {
                          setServerErrors({});
                          setDraft({ ...draft, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') });
                        }}
                        data-testid="admin-org-slug"
                      />
                    )}
                  </Field>
                  {slugChanged ? (
                    <p className="mt-2 flex items-start gap-1.5 text-sm text-warning-text">
                      <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                      Old links to /{initial?.slug} will stop working after you save.
                    </p>
                  ) : null}
                </SettingRow>
                <SettingRow label="Default workspace" description="Where new members land after their first sign-in.">
                  <Select
                    aria-label="Default workspace"
                    value={draft.defaultWorkspaceId}
                    onValueChange={(value) => setDraft({ ...draft, defaultWorkspaceId: value })}
                    options={[
                      { value: NO_DEFAULT, label: 'No default (home page)' },
                      ...query.data.workspaces.map((space) => ({ value: space.id, label: space.name })),
                    ]}
                  />
                </SettingRow>
              </form>
            )}
          </SettingsCard>

          {guard}
          <SettingsCard title="Data & region" description="Where your organization's data is stored.">
            {!query.data ? (
              <SettingsSkeleton rows={2} />
            ) : (
              <>
                <SettingRow label="Data region" description="Set when the organization was created.">
                  <div className="flex h-8 items-center gap-2 rounded-sm border border-border-subtle bg-sunken px-2.5 text-base text-fg-secondary">
                    <Lock aria-hidden className="size-3.5 shrink-0 text-icon" />
                    <span className="truncate">{query.data.region}</span>
                  </div>
                </SettingRow>
                <SettingRow label="Created" description="Organization ID is used by API integrations.">
                  <div className="flex flex-col gap-0.5 text-base text-fg">
                    <span>{formatDate(query.data.createdAt)}</span>
                    <code className="truncate font-mono text-xs text-fg-muted">{query.data.id}</code>
                  </div>
                </SettingRow>
              </>
            )}
          </SettingsCard>
        </>
      )}
    </>
  );
}
