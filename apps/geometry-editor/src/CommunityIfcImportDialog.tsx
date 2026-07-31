// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  IFC_IMPORT_LIMITS,
  IfcImportError,
  type IfcImportMode,
  type IfcImportProgress,
  type LocalIfcImportAdapter,
  type PortableGeometryDocument,
} from '../../../packages/geometry-document/src';
import { useKeyedState } from '../../../packages/geometry-editor/src/hooks/useKeyedState';
import {
  createCommunityIfcImporter,
} from './communityIfcConverter';
import './CommunityIfcImportDialog.css';

export type CommunityIfcImportDialogProps = Readonly<{
  isOpen: boolean;
  adapter?: LocalIfcImportAdapter;
  onImport(document: PortableGeometryDocument): void | Promise<void>;
  onClose(): void;
}>;

type ImportStatus = 'idle' | 'importing' | 'error';

const PROGRESS_LABELS: Readonly<Record<IfcImportProgress['phase'], string>> =
  Object.freeze({
    runtime: 'Preparing local Python runtime',
    dependencies: 'Loading local conversion packages',
    parser: 'Loading IFC parser',
    'source-read': 'Reading IFC file',
    conversion: 'Converting IFC geometry',
    'floors-roofs': 'Floors and roofs',
    walls: 'Walls',
    windows: 'Windows',
    doors: 'Doors',
    spaces: 'Spaces',
    assembly: 'Assembling model',
    csv: 'Creating geometry CSV',
  });

function messageFromUnknown(error: unknown): string {
  if (error instanceof IfcImportError && error.code === 'cancelled') {
    return 'IFC import was cancelled';
  }
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : 'IFC import failed';
}

function progressLabel(progress: IfcImportProgress): string {
  const label = PROGRESS_LABELS[progress.phase];
  return progress.current === undefined || progress.total === undefined
    ? label
    : `${label} ${progress.current} of ${progress.total}`;
}

function validateFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.ifc')) {
    return 'Choose a file with the .ifc extension.';
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return 'The IFC file is empty.';
  }
  if (file.size > IFC_IMPORT_LIMITS.maximumSourceBytes) {
    return 'The IFC file exceeds the 256 MB import limit.';
  }
  return null;
}

function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
      } else {
        reject(new Error('The IFC file did not return bytes'));
      }
    }, { once: true });
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('The IFC file could not be read'));
    }, { once: true });
    reader.readAsArrayBuffer(file);
  });
}

