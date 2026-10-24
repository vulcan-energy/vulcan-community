// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, ThermalBridgeLinear } from '../types';
import { createElementNameLookup } from '../../lib/elementNameRemap';
import type { FacadeOpeningTbProposal } from './proposeFacadeOpenings';
import { proposeAutoThermalBridges } from './autoThermalBridgePipeline';
import { tbPlanAnchorXY } from './linearTbCornerValidation';
import { VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY } from './linearTbPsi';
import { overlapLengthBetweenSegmentElements } from './linearTbSegmentOverlap';
import {
  E16_E17_CORNER_PLAN_TOL_M,
  DEFAULT_TB_DEDUPE_TOLERANCE_M,
} from './thermalBridgeTolerances';

type CornerJunctionType = 'E16' | 'E17';
/** `_id` keys holding runtime element ids; the CSV carries the matching `_name` key instead. */
const SOURCE_HOST_ID_KEYS = new Set(['host_wall_id', 'host_wall_b_id', 'host_floor_id']);
const EXTRA_JSON_HOST_ID_KEYS = new Set<string>([VULCAN_UI_TB_ADJACENT_ELEMENT_ID_KEY]);
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
  // A `*_name` key still present after load is a host that did not resolve.
  if (Object.keys(source).some((key) => key.endsWith('_name') && SOURCE_HOST_ID_KEYS.has(key.replace(/_name$/, '_id')))) {
    return false;
  }
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

type NameLookup = ReturnType<typeof createElementNameLookup>;

/**
 * The one rule writer and reader share: a host name resolves within the bridge's zone first
 * (element names are unique per zone), then as a model-wide unique name.
 */
function resolveHostName(resolveName: NameLookup, name: string, zoneId: string | undefined): Element | undefined {
  return (zoneId ? resolveName(name, zoneId) : undefined) ?? resolveName(name);
}

const nameKeyFor = (idKey: string): string => idKey.replace(/_id$/, '_name');

function hostIdsToNames(
  record: Record<string, unknown>,
  idKeys: ReadonlySet<string>,
  zoneId: string | undefined,
  elementsById: Record<string, Element>,
  resolveName: NameLookup,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const idKey = key.replace(/_name$/, '_id');
    // A name key beside a string id is superseded by whatever the id writes below.
    if (idKey !== key && idKeys.has(idKey) && typeof record[idKey] === 'string') continue;
    const host = idKeys.has(key) && typeof value === 'string' ? elementsById[value] : undefined;
    if (host?.name && resolveHostName(resolveName, host.name, zoneId) === host) {
      next[nameKeyFor(key)] = host.name.trim();
    } else {
      next[key] = value;
    }
  }
  return next;
}

function hostNamesToIds(
  record: Record<string, unknown>,
  idKeys: ReadonlySet<string>,
  zoneId: string | undefined,
  resolveName: NameLookup,
): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = {};
  const resolvedIdKeys = new Set<string>();
  for (const [key, value] of Object.entries(record)) {
    const idKey = key.replace(/_name$/, '_id');
    const host = idKey !== key && idKeys.has(idKey) && typeof value === 'string'
      ? resolveHostName(resolveName, value, zoneId)
      : undefined;
    if (host) {
      next[idKey] = host.id;
      resolvedIdKeys.add(idKey);
    } else if (!resolvedIdKeys.has(key)) {
      next[key] = value;
    }
  }
  // An `_id` key placed before its resolved `_name` sibling was overwritten in place above.
  return resolvedIdKeys.size > 0 ? next : undefined;
}

/**
 * CSV form of a thermal bridge's `extra_json`. Runtime host ids (`thermal_bridge_source.host_wall_id`,
 * `host_wall_b_id`, `host_floor_id` and `_vulcan_ui_tb_adjacent_element_id`) are written as the host's
 * name under the matching `_name` key, the identity a CSV keeps across parses. An id whose host is
 * missing, or whose name does not resolve back to it, is written as the id, as before; reload then
 * relinks a source from geometry.
 */
export function thermalBridgeExtraJsonForCsv(
  extraJson: Record<string, unknown> | undefined,
  zoneId: string | undefined,
  elementsById: Record<string, Element>,
  resolveName: NameLookup,
): Record<string, unknown> | undefined {
  if (!extraJson) return extraJson;
  const next = hostIdsToNames(extraJson, EXTRA_JSON_HOST_ID_KEYS, zoneId, elementsById, resolveName);
  const source = asRecord(next.thermal_bridge_source);
  if (source) {
    next.thermal_bridge_source = hostIdsToNames(source, SOURCE_HOST_ID_KEYS, zoneId, elementsById, resolveName);
  }
  return next;
}

/** Inverse of {@link thermalBridgeExtraJsonForCsv}: host names that resolve become runtime ids. */
function resolveHostNames(elements: Element[]): Element[] {
  const resolveName = createElementNameLookup(elements);
  let changed = false;
  const next = elements.map((element) => {
    if (element.type !== 'ThermalBridgeLinear' && element.type !== 'ThermalBridgePoint') return element;
    const extra = asRecord(element.extra_json);
    if (!extra) return element;
    const extraIds = hostNamesToIds(extra, EXTRA_JSON_HOST_ID_KEYS, element.zoneId, resolveName);
    const nextExtra = extraIds ?? extra;
    const source = asRecord(nextExtra.thermal_bridge_source);
    const sourceIds = source ? hostNamesToIds(source, SOURCE_HOST_ID_KEYS, element.zoneId, resolveName) : undefined;
    if (!extraIds && !sourceIds) return element;
    changed = true;
    return {
      ...element,
      extra_json: sourceIds ? { ...nextExtra, thermal_bridge_source: sourceIds } : nextExtra,
    } as Element;
  });
  return changed ? next : elements;
}

/**
 * CSV reload regenerates element ids, while legacy `extra_json.thermal_bridge_source`
 * persists those ids. Rebind source ids from the same coordinate-driven auto-TB proposals
 * used to create them, leaving ambiguous or unlocated cases visible to validation.
 */
export function normalizeThermalBridgeSourceLinks(
  parsedElements: Element[],
  globalOrientationOffset?: number,
): Element[] {
  const elements = resolveHostNames(parsedElements);
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
