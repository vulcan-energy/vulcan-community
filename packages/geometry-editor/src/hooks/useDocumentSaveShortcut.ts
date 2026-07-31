// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from 'react';

import type { GeometryDocumentHostPort } from '../../../geometry-document/src';

export type UseDocumentSaveShortcutOptions = Readonly<{
  documentHost: GeometryDocumentHostPort | null;
  ownerRootRef: Readonly<{ current: HTMLElement | null }>;
}>;

const mountedOwners = new Set<symbol>();

/**
 * Gives one mounted editor ownership of the browser Save shortcut.
 *
 * Focus selects an owner when multiple editors are mounted. A lone editor may
 * also claim an unfocused shortcut, except while an editable control outside
 * that editor owns focus. This preserves the established Official behavior
 * while coordinating Official and Community compositions through one shared
 * registry.
 */
export function useDocumentSaveShortcut({
  documentHost,
  ownerRootRef,
}: UseDocumentSaveShortcutOptions): void {
  const documentHostRef = useRef(documentHost);
  const ownerRef = useRef(Symbol('geometry-document-save-shortcut-owner'));
  const enabled = documentHost !== null;

  useEffect(() => {
    documentHostRef.current = documentHost;
  }, [documentHost]);

  useEffect(() => {
    if (!enabled) return;

    const owner = ownerRef.current;
    mountedOwners.add(owner);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;

      const root = ownerRootRef.current;
      if (root === null) return;
      const activeElement = document.activeElement;
      const activeInsideOwner = activeElement !== null && root.contains(activeElement);
      const focusedEditableOutside = activeElement !== null
        && !activeInsideOwner
        && activeElement.matches('input, textarea, [contenteditable="true"]');
      const isOnlyOwner = mountedOwners.size === 1;
      if (!activeInsideOwner && (!isOnlyOwner || focusedEditableOutside)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const activeDocumentHost = documentHostRef.current;
      if (activeDocumentHost === null) return;
      void activeDocumentHost.save().catch((error) => {
        console.error('[GeometryEditor] Keyboard Save failed:', error);
      });
    };

    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
      mountedOwners.delete(owner);
    };
  }, [enabled, ownerRootRef]);
}
