'use client';
/**
 * /settings/profile: identity header (cover + 120px avatar with upload overlay) and deep-linkable
 * tabs (?tab=) for Personal info, Preferences, Notifications, Password & sessions and API tokens.
 */
import { useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Bell, KeyRound, Lock, SlidersHorizontal, UserRound } from 'lucide-react';
import { Badge, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, toast } from '@/components/ui';
import { useOrg } from '@/features/shell/org-context';
import { useProfile, useUpdateProfile } from '../api';
import { formatDate, ROLE_LABEL } from '../format';
import { ImageUpload } from '../image-upload';
import { ErrorPanel } from '../ui';
import { ApiTokensPanel } from '../sections/api-tokens-section';
import { NotificationsTab } from './notifications-tab';
import { PersonalTab } from './personal-tab';
import { PreferencesTab } from './preferences-tab';
import { SecurityTab } from './security-tab';
import { refreshSessionCache } from './session-cache';

const TABS = [
  { value: 'personal', label: 'Personal info', icon: <UserRound aria-hidden /> },
  { value: 'preferences', label: 'Preferences', icon: <SlidersHorizontal aria-hidden /> },
  { value: 'notifications', label: 'Notifications', icon: <Bell aria-hidden /> },
  { value: 'security', label: 'Password & sessions', icon: <Lock aria-hidden /> },
  { value: 'api', label: 'API tokens', icon: <KeyRound aria-hidden /> },
] as const;
type TabValue = (typeof TABS)[number]['value'];

function isTab(value: string | null): value is TabValue {
  return TABS.some((tab) => tab.value === value);
}

export function ProfilePage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { permissions } = useOrg();
  const profile = useProfile();
  const update = useUpdateProfile();
  const raw = params.get('tab');
  const tabs = TABS.filter((entry) => entry.value !== 'api' || permissions.includes('api_token:manage'));
  // Unknown or unauthorized ?tab values fall back to Personal info (and the URL is normalised).
  const allowed = isTab(raw) && tabs.some((entry) => entry.value === raw);
  const tab: TabValue = allowed ? raw : 'personal';

  useEffect(() => {
    if (raw === null || allowed) return;
    const next = new URLSearchParams(params.toString());
    next.delete('tab');
    const qs = next.toString();
    // Client-only URL fix-up (no server round trip); useSearchParams stays in sync.
    window.history.replaceState(window.history.state, '', qs ? `${pathname}?${qs}` : pathname);
  }, [raw, allowed, params, pathname]);

  const setTab = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === 'personal') next.delete('tab');
    else next.set('tab', value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const setAvatar = async (image: string | null) => {
    await update.mutateAsync({ image });
    await refreshSessionCache();
    toast.success(image ? 'Profile photo updated' : 'Profile photo removed');
    router.refresh();
  };

  const data = profile.data;
  return (
    <div className="h-full overflow-y-auto bg-app" data-testid="profile-page">
      <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
        <header className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.01em] text-fg">My profile</h1>
          </div>
        </header>
        <section className="overflow-hidden rounded-lg border border-border-subtle bg-panel">
          <div
            aria-hidden
            className="h-24 border-b border-border-subtle bg-sunken sm:h-28"
          />
          <div className="-mt-12 flex flex-col gap-4 px-5 pb-5 sm:-mt-14 sm:flex-row sm:items-start sm:gap-6 sm:px-6">
            <div className="w-fit rounded-full bg-panel p-1 shadow-sm">
              {data ? (
                <ImageUpload
                  name={data.user.name}
                  src={data.user.image}
                  shape="circle"
                  size={112}
                  label="Change profile photo"
                  onChange={setAvatar}
                  compact
                  testId="profile-avatar"
                />
              ) : (
                <Skeleton width={112} height={112} rounded="full" />
              )}
            </div>
            {/* Fixed line boxes (h-8 / min-h-6 / h-5) are shared by the skeleton so nothing shifts on load. */}
            <div className="min-w-0 pb-1 sm:pt-16" data-testid="profile-identity">
              {data ? (
                <>
                  <h2 className="h-8 truncate text-2xl leading-8 font-semibold tracking-[-0.01em] text-fg">{data.user.name}</h2>
                  <p className="mt-0.5 flex min-h-6 flex-wrap items-center gap-x-2 text-base text-fg-secondary">
                    <span>{data.user.title ?? 'No title yet'}</span>
                    <span aria-hidden className="text-fg-muted">·</span>
                    <span>{data.user.email}</span>
                    <Badge>{ROLE_LABEL[data.role]}</Badge>
                  </p>
                  <p className="mt-1 h-5 text-sm leading-5 text-fg-muted">Member since {formatDate(data.user.createdAt)}</p>
                </>
              ) : (
                <div data-skeleton aria-busy="true" aria-label="Loading profile">
                  <div className="flex h-8 items-center">
                    <Skeleton width={220} height={22} rounded="full" />
                  </div>
                  <div className="mt-0.5 flex min-h-6 items-center">
                    <Skeleton width={300} height={12} rounded="full" />
                  </div>
                  <div className="mt-1 flex h-5 items-center">
                    <Skeleton width={150} height={10} rounded="full" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {profile.isError ? (
          <section className="rounded-lg border border-border-subtle bg-panel">
            <ErrorPanel title="Couldn't load your profile" onRetry={() => void profile.refetch()} />
          </section>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="Profile sections" className="overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
              {tabs.map((entry) => (
                <TabsTrigger key={entry.value} value={entry.value} icon={entry.icon} className="shrink-0" data-testid={`profile-tab-${entry.value}`}>
                  {entry.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="personal" className="mt-6">
              <PersonalTab profile={data} />
            </TabsContent>
            <TabsContent value="preferences" className="mt-6">
              <PreferencesTab profile={data} />
            </TabsContent>
            <TabsContent value="notifications" className="mt-6">
              <NotificationsTab profile={data} />
            </TabsContent>
            <TabsContent value="security" className="mt-6">
              <SecurityTab />
            </TabsContent>
            {permissions.includes('api_token:manage') ? (
              <TabsContent value="api" className="mt-6">
                <ApiTokensPanel />
              </TabsContent>
            ) : null}
          </Tabs>
        )}
      </div>
    </div>
  );
}
