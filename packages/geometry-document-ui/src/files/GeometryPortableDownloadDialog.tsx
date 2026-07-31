// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from './reactDomPortal';

export type GeometryPortableDownloadSource = Readonly<{
  id: string;
  fileName: string;
  role: string;
}>;

export type GeometryPortableDownloadDialogProps = Readonly<{
  sources: readonly GeometryPortableDownloadSource[];
  onDownload: (includeSourceFileIds: readonly string[]) => void;
  onCancel: () => void;
}>;

export function GeometryPortableDownloadDialog({
  sources,
  onDownload,
  onCancel,
}: GeometryPortableDownloadDialogProps) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const cancelRef = useRef<HTMLButtonElement>(null);
  const orderedSelectedIds = useMemo(
    () => sources.flatMap((source) => selectedIds.has(source.id) ? [source.id] : []),
    [selectedIds, sources],
  );

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const count = orderedSelectedIds.length;
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
        className="geometry-files-dialog geometry-portable-source-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Include source files?"
        tabIndex={-1}
      >
        <h2>Include source files?</h2>
        <p>
          Original source files can contain sensitive model data. They are excluded
          unless you select them here.
        </p>
        <div className="geometry-portable-source-list">
          {sources.map((source) => (
            <label key={source.id} className="geometry-portable-source-row">
              <input
                type="checkbox"
                checked={selectedIds.has(source.id)}
                aria-label={`Include source file ${source.fileName}`}
                onChange={(event) => {
                  const next = new Set(selectedIds);
                  if (event.target.checked) next.add(source.id);
                  else next.delete(source.id);
                  setSelectedIds(next);
                }}
              />
              <span>
                <strong>{source.fileName}</strong>
                <small>{source.role}</small>
              </span>
            </label>
          ))}
        </div>
        <div className="geometry-files-dialog-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="geometry-files-primary"
            onClick={() => onDownload(Object.freeze(orderedSelectedIds))}
          >
            {count === 0
              ? 'Download without source files'
              : `Download with ${count} source ${count === 1 ? 'file' : 'files'}`}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? null : createPortal(content, document.body);
}
