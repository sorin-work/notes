interface Props {
  /** What is folded, for the label: "Fold Work". */
  name: string;
  open: boolean;
  /** The id of the list that is shown or hidden. */
  controls: string;
  onToggle(): void;
}

/** The small button in front of a notebook that shows or hides the notebooks inside it. */
export function TreeToggle({ name, open, controls, onToggle }: Props) {
  return (
    <button
      type="button"
      className="icon-button small tree-toggle"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      aria-label={open ? `Fold ${name}` : `Unfold ${name}`}
      onClick={onToggle}
    >
      {open ? '▾' : '▸'}
    </button>
  );
}
