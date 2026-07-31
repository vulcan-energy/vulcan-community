// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useRef } from 'react';
import ReactDOM from 'react-dom';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDocumentSaveShortcut } from '../useDocumentSaveShortcut';
import type { GeometryDocumentHostPort } from '../../../../geometry-document/src/index';

function documentHostHarness(): GeometryDocumentHostPort {
  const completed = async () => Object.freeze({ status: 'completed' as const });
  const document = Object.freeze({
    fileName: 'Model.csv',
    text: '',
    derivedResources: Object.freeze([]),
    sourceFiles: Object.freeze([]),
    revision: 0,
    persistedRevision: 0,
    isDirty: false,
  });
  return Object.freeze({
    getSnapshot: () => Object.freeze({
      document,
      activeDocument: null,
      operation: null,
    }),
    subscribe: () => () => undefined,
    updateFileName: vi.fn(),
    isDirty: () => false,
    save: vi.fn(completed),
    newDocument: vi.fn(completed),
    open: vi.fn(completed),
    delete: vi.fn(completed),
    duplicate: vi.fn(completed),
    dispose: vi.fn(),
  });
}

function ShortcutOwner({
  documentHost,
  label,
  portalled = false,
}: Readonly<{
  documentHost: GeometryDocumentHostPort;
  label: string;
  portalled?: boolean;
}>) {
  const ownerRootRef = useRef<HTMLDivElement>(null);
  useDocumentSaveShortcut({ documentHost, ownerRootRef });
  const owner = (
    <div ref={ownerRootRef} data-testid={`${label}-root`}>
      <input aria-label={`${label} input`} />
    </div>
  );
  return portalled ? ReactDOM.createPortal(owner, document.body) : owner;
}

function DisabledShortcutOwner() {
  const ownerRootRef = useRef<HTMLDivElement>(null);
  useDocumentSaveShortcut({ documentHost: null, ownerRootRef });
  return <div ref={ownerRootRef}>Disabled editor</div>;
}

function dispatchSaveShortcut(modifier: 'meta' | 'control'): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 's',
    bubbles: true,
    cancelable: true,
    metaKey: modifier === 'meta',
    ctrlKey: modifier === 'control',
  });
  act(() => {
    document.dispatchEvent(event);
  });
  return event;
}

describe('useDocumentSaveShortcut', () => {
  it.each(['meta', 'control'] as const)(
    'owns %s+S for the only mounted editor and prevents browser Save Page',
    (modifier) => {
      const documentHost = documentHostHarness();
      render(<ShortcutOwner documentHost={documentHost} label="Only" portalled />);

      const event = dispatchSaveShortcut(modifier);

      expect(event.defaultPrevented).toBe(true);
      expect(documentHost.save).toHaveBeenCalledOnce();
    },
  );

  it('routes Save exactly once to the editor containing the focused control', () => {
    const firstHost = documentHostHarness();
    const secondHost = documentHostHarness();
    render(
      <>
        <ShortcutOwner documentHost={firstHost} label="First" portalled />
        <ShortcutOwner documentHost={secondHost} label="Second" portalled />
      </>,
    );
    screen.getByRole('textbox', { name: 'Second input' }).focus();

    const event = dispatchSaveShortcut('meta');

    expect(event.defaultPrevented).toBe(true);
    expect(firstHost.save).not.toHaveBeenCalled();
    expect(secondHost.save).toHaveBeenCalledOnce();
  });

  it('does not claim an ambiguous shortcut when multiple editors have no focused owner', () => {
    const firstHost = documentHostHarness();
    const secondHost = documentHostHarness();
    render(
      <>
        <ShortcutOwner documentHost={firstHost} label="First" portalled />
        <ShortcutOwner documentHost={secondHost} label="Second" portalled />
      </>,
    );
    (document.activeElement as HTMLElement | null)?.blur();

    const event = dispatchSaveShortcut('control');

    expect(event.defaultPrevented).toBe(false);
    expect(firstHost.save).not.toHaveBeenCalled();
    expect(secondHost.save).not.toHaveBeenCalled();
  });

  it('preserves native Save behavior for an editable control outside the only editor', () => {
    const documentHost = documentHostHarness();
    render(
      <>
        <input aria-label="Outside input" />
        <ShortcutOwner documentHost={documentHost} label="Only" portalled />
      </>,
    );
    screen.getByRole('textbox', { name: 'Outside input' }).focus();

    const event = dispatchSaveShortcut('meta');

    expect(event.defaultPrevented).toBe(false);
    expect(documentHost.save).not.toHaveBeenCalled();
  });

  it('releases shortcut ownership when its editor unmounts', () => {
    const documentHost = documentHostHarness();
    const view = render(
      <ShortcutOwner documentHost={documentHost} label="Only" portalled />,
    );
    view.unmount();

    const event = dispatchSaveShortcut('control');

    expect(event.defaultPrevented).toBe(false);
    expect(documentHost.save).not.toHaveBeenCalled();
  });

  it('does not register an editor without document controls', () => {
    render(<DisabledShortcutOwner />);

    const event = dispatchSaveShortcut('meta');

    expect(event.defaultPrevented).toBe(false);
  });
});
