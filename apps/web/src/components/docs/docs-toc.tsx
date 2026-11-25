import styles from './docs.module.css';

/** "On this page": the h2 headings of the open page. */
export function DocsToc({
  headings,
}: {
  readonly headings: readonly { readonly id: string; readonly text: string }[];
}) {
  if (headings.length < 2) return null;
  return (
    <nav className={styles.toc} aria-label="On this page">
      <p className={styles.tocTitle}>On this page</p>
      <ul>
        {headings.map((h) => (
          <li key={h.id}>
            <a href={`#${h.id}`}>{h.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
