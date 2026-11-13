'use client';
/** Renders comment markdown (see markdown.ts) as React elements. Mentions of the viewer stand out. */
import { Fragment, useMemo, type ReactNode } from 'react';
import { cn } from '@/components/ui';
import { parseBlocks, parseInline, type Inline } from './markdown';

function renderInline(nodes: readonly Inline[], meId: string | undefined, keyPrefix = ''): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}${index}`;
    switch (node.type) {
      case 'text':
        return <Fragment key={key}>{node.text}</Fragment>;
      case 'code':
        return <code key={key}>{node.text}</code>;
      case 'mention':
        return (
          <span
            key={key}
            data-type="mention"
            data-me={node.id === meId ? 'true' : undefined}
            className="ks-mention"
          >
            @{node.name}
          </span>
        );
      case 'link':
        return (
          <a key={key} href={node.href} target="_blank" rel="noopener noreferrer nofollow">
            {renderInline(node.children, meId, `${key}-`)}
          </a>
        );
      case 'strong':
        return <strong key={key}>{renderInline(node.children, meId, `${key}-`)}</strong>;
      case 'em':
        return <em key={key}>{renderInline(node.children, meId, `${key}-`)}</em>;
      case 'del':
        return <s key={key}>{renderInline(node.children, meId, `${key}-`)}</s>;
      default:
        return null;
    }
  });
}

/** Inline text with soft line breaks kept. */
function Lines({ text, meId }: { readonly text: string; readonly meId?: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 ? <br /> : null}
          {renderInline(parseInline(line), meId, `${index}-`)}
        </Fragment>
      ))}
    </>
  );
}

export function MarkdownView({
  source,
  meId,
  className,
}: {
  readonly source: string;
  readonly meId?: string;
  readonly className?: string;
}) {
  const blocks = useMemo(() => parseBlocks(source), [source]);
  return (
    <div className={cn('ks-rich', className)}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'p':
            return (
              <p key={index}>
                <Lines text={block.text} meId={meId} />
              </p>
            );
          case 'h': {
            const Tag = block.level === 1 ? 'h2' : 'h3';
            return (
              <Tag key={index}>
                <Lines text={block.text} meId={meId} />
              </Tag>
            );
          }
          case 'quote':
            return (
              <blockquote key={index}>
                <Lines text={block.text} meId={meId} />
              </blockquote>
            );
          case 'code':
            return (
              <pre key={index}>
                <code>{block.text}</code>
              </pre>
            );
          case 'ul': {
            const checklist = block.items.every((item) => item.checked !== null);
            return (
              <ul key={index} data-type={checklist ? 'taskList' : undefined}>
                {block.items.map((item, itemIndex) =>
                  checklist ? (
                    <li key={itemIndex} data-checked={item.checked ? 'true' : 'false'}>
                      <label>
                        <input
                          type="checkbox"
                          checked={Boolean(item.checked)}
                          readOnly
                          tabIndex={-1}
                          aria-label={item.checked ? 'Done' : 'Not done'}
                        />
                      </label>
                      <div>
                        <Lines text={item.text} meId={meId} />
                      </div>
                    </li>
                  ) : (
                    <li key={itemIndex}>
                      <Lines text={item.text} meId={meId} />
                    </li>
                  ),
                )}
              </ul>
            );
          }
          case 'ol':
            return (
              <ol key={index} start={block.start}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Lines text={item.text} meId={meId} />
                  </li>
                ))}
              </ol>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
