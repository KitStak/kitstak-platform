/**
 * Content for the "Setting up your warehouse" screen shown while a new organization's
 * warehouse is provisioned (setup-warehouse/setup-form.tsx): the app loaders it cycles
 * through and the warehouse chores it shows one at a time. Pure, so it is unit tested.
 */

/** How long each chore (and app loader) stays on screen. */
export const SETUP_STEP_MS = 4_000;

/** After this long the screen adds a "still working" line. */
export const SETUP_SLOW_MS = 45_000;

/** The brand pack's animated loaders, WMS first (served from public/brand). */
export const SETUP_LOADERS: readonly { readonly key: string; readonly src: string; readonly label: string }[] = [
  { key: 'wms', src: '/brand/kitstak-loader-wms.svg', label: 'KitStak WMS' },
  { key: 'kitstak', src: '/brand/kitstak-loader-kitstak.svg', label: 'KitStak' },
  { key: 'crm', src: '/brand/loaders/kitstak-loader-crm.svg', label: 'KitStak CRM' },
  { key: 'projects', src: '/brand/loaders/kitstak-loader-projects.svg', label: 'KitStak Projects' },
  { key: 'pulse', src: '/brand/loaders/kitstak-loader-pulse.svg', label: 'KitStak Pulse' },
  { key: 'portal', src: '/brand/loaders/kitstak-loader-portal.svg', label: 'KitStak Portal' },
];

/** Thirty warehouse chores, shown one at a time: the first as the opener, the rest shuffled. */
export const SETUP_MESSAGES: readonly string[] = [
  'Making sure the floors are swept…',
  'Wiring the baler…',
  'Swapping out the forks…',
  'Charging the forklifts…',
  'Bolting down the pallet racks…',
  'Labeling the rack uprights…',
  'Painting the aisle lines…',
  'Numbering the bin locations…',
  'Testing the dock levelers…',
  'Rolling up the dock doors…',
  'Mounting the dock bumpers…',
  'Calibrating the shipping scales…',
  'Loading the label printers…',
  'Stocking the tape guns…',
  'Folding the first cartons…',
  'Restocking the void fill…',
  'Setting up the pack stations…',
  'Pairing the RF scanners…',
  'Tuning the conveyor belts…',
  'Topping off the pallet jack hydraulics…',
  'Stretch-wrapping the first pallet…',
  'Stacking the empty pallets…',
  'Clearing the staging lanes…',
  'Hanging the safety signs…',
  'Checking the sprinkler heads…',
  'Unlocking the receiving door…',
  'Printing the cycle count sheets…',
  'Posting the shift schedule…',
  'Handing out hi-vis vests…',
  'Brewing coffee for the break room…',
];

/** A shuffled copy (Fisher-Yates); the input is left untouched. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** The index shown at `tick`, wrapping around a list of `length` items. */
export function indexAt(length: number, tick: number): number {
  if (length <= 0) return 0;
  return ((Math.trunc(tick) % length) + length) % length;
}
