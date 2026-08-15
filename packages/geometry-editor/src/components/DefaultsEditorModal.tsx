// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import ReactDOM from 'react-dom';
import { useGeometryWorkspaceResourcePort } from '../../../geometry-editor-host/src/editorServicePorts';
import { isRecord } from '../lib/jsonTypes';
import { useGeometryStoreApi } from '../stores/geometryStore';
import { FabricDefaultsEditorPanel } from './FabricDefaultsEditor';
import type { GlobalSettingsDefaultsCompatibility } from './GlobalSettingsModal';
import { ModalHeader } from './ModalHeader';

export type DefaultsEditorModalProps = Readonly<{
  isOpen: boolean;
  filePath: string;
  onClose(): void;
  defaultsCompatibility?: GlobalSettingsDefaultsCompatibility;
  inspectCompatibility?: (
    content: string,
  ) => GlobalSettingsDefaultsCompatibility;
  onCommitted?: (
    merged: unknown,
    compatibility: GlobalSettingsDefaultsCompatibility | undefined,
  ) => void;
  /** Optional host reuse of an existing full-JSON surface; Community uses the public fallback. */
  renderFullEditor?: (
    context: Readonly<{
      filePath: string;
      onClose(): void;
      compatibility: GlobalSettingsDefaultsCompatibility | undefined;
    }>,
  ) => ReactNode;
}>;

type EditorMode = 'fabric' | 'raw';
type SaveFormat = 'fabric' | 'raw';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseDefaultsText(text: string): {
  root: unknown | null;
  error: string | null;
} {
  try {
    const root: unknown = JSON.parse(text);
    if (!isRecord(root)) {
      return { root: null, error: 'Defaults JSON must have an object at its root.' };
    }
    return { root, error: null };
  } catch (error: unknown) {
    return { root: null, error: `Invalid JSON: ${errorMessage(error)}` };
  }
}

/**
 * The canonical Community defaults session. Structured and raw views share one
 * file load, discard confirmation, and persistence boundary.
 */
