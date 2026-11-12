import { describe, expect, it } from 'vitest';
import type { ColumnDto } from '@/server/services/contracts/dto';
import { hintLabelName, RECIPES, recipeHintsResolve } from './catalog';
import { humanizeTemplate, templateSegments, templateVarLabel } from './template';
import { formatPercent } from './usage';

describe('message templates', () => {
  it('splits {name} / {board} into chip segments', () => {
    expect(templateSegments('{name} changed on {board}!')).toEqual([
      { kind: 'var', name: 'name' },
      { kind: 'text', text: ' changed on ' },
      { kind: 'var', name: 'board' },
      { kind: 'text', text: '!' },
    ]);
    expect(templateSegments('plain')).toEqual([{ kind: 'text', text: 'plain' }]);
  });

  it('humanizes with the board term', () => {
    expect(templateVarLabel('name', 'deal')).toBe('Deal name');
    expect(humanizeTemplate('🎉 {name} was won on {board}', 'Deal')).toBe('🎉 Deal name was won on Board name');
  });
});

describe('recipe label hints', () => {
  const stage = {
    key: 'stage',
    type: 'status',
    title: 'Stage',
    hidden: false,
    settings: { labels: [{ id: 'won', name: 'Won', color: 'green' }, { id: 'lost', name: 'Lost', color: 'red' }] },
  } as unknown as ColumnDto;

  it('resolves Done to a Won label on a deals board and hides unresolvable hints', () => {
    expect(hintLabelName('done', [stage])).toBe('Won');
    expect(hintLabelName('stuck', [stage])).toBeNull();
    const stuck = RECIPES.filter((recipe) => JSON.stringify(recipe).includes('@stuck'));
    for (const recipe of stuck) expect(recipeHintsResolve(recipe, [stage])).toBe(false);
    expect(RECIPES.filter((recipe) => recipeHintsResolve(recipe, [])).length).toBe(RECIPES.length);
  });
});

describe('usage percent', () => {
  it('never shows 0% for a visible sliver', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.44)).toBe('<1%');
    expect(formatPercent(42.4)).toBe('42%');
  });
});
