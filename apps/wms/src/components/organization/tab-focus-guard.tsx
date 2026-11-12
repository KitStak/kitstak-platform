'use client';

/**
 * Wraps an UnderlineTabs strip so a mouse / touch click never leaves a focus ring on the
 * active tab (Radix moves focus programmatically, which Chromium reports as :focus-visible),
 * while keyboard users keep the full ring. The strip's ring is also drawn inset so the
 * list's overflow clipping can't cut it into a partial rectangle.
 */
import * as React from 'react';

export function TabFocusGuard({ children }: { readonly children: React.ReactNode }) {
  const [pointer, setPointer] = React.useState(false);
  return (
    <div
      data-pointer={pointer || undefined}
      onPointerDown={() => setPointer(true)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') setPointer(false);
      }}
      className="[&_[role=tab]:focus-visible]:ring-inset [&[data-pointer]_[role=tab]:focus-visible]:[box-shadow:none]"
    >
      {children}
    </div>
  );
}
