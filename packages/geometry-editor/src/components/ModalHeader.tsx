// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import './ModalSystem.css';

interface ModalHeaderProps {
  icon?: React.ReactNode;
  title: string;
  titleId?: string;
  /** Rendered inline after the title (e.g. badges). */
  titleAccessory?: React.ReactNode;
  /** Pinned to the right before the close control (e.g. Library / Back). */
  headerActions?: React.ReactNode;
  onClose?: () => void;
  editable?: boolean;
  onTitleChange?: (next: string) => void;
}

export const ModalHeader: React.FC<ModalHeaderProps> = ({
  icon,
  title,
  titleId,
  titleAccessory,
  headerActions,
  onClose,
  editable,
  onTitleChange,
}) => (
  <div className="modal-header">
    {icon && <div className="modal-icon">{icon}</div>}
    <div className="modal-header-title-cluster">
      {editable ? (
        <input
          id={titleId}
          className="modal-title-input"
          value={title}
          onChange={(e) => onTitleChange?.(e.target.value)}
        />
      ) : (
        <h2 id={titleId} className="modal-title">{title}</h2>
      )}
      {titleAccessory}
    </div>
    {(headerActions || onClose) && (
      <div className="modal-header-trailing">
        {headerActions}
        {onClose && (
          <button className="modal-close-button" onClick={onClose} aria-label="Close modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2"/>
              <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </button>
        )}
      </div>
    )}
  </div>
);
