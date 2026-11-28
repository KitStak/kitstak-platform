'use client';
/** People and roles (docs/crew/SPEC.md 3.1): a Crew role per member, with site scope for supervisors and leads. */
import { useState } from 'react';
import { Panel } from '@/components/layout/page';
import { Badge, Button, Checkbox, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, type SelectOption } from '@/components/ui';
import { setMemberRoleAction } from '@/server/actions/settings';
import { CREW_ROLE_DESCRIPTIONS, CREW_ROLE_LABELS, type CrewRole } from '@/lib/permissions';
import { useRun } from '@/features/people/bits';

export interface RoleMember {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly orgRole: string;
  readonly role: CrewRole;
  readonly siteIds: string[] | null;
  readonly source: 'explicit' | 'org';
}

function MemberRow({ member, sites, assignable, me }: { readonly member: RoleMember; readonly sites: readonly SelectOption[]; readonly assignable: readonly CrewRole[]; readonly me: string }) {
  const { run, pending } = useRun();
  const [role, setRole] = useState<CrewRole>(member.role);
  const [siteIds, setSiteIds] = useState<string[]>(member.siteIds ?? []);
  const scoped = role === 'supervisor' || role === 'lead';
  const options = (assignable.includes(member.role) ? assignable : [member.role, ...assignable]).map((value) => ({ value, label: CREW_ROLE_LABELS[value], description: CREW_ROLE_DESCRIPTIONS[value], disabled: !assignable.includes(value) }));
  const dirty = role !== member.role || (scoped && JSON.stringify([...siteIds].sort()) !== JSON.stringify([...(member.siteIds ?? [])].sort()));
  return (
    <TableRow data-testid="role-row">
      <TableCell>
        <p className="font-medium text-fg">
          {member.name} {member.userId === me ? <span className="text-xs text-fg-muted">(you)</span> : null}
        </p>
        <p className="text-xs text-fg-muted">{member.email}</p>
      </TableCell>
      <TableCell>
        <Badge tone="outline">{member.orgRole}</Badge>
      </TableCell>
      <TableCell className="w-56">
        <Select aria-label={`Crew role for ${member.name}`} value={role} onValueChange={(value) => setRole(value as CrewRole)} options={options} disabled={!assignable.includes(member.role) && member.role === 'owner'} />
        {member.source === 'org' ? <p className="mt-1 text-xs text-fg-muted">From the workspace role</p> : null}
      </TableCell>
      <TableCell>
        {scoped ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {sites.map((site) => (
              <Checkbox
                key={site.value}
                size="sm"
                label={site.label}
                checked={siteIds.includes(site.value)}
                onCheckedChange={(on) => setSiteIds((current) => (on === true ? [...current, site.value] : current.filter((id) => id !== site.value)))}
              />
            ))}
            <span className="text-xs text-fg-muted">{siteIds.length === 0 ? 'None ticked means every site.' : ''}</span>
          </div>
        ) : (
          <span className="text-xs text-fg-muted">Every site</span>
        )}
      </TableCell>
      <TableCell>
        <Button size="sm" variant="secondary" disabled={!dirty} loading={pending === 'save'} onClick={() => void run('save', () => setMemberRoleAction({ userId: member.userId, role, siteIds: scoped && siteIds.length > 0 ? siteIds : null }), { success: `${member.name} is ${CREW_ROLE_LABELS[role]}` })}>
          Save
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function RolesPanel({ members, sites, assignable, me }: { readonly members: readonly RoleMember[]; readonly sites: readonly SelectOption[]; readonly assignable: readonly CrewRole[]; readonly me: string }) {
  return (
    <Panel title="People and roles" bodyClassName="p-0">
      <p className="px-4 pt-3 text-sm text-fg-secondary">Owners, admins and Payroll see pay. Supervisors and leads never do: the server leaves those fields out.</p>
      <Table data-testid="settings-roles">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Member</TableHeaderCell>
            <TableHeaderCell>Workspace role</TableHeaderCell>
            <TableHeaderCell>Crew role</TableHeaderCell>
            <TableHeaderCell>Sites</TableHeaderCell>
            <TableHeaderCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {members.map((member) => (
            <MemberRow key={`${member.userId}-${member.role}-${(member.siteIds ?? []).join()}`} member={member} sites={sites} assignable={assignable} me={me} />
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}
