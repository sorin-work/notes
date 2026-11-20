import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { applySavedTheme } from './hooks/useTheme';
import { registerServiceWorker } from './lib/appUpdate';
import { createQueryClient } from './queryClient';
import './styles.css';

applySavedTheme();
const queryClient = createQueryClient();
if (import.meta.env.PROD) void registerServiceWorker().catch(() => undefined);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
