// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { useMemo } from 'react';
import { useGeometrySchemaPort } from '../../../geometry-editor-host/src/editorServicePorts';
import { targetRules, type TargetRules } from '../../../geometry-editor-host/src/schemaPort';
import { targetValidationFlags } from '../geometry/validation/validateElement';
import { useGeometryStore } from '../stores/geometryStore';

/** The selected target's rules for the model's own settings. */
export function useTargetRules(): TargetRules {
  const schemaPort = useGeometrySchemaPort();
  const modelSettings = useGeometryStore((s) => s.complianceSettings);
  return useMemo(() => targetRules(schemaPort, modelSettings), [schemaPort, modelSettings]);
}

/** {@link targetValidationFlags} for the mounted editor. */
export function useTargetValidationFlags(): ReturnType<typeof targetValidationFlags> {
  const schemaPort = useGeometrySchemaPort();
  const modelSettings = useGeometryStore((s) => s.complianceSettings);
  return useMemo(() => targetValidationFlags(schemaPort, modelSettings), [schemaPort, modelSettings]);
}
