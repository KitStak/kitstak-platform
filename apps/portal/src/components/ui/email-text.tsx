import { Fragment } from 'react';
import { cn } from './cn';

/**
 * An email address inside a sentence. It never breaks in the middle of a word ("carter-su" /
 * "pply.example"). The whole address moves to the next line when it does not fit on this one. An
 * address longer than one whole line breaks after the "@" or before a dot, and only then anywhere.
 * `white-space: nowrap` on each part stops the browser from breaking after a hyphen.
 */
export function EmailText({ email, className }: { readonly email: string; readonly className?: string }) {
  const at = email.lastIndexOf('@');
  const local = at === -1 ? email : email.slice(0, at);
  const domain = at === -1 ? '' : email.slice(at + 1);
  const labels = domain === '' ? [] : domain.split('.');
  return (
    <span className={cn('inline-block max-w-full align-bottom [overflow-wrap:anywhere]', className)}>
      <span className="whitespace-nowrap">{local}</span>
      {at === -1 ? null : (
        <>
          <wbr />
          <span className="whitespace-nowrap">@{labels[0]}</span>
          {labels.slice(1).map((label, index) => (
            <Fragment key={`${label}-${index}`}>
              <wbr />
              <span className="whitespace-nowrap">.{label}</span>
            </Fragment>
          ))}
        </>
      )}
    </span>
  );
}
