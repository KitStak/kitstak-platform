'use client';

/**
 * Read-only renderer for update bodies. Builds React elements from the (server-sanitized)
 * Tiptap JSON with its own allow-list — no HTML strings, no dangerouslySetInnerHTML.
 */
import { Fragment, type ReactNode } from 'react';
import { cn } from '@/components/ui';
import { isRichNode, safeHref, type RichDoc, type RichNode } from '../lib/rich-text';

interface ViewOptions {
  readonly meId: string | null;
}

function renderMarks(text: string, node: RichNode, key: string): ReactNode {
  let out: ReactNode = text;
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        out = <strong className="font-semibold">{out}</strong>;
        break;
      case 'italic':
        out = <em>{out}</em>;
        break;
      case 'strike':
        out = <s>{out}</s>;
        break;
      case 'underline':
        out = <u>{out}</u>;
        break;
      case 'code':
        out = <code>{out}</code>;
        break;
      case 'highlight':
        out = <mark>{out}</mark>;
        break;
      case 'link': {
        const href = safeHref(mark.attrs?.href);
        if (href) {
          out = (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {out}
            </a>
          );
        }
        break;
      }
      default:
        break;
    }
  }
  return <Fragment key={key}>{out}</Fragment>;
}

function renderChildren(node: RichNode, key: string, options: ViewOptions): ReactNode[] {
  return (node.content ?? []).filter(isRichNode).map((child, index) => renderNode(child, `${key}.${index}`, options));
}

function renderNode(node: RichNode, key: string, options: ViewOptions): ReactNode {
  const children = () => renderChildren(node, key, options);
  switch (node.type) {
    case 'text':
      return typeof node.text === 'string' ? renderMarks(node.text, node, key) : null;
    case 'hardBreak':
      return <br key={key} />;
    case 'mention': {
      const id = typeof node.attrs?.id === 'string' ? node.attrs.id : '';
      const label = typeof node.attrs?.label === 'string' ? node.attrs.label : 'someone';
      return (
        <span key={key} className="ks-mention" data-me={id === options.meId ? 'true' : undefined}>
          @{label}
        </span>
      );
    }
    case 'paragraph':
      return <p key={key}>{children()}</p>;
    case 'heading':
      return node.attrs?.level === 3 ? <h3 key={key}>{children()}</h3> : <h2 key={key}>{children()}</h2>;
    case 'bulletList':
      return <ul key={key}>{children()}</ul>;
    case 'orderedList': {
      const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1;
      return (
        <ol key={key} start={start}>
          {children()}
        </ol>
      );
    }
    case 'listItem':
      return <li key={key}>{children()}</li>;
    case 'taskList':
      return (
        <ul key={key} data-type="taskList">
          {children()}
        </ul>
      );
    case 'taskItem': {
      const checked = node.attrs?.checked === true;
      return (
        <li key={key} data-checked={checked ? 'true' : 'false'}>
          <label>
            <input type="checkbox" checked={checked} readOnly disabled aria-label={checked ? 'Done' : 'Not done'} />
          </label>
          <div>{children()}</div>
        </li>
      );
    }
    case 'blockquote':
      return <blockquote key={key}>{children()}</blockquote>;
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{children()}</code>
        </pre>
      );
    case 'horizontalRule':
      return <hr key={key} />;
    default:
      return null;
  }
}

export function RichTextView({
  doc,
  meId = null,
  className,
}: {
  readonly doc: RichDoc;
  readonly meId?: string | null;
  readonly className?: string;
}) {
  const nodes = (doc.content ?? []).filter(isRichNode);
  return <div className={cn('ks-rich', className)}>{nodes.map((node, index) => renderNode(node, String(index), { meId }))}</div>;
}
