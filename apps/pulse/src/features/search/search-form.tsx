'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, SearchInput } from '@/components/ui';
import { routes } from '@/lib/routes';

/** The search box on the search page. Submitting puts the words in the URL, so a search can be shared. */
export function SearchForm({ initial }: { readonly initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    router.push(routes.search(value.trim() || undefined));
  };
  return (
    <form role="search" onSubmit={onSubmit} className="flex items-center gap-2" data-testid="search-form">
      <div className="min-w-0 flex-1">
        <SearchInput value={value} onValueChange={setValue} placeholder="Search pages, reports and data files" aria-label="Search" autoFocus />
      </div>
      <Button type="submit">Search</Button>
    </form>
  );
}
