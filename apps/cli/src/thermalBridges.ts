// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Automatic thermal bridges and thermal-bridge validation for a geometry CSV,
// using the editor's per-junction proposers and `findLinearThermalBridgeIssues()`.
//
// `autoThermalBridges` generates `Zone.ThermalBridging` proposals; `--csv-section`
// prints them as a "Thermal Bridging Elements" section ready to paste into the CSV.
// `validateThermalBridges` checks existing ThermalBridgeLinear rows; with
// `includeAuto` it first synthesizes the new auto proposals as rows, matching the
// add-selected modal path closely enough to diagnose validator issues before
// mutating the CSV.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { unavailableGeometrySchemaPort } from '../../../packages/geometry-editor-host/src/schemaPort';
import { parseCsvToGeometry } from '../../../packages/geometry-editor/src/geometry/io/parseCsvToGeometry';
import type { Element, Floor, ThermalBridgeLinear } from '../../../packages/geometry-editor/src/geometry/types';
import { validateElementCore } from '../../../packages/geometry-editor/src/geometry/validation/validateElement';
import type { ValidationIssue } from '../../../packages/geometry-editor/src/geometry/validation/types';
import { proposeAutoThermalBridges } from '../../../packages/geometry-editor/src/geometry/thermalBridge/autoThermalBridgePipeline';
import {
  annotateProposalsWithDedupe,
  type FacadeOpeningTbProposal,
} from '../../../packages/geometry-editor/src/geometry/thermalBridge/proposeFacadeOpenings';
import {
  findLinearThermalBridgeIssues,
  type LinearThermalBridgeIssue,
} from '../../../packages/geometry-editor/src/geometry/thermalBridge/findLinearThermalBridgeIssues';
import {
  getEffectiveLinearPsiForFacadeProposal,
  VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY,
} from '../../../packages/geometry-editor/src/geometry/thermalBridge/linearTbPsi';
import {
  resolveFloorStoreyIndexForAutoTbFromHostZ,
  thermalBridgeSourceExtraJsonForAutoProposal,
} from '../../../packages/geometry-editor/src/geometry/thermalBridge/resolveTbHostFloorId';
import { THERMAL_BRIDGE_EXTRA_JSON_FLOOR_ID_KEY } from '../../../packages/geometry-editor/src/lib/elementCanvasFloor';
import { editorFloorsAndElementsForParsedCsv } from '../../../packages/geometry-editor/src/lib/floorDerivation';

interface ElementValidationRow {
  elementId: string;
  name: string;
  junctionType: string | undefined;
  issues: ValidationIssue[];
  warnings: ValidationIssue[];
}

export type ThermalBridgeValidationResult = ReturnType<typeof validateThermalBridges>;

function byId(elements: readonly Element[]): Record<string, Element> {
  return Object.fromEntries(elements.map((element) => [element.id, element])) as Record<string, Element>;
}

function loadGeometry(csvPath: string) {
  const parsed = parseCsvToGeometry(readFileSync(csvPath, 'utf-8'));
  const { floors, elements } = editorFloorsAndElementsForParsedCsv(parsed);
  return { parsed, elements, floors, elementsById: byId(elements) };
}

function proposalsWithEffectivePsi(
  elements: Element[],
  floors: Floor[] | undefined,
  elementsById: Record<string, Element>,
) {
  return proposeAutoThermalBridges(elements, floors).map((proposal) => ({
    ...proposal,
    linearThermalTransmittance: getEffectiveLinearPsiForFacadeProposal(proposal, null, elementsById),
  }));
}

export function autoThermalBridges(csvArg: string) {
  const csvPath = resolve(csvArg);
  const { elements, floors, elementsById } = loadGeometry(csvPath);
  return { csvPath, elementsById, proposals: proposalsWithEffectivePsi(elements, floors, elementsById) };
}

export function printAutoCsvSection({ proposals, elementsById }: ReturnType<typeof autoThermalBridges>): void {
  console.log('Thermal Bridging Elements,,,,,,,,,,,');
  console.log('Name,Zone,Type,linear_thermal_transmittance,length,junction_type,heat_transfer_coefficient,parent_element,coords,extra_json');
  let i = 0;
  for (const p of proposals) {
    i++;
    const name = `Auto_TB_${i}`;
    const coords = p.coordinates
      .map((c) => `${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)}`)
      .join('|');
    const src = thermalBridgeSourceExtraJsonForAutoProposal(p, elementsById);
    const extraJson = src
      ? `"${JSON.stringify({ thermal_bridge_source: src }).replace(/"/g, '""')}"`
      : '';
    console.log(
      [
        name,
        p.zoneId ?? '',
        'ThermalBridgeLinear',
        p.linearThermalTransmittance.toFixed(4),
        p.suggestedLengthM.toFixed(3),
        p.junctionCode,
        '',
        p.parentElementForTb ?? '',
        `"${coords}"`,
        extraJson,
      ].join(','),
    );
  }
}

