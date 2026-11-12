'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Badge, IconButton, Kbd, Skeleton, Switch, ToggleGroup } from '@/components/ui';
import { CellServicesProvider, type CellDensity } from '@/features/cells';
import { Logo } from '@/features/shell/logo';
import { useTheme } from '@/features/shell/theme';
import { BoardTable, EditorGrid, IconsSection, LabelsSection, Section, StateMatrix } from './gallery-sections';
import { useGalleryBoard } from './use-gallery-board';

const NAV = [
  ['table', 'Board table'],
  ['states', 'States'],
  ['editors', 'Editors'],
  ['labels', 'Labels'],
  ['icons', 'Icons'],
] as const;

const subscribeNoop = () => () => undefined;

/** The demo data is relative to "now" (due dates, last updated), so render it on the client only. */
export function CellsGallery() {
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  if (!mounted) {
    return (
      <div className="flex min-h-dvh flex-col gap-6 bg-app px-8 py-8" aria-busy="true" aria-label="Loading cells gallery">
        <Skeleton height={32} width={180} />
        <Skeleton height={16} width="60%" />
        <Skeleton height={360} rounded="lg" />
      </div>
    );
  }
  return <Gallery />;
}

function Gallery() {
  const { resolved, setPreference } = useTheme();
  const [density, setDensity] = useState<CellDensity>('default');
  const { columns, items, emptyItem, commit, services, board, failSaves, setFailSaves } = useGalleryBoard();
  const sample = items[0];

  // Static editor previews autofocus their inputs; give focus and scroll back to the page top.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
      const hash = window.location.hash.slice(1);
      const target = hash ? document.getElementById(hash) : null;
      if (target) target.scrollIntoView();
      else window.scrollTo({ top: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!sample) return null;
  return (
    <CellServicesProvider value={services}>
      <div className="min-h-dvh bg-app" data-testid="cells-gallery">
        <header className="sticky top-0 z-[var(--z-header)] border-b border-border-subtle bg-panel/90 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-8">
            <div className="flex items-center gap-3">
              <Logo />
              <Badge tone="warning">Dev only</Badge>
            </div>
            <nav aria-label="Sections" className="hidden gap-1 lg:flex">
              {NAV.map(([id, label]) => (
                <a key={id} href={`#${id}`} className="rounded-sm px-2 py-1 text-sm text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus">
                  {label}
                </a>
              ))}
            </nav>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-fg-secondary">
                <Switch checked={failSaves} onCheckedChange={setFailSaves} size="sm" data-testid="simulate-errors" />
                Simulate save errors
              </label>
              <ToggleGroup
                label="Row density"
                value={density}
                onValueChange={setDensity}
                options={[
                  { value: 'compact', label: 'Compact' },
                  { value: 'default', label: 'Default' },
                  { value: 'comfortable', label: 'Roomy' },
                ]}
              />
              <IconButton
                label={resolved === 'dark' ? 'Light theme' : 'Dark theme'}
                icon={resolved === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
                onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}
              />
            </div>
          </div>
        </header>

        <main className="mx-auto flex max-w-[1600px] flex-col gap-10 px-4 py-8 sm:px-8">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold text-fg">Cells</h1>
            <p className="max-w-3xl text-base text-fg-secondary">
              Every column type&apos;s display and editor. Click a cell (or focus it and press <Kbd>Enter</Kbd>) to edit, type to start editing text and numbers,{' '}
              <Kbd>Tab</Kbd> commits and moves on, <Kbd>Esc</Kbd> cancels, <Kbd>Delete</Kbd> clears with Undo. Arrow keys move between cells in the board table.
            </p>
          </div>

          <Section id="table" title="Board table" description="Two groups, all 28 columns (27 types + a light-palette Priority status), live editing and group footer summaries. Click a battery segment to quick-filter.">
            <BoardTable columns={columns} items={items} board={board} density={density} commit={commit} />
          </Section>

          <Section id="states" title="Every type × state" description="Display, hover affordance (folded corner, ghost icons), empty, and read-only.">
            <StateMatrix columns={columns} item={sample} emptyItem={emptyItem} board={board} density={density} commit={commit} />
          </Section>

          <Section id="editors" title="Editors" description="Each editor as it opens from its cell (inline editors shown in their editing state).">
            <EditorGrid columns={columns} item={sample} board={board} commit={commit} />
          </Section>

          <Section id="labels" title="Edit labels" description="The same editor opens inside the status picker and from the column menu.">
            <LabelsSection columns={columns} items={items} services={services} />
          </Section>

          <Section id="icons" title="Column type icons" description="Tile (pickers) and plain (column headers) variants.">
            <IconsSection />
          </Section>
        </main>
      </div>
    </CellServicesProvider>
  );
}
