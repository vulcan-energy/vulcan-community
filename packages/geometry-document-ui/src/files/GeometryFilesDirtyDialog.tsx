// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from 'react';
import { createPortal } from './reactDomPortal';
import type { GeometryFilesMenuDirtyDialog } from './geometryFilesMenuContracts';

export function GeometryFilesDirtyDialog({
  title,
  message,
  onSave,
  onDiscard,
  onCancel,
}: GeometryFilesMenuDirtyDialog) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const content = (
    <div
      className="geometry-files-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <div
        className="geometry-files-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="geometry-files-dialog-actions geometry-files-dialog-actions--three">
          <button ref={cancelRef} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onDiscard}>
            Discard
          </button>
          <button type="button" className="geometry-files-primary" onClick={onSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? null : createPortal(content, document.body);
}