export function printAutoSummary({ csvPath, proposals }: ReturnType<typeof autoThermalBridges>): void {
  const summary: Record<string, { count: number; totalL: number; totalPsiL: number; psiUnique: Set<number> }> = {};
  for (const p of proposals) {
    const code = p.junctionCode;
    if (!summary[code]) summary[code] = { count: 0, totalL: 0, totalPsiL: 0, psiUnique: new Set() };
    summary[code].count++;
    summary[code].totalL += p.suggestedLengthM;
    summary[code].totalPsiL += p.suggestedLengthM * p.linearThermalTransmittance;
    summary[code].psiUnique.add(Number(p.linearThermalTransmittance.toFixed(4)));
  }

  const rows = Object.entries(summary).sort(([a], [b]) => a.localeCompare(b));
  console.log(`# Auto-TB summary for ${csvPath}`);
  console.log(`# ${proposals.length} junctions across ${rows.length} junction types`);
  console.log('');
  console.log('Code | Count | ΣL (m) | ψ used | Σ ψ·L (W/K)');
  console.log('-----|------:|------:|--------|----------:');
  let total = 0;
  for (const [code, s] of rows) {
    total += s.totalPsiL;
    const psiList = [...s.psiUnique].map((v) => v.toFixed(3)).join(', ');
    console.log(`${code.padEnd(5)}| ${String(s.count).padStart(5)} | ${s.totalL.toFixed(2).padStart(6)} | ${psiList.padEnd(6)} | ${s.totalPsiL.toFixed(4).padStart(10)}`);
  }
  console.log('');
  console.log(`Total Σ ψ·L = ${total.toFixed(4)} W/K`);
}

function autoProposalToThermalBridge(
  row: FacadeOpeningTbProposal,
  index: number,
  elementsById: Record<string, Element>,
  floors: Floor[],
): ThermalBridgeLinear | null {
  const zoneId =
    row.zoneId ??
    (row.openingId ? (elementsById[row.openingId] as { zoneId?: string } | undefined)?.zoneId : undefined);
  if (!zoneId) return null;

  const parentElement =
    row.parentElementForTb !== undefined &&
    row.parentElementForTb !== null &&
    String(row.parentElementForTb).trim() !== ''
      ? String(row.parentElementForTb).trim()
      : row.openingName;

  const floorStorey =
    row.floorStoreyIndexForTb ??
    resolveFloorStoreyIndexForAutoTbFromHostZ(
      {
        openingId: row.openingId,
        zoneId: row.zoneId,
        parentElementForTb: row.parentElementForTb,
      },
      elementsById,
      floors,
    );

  const extraJson: Record<string, unknown> = { junction_type: row.junctionCode };
  if (floorStorey !== undefined) {
    extraJson[THERMAL_BRIDGE_EXTRA_JSON_FLOOR_ID_KEY] = floorStorey;
  }

  const src = thermalBridgeSourceExtraJsonForAutoProposal(
    {
      openingId: row.openingId,
      zoneId: row.zoneId,
      parentElementForTb: row.parentElementForTb,
      cornerHostWallIds: row.cornerHostWallIds,
      hostElementIds: row.hostElementIds,
      roofAdjacentPairIds: row.roofAdjacentPairIds,
    },
    elementsById,
  );
  if (src) {
    extraJson.thermal_bridge_source = src;
  }

  if (
    row.edgeRole === 'e7_party_floor_external' ||
    row.edgeRole === 'party_wall_junction' ||
    row.edgeRole === 'unheated_adjacent_wall_junction' ||
    row.edgeRole === 'party_to_external_e18' ||
    row.edgeRole === 'party_wall_to_sloped_roof' ||
    row.edgeRole === 'party_wall_to_flat_roof' ||
    row.edgeRole === 'sloped_roof_to_adjacent_wall_r8_r9'
  ) {
    extraJson[VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY] = row.openingId;
  }

  return {
    id: `auto-tb-${index}`,
    name: `Auto_TB_${index}`,
    type: 'ThermalBridgeLinear',
    zoneId,
    length: row.suggestedLengthM,
    linear_thermal_transmittance: getEffectiveLinearPsiForFacadeProposal(row, null, elementsById),
    parent_element: parentElement,
    coordinates: [row.coordinates[0], row.coordinates[1]],
    extra_json: extraJson,
    isPlaceholder: false,
  };
}

