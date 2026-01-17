import { extractWikiLinks, normalizeTitle } from './wikilinks';

describe('extractWikiLinks', () => {
  it('finds links and aliases', () => {
    expect(extractWikiLinks('See [[Project Atlas]] and [[Atlas data model|the data model]].')).toEqual([
      { title: 'Project Atlas', alias: null },
      { title: 'Atlas data model', alias: 'the data model' },
    ]);
  });

  it('drops a #heading from the target', () => {
    expect(extractWikiLinks('[[Recipes#Bread]]')).toEqual([{ title: 'Recipes', alias: null }]);
  });

  it('lists each target once, matching case-insensitively', () => {
    expect(extractWikiLinks('[[Ideas]] then [[ideas]] and [[ Ideas ]]')).toEqual([{ title: 'Ideas', alias: null }]);
  });

  it('collapses whitespace in titles', () => {
    expect(extractWikiLinks('[[Weekly   review]]')).toEqual([{ title: 'Weekly review', alias: null }]);
  });

  it('ignores empty and unclosed links', () => {
    expect(extractWikiLinks('[[]] [[   ]] [[open and [[Closed]]')).toEqual([{ title: 'Closed', alias: null }]);
  });

  it('does not span lines', () => {
    expect(extractWikiLinks('[[First\nline]]')).toEqual([]);
  });
});

describe('normalizeTitle', () => {
  it('lower-cases and collapses whitespace', () => {
    expect(normalizeTitle('  Project   Atlas ')).toBe('project atlas');
  });
});
