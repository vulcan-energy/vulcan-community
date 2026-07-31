#!/usr/bin/env tsx
// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Audit canonical Community field presentations.
 *
 * Fields are discovered from the same concrete Core/FHS schemas rendered by
 * the editor. Units, descriptions, conflicts, and diagnostics all come from
 * resolveFieldPresentation via modelAuthoringFieldAudit; this script has no
 * independent field/unit registry.
 *
 * Usage:
 *   npx tsx scripts/audit-tooltip-descriptions.ts
 *   npx tsx scripts/audit-tooltip-descriptions.ts --schema core
 *   npx tsx scripts/audit-tooltip-descriptions.ts --json
 */

import coreSchema from '../data/schemas/core-input.schema.json';
import fhsSchema from '../data/schemas/input_fhs.schema.json';
import {
  canonicalGeometrySchemaPort,
  configureGeometrySchemaAssetSource,
  resetGeometrySchemaAssetsForTests,
} from '../packages/geometry-editor/src/lib/geometrySchemaPort';
import {
  collectVisibleModelAuthoringNumericFields,
  fieldPresentationGapDiagnostics,
  MODEL_AUTHORING_FIELD_CONFIGURATIONS,
} from '../packages/geometry-editor/src/lib/modelAuthoringFieldAudit';

function argumentValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

async function main(): Promise<void> {
  const requestedMode = argumentValue('--schema')?.toLowerCase();
  if (requestedMode && requestedMode !== 'core' && requestedMode !== 'fhs' && requestedMode !== 'all') {
    throw new Error(`Unsupported --schema ${requestedMode}; expected core, fhs, or all.`);
  }

  configureGeometrySchemaAssetSource({
    loadText: async (mode) => JSON.stringify(mode === 'fhs' ? fhsSchema : coreSchema),
  });
  await Promise.all([
    canonicalGeometrySchemaPort.preload('core'),
    canonicalGeometrySchemaPort.preload('fhs'),
  ]);

  const configurations = MODEL_AUTHORING_FIELD_CONFIGURATIONS.filter(
    ({ mode }) => !requestedMode || requestedMode === 'all' || mode === requestedMode,
  );
  const fields = collectVisibleModelAuthoringNumericFields(
    canonicalGeometrySchemaPort,
    configurations,
  );
  const gaps = fieldPresentationGapDiagnostics(fields);
  const unitResolutionSources = Object.fromEntries(
    Array.from(fields.reduce((counts, { presentation }) => {
      const key = presentation.unit.status === 'resolved'
        ? presentation.unit.source
        : presentation.unit.status;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map<string, number>()).entries()).sort(([left], [right]) => left.localeCompare(right)),
  );
  const missingDescriptions = fields
    .filter(({ presentation }) => !presentation.description?.trim())
    .map(({ configuration, propertyPath, presentation }) => [
      `mode=${configuration.mode}`,
      `type=${configuration.elementType}`,
      `subtype=${configuration.subtype ?? '-'}`,
      `path=${propertyPath}`,
      `metadata=${presentation.overrideMetadata?.key ?? presentation.schemaInfo?.source ?? '-'}`,
    ].join(' '))
    .sort((a, b) => a.localeCompare(b));

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({
      configurations: configurations.length,
      numericFields: fields.length,
      unitResolutionSources,
      unitGaps: gaps,
      missingDescriptions,
    }, null, 2)}\n`);
  } else {
    process.stdout.write([
      `Community field presentation audit: ${fields.length} numeric fields across ${configurations.length} configurations`,
      `Unit sources: ${Object.entries(unitResolutionSources).map(([source, count]) => `${source}=${count}`).join(', ')}`,
      `Unit gaps/conflicts: ${gaps.length}`,
      ...gaps.map((gap) => `  ${gap}`),
      `Missing descriptions: ${missingDescriptions.length}`,
      ...missingDescriptions.map((gap) => `  ${gap}`),
      '',
    ].join('\n'));
  }

  if (gaps.length > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => resetGeometrySchemaAssetsForTests());