export function DefaultsEditorModal({
  isOpen,
  filePath,
  onClose,
  defaultsCompatibility,
  inspectCompatibility,
  onCommitted,
  renderFullEditor,
}: DefaultsEditorModalProps): React.ReactElement | null {
  const geometryStore = useGeometryStoreApi();
  const workspaceResourcePort = useGeometryWorkspaceResourcePort();
  const [mode, setMode] = useState<EditorMode>('fabric');
  const [text, setText] = useState('');
  const [baselineText, setBaselineText] = useState('');
  const [defaultsRoot, setDefaultsRoot] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fabricDirty, setFabricDirty] = useState(false);
  const [sessionRevision, setSessionRevision] = useState(0);
  const [compatibility, setCompatibility] = useState(defaultsCompatibility);
  const hasFilePath = filePath.trim().length > 0;
  const loadKey = [isOpen ? 'open' : 'closed', filePath, workspaceResourcePort.availability].join('\0');

  useEffect(() => {
    setCompatibility(defaultsCompatibility);
  }, [defaultsCompatibility, filePath]);

  useEffect(() => {
    setMode('fabric');
    setText('');
    setBaselineText('');
    setDefaultsRoot(null);
    setFabricDirty(false);
    setSaveError(null);
    setSessionRevision((current) => current + 1);

    if (!isOpen || !hasFilePath) {
      setLoading(false);
      setLoadError(hasFilePath ? null : 'No defaults file selected.');
      return undefined;
    }
    if (workspaceResourcePort.availability !== 'available') {
      setLoading(false);
      setLoadError('Workspace resource access is unavailable.');
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void workspaceResourcePort.readText(filePath).then((content) => {
      if (cancelled) return;
      const parsed = parseDefaultsText(content);
      setText(content);
      setBaselineText(content);
      setDefaultsRoot(parsed.root);
      setLoadError(null);
    }).catch((error: unknown) => {
      if (!cancelled) setLoadError(errorMessage(error));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [filePath, hasFilePath, isOpen, loadKey, workspaceResourcePort]);

  const rawParseResult = useMemo(() => parseDefaultsText(text), [text]);
  const rawCompatibility = useMemo(() => {
    if (rawParseResult.error || !inspectCompatibility) return compatibility;
    try {
      return inspectCompatibility(text);
    } catch (error: unknown) {
      return {
        warnings: [`Compatibility check failed: ${errorMessage(error)}`],
        foundTypes: [],
        hasRequiredRootSections: false,
      };
    }
  }, [compatibility, inspectCompatibility, rawParseResult.error, text]);
  const dirty = mode === 'fabric' ? fabricDirty : text !== baselineText;

  const confirmDiscard = useCallback((): boolean => (
    !dirty
    || typeof window === 'undefined'
    || window.confirm('Discard unsaved defaults changes?')
  ), [dirty]);

  const resetToBaseline = useCallback(() => {
    const parsed = parseDefaultsText(baselineText);
    setText(baselineText);
    setDefaultsRoot(parsed.root);
    setLoadError(null);
    setFabricDirty(false);
    setSessionRevision((current) => current + 1);
  }, [baselineText]);

  const changeMode = useCallback((nextMode: EditorMode) => {
    if (nextMode === mode) return;
    if (!confirmDiscard()) return;
    if (dirty) resetToBaseline();
    setMode(nextMode);
  }, [confirmDiscard, dirty, mode, resetToBaseline]);

  const persist = useCallback(async (merged: unknown, format: SaveFormat) => {
    setSaving(true);
    setSaveError(null);
    try {
      if (workspaceResourcePort.availability !== 'available') {
        throw new Error('Workspace resource access is unavailable.');
      }
      const formatted = format === 'raw'
        ? `${JSON.stringify(merged, null, 2)}\n`
        : JSON.stringify(merged, null, 2);
      const nextCompatibility = inspectCompatibility
        ? inspectCompatibility(formatted)
        : compatibility;
      await workspaceResourcePort.writeText(filePath, formatted);
      const state = geometryStore.getState();
      if ((state.defaultsPath || '').trim() === filePath.trim()) {
        state.setDefaultsJson(merged);
      }
      setText(formatted);
      setBaselineText(formatted);
      setDefaultsRoot(merged);
      setCompatibility(nextCompatibility);
      setFabricDirty(false);
      setSessionRevision((current) => current + 1);
      onCommitted?.(merged, nextCompatibility);
    } catch (error: unknown) {
      setSaveError(errorMessage(error));
      throw error;
    } finally {
      setSaving(false);
    }
  }, [compatibility, filePath, geometryStore, inspectCompatibility, onCommitted, workspaceResourcePort]);

  const handleRawSave = useCallback(async () => {
    if (!isRecord(rawParseResult.root) || rawParseResult.error) return;
    try {
      await persist(rawParseResult.root, 'raw');
    } catch {
      // The session-level save error is rendered below the raw editor.
    }
  }, [persist, rawParseResult.error, rawParseResult.root]);

  const handleClose = useCallback(() => {
    if (confirmDiscard()) onClose();
  }, [confirmDiscard, onClose]);

  if (!isOpen || typeof window === 'undefined') return null;

  // Official retains its established editor surface. Community always uses the
  // shared session below, so its structured and raw paths cannot double-load.
  if (mode === 'raw' && renderFullEditor) {
    return <>{renderFullEditor({ filePath, onClose: handleClose, compatibility })}</>;
  }

  const baseName = filePath.split('/').pop()?.replace(/\.json$/i, '') || filePath;
  const warnings = (mode === 'raw' ? rawCompatibility : compatibility)?.warnings ?? [];

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
        aria-label={`Defaults — ${baseName}`}
        onClick={(event) => event.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'min(88vh, 920px)',
          width: mode === 'raw' ? 'min(920px, 96vw)' : 'min(760px, 94vw)',
        }}
      >
        <ModalHeader
          title={`${mode === 'fabric' ? 'Fabric defaults' : 'Full defaults JSON'} — ${baseName}`}
          onClose={handleClose}
        />
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            aria-pressed={mode === 'fabric'}
            onClick={() => changeMode('fabric')}
          >
            Fabric defaults
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            aria-pressed={mode === 'raw'}
            onClick={() => changeMode('raw')}
          >
            Edit full JSON <span style={{ opacity: 0.85 }}>(Advanced)</span>
          </button>
        </div>
        {warnings.length > 0 ? (
          <div role="status" style={{ color: 'var(--warning-text)', fontSize: 12 }}>
            <strong>Compatibility warnings</strong>
            <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </div>
        ) : null}
        {mode === 'fabric' ? (
          <FabricDefaultsEditorPanel
            filePath={filePath}
            defaultsRoot={defaultsRoot}
            loading={loading}
            loadError={loadError}
            sessionRevision={sessionRevision}
            onSave={(merged) => persist(merged, 'fabric')}
            onDirtyChange={setFabricDirty}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {loadError ? <p className="error-text">{loadError}</p> : null}
            {saveError ? <p className="error-text">{saveError}</p> : null}
            {!loading && rawParseResult.error ? <p className="error-text">{rawParseResult.error}</p> : null}
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
              <button type="button" className="btn btn-ghost" onClick={() => changeMode('fabric')}>
                Back to fabric defaults
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!dirty || !!rawParseResult.error || loading || saving}
                onClick={() => void handleRawSave()}
              >
                {saving ? 'Saving…' : 'Save full defaults'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