function issuesByKind(issues: readonly LinearThermalBridgeIssue[]): Record<string, number> {
  return issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.kind] = (acc[issue.kind] ?? 0) + 1;
    return acc;
  }, {});
}

function thermalBridgeRowsWithValidation(
  elements: readonly Element[],
  zones: ReturnType<typeof parseCsvToGeometry>['zones'],
  floors: Floor[] | undefined,
  linearIssues: readonly LinearThermalBridgeIssue[],
): ElementValidationRow[] {
  const elementsById = byId(elements);
  return elements
    .filter((element): element is ThermalBridgeLinear => element.type === 'ThermalBridgeLinear' && !element.isPlaceholder)
    .map((element) => {
      const validation = validateElementCore(element, {
        schemaPort: unavailableGeometrySchemaPort,
        elementsById,
        zones,
        floors,
        linearThermalBridgeIssues: linearIssues,
      });
      return {
        elementId: element.id,
        name: element.name || element.id,
        junctionType:
          typeof element.extra_json?.junction_type === 'string'
            ? element.extra_json.junction_type
            : undefined,
        issues: validation.issues,
        warnings: validation.warnings,
      };
    });
}

export function validateThermalBridges(csvArg: string, includeAuto: boolean) {
  const csvPath = resolve(csvArg);
  const { parsed, elements: originalElements, floors, elementsById } = loadGeometry(csvPath);
  let elements = originalElements;

  if (includeAuto) {
    const proposals = proposalsWithEffectivePsi(originalElements, floors, elementsById);
    const newProposals = annotateProposalsWithDedupe(proposals, originalElements)
      .filter((proposal) => proposal.status === 'new');
    const synthetic = newProposals
      .map((proposal, index) => autoProposalToThermalBridge(proposal, index + 1, elementsById, floors))
      .filter((tb): tb is ThermalBridgeLinear => tb !== null);
    elements = [...originalElements, ...synthetic];
  }

  const issues = findLinearThermalBridgeIssues(elements, floors);
  const validationRows = thermalBridgeRowsWithValidation(elements, parsed.zones, floors, issues);

  return {
    csvPath,
    includeAuto,
    elements: elements.length,
    thermalBridgeLinearRows: elements.filter(
      (element) => element.type === 'ThermalBridgeLinear' && !element.isPlaceholder,
    ).length,
    issueCount: issues.length,
    issuesByKind: issuesByKind(issues),
    issues,
    validationRows,
  };
}

export function printValidationSummary(result: ThermalBridgeValidationResult): void {
  const { csvPath, includeAuto, issues: linearIssues, validationRows } = result;
  const issueRows = validationRows.filter((row) => row.issues.length > 0);
  const warningRows = validationRows.filter((row) => row.warnings.length > 0);
  console.log(`# Thermal-bridge validation for ${csvPath}`);
  console.log(`# Mode: ${includeAuto ? 'existing CSV + auto proposals' : 'existing CSV only'}`);
  console.log(
    `# ${result.thermalBridgeLinearRows} ThermalBridgeLinear rows, ${linearIssues.length} linear issue(s), ` +
      `${issueRows.length} row(s) with validator issues, ` +
      `${warningRows.length} row(s) with validator warnings`,
  );

  if (linearIssues.length === 0 && issueRows.length === 0 && warningRows.length === 0) {
    console.log('');
    console.log('No thermal-bridge issues found.');
    return;
  }

  if (linearIssues.length > 0) {
    console.log('');
    console.log('Linear Issue Kind | Severity | Count');
    console.log('------------------|----------|------:');
    const grouped = new Map<string, { severity: string; count: number }>();
    for (const issue of linearIssues) {
      const key = `${issue.kind}|${issue.severity}`;
      const existing = grouped.get(key);
      if (existing) existing.count++;
      else grouped.set(key, { severity: issue.severity, count: 1 });
    }
    for (const [key, row] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const kind = key.split('|')[0]!;
      console.log(`${kind} | ${row.severity} | ${row.count}`);
    }

    console.log('');
    console.log('Element | Junction | Kind | Message');
    console.log('--------|----------|------|--------');
    for (const issue of linearIssues) {
      console.log(`${issue.name} | ${issue.junctionType ?? ''} | ${issue.kind} | ${issue.message}`);
    }
  }

  if (issueRows.length > 0 || warningRows.length > 0) {
    console.log('');
    console.log('Validator Row | Junction | Level | Message');
    console.log('--------------|----------|-------|--------');
    for (const row of validationRows) {
      for (const issue of row.issues) {
        console.log(`${row.name} | ${row.junctionType ?? ''} | issue | ${issue.message}`);
      }
      for (const warning of row.warnings) {
        console.log(`${row.name} | ${row.junctionType ?? ''} | warning | ${warning.message}`);
      }
    }
  }
}