export function CommunityIfcImportDialog({
  isOpen,
  adapter,
  onImport,
  onClose,
}: CommunityIfcImportDialogProps) {
  const [ownedImporter] = useState(() => createCommunityIfcImporter());
  const activeAdapter = adapter ?? ownedImporter;
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<IfcImportMode>('internal');
  const [delayeringEnabled, setDelayeringEnabled] = useState(true);
  const [wallThickness, setWallThickness] = useState('0.2');
  const openStateKey = isOpen ? 'open' : 'closed';
  const [status, setStatus] = useKeyedState<ImportStatus>(openStateKey, 'idle');
  const [progress, setProgress] = useKeyedState<IfcImportProgress | null>(openStateKey, null);
  const [error, setError] = useKeyedState<string | null>(openStateKey, null);

  useEffect(() => () => {
    abortRef.current?.abort();
    ownedImporter.dispose();
  }, [ownedImporter]);

  useEffect(() => {
    if (isOpen) return;
    abortRef.current?.abort();
    abortRef.current = null;
  }, [isOpen]);

  if (!isOpen) return null;

  const parsedWallThickness = Number(wallThickness);
  const wallThicknessIsValid = mode !== 'external' || (
    Number.isFinite(parsedWallThickness)
    && parsedWallThickness >= 0.01
    && parsedWallThickness <= 10
  );
  const fileError = file === null ? null : validateFile(file);
  const canImport = file !== null
    && fileError === null
    && wallThicknessIsValid
    && status !== 'importing';

  const selectMode = (nextMode: IfcImportMode): void => {
    setMode(nextMode);
    setDelayeringEnabled(nextMode !== 'raw');
  };

  const selectFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
    setError(nextFile === null ? null : validateFile(nextFile));
    setProgress(null);
    setStatus('idle');
  };

  const close = (): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    onClose();
  };

  const beginImport = async (): Promise<void> => {
    if (file === null || !canImport || activeAdapter === null) return;
    const selectedFile = file;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('importing');
    setError(null);
    setProgress({ phase: 'runtime' });
    try {
      const document = await activeAdapter.importDocument({
        source: Object.freeze({
          fileName: selectedFile.name,
          byteLength: selectedFile.size,
          async readBytes() {
            return readFileBytes(selectedFile);
          },
        }),
        mode,
        delayeringEnabled,
        ...(mode === 'external'
          ? { wallThicknessMetres: parsedWallThickness }
          : {}),
        signal: controller.signal,
        onProgress: setProgress,
      });
      await onImport(document);
      setStatus('idle');
      onClose();
    } catch (cause) {
      if (controller.signal.aborted) {
        setStatus('idle');
        setError(null);
      } else {
        setStatus('error');
        setError(messageFromUnknown(cause));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  return (
    <div className="community-ifc-backdrop">
      <section
        aria-labelledby="community-ifc-title"
        aria-modal="true"
        className="community-ifc-dialog"
        role="dialog"
      >
        <header className="community-ifc-header">
          <div>
            <h2 id="community-ifc-title">Import IFC</h2>
            <span className="community-ifc-experimental">Experimental</span>
          </div>
          <button
            aria-label="Close IFC import"
            className="community-ifc-close"
            disabled={status === 'importing'}
            onClick={close}
            type="button"
          >
            ×
          </button>
        </header>

        <p>
          Convert an IFC4 model into an editable Vulcan geometry document.
          Internal dimensions are recommended for simple room-space models.
        </p>

        <aside className="community-ifc-disclosure">
          <strong>Runs locally in your browser.</strong> The first import
          downloads Pyodide 0.28.0a3 and Python packages from cdn.jsdelivr.net,
          then loads the fixed same-origin IFC parser and wheel. The CDN sees
          ordinary request metadata such as your IP address and browser user
          agent. Your IFC file bytes stay in this browser and are not uploaded
          for conversion.
        </aside>

        <label className="community-ifc-field">
          <span>IFC file</span>
          <input accept=".ifc,model/ifc" onChange={selectFile} type="file" />
        </label>
        {fileError !== null ? (
          <p className="community-ifc-error" role="alert">{fileError}</p>
        ) : null}

        <fieldset className="community-ifc-modes">
          <legend>Model dimensions</legend>
          <label>
            <input
              checked={mode === 'internal'}
              name="community-ifc-mode"
              onChange={() => selectMode('internal')}
              type="radio"
            />
            <span>
              <strong>Internal dimensions</strong>
              <small>Recommended for modelled internal spaces.</small>
            </span>
          </label>
          <label>
            <input
              aria-label="External dimensions"
              checked={mode === 'external'}
              name="community-ifc-mode"
              onChange={() => selectMode('external')}
              type="radio"
            />
            <span>
              <strong>External dimensions</strong>
              <small>Offsets walls using the thickness below.</small>
            </span>
          </label>
          <label>
            <input
              checked={mode === 'raw'}
              name="community-ifc-mode"
              onChange={() => selectMode('raw')}
              type="radio"
            />
            <span>
              <strong>Raw IFC objects</strong>
              <small>Uses exported IFC wall, slab and opening objects.</small>
            </span>
          </label>
        </fieldset>

        {mode === 'external' ? (
          <label className="community-ifc-field">
            <span>Wall thickness (metres)</span>
            <input
              aria-label="Wall thickness (metres)"
              max="10"
              min="0.01"
              onChange={(event) => setWallThickness(event.target.value)}
              step="0.01"
              type="number"
              value={wallThickness}
            />
          </label>
        ) : null}

        <label className="community-ifc-checkbox">
          <input
            checked={delayeringEnabled}
            onChange={(event) => setDelayeringEnabled(event.target.checked)}
            type="checkbox"
          />
          Simplify layered walls for geometry editing
        </label>

        <p className="community-ifc-retention">
          The conversion audit is retained in the document. The original IFC
          is retained too; when downloading a portable .vulcan file, you choose
          whether to include it.
        </p>

        {progress !== null ? (
          <p aria-live="polite" className="community-ifc-progress">
            {progressLabel(progress)}
          </p>
        ) : null}
        {error !== null ? (
          <p className="community-ifc-error" role="alert">{error}</p>
        ) : null}

        <footer className="community-ifc-actions">
          <button
            className="community-ifc-secondary"
            onClick={close}
            type="button"
          >
            {status === 'importing' ? 'Cancel import' : 'Cancel'}
          </button>
          <button
            className="community-ifc-primary"
            disabled={!canImport}
            onClick={() => void beginImport()}
            type="button"
          >
            Import IFC
          </button>
        </footer>
      </section>
    </div>
  );
}
