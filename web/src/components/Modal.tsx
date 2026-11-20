import { ReactNode, useEffect, useId, useRef } from 'react';

interface ModalProps {
  title: string;
  onClose(): void;
  children: ReactNode;
  wide?: boolean;
  /** Sits near the top of the window, so a list that grows and shrinks does not move it. */
  top?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Puts the focus on the main region of the page, so that it does not fall back to the top of the document. */
function focusMain() {
  const main = document.querySelector<HTMLElement>('main');
  if (!main) return;
  if (!main.hasAttribute('tabindex')) main.tabIndex = -1;
  main.focus();
}

/**
 * A dialog that closes on Escape or a click on the backdrop. Focus moves into
 * it when it opens, Tab stays inside it, and closing it puts the focus back
 * where it was, or on the main region when that place is gone.
 */
export function Modal({ title, onClose, children, wide, top }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Most callers pass a new function on every render. The effect below must
  // not run again for that: it would pull the focus out of a dialog that was
  // opened on top of this one and back to this one's first control.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>('input, textarea, select, button:not(.modal-close)');
    (first ?? dialog)?.focus();

    const onKey = (event: KeyboardEvent) => {
      // With one dialog on top of another, the keys belong to the one on top.
      const open = document.querySelectorAll('[aria-modal="true"]');
      if (!dialog || open[open.length - 1] !== dialog) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === 'Tab') {
        // Tab goes round inside the dialog instead of on to the page behind it.
        const controls = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const from = event.shiftKey ? controls[0] : controls[controls.length - 1];
        const to = event.shiftKey ? controls[controls.length - 1] : controls[0];
        const active = document.activeElement;
        if (active === from || active === dialog || !dialog.contains(active)) {
          event.preventDefault();
          (to ?? dialog).focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // What opened the dialog can be gone by now: a note was trashed, a tag deleted.
      if (previous?.isConnected) previous.focus();
      else focusMain();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className={['modal', wide && 'modal-wide', top && 'modal-top'].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-button modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

interface ConfirmProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({ title, message, confirmLabel, danger, busy, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="confirm-message">{message}</div>
      <div className="form-actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={danger ? 'button button-danger' : 'button button-primary'}
          onClick={onConfirm}
          disabled={busy}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
