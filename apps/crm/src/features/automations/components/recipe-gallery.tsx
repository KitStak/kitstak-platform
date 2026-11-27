'use client';
/** Recipe gallery: search + category chips + sentence cards ("When status changes to …"). */
import { useMemo, useState } from 'react';
import { ArrowRight, Sparkles, Wand2 } from 'lucide-react';
import { Badge, Button, EmptyState, SearchInput, cn } from '@/components/ui';
import type { ColumnDto } from '@/server/services/contracts/dto';
import {
  genericResolver,
  missingColumnTypes,
  recipeHintsResolve,
  RECIPE_CATEGORIES,
  RECIPES,
  recipeDraft,
  type Recipe,
  type RecipeCategory,
} from '../model/catalog';
import { draftParts, partsToText } from '../model/draft';
import { SentenceText } from './sentence';

export interface RecipeGalleryProps {
  readonly term: string;
  readonly columns: readonly ColumnDto[];
  readonly canEdit: boolean;
  readonly onUse: (recipe: Recipe) => void;
  readonly onCustom: () => void;
}

type Filter = RecipeCategory | 'popular' | 'all';

const TYPE_NAMES: Readonly<Record<string, string>> = {
  status: 'status',
  date: 'date',
  people: 'people',
  number: 'number',
};

export function RecipeGallery({ term, columns, canEdit, onUse, onCustom }: RecipeGalleryProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('popular');
  const resolver = useMemo(() => genericResolver(term, columns), [term, columns]);
  const recipes = useMemo(() => RECIPES.filter((recipe) => recipeHintsResolve(recipe, columns)), [columns]);
  const cards = useMemo(
    () =>
      recipes.map((recipe) => {
        const parts = draftParts(recipeDraft(recipe), resolver);
        return { recipe, parts, text: partsToText(parts, term), missing: missingColumnTypes(recipe, columns) };
      }),
    [recipes, resolver, columns, term],
  );
  const q = query.trim().toLowerCase();
  const visible = cards.filter(({ recipe, text }) => {
    if (q) return `${text} ${recipe.blurb}`.toLowerCase().includes(q);
    if (filter === 'all') return true;
    if (filter === 'popular') return recipe.popular === true;
    return recipe.category === filter;
  });
  const singleCategory = !q && filter !== 'all' && filter !== 'popular';
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const recipe of recipes) map.set(recipe.category, (map.get(recipe.category) ?? 0) + 1);
    return map;
  }, [recipes]);
  const chips: { id: Filter; label: string; count?: number }[] = [
    { id: 'popular', label: 'Popular' },
    ...RECIPE_CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label,
      count: counts.get(category.id),
    })),
    { id: 'all', label: 'All', count: recipes.length },
  ];

  return (
    <div className="flex flex-col gap-5" data-testid="recipe-gallery">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search recipes, e.g. “notify” or “due date”"
          aria-label="Search recipes"
          containerClassName="w-full sm:w-80"
        />
        <Button
          variant="secondary"
          leadingIcon={<Wand2 aria-hidden />}
          onClick={onCustom}
          disabled={!canEdit}
          className="sm:ml-auto"
        >
          Build from scratch
        </Button>
      </div>
      <div
        role="group"
        aria-label="Filter recipes by category"
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)] [scrollbar-width:none] lg:flex-wrap lg:overflow-visible lg:[mask-image:none]"
      >
        {chips.map((chip) => {
          const selected = !q && filter === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setFilter(chip.id);
                setQuery('');
              }}
              className={cn(
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                selected
                  ? 'border-primary bg-primary-selected text-primary-text hover:bg-primary-selected-hover'
                  : 'border-border-subtle bg-panel text-fg-secondary hover:border-border-strong hover:bg-hover hover:text-fg active:bg-pressed',
              )}
            >
              {chip.id === 'popular' ? <Sparkles aria-hidden className="size-3.5" /> : null}
              {chip.label}
              {chip.count !== undefined ? (
                <span className="text-xs text-fg-muted tabular-nums">{chip.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          illustration="search"
          size="sm"
          title="No recipes match"
          description="Try another word, or build your own automation from scratch."
          actions={
            <>
              <Button variant="secondary" onClick={() => setQuery('')}>
                Clear search
              </Button>
              <Button onClick={onCustom} disabled={!canEdit}>
                Build from scratch
              </Button>
            </>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Recipes">
          {visible.map(({ recipe, parts, text, missing }) => {
            const category = RECIPE_CATEGORIES.find((entry) => entry.id === recipe.category);
            const needs = missing.map((type) => TYPE_NAMES[type] ?? type);
            return (
              <li key={recipe.id}>
                <button
                  type="button"
                  onClick={() => onUse(recipe)}
                  disabled={!canEdit}
                  aria-label={`Use recipe: ${text}`}
                  data-testid="recipe-card"
                  data-recipe-id={recipe.id}
                  className={cn(
                    'group flex h-full min-h-[152px] w-full flex-col gap-3 rounded-lg border border-border-subtle bg-panel p-5 text-left shadow-xs',
                    'transition-[border-color,box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                    'hover:-translate-y-0.5 hover:border-primary hover:shadow-md focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:translate-y-0 active:shadow-xs',
                    'disabled:cursor-not-allowed disabled:opacity-[0.38] disabled:hover:translate-y-0 disabled:hover:border-border-subtle disabled:hover:shadow-xs',
                  )}
                >
                  <span className="flex min-h-5 items-center gap-2">
                    {/* Redundant when the gallery is already filtered to this one category. */}
                    {singleCategory ? null : (
                      <Badge tone="neutral">
                        {category?.label}
                      </Badge>
                    )}
                    {needs.length > 0 ? (
                      <Badge tone="warning">
                        Needs a {needs.join(' and ')} column
                      </Badge>
                    ) : null}
                    <span className="ml-auto flex shrink-0 translate-x-1 items-center gap-1 text-sm font-semibold text-primary-text opacity-0 transition-[opacity,transform] duration-[var(--duration-fast)] group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 max-md:translate-x-0 max-md:opacity-100">
                      Add to board
                      <ArrowRight aria-hidden className="size-4" />
                    </span>
                  </span>
                  <span className="text-md leading-[22px] text-fg">
                    <SentenceText parts={parts} term={term} />
                  </span>
                  <span className="mt-auto text-sm text-fg-secondary">{recipe.blurb}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
