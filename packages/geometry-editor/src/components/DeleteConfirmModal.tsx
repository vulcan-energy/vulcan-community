// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect, useId, useRef } from 'react';
import ReactDOM from 'react-dom';
import './GlobalButtonSystem.css';
import './DeleteConfirmModal.css';
import { ModalHeader } from './ModalHeader';

// Focus-trap primitives, adapted from the parent app's ModalFrame (web/src/components/
// ModalFrame.tsx) — reimplemented here rather than imported, since this package does not
// depend on the parent app. Kept local to this file; promote to a shared helper if a second
// community component needs the same trap.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && !el.hasAttribute('aria-hidden');
  });
}

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  itemName?: string;
  itemType: 'zone' | 'element' | 'file';
  itemTypeLabel?: string;
  childElements?: Array<{ name: string; type: string }>;
  actionButtonText?: string;
  /** Defaults to destructive red; use `primary` for non-delete confirmations (e.g. mode switches). */
  confirmVariant?: 'danger' | 'primary';
  /** When nested (e.g. confirm inside another modal), stack above the parent backdrop. */
  backdropZIndex?: number;
  /** Hide the default “cannot be undone” line (e.g. discard unsaved edits). */
  hideIrreversibleWarning?: boolean;
  /** Which button receives focus when the dialog opens. Defaults to `'cancel'` — the
   *  second element in tab order, after the header's close button — so Enter
   *  immediately after opening is a no-op rather than a destructive confirm. */
  initialFocus?: 'cancel' | 'confirm';
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  itemName,
  itemType,
  itemTypeLabel,
  childElements = [],
  actionButtonText = 'Delete',
  confirmVariant = 'danger',
  backdropZIndex,
  hideIrreversibleWarning = false,
  initialFocus = 'cancel',
}) => {
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Move focus into the dialog on open, and restore it to whatever opened the dialog
  // on close/unmount — the same contract as ModalFrame's initial-focus effect.
  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container || typeof document === 'undefined') return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const target = initialFocus === 'confirm' ? confirmButtonRef.current : cancelButtonRef.current;
    (target ?? getFocusableElements(container)[0] ?? container).focus();

    return () => {
      previousFocusRef.current?.focus?.();
    };
  }, [isOpen, initialFocus]);

  // Trap Tab within the dialog and route Escape to onClose, both at the document level
  // (capture phase) so they win regardless of which descendant currently has focus —
  // the same contract as ModalFrame's key-handling effect.
  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container || typeof document === 'undefined') return;

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      const activeInside = active instanceof Node && container.contains(active);

      if (!activeInside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Enter confirms only as keyboard activation of the confirm button itself — never as
  // a blanket handler on the backdrop/document, which previously fired onConfirm on
  // Enter regardless of what had focus (one keystroke from an unintended delete).
  const handleConfirmKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onConfirm();
    }
  };

  const getItemTypeIcon = () => {
    switch (itemType) {
      case 'zone':
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-label="Zone">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
            <path d="M3 9h18M9 21V9" stroke="currentColor" strokeWidth="2"/>
          </svg>
        );
      case 'element':
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-label="Element">
            <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="2"/>
            <line x1="8" y1="8" x2="16" y2="16" stroke="currentColor" strokeWidth="2"/>
            <line x1="16" y1="8" x2="8" y2="16" stroke="currentColor" strokeWidth="2"/>
          </svg>
        );
      case 'file':
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-label="File">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2"/>
            <polyline points="14,2 14,8 20,8" stroke="currentColor" strokeWidth="2"/>
            <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="2"/>
            <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="2"/>
            <polyline points="10,9 9,9 8,9" stroke="currentColor" strokeWidth="2"/>
          </svg>
        );
      default:
        return null;
    }
  };

  const modalContent = (
    <div
      className="modal-backdrop"
      style={backdropZIndex != null ? { zIndex: backdropZIndex } : undefined}
      onClick={handleBackdropClick}
    >
      <div
        ref={containerRef}
        className="modal-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <ModalHeader
          icon={<div className="modal-icon destructive">{getItemTypeIcon()}</div>}
          title={title}
          titleId={titleId}
          onClose={onClose}
        />

        <p className="modal-message">{message}</p>
        {itemName && (
          <div style={{ display: 'flex', alignItems: 'center', margin: '0 0 18px 0' }}>
            <div className="delete-pill">
              <span className="delete-pill-name">{itemName}</span>
              <span className="delete-pill-type">{itemTypeLabel || (itemType.charAt(0).toUpperCase() + itemType.slice(1))}</span>
            </div>
          </div>
        )}
        {childElements.length > 0 && (
          <div className="modal-child-elements">
            <p>The following child elements will also be deleted:</p>
            <div className="child-elements-list">
              {childElements.map((child, index) => (
                <div key={index} className="delete-pill">
                  <span className="delete-pill-name">{child.name}</span>
                  <span className="delete-pill-type">{child.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {!hideIrreversibleWarning ? (
          <p className="modal-warning">This action cannot be undone.</p>
        ) : null}
        <div className="modal-actions">
          <button
            ref={cancelButtonRef}
            className="btn btn-ghost btn-standard"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            className={confirmVariant === 'primary' ? 'btn btn-standard btn-yellow' : 'btn btn-danger btn-standard'}
            onClick={onConfirm}
            onKeyDown={handleConfirmKeyDown}
          >
            {actionButtonText}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof window !== 'undefined'
    ? ReactDOM.createPortal(modalContent, document.body)
    : null;
};
