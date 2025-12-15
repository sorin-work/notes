import { KeyboardEvent, useId, useState } from 'react';

interface TagInputProps {
  tags: string[];
  suggestions?: string[];
  onChange(tags: string[]): void;
  disabled?: boolean;
}

export function normalizeTag(name: string): string {
  return name
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[\s,]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function TagInput({ tags, suggestions = [], onChange, disabled }: TagInputProps) {
  const [draft, setDraft] = useState('');
  const listId = useId();

  const add = (raw: string) => {
    const tag = normalizeTag(raw);
    setDraft('');
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(draft);
    } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="tag-input">
      {tags.map((tag) => (
        <span className="tag-chip" key={tag}>
          #{tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            onClick={() => onChange(tags.filter((t) => t !== tag))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        aria-label="Add a tag"
        placeholder={tags.length ? '' : 'Add tags…'}
        value={draft}
        list={listId}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && add(draft)}
      />
      <datalist id={listId}>
        {suggestions
          .filter((name) => !tags.includes(name))
          .map((name) => (
            <option key={name} value={name} />
          ))}
      </datalist>
    </div>
  );
}
