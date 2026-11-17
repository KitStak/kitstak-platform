'use client';

import { useEffect, useState } from 'react';
import mock from '../mock/mock.module.css';
import styles from './crm-visuals.module.css';

interface Recipe {
  readonly name: string;
  readonly trigger: string;
  readonly condition: string;
  readonly action: string;
  /** What the test run reports, one line per step. */
  readonly log: readonly string[];
}

/** Recipes from the CRM category of the automation gallery, in plain words. */
const RECIPES: readonly Recipe[] = [
  {
    name: 'Deal won',
    trigger: 'status changes to Won',
    condition: 'the deal value is over $10,000',
    action: 'create an item in Customer onboarding and notify the owner',
    log: ['Trigger matched: Harbor & Pine kits → Won', 'Condition passed: $31,750', 'Created "Harbor & Pine kits" in Customer onboarding', 'Notified Marcus T.'],
  },
  {
    name: 'Close date',
    trigger: 'the close date is 1 day away',
    condition: 'the status is not Won',
    action: 'notify the owner and post an update',
    log: ['Trigger matched: Summit Goods closes tomorrow', 'Condition passed: status is Proposal', 'Notified Dana R.', 'Posted an update on the deal'],
  },
  {
    name: 'New lead',
    trigger: 'an item is created',
    condition: 'the owner is empty',
    action: 'assign a person and set the status to New',
    log: ['Trigger matched: Lakeside Pantry created', 'Condition passed: no owner', 'Assigned Priya S.', 'Status set to New'],
  },
  {
    name: 'Qualified lead',
    trigger: 'status changes to Qualified',
    condition: 'the email is not empty',
    action: 'create a deal and move the lead to Converted',
    log: ['Trigger matched: Cobalt Cycle → Qualified', 'Condition passed: email on file', 'Created deal "Cobalt Cycle launch"', 'Moved lead to Converted'],
  },
];
const LINE_MS = 520;

/** Automation illustration: pick a recipe, read it as a sentence, and test-run it. */
export function RecipeBuilder() {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const recipe = RECIPES[index]!;
  const lineCount = recipe.log.length;

  // Reveal the run log one line at a time while a test run is in progress.
  useEffect(() => {
    if (!isRunning) return;
    if (shown >= lineCount) {
      setIsRunning(false);
      return;
    }
    const timer = window.setTimeout(() => setShown((count) => count + 1), LINE_MS);
    return () => window.clearTimeout(timer);
  }, [isRunning, shown, lineCount]);

  const choose = (next: number) => {
    setIsRunning(false);
    setShown(0);
    setIndex(next);
  };

  const run = () => {
    setShown(1);
    setIsRunning(true);
  };

  return (
    <div className={mock.panel}>
      <div className={mock.head}>
        <div>
          <div className={mock.title}>Automation</div>
          <div className={mock.sub}>Deals board · sample recipes</div>
        </div>
      </div>

      <div className={`${mock.tabs} ${styles.recipeTabs}`} role="group" aria-label="Recipe">
        {RECIPES.map((r, i) => (
          <button key={r.name} type="button" className={mock.tab} aria-pressed={i === index} onClick={() => choose(i)}>
            {r.name}
          </button>
        ))}
      </div>

      <p className={styles.sentence} key={index}>
        <span className={styles.word}>When</span> <span className={styles.slot} data-kind="trigger">{recipe.trigger}</span>{' '}
        <span className={styles.word}>and</span> <span className={styles.slot} data-kind="condition">{recipe.condition}</span>
        <span className={styles.word}>,</span> <span className={styles.slot} data-kind="action">{recipe.action}</span>
        <span className={styles.word}>.</span>
      </p>

      <div className={styles.runBar}>
        <button type="button" className={mock.smallBtn} data-primary onClick={run} disabled={isRunning}>
          {isRunning ? 'Running…' : 'Test run'}
        </button>
        <span className={mock.muted}>Runs against a real item. Nothing is changed.</span>
      </div>

      <ol className={styles.log} aria-live="polite">
        {recipe.log.slice(0, shown).map((line) => (
          <li key={line}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
              <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
            {line}
          </li>
        ))}
      </ol>
    </div>
  );
}
