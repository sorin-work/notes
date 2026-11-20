import { api, withQuery } from './client';
import type { Graph } from './types';

/** The notes as nodes and the links between them as edges, narrowed to a notebook or a tag when given. */
export const linkGraph = (filters: { notebookId?: string | null; tag?: string | null } = {}) =>
  api<Graph>(withQuery('/links/graph', { ...filters }));
