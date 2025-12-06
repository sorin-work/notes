const TOKEN_KEY = 'notes.token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Every validation message when the API returned a list. */
    readonly messages: string[] = [message],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode or storage disabled: the session just won't survive a reload.
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

async function errorFrom(response: Response): Promise<ApiError> {
  let body: { message?: string | string[] } | null = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON, e.g. a proxy error page.
  }
  const messages = Array.isArray(body?.message) ? body.message : body?.message ? [body.message] : [];
  const fallback = response.status >= 500 ? 'Something went wrong on the server' : response.statusText;
  return new ApiError(response.status, messages[0] ?? (fallback || `Request failed (${response.status})`), messages);
}

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && typeof init.body === 'string') headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection.');
  }

  if (!response.ok) {
    const error = await errorFrom(response);
    throw error;
  }
  return response;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await request(path, init);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});
