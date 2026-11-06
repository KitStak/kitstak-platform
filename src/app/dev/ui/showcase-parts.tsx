'use client';
import { useState, type ReactNode } from 'react';
import { Copy, FolderInput, Pencil, Star, Trash2 } from 'lucide-react';
import {
  Breadcrumbs,
  Button,
  Calendar,
  Checkbox,
  ColorPicker,
  Combobox,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  Drawer,
  DrawerContent,
  DrawerTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  EmptyState,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SplitButton,
  Switch,
  WizardFooter,
  WizardSteps,
  type LabelColor,
} from '@/components/ui';

export function Section({ id, title, children }: { readonly id: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 rounded-xl border border-border-subtle bg-panel p-6 shadow-xs">
      <h2 id={`${id}-title`} className="mb-5 text-lg font-semibold text-fg">
        {title}
      </h2>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

export function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid items-center gap-3 sm:grid-cols-[140px_1fr]">
      <span className="text-sm font-medium text-fg-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export function OverlaysDemo() {
  const [compact, setCompact] = useState(true);
  return (
    <>
      <Row label="Dropdown">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">Board actions</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Board</DropdownMenuLabel>
            <DropdownMenuItem icon={<Pencil aria-hidden />} shortcut="F2">
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Copy aria-hidden />} shortcut="⌘D">
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger icon={<FolderInput aria-hidden />}>Move to</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Sales CRM</DropdownMenuItem>
                <DropdownMenuItem>Customer success</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuCheckboxItem checked={compact} onCheckedChange={(value) => setCompact(value === true)}>
              Compact rows
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem disabled icon={<Star aria-hidden />}>
              Disabled item
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="danger" icon={<Trash2 aria-hidden />}>
              Delete board
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <SplitButton
          menuLabel="More ways to add"
          renderMenu={(trigger) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Add group</DropdownMenuItem>
                <DropdownMenuItem>Import items</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        >
          New deal
        </SplitButton>
      </Row>
      <Row label="Context menu">
        <ContextMenu>
          <ContextMenuTrigger className="flex h-16 w-64 items-center justify-center rounded-lg border border-dashed border-border-strong text-sm text-fg-muted">
            Right-click here
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem shortcut="⌘C">Copy</ContextMenuItem>
            <ContextMenuItem shortcut="⌘V">Paste</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="danger">Delete</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Row>
      <Row label="Popover">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">Open popover</Button>
          </PopoverTrigger>
          <PopoverContent className="w-64">
            <p className="text-sm text-fg-secondary">Popovers hold pickers, filters and quick edits.</p>
          </PopoverContent>
        </Popover>
      </Row>
      <Row label="Dialog / wizard">
        <WizardDemo />
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="secondary">Open side panel</Button>
          </DrawerTrigger>
          <DrawerContent title="Acme renewal" description="Deals › Enterprise">
            <div className="p-6 text-fg-secondary">Item details, updates and activity render here.</div>
          </DrawerContent>
        </Drawer>
      </Row>
    </>
  );
}

const WIZARD_STEPS = [
  { id: 'a', title: 'Basics' },
  { id: 'b', title: 'Columns' },
  { id: 'c', title: 'Invite' },
];

function WizardDemo() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>Open wizard</Button>
      <DialogContent>
        <DialogHeader title="Set up pipeline" description="A three-step wizard using the shared stepper and footer." />
        <WizardSteps steps={WIZARD_STEPS} current={step} />
        <DialogBody className="min-h-32 text-fg-secondary">Step {step + 1} content.</DialogBody>
        <WizardFooter
          step={step}
          totalSteps={WIZARD_STEPS.length}
          onBack={() => setStep((value) => Math.max(0, value - 1))}
          onNext={() => (step === WIZARD_STEPS.length - 1 ? setOpen(false) : setStep(step + 1))}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

const COMBO_OPTIONS = [
  { value: 'ana', label: 'Ana Duarte', description: 'Account executive' },
  { value: 'ben', label: 'Ben Okafor', description: 'Sales manager' },
  { value: 'cho', label: 'Cho Min-jun', description: 'SDR' },
  { value: 'dev', label: 'Devi Raman', description: 'Solutions engineer' },
];

export function PickersDemo() {
  const [color, setColor] = useState<LabelColor>('green');
  const [date, setDate] = useState<Date | null>(null);
  const [calendarDate, setCalendarDate] = useState<Date | undefined>(new Date());
  const [owner, setOwner] = useState<string | null>(null);
  const [people, setPeople] = useState<string[]>(['ana']);
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(true);
  return (
    <>
      <Row label="Checkbox">
        <Checkbox label="Checked" checked={checked} onCheckedChange={(value) => setChecked(value === true)} />
        <Checkbox label="Indeterminate" checked="indeterminate" />
        <Checkbox label="Disabled" disabled />
      </Row>
      <Row label="Switch">
        <Switch checked={on} onCheckedChange={setOn} aria-label="Notifications" />
        <Switch size="sm" defaultChecked aria-label="Small" />
        <Switch disabled aria-label="Disabled" />
      </Row>
      <Row label="Combobox">
        <div className="w-60">
          <Combobox aria-label="Owner" options={COMBO_OPTIONS} value={owner} onValueChange={setOwner} placeholder="Assign owner" />
        </div>
        <div className="w-60">
          <Combobox multiple aria-label="People" options={COMBO_OPTIONS} value={people} onValueChange={setPeople} />
        </div>
      </Row>
      <Row label="Date picker">
        <div className="w-60">
          <DatePicker value={date} onChange={setDate} aria-label="Close date" />
        </div>
      </Row>
      <Row label="Calendar">
        <div className="rounded-lg border border-border-subtle p-3">
          <Calendar selected={calendarDate} onSelect={setCalendarDate} />
        </div>
      </Row>
      <Row label="Color picker">
        <ColorPicker value={color} onChange={setColor} />
      </Row>
      <Row label="Breadcrumbs">
        <Breadcrumbs items={[{ label: 'Sales CRM', href: '#' }, { label: 'Pipeline', href: '#' }, { label: 'Deals' }]} />
      </Row>
    </>
  );
}

export function EmptyStatesDemo() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {(['board', 'search', 'inbox', 'favorites', 'notifications', 'error'] as const).map((name) => (
        <div key={name} className="rounded-lg border border-border-subtle">
          <EmptyState size="sm" illustration={name} title={`${name[0]?.toUpperCase()}${name.slice(1)}`} description="Original KitStak illustration." />
        </div>
      ))}
    </div>
  );
}
