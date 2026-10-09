// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Validates a geometry CSV with the same pure validators the editor uses.

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { unavailableGeometrySchemaPort } from '../../../packages/geometry-editor-host/src/schemaPort';
import { parseCsvToGeometry } from '../../../packages/geometry-editor/src/geometry/io/parseCsvToGeometry';
import type { Element, SpaceLabel, Zone } from '../../../packages/geometry-editor/src/geometry/types';
import { detectMissingElements } from '../../../packages/geometry-editor/src/geometry/validation/detectMissingElements';
import { findLinearThermalBridgeIssues } from '../../../packages/geometry-editor/src/geometry/thermalBridge/findLinearThermalBridgeIssues';
import { selectPartFData } from '../../../packages/geometry-editor/src/geometry/validation/partF/index';
import { validateElementCore } from '../../../packages/geometry-editor/src/geometry/validation/validateElement';
import { validateZone } from '../../../packages/geometry-editor/src/geometry/validation/validateZone';
import type { MissingElement, ValidationIssue } from '../../../packages/geometry-editor/src/geometry/validation/types';
import { collectGlobalSettingsWarnings } from '../../../packages/geometry-editor/src/lib/globalSettingsValidation';
import { editorFloorsAndElementsForParsedCsv } from '../../../packages/geometry-editor/src/lib/floorDerivation';

export type FailOn = 'none' | 'critical' | 'warning';
type Severity = 'critical' | 'warning';

interface ValidationRow {
  severity: Severity;
  subject: 'element' | 'zone' | 'global';
  name: string;
  type?: string;
  source: ValidationIssue['source'];
  fieldKey?: string;
  message: string;
}

export type CheckResult = ReturnType<typeof checkGeometryCsv>;

function elementsById(elements: readonly Element[]): Record<string, Element> {
  return Object.fromEntries(elements.map((element) => [element.id, element])) as Record<string, Element>;
}

function spaceLabelsById(spaceLabels: readonly SpaceLabel[]): Record<string, SpaceLabel> {
  return Object.fromEntries(spaceLabels.map((label) => [label.id, label])) as Record<string, SpaceLabel>;
}

function pushRowsForIssues(
  rows: ValidationRow[],
  issues: readonly ValidationIssue[],
  base: Omit<ValidationRow, 'severity' | 'source' | 'fieldKey' | 'message'>,
  severity: Severity,
): void {
  for (const issue of issues) {
    rows.push({
      ...base,
      severity,
      source: issue.source,
      fieldKey: issue.fieldKey,
      message: issue.message,
    });
  }
}

function summarizeRows(rows: readonly ValidationRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.message}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function formatRow(row: ValidationRow): string {
  const field = row.fieldKey ? ` field=${row.fieldKey}` : '';
  const type = row.type ? ` ${row.type}` : '';
  return `[${row.source}] ${row.subject}${type} "${row.name}"${field}: ${row.message}`;
}

function printRowSection(title: string, rows: readonly ValidationRow[]): void {
  console.log(`${title} (${rows.length})`);
  if (rows.length === 0) {
    console.log('  none');
    return;
  }

  const counts = summarizeRows(rows);
  for (const [message, count] of counts) {
    const suffix = count > 1 ? ` x${count}` : '';
    console.log(`  - ${message}${suffix}`);
  }
  console.log('');
  for (const row of rows) {
    console.log(`    ${formatRow(row)}`);
  }
}

function printMissingElements(rows: readonly MissingElement[]): void {
  console.log(`Missing elements (${rows.length})`);
  if (rows.length === 0) {
    console.log('  none');
    return;
  }
  for (const row of rows) {
    const qualifier = row.pillQualifier ? ` ${row.pillQualifier}` : '';
    const batch = row.batchPlan ? ` batch=${row.batchPlan.drafts.length}` : '';
    console.log(`  - [${row.requiredBy}] ${row.type}${qualifier}${batch}: ${row.message}`);
  }
}

