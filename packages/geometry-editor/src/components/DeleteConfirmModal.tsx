// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import ReactDOM from 'react-dom';
import './GlobalButtonSystem.css';
import './DeleteConfirmModal.css';
import { ModalHeader } from './ModalHeader';

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
}) => {
  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
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
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="modal-container">
        <ModalHeader
          icon={<div className="modal-icon destructive">{getItemTypeIcon()}</div>}
          title={title}
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
            className="btn btn-ghost btn-standard"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className={confirmVariant === 'primary' ? 'btn btn-standard btn-yellow' : 'btn btn-danger btn-standard'}
            onClick={onConfirm}
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
