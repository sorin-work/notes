import { useEffect, useState } from 'react';
import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar';

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName));
}

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '/' && !isTyping(event.target) && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setMenuOpen(true);
        document.getElementById('global-search')?.focus();
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
    </div>
  );
}
