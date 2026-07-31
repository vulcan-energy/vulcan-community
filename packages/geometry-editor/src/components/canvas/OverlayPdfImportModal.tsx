// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import ReactDOM from 'react-dom';
import { ModalHeader } from '../ModalHeader';
import { DraftSafeNumberInput } from '../DraftSafeNumberInput';
import './OverlayPdfImportModal.css';

interface OverlayPdfImportModalProps {
  isOpen: boolean;
  fileName: string | null;
  page: number;
  numPages: number;
  previewUrl: string | null;
  isPreviewLoading: boolean;
  isImporting: boolean;
  error: string | null;
  onClose: () => void;
  onPageChange: (page: number) => void;
  onConfirm: () => void;
}

export const OverlayPdfImportModal: React.FC<OverlayPdfImportModalProps> = ({
  isOpen,
  fileName,
  page,
  numPages,
  previewUrl,
  isPreviewLoading,
  isImporting,
  error,
  onClose,
  onPageChange,
  onConfirm,
}) => {
  if (!isOpen || typeof document === 'undefined') return null;

  const canGoPrev = page > 1;
  const canGoNext = page < numPages;

  return ReactDOM.createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-container overlay-pdf-import-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Select PDF overlay page"
      >
        <ModalHeader
          title="Select PDF Overlay Page"
          onClose={onClose}
          titleAccessory={fileName ? <span className="overlay-pdf-import-file">{fileName}</span> : undefined}
        />

        <div className="modal-body overlay-pdf-import-body">
          <div className="overlay-pdf-import-controls">
            <button
              className="draw-button"
              onClick={() => onPageChange(page - 1)}
              disabled={!canGoPrev || isPreviewLoading || isImporting}
            >
              Previous
            </button>
            <label className="overlay-pdf-import-page-field">
              <span>Page</span>
              <DraftSafeNumberInput
                className="compact-input"
                inputMode="numeric"
                min={1}
                max={numPages}
                value={page}
                onChange={(e) => onPageChange(Number.parseInt(e.target.value, 10) || 1)}
                disabled={isPreviewLoading || isImporting}
              />
              <span>of {numPages}</span>
            </label>
            <button
              className="draw-button"
              onClick={() => onPageChange(page + 1)}
              disabled={!canGoNext || isPreviewLoading || isImporting}
            >
              Next
            </button>
          </div>

          <div className="overlay-pdf-import-preview">
            {isPreviewLoading && <div className="overlay-pdf-import-preview-status">Rendering preview...</div>}
            {!isPreviewLoading && error && (
              <div className="overlay-pdf-import-preview-status overlay-pdf-import-preview-status--error">
                {error}
              </div>
            )}
            {!isPreviewLoading && !error && previewUrl && (
              <img
                src={previewUrl}
                alt={`PDF overlay page ${page} preview`}
                className="overlay-pdf-import-preview-image"
              />
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary btn-standard" type="button" onClick={onClose} disabled={isImporting}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-standard"
            type="button"
            onClick={onConfirm}
            disabled={isPreviewLoading || isImporting || !!error || !previewUrl}
          >
            {isImporting ? 'Importing...' : 'Use This Page'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
