// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { AssemblyLayer } from './assemblyTypes';
import type { Element } from '../geometry/types';
import { parseVulcanAssemblyV1FromExtraJson } from './assemblyAppliedUi';
import { roundToTwoDecimals } from '../geometry/constants';
import { computeWeightedThermalTransmWallsFromGroundAdjacentWalls } from './suspendedFloorThermalTransmWallsAutofill';
import { cavityPhysicalThicknessM } from './assemblyCavityModel';
import {
  computeGroundExposedPerimeterDetails,
  GROUND_EXPOSED_PERIMETER_MANUAL_KEY,
} from './groundExposedPerimeter';
import { usesGroundThermalTransmWallsAutofill } from './groundFloorSubtype';
import type { DefaultsLookup } from './defaultsCache';

/** When true, auto-sync must not overwrite `extra_json.thermal_transm_walls` (user owns the value). */
export const THERMAL_TRANSM_WALLS_MANUAL_KEY = '_thermal_transm_walls_manual';
/** When true, auto-sync must not overwrite top-level `thickness_walls` (user owns the value). */
export const THICKNESS_WALLS_MANUAL_KEY = '_thickness_walls_manual';
/** When true, `ElementCreator` must not overwrite `extra_json.u_value` with the ISO 13370 result (user owns the value). */
export const GROUND_U_VALUE_MANUAL_KEY = '_ground_u_value_manual';
export { GROUND_EXPOSED_PERIMETER_MANUAL_KEY };

export { usesGroundThermalTransmWallsAutofill };

export function readExtraJsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readFinite(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function numbersClose(a: number | null, b: number | null, eps = 1e-5): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= eps;
}

/**
 * Sum physical assembly thicknesses from a persisted snapshot (m). Explicit cavity gaps contribute
 * their modeled width; legacy cavities fall back to conservative nominal widths from cavity helpers.
 */
export function totalSolidAssemblyThicknessMFromLayers(layers: AssemblyLayer[] | undefined): number {
  if (!layers?.length) return 0;
  let sum = 0;
  for (const L of layers) {
    if (L.kind === 'solid' && Number.isFinite(L.thickness_m) && L.thickness_m > 0) {
      sum += L.thickness_m;
    } else if (L.kind === 'cavity') {
      const gap = cavityPhysicalThicknessM(L);
      if (gap != null && gap > 0) sum += gap;
    }
  }
  return sum;
}

export function assemblyTotalThicknessMFromOpaqueElement(el: Element): number | null {
  if (el.type !== 'BuildingElementOpaque') return null;
  const env = parseVulcanAssemblyV1FromExtraJson((el as { extra_json?: unknown }).extra_json);
  const layers = env?.assemblySnapshot?.layers as AssemblyLayer[] | undefined;
  const t = totalSolidAssemblyThicknessMFromLayers(layers);
  return t > 0 ? t : null;
}

function isVerticalOpaqueWallInZone(candidate: Element, zoneId: string | undefined | null): boolean {
  if (!zoneId) return false;
  if (candidate.type !== 'BuildingElementOpaque') return false;
  if (candidate.zoneId !== zoneId) return false;
  const pitch = (candidate as { pitch?: number }).pitch ?? 90;
  return Math.abs(pitch - 90) <= 10;
}

function elementStoreyKey(element: Pick<Element, 'floorId' | 'coordinates'>): string | null {
  if (typeof element.floorId === 'string' && element.floorId.trim() !== '') {
    return element.floorId.trim();
  }
  const z = element.coordinates?.[0]?.z;
  return typeof z === 'number' && Number.isFinite(z) ? String(Math.floor(z)) : null;
}

function isVerticalOpaqueWallAdjacentToGroundElement(
  candidate: Element,
  groundElement: Pick<Element, 'zoneId' | 'floorId' | 'coordinates'>,
): boolean {
  if (!isVerticalOpaqueWallInZone(candidate, groundElement.zoneId)) return false;
  const groundStorey = elementStoreyKey(groundElement);
  const wallStorey = elementStoreyKey(candidate);
  if (!groundStorey || !wallStorey) return true;
  return groundStorey === wallStorey;
}

/** Area-weighted mean assembly thickness (m) for vertical opaque walls in the zone. */
export function computeWeightedExternalWallAssemblyThicknessM(
  elementsById: Record<string, Element>,
  zoneId: string | undefined | null,
): number | null {
  return computeWeightedExternalWallAssemblyThicknessDetails(elementsById, zoneId).valueM;
}

export interface SuspendedWallThicknessAutofillSource {
  elementId: string;
  label: string;
  areaM2: number;
  thicknessM: number;
}

export interface SuspendedWallThicknessAutofillResult {
  valueM: number | null;
  areaTotalM2: number;
  sources: SuspendedWallThicknessAutofillSource[];
  candidateCount: number;
}

export function computeWeightedExternalWallAssemblyThicknessForGroundElement(
  elementsById: Record<string, Element>,
  groundElement: Pick<Element, 'zoneId' | 'floorId' | 'coordinates'> | null | undefined,
): number | null {
  return computeWeightedExternalWallAssemblyThicknessDetailsForGroundElement(elementsById, groundElement)
    .valueM;
}

