// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useState, type ReactNode } from 'react';
import type { GlobalSettingsDefaultsCompatibility } from './GlobalSettingsModal';
import { DefaultsJsonEditorModal } from './DefaultsJsonEditorModal';
import { FabricDefaultsModal } from './FabricDefaultsModal';

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

/** One canonical fabric-first defaults editor shared by Community and Official. */
export function DefaultsEditorModal({
  isOpen,
  filePath,
  onClose,
  defaultsCompatibility,
  inspectCompatibility,
  onCommitted,
  renderFullEditor,
}: DefaultsEditorModalProps): React.ReactElement | null {
  const [mode, setMode] = useState<'fabric' | 'full'>('fabric');
  const [compatibility, setCompatibility] = useState(defaultsCompatibility);

  if (!isOpen) return null;

  const handleClose = () => {
    setMode('fabric');
    onClose();
  };

  if (mode === 'full') {
    if (renderFullEditor) {
      return (
        <>
          {renderFullEditor({
            filePath,
            onClose: handleClose,
            compatibility,
          })}
        </>
      );
    }
    return (
      <DefaultsJsonEditorModal
        isOpen
        filePath={filePath}
        onClose={handleClose}
        onBackToFabric={() => setMode('fabric')}
        inspectCompatibility={inspectCompatibility}
        initialCompatibility={compatibility}
        onCommitted={(merged, nextCompatibility) => {
          setCompatibility(nextCompatibility);
          onCommitted?.(merged, nextCompatibility);
        }}
      />
    );
  }

  return (
    <FabricDefaultsModal
      isOpen
      filePath={filePath}
      onClose={handleClose}
      onSwitchToFullJsonEditor={() => setMode('full')}
      defaultsCompatibility={compatibility}
      onCommitted={(merged) => {
        const nextCompatibility = inspectCompatibility
          ? inspectCompatibility(JSON.stringify(merged))
          : compatibility;
        setCompatibility(nextCompatibility);
        onCommitted?.(merged, nextCompatibility);
      }}
    />
  );
}
