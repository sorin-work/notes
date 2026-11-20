import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router';
import { noteTitles } from '../api/notes';
import { useActiveOption } from '../hooks/useActiveOption';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { Modal } from './Modal';
import { ErrorMessage } from './States';

const LIMIT = 10;

/** The Ctrl+K dialog: type part of a title, press Enter, land on the note. */
export function QuickSwitcher({ onClose }: { onClose(): void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const openNoteId = useMatch('/notes/:noteId')?.params.noteId;
  const listId = useId();
  const [query, setQuery] = useState('');
  // Enter was pressed before the list had caught up with the typing.
  const enterPending = useRef(false);

  const term = query.trim();
  const searched = useDebouncedValue(term, 150);
  // Without a term the API answers with the notes edited last. Always asking
  // again keeps a note that was just renamed or deleted from showing up stale.
  const titles = useQuery({
    queryKey: ['titles', searched, LIMIT],
    queryFn: () => noteTitles(searched, LIMIT),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
  const options = (titles.data ?? []).filter((note) => note.id !== openNoteId);
  // True once the list on screen is the answer to what is in the box.
  const settled = searched === term && titles.isSuccess && !titles.isPlaceholderData;
  const { activeIndex, setActiveIndex, onArrowKey } = useActiveOption(options.length);
  const activeId = options[activeIndex]?.id;

  const open = useCallback(
    (id: string) => {
      // Keep the filter of the note list, the way links between notes do.
      const search = location.pathname.startsWith('/notes') ? location.search : '';
      navigate({ pathname: `/notes/${id}`, search }, { state: { focusEditor: true } });
      onClose();
    },
    [location.pathname, location.search, navigate, onClose],
  );

  useEffect(() => {
    if (!settled || !enterPending.current) return;
    enterPending.current = false;
    if (activeId) open(activeId);
  }, [settled, activeId, open]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (onArrowKey(event)) return;
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!settled) enterPending.current = true;
    else if (activeId) open(activeId);
  };

  return (
    <Modal title="Go to note" onClose={onClose} top>
      <input
        type="text"
        className="switcher-input"
        role="combobox"
        aria-label="Note title"
        aria-autocomplete="list"
        aria-expanded={options.length > 0}
        aria-controls={options.length > 0 ? listId : undefined}
        aria-activedescendant={activeId ? `${listId}-${activeIndex}` : undefined}
        placeholder="Type part of a title"
        autoComplete="off"
        spellCheck={false}
        maxLength={200}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          enterPending.current = false;
        }}
        onKeyDown={onKeyDown}
      />
      {titles.error && <ErrorMessage error={titles.error} />}
      {!term && options.length > 0 && <p className="switcher-note muted">Recently edited</p>}
      {options.length > 0 && (
        <ul id={listId} className="switcher-list" role="listbox" aria-label="Notes">
          {options.map((note, index) => (
            <li
              key={note.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'active' : undefined}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => open(note.id)}
            >
              {note.title}
            </li>
          ))}
        </ul>
      )}
      {settled && options.length === 0 && (
        <p className="switcher-note muted">
          {term ? `No note has “${term}” in its title.` : openNoteId ? 'No other notes yet.' : 'No notes yet.'}
        </p>
      )}
    </Modal>
  );
}