// A function, not a constant: `sources` is a mutable array, and handing the
// same one to every caller lets an in-place sort or push by any consumer show
// up as phantom sources in a later, unrelated empty result.
function emptyWallThicknessResult(
  candidateCount = 0,
): SuspendedWallThicknessAutofillResult {
  return { valueM: null, areaTotalM2: 0, sources: [], candidateCount };
}

/** Area-weighted mean assembly thickness over whichever walls `isCandidate` accepts. */
function weightedWallAssemblyThickness(
  elementsById: Record<string, Element>,
  isCandidate: (candidate: Element) => boolean,
): SuspendedWallThicknessAutofillResult {
  const sources: SuspendedWallThicknessAutofillSource[] = [];
  let candidateCount = 0;

  for (const candidate of Object.values(elementsById)) {
    if (!isCandidate(candidate)) continue;
    candidateCount += 1;
    const thicknessM = assemblyTotalThicknessMFromOpaqueElement(candidate);
    const areaM2 = (candidate as { area?: number }).area;
    if (
      thicknessM == null ||
      thicknessM <= 0 ||
      typeof areaM2 !== 'number' ||
      !Number.isFinite(areaM2) ||
      areaM2 <= 0
    ) {
      continue;
    }
    sources.push({
      elementId: candidate.id,
      label: candidate.name?.trim() || candidate.id,
      areaM2,
      thicknessM,
    });
  }

  const areaTotalM2 = sources.reduce((total, source) => total + source.areaM2, 0);
  if (sources.length === 0 || !(areaTotalM2 > 0)) {
    return emptyWallThicknessResult(candidateCount);
  }

  const mean =
    sources.reduce((total, source) => total + source.thicknessM * source.areaM2, 0) / areaTotalM2;
  return { valueM: roundToTwoDecimals(mean), areaTotalM2, sources, candidateCount };
}

export function computeWeightedExternalWallAssemblyThicknessDetails(
  elementsById: Record<string, Element>,
  zoneId: string | undefined | null,
): SuspendedWallThicknessAutofillResult {
  if (!zoneId) return emptyWallThicknessResult();
  return weightedWallAssemblyThickness(elementsById, (candidate) =>
    isVerticalOpaqueWallInZone(candidate, zoneId),
  );
}

export function computeWeightedExternalWallAssemblyThicknessDetailsForGroundElement(
  elementsById: Record<string, Element>,
  groundElement: Pick<Element, 'zoneId' | 'floorId' | 'coordinates'> | null | undefined,
): SuspendedWallThicknessAutofillResult {
  if (!groundElement?.zoneId) return emptyWallThicknessResult();
  return weightedWallAssemblyThickness(elementsById, (candidate) =>
    isVerticalOpaqueWallAdjacentToGroundElement(candidate, groundElement),
  );
}

export function thermalTransmWallsManualFlag(extra: Record<string, unknown>): boolean {
  return extra[THERMAL_TRANSM_WALLS_MANUAL_KEY] === true;
}

export function thicknessWallsManualFlag(extra: Record<string, unknown>): boolean {
  return extra[THICKNESS_WALLS_MANUAL_KEY] === true;
}

export function groundExposedPerimeterManualFlag(extra: Record<string, unknown>): boolean {
  return extra[GROUND_EXPOSED_PERIMETER_MANUAL_KEY] === true;
}

export function applyComputedGroundUValueAutofill(
  extra: Record<string, unknown>,
  computedUValue: number | null | undefined,
): { extra: Record<string, unknown>; changed: boolean } {
  if (extra[GROUND_U_VALUE_MANUAL_KEY] === true) {
    return { extra, changed: false };
  }
  if (computedUValue == null || !Number.isFinite(computedUValue) || computedUValue <= 0) {
    return { extra, changed: false };
  }

  const roundedU = Number(computedUValue.toFixed(4));
  if (numbersClose(readFinite(extra.u_value), roundedU)) {
    return { extra, changed: false };
  }

  return {
    extra: { ...extra, u_value: roundedU },
    changed: true,
  };
}

/**
 * Track whether `thermal_transm_walls` was edited directly in Advanced JsonForms so auto-sync can skip it.
 * Clearing the field removes the manual lock so wall-driven sync can resume.
 */
export function applySuspendedThermalTransmWallsManualTracking(
  prevExtra: Record<string, unknown>,
  nextExtra: Record<string, unknown>,
  autoValue: number | null = null,
): Record<string, unknown> {
  const prevT = readFinite(prevExtra.thermal_transm_walls);
  const raw = nextExtra.thermal_transm_walls;
  const nextT = readFinite(raw);
  const thermalPresent = raw !== undefined && raw !== null && raw !== '';
  const valueChanged = !numbersClose(prevT, nextT);

  if (!valueChanged) return nextExtra;

  if (!thermalPresent || nextT == null) {
    const out = { ...nextExtra } as Record<string, unknown>;
    delete out[THERMAL_TRANSM_WALLS_MANUAL_KEY];
    return out;
  }
  if (numbersClose(nextT, autoValue)) {
    const out = { ...nextExtra } as Record<string, unknown>;
    delete out[THERMAL_TRANSM_WALLS_MANUAL_KEY];
    return out;
  }
  return { ...nextExtra, [THERMAL_TRANSM_WALLS_MANUAL_KEY]: true };
}

