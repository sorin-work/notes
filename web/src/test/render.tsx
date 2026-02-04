import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

export function renderWithProviders(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

type Reply = { status?: number; body?: unknown };
type Route = Reply | ((request: { url: string; body: unknown }) => Reply);

export interface RecordedCall {
  method: string;
  url: string;
  body: unknown;
}

/**
 * Replaces fetch with one that answers "METHOD /api/path" from `routes`.
 * Query strings are ignored when matching but kept in the recorded URL.
 */
export function mockFetch(routes: Record<string, Route>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      calls.push({ method, url, body });
      const route = routes[`${method} ${url.split('?')[0]}`];
      if (!route) {
        return new Response(JSON.stringify({ message: `No mock for ${method} ${url}`, statusCode: 404 }), {
          status: 404,
        });
      }
      const reply = typeof route === 'function' ? route({ url, body }) : route;
      const status = reply.status ?? 200;
      return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}
