// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useGeometryWorkspaceResourcePort } from '../../../geometry-editor-host/src/editorServicePorts';
import { ModalHeader } from './ModalHeader';
import { FabricDefaultsEditorPanel } from './FabricDefaultsEditor';
import type { GlobalSettingsDefaultsCompatibility } from './GlobalSettingsModal';
import { useKeyedState } from '../hooks/useKeyedState';

export type FabricDefaultsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  /** Called after user confirms if needed (parent switches to full JSON mode). */
  onSwitchToFullJsonEditor: () => void;
  defaultsCompatibility?: GlobalSettingsDefaultsCompatibility;
  onCommitted?: (merged: unknown) => void;
};

export function FabricDefaultsModal({
  isOpen,
  onClose,
  filePath,
  onSwitchToFullJsonEditor,
  defaultsCompatibility,
  onCommitted,
}: FabricDefaultsModalProps): React.ReactPortal | null {
  const workspaceResourcePort = useGeometryWorkspaceResourcePort();
  const hasFilePath = filePath.trim().length > 0;
  const canLoad = isOpen && hasFilePath && workspaceResourcePort.availability === 'available';
  const loadKey = [
    isOpen ? 'open' : 'closed',
    filePath,
    workspaceResourcePort.availability,
  ].join('\0');
  const [root, setRoot] = useKeyedState<unknown | null>(loadKey, null);
  const [loading, setLoading] = useKeyedState(loadKey, canLoad);
  const [loadError, setLoadError] = useKeyedState<string | null>(
    loadKey,
    isOpen && hasFilePath && workspaceResourcePort.availability !== 'available'
      ? 'Workspace resource access is unavailable.'
      : null,
  );
  const [fabricDirty, setFabricDirty] = useState(false);

  useEffect(() => {
    if (!canLoad) return;
    let cancelled = false;
    if (workspaceResourcePort.availability !== 'available') return;
    void workspaceResourcePort
      .readText(filePath)
      .then((text) => {
        if (cancelled) return;
        try {
          setRoot(JSON.parse(text));
          setLoadError(null);
        } catch (e: unknown) {
          const msg = e && typeof e === 'object' && 'message' in e ? String((e as Error).message) : String(e);
          setLoadError(`Invalid JSON: ${msg}`);
          setRoot(null);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e && typeof e === 'object' && 'message' in e ? String((e as Error).message) : String(e);
        setLoadError(msg);
        setRoot(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canLoad, filePath, setLoadError, setLoading, setRoot, workspaceResourcePort]);

  const handleOpenFullJson = useCallback(() => {
    if (
      fabricDirty &&
      typeof window !== 'undefined' &&
      !window.confirm(
        'You have unsaved fabric changes. Switch to the full JSON editor anyway? Unsaved changes will be lost unless you save first.',
      )
    ) {
      return;
    }
    onSwitchToFullJsonEditor();
  }, [fabricDirty, onSwitchToFullJsonEditor]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        if (
          fabricDirty &&
          typeof window !== 'undefined' &&
          !window.confirm('Close without saving fabric changes?')
        ) {
          return;
        }
        onClose();
      }
    },
    [fabricDirty, onClose],
  );

  const handleHeaderClose = useCallback(() => {
    if (
      fabricDirty &&
      typeof window !== 'undefined' &&
      !window.confirm('Close without saving fabric changes?')
    ) {
      return;
    }
    onClose();
  }, [fabricDirty, onClose]);

  if (!isOpen || typeof window === 'undefined') return null;

  const baseName = filePath.split('/').pop()?.replace(/\.json$/i, '') || filePath;

  const modalContent = (
    <div className="modal-backdrop" onClick={handleBackdrop} role="presentation">
      <div
        className="modal-container large"
        style={{
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'min(88vh, 920px)',
          width: 'min(760px, 94vw)',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Fabric defaults — ${baseName}`}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexShrink: 0, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ModalHeader title={`Fabric defaults — ${baseName}`} onClose={handleHeaderClose} />
          </div>
          {defaultsCompatibility && defaultsCompatibility.warnings.length > 0 ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                background: 'rgba(255, 165, 0, 0.15)',
                border: '1px solid rgba(255, 165, 0, 0.3)',
                borderRadius: 4,
                fontSize: 11,
                color: 'var(--warning-text, #ff8c00)',
                cursor: 'help',
                fontWeight: 500,
                flexShrink: 0,
                marginTop: 4,
              }}
              title={defaultsCompatibility.warnings.join('\n')}
            >
              ⚠️ {defaultsCompatibility.warnings.length}
            </span>
          ) : null}
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <FabricDefaultsEditorPanel
            filePath={filePath}
            defaultsRoot={root}
            loading={loading}
            loadError={loadError}
            onOpenFullJsonEditor={handleOpenFullJson}
            onCommitted={(merged) => {
              setRoot(merged);
              onCommitted?.(merged);
            }}
            onDirtyChange={setFabricDirty}
          />
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
}
