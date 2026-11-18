import { describe, expect, it } from 'vitest';
import { goalToNatural, readGoal, typedGoalToStored } from './goal-math';

describe('goal math', () => {
  it('reads stored goals into whole units', () => {
    expect(goalToNatural('margin_pct', '28.0000')).toBe(2800);
    expect(goalToNatural('profit', '95000.0000')).toBe(9500000);
    expect(goalToNatural('units_per_labor_hour', '44.5000')).toBe(44500);
    expect(goalToNatural('cost_per_unit', '1.2500')).toBe(125);
    expect(goalToNatural('revenue', null)).toBeNull();
  });

  it('checks what a person typed', () => {
    expect(typedGoalToStored('profit', '$95,000')).toBe('95000');
    expect(typedGoalToStored('margin_pct', '28%')).toBe('28');
    expect(typedGoalToStored('margin_pct', '140')).toBeNull();
    expect(typedGoalToStored('revenue', 'lots')).toBeNull();
    expect(typedGoalToStored('revenue', '0')).toBeNull();
  });

  it('judges a money goal by pace, not by the month total', () => {
    // $100,000 goal, 10 of 20 work days gone: $50,000 is exactly on pace.
    const onPace = readGoal({ metric: 'revenue', goal: 10_000_000, actual: 5_000_000, elapsedWorkDays: 10, totalWorkDays: 20 });
    expect(onPace.status).toBe('ahead');
    expect(onPace.expected).toBe(5_000_000);
    expect(onPace.projected).toBe(10_000_000);
    expect(onPace.progressBp).toBe(5000);
    const close = readGoal({ metric: 'revenue', goal: 10_000_000, actual: 4_600_000, elapsedWorkDays: 10, totalWorkDays: 20 });
    expect(close.status).toBe('close');
    expect(close.gap).toBe(-400_000);
    const behind = readGoal({ metric: 'profit', goal: 10_000_000, actual: 2_000_000, elapsedWorkDays: 10, totalWorkDays: 20 });
    expect(behind.status).toBe('behind');
    expect(behind.projected).toBe(4_000_000);
    expect(readGoal({ metric: 'profit', goal: 10_000_000, actual: -50_000, elapsedWorkDays: 10, totalWorkDays: 20 }).status).toBe('behind');
  });

  it('judges a rate goal against the goal itself', () => {
    expect(readGoal({ metric: 'margin_pct', goal: 2800, actual: 3000, elapsedWorkDays: 3, totalWorkDays: 20 }).status).toBe('ahead');
    expect(readGoal({ metric: 'margin_pct', goal: 2800, actual: 2600, elapsedWorkDays: 3, totalWorkDays: 20 }).status).toBe('close');
    expect(readGoal({ metric: 'margin_pct', goal: 2800, actual: 1200, elapsedWorkDays: 3, totalWorkDays: 20 }).status).toBe('behind');
    expect(readGoal({ metric: 'margin_pct', goal: 2800, actual: null, elapsedWorkDays: 3, totalWorkDays: 20 }).status).toBe('no_data');
  });

  it('flips the test when less is better', () => {
    expect(readGoal({ metric: 'labor_pct_of_revenue', goal: 5500, actual: 5000, elapsedWorkDays: 3, totalWorkDays: 20 }).status).toBe('ahead');
    expect(readGoal({ metric: 'labor_pct_of_revenue', goal: 5500, actual: 5900, elapsedWorkDays: 3, totalWorkDays: 20 }).status).toBe('close');
    expect(readGoal({ metric: 'cost_per_unit', goal: 100, actual: 150, elapsedWorkDays: 3, totalWorkDays: 20 }).status).toBe('behind');
  });
});
