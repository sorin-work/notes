import { render, screen } from '@testing-library/react';
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
