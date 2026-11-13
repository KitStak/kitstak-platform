'use client';
/**
 * Settings → Appearance: light, dark or match the device (shared with every KitStak app through
 * the kitstak-theme cookie), and whether the sidebar starts small.
 */
import { useState, useSyncExternalStore } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { DARK_QUERY, THEME_STORAGE_KEY, parseStoredTheme, persistTheme, type Theme } from '@kitstak/ui/theme';
import { Switch, cn, toast } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { useShellStore } from '@/features/shell/store';

const noopSubscribe = () => () => undefined;

function storedTheme(): Theme {
  const cookie = /(?:^|;\s*)kitstak-theme=([^;]+)/.exec(document.cookie);
  const fromCookie = parseStoredTheme(cookie ? decodeURIComponent(cookie[1]) : null);
  if (fromCookie) return fromCookie;
  try {
    return parseStoredTheme(window.localStorage.getItem(THEME_STORAGE_KEY)) ?? 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme: Theme) {
  const resolved = theme === 'system' ? (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  persistTheme(theme);
}

function MiniPreview({ dark }: { readonly dark: boolean }) {
  // Small static picture of the app in each theme (sidebar, top bar, two cards).
  const bg = dark ? '#121722' : '#F4F1EA';
  const panel = dark ? '#1B2130' : '#FFFFFF';
  const line = dark ? '#2B3242' : '#E6E1D6';
  const text = dark ? '#C9CED8' : '#2A2F3A';
  return (
    <svg viewBox="0 0 160 96" aria-hidden className="h-auto w-full rounded-md">
      <rect width="160" height="96" fill={bg} />
      <rect width="160" height="14" fill={panel} />
      <rect x="6" y="5" width="18" height="4" rx="2" fill="#C8102E" />
      <rect x="0" y="14" width="34" height="82" fill={bg} stroke={line} strokeWidth="0.5" />
      {[22, 32, 42, 52].map((y) => (
        <rect key={y} x="6" y={y} width="22" height="4" rx="2" fill={text} opacity={y === 22 ? 0.9 : 0.35} />
      ))}
      <rect x="42" y="22" width="52" height="30" rx="4" fill={panel} stroke={line} strokeWidth="0.5" />
      <rect x="100" y="22" width="52" height="30" rx="4" fill={panel} stroke={line} strokeWidth="0.5" />
      <rect x="48" y="30" width="30" height="4" rx="2" fill={text} opacity="0.8" />
      <rect x="48" y="38" width="20" height="3" rx="1.5" fill={text} opacity="0.35" />
      <rect x="106" y="30" width="26" height="4" rx="2" fill={text} opacity="0.8" />
      <rect x="106" y="38" width="34" height="3" rx="1.5" fill={text} opacity="0.35" />
      <rect x="42" y="60" width="110" height="28" rx="4" fill={panel} stroke={line} strokeWidth="0.5" />
      <rect x="48" y="68" width="60" height="4" rx="2" fill={text} opacity="0.6" />
      <rect x="132" y="66" width="14" height="8" rx="2" fill="#C8102E" />
    </svg>
  );
}

const CHOICES: readonly { value: Theme; label: string; icon: typeof Sun; hint: string }[] = [
  { value: 'light', label: 'Light', icon: Sun, hint: 'Bright and clear' },
  { value: 'dark', label: 'Dark', icon: Moon, hint: 'Easy on the eyes at night' },
  { value: 'system', label: 'Match my device', icon: Monitor, hint: 'Follows your computer or phone' },
];

export function AppearanceSection() {
  // What's stored on this device (null while rendering on the server), until the person picks one.
  const stored = useSyncExternalStore(noopSubscribe, storedTheme, () => null);
  const [chosen, setTheme] = useState<Theme | null>(null);
  const theme = chosen ?? stored;
  const collapsed = useShellStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useShellStore((state) => state.toggleSidebar);

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Theme">
        <p className="mb-3 text-sm text-fg-secondary">
          Your choice is shared with the Portal, CRM and WMS on this device.
        </p>
        <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Theme">
          {CHOICES.map((choice) => {
            const on = theme === choice.value;
            const Icon = choice.icon;
            return (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={on}
                data-testid={`theme-${choice.value}`}
                onClick={() => {
                  applyTheme(choice.value);
                  setTheme(choice.value);
                  toast.success(
                    choice.value === 'system' ? 'Matching your device' : `${choice.label} theme on`,
                  );
                }}
                className={cn(
                  'flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-[border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  on
                    ? 'border-primary shadow-[0_0_0_3px_var(--focus-ring-soft)]'
                    : 'border-border-subtle hover:border-border-strong',
                )}
              >
                {choice.value === 'system' ? (
                  <span className="grid grid-cols-2 overflow-hidden rounded-md">
                    <span className="overflow-hidden [&_svg]:w-[200%] [&_svg]:max-w-none">
                      <MiniPreview dark={false} />
                    </span>
                    <span className="overflow-hidden [&_svg]:-ml-[100%] [&_svg]:w-[200%] [&_svg]:max-w-none">
                      <MiniPreview dark />
                    </span>
                  </span>
                ) : (
                  <MiniPreview dark={choice.value === 'dark'} />
                )}
                <span className="flex items-center gap-2 px-0.5">
                  <Icon aria-hidden className="size-4 text-icon" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-fg">{choice.label}</span>
                    <span className="block text-xs text-fg-muted">{choice.hint}</span>
                  </span>
                  {on ? <Check aria-hidden className="size-4 text-primary-text" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </Panel>
      <Panel title="Layout">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium text-fg">Small sidebar</span>
            <span className="block text-xs text-fg-muted">
              Show only icons on the left to make more room. Press [ any time to switch.
            </span>
          </span>
          <Switch checked={collapsed} onCheckedChange={() => toggleSidebar()} aria-label="Small sidebar" />
        </label>
      </Panel>
    </div>
  );
}
