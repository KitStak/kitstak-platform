import type { ArticleBlock } from './articles-content';
import { InlineText } from './inline-text';
import styles from './articles.module.css';

export function ArticleBody({ blocks }: { readonly blocks: readonly ArticleBlock[] }) {
  return (
    <div className={styles.prose}>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        switch (block.type) {
          case 'h2':
            return <h2 key={key}>{block.text}</h2>;
          case 'h3':
            return <h3 key={key}>{block.text}</h3>;
          case 'ul':
            return (
              <ul key={key}>
                {block.items.map((item) => (
                  <li key={item}>
                    <InlineText text={item} />
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={key}>
                {block.items.map((item) => (
                  <li key={item}>
                    <InlineText text={item} />
                  </li>
                ))}
              </ol>
            );
          case 'callout':
            return (
              <aside key={key} className={styles.callout}>
                <p className={styles.calloutTitle}>{block.title}</p>
                <p>
                  <InlineText text={block.text} />
                </p>
              </aside>
            );
          case 'table':
            return (
              <div key={key} className={styles.tableWrap} role="region" aria-label="Table" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      {block.head.map((cell) => (
                        <th key={cell} scope="col">
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row) => (
                      <tr key={row.join('|')}>
                        {row.map((cell, i) =>
                          i === 0 ? (
                            <th key={cell} scope="row">
                              {cell}
                            </th>
                          ) : (
                            <td key={`${i}-${cell}`}>{cell}</td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return (
              <p key={key}>
                <InlineText text={block.text} />
              </p>
            );
        }
      })}
    </div>
  );
}
