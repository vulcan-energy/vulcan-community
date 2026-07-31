// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Batched-CTA placement for Part F vent findings.
//
// Given a finding ("need 5 background vents totalling 200 cm²"), this module picks where
// each new vent should go — parented to a window in a habitable space when possible — and
// what area each should carry so the gap is closed without misleading the user about the
// minimum (per-vent area is at least the fair share of the total minimum).

import type { BuildingElementTransparent, Element, SpaceLabel, Vents } from '../../types';
import {
  resolveRoomTypeRule,
  spaceLabelPlanAreaM2,
} from '../../../lib/spaceLabelDerivation';
import { pointInPolygon } from '../../../lib/spaceInference';
import type { PartFFinding } from './rules';
import {
  minimumBackgroundAreaContinuousCm2,
  minimumBackgroundAreaIntermittentCm2,
  minimumBackgroundCountContinuous,
  minimumBackgroundCountIntermittent,
} from './rules';

/** A single vent to create as part of a batched fix. */
export interface PlannedVent {
  area_cm2: number;
  mid_height_air_flow_path: number;
  /** Window/wall name to set as `parent_element`, or null when no host could be found. */
  parent_element: string | null;
  /** Plan-projected position (z = parent's centroid z when known, else 0). */
  coordinates: { x: number; y: number; z: number };
}

export interface BatchPlan {
  vents: PlannedVent[];
  /** Display string e.g. "3 background vents (200 cm² total)". */
  summary: string;
}

interface PlacementContext {
  elements: Element[];
  spaceLabels: SpaceLabel[];
}

const FALLBACK_MID_HEIGHT_M = 1.5;

/** Window plan-midpoint (the centroid of its 3D coordinates projected to xy). */
function windowPlanMidpoint(window: BuildingElementTransparent): { x: number; y: number; z: number } {
  const c = window.coordinates;
  if (!c || c.length === 0) return { x: 0, y: 0, z: 0 };
  let sx = 0, sy = 0, sz = 0;
  for (const p of c) {
    sx += p.x;
    sy += p.y;
    sz += p.z;
  }
  return { x: sx / c.length, y: sy / c.length, z: sz / c.length };
}

/**
 * Best-available mid-height for a vent parented to this window. Prefer the canonical
 * `mid_height` field, then derive from `base_height` + half-height, then the centroid z,
 * and finally a 1.5 m fallback so the resulting vent never trips the per-element
 * `mid_height_air_flow_path === 0` validator.
 */
function windowMidHeight(window: BuildingElementTransparent): number {
  if (typeof window.mid_height === 'number' && window.mid_height > 0) return window.mid_height;
  const base = typeof window.base_height === 'number' ? window.base_height : 0;
  const h = typeof window.height === 'number' ? window.height : 0;
  if (base + h / 2 > 0) return base + h / 2;
  const centroidZ = windowPlanMidpoint(window).z;
  if (centroidZ > 0) return centroidZ;
  return FALLBACK_MID_HEIGHT_M;
}

/** True when the label represents a habitable room per the registry. */
function isHabitableSpace(label: SpaceLabel): boolean {
  if (!label.room_type) return false;
  const { rule } = resolveRoomTypeRule(label.room_type);
  return rule.increments.NumberOfHabitableRooms === 1;
}

/** True when the label is specifically a bedroom. */
function isBedroomSpace(label: SpaceLabel): boolean {
  return label.room_type?.trim().toLowerCase() === 'bedroom';
}

function spaceLabelRing(label: SpaceLabel): { x: number; y: number }[] | null {
  const c = label.coordinates;
  if (!Array.isArray(c) || c.length < 3) return null;
  return c.map((p) => ({ x: p.x, y: p.y }));
}

/** Windows whose plan-midpoint lies inside any habitable space, ordered: bedrooms first, then by space area desc. */
function rankWindowsForBackgroundVents(
  windows: BuildingElementTransparent[],
  spaces: SpaceLabel[],
): BuildingElementTransparent[] {
  type Hit = {
    window: BuildingElementTransparent;
    isBedroom: boolean;
    spaceAreaM2: number;
  };
  const hits: Hit[] = [];

  for (const w of windows) {
    const mid = windowPlanMidpoint(w);
    let bestHit: Hit | null = null;
    for (const space of spaces) {
      if (!isHabitableSpace(space)) continue;
      const ring = spaceLabelRing(space);
      if (!ring) continue;
      if (!pointInPolygon({ x: mid.x, y: mid.y }, ring)) continue;
      const candidate: Hit = {
        window: w,
        isBedroom: isBedroomSpace(space),
        spaceAreaM2: spaceLabelPlanAreaM2(space),
      };
      // Prefer the smaller enclosing polygon when nested — a tiny bedroom inside a larger
      // house outline is the more specific match. Bedroom always wins over non-bedroom.
      // (In the typical case there's exactly one match and this comparator never fires.)
      if (
        !bestHit ||
        (candidate.isBedroom && !bestHit.isBedroom) ||
        (candidate.isBedroom === bestHit.isBedroom && candidate.spaceAreaM2 < bestHit.spaceAreaM2)
      ) {
        bestHit = candidate;
      }
    }
    if (bestHit) hits.push(bestHit);
  }

  hits.sort((a, b) => {
    if (a.isBedroom !== b.isBedroom) return a.isBedroom ? -1 : 1;
    return b.spaceAreaM2 - a.spaceAreaM2;
  });
  return hits.map((h) => h.window);
}

