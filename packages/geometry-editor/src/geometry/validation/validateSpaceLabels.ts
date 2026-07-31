// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { SpaceLabel, Zone } from '../types';
import type { ValidationIssue, ValidationResult } from './types';
import {
  isLivingRoomSpaceLabel,
  isSpaceLabelOpenToLivingRoom,
  resolveRoomTypeRule,
  spaceLabelPlanAreaM2,
} from '../../lib/spaceLabelDerivation';
import {
  analyzeSpaceLabelGeometry,
  getTreatedFloorBoundaryPolygonsForZone,
} from '../../lib/spaceLabelGeometry';
import type { Element, Floor } from '../types';

export type SpaceLabelValidationContext = {
  zones: Zone[];
  elementsById?: Record<string, Element>;
  floors?: Floor[];
  spaceInferenceWallPrintByZone?: Record<string, string>;
};

const ADJACENCY_EPS_M = 0.03;
const MIN_SHARED_EDGE_M = 0.1;

type Point2 = { x: number; y: number };

function toRing2(label: SpaceLabel): Point2[] {
  return (label.coordinates ?? []).map((c) => ({ x: c.x, y: c.y }));
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function distancePointToLine(p: Point2, a: Point2, b: Point2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = Math.hypot(vx, vy);
  if (len <= ADJACENCY_EPS_M) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(cross(vx, vy, p.x - a.x, p.y - a.y)) / len;
}

function sharedCollinearLength(a: Point2, b: Point2, c: Point2, d: Point2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const cdx = d.x - c.x;
  const cdy = d.y - c.y;
  const abLen = Math.hypot(abx, aby);
  const cdLen = Math.hypot(cdx, cdy);
  if (abLen <= ADJACENCY_EPS_M || cdLen <= ADJACENCY_EPS_M) return 0;

  const parallel = Math.abs(cross(abx, aby, cdx, cdy)) / (abLen * cdLen) <= 0.001;
  if (!parallel) return 0;
  if (distancePointToLine(c, a, b) > ADJACENCY_EPS_M || distancePointToLine(d, a, b) > ADJACENCY_EPS_M) {
    return 0;
  }

  const ux = abx / abLen;
  const uy = aby / abLen;
  const project = (p: Point2): number => (p.x - a.x) * ux + (p.y - a.y) * uy;
  const s0 = 0;
  const s1 = abLen;
  const t0 = project(c);
  const t1 = project(d);
  const overlap = Math.min(Math.max(s0, s1), Math.max(t0, t1)) - Math.max(Math.min(s0, s1), Math.min(t0, t1));
  return Math.max(0, overlap);
}

function ringsShareBoundary(a: Point2[], b: Point2[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!;
    const a1 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j]!;
      const b1 = b[(j + 1) % b.length]!;
      if (sharedCollinearLength(a0, a1, b0, b1) >= MIN_SHARED_EDGE_M) return true;
    }
  }
  return false;
}

function isAdjacentToLivingRoom(label: SpaceLabel, labels: SpaceLabel[]): boolean {
  const ring = toRing2(label);
  return labels.some((other) => {
    if (other.id === label.id) return false;
    if (other.zoneId !== label.zoneId || other.storey !== label.storey) return false;
    if (!isLivingRoomSpaceLabel(other)) return false;
    return ringsShareBoundary(ring, toRing2(other));
  });
}

export function getOpenToLivingRoomAdjacencyWarning(label: SpaceLabel, labels: SpaceLabel[]): string | null {
  if (!isSpaceLabelOpenToLivingRoom(label)) return null;
  if (isAdjacentToLivingRoom(label, labels)) return null;
  return `Space label "${label.name}": marked open to living room but is not adjacent to a living room space.`;
}

/**
 * Warnings-only for Space labels (PRD: unassigned type warn in-zone).
 */
