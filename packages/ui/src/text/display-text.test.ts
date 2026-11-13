import { describe, expect, it } from 'vitest';
import { displayText, EMPTY_VALUE } from './display-text';

describe('displayText', () => {
  it('turns separator dashes into middle dots', () => {
    expect(displayText('Pinnacle Aerospace — Robot-as-a-Service plan')).toBe('Pinnacle Aerospace · Robot-as-a-Service plan');
    expect(displayText('Apex Classic Tee — Navy / L')).toBe('Apex Classic Tee · Navy / L');
    expect(displayText('Sent proposal – Zenith Electronics')).toBe('Sent proposal · Zenith Electronics');
    expect(displayText('Ring -- 7')).toBe('Ring · 7');
    expect(displayText('changing roles next month—we need help')).toBe('changing roles next month · we need help');
  });
  it('keeps hyphens and range dashes', () => {
    expect(displayText('Robot-as-a-Service')).toBe('Robot-as-a-Service');
    expect(displayText('Bins 1–10')).toBe('Bins 1–10');
  });
  it('renders empty values and lone dashes as the empty marker', () => {
    expect(displayText(null)).toBe(EMPTY_VALUE);
    expect(displayText('  ')).toBe(EMPTY_VALUE);
    expect(displayText('—')).toBe(EMPTY_VALUE);
    expect(displayText(undefined, '')).toBe('');
  });
});
