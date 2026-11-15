// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { AssemblyLayer } from './assemblyTypes';
import type { Element } from '../geometry/types';
import { parseVulcanAssemblyV1FromExtraJson } from './assemblyAppliedUi';
import { roundToFourDecimals, roundToTwoDecimals, SUSPENDED_GROUND_DEFAULT_HEIGHT_UPPER_SURFACE_M } from '../geometry/constants';
import { computeWeightedThermalTransmWallsFromGroundAdjacentWalls } from './suspendedFloorThermalTransmWallsAutofill';
import { cavityPhysicalThicknessM } from './assemblyCavityModel';
import {
  computeGroundExposedPerimeterDetails,
  GROUND_EXPOSED_PERIMETER_MANUAL_KEY,
} from './groundExposedPerimeter';
import { usesGroundThermalTransmWallsAutofill } from './groundFloorSubtype';
import type { DefaultsLookup } from './defaultsCache';
import { targetSchemaMode, type GeometrySchemaPort } from '../../../geometry-editor-host/src/schemaPort';
import { deriveAutomaticGroundTotalAreas } from './groundFloorArea';
import { GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR } from './overrideProvenance';
import {
  computeGroundUValueFromElementModel,
  defaultSuspendedAreaPerPerimeterVent,
  parseWindShieldLocation,
} from './groundUValueCalculator';

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

/**
 * Writes the calculated ground U-value unless the user owns it. With construction bands (an
 * existing building) the age band applies unless the user states a U-value, so nothing is
 * written: the calculator writes only when the user applies it.
 */
