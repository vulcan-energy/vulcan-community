// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import './GlobalButtonSystem.css';
import { ModalHeader } from './ModalHeader';
import { UnheatedSpaceRuCalculator } from './UnheatedSpaceRuCalculator';
import type { RuCalculatorStateV1 } from '../lib/unheatedSpaceRu';
import type { GeometryWorkspaceResourcePort } from '../../../geometry-editor-host/src/workspaceResourcePort';

export interface UnheatedSpaceRuCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRu?: number;
  /** Snapshot for the calculator (parent recomputes when opening). */
  initialCalculatorState: RuCalculatorStateV1;
  /** Increment when opening the modal so the calculator remounts with fresh state. */
  calculatorMountKey: number;
  onApply: (thermalResistanceUnconditionedSpace: number, extraJsonPatch: Record<string, unknown>) => void;
  workspaceResourcePort?: GeometryWorkspaceResourcePort;
}

export const UnheatedSpaceRuCalculatorModal: React.FC<UnheatedSpaceRuCalculatorModalProps> = ({
  isOpen,
  onClose,
  currentRu,
  initialCalculatorState,
  calculatorMountKey,
  onApply,
  workspaceResourcePort,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return ReactDOM.createPortal(
    <div className="modal-backdrop" role="presentation" onMouseDown={handleBackdrop}>
      <div
        className="modal-container"
        style={{
          maxWidth: 560,
          width: '92vw',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <ModalHeader title="Unheated space thermal resistance" onClose={onClose} />
        <div style={{ overflow: 'auto', padding: '0 16px 16px', flex: 1, minHeight: 0 }}>
          <UnheatedSpaceRuCalculator
            key={calculatorMountKey}
            flat
            variant="modal"
            showHeading={false}
            initialState={initialCalculatorState}
            currentRu={currentRu}
            workspaceResourcePort={workspaceResourcePort}
            onApply={(ru, patch) => {
              onApply(ru, patch);
              onClose();
            }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
};
