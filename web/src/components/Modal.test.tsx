import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

/** A page with something focusable before and after the dialog, as the app has. */
function Page() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Rename
      </button>
      {open && (
        <Modal title="Rename notebook" onClose={close}>
          <input aria-label="Name" />
          <button type="button">Save</button>
        </Modal>
      )}
      <a href="/behind">Behind the dialog</a>
    </>
  );
}

describe('Modal', () => {
  it('keeps Tab inside the dialog and puts the focus back when it closes', async () => {
    render(<Page />);
    const opener = screen.getByRole('button', { name: 'Rename' });
    await userEvent.click(opener);
    expect(screen.getByLabelText('Name')).toHaveFocus();

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    // From the last control Tab goes round to the first, not on to the link behind.
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('brings the focus back into the dialog when it has got out', async () => {
    render(<Page />);
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    screen.getByRole('link', { name: 'Behind the dialog' }).focus();

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('leaves the focus in a dialog that is opened from another one', async () => {
    // The outer dialog gets a new onClose on every render, as most callers pass one.
    function Nested() {
      const [confirming, setConfirming] = useState(false);
      return (
        <Modal title="Version history" onClose={() => undefined}>
          <button type="button">First version</button>
          <button type="button" onClick={() => setConfirming(true)}>
            Restore
          </button>
          {confirming && (
            <Modal title="Restore this version?" onClose={() => setConfirming(false)}>
              <button type="button">Yes, restore</button>
            </Modal>
          )}
        </Modal>
      );
    }
    render(<Nested />);
    expect(screen.getByRole('button', { name: 'First version' })).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(screen.getByRole('button', { name: 'Yes, restore' })).toHaveFocus();
    await userEvent.tab();
    expect(
      within(screen.getByRole('dialog', { name: 'Restore this version?' })).getByRole('button', { name: 'Close' }),
    ).toHaveFocus();

    // Closing the inner one goes back to the button that opened it, not to the first one.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Restore this version?' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toHaveFocus();
  });

  it('puts the focus on the main region when what opened the dialog is gone', async () => {
    function Trashable() {
      const [open, setOpen] = useState(false);
      const [trashed, setTrashed] = useState(false);
      return (
        <main>
          <h1>Notes</h1>
          {!trashed && (
            <button type="button" onClick={() => setOpen(true)}>
              Delete
            </button>
          )}
          {open && (
            <Modal title="Move to trash?" onClose={() => setOpen(false)}>
              <button
                type="button"
                onClick={() => {
                  setTrashed(true);
                  setOpen(false);
                }}
              >
                Move to trash
              </button>
            </Modal>
          )}
        </main>
      );
    }
    render(<Trashable />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move to trash' }));

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('gives Escape to the dialog on top only', async () => {
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    render(
      <Modal title="Version history" onClose={closeOuter}>
        <Modal title="Restore this version?" onClose={closeInner}>
          <button type="button">Restore</button>
        </Modal>
      </Modal>,
    );

    await userEvent.keyboard('{Escape}');
    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();
  });
});
