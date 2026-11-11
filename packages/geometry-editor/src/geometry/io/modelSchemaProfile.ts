// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { targetSchemaMode, type GeometrySchemaMode } from '../../../../geometry-editor-host/src/schemaPort';

export type ModelSchemaProfile = 'input_fhs' | 'ecaas_input_fhs';

export function parseSchemaProfileMetadata(
  raw: string | undefined,
): ModelSchemaProfile | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;
  if (value === 'ecaas_input_fhs' || value === 'ecaas_only') return 'ecaas_input_fhs';
  if (value === 'input_fhs' || value === 'standard_fhs') return 'input_fhs';
  return undefined;
}

export function modelSchemaProfileMetadataValue(
  profile: ModelSchemaProfile,
): string {
  return profile;
}

/**
 * The model type of a CSV for the tools with no target catalogue: the community CLI and editor, and
 * support validation. It is the target's (targetSchemaMode). Only an unpinned CSV with a
 * ComplianceValidationEnabled row of FALSE is core: the community CLI's core mode.
 */
export function csvModelProfile(
  targetBundleId: string | undefined,
  complianceValidationCell: string | undefined,
): GeometrySchemaMode {
  return !targetBundleId && /^FALSE$/i.test(complianceValidationCell ?? '') ? 'core' : targetSchemaMode();
}
