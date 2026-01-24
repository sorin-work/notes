interface LinkSuggestionsProps {
  titles: { id: string; title: string }[];
  query: string;
  activeIndex: number;
  onPick(title: string): void;
}

/** The list shown under the editor while typing a [[link. */
export function LinkSuggestions({ titles, query, activeIndex, onPick }: LinkSuggestionsProps) {
  const exact = titles.some((item) => item.title.toLowerCase() === query.trim().toLowerCase());
  const options = [...titles.map((item) => item.title), ...(query.trim() && !exact ? [query.trim()] : [])];
  if (options.length === 0) return null;

  return (
    <ul className="link-suggestions" role="listbox" aria-label="Link to note">
      {options.map((title, index) => (
        <li
          key={`${title}-${index}`}
          role="option"
          aria-selected={index === activeIndex}
          className={index === activeIndex ? 'active' : undefined}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(title);
          }}
        >
          {index >= titles.length ? (
            <>
              New note <strong>{title}</strong>
            </>
          ) : (
            title
          )}
        </li>
      ))}
    </ul>
  );
}

export function suggestionCount(titles: { title: string }[], query: string): number {
  const exact = titles.some((item) => item.title.toLowerCase() === query.trim().toLowerCase());
  return titles.length + (query.trim() && !exact ? 1 : 0);
}

export function suggestionAt(titles: { title: string }[], query: string, index: number): string | null {
  if (index < titles.length) return titles[index]?.title ?? null;
  return query.trim() || null;
}
