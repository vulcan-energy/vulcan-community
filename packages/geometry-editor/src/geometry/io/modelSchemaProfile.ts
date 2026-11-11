// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

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
 * The model type of a parsed CSV for the tools that have no target catalogue: the community CLI and
 * editor, and support validation. A CSV with no TargetBundleId is the HEM 1.0.0a7 target, an FHS
 * model, and every pinned target is an FHS target today. A ComplianceValidationEnabled row of FALSE
 * is the community core mode. A new model type, such as EPC, is decided here.
 */
export function csvModelProfile(complianceValidationCell: string | undefined): 'core' | 'fhs' {
  return /^FALSE$/i.test(complianceValidationCell ?? '') ? 'core' : 'fhs';
}
