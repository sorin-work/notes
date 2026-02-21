import { safeFileName, UniquePaths } from './file-names';

describe('safeFileName', () => {
  it('replaces characters that are not allowed in file names', () => {
    expect(safeFileName('Q1/Q2: plans? <draft>')).toBe('Q1 Q2 plans draft');
  });

  it('removes leading dots and trailing dots or spaces', () => {
    expect(safeFileName('..hidden. ')).toBe('hidden');
  });

  it('falls back when nothing is left', () => {
    expect(safeFileName('///')).toBe('Untitled');
    expect(safeFileName('', 'Notebook')).toBe('Notebook');
  });

  it('limits the length', () => {
    expect(safeFileName('a'.repeat(300))).toHaveLength(120);
  });
});

describe('UniquePaths', () => {
  it('numbers clashing names, ignoring case', () => {
    const paths = new UniquePaths();
    expect(paths.claim('Work/', 'Plan', '.md')).toBe('Work/Plan.md');
    expect(paths.claim('Work/', 'plan', '.md')).toBe('Work/plan (2).md');
    expect(paths.claim('Work/', 'Plan', '.md')).toBe('Work/Plan (3).md');
    expect(paths.claim('', 'Plan', '.md')).toBe('Plan.md');
  });
});
