interface LinkSuggestionsProps {
  titles: { id: string; title: string }[];
  query: string;
  /**
   * Whether the typed title already leads to a note that is not among
   * `titles`, such as a template. Then no new note is offered for it.
   */
  taken: boolean;
  activeIndex: number;
  onPick(title: string): void;
}

/** There is one editor on screen at a time, so the list can have a fixed id for the text field to point at. */
export const SUGGESTIONS_ID = 'link-suggestions';
export const suggestionId = (index: number) => `${SUGGESTIONS_ID}-${index}`;

/** The typed title, when the list ends with an offer to make a new note of that name. */
function newTitle(titles: { title: string }[], query: string, taken: boolean): string | null {
  const typed = query.trim();
  if (!typed || taken) return null;
  const exact = titles.some((item) => item.title.toLowerCase() === typed.toLowerCase());
  return exact ? null : typed;
}

/** The list shown under the editor while typing a [[link. */
export function LinkSuggestions({ titles, query, taken, activeIndex, onPick }: LinkSuggestionsProps) {
  const fresh = newTitle(titles, query, taken);
  const options = [...titles.map((item) => item.title), ...(fresh ? [fresh] : [])];
  if (options.length === 0) return null;

  return (
    <ul id={SUGGESTIONS_ID} className="link-suggestions" role="listbox" aria-label="Link to note">
      {options.map((title, index) => (
        <li
          key={`${title}-${index}`}
          id={suggestionId(index)}
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

export function suggestionCount(titles: { title: string }[], query: string, taken: boolean): number {
  return titles.length + (newTitle(titles, query, taken) ? 1 : 0);
}

export function suggestionAt(titles: { title: string }[], query: string, index: number, taken: boolean): string | null {
  if (index < titles.length) return titles[index]?.title ?? null;
  return newTitle(titles, query, taken);
}

/** A heading on offer after `[[Note#`: what the list shows, and what goes between the brackets. */
export interface HeadingOption {
  label: string;
  depth: number;
  insert: string;
}

/** The list shown under the editor while typing the #heading part of a link. */
export function HeadingSuggestions({
  options,
  activeIndex,
  onPick,
}: {
  options: HeadingOption[];
  activeIndex: number;
  onPick(insert: string): void;
}) {
  if (options.length === 0) return null;
  return (
    <ul id={SUGGESTIONS_ID} className="link-suggestions" role="listbox" aria-label="Link to heading">
      {options.map((option, index) => (
        <li
          key={`${option.insert}-${index}`}
          id={suggestionId(index)}
          role="option"
          aria-selected={index === activeIndex}
          className={`heading-depth-${option.depth}${index === activeIndex ? ' active' : ''}`}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(option.insert);
          }}
        >
          {option.label}
        </li>
      ))}
    </ul>
  );
}