export function validateSpaceLabels(
  spaceLabelsById: Record<string, SpaceLabel>,
  spaceLabelIds: string[],
  context: SpaceLabelValidationContext,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const warn = (
    message: string,
    spaceLabelId?: string,
    spaceLabelIds?: string[],
  ): ValidationIssue => ({
    message,
    source: 'geometry',
    ...(spaceLabelId ? { spaceLabelId } : {}),
    ...(spaceLabelIds && spaceLabelIds.length > 0 ? { spaceLabelIds } : {}),
  });

  const primaryZoneId = context.zones.find((z) => !z.isPlaceholder)?.id;
  const primaryZone = context.zones.find((z) => !z.isPlaceholder);
  const floorBoundariesByStorey = new Map<number, Array<Array<{ x: number; y: number }>>>();
  const elements = Object.values(context.elementsById ?? {}).filter(Boolean);
  if (primaryZone && context.floors) {
    for (let storey = 0; storey < context.floors.length; storey++) {
      const floor = context.floors[storey]!;
      const boundaries = getTreatedFloorBoundaryPolygonsForZone(primaryZone.id, elements, floor.zIndex);
      if (boundaries.length > 0) floorBoundariesByStorey.set(storey, boundaries);
    }
  }
  const primaryLabels = spaceLabelIds
    .map((id) => spaceLabelsById[id])
    .filter((label): label is SpaceLabel => !!label && (!primaryZoneId || label.zoneId === primaryZoneId));
  const allLabels = spaceLabelIds
    .map((id) => spaceLabelsById[id])
    .filter((label): label is SpaceLabel => !!label);
  const geometryAnalysis = analyzeSpaceLabelGeometry(primaryLabels, floorBoundariesByStorey);

  for (const id of spaceLabelIds) {
    const label = spaceLabelsById[id];
    if (!label) continue;

    const rt = label.room_type?.trim() ?? '';
    if (!rt) {
      warnings.push(
        warn(
          `Space label "${label.name}": set a room type (Space labels tool) so it counts toward compliance.`,
          id,
        ),
      );
      continue;
    }

    const coords = label.coordinates;
    if (!coords || coords.length < 3) {
      warnings.push(warn(`Space label "${label.name}": footprint needs at least three vertices.`, id));
      continue;
    }

    const area = spaceLabelPlanAreaM2(label);
    if (area <= 0) {
      warnings.push(warn(`Space label "${label.name}": footprint has no plan area.`, id));
    }

    const { known } = resolveRoomTypeRule(rt);
    if (!known) {
      warnings.push(
        warn(
          `Space label "${label.name}": unknown room_type "${rt}" — area counts toward rest; add a registry mapping if this should drive dwelling counts.`,
          id,
        ),
      );
    }

    const openToLivingWarning = getOpenToLivingRoomAdjacencyWarning(label, allLabels);
    if (openToLivingWarning) {
      warnings.push(warn(openToLivingWarning, id));
    }

    if (primaryZoneId && label.zoneId !== primaryZoneId) {
      warnings.push(
        warn(
          `Space label "${label.name}" is not on the primary thermal zone — metrics sync uses primary-zone labels only.`,
          id,
        ),
      );
    }

    const source = label.source ?? label.extra_json?.space_label_source;
    const inferredPrint = typeof label.extra_json?.inference_wall_print === 'string'
      ? label.extra_json.inference_wall_print
      : '';
    const currentPrint = context.spaceInferenceWallPrintByZone?.[label.zoneId] ?? '';
    if (source === 'edited_inferred' && inferredPrint && currentPrint && inferredPrint !== currentPrint) {
      warnings.push(
        warn(
          `Space label "${label.name}": walls changed since this inferred room was edited; keep it if intentional, or refresh inferred rooms.`,
          id,
        ),
      );
    }
  }

  for (const issue of geometryAnalysis.issues) {
    if (issue.kind === 'overlap') {
      const names = issue.labelIds
        .map((id) => spaceLabelsById[id]?.name)
        .filter(Boolean)
        .join(' / ');
      warnings.push(warn(
        `Space labels overlap (${names}): ${issue.areaM2.toFixed(2)} m² is excluded from derived room metrics.`,
        undefined,
        issue.labelIds,
      ));
    } else {
      const name = spaceLabelsById[issue.labelId]?.name ?? issue.labelId;
      warnings.push(warn(
        `Space label "${name}" extends ${issue.areaM2.toFixed(2)} m² outside the floor area; that area is excluded from derived room metrics.`,
        issue.labelId,
      ));
    }
  }

  return {
    hasIssues: issues.length > 0,
    issues,
    hasWarnings: warnings.length > 0,
    warnings,
  };
}
