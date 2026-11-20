import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyUpdate, resetAppUpdate, useUpdateWaiting, watchRegistration } from './appUpdate';
import { UpdateBanner } from '../components/UpdateBanner';
import { expectNoAxeViolations } from '../test/axe';
import { registerUnsavedWork } from './unsavedWork';

/** A registration and a container that can be driven by hand, as Chromium drives them. */
function fakeWorker(controller: object | null = {}) {
  const container = Object.assign(new EventTarget(), { controller });
  const registration = Object.assign(new EventTarget(), {
    waiting: null as ServiceWorker | null,
    installing: null as ServiceWorker | null,
  });
  const newWorker = Object.assign(new EventTarget(), { state: 'installing', postMessage: vi.fn() });
  const install = () => {
    registration.installing = newWorker as unknown as ServiceWorker;
    registration.dispatchEvent(new Event('updatefound'));
    newWorker.state = 'installed';
    newWorker.dispatchEvent(new Event('statechange'));
  };
  return {
    container: container as unknown as ServiceWorkerContainer,
    registration: registration as unknown as ServiceWorkerRegistration,
    newWorker,
    install,
  };
}

afterEach(() => {
  resetAppUpdate();
  vi.unstubAllGlobals();
});

describe('the new version', () => {
  it('is offered once it has installed beside the one in use', () => {
    const { container, registration, install } = fakeWorker();
    const { result } = renderHook(() => useUpdateWaiting());
    watchRegistration(registration, container);
    expect(result.current).toBe(false);
    act(() => install());
    expect(result.current).toBe(true);
  });

  it('is not offered on the very first visit, when there is no version in use yet', () => {
    const { container, registration, install } = fakeWorker(null);
    const { result } = renderHook(() => useUpdateWaiting());
    watchRegistration(registration, container);
    act(() => install());
    expect(result.current).toBe(false);
  });

  it('takes over and reloads only when asked, after what is open has been saved', async () => {
    const { container, registration, newWorker, install } = fakeWorker();
    watchRegistration(registration, container);
    install();
    const reload = vi.fn();
    const save = vi.fn().mockResolvedValue(true);
    const unregister = registerUnsavedWork({ save, discard: vi.fn() });

    expect(newWorker.postMessage).not.toHaveBeenCalled();
    await expect(applyUpdate(container, reload)).resolves.toBe(true);
    expect(save).toHaveBeenCalled();
    expect(newWorker.postMessage).toHaveBeenCalledWith('skip-waiting');
    expect(reload).not.toHaveBeenCalled();
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
    unregister();
  });

  it('does not reload over a draft that could not be saved', async () => {
    const { container, registration, newWorker, install } = fakeWorker();
    watchRegistration(registration, container);
    install();
    const unregister = registerUnsavedWork({ save: vi.fn().mockResolvedValue(false), discard: vi.fn() });
    const reload = vi.fn();
    await expect(applyUpdate(container, reload)).resolves.toBe(false);
    expect(newWorker.postMessage).not.toHaveBeenCalled();
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
    unregister();
  });
});

describe('UpdateBanner', () => {
  it('shows nothing until there is a new version, then says why it did not reload over unsaved text', async () => {
    const { container, registration, install } = fakeWorker();
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: container });
    render(<UpdateBanner />);
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();

    watchRegistration(registration, container);
    act(() => install());
    expect(screen.getByRole('status')).toHaveTextContent('A new version of Notes is available.');
    await expectNoAxeViolations({ part: true });

    const unregister = registerUnsavedWork({ save: vi.fn().mockResolvedValue(false), discard: vi.fn() });
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(screen.getByRole('status')).toHaveTextContent('Your latest changes are not saved yet');
    unregister();
  });
});