export function checkGeometryCsv(csvArg: string) {
  const csvPath = resolve(csvArg);
  const csv = readFileSync(csvPath, 'utf8');
  const parsed = parseCsvToGeometry(csv);
  // The model as the editor loads it, so connectivity matches the canvas.
  const { floors, elements } = editorFloorsAndElementsForParsedCsv(parsed);
  const allElements = elements.filter((element) => !element.isPlaceholder);
  const byId = elementsById(elements);
  const complianceValidationEnabled =
    parsed.metadata.complianceSettings.complianceValidationEnabled === true;

  const partFData = complianceValidationEnabled
    ? selectPartFData({
        zones: parsed.zones,
        elementsById: byId,
        spaceLabelsById: spaceLabelsById(parsed.spaceLabels),
        spaceLabelIds: parsed.spaceLabels.map((label) => label.id),
        complianceSettings: parsed.metadata.complianceSettings,
        elements,
      })
    : undefined;

  const linearThermalBridgeIssues = findLinearThermalBridgeIssues(elements, floors);
  const rows: ValidationRow[] = [];

  for (const element of allElements) {
    const result = validateElementCore(element, {
      // The CLI has no browser schema-asset provider. Schema-dependent checks
      // therefore skip, matching the existing hosted validation path.
      schemaPort: unavailableGeometrySchemaPort,
      elementsById: byId,
      zones: parsed.zones,
      floors,
      complianceValidationEnabled,
      linearThermalBridgeIssues,
      partFFindings: partFData?.findings ?? [],
    });
    const base = {
      subject: 'element' as const,
      name: element.name || element.id,
      type: element.type,
    };
    pushRowsForIssues(rows, result.issues, base, 'critical');
    pushRowsForIssues(rows, result.warnings, base, 'warning');
  }

  const primaryFhsZoneId = parsed.zones.find((zone) => !zone.isPlaceholder)?.id;
  for (const zone of parsed.zones.filter((candidate): candidate is Zone => !candidate.isPlaceholder)) {
    const result = validateZone(zone, {
      elementsById: byId,
      complianceValidationEnabled,
      primaryFhsZoneId,
    });
    const base = {
      subject: 'zone' as const,
      name: zone.name,
      type: 'Zone',
    };
    pushRowsForIssues(rows, result.issues, base, 'critical');
    pushRowsForIssues(rows, result.warnings, base, 'warning');
  }

  for (const message of collectGlobalSettingsWarnings({
    elements,
    floors,
    complianceSettings: parsed.metadata.complianceSettings,
  })) {
    rows.push({
      severity: 'warning',
      subject: 'global',
      name: 'Compliance settings',
      source: 'geometry',
      message,
    });
  }

  const missingElements = detectMissingElements(
    parsed.zones,
    byId,
    complianceValidationEnabled,
    parsed.metadata.complianceSettings.PartO_active_cooling_required,
    partFData?.context,
    floors,
  );

  const criticalRows = rows.filter((row) => row.severity === 'critical');
  const warningRows = rows.filter((row) => row.severity === 'warning');

  return {
    csvPath,
    relativePath: relative(process.cwd(), csvPath),
    counts: {
      zones: parsed.zones.length,
      elements: allElements.length,
      floors: floors.length,
      spaceLabels: parsed.spaceLabels.length,
      criticalIssues: criticalRows.length,
      warnings: warningRows.length,
      missingElements: missingElements.length,
      partFFindings: partFData?.findings.length ?? 0,
    },
    complianceValidationEnabled,
    partFContext: partFData?.context ?? null,
    partFFindings: partFData?.findings ?? [],
    criticalIssues: criticalRows,
    warnings: warningRows,
    missingElements,
  };
}

export function printCheckSummary(result: CheckResult): void {
  console.log(`Geometry CSV validation: ${result.relativePath || result.csvPath}`);
  console.log(
    `Elements: ${result.counts.elements}, zones: ${result.counts.zones}, floors: ${result.counts.floors}, space labels: ${result.counts.spaceLabels}`,
  );
  console.log(
    `Compliance: ${result.complianceValidationEnabled ? 'enabled' : 'disabled'}, Part F findings: ${result.counts.partFFindings}`,
  );
  console.log('');
  printRowSection('Critical issues', result.criticalIssues);
  console.log('');
  printRowSection('Warnings', result.warnings);
  console.log('');
  printMissingElements(result.missingElements);
  if (result.partFFindings.length > 0) {
    console.log('');
    console.log('Part F findings');
    for (const finding of result.partFFindings) {
      console.log(`  - ${finding.rule}: ${finding.fullMessage}`);
    }
  }
}

export function checkExitCode(result: CheckResult, failOn: FailOn): number {
  const hasCriticalFailure = result.criticalIssues.length > 0 || result.missingElements.length > 0;
  const hasWarningFailure = hasCriticalFailure || result.warnings.length > 0;
  return (failOn === 'critical' && hasCriticalFailure) || (failOn === 'warning' && hasWarningFailure)
    ? 1
    : 0;
}