/**
 * Track whether top-level `thickness_walls` was edited directly so assembly-driven auto-sync can skip it.
 * Clearing the field, or setting it to the current automatic wall thickness, returns ownership to auto-sync.
 */
export function applyGroundThicknessWallsManualTracking(
  nextExtra: Record<string, unknown>,
  nextThicknessWalls: unknown,
  autoValue: number | null = null,
): Record<string, unknown> {
  const nextT = readFinite(nextThicknessWalls);
  const thicknessPresent =
    nextThicknessWalls !== undefined &&
    nextThicknessWalls !== null &&
    nextThicknessWalls !== '';

  if (!thicknessPresent || nextT == null || numbersClose(nextT, autoValue)) {
    const out = { ...nextExtra } as Record<string, unknown>;
    delete out[THICKNESS_WALLS_MANUAL_KEY];
    return out;
  }

  return { ...nextExtra, [THICKNESS_WALLS_MANUAL_KEY]: true };
}

/**
 * Auto-sync ground fabric from adjacent zone walls:
 * - `thickness_walls` for every `BuildingElementGround` (area-weighted assembly thickness on the same storey),
 * - `thermal_transm_walls` for `Suspended_floor` and `Unheated_basement` (wall U-value weighting),
 * unless the corresponding manual lock is set on `extra_json`.
 */
export function syncSuspendedGroundFabricFromWalls(
  elementsById: Record<string, Element>,
  updateElement: (id: string, patch: Partial<Element>) => void,
  defaultsLookup?: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
): void {
  for (const el of Object.values(elementsById)) {
    if (el.type !== 'BuildingElementGround') continue;
    const shouldSyncThermalTransmWalls = usesGroundThermalTransmWallsAutofill((el as { floor_type?: string }).floor_type);
    const extra = readExtraJsonRecord((el as { extra_json?: unknown }).extra_json);
    const manualTransm = thermalTransmWallsManualFlag(extra);
    const manualThick = thicknessWallsManualFlag(extra);

    let nextExtra: Record<string, unknown> = { ...extra };
    let nextThickness: number | undefined;
    let changed = false;

    if (shouldSyncThermalTransmWalls && !manualTransm) {
      const u = computeWeightedThermalTransmWallsFromGroundAdjacentWalls(
        elementsById,
        el,
        defaultsLookup,
      );
      if (u != null) {
        const cur = readFinite(extra.thermal_transm_walls);
        if (!numbersClose(cur, u)) {
          nextExtra = { ...nextExtra, thermal_transm_walls: roundToTwoDecimals(u) };
          changed = true;
        }
      }
    }

    if (!manualThick) {
      const th = computeWeightedExternalWallAssemblyThicknessForGroundElement(elementsById, el);
      if (th != null && th > 0) {
        const curT = readFinite((el as { thickness_walls?: unknown }).thickness_walls);
        if (!numbersClose(curT, th)) {
          nextThickness = th;
          changed = true;
        }
      }
    }

    if (!changed) continue;

    const patch: Partial<Element> = { extra_json: nextExtra };
    if (nextThickness !== undefined) {
      (patch as { thickness_walls?: number }).thickness_walls = nextThickness;
    }
    updateElement(el.id, patch);
  }
}

/**
 * Auto-sync `BuildingElementGround.perimeter` to the exposed wall-linked perimeter.
 *
 * The field remains user-editable: when `_ground_exposed_perimeter_manual` is set in `extra_json`,
 * this sync leaves the stored perimeter alone. The selected-element editor recomputes dependent
 * ground U-values through the existing auto-owned `u_value` path.
 */
export function syncGroundExposedPerimetersFromWalls(
  elementsById: Record<string, Element>,
  updateElement: (id: string, patch: Partial<Element>) => void,
): void {
  for (const el of Object.values(elementsById)) {
    if (el.type !== 'BuildingElementGround') continue;
    const extra = readExtraJsonRecord((el as { extra_json?: unknown }).extra_json);
    if (groundExposedPerimeterManualFlag(extra)) continue;

    const details = computeGroundExposedPerimeterDetails(elementsById, el);
    const hasReliableZero =
      details.shapePerimeterM > 0 &&
      details.linkedBoundaryPerimeterM >= Math.max(0, details.shapePerimeterM - 0.05);
    if (!(details.valueM > 0) && !hasReliableZero) continue;

    const currentPerimeter = readFinite((el as { perimeter?: unknown }).perimeter);
    if (numbersClose(currentPerimeter, details.valueM)) continue;

    updateElement(el.id, {
      perimeter: details.valueM,
    } as Partial<Element>);
  }
}
