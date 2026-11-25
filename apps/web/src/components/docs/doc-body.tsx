import type { DocBlock } from '@/lib/docs/markdown';
import { InlineText } from '../articles/inline-text';
import styles from './docs.module.css';

const CALLOUT_LABEL = { note: 'Note', tip: 'Tip', important: 'Important' } as const;

/** One docs page body, as plain server HTML. */
export function DocBody({ blocks }: { readonly blocks: readonly DocBlock[] }) {
  return (
    <div className={styles.prose}>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        switch (block.type) {
          case 'h2':
          case 'h3': {
            const Tag = block.type;
            return (
              <Tag key={key} id={block.id}>
                <a href={`#${block.id}`} className={styles.anchor}>
                  <InlineText text={block.text} />
                </a>
              </Tag>
            );
          }
          case 'ul':
          case 'ol': {
            const Tag = block.type;
            return (
              <Tag key={key}>
                {block.items.map((item, i) => (
                  <li key={`${i}-${item}`}>
                    <InlineText text={item} />
                  </li>
                ))}
              </Tag>
            );
          }
          case 'table':
            return (
              <div key={key} className={styles.tableWrap} role="region" aria-label="Table" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      {block.head.map((cell, i) => (
                        <th key={`${i}-${cell}`} scope="col">
                          <InlineText text={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={`${r}-${row.join('|')}`}>
                        {row.map((cell, i) => (
                          <td key={`${i}-${cell}`}>
                            <InlineText text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'callout':
            return (
              <aside key={key} className={styles.callout} data-kind={block.kind}>
                <p>
                  <strong className={styles.calloutLabel}>{CALLOUT_LABEL[block.kind]}</strong>{' '}
                  <InlineText text={block.text} />
                </p>
              </aside>
            );
          case 'code':
            return (
              <pre key={key} className={styles.code} tabIndex={0}>
                <code>{block.code}</code>
              </pre>
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
