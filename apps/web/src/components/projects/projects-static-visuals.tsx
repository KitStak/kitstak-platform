import { PROJECTS_CATALOG } from '@/generated/projects/catalog';
import { AppIcon } from '../app-icon';
import mock from '../mock/mock.module.css';
import styles from './projects-visuals.module.css';

/* ------------------------------------------------------------------ Cross-app recipes */

const APP_NAME = { crm: 'CRM', wms: 'WMS' } as const;

/**
 * The workspace rules that start project work from something another app saw. Read from the
 * Projects app's record-trigger library, so a new trigger there shows up here on the next build.
 */
export function CrossRecipes() {
  return (
    <ul className={styles.recipes}>
      {PROJECTS_CATALOG.recordTriggers.map((recipe, i) => (
        <li key={recipe.kind} className={mock.panel} data-reveal style={{ '--reveal-delay': 90 * i } as React.CSSProperties}>
          <span className={styles.recipeFrom}>
            <AppIcon app={recipe.app} size={28} /> From the {APP_NAME[recipe.app]}
          </span>
          <p className={styles.recipeLine}>
            <span className={styles.recipeWhen}>{recipe.title}.</span> {recipe.description}
          </p>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ Templates */

/** Built-in templates, with the counts the app's own template preview shows. */
export function TemplateGrid() {
  return (
    <ul className={styles.templates}>
      {PROJECTS_CATALOG.templates.map((template, i) => (
        <li
          key={template.slug}
          className={styles.template}
          data-reveal
          style={{ '--reveal-delay': 50 * (i % 4) } as React.CSSProperties}
        >
          <span className={styles.templateCategory}>{template.category}</span>
          <span className={styles.templateName}>{template.name}</span>
          <span className={styles.templateBody}>{template.description}</span>
          <span className={styles.templateMeta}>
            <span>{template.tasks} tasks</span>
            {template.subtasks > 0 ? <span>{template.subtasks} subtasks</span> : null}
            {template.milestones > 0 ? (
              <span>
                {template.milestones} milestone{template.milestones === 1 ? '' : 's'}
              </span>
            ) : null}
            {template.automations > 0 ? (
              <span>
                {template.automations} rule{template.automations === 1 ? '' : 's'}
              </span>
            ) : null}
          </span>
          {template.sections.length > 0 ? (
            <span className={styles.templateSections}>{template.sections.join(' → ')}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ Customer card */

const SIGNALS = [
  { app: 'CRM', icon: 'crm', label: 'Deal stage', value: 'Renewal · proposal sent', token: 'orange' },
  { app: 'WMS', icon: 'wms', label: 'Receiving', value: '1 receipt running late', token: 'red' },
  { app: 'WMS', icon: 'wms', label: 'Open order', value: 'SO010482 · picking', token: 'sky' },
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
