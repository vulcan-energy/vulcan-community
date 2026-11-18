// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from 'react';
import { useGeometryStore } from '../stores/geometryStore';
import { dismissUndoToast, headStep, undoOfferedChange, useUndoToast } from '../lib/undoToast';

const SHOWN_MS = 8000;

/** "Changed to … · Undo" after a change the editor made for the user (`changeWithUndo`). */
export function UndoToast() {
  const toast = useUndoToast();
  const head = useGeometryStore(headStep);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismissUndoToast, SHOWN_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  // A later step makes the offer stale.
  if (!toast || head !== toast.step) return null;
  return (
    <output className="window-apply-line" data-undo-toast>
      <span>{toast.message}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={undoOfferedChange}>Undo</button>
    </output>
  );
}