interface BackgroundVentTarget {
  requiredCount: number;
  requiredAreaCm2: number;
}

function backgroundTargetFor(
  finding: PartFFinding,
  input: {
    bedrooms: number;
    habitableRooms: number;
    bathrooms: number;
    storeys: number;
  },
): BackgroundVentTarget | null {
  switch (finding.rule) {
    case 'background_area_continuous':
    case 'background_count_continuous':
      return {
        requiredCount: minimumBackgroundCountContinuous(input.bedrooms),
        requiredAreaCm2: minimumBackgroundAreaContinuousCm2(input.habitableRooms),
      };
    case 'background_area_intermittent':
    case 'background_count_intermittent':
      return {
        requiredCount: minimumBackgroundCountIntermittent(input.bedrooms),
        requiredAreaCm2: minimumBackgroundAreaIntermittentCm2(
          input.habitableRooms,
          input.bathrooms,
          input.storeys,
        ),
      };
    default:
      return null;
  }
}

/**
 * Build a batch plan for one Part F finding. Returns null when the finding isn't a vent-shortfall
 * we can synthesise a plan for (e.g. MV count gaps, MVHR conflict — those don't auto-place).
 */
export function planBackgroundVents(
  finding: PartFFinding,
  input: {
    bedrooms: number;
    habitableRooms: number;
    bathrooms: number;
    storeys: number;
  },
  context: PlacementContext,
): BatchPlan | null {
  const target = backgroundTargetFor(finding, input);
  if (!target) return null;

  const existingVents = context.elements.filter(
    (e): e is Vents => e.type === 'Vents' && !e.isPlaceholder,
  );
  const existingCount = existingVents.length;
  const existingArea = existingVents.reduce((acc, v) => acc + (v.area_cm2 || 0), 0);

  let countToAdd = Math.max(0, target.requiredCount - existingCount);
  const areaToAdd = Math.max(0, target.requiredAreaCm2 - existingArea);
  if (countToAdd === 0 && areaToAdd === 0) return null;

  let perVentArea: number;
  if (countToAdd > 0) {
    // Each new vent carries at least the fair-share area for the spec, even if existing vents
    // already meet the area threshold — this keeps new vents individually meaningful.
    // Guard against `requiredCount === 0` (theoretical edge case from a future rule with no
    // count threshold): would yield Infinity from the divide.
    const fairShare = target.requiredCount > 0 ? target.requiredAreaCm2 / target.requiredCount : 0;
    const closeGap = areaToAdd / countToAdd;
    perVentArea = Math.max(fairShare, closeGap);
  } else {
    // Count met but area still short — add one extra vent that carries the missing area.
    countToAdd = 1;
    perVentArea = areaToAdd;
  }

  const windows = context.elements.filter(
    (e): e is BuildingElementTransparent =>
      e.type === 'BuildingElementTransparent' && !e.isPlaceholder,
  );
  const ranked = rankWindowsForBackgroundVents(windows, context.spaceLabels);

  // Each vent's area, rounded to 1 dp for the UI. Per-vent rounding can shave the total below
  // the dwelling minimum (e.g. 200/6 = 33.333... → 33.3 each → 6 × 33.3 = 199.8 < 200), so we
  // load the residual onto the first vent. The total always meets the required minimum.
  const totalNeeded = Math.max(target.requiredAreaCm2 - existingArea, perVentArea * countToAdd);
  const baseRoundedArea = roundOneDp(perVentArea);
  const baseSum = baseRoundedArea * countToAdd;
  const residual = totalNeeded > baseSum ? roundUpOneDp(totalNeeded - baseSum) : 0;

  const planned: PlannedVent[] = [];
  for (let i = 0; i < countToAdd; i++) {
    const area = i === 0 ? roundOneDp(baseRoundedArea + residual) : baseRoundedArea;
    if (ranked.length > 0) {
      const host = ranked[i % ranked.length];
      const mid = windowPlanMidpoint(host);
      const midHeight = windowMidHeight(host);
      planned.push({
        area_cm2: area,
        mid_height_air_flow_path: roundOneDp(midHeight),
        parent_element: host.name,
        coordinates: { x: mid.x, y: mid.y, z: midHeight },
      });
    } else {
      // No habitable-room windows — create unparented (per-element validator already warns
      // on missing parent, so the user is prompted to attach).
      planned.push({
        area_cm2: area,
        mid_height_air_flow_path: FALLBACK_MID_HEIGHT_M,
        parent_element: null,
        coordinates: { x: 0, y: 0, z: 0 },
      });
    }
  }

  const summary = `${planned.length} background vent${planned.length === 1 ? '' : 's'} (${roundOneDp(planned.reduce((s, p) => s + p.area_cm2, 0))} cm² total)`;

  return { vents: planned, summary };
}

function roundOneDp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function roundUpOneDp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.ceil(n * 10) / 10;
}
