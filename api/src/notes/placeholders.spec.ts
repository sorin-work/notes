import { fillPlaceholders } from './placeholders';

describe('fillPlaceholders', () => {
  const values = { date: '2026-11-20', time: '19:30', title: 'Weekly review' };

  it('fills in date, time and title, every time they appear', () => {
    expect(fillPlaceholders('# {{title}}, {{date}}\n\nStarted at {{time}} on {{date}}.', values)).toBe(
      '# Weekly review, 2026-11-20\n\nStarted at 19:30 on 2026-11-20.',
    );
    expect(fillPlaceholders('{{ date }} and {{  time}}', values)).toBe('2026-11-20 and 19:30');
  });

  it('leaves everything else in double braces as it was written', () => {
    const text = '{{author}} {{Date}} {{date|long}} {date} {{}} {{ }} {{dates}}';
    expect(fillPlaceholders(text, values)).toBe(text);
  });

  it('leaves a placeholder alone when there is no value for it', () => {
    expect(fillPlaceholders('{{date}} {{time}} {{title}}', { title: 'Plan' })).toBe('{{date}} {{time}} Plan');
    expect(fillPlaceholders('{{date}}', {})).toBe('{{date}}');
  });

  it('puts a value in as it is, also when it looks like a placeholder or a pattern', () => {
    expect(fillPlaceholders('{{title}}', { title: '$& {{date}} $1' })).toBe('$& {{date}} $1');
  });
});
