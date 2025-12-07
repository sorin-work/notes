import { api } from './client';
import type { Notebook } from './types';

export const listNotebooks = () => api<Notebook[]>('/notebooks');