export function applyComputedGroundUValueAutofill(
  extra: Record<string, unknown>,
  computedUValue: number | null | undefined,
  constructionBands: boolean,
): { extra: Record<string, unknown>; changed: boolean } {
  if (constructionBands || extra[GROUND_U_VALUE_MANUAL_KEY] === true) {
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
 * The perimeter the drawing gives a ground floor: the exposed wall-linked run once the walls on
 * its outline say so, otherwise the drawn outline (what a newly drawn floor stores).
 */
export function groundDrawingPerimeter(
  elementsById: Record<string, Element>,
  ground: Extract<Element, { type: 'BuildingElementGround' }>,
): number | null {
  const details = computeGroundExposedPerimeterDetails(elementsById, ground);
  const reliable = details.valueM > 0
    || (details.shapePerimeterM > 0
      && details.linkedBoundaryPerimeterM >= Math.max(0, details.shapePerimeterM - 0.05));
  if (reliable) return details.valueM;
  return details.shapePerimeterM > 0 ? details.shapePerimeterM : null;
}

/** The element before the edit: itself, or for a copy the element it was copied from. */
function elementBefore(
  previous: Record<string, Element> | undefined,
  copySources: ReadonlyMap<string, string> | undefined,
  id: string,
): Element | undefined {
  if (!previous) return undefined;
  return previous[id] ?? previous[copySources?.get(id) ?? ''];
}

type DerivedBefore = { stored: number | null; derived: number | null } | null;

/**
 * Whether a value the drawing derives takes the new derived value after an edit. Files carry no
 * marker for a value the assessor entered, so a stored value that differed from the drawing before
 * the edit reads as entered and stays. A blank value takes the drawing's value. A value the user
 * set in this edit stays, and a value whose inputs did not change is not touched. `before` is
 * null for an element the edit created: it takes the drawing's value. A copy's `before` is its
 * source, so a stated value stays stated.
 */
function takesDerivedValue(
  before: DerivedBefore,
  stored: number | null,
  derived: number | null,
  eps: number,
): boolean {
  if (derived == null || numbersClose(stored, derived, eps)) return false;
  if (stored == null || !before) return true;
  if (!numbersClose(before.stored, stored, eps)) return false;
  if (numbersClose(before.derived, derived, eps)) return false;
  return before.stored == null || numbersClose(before.stored, before.derived, eps);
}

type GroundElement = Extract<Element, { type: 'BuildingElementGround' }>;

function groundThermalTransmWallsFromWalls(
  elementsById: Record<string, Element>,
  ground: GroundElement,
  defaultsLookup?: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
): number | null {
  if (!usesGroundThermalTransmWallsAutofill(ground.floor_type)) return null;
  const u = computeWeightedThermalTransmWallsFromGroundAdjacentWalls(elementsById, ground, defaultsLookup);
  return u == null ? null : roundToTwoDecimals(u);
}

function groundThicknessWallsFromWalls(elementsById: Record<string, Element>, ground: GroundElement): number | null {
  const th = computeWeightedExternalWallAssemblyThicknessForGroundElement(elementsById, ground);
  return th != null && th > 0 ? th : null;
}

/**
 * Ground fabric that follows the walls next to it, after an edit (see `takesDerivedValue`):
 * - `thickness_walls` for every `BuildingElementGround` (area-weighted assembly thickness on the same storey),
 * - `thermal_transm_walls` for `Suspended_floor` and `Unheated_basement` (wall U-value weighting),
 * unless the corresponding manual lock is set on `extra_json`.
 *
 * `previous` is the model before the edit. Without it every ground counts as new. `copySources`
 * maps a copy made in this edit to its source.
 */
export function syncSuspendedGroundFabricFromWalls(
  elementsById: Record<string, Element>,
  updateElement: (id: string, patch: Partial<Element>) => void,
  defaultsLookup?: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
  previous?: Record<string, Element>,
  copySources?: ReadonlyMap<string, string>,
): void {
  for (const el of Object.values(elementsById)) {
    if (el.type !== 'BuildingElementGround') continue;
    const before = elementBefore(previous, copySources, el.id);
    const prevGround = before?.type === 'BuildingElementGround' ? before : null;
    const extra = readExtraJsonRecord(el.extra_json);
    const prevExtra = prevGround ? readExtraJsonRecord(prevGround.extra_json) : {};

    let nextExtra: Record<string, unknown> = { ...extra };
    let nextThickness: number | undefined;
    let changed = false;

    if (!thermalTransmWallsManualFlag(extra)) {
      const u = groundThermalTransmWallsFromWalls(elementsById, el, defaultsLookup);
      const beforeU = prevGround && previous
        ? {
            stored: readFinite(prevExtra.thermal_transm_walls),
            derived: groundThermalTransmWallsFromWalls(previous, prevGround, defaultsLookup),
          }
        : null;
      if (takesDerivedValue(beforeU, readFinite(extra.thermal_transm_walls), u, 0.005)) {
        nextExtra = { ...nextExtra, thermal_transm_walls: u };
        changed = true;
      }
    }

    if (!thicknessWallsManualFlag(extra)) {
      const th = groundThicknessWallsFromWalls(elementsById, el);
      const beforeTh = prevGround && previous
        ? { stored: readFinite(prevGround.thickness_walls), derived: groundThicknessWallsFromWalls(previous, prevGround) }
        : null;
      if (takesDerivedValue(beforeTh, readFinite(el.thickness_walls), th, 1e-5)) {
        nextThickness = th!;
        changed = true;
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

/** The automatic ground U-value for these inputs, or null when the user owns it or it is not calculated. */
function groundUValueFromDrawing(
  ground: GroundElement,
  extra: Record<string, unknown>,
  inputs: { totalArea: number; perimeter: number | null },
  constructionBands: boolean,
): number | null {
  if (inputs.perimeter == null || inputs.perimeter <= 0) return null;
  const computed = applyComputedGroundUValueAutofill(
    { ...extra, u_value: undefined },
    computeGroundUValueFromElementModel(ground, extra, ground.floor_type, {
      totalArea: inputs.totalArea,
      perimeter: inputs.perimeter,
    }),
    constructionBands,
  );
  return computed.changed ? readFinite(computed.extra.u_value) : null;
}

/**
 * After an edit, `BuildingElementGround.total_area` follows the shared physical area for its floor,
 * each element's `perimeter` its own exposed wall-linked run, and the automatic U-value both
 * (see `takesDerivedValue`).
 *
 * The fields remain user-editable: `_ground_exposed_perimeter_manual` in `extra_json`, the total
 * area override flag and `_ground_u_value_manual` keep the stored value. Automatic ground U-values
 * use the shared total area with each element's own perimeter, as in the HEM split-zone examples.
 *
 * `previous` is the model before the edit. Without it every ground counts as new. `copySources`
 * maps a copy made in this edit to its source.
 */
export function syncGroundExposedPerimetersFromWalls(
  elementsById: Record<string, Element>,
  updateElement: (id: string, patch: Partial<Element>) => void,
  constructionBands: boolean,
  previous?: Record<string, Element>,
  copySources?: ReadonlyMap<string, string>,
): void {
  const groundsOf = (byId: Record<string, Element>) => Object.values(byId).filter(
    (element): element is GroundElement => element.type === 'BuildingElementGround' && !element.isPlaceholder,
  );
  const grounds = groundsOf(elementsById);
  if (grounds.length === 0) return;
  const automaticTotalAreas = deriveAutomaticGroundTotalAreas(grounds);
  const previousTotalAreas = previous ? deriveAutomaticGroundTotalAreas(groundsOf(previous)) : null;

  // The values a ground uses in its U-value: stated ones where the user owns them.
  const effectiveInputs = (byId: Record<string, Element>, ground: GroundElement, autoTotal: number) => {
    const manualPerimeter = groundExposedPerimeterManualFlag(readExtraJsonRecord(ground.extra_json));
    const manualTotal = ground[GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR.flag] === true;
    return {
      perimeterFromDrawing: manualPerimeter ? null : groundDrawingPerimeter(byId, ground),
      totalAreaFromDrawing: manualTotal ? null : autoTotal,
    };
  };

  for (const ground of grounds) {
    const before = elementBefore(previous, copySources, ground.id);
    const prevGround = before?.type === 'BuildingElementGround' && !before.isPlaceholder ? before : null;
    const extra = readExtraJsonRecord(ground.extra_json);
    const next = effectiveInputs(elementsById, ground, automaticTotalAreas.get(ground.id) ?? ground.area);
    const prev = prevGround && previous
      ? effectiveInputs(previous, prevGround, previousTotalAreas?.get(prevGround.id) ?? prevGround.area)
      : null;
    const patch: Partial<Element> = {};

    let totalArea = readFinite(ground.total_area);
    if (
      next.totalAreaFromDrawing != null
      && takesDerivedValue(
        prev && prevGround ? { stored: readFinite(prevGround.total_area), derived: prev.totalAreaFromDrawing } : null,
        totalArea,
        next.totalAreaFromDrawing,
        1e-5,
      )
    ) {
      totalArea = next.totalAreaFromDrawing;
      (patch as { total_area?: number }).total_area = totalArea;
    }

    let perimeter = readFinite(ground.perimeter);
    if (
      next.perimeterFromDrawing != null
      && takesDerivedValue(
        prev && prevGround ? { stored: readFinite(prevGround.perimeter), derived: prev.perimeterFromDrawing } : null,
        perimeter,
        next.perimeterFromDrawing,
        0.005,
      )
    ) {
      perimeter = next.perimeterFromDrawing;
      (patch as { perimeter?: number }).perimeter = perimeter;
    }

    if (extra[GROUND_U_VALUE_MANUAL_KEY] !== true) {
      const u = groundUValueFromDrawing(ground, extra, { totalArea: totalArea ?? ground.area, perimeter }, constructionBands);
      const prevExtra = prevGround ? readExtraJsonRecord(prevGround.extra_json) : {};
      const beforeU = prevGround
        ? {
            stored: readFinite(prevExtra.u_value),
            derived: groundUValueFromDrawing(
              prevGround,
              prevExtra,
              { totalArea: readFinite(prevGround.total_area) ?? prevGround.area, perimeter: readFinite(prevGround.perimeter) },
              constructionBands,
            ),
          }
        : null;
      if (takesDerivedValue(beforeU, readFinite(extra.u_value), u, 5e-5)) {
        patch.extra_json = { ...extra, u_value: u };
      }
    }

    if (Object.keys(patch).length > 0) {
      updateElement(ground.id, patch);
    }
  }
}

/** Element types the ground sync reads: grounds and the line elements on their outline. */
const GROUND_SYNC_INPUT_TYPES = new Set<Element['type']>([
  'BuildingElementGround',
  'BuildingElementOpaque',
  'BuildingElementPartyWall',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
]);

function groundSyncInputsChanged(next: Record<string, Element>, previous: Record<string, Element>): boolean {
  for (const id in next) {
    const element = next[id];
    if (element !== previous[id] && GROUND_SYNC_INPUT_TYPES.has(element.type)) return true;
  }
  for (const id in previous) {
    if (!(id in next) && GROUND_SYNC_INPUT_TYPES.has(previous[id].type)) return true;
  }
  return false;
}

/**
 * Fills the suspended-floor defaults that are blank when a ground becomes a suspended floor in an
 * edit (a floor type change, alone or across a selection, or a new suspended floor), and on load
 * before the saved baseline (without `previous`), so an older file exports them and the U-value
 * does not read them as 0. Selection never fills them.
 */
export function fillSuspendedFloorDefaults(
  elementsById: Record<string, Element>,
  updateElement: (id: string, patch: Partial<Element>) => void,
  acceptsShieldLocation: boolean,
  previous?: Record<string, Element>,
  copySources?: ReadonlyMap<string, string>,
): void {
  for (const ground of Object.values(elementsById)) {
    if (ground.type !== 'BuildingElementGround' || ground.floor_type !== 'Suspended_floor') continue;
    const before = elementBefore(previous, copySources, ground.id);
    if (before?.type === 'BuildingElementGround' && before.floor_type === 'Suspended_floor') continue;
    const extra = readExtraJsonRecord(ground.extra_json);
    const next: Record<string, unknown> = { ...extra };
    if (readFinite(next.height_upper_surface) == null) {
      next.height_upper_surface = SUSPENDED_GROUND_DEFAULT_HEIGHT_UPPER_SURFACE_M;
    }
    if (acceptsShieldLocation) {
      next.shield_fact_location = parseWindShieldLocation(next.shield_fact_location);
    }
    const vent = readFinite(next.area_per_perimeter_vent);
    const area = readFinite(ground.area);
    const perimeter = readFinite(ground.perimeter);
    if ((vent == null || vent === 0) && area != null && perimeter != null) {
      const ventDefault = defaultSuspendedAreaPerPerimeterVent(area, perimeter);
      // Not roundToTwoDecimals: 0.0015 m²/m (Part F minimum) would round to 0.
      if (ventDefault != null) next.area_per_perimeter_vent = roundToFourDecimals(ventDefault);
    }
    if (JSON.stringify(next) !== JSON.stringify(extra)) updateElement(ground.id, { extra_json: next });
  }
}

/** Whether the target's suspended floor takes `shield_fact_location`. */
export function acceptsSuspendedShieldLocation(schemaPort: GeometrySchemaPort): boolean {
  if (schemaPort.availability !== 'available') return false;
  const properties = schemaPort.getElementSubschema(targetSchemaMode(schemaPort), 'BuildingElementGround', 'Suspended_floor')
    ?.properties as Record<string, unknown> | undefined;
  return properties?.shield_fact_location != null && properties.shield_fact_location !== false;
}

/**
 * The shielding location a suspended floor lacks, once the target's schema says it takes one.
 * Loading fills it only when the schema is already there; this fills it when the schema arrives.
 */
export function missingSuspendedShieldLocations(
  elementsById: Record<string, Element>,
  acceptsShieldLocation: boolean,
): Record<string, Element> {
  if (!acceptsShieldLocation) return {};
  const patched: Record<string, Element> = {};
  for (const ground of Object.values(elementsById)) {
    if (ground.type !== 'BuildingElementGround' || ground.floor_type !== 'Suspended_floor') continue;
    const extra = readExtraJsonRecord(ground.extra_json);
    if (extra.shield_fact_location !== undefined) continue;
    patched[ground.id] = { ...ground, extra_json: { ...extra, shield_fact_location: parseWindShieldLocation(undefined) } };
  }
  return patched;
}

export interface GroundFabricFollower {
  /** Runs an edit that copies elements; `sources` maps each copy's id to its source's. */
  withCopySources: <T>(sources: ReadonlyMap<string, string>, edit: () => T) => T;
}

/**
 * Keeps ground fabric that follows the drawing in step with the user's edits. It runs on element
 * edits only: selection, opening and loading never write (see `takesDerivedValue` for which
 * stored values follow). The load and copy state belongs to this store alone.
 */
export function followGroundFabricOnEdit<
  S extends {
    elementsById: Record<string, Element>;
    updateElement: (id: string, patch: Partial<Element>) => void;
    getDefaultsLookup: () => Pick<DefaultsLookup, 'getDefaultValueForElementField'>;
    writeIntent: () => string;
    writeAs: <T>(intent: 'derived', write: () => T) => T;
  },
>(
  store: { subscribe: (listener: (state: S, previous: S) => void) => () => void; getState: () => S },
  rules: { constructionBands: (state: S) => boolean; acceptsShieldLocation: () => boolean },
): GroundFabricFollower {
  let copySources: ReadonlyMap<string, string> | undefined;
  let syncing = false;
  store.subscribe((state, previous) => {
    // Only the user's edits move ground fabric: not a load, an undo, a default fill or a derived write.
    if (syncing || state.writeIntent() !== 'user' || state.elementsById === previous.elementsById) return;
    if (!groundSyncInputsChanged(state.elementsById, previous.elementsById)) return;
    syncing = true;
    try {
      const { updateElement } = state;
      const before = previous.elementsById;
      // A derived write: it rides in the user's step and records no source for the fields it fills.
      state.writeAs('derived', () => {
        // Defaults first: the wall U and the U-value of a new suspended floor read them.
        fillSuspendedFloorDefaults(state.elementsById, updateElement, rules.acceptsShieldLocation(), before, copySources);
        syncSuspendedGroundFabricFromWalls(store.getState().elementsById, updateElement, state.getDefaultsLookup(), before, copySources);
        syncGroundExposedPerimetersFromWalls(store.getState().elementsById, updateElement, rules.constructionBands(state), before, copySources);
      });
    } finally {
      syncing = false;
    }
  });
  return {
    withCopySources: (sources, edit) => {
      const outer = copySources;
      copySources = sources;
      try {
        return edit();
      } finally {
        copySources = outer;
      }
    },
  };
}
