'use client';
import { useState } from 'react';
import { Bell, Filter, SquareKanban, Moon, Plus, Search, Sun, Table2, Trash2 } from 'lucide-react';
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  Chip,
  CountBadge,
  Field,
  IconButton,
  Input,
  Kbd,
  LABEL_COLORS,
  LABEL_COLOR_NAMES,
  ProgressBar,
  ScrollArea,
  SearchInput,
  Select,
  Separator,
  Skeleton,
  SkeletonRows,
  Spinner,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  ToggleGroup,
  Tooltip,
  labelColorStyle,
  toast,
} from '@/components/ui';
import { Logo } from '@/features/shell/logo';
import { useTheme } from '@/features/shell/theme';
import { EmptyStatesDemo, OverlaysDemo, PickersDemo, Row, Section } from './showcase-parts';

const VARIANTS = ['primary', 'secondary', 'tertiary', 'ghost', 'danger'] as const;
const SIZES = ['xs', 'sm', 'md', 'lg'] as const;
const PEOPLE = ['Ana Duarte', 'Ben Okafor', 'Cho Min-jun', 'Devi Raman', 'Eli Novak', 'Farah Haddad', 'Gus Lindqvist'].map(
  (name, index) => ({ id: `p${index}`, name }),
);

const NAV = ['buttons', 'inputs', 'pickers', 'overlays', 'navigation', 'identity', 'labels', 'feedback', 'empty'];

