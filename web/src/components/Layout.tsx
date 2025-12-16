import { useState } from 'react';
import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar';

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);

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
