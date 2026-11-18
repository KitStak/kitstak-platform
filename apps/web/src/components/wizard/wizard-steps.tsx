'use client';

import Link from 'next/link';
import { MORE_SEATS_ACTION, PRICING, includedSeatsLabel, moreSeatsPrompt, percentLabel } from '@/lib/pricing';
import {
  BUSINESS_TYPES,
  CRM_BOARDS,
  PROJECT_TEMPLATES,
  PULSE_NEEDS,
  START_MODES,
  TEAM_SIZES,
  WMS_NEEDS,
  hasCrm,
  hasProjects,
  hasPulse,
  hasWms,
  toggleIn,
  withTeamSize,
} from '@/lib/stak';
import type { Option, StakAnswers } from '@/lib/stak';
import {
  FULL_STACK,
  ROUTES,
  STARTABLE_STACK,
  WALKTHROUGH_LABEL,
  availabilityLabel,
  isAppLive,
  toggleProduct,
} from '../site-links';
import type { ProductId } from '../site-links';
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
          <label
            key={option.value}
            className={styles.tile}
            data-checked={option.value === value || undefined}
          >
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
            <label
              key={option.value}
              className={styles.tile}
              data-checked={isChecked || undefined}
              data-multi
            >
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

const PRODUCTS: readonly { readonly value: ProductId; readonly label: string; readonly note: string }[] = [
  { value: 'wms', label: 'KitStak WMS', note: 'Receiving, inventory, picking, packing and shipping.' },
  { value: 'crm', label: 'KitStak CRM', note: 'Leads, deals, accounts and follow-ups on boards.' },
  {
    value: 'projects',
    label: 'KitStak Projects',
    note: 'Tasks, timelines and workload, linked to deals and orders.',
  },
  {
    value: 'pulse',
    label: 'KitStak Pulse',
    note: 'Profit by job, client and service, from what you log each day.',
  },
];

/** A product whose app is not open yet: shown in its place, labeled, with no box to tick. */
function ComingSoonRow({ product }: { readonly product: (typeof PRODUCTS)[number] }) {
  return (
    <div className={styles.stack} data-soon>
      <AppIcon app={product.value} size={64} className={styles.stackGlyph} />
      <span className={styles.stackText}>
        <span className={styles.stackLabel}>
          {product.label}
          <span className={styles.soon}>{availabilityLabel(product.value)}</span>
        </span>
        <span className={styles.tileNote}>{product.note}</span>
      </span>
      <Link href={ROUTES.demo} className={styles.soonLink}>
        {WALKTHROUGH_LABEL}
      </Link>
    </div>
  );
}

export function StackStep({ answers, update }: StepProps) {
  // "The whole stack" is every product that can be set up today.
  const hasAllApps = STARTABLE_STACK.length === FULL_STACK.length;
  const isEverything = answers.products.length === STARTABLE_STACK.length;
  const isPartial = answers.products.length > 0 && !isEverything;
  return (
    <fieldset className={styles.group}>
      <legend className="visually-hidden">Products</legend>
      <div className={styles.stacks}>
        <label className={styles.stack} data-checked={isEverything || undefined}>
          <input
            type="checkbox"
            className="visually-hidden"
            checked={isEverything}
            ref={(input) => {
              if (input) input.indeterminate = isPartial;
            }}
            onChange={() => update({ products: isEverything ? [] : STARTABLE_STACK })}
          />
          <span className={styles.stackGlyph}>
            <StakMark lit="both" size={44} />
          </span>
          <span className={styles.stackText}>
            <span className={styles.stackLabel}>
              {hasAllApps ? 'The whole stack' : 'Everything open today'}
              <span className={styles.badge}>Save {percentLabel(PRICING.bundleDiscount)}</span>
            </span>
            <span className={styles.tileNote}>
              {hasAllApps
                ? 'Sales, the warehouse, the work between them and the profit on every job, with one sign-in.'
                : 'Sales, the warehouse and the work between them, with one sign-in.'}
            </span>
          </span>
          <span className={styles.radio} data-multi aria-hidden />
        </label>
        {PRODUCTS.map((product) => {
          if (!isAppLive(product.value)) return <ComingSoonRow key={product.value} product={product} />;
          const isChecked = answers.products.includes(product.value);
          return (
            <label key={product.value} className={styles.stack} data-checked={isChecked || undefined}>
              <input
                type="checkbox"
                className="visually-hidden"
                checked={isChecked}
                onChange={() => update({ products: toggleProduct(answers.products, product.value) })}
              />
              <AppIcon app={product.value} size={64} className={styles.stackGlyph} />
              <span className={styles.stackText}>
                <span className={styles.stackLabel}>{product.label}</span>
                <span className={styles.tileNote}>{product.note}</span>
              </span>
              <span className={styles.radio} data-multi aria-hidden />
            </label>
          );
        })}
      </div>
      <p className={styles.reassure}>
        Pick one or more. Two or more take {percentLabel(PRICING.bundleDiscount)} off each, and you can add
        the rest later: your team and customers carry over.
      </p>
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

/** One seat count for the apps priced per user: the CRM and Projects share a sign-in. */
function SeatsQuantity({ answers, update }: StepProps) {
  const apps = [hasCrm(answers) ? 'the CRM' : null, hasProjects(answers) ? 'Projects' : null].filter(
    (app): app is string => app !== null,
  );
  const list = apps.join(' or ');
  return (
    <div className={styles.quantity}>
      <span>
        <span className={styles.quantityName}>How many people will use it?</span>
        <span className={styles.tileNote}>Anyone who signs in to {list}.</span>
      </span>
      <Stepper
        label="Users"
        value={answers.seats}
        max={PRICING.crm.max}
        onChange={(seats) => update({ seats })}
      />
    </div>
  );
}

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
          <SeatsQuantity answers={answers} update={update} />
          <ChipGroup
            legend="Which boards do you want on day one?"
            hint="Pick any. You can add the rest later."
            options={CRM_BOARDS}
            values={answers.crmBoards}
            onToggle={(value) => update({ crmBoards: toggleIn(answers.crmBoards, value) })}
          />
        </section>
      ) : null}

      {hasProjects(answers) ? (
        <section className={styles.product} aria-label="Projects">
          <h3 className={styles.productHead}>
            <AppIcon app="projects" size={38} /> Your projects
          </h3>
          {hasCrm(answers) ? null : <SeatsQuantity answers={answers} update={update} />}
          <ChipGroup
            legend="Which templates should we start from?"
            hint="Pick any. Each one comes with its tasks, dates and rules."
            options={PROJECT_TEMPLATES}
            values={answers.projectTemplates}
            onToggle={(value) => update({ projectTemplates: toggleIn(answers.projectTemplates, value) })}
          />
        </section>
      ) : null}

      {hasPulse(answers) ? (
        <section className={styles.product} aria-label="Pulse">
          <h3 className={styles.productHead}>
            <AppIcon app="pulse" size={38} /> Your jobs
          </h3>
          <p className={styles.reassure}>
            One flat price for your organization. {includedSeatsLabel('pulse')}. {moreSeatsPrompt('pulse')}{' '}
            <Link href={ROUTES.contact}>{MORE_SEATS_ACTION}</Link>
          </p>
          <ChipGroup
            legend="What do you want to see first?"
            hint="Pick any. It all comes included."
            options={PULSE_NEEDS}
            values={answers.pulseNeeds}
            onToggle={(value) => update({ pulseNeeds: toggleIn(answers.pulseNeeds, value) })}
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
              A working session to map your floor or your pipeline and load your first data together. You pick
              the time after you sign up.
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
