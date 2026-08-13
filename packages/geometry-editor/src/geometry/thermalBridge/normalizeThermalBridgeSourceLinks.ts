// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, ThermalBridgeLinear } from '../types';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { proposeAutoThermalBridges } from './autoThermalBridgePipeline';
import { tbPlanAnchorXY } from './linearTbCornerValidation';
import { overlapLengthBetweenSegmentElements } from './linearTbSegmentOverlap';
import {
  E16_E17_CORNER_PLAN_TOL_M,
  DEFAULT_TB_DEDUPE_TOLERANCE_M,
} from './thermalBridgeTolerances';

type CornerJunctionType = 'E16' | 'E17';
type ThermalBridgeSource = { host_wall_id: string; host_wall_b_id?: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readCornerJunctionType(tb: ThermalBridgeLinear): CornerJunctionType | undefined {
  const extra = asRecord(tb.extra_json);
  const raw = typeof extra?.junction_type === 'string' ? extra.junction_type.trim().toUpperCase() : '';
  return raw === 'E16' || raw === 'E17' ? raw : undefined;
}

function hasResolvableSourceLinks(tb: ThermalBridgeLinear, elementsById: Record<string, Element>): boolean {
  const extra = asRecord(tb.extra_json);
  const source = asRecord(extra?.thermal_bridge_source);
  if (!source) return false;
  const ids = ['host_wall_id', 'host_wall_b_id', 'host_floor_id']
    .map((key) => (typeof source[key] === 'string' ? String(source[key]).trim() : ''))
    .filter(Boolean);
  return ids.length > 0 && ids.every((id) => elementsById[id] !== undefined);
}

function zSpan(coords: ThermalBridgeLinear['coordinates']): { min: number; max: number } | null {
  const zs = coords
    .map((c) => c.z)
    .filter((z): z is number => typeof z === 'number' && Number.isFinite(z));
  if (zs.length === 0) return null;
  return { min: Math.min(...zs), max: Math.max(...zs) };
}

function spansOverlap(a: { min: number; max: number } | null, b: { min: number; max: number } | null): boolean {
  if (!a || !b) return true;
  return Math.min(a.max, b.max) - Math.max(a.min, b.min) >= -0.01;
}

function sourceWithHostPair(
  tb: ThermalBridgeLinear,
  sourceIds: ThermalBridgeSource,
): ThermalBridgeLinear {
  const extra = asRecord(tb.extra_json) ?? {};
  const source = asRecord(extra.thermal_bridge_source) ?? {};
  const nextSource: Record<string, unknown> = {
    ...source,
    host_wall_id: sourceIds.host_wall_id,
  };
  if (sourceIds.host_wall_b_id) {
    nextSource.host_wall_b_id = sourceIds.host_wall_b_id;
  } else {
    delete nextSource.host_wall_b_id;
  }
  return {
    ...tb,
    extra_json: {
      ...extra,
      thermal_bridge_source: nextSource,
    },
  };
}

function sourceFromExplicitProposalHostIds(proposal: FacadeOpeningTbProposal): ThermalBridgeSource | undefined {
  const pair = proposal.hostElementIds ?? proposal.roofAdjacentPairIds ?? proposal.cornerHostWallIds;
  const a = pair?.[0]?.trim();
  const b = pair?.[1]?.trim();
  return a && b ? { host_wall_id: a, host_wall_b_id: b } : undefined;
}

function sourceFromSyntheticOpeningId(
  proposal: FacadeOpeningTbProposal,
  elementsById: Record<string, Element>,
): ThermalBridgeSource | undefined {
  const openingId = proposal.openingId.trim();
  const syntheticPrefix = openingId.startsWith('wgcont:')
    ? 'wgcont:'
    : openingId.startsWith('wicont:')
      ? 'wicont:'
      : '';
  if (!syntheticPrefix) return undefined;
  const hostId = openingId.slice(syntheticPrefix.length).split(':')[0]?.trim();
  return hostId && elementsById[hostId] ? { host_wall_id: hostId } : undefined;
}

function sourceFromActualOpeningId(
  proposal: FacadeOpeningTbProposal,
  elementsById: Record<string, Element>,
): ThermalBridgeSource | undefined {
  const opening = elementsById[proposal.openingId];
  if (!opening) return undefined;

  const code = proposal.junctionCode.trim().toUpperCase();
  if (
    (code === 'E1' || code === 'E2' || code === 'E3' || code === 'E4') &&
    (opening.type === 'BuildingElementTransparent' || opening.type === 'BuildingElementOpaque')
  ) {
    return { host_wall_id: opening.id };
  }

  if (
    (
      code === 'R1' ||
      code === 'R2' ||
      code === 'R3' ||
      code === 'R4' ||
      code === 'R5' ||
      code === 'R11' ||
      code === 'E10' ||
      code === 'E11' ||
      code === 'E12' ||
      code === 'E13' ||
      code === 'E14' ||
      code === 'E15'
    ) &&
    opening.type === 'BuildingElementOpaque'
  ) {
    return { host_wall_id: opening.id };
  }

  return undefined;
}

function sourceFromProposal(
  proposal: FacadeOpeningTbProposal,
  elementsById: Record<string, Element>,
): ThermalBridgeSource | undefined {
  return (
    sourceFromExplicitProposalHostIds(proposal) ??
    sourceFromSyntheticOpeningId(proposal, elementsById) ??
    sourceFromActualOpeningId(proposal, elementsById)
  );
}

function segmentLength(coords: ThermalBridgeLinear['coordinates']): number {
  if (coords.length < 2) return 0;
  const a = coords[0]!;
  const b = coords[1]!;
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function segmentsSubstantiallyMatch(
  tb: ThermalBridgeLinear,
  proposal: FacadeOpeningTbProposal,
): boolean {
  if (tb.coordinates.length < 2) return false;
  const overlap = overlapLengthBetweenSegmentElements(tb, { coordinates: proposal.coordinates });
  const shorter = Math.min(segmentLength(tb.coordinates), segmentLength(proposal.coordinates));
  if (shorter <= 1e-6) return false;
  if (overlap / shorter >= 0.98) return true;

  const tbAnchor = tbPlanAnchorXY(tb);
  if (!tbAnchor) return false;
  const proposalAnchor = tbPlanAnchorXY({
    ...tb,
    coordinates: proposal.coordinates,
  });
  if (!proposalAnchor) return false;
  return Math.hypot(tbAnchor.x - proposalAnchor.x, tbAnchor.y - proposalAnchor.y) <= DEFAULT_TB_DEDUPE_TOLERANCE_M &&
    Math.abs(segmentLength(tb.coordinates) - proposal.suggestedLengthM) <= 0.02;
}

/**
 * CSV reload regenerates element ids, while legacy `extra_json.thermal_bridge_source`
 * persists those ids. Rebind source ids from the same coordinate-driven auto-TB proposals
 * used to create them, leaving ambiguous or unlocated cases visible to validation.
 */
export function normalizeThermalBridgeSourceLinks(
  elements: Element[],
  globalOrientationOffset?: number,
): Element[] {
  const elementsById: Record<string, Element> = {};
  for (const element of elements) {
    elementsById[element.id] = element;
  }

  const sourceCandidates = elements.filter(
    (element): element is ThermalBridgeLinear =>
      element.type === 'ThermalBridgeLinear' &&
      element.coordinates.length >= 2 &&
      !hasResolvableSourceLinks(element, elementsById),
  );
  if (sourceCandidates.length === 0) return elements;

  const proposals = proposeAutoThermalBridges(elements, undefined, globalOrientationOffset)
    .map((proposal) => ({ proposal, source: sourceFromProposal(proposal, elementsById) }))
    .filter((row): row is { proposal: FacadeOpeningTbProposal; source: ThermalBridgeSource } => row.source !== undefined);
  if (proposals.length === 0) return elements;

  let changed = false;
  const nextElements = elements.map((element) => {
    if (element.type !== 'ThermalBridgeLinear') return element;

    if (element.coordinates.length < 2 || hasResolvableSourceLinks(element, elementsById)) return element;
    const extra = asRecord(element.extra_json);
    const junctionType = typeof extra?.junction_type === 'string' ? extra.junction_type.trim().toUpperCase() : '';
    if (!junctionType) return element;

    const bridgeSpan = readCornerJunctionType(element) ? zSpan(element.coordinates) : null;
    const candidates = proposals.filter(({ proposal }) => {
      if (proposal.junctionCode.trim().toUpperCase() !== junctionType) return false;
      if (proposal.zoneId !== element.zoneId) return false;
      if (!segmentsSubstantiallyMatch(element, proposal)) return false;

      if (readCornerJunctionType(element)) {
        const anchor = tbPlanAnchorXY(element);
        if (!anchor) return false;
        const proposalAnchor = proposal.coordinates[0];
        const d = Math.hypot(anchor.x - proposalAnchor.x, anchor.y - proposalAnchor.y);
        if (d > E16_E17_CORNER_PLAN_TOL_M) return false;
        return spansOverlap(bridgeSpan, zSpan(proposal.coordinates));
      }

      return true;
    });

    if (candidates.length !== 1) return element;

    changed = true;
    return sourceWithHostPair(element, candidates[0].source);
  });

  return changed ? nextElements : elements;
}
