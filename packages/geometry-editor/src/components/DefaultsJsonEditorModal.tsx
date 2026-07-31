// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { useGeometryWorkspaceResourcePort } from '../../../geometry-editor-host/src/editorServicePorts';
import { isRecord } from '../lib/jsonTypes';
import { useGeometryStoreApi } from '../stores/geometryStore';
import type { GlobalSettingsDefaultsCompatibility } from './GlobalSettingsModal';
import { ModalHeader } from './ModalHeader';
import { useKeyedState } from '../hooks/useKeyedState';

export type DefaultsJsonEditorModalProps = Readonly<{
  isOpen: boolean;
  filePath: string;
  onClose(): void;
  onBackToFabric(): void;
  inspectCompatibility?: (
    content: string,
  ) => GlobalSettingsDefaultsCompatibility;
  initialCompatibility?: GlobalSettingsDefaultsCompatibility;
  onCommitted?: (
    merged: unknown,
    compatibility: GlobalSettingsDefaultsCompatibility | undefined,
  ) => void;
}>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DefaultsJsonEditorModal({
  isOpen,
  filePath,
  onClose,
  onBackToFabric,
  inspectCompatibility,
  initialCompatibility,
  onCommitted,
}: DefaultsJsonEditorModalProps): React.ReactPortal | null {
  const geometryStore = useGeometryStoreApi();
  const workspaceResourcePort = useGeometryWorkspaceResourcePort();
  const hasFilePath = filePath.trim().length > 0;
  const canLoad = isOpen && hasFilePath && workspaceResourcePort.availability === 'available';
  const loadKey = [
    isOpen ? 'open' : 'closed',
    filePath,
    workspaceResourcePort.availability,
  ].join('\0');
  const [text, setText] = useKeyedState(loadKey, '');
  const [baselineText, setBaselineText] = useKeyedState(loadKey, '');
  const [loading, setLoading] = useKeyedState(loadKey, canLoad);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useKeyedState<string | null>(
    loadKey,
    isOpen && hasFilePath && workspaceResourcePort.availability !== 'available'
      ? 'Workspace resource access is unavailable.'
      : null,
  );
  const [saveError, setSaveError] = useKeyedState<string | null>(loadKey, null);

  useEffect(() => {
    if (!canLoad) return;
    let cancelled = false;
    if (workspaceResourcePort.availability !== 'available') return;
    void workspaceResourcePort.readText(filePath).then((content) => {
      if (cancelled) return;
      setText(content);
      setBaselineText(content);
    }).catch((error: unknown) => {
      if (!cancelled) setLoadError(errorMessage(error));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    canLoad,
    filePath,
    setBaselineText,
    setLoadError,
    setLoading,
    setText,
    workspaceResourcePort,
  ]);

  const parseResult = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) {
        return { parsed: null, error: 'Defaults JSON must have an object at its root.' };
      }
      return { parsed, error: null };
    } catch (error: unknown) {
      return { parsed: null, error: `Invalid JSON: ${errorMessage(error)}` };
    }
  }, [text]);

  const compatibility = useMemo(() => {
    if (parseResult.error || !inspectCompatibility) return initialCompatibility;
    try {
      return inspectCompatibility(text);
    } catch (error: unknown) {
      return {
        warnings: [`Compatibility check failed: ${errorMessage(error)}`],
        foundTypes: [],
        hasRequiredRootSections: false,
      };
    }
  }, [initialCompatibility, inspectCompatibility, parseResult.error, text]);

  const dirty = text !== baselineText;

  const confirmDiscard = useCallback((): boolean => (
    !dirty ||
    typeof window === 'undefined' ||
    window.confirm('Discard unsaved defaults changes?')
  ), [dirty]);

  const handleClose = useCallback(() => {
    if (confirmDiscard()) onClose();
  }, [confirmDiscard, onClose]);

  const handleBack = useCallback(() => {
    if (confirmDiscard()) onBackToFabric();
  }, [confirmDiscard, onBackToFabric]);

  const handleSave = useCallback(async () => {
    if (!parseResult.parsed || parseResult.error) return;
    if (workspaceResourcePort.availability !== 'available') {
      setSaveError('Workspace resource access is unavailable.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const formatted = `${JSON.stringify(parseResult.parsed, null, 2)}\n`;
      const checkedCompatibility = inspectCompatibility
        ? inspectCompatibility(formatted)
        : compatibility;
      await workspaceResourcePort.writeText(filePath, formatted);

      const state = geometryStore.getState();
      if ((state.defaultsPath || '').trim() === filePath.trim()) {
        state.setDefaultsJson(parseResult.parsed);
      }

      setText(formatted);
      setBaselineText(formatted);
      onCommitted?.(parseResult.parsed, checkedCompatibility);
    } catch (error: unknown) {
      setSaveError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [
    compatibility,
    filePath,
    geometryStore,
    inspectCompatibility,
    onCommitted,
    parseResult.error,
    parseResult.parsed,
    setBaselineText,
    setSaveError,
    setText,
    workspaceResourcePort,
  ]);

  if (!isOpen || typeof window === 'undefined') return null;

  const baseName = filePath.split('/').pop()?.replace(/\.json$/i, '') || filePath;
  const warnings = compatibility?.warnings ?? [];

  return ReactDOM.createPortal(
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
      role="presentation"
    >
      <div
        className="modal-container large"
        role="dialog"
        aria-modal="true"
        aria-label={`Full defaults JSON — ${baseName}`}
        onClick={(event) => event.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'min(88vh, 920px)',
          width: 'min(920px, 96vw)',
        }}
      >
        <ModalHeader title={`Full defaults JSON — ${baseName}`} onClose={handleClose} />
        <div style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
          {filePath}
        </div>
        {loadError ? <p className="error-text">{loadError}</p> : null}
        {saveError ? <p className="error-text">{saveError}</p> : null}
        {!loading && parseResult.error ? <p className="error-text">{parseResult.error}</p> : null}
        {warnings.length > 0 ? (
          <div role="status" style={{ color: 'var(--warning-text)', fontSize: 12 }}>
            <strong>Compatibility warnings</strong>
            <ul>
              {warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        ) : null}
        <textarea
          aria-label="Defaults JSON"
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={loading || saving}
          spellCheck={false}
          style={{
            flex: 1,
            minHeight: 420,
            resize: 'vertical',
            fontFamily: 'monospace',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 12 }}>
          <button type="button" className="btn btn-ghost" onClick={handleBack}>
            Back to fabric defaults
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || !!parseResult.error || loading || saving}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save full defaults'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
