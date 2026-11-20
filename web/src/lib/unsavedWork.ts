/**
 * Something on the page that holds text the server does not have yet, like
 * the editor with its draft. Signing out asks these before it ends the
 * session, because afterwards nothing can be saved any more.
 */
export interface UnsavedWork {
  /** Tries to save what there is. Resolves to whether all of it is saved now. */
  save(): Promise<boolean>;
  /** Gives up what could not be saved. */
  discard(): void;
  /** Puts what could not be saved somewhere it survives a reload, to be offered again. */
  putAside?(): void;
}

const registered = new Set<UnsavedWork>();

/** Returns the function that takes it out again. */
export function registerUnsavedWork(work: UnsavedWork): () => void {
  registered.add(work);
  return () => {
    registered.delete(work);
  };
}

/** Whether everything on the page is saved, after trying to save what was not. */
export async function saveUnsavedWork(): Promise<boolean> {
  const saved = await Promise.all([...registered].map((work) => work.save().catch(() => false)));
  return saved.every(Boolean);
}

export function putUnsavedWorkAside(): void {
  for (const work of registered) work.putAside?.();
}

export function discardUnsavedWork(): void {
  for (const work of registered) work.discard();
}
