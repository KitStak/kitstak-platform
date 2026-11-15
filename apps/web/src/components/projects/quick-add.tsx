'use client';

import { useState } from 'react';
import { todayIso } from '@/generated/projects/dates';
import mock from '../mock/mock.module.css';
import { DEMO_PEOPLE, DEMO_PROJECTS, EXAMPLES, demoTask, tokenKindLabel } from './quick-add-demo';
import styles from './projects-visuals.module.css';

/** Quick add, running the Projects app's own parser: type a task as one line and watch it resolve. */
export function QuickAdd() {
  const [text, setText] = useState(EXAMPLES[0]!);
  // The visitor's "today" (the static HTML carries the build date; only the date text differs).
  const [today] = useState(() => todayIso());

  const task = demoTask(text, today);
  const people = DEMO_PEOPLE.map((p) => `@${p.name.split(' ')[0]!.toLowerCase()}`).join(' ');
  const projects = DEMO_PROJECTS.map((p) => `+${p.key}`).join(' ');

  return (
    <div className={mock.panel}>
      <label htmlFor="quick-add" className={styles.quickLabel}>
        Quick add <span className={mock.muted}>The real parser from the app. Try next fri, !urgent, #sales, po2240.</span>
      </label>
      <input
        id="quick-add"
        className={styles.quickInput}
        type="text"
        value={text}
        maxLength={200}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
      />
      <div className={styles.examples}>
        {EXAMPLES.map((example, i) => (
          <button
            key={example}
            type="button"
            className={mock.smallBtn}
            aria-label={`Example ${i + 1}: ${example}`}
            onClick={() => setText(example)}
          >
            Example {i + 1}
          </button>
        ))}
      </div>
      <p className={styles.directory}>
        Sample workspace: {people} · {projects}
      </p>

      <div className={styles.result}>
        <div className={styles.resultHead}>
          <span className={mock.mono}>{task.key}</span>
          <span className={styles.resultTitle}>{task.title || 'Untitled task'}</span>
        </div>
        {task.parse.tokens.length > 0 || task.links.length > 0 ? (
          <ul className={styles.chips}>
            {task.parse.tokens.map((token) => (
              <li key={token.id} className={styles.chip} data-unresolved={token.unresolved || undefined}>
                <span className={styles.chipKind}>{tokenKindLabel(token)}</span>
                <span suppressHydrationWarning>{token.unresolved ? `${token.display} (not found)` : token.display}</span>
              </li>
            ))}
            {task.links.map((link) => (
              <li key={link.code} className={styles.chip} data-link>
                <span className={styles.chipKind}>{link.label}</span>
                <span className={mock.mono}>{link.code}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.chipsEmpty}>Nothing recognised yet: the whole line becomes the task name.</p>
        )}
      </div>
    </div>
  );
}
