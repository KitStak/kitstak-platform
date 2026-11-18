'use client';

import { useState } from 'react';
import { PROJECTS_CATALOG } from '@/generated/projects/catalog';
import { AppIcon } from '../app-icon';
import mock from '../mock/mock.module.css';
import styles from './projects-visuals.module.css';

type Recipe = (typeof PROJECTS_CATALOG.automation.recipes)[number];
type Category = Recipe['categories'][number];

const RECIPES: readonly Recipe[] = PROJECTS_CATALOG.automation.recipes;

/** Categories in the order the app's recipe gallery uses, keeping only those with recipes. */
const CATEGORIES: readonly Category[] = Array.from(new Set(RECIPES.flatMap((r) => r.categories as readonly Category[])));

const NEEDS_LABEL = { crm: 'Needs the CRM', wms: 'Needs the WMS' } as const;

/** The automation recipe gallery from KitStak Projects, filterable by the app's own categories. */
export function RecipeBrowser() {
  const [category, setCategory] = useState<Category | 'All'>('All');
  const shown = category === 'All' ? RECIPES : RECIPES.filter((r) => (r.categories as readonly Category[]).includes(category));

  return (
    <div className={`${mock.panel} ${styles.browser}`}>
      <div className={styles.filters} role="group" aria-label="Recipe categories">
        {(['All', ...CATEGORIES] as const).map((c) => (
          <button
            key={c}
            type="button"
            className={styles.filter}
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <ul className={styles.recipeList} tabIndex={0} aria-label="Automation recipes">
        {shown.map((recipe) => (
          <li key={recipe.id} className={`${mock.row} ${styles.recipeItem}`}>
            <span className={styles.recipeTop}>
              <span className={styles.recipeName}>{recipe.name}</span>
              {recipe.needs ? (
                <span className={styles.recipeNeeds}>
                  <AppIcon app={recipe.needs} size={18} /> {NEEDS_LABEL[recipe.needs]}
                </span>
              ) : null}
            </span>
            <span className={styles.recipeSentence}>{recipe.sentence}</span>
          </li>
        ))}
      </ul>
      <p className={styles.browserNote} aria-live="polite">
        {shown.length} of {RECIPES.length} recipes, listed from the Projects app. Start from one and change any part.
      </p>
    </div>
  );
}
