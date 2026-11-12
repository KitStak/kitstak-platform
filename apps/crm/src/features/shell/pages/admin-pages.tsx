'use client';
/** Administration overview, members directory and the signed-in user's profile. */
import Link from 'next/link';
import { ChevronRight, Shield, UserRound, Users, UsersRound } from 'lucide-react';
import { Avatar, Badge, Button, EmptyState, Skeleton } from '@/components/ui';
import { useMembers, useTeams } from '@/lib/hooks';
import { useCan, useOrg } from '@/features/shell/org-context';
import { routes } from '@/features/shell/routes';
import type { MemberDto } from '@/server/services/contracts/dto';
import type { OrgRole } from '@/server/rbac/permissions';
import { PageFrame, PageSection } from './page-frame';

const ROLE_LABEL: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
  guest: 'Guest',
};

const ROLE_TONE: Record<OrgRole, 'primary' | 'info' | 'neutral' | 'warning'> = {
  owner: 'primary',
  admin: 'info',
  member: 'neutral',
  viewer: 'neutral',
  guest: 'warning',
};

function NoAccess() {
  const { org } = useOrg();
  return (
    <EmptyState
      className="h-full"
      illustration="error"
      title="Admins only"
      description="Ask an owner or admin of this organization for access."
      actions={
        <Link className="text-sm font-medium text-fg-link hover:underline" href={routes.home(org.slug)}>
          Go home
        </Link>
      }
    />
  );
}

export function AdminPage() {
  const { org } = useOrg();
  const canManage = useCan('org:update');
  const members = useMembers();
  const teams = useTeams();
  if (!canManage) return <NoAccess />;
  const cards = [
    {
      href: routes.members(org.slug),
      icon: <Users />,
      title: 'Members',
      detail: members.data ? `${members.data.length} people` : 'Manage roles and access',
    },
    {
      href: routes.members(org.slug),
      icon: <UsersRound />,
      title: 'Teams',
      detail: teams.data ? `${teams.data.length} teams` : 'Group people for assignment',
    },
    { href: routes.profile(org.slug), icon: <UserRound />, title: 'My profile', detail: 'Your name, email and role' },
  ];
  return (
    <PageFrame title="Administration" description={`Settings for ${org.name}`} icon={<Shield />}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className="group flex items-center gap-4 rounded-lg border border-border-subtle bg-panel p-5 shadow-xs transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <span className="flex size-10 items-center justify-center rounded-md bg-primary-subtle text-primary-text [&_svg]:size-5">
              {card.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-md font-semibold text-fg">{card.title}</span>
              <span className="block text-sm text-fg-muted">{card.detail}</span>
            </span>
            <ChevronRight aria-hidden className="size-4 text-icon transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </PageFrame>
  );
}

function MemberRow({ member }: { readonly member: MemberDto }) {
  return (
    <tr className="border-b border-border-subtle last:border-b-0 hover:bg-hover">
      <td className="px-5 py-3">
        <span className="flex items-center gap-3">
          <Avatar name={member.name} src={member.image} size="md" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-fg">{member.name}</span>
            <span className="block truncate text-sm text-fg-muted">{member.email}</span>
          </span>
        </span>
      </td>
      <td className="hidden px-5 py-3 text-fg-secondary md:table-cell">{member.title ?? '—'}</td>
      <td className="px-5 py-3">
        <Badge tone={ROLE_TONE[member.role]}>{ROLE_LABEL[member.role]}</Badge>
      </td>
      <td className="hidden px-5 py-3 text-sm text-fg-muted sm:table-cell">
        {new Date(member.joinedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
      </td>
    </tr>
  );
}

export function MembersPage() {
  const members = useMembers();
  const canManage = useCan('member:read');
  if (!canManage) return <NoAccess />;
  return (
    <PageFrame title="Members" description="Everyone in this organization and their role." icon={<Users />}>
      <PageSection>
        {members.isPending ? (
          <div className="flex flex-col gap-3 p-5" data-skeleton>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} height={40} rounded="md" />
            ))}
          </div>
        ) : members.isError ? (
          <EmptyState
            illustration="error"
            title="Couldn't load members"
            actions={
              <Button variant="secondary" onClick={() => void members.refetch()}>
                Try again
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-base">
              <thead>
                <tr className="border-b border-border-subtle text-xs font-semibold text-fg-muted ">
                  <th className="px-5 py-2.5 font-semibold">Name</th>
                  <th className="hidden px-5 py-2.5 font-semibold md:table-cell">Title</th>
                  <th className="px-5 py-2.5 font-semibold">Role</th>
                  <th className="hidden px-5 py-2.5 font-semibold sm:table-cell">Joined</th>
                </tr>
              </thead>
              <tbody>
                {members.data.map((member) => (
                  <MemberRow key={member.memberId} member={member} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>
    </PageFrame>
  );
}

export function ProfilePage() {
  const { org, user, role } = useOrg();
  const fields = [
    { label: 'Name', value: user.name },
    { label: 'Email', value: user.email },
    { label: 'Organization', value: org.name },
    { label: 'Role', value: ROLE_LABEL[role] },
  ];
  return (
    <PageFrame title="My profile" description="How you appear to your teammates." icon={<UserRound />}>
      <PageSection>
        <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-start">
          <Avatar name={user.name} src={user.image} size="xl" />
          <dl className="grid flex-1 gap-4 sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.label}>
                <dt className="text-xs font-semibold text-fg-muted ">{field.label}</dt>
                <dd className="mt-1 text-md text-fg">{field.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </PageSection>
    </PageFrame>
  );
}
