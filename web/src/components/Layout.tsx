import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router';
import { QuickSwitcher } from './QuickSwitcher';
import { Sidebar } from './Sidebar';

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName));
}

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const closeSwitcher = useCallback(() => setSwitcherOpen(false), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (event.key === '/' && !isTyping(event.target) && !mod) {
        event.preventDefault();
        setMenuOpen(true);
        document.getElementById('global-search')?.focus();
      } else if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        // Unlike "/", this one has to work while typing: the editor is where it is used most.
        event.preventDefault();
        // The same key closes the switcher again, and it stays shut while another dialog is open.
        const dialogOpen = document.querySelector('[aria-modal="true"]') !== null;
        setSwitcherOpen(!dialogOpen);
        if (!dialogOpen) setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={menuOpen ? 'app menu-open' : 'app'}>
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
      <main className="main">
        <Outlet />
      </main>
      {switcherOpen && <QuickSwitcher onClose={closeSwitcher} />}
    </div>
  );
}
