import { searchIndex } from '@/lib/docs/docs';

export const dynamic = 'force-static';

/** Titles, descriptions and headings of every docs page, for the search box. */
export function GET(): Response {
  return Response.json(searchIndex());
}
