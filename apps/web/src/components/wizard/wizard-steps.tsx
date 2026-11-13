'use client';

import { PRICING, percentLabel } from '@/lib/pricing';
import {
  BUSINESS_TYPES,
  CRM_BOARDS,
  START_MODES,
  TEAM_SIZES,
  WMS_NEEDS,
  hasCrm,
  hasWms,
  toggleIn,
  withTeamSize,
} from '@/lib/stak';
import type { Option, StakAnswers } from '@/lib/stak';
import type { StackChoice } from '../site-links';
import { BillingToggle, Stepper } from '../stak/stak-parts';
import { AppIcon } from '../app-icon';
import { StakMark } from '../stak-mark';
import styles from './wizard.module.css';

export interface StepProps {
  readonly answers: StakAnswers;
  readonly update: (patch: Partial<StakAnswers>) => void;
}

/* ------------------------------------------------------------------ Shared controls */

interface TileGroupProps<T extends string> {
  readonly legend: string;
  readonly options: readonly Option<T>[];
  readonly value: T | null;
  readonly onChange: (value: T) => void;
  readonly columns?: 2 | 3 | 4;
}

/** Single choice as large tiles. A native radio group, so arrow keys work. */
function TileGroup<T extends string>({ legend, options, value, onChange, columns = 2 }: TileGroupProps<T>) {
  return (
    <fieldset className={styles.group}>
      <legend>{legend}</legend>
      <div className={styles.tiles} data-columns={columns}>
        {options.map((option) => (
          <label key={option.value} className={styles.tile} data-checked={option.value === value || undefined}>
            <input
              type="radio"
              name={legend}
              className="visually-hidden"
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span className={styles.tileLabel}>{option.label}</span>
            <span className={styles.tileNote}>{option.note}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface ChipGroupProps {
  readonly legend: string;
  readonly hint: string;
  readonly options: readonly Option<string>[];
  readonly values: readonly string[];
  readonly onToggle: (value: string) => void;
}

/** Multiple choice as tiles with a tick. */
function ChipGroup({ legend, hint, options, values, onToggle }: ChipGroupProps) {
  return (
    <fieldset className={styles.group}>
      <legend>
        {legend} <span className={styles.optional}>{hint}</span>
      </legend>
      <div className={styles.tiles} data-columns={2}>
        {options.map((option) => {
          const isChecked = values.includes(option.value);
          return (
            <label key={option.value} className={styles.tile} data-checked={isChecked || undefined} data-multi>
              <input
                type="checkbox"
                className="visually-hidden"
                checked={isChecked}
                onChange={() => onToggle(option.value)}
              />
              <span className={styles.tick} aria-hidden>
                <svg viewBox="0 0 16 16" width="12" height="12">
                  <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.4" />
                </svg>
              </span>
              <span className={styles.tileLabel}>{option.label}</span>
              <span className={styles.tileNote}>{option.note}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ 1. Stack */

const STACKS: readonly { readonly value: StackChoice; readonly label: string; readonly note: string }[] = [
  { value: 'both', label: 'Both', note: 'Sales and the warehouse on one stack, with one sign-in.' },
  { value: 'wms', label: 'KitStak WMS', note: 'Receiving, inventory, picking, packing and shipping.' },
  { value: 'crm', label: 'KitStak CRM', note: 'Leads, deals, accounts and follow-ups on boards.' },
];

export function StackStep({ answers, update }: StepProps) {
  return (
    <fieldset className={styles.group}>
      <legend className="visually-hidden">Products</legend>
      <div className={styles.stacks}>
        {STACKS.map((stack) => (
          <label key={stack.value} className={styles.stack} data-checked={answers.focus === stack.value || undefined}>
            <input
              type="radio"
              name="stack"
              className="visually-hidden"
              checked={answers.focus === stack.value}
              onChange={() => update({ focus: stack.value })}
            />
            {stack.value === 'both' ? (
              <span className={styles.stackGlyph}>
                <StakMark lit="both" size={44} />
              </span>
            ) : (
              <AppIcon app={stack.value} size={64} className={styles.stackGlyph} />
            )}
            <span className={styles.stackText}>
              <span className={styles.stackLabel}>
                {stack.label}
                {stack.value === 'both' ? (
                  <span className={styles.badge}>Save {percentLabel(PRICING.bundleDiscount)}</span>
                ) : null}
              </span>
              <span className={styles.tileNote}>{stack.note}</span>
            </span>
            <span className={styles.radio} aria-hidden />
          </label>
        ))}
      </div>
      <p className={styles.reassure}>You can add the other product later. Your team and customers carry over.</p>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ 2. Business */

export function BusinessStep({ answers, update }: StepProps) {
  return (
    <>
      <TileGroup
        legend="What kind of business are you?"
        options={BUSINESS_TYPES}
        value={answers.businessType}
        onChange={(businessType) => update({ businessType })}
      />
      <TileGroup
        legend="How big is your team?"
        options={TEAM_SIZES}
        value={answers.teamSize}
        onChange={(teamSize) => update(withTeamSize(answers, teamSize))}
        columns={4}
      />
    </>
  );
}

/* ------------------------------------------------------------------ 3. Shape */

export function ShapeStep({ answers, update }: StepProps) {
  return (
    <>
      {hasWms(answers) ? (
        <section className={styles.product} aria-label="Warehouse">
          <h3 className={styles.productHead}>
            <AppIcon app="wms" size={38} /> Your warehouse
          </h3>
          <div className={styles.quantity}>
            <span>
              <span className={styles.quantityName}>How many warehouses?</span>
              <span className={styles.tileNote}>Buildings you hold stock in. Add more any time.</span>
            </span>
            <Stepper
              label="Warehouses"
              value={answers.warehouses}
              max={PRICING.wms.max}
              onChange={(warehouses) => update({ warehouses })}
            />
          </div>
          <ChipGroup
            legend="What do you need working first?"
            hint="Pick any. It all comes included."
            options={WMS_NEEDS}
            values={answers.wmsNeeds}
            onToggle={(value) => update({ wmsNeeds: toggleIn(answers.wmsNeeds, value) })}
          />
        </section>
      ) : null}

      {hasCrm(answers) ? (
        <section className={styles.product} aria-label="CRM">
          <h3 className={styles.productHead}>
            <AppIcon app="crm" size={38} /> Your CRM
          </h3>
          <div className={styles.quantity}>
            <span>
              <span className={styles.quantityName}>How many people will use it?</span>
              <span className={styles.tileNote}>Anyone who signs in to the CRM.</span>
            </span>
            <Stepper label="CRM users" value={answers.seats} max={PRICING.crm.max} onChange={(seats) => update({ seats })} />
          </div>
          <ChipGroup
            legend="Which boards do you want on day one?"
            hint="Pick any. You can add the rest later."
            options={CRM_BOARDS}
            values={answers.crmBoards}
            onToggle={(value) => update({ crmBoards: toggleIn(answers.crmBoards, value) })}
          />
        </section>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ 4. Launch */

export function LaunchStep({ answers, update }: StepProps) {
  return (
    <>
      <TileGroup
        legend="How do you want to start?"
        options={START_MODES}
        value={answers.startMode}
        onChange={(startMode) => update({ startMode })}
        columns={3}
      />

      <fieldset className={styles.group}>
        <legend>
          Want a hand? <span className={styles.optional}>Optional</span>
        </legend>
        <label className={styles.addon} data-checked={answers.guided || undefined}>
          <input
            type="checkbox"
            className="visually-hidden"
            checked={answers.guided}
            onChange={() => update({ guided: !answers.guided })}
          />
          <span className={styles.tick} aria-hidden>
            <svg viewBox="0 0 16 16" width="12" height="12">
              <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.4" />
            </svg>
          </span>
          <span>
            <span className={styles.tileLabel}>Guided setup with the founder</span>
            <span className={styles.tileNote}>
              A working session to map your floor or your pipeline and load your first data together. You pick the time
              after you sign up.
            </span>
          </span>
        </label>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>How would you like to pay?</legend>
        <BillingToggle value={answers.billing} onChange={(billing) => update({ billing })} />
        <p className={styles.reassure}>Nothing is charged during setup.</p>
      </fieldset>
    </>
  );
}
