import { describe, expect, it } from 'vitest';
import { daysUntil, formatRelative } from './dates';

const now = new Date(2026, 5, 15, 14, 0, 0);

describe('formatRelative', () => {
  it('describes recent times', () => {
    expect(formatRelative(new Date(2026, 5, 15, 13, 59, 30), now)).toBe('just now');
    expect(formatRelative(new Date(2026, 5, 15, 13, 35), now)).toBe('25 min ago');
    expect(formatRelative(new Date(2026, 5, 15, 9, 0), now)).toBe('5 h ago');
  });

  it('says yesterday for the previous calendar day', () => {
    expect(formatRelative(new Date(2026, 5, 14, 23, 0), now)).toBe('yesterday');
  });

  it('shows the date for older times, with the year when it differs', () => {
    expect(formatRelative(new Date(2026, 2, 3), now)).toBe('Mar 3');
    expect(formatRelative(new Date(2025, 11, 24), now)).toBe('Dec 24, 2025');
  });

  it('accepts ISO strings', () => {
    expect(formatRelative(new Date(2026, 5, 15, 13, 50).toISOString(), now)).toBe('10 min ago');
  });
});

describe('daysUntil', () => {
  it('rounds up and never goes below zero', () => {
    expect(daysUntil(new Date(2026, 5, 16, 15, 0), now)).toBe(2);
    expect(daysUntil(new Date(2026, 5, 1), now)).toBe(0);
  });
});
