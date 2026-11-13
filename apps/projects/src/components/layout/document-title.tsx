'use client';
/**
 * Sets the tab title from the client. Needed where Next renders an error shell on the client (a
 * 404 thrown by a layout), so metadata exports never reach `<title>`.
 */
import { useEffect } from 'react';

export function DocumentTitle({ title }: { readonly title: string }) {
  useEffect(() => {
    document.title = title;
  }, [title]);
  return null;
}
