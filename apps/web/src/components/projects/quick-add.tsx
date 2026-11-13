'use client';

import { useState } from 'react';
import mock from '../mock/mock.module.css';
import { parseQuickAdd } from './quick-add-model';
import styles from './projects-visuals.module.css';

const EXAMPLES: readonly string[] = [
  'Print pallet labels fri !high @dana #warehouse',
  'Send kickoff deck tomorrow @marcus #onboarding',
  'Recount aisle B today !urgent @ari',
];

/** Illustration of quick add: type a task as one line and watch the fields fall out of it. */
export function QuickAdd() {
  const [text, setText] = useState(EXAMPLES[0]!);
  const task = parseQuickAdd(text);
  const fields = [
    { label: 'Due', value: task.due },
    { label: 'Priority', value: task.priority ? task.priority.charAt(0).toUpperCase() + task.priority.slice(1) : null },
    { label: 'Assignee', value: task.assignee },
    { label: 'Labels', value: task.labels.length > 0 ? task.labels.join(', ') : null },
  ];

  return (
    <div className={mock.panel}>
      <label htmlFor="quick-add" className={styles.quickLabel}>
        Quick add <span className={mock.muted}>Try it: a day, !priority, @person, #label</span>
      </label>
      <input
        id="quick-add"
        className={styles.quickInput}
        type="text"
        value={text}
        maxLength={140}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
      />
      <div className={styles.examples}>
        {EXAMPLES.map((example, i) => (
          <button key={example} type="button" className={mock.smallBtn} onClick={() => setText(example)}>
            Example {i + 1}
          </button>
        ))}
      </div>

      <div className={styles.result} aria-live="polite">
        <div className={styles.resultHead}>
          <span className={mock.mono}>OPS-46</span>
          <span className={styles.resultTitle}>{task.title || 'Untitled task'}</span>
        </div>
        <dl className={styles.fields}>
          {fields.map((field) => (
            <div key={field.label} data-set={field.value ? true : undefined}>
              <dt>{field.label}</dt>
              <dd>{field.value ?? 'Not set'}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
