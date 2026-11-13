import { AppIcon } from '../app-icon';
import mock from '../mock/mock.module.css';
import styles from './projects-visuals.module.css';

/* ------------------------------------------------------------------ Cross-app recipes */

const RECIPES = [
  {
    from: 'CRM',
    app: 'crm',
    when: 'a deal is won',
    then: 'create a project from the Client onboarding template',
  },
  {
    from: 'WMS',
    app: 'wms',
    when: 'a receipt has a discrepancy',
    then: 'create a task to resolve it',
  },
  {
    from: 'WMS',
    app: 'wms',
    when: 'a count shows a variance',
    then: 'create a task to recount the location',
  },
] as const;

/** The three ready-made recipes that start project work from something another app saw. */
export function CrossRecipes() {
  return (
    <ul className={styles.recipes}>
      {RECIPES.map((recipe, i) => (
        <li key={recipe.when} className={mock.panel} data-reveal style={{ '--reveal-delay': 90 * i } as React.CSSProperties}>
          <span className={styles.recipeFrom}>
            <AppIcon app={recipe.app} size={28} /> From the {recipe.from}
          </span>
          <p className={styles.recipeLine}>
            <span className={styles.recipeWord}>When</span> <span className={styles.recipeWhen}>{recipe.when}</span>
            <span className={styles.recipeWord}>,</span> <span className={styles.recipeThen}>{recipe.then}</span>
            <span className={styles.recipeWord}>.</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ Customer card */

const SIGNALS = [
  { app: 'CRM', icon: 'crm', label: 'Deal stage', value: 'Renewal · proposal sent', token: 'orange' },
  { app: 'WMS', icon: 'wms', label: 'Receiving', value: '1 receipt running late', token: 'red' },
  { app: 'WMS', icon: 'wms', label: 'Open order', value: 'SO-10482 · picking', token: 'sky' },
  { app: 'Projects', icon: 'projects', label: 'Onboarding project', value: 'At risk · 3 tasks overdue', token: 'orange' },
] as const;

/** The customer card on a project's Overview: what sales, the warehouse and the project each know. */
export function CustomerCard() {
  return (
    <div className={mock.panel} data-lifted>
      <div className={mock.head}>
        <div>
          <div className={mock.title}>Harbor &amp; Pine</div>
          <div className={mock.sub}>Customer · one record across every app · sample data</div>
        </div>
      </div>
      <ul className={mock.rows}>
        {SIGNALS.map((signal) => (
          <li key={signal.label} className={`${mock.row} ${styles.signal}`}>
            <span className={styles.signalFrom}>
              <AppIcon app={signal.icon} size={30} />
              <span>
                <span className={styles.signalLabel}>{signal.label}</span>
                <span className={styles.signalApp}>{signal.app}</span>
              </span>
            </span>
            <span
              className={mock.pill}
              style={
                {
                  '--tone-subtle': `var(--label-${signal.token}-subtle)`,
                  '--tone-text': `var(--label-${signal.token}-text)`,
                } as React.CSSProperties
              }
            >
              {signal.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