export function Showcase() {
  const { resolved, setPreference } = useTheme();
  const [search, setSearch] = useState('');
  const [density, setDensity] = useState<'compact' | 'default' | 'comfortable'>('default');
  const [stage, setStage] = useState('qualified');

  return (
    <div className="min-h-dvh bg-app">
      <header className="sticky top-0 z-[var(--z-header)] flex items-center justify-between border-b border-border-subtle bg-panel/90 px-8 py-3 backdrop-blur">
        <div className="flex items-center gap-4">
          <Logo />
          <Badge tone="warning">Dev only</Badge>
        </div>
        <nav aria-label="Sections" className="hidden gap-1 lg:flex">
          {NAV.map((id) => (
            <a key={id} href={`#${id}`} className="rounded-sm px-2 py-1 text-sm text-fg-secondary capitalize hover:bg-hover hover:text-fg">
              {id}
            </a>
          ))}
        </nav>
        <IconButton
          label={resolved === 'dark' ? 'Light theme' : 'Dark theme'}
          icon={resolved === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
          onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}
        />
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-8">
        <Section id="buttons" title="Buttons">
          {VARIANTS.map((variant) => (
            <Row key={variant} label={variant}>
              {SIZES.map((size) => (
                <Button key={size} variant={variant} size={size}>
                  {size.toUpperCase()} button
                </Button>
              ))}
              <Button variant={variant} leadingIcon={<Plus aria-hidden />}>
                With icon
              </Button>
              <Button variant={variant} loading>
                Loading
              </Button>
              <Button variant={variant} disabled>
                Disabled
              </Button>
              <Button variant={variant} pressed>
                Pressed
              </Button>
            </Row>
          ))}
          <Row label="Icon buttons">
            <IconButton label="Search" icon={<Search aria-hidden />} shortcut={['⌘', 'K']} />
            <IconButton label="Notifications" icon={<Bell aria-hidden />} badge={<CountBadge count={7} ringClassName="ring-[var(--surface-panel)]" />} />
            <IconButton label="Filter (active)" icon={<Filter aria-hidden />} active />
            <IconButton label="Add" icon={<Plus aria-hidden />} variant="solid" />
            <IconButton label="Outline" icon={<Table2 aria-hidden />} variant="outline" />
            <IconButton label="Delete" icon={<Trash2 aria-hidden />} variant="danger" />
            <IconButton label="Loading" icon={<Plus aria-hidden />} loading />
            <IconButton label="Disabled" icon={<Plus aria-hidden />} disabled />
          </Row>
          <Row label="Toggle group">
            <ToggleGroup
              label="Density"
              value={density}
              onValueChange={setDensity}
              options={[
                { value: 'compact', label: 'Compact' },
                { value: 'default', label: 'Default' },
                { value: 'comfortable', label: 'Comfortable' },
              ]}
            />
            <ToggleGroup
              label="View"
              value="table"
              onValueChange={() => undefined}
              options={[
                { value: 'table', label: 'Table', icon: <Table2 aria-hidden />, iconOnly: true },
                { value: 'kanban', label: 'Kanban', icon: <SquareKanban aria-hidden />, iconOnly: true },
              ]}
            />
          </Row>
        </Section>

        <Section id="inputs" title="Inputs">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Deal name" hint="Shown on every board view.">
              {({ inputId, describedBy }) => <Input id={inputId} aria-describedby={describedBy} placeholder="Acme expansion" />}
            </Field>
            <Field label="Amount" error="Enter a positive number.">
              {({ inputId, describedBy, invalid }) => (
                <Input id={inputId} aria-describedby={describedBy} invalid={invalid} defaultValue="-40" />
              )}
            </Field>
            <Field label="Disabled">{({ inputId }) => <Input id={inputId} disabled defaultValue="Read only" />}</Field>
            <Field label="Search">
              {({ inputId }) => <SearchInput id={inputId} value={search} onValueChange={setSearch} placeholder="Search items" />}
            </Field>
            <Field label="Stage">
              {({ inputId }) => (
                <Select
                  id={inputId}
                  value={stage}
                  onValueChange={setStage}
                  options={[
                    { value: 'lead', label: 'Lead' },
                    { value: 'qualified', label: 'Qualified' },
                    { value: 'proposal', label: 'Proposal' },
                    { value: 'won', label: 'Won' },
                  ]}
                />
              )}
            </Field>
            <Field label="Notes">{({ inputId }) => <Textarea id={inputId} placeholder="Add context for the team…" />}</Field>
          </div>
        </Section>

        <Section id="pickers" title="Selection & pickers">
          <PickersDemo />
        </Section>

        <Section id="overlays" title="Menus & overlays">
          <OverlaysDemo />
        </Section>

        <Section id="navigation" title="Tabs">
          <Tabs defaultValue="main">
            <TabsList variant="view">
              <TabsTrigger variant="view" value="main" icon={<Table2 aria-hidden />}>
                Main table
              </TabsTrigger>
              <TabsTrigger variant="view" value="kanban" icon={<SquareKanban aria-hidden />}>
                Kanban
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs defaultValue="recents">
            <TabsList>
              <TabsTrigger value="recents">Recents</TabsTrigger>
              <TabsTrigger value="content" count={12}>
                Content
              </TabsTrigger>
              <TabsTrigger value="members">Members</TabsTrigger>
              <TabsTrigger value="disabled" disabled>
                Disabled
              </TabsTrigger>
            </TabsList>
            <TabsContent value="recents" className="pt-4 text-fg-secondary">
              Underline tabs for page-level sections.
            </TabsContent>
          </Tabs>
          <Tabs defaultValue="all">
            <TabsList variant="pill">
              <TabsTrigger variant="pill" value="all">
                All
              </TabsTrigger>
              <TabsTrigger variant="pill" value="unread">
                Unread
              </TabsTrigger>
              <TabsTrigger variant="pill" value="mentions">
                Mentions
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </Section>

        <Section id="identity" title="Avatars, badges & chips">
          <Row label="Avatars">
            {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
              <Avatar key={size} name="Ana Duarte" size={size} presence={size === 'lg' ? 'online' : undefined} />
            ))}
            <Avatar name="Northwind" shape="square" size="lg" />
            <AvatarGroup people={PEOPLE} max={4} size="md" />
          </Row>
          <Row label="Badges">
            {(['neutral', 'primary', 'success', 'warning', 'danger', 'info', 'solid', 'outline'] as const).map((tone) => (
              <Badge key={tone} tone={tone}>
                {tone}
              </Badge>
            ))}
            <CountBadge count={3} ringClassName="ring-[var(--surface-panel)]" />
            <CountBadge count={240} ringClassName="ring-[var(--surface-panel)]" />
          </Row>
          <Row label="Chips">
            <Chip color="purple">Enterprise</Chip>
            <Chip color="teal" appearance="solid">
              Renewal
            </Chip>
            <Chip color="orange" appearance="outline">
              At risk
            </Chip>
            <Chip onRemove={() => toast.info('Removed tag')}>Removable</Chip>
            <Chip onClick={() => toast.info('Filter toggled')} selected>
              Selected filter
            </Chip>
          </Row>
          <Row label="Kbd">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
            <Tooltip content="Search everything" shortcut={['⌘', 'K']}>
              <Button variant="ghost">Hover for tooltip</Button>
            </Tooltip>
          </Row>
        </Section>

        <Section id="labels" title="Status label palette (white text ≥ 4.5:1)">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {LABEL_COLORS.map((color) => (
              <div key={color} style={labelColorStyle(color)} className="flex flex-col overflow-hidden rounded-md border border-border-subtle">
                <span className="flex h-9 items-center justify-center bg-[var(--lc-bg)] text-sm font-semibold text-[var(--lc-fg)] transition-colors hover:bg-[var(--lc-hover)]">
                  {LABEL_COLOR_NAMES[color]}
                </span>
                <span className="bg-[var(--lc-subtle)] px-2 py-1 text-center text-xs text-fg-secondary">{color}</span>
              </div>
            ))}
          </div>
          <Row label="Status pills">
            <StatusPill label="Done" color="green" />
            <StatusPill label="Working on it" color="orange" />
            <StatusPill label="Stuck" color="red" />
            <StatusPill label="" color="gray" />
          </Row>
        </Section>

        <Section id="feedback" title="Feedback">
          <Row label="Toasts">
            <Button variant="secondary" onClick={() => toast.success('Deal moved to Won')}>
              Success
            </Button>
            <Button variant="secondary" onClick={() => toast.error("Couldn't save", 'You are offline.')}>
              Error
            </Button>
            <Button variant="secondary" onClick={() => toast.undo('3 items deleted', { onUndo: () => void toast.success('Restored') })}>
              With undo
            </Button>
          </Row>
          <Row label="Spinners">
            <Spinner size="xs" />
            <Spinner size="sm" />
            <Spinner size="md" className="text-primary" />
            <Spinner size="lg" className="text-primary" />
          </Row>
          <Row label="Progress">
            <ProgressBar label="Pipeline goal" value={64} showValue className="w-64" />
            <ProgressBar label="Uploading" tone="success" value={100} showValue className="w-64" />
            <ProgressBar label="Syncing" className="w-64" />
          </Row>
          <Row label="Skeleton">
            <Skeleton width={180} height={12} rounded="full" />
            <Skeleton width={36} height={36} rounded="full" />
            <SkeletonRows rows={3} className="w-64" />
          </Row>
          <Row label="Scroll area">
            <ScrollArea className="h-28 w-64 rounded-md border border-border-subtle">
              <div className="p-3 text-sm text-fg-secondary">
                {Array.from({ length: 14 }, (_, index) => (
                  <p key={index} className="py-1">
                    Activity entry {index + 1}
                  </p>
                ))}
              </div>
            </ScrollArea>
            <Separator orientation="vertical" className="h-10" />
          </Row>
        </Section>

        <Section id="empty" title="Empty states">
          <EmptyStatesDemo />
        </Section>
      </main>
    </div>
  );
}
