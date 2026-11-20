import { MouseEvent, useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Outlet, useMatch } from 'react-router';
import { useOnline } from '../hooks/useOnline';
import { Notices } from './Notices';
import { QuickSwitcher } from './QuickSwitcher';
import { Sidebar } from './Sidebar';
import { OfflineBanner } from './States';

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName));
}

/** Cmd+K on Apple devices, where Ctrl+K deletes to the end of the line in a text field. Ctrl+K everywhere else. */
function isSwitcherKey(event: KeyboardEvent): boolean {
  const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const modifier = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k';
}

/** The width below which styles.css turns the sidebar into a menu. */
const NARROW_SCREEN = '(max-width: 820px)';

/** The skip links move the focus without putting their "#id" in the address. */
function skipTo(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  document.getElementById(event.currentTarget.hash.slice(1))?.focus();
}

export function Layout() {
  const online = useOnline();
  const noteOpen = useMatch('/notes/:noteId') !== null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const closeSwitcher = useCallback(() => setSwitcherOpen(false), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '/' && !isTyping(event.target) && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        // On a narrow screen the sidebar is a menu that is hidden until it is open, and a hidden box cannot
        // take the focus. A wide screen has no menu to open.
        if (window.matchMedia?.(NARROW_SCREEN).matches) flushSync(() => setMenuOpen(true));
        document.getElementById('global-search')?.focus();
      } else if (isSwitcherKey(event)) {
        // Unlike "/", this one has to work while typing: the editor is where it is used most.
        // While another dialog is open it does nothing, and the key is left to the browser.
        if (!switcherOpen && document.querySelector('[aria-modal="true"]')) return;
        event.preventDefault();
        // Holding the key down must not open and close the dialog over and over.
        if (event.repeat) return;
        setSwitcherOpen(!switcherOpen);
        if (!switcherOpen) setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [switcherOpen]);

  return (
    <div className={menuOpen ? 'app menu-open' : 'app'}>
      <a href="#main" className="skip-link" onClick={skipTo}>
        Skip to content
      </a>
      {noteOpen && (
        <a href="#note" className="skip-link" onClick={skipTo}>
          Skip to the note
        </a>
      )}
      <header className="mobile-bar">
        <button
          type="button"
          className="icon-button"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          ☰
        </button>
        <span className="brand">Notes</span>
      </header>
      <Sidebar onNavigate={() => setMenuOpen(false)} />
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
      <main className="main" id="main" tabIndex={-1}>
        {!online && <OfflineBanner />}
        <Outlet />
      </main>
      {switcherOpen && <QuickSwitcher onClose={closeSwitcher} />}
      <Notices />
    </div>
  );
}
