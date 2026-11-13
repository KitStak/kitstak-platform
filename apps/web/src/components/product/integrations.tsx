import styles from './integrations.module.css';

export interface IntegrationGroup {
  readonly title: string;
  readonly note: string;
  readonly names: readonly string[];
}

/** Named connections as a ruled wall of wordmarks-in-type (no third-party logos). */
export function IntegrationWall({ groups }: { readonly groups: readonly IntegrationGroup[] }) {
  return (
    <div className={styles.wall}>
      {groups.map((group) => (
        <div key={group.title} className={styles.group} data-reveal>
          <div>
            <h3 className={styles.groupTitle}>
              <span className={`numeral ${styles.count}`}>{group.names.length}</span>
              {group.title}
            </h3>
            <p className={styles.groupNote}>{group.note}</p>
          </div>
          <ul className={styles.names}>
            {group.names.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
