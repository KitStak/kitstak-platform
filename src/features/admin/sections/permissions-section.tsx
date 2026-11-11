'use client';
/** Admin → Permissions: RBAC matrix (roles × actions) with "view as" focus, and creation rules. */
import { Fragment, useState } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn, toast, ToggleGroup } from '@/components/ui';
import { ORG_ROLES, PERMISSIONS, ROLE_PERMISSIONS, type OrgRole } from '@/server/rbac/permissions';
import type { CreationPolicy } from '@/server/services/admin-contracts';
import { useOrgAdmin, useUpdateOrgPolicy } from '../api';
import { ROLE_DESCRIPTION, ROLE_LABEL } from '../format';
import { PERMISSION_LABEL, permissionGroups } from '../permission-labels';
import { ErrorPanel, SectionHeader, SettingRow, SettingsCard, SettingsSkeleton } from '../ui';

const GROUPS = permissionGroups();

export function PermissionsSection() {
  const [focus, setFocus] = useState<OrgRole | 'all'>('all');
  return (
    <>
      <SectionHeader
        title="Permissions"
        description="What each role can do across the organization. Board privacy and board-level permissions apply on top."
      />
      <CreationRulesCard />
      <SettingsCard
        title="Role permissions"
        description="Built-in roles. Every request is checked on the server against this matrix."
        padded={false}
        testId="permissions-matrix"
        aside={
          <ToggleGroup
            label="Highlight role"
            size="sm"
            value={focus}
            onValueChange={setFocus}
            options={[{ value: 'all' as const, label: 'All' }, ...ORG_ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role] }))]}
          />
        }
      >
        {focus !== 'all' ? (
          <p className="border-b border-border-subtle bg-primary-subtle px-5 py-2.5 text-sm text-primary-text" aria-live="polite">
            <strong className="font-semibold">{ROLE_LABEL[focus]}</strong>: {ROLE_DESCRIPTION[focus]}. Can do{' '}
            {ROLE_PERMISSIONS[focus].size} of {PERMISSIONS.length} actions.
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-base">
            <caption className="sr-only">Permissions granted to each organization role</caption>
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-border-subtle">
                <th scope="col" className="h-10 px-5 text-left text-xs font-semibold text-fg-muted ">
                  Action
                </th>
                {ORG_ROLES.map((role) => (
                  <th
                    key={role}
                    scope="col"
                    className={cn(
                      'h-10 w-24 px-2 text-center text-sm font-semibold transition-colors duration-[var(--duration-fast)]',
                      focus === role ? 'bg-primary-subtle text-primary-text' : 'text-fg-secondary',
                      focus !== 'all' && focus !== role && 'opacity-50',
                    )}
                  >
                    {ROLE_LABEL[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GROUPS.map(({ group, permissions }) => (
                <Fragment key={group}>
                  <tr>
                    <th
                      colSpan={ORG_ROLES.length + 1}
                      scope="colgroup"
                      className="bg-sunken/70 px-5 py-1.5 text-left text-xs font-semibold text-fg-muted "
                    >
                      {group}
                    </th>
                  </tr>
                  {permissions.map((permission) => (
                    <tr key={permission} className="border-b border-border-subtle last:border-b-0 hover:bg-hover">
                      <th scope="row" className="px-5 py-2 text-left font-normal text-fg">
                        {PERMISSION_LABEL[permission]}
                        <code className="ml-2 hidden font-mono text-2xs text-fg-muted md:inline">{permission}</code>
                      </th>
                      {ORG_ROLES.map((role) => {
                        const granted = ROLE_PERMISSIONS[role].has(permission);
                        return (
                          <td
                            key={role}
                            className={cn(
                              'px-2 py-2 text-center transition-[opacity,background-color] duration-[var(--duration-fast)]',
                              focus === role && 'bg-primary-subtle/60',
                              focus !== 'all' && focus !== role && 'opacity-40',
                            )}
                          >
                            {granted ? (
                              <Check aria-label="Allowed" className="mx-auto size-4 text-success-text" strokeWidth={2.5} />
                            ) : (
                              <Minus aria-label="Not allowed" className="mx-auto size-4 text-fg-disabled" />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsCard>
    </>
  );
}

function PolicyCards({
  name,
  value,
  onChange,
  disabled,
  noun,
}: {
  readonly name: string;
  readonly value: CreationPolicy;
  readonly onChange: (value: CreationPolicy) => void;
  readonly disabled?: boolean;
  readonly noun: string;
}) {
  const options: { value: CreationPolicy; title: string; body: string }[] = [
    { value: 'members', title: 'Members and above', body: `Members, admins and owners create ${noun}.` },
    { value: 'admins', title: 'Admins only', body: `Only owners and admins create ${noun}.` },
  ];
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => {
        const checked = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                onChange(option.value === 'members' ? 'admins' : 'members');
              }
            }}
            tabIndex={checked ? 0 : -1}
            className={cn(
              'flex items-start gap-3 rounded-lg border p-3 text-left transition-[border-color,background-color] duration-[var(--duration-fast)]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60',
              checked ? 'border-primary bg-primary-subtle' : 'border-border-subtle bg-panel hover:border-border-strong',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px]',
                checked ? 'border-primary' : 'border-border-strong',
              )}
            >
              {checked ? <span className="size-2 rounded-full bg-primary" /> : null}
            </span>
            <span>
              <span className="block text-base font-medium text-fg">{option.title}</span>
              <span className="block text-sm text-fg-muted">{option.body}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CreationRulesCard() {
  const org = useOrgAdmin();
  const update = useUpdateOrgPolicy();
  const save = (patch: { workspaceCreation?: CreationPolicy; boardCreation?: CreationPolicy }) =>
    update.mutate(patch, { onSuccess: () => toast.success('Creation rules updated') });
  return (
    <SettingsCard
      title="Who can create"
      description="Restrict creating new workspaces and boards. Changes apply immediately and are enforced on the server."
      testId="creation-rules"
    >
      {org.isError ? (
        <ErrorPanel title="Couldn't load the policy" onRetry={() => void org.refetch()} />
      ) : !org.data ? (
        <SettingsSkeleton rows={2} />
      ) : (
        <>
          <SettingRow label="Workspaces" description="Top-level spaces that hold folders and boards.">
            <PolicyCards
              name="Who can create workspaces"
              noun="workspaces"
              value={org.data.settings.workspaceCreation}
              disabled={update.isPending}
              onChange={(value) => save({ workspaceCreation: value })}
            />
          </SettingRow>
          <SettingRow label="Boards" description="Applies to every workspace, including boards created from templates.">
            <PolicyCards
              name="Who can create boards"
              noun="boards"
              value={org.data.settings.boardCreation}
              disabled={update.isPending}
              onChange={(value) => save({ boardCreation: value })}
            />
          </SettingRow>
        </>
      )}
    </SettingsCard>
  );
}
