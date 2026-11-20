import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateBanner } from '../components/UpdateBanner';
import { expectNoAxeViolations } from '../test/axe';
import {
  applyUpdate,
  checkDeployedVersion,
  followNewWorker,
  resetAppUpdate,
  useUpdateState,
  watchRegistration,
} from './appUpdate';
import { registerUnsavedWork } from './unsavedWork';

/** A registration and a container that can be driven by hand, as Chromium drives them. */
function fakeWorker(controller: object | null = {}) {
  const container = Object.assign(new EventTarget(), { controller });
  const registration = Object.assign(new EventTarget(), {
    waiting: null as ServiceWorker | null,
    installing: null as ServiceWorker | null,
    update: vi.fn().mockResolvedValue(undefined),
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
    const { result } = renderHook(() => useUpdateState());
    watchRegistration(registration, container);
    expect(result.current).toBe('none');
    act(() => install());
    expect(result.current).toBe('available');
  });

  it('is not offered on the very first visit, when there is no version in use yet', () => {
    const { container, registration, install } = fakeWorker(null);
    const { result } = renderHook(() => useUpdateState());
    watchRegistration(registration, container);
    act(() => install());
    expect(result.current).toBe('none');
  });

  it('is asked for only after what is open has been saved, and never over a draft that could not be', async () => {
    const { container, registration, newWorker, install } = fakeWorker();
    watchRegistration(registration, container);
    install();
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const unregister = registerUnsavedWork({ save, discard: vi.fn() });

    await expect(applyUpdate()).resolves.toBe(false);
    expect(newWorker.postMessage).not.toHaveBeenCalled();
    await expect(applyUpdate()).resolves.toBe(true);
    expect(newWorker.postMessage).toHaveBeenCalledWith('skip-waiting');
    unregister();
  });
});

describe('a tab whose worker was replaced from another tab', () => {
  it('reloads after saving its open note', async () => {
    const { container } = fakeWorker();
    const reload = vi.fn();
    const save = vi.fn().mockResolvedValue(true);
    const unregister = registerUnsavedWork({ save, discard: vi.fn() });
    followNewWorker(container, reload);
    container.dispatchEvent(new Event('controllerchange'));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalled();
    unregister();
  });

  it('puts an unsaved draft aside and asks to be reloaded, instead of running on', async () => {
    const { container } = fakeWorker();
    const reload = vi.fn();
    const putAside = vi.fn();
    const unregister = registerUnsavedWork({ save: vi.fn().mockResolvedValue(false), discard: vi.fn(), putAside });
    const { result } = renderHook(() => useUpdateState());
    followNewWorker(container, reload);
    await act(async () => {
      container.dispatchEvent(new Event('controllerchange'));
    });
    await vi.waitFor(() => expect(result.current).toBe('must-reload'));
    expect(putAside).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    unregister();
  });

  it('does not reload when the first worker of a visit takes over', () => {
    const { container } = fakeWorker(null);
    const reload = vi.fn();
    followNewWorker(container, reload);
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('checkDeployedVersion', () => {
  it('offers a reload when another build is deployed, and asks the worker to look for it', async () => {
    const { registration } = fakeWorker();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ build: 'new' }))));
    const { result } = renderHook(() => useUpdateState());
    await act(() => checkDeployedVersion(registration, 'old'));
    expect(result.current).toBe('available');
    expect(registration.update).toHaveBeenCalled();
  });

  it('stays quiet for the same build, and offline', async () => {
    const { result } = renderHook(() => useUpdateState());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ build: 'same' }))));
    await act(() => checkDeployedVersion(undefined, 'same'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await act(() => checkDeployedVersion(undefined, 'same'));
    expect(result.current).toBe('none');
  });
});

describe('UpdateBanner', () => {
  it('shows nothing until there is a new version, then says why it did not reload over unsaved text', async () => {
    const { container, registration, install } = fakeWorker();
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
