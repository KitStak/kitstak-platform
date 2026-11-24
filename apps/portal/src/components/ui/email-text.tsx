import { Fragment } from 'react';
import { cn } from './cn';

/**
 * An email address inside a sentence. It never breaks in the middle of a word ("carter-su" /
 * "pply.example"). The whole address moves to the next line when it does not fit on this one. An
 * address longer than one whole line breaks after the "@" or before a dot, and only then anywhere.
 * `white-space: nowrap` on each part stops the browser from breaking after a hyphen.
 *
 * `after` is the punctuation that follows the address in the sentence ("." or ","). It must be
 * passed here and not typed after the component: the address is one box, so a full stop typed
 * after it is free to wrap to the next line by itself. Inside the box it is glued to the last part
 * of the address and never starts a line. It keeps the look of the sentence, not of the address.
 */
export function EmailText({ email, className, after }: { readonly email: string; readonly className?: string; readonly after?: string }) {
  const at = email.lastIndexOf('@');
  const local = at === -1 ? email : email.slice(0, at);
  const domain = at === -1 ? '' : email.slice(at + 1);
  const labels = domain === '' ? [] : domain.split('.');
  // The parts of the address. A line may end between two parts and nowhere else.
  const parts = at === -1 ? [local] : [local, `@${labels[0]}`, ...labels.slice(1).map((label) => `.${label}`)];
  const last = parts.length - 1;
  return (
    <span data-email-text className="inline-block max-w-full align-bottom [overflow-wrap:anywhere]">
      {parts.map((part, index) => (
        <Fragment key={`${part}-${index}`}>
          {index === 0 ? null : <wbr />}
          {index === last && after ? (
            <span className="whitespace-nowrap">
              <span className={className}>{part}</span>
              {after}
            </span>
          ) : (
            <span className={cn('whitespace-nowrap', className)}>{part}</span>
          )}
        </Fragment>
      ))}
    </span>
  );
}
