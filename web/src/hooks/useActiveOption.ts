import { useState } from 'react';

/**
 * The highlighted row of a list of options that is driven from a text field,
 * as under a [[link being typed or in the quick switcher. The arrow keys move
 * through the options and wrap around at both ends.
 */
export function useActiveOption(count: number) {
  const [index, setIndex] = useState(0);
  // New results can make the list shorter than the row that was highlighted.
  const activeIndex = Math.max(0, Math.min(index, count - 1));

  /** Moves the highlight on ArrowDown and ArrowUp. Returns whether the key was used. */
  const onArrowKey = (event: { key: string; preventDefault(): void }): boolean => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 || count === 0) return false;
    event.preventDefault();
    setIndex((current) => (Math.min(current, count - 1) + step + count) % count);
    return true;
  };

  return { activeIndex, setActiveIndex: setIndex, onArrowKey };
}
