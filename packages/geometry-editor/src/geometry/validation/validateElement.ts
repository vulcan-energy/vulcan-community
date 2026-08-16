// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { getElementShape } from '../../lib/shapeUtils';
import { calculatePolygonArea } from '../../lib/polygonSync';
import { HEM_UNHEATED_PITCHED_ROOF_MAX_PITCH_DEG } from '../../lib/elementArea';
import type {
  GeometrySchemaPort,
} from '../../../../geometry-editor-host/src/schemaPort';
import { hasDefaultValue, type DefaultsLookup } from '../../lib/defaultsCache';
import { classifyOpaqueFabricVariantFromElement } from '../../lib/opaqueFabricVariant';
import type {
  Element,
  Zone,
  BuildingElementOpaque,
  BuildingElementTransparent,
  BuildingElementGround,
  BuildingElementAdjacentConditionedSpace,
  BuildingElementAdjacentUnconditionedSpace_Simple,
  BuildingElementPartyWall,
  ThermalBridgeLinear,
  ThermalBridgePoint,
  WindowShading,
  Lighting,
  MechanicalVentilationDuctwork,
  MechanicalVentilationTerminal,
  WetEmitter,
  WaterPipework,
  Appliance,
  HotWaterDemand,
  ContextShading,
  Vents,
  MechanicalVentilation,
  CombustionAppliances,
  OnSiteGeneration,
  ElectricBattery,
  System,
} from '../types';
import type { MissingElement, ValidationResult, ValidationIssue, ValidationSource } from './types';
import { validateZone } from './validateZone';
import {
  detectMissingElements,
  hotWaterSourceHeatSourceWetLinkMessagesForElement,
  systemElementProvidesSpaceHeatSystem,
  type PartFDetectionContext,
} from './detectMissingElements';
import { partFInputFromContext, type PartFFinding } from './partF/rules';
import type { Floor } from '../types';
import {
  calculateDerivedBaseHeight,
  getCumulativeBaseHeightsByFloorId,
  getEffectiveStoreyHeight,
  isVerticalLineWall,
  withEffectiveStoreyHeights,
} from '../../lib/zoneDerivation';
import { deriveFromHostRoof, isPanelFullyOnRoof } from '../../lib/pvHostDerivation';
import {
  getAreaBasedElementExportGeometry,
  getElementEffectiveArea,
} from '../../lib/elementArea';
import { inferPsiSourceFromValue } from '../../lib/simplifiedFabricMap';
import { getEffectiveLinearPsiFromWorkspaceSparseMap } from '../../lib/junctionPsiDefaultsCsv';
import { getPApportionedLinearPsiForEditor } from '../thermalBridge/linearTbPsi';
import { computeOpaqueUAndTotals, matchesFhsDiscreteArealHeatCapacity } from '../../lib/assemblyCalculator';
import { effectiveFabricDisplayValues } from '../../lib/multiSelectAssemblyApply';
import { parseVulcanAssemblyV1FromExtraJson } from '../../lib/assemblyAppliedUi';
import { roundToTwoDecimals } from '../constants';
import { thermalBridgeLinearHasPositiveRun } from '../../lib/thermalBridgeLinearGeometry';
import { elementBaseElevationMForTb } from '../../lib/geometry3dMapper';
import { findSuspendedGroundSurfaceForLineElement } from '../../lib/suspendedFloorGeometry';
import { findLinkedBasementGroundForLineElement, isBasementGroundElement } from '../../lib/basementGeometry';
import { computeGroundExposedPerimeterDetails } from '../../lib/groundExposedPerimeter';
import { isExternalLineWall } from '../thermalBridge/proposeExternalCorners';
import type { LinearThermalBridgeIssue } from '../thermalBridge/findLinearThermalBridgeIssues';
import { findLinearThermalBridgeIssues } from '../thermalBridge/findLinearThermalBridgeIssues';
import { getWallSupportedSnappedVertices } from '../../lib/snapUtils';
import {
  collectGlobalSettingsWarnings,
  resolveEffectiveVentilationZoneBaseHeight,
  type GlobalSettingsShape,
} from '../../lib/globalSettingsValidation';
import { canMechanicalVentilationInheritHostPlacement } from '../../lib/mechanicalVentilationBranches';
import {
  readAuthoredUnheatedPitchedRoofCeilingElevationM,
  UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY,
} from '../../lib/unheatedPitchedRoofCeiling';
import {
  deriveSlopedElementDimensions,
  hasSelfIntersectingPolygonEdges,
  slopedDimensionDiffers,
} from '../../lib/slopedElementDimensions';
import {
  getFloorControlParentElement,
  getParentControlledFloorZ,
  preservesCoordinateZForParentControlledFloor,
} from '../../lib/parentControlledFloor';
import { getElementCanvasFloorZValue } from '../../lib/elementCanvasFloor';
import {
  MVHR_DUCT_ROLES,
  collectMvhrDuctTopologyWarnings,
  deriveMechanicalVentilationTerminalPosition,
  getFirstPoint3,
  isMvhrDuctRole,
  isMvhrTerminalHost,
  isMvhrTerminalRole,
  terminalIsNearDuctEndpoint,
} from '../../lib/mvhrDuctwork';

// ---------------- Module-level pure helpers ----------------
// Hoisted from inside `validateElementCore` because they have no closure state. Available to
// per-type validators that move into separate files in subsequent refactors.

export const geoIssue = (message: string, fieldKey?: string): ValidationIssue =>
  ({ message, source: 'geometry', fieldKey });
export const schemaIssue = (message: string, fieldKey?: string): ValidationIssue =>
  ({ message, source: 'schema', fieldKey });
export const fhsIssue = (message: string, fieldKey?: string): ValidationIssue =>
  ({ message, source: 'fhs', fieldKey });

/** Stable validation metadata shared by canonical validation and the floor-picker projection. */
export const FLOOR_STACK_WARNING_FIELD_KEY = 'floor_stack';
export const FLOOR_STACK_WARNING_MESSAGE = 'Floor geometry may overlap or separate.';

const FLOOR_STACK_TOLERANCE_M = 0.05;

type FloorStackInterval = {
  elementId: string;
  bottomM: number;
  topM: number;
};

export function getFloorStackWarningElementIds(elements: Element[], floors: Floor[]): Set<string> {
  if (floors.length === 0) return new Set();

  const baseHeightsByFloorId = getCumulativeBaseHeightsByFloorId(floors, elements);
  const floorByZ = new Map(floors.map((floor) => [floor.zIndex, floor]));
  const byFloorZ = new Map<number, FloorStackInterval[]>();
  const affectedElementIds = new Set<string>();

  for (const element of elements) {
    if (!isVerticalLineWall(element)) continue;
    const firstPoint = element.coordinates[0];
    const height = (element as { height?: unknown }).height;
    if (
      !firstPoint ||
      typeof firstPoint.z !== 'number' ||
      !Number.isFinite(firstPoint.z) ||
      typeof height !== 'number' ||
      !Number.isFinite(height) ||
      height <= 0
    ) {
      continue;
    }

    const floorZ = Math.floor(firstPoint.z);
    const floor = floorByZ.get(floorZ);
    if (!floor) continue;
    const slabM = baseHeightsByFloorId.get(floor.id) ?? null;
    const authoredBase = (element as { base_height?: unknown; _base_height?: unknown });
    const authoredBaseM = typeof authoredBase.base_height === 'number' && Number.isFinite(authoredBase.base_height)
      ? authoredBase.base_height
      : typeof authoredBase._base_height === 'number' && Number.isFinite(authoredBase._base_height)
        ? authoredBase._base_height
        : null;

    // A floor-height override is valid by itself. The warning belongs to the element only when
    // its authored bottom is actually separated from or below the slab that the floor stack
    // resolves to. An unresolved slab is deliberately not replaced with a guessed elevation.
    if (
      authoredBaseM !== null &&
      slabM !== null &&
      Math.abs(authoredBaseM - slabM) > FLOOR_STACK_TOLERANCE_M
    ) {
      affectedElementIds.add(element.id);
    }

    const bottomM = authoredBaseM ?? slabM;
    if (bottomM === null) continue;

    const intervals = byFloorZ.get(floorZ) ?? [];
    intervals.push({
      elementId: element.id,
      bottomM,
      topM: bottomM + height,
    });
    byFloorZ.set(floorZ, intervals);
  }

  for (const floor of floors) {
    const lower = byFloorZ.get(floor.zIndex);
    const upper = byFloorZ.get(floor.zIndex + 1);
    if (!lower || !upper || lower.length === 0 || upper.length === 0) continue;

    // Storey height is defined by the tallest qualifying vertical wall. Compare that lower
    // envelope with the first upper wall envelope so a real gap or overlap is surfaced, while
    // a height override with no adjacent geometry remains valid.
    const lowerTopM = Math.max(...lower.map((interval) => interval.topM));
    const upperBottomM = Math.min(...upper.map((interval) => interval.bottomM));
    if (Math.abs(lowerTopM - upperBottomM) <= FLOOR_STACK_TOLERANCE_M) continue;

    lower.forEach((interval) => affectedElementIds.add(interval.elementId));
    upper.forEach((interval) => affectedElementIds.add(interval.elementId));
  }

  return affectedElementIds;
}

function formatNumberForIssue(value: number): string {
  const rounded = roundToTwoDecimals(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

const FHS_STANDARD_FILL_L = 73;
const FHS_STANDARD_BATH_SIZE_L = 180;
const FHS_TWO_BED_OCCUPANCY = 2.2472;
const FHS_THREE_BED_OCCUPANCY = 2.9796;
const FHS_FOUR_BED_OCCUPANCY = 3.3715;
const FHS_FIVE_PLUS_BED_OCCUPANCY = 3.8997;

function fhsOccupantsForBedrooms(numberOfBedrooms?: number): number | undefined {
  if (typeof numberOfBedrooms !== 'number' || !Number.isFinite(numberOfBedrooms)) return undefined;
  const bedrooms = Math.floor(numberOfBedrooms);
  if (bedrooms === 2) return FHS_TWO_BED_OCCUPANCY;
  if (bedrooms === 3) return FHS_THREE_BED_OCCUPANCY;
  if (bedrooms === 4) return FHS_FOUR_BED_OCCUPANCY;
  if (bedrooms >= 5) return FHS_FIVE_PLUS_BED_OCCUPANCY;
  return undefined;
}

function minimumFhsBathSizeLitres(numberOfBedrooms?: number): number | undefined {
  const occupants = fhsOccupantsForBedrooms(numberOfBedrooms);
  if (!occupants || occupants <= 0) return undefined;
  const nAdults =
    (2.0001 * occupants ** 0.8492 - 1.07451 * occupants) / (1.888074 - 1.07451);
  const nChildren = occupants - nAdults;
  const occupantDisplacementL = (78.6 * nAdults + 33.01 * nChildren) / occupants;
  const threshold = FHS_STANDARD_BATH_SIZE_L * occupantDisplacementL / (occupantDisplacementL + FHS_STANDARD_FILL_L);
  return Math.floor(threshold) + 1;
}

function pushSlopedDimensionOverrideWarnings(
  element: Element,
  warnings: ValidationIssue[],
  globalOrientationOffset?: number,
): void {
  const derived = deriveSlopedElementDimensions(element, globalOrientationOffset);
  if (!derived) return;
  const widthOverride = (element as { _widthUserOverride?: boolean })._widthUserOverride === true;
  const heightOverride = (element as { _heightUserOverride?: boolean })._heightUserOverride === true;
  if (widthOverride && slopedDimensionDiffers((element as { width?: unknown }).width, derived.width)) {
    warnings.push(
      geoIssue(
        `Width differs from canvas-derived sloped width (${formatNumberForIssue(derived.width)} m)`,
        'width',
      ),
    );
  }
  if (heightOverride && slopedDimensionDiffers((element as { height?: unknown }).height, derived.height)) {
    warnings.push(
      geoIssue(
        `Height differs from canvas-derived sloped height (${formatNumberForIssue(derived.height)} m)`,
        'height',
      ),
    );
  }
}

function pushSelfIntersectingSlopedPolygonWarning(
  coordinates: ReadonlyArray<{ x: number; y: number }> | undefined,
  warnings: ValidationIssue[],
  message = 'Sloped polygon self-intersects; width, height and area may be misleading',
): void {
  if (hasSelfIntersectingPolygonEdges(coordinates)) {
    warnings.push(geoIssue(message, 'coordinates'));
  }
}

/**
 * Maps each Part F rule to the element field a user would change to fix it. Without this,
 * clicking the validation row in the element editor doesn't navigate anywhere — it just
 * shows the text.
 *
 *  - whole-dwelling extract rate / large iMEV → resize MV via `design_outdoor_air_flow_rate`
 *    (lives in `extra_json`; the editor opens that path).
 *  - background area shortfall on a single Vents element → resize `area_cm2`.
 *  - MVHR-no-vents conflict → no obvious field (the fix is "delete this vent"); leave
 *    fieldKey unset so the row is informational rather than a broken navigation hint.
 */
export function partFFieldKeyForRule(rule: PartFFinding['rule']): string | undefined {
  switch (rule) {
    case 'whole_dwelling_continuous':
    case 'whole_dwelling_intermittent':
    case 'large_imev':
      return 'design_outdoor_air_flow_rate';
    case 'background_area_continuous':
    case 'background_area_intermittent':
      return 'area_cm2';
    default:
      return undefined;
  }
}

export interface ValidationContext {
  /** Host-owned schema capability. Validation never reaches a concrete schema implementation. */
  schemaPort: GeometrySchemaPort;
  elementsById?: Record<string, Element>;
  zones?: Zone[];
  floors?: Floor[];
  globalOrientationOffset?: number;
  complianceValidationEnabled?: boolean;
  /** Global inputs used to resolve the same ventilation-zone base height written on save. */
  complianceSettings?: GlobalSettingsShape;
  numberOfBedrooms?: number;
  calculateContextShadingDistance?: (contextElement: ContextShading, parent: Element) => number;
  defaultsLoading?: boolean;
  /** Defaults resolver owned by the current editor document. */
  defaultsLookup?: DefaultsLookup;
  /** When set, ψ matching workspace default (sparse CSV + Table 3.7 fallback) does not trigger table mismatch warning. */
  junctionPsiWorkspaceByType?: Record<string, number> | null;
  /**
   * Precomputed {@link findLinearThermalBridgeIssues} for the current model. Pass from callers that already
   * batch-validates every element (e.g. geometry summary) to avoid O(n²) TB work per element.
   * When omitted, {@link validateElementCore} runs the finder once when evaluating a ThermalBridgeLinear row.
   */
  linearThermalBridgeIssues?: readonly LinearThermalBridgeIssue[];
  /**
   * Precomputed Part F findings for the current dwelling. Per-element issues (Vents, MV) are
   * attached when the element id appears in a finding's `affectedElementIds`.
   */
  partFFindings?: readonly PartFFinding[];
  /** Precomputed floor-stack warnings for model-wide validation callers. */
  floorStackWarningElementIds?: ReadonlySet<string>;
}

function jsonSchemaPropertyIsBoolean(
  properties: Record<string, unknown> | undefined,
  field: string,
): boolean {
  const p = properties?.[field] as { type?: string } | undefined;
  return p?.type === 'boolean';
}

/**
 * Required JSON Schema booleans: unchecked controls often omit the key, which is equivalent to false.
 * Without this, `hasField` is false and we spuriously report "required" until the user toggles the checkbox.
 */
function requiredSchemaFieldHasValue(
  field: string,
  hasField: boolean,
  fieldValue: unknown,
  subschema: { properties?: Record<string, unknown> },
): boolean {
  if (jsonSchemaPropertyIsBoolean(subschema.properties, field)) {
    return fieldValue === true || fieldValue === false || !hasField;
  }
  return hasField && fieldValue !== null && fieldValue !== undefined;
}

const readRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const MECHANICAL_VENTILATION_TYPICAL_MAX_SFP_IN_USE_FACTOR = 2.5;
// Advisory rather than a compliance limit: the published schemas deliberately leave SFP
// uncapped. Current project presets and FHS reference inputs are <= 2 W/(l/s), so 5 leaves
// substantial headroom while still catching lost-decimal inputs before simulation.
const MECHANICAL_VENTILATION_UNUSUALLY_HIGH_EFFECTIVE_SFP_W_PER_L_S = 5;

function pushMechanicalVentilationPerformanceValidation(
  element: MechanicalVentilation,
  issues: ValidationIssue[],
  warnings: ValidationIssue[],
): void {
  const elementData = element as unknown as Record<string, unknown>;
  const extraJson = readRecord(element.extra_json);
  const valueFor = (field: string): unknown => elementData[field] ?? extraJson[field];
  const hasField = (field: string): boolean =>
    Object.prototype.hasOwnProperty.call(elementData, field) ||
    Object.prototype.hasOwnProperty.call(extraJson, field);

  const sfpInUseFactor = valueFor('SFP_in_use_factor');
  if (
    typeof sfpInUseFactor === 'number' &&
    Number.isFinite(sfpInUseFactor) &&
    sfpInUseFactor > MECHANICAL_VENTILATION_TYPICAL_MAX_SFP_IN_USE_FACTOR
  ) {
    warnings.push(
      geoIssue(
        `SFP in-use factor ${formatNumberForIssue(sfpInUseFactor)} is above the typical range of 1–2.5; check the decimal point`,
        'SFP_in_use_factor',
      ),
    );
  }

  const measuredFanPower = valueFor('measured_fan_power');
  const measuredAirFlowRate = valueFor('measured_air_flow_rate');
  if (hasField('measured_fan_power') && !isPositiveFiniteNumber(measuredFanPower)) {
    issues.push(geoIssue('Measured fan power must be greater than 0 W', 'measured_fan_power'));
  }
  if (hasField('measured_air_flow_rate') && !isPositiveFiniteNumber(measuredAirFlowRate)) {
    issues.push(geoIssue('Measured air flow rate must be greater than 0 l/s', 'measured_air_flow_rate'));
  }

  const factor = sfpInUseFactor === undefined
    ? 1
    : isPositiveFiniteNumber(sfpInUseFactor)
      ? sfpInUseFactor
      : undefined;
  if (factor === undefined) return;

  const enteredSfp = valueFor('SFP');
  let effectiveSfp: number | undefined;
  let effectiveSfpFieldKey: string | undefined;
  if (isPositiveFiniteNumber(enteredSfp)) {
    effectiveSfp = enteredSfp * factor;
    effectiveSfpFieldKey = 'SFP';
  } else if (
    isPositiveFiniteNumber(measuredFanPower) &&
    isPositiveFiniteNumber(measuredAirFlowRate)
  ) {
    effectiveSfp = measuredFanPower / measuredAirFlowRate * factor;
    effectiveSfpFieldKey = 'measured_fan_power';
  }

  if (
    effectiveSfp !== undefined &&
    effectiveSfp > MECHANICAL_VENTILATION_UNUSUALLY_HIGH_EFFECTIVE_SFP_W_PER_L_S
  ) {
    warnings.push(
      geoIssue(
        `Effective SFP is ${formatNumberForIssue(effectiveSfp)} W/(l/s) after the in-use factor, which is unusually high; check the fan inputs and decimal points`,
        effectiveSfpFieldKey,
      ),
    );
  }
}

type ValidateDebugState = {
  enabled?: boolean;
  logEvery?: number;
  calls?: number;
  ms?: number;
};

type ValidateDebugGlobal = typeof globalThis & {
  __VULCAN_VALIDATE_DEBUG__?: ValidateDebugState;
};

const heatSourceWetReferenceMap = (elements: Element[]): Map<string, Record<string, unknown>> => {
  const map = new Map<string, Record<string, unknown>>();
  for (const candidate of elements) {
    if (candidate.type !== 'System' || (candidate as System).subcategory !== 'HeatSourceWet') continue;
    const extra = readRecord(candidate.extra_json);
    const wrapped = readRecord(extra.HeatSourceWet);
    const wrappedNames = Object.keys(wrapped).filter((name) => name.trim() !== '');
    if (wrappedNames.length > 0) {
      wrappedNames.forEach((name) => map.set(name, readRecord(wrapped[name])));
      continue;
    }
    if (candidate.name.trim()) map.set(candidate.name.trim(), extra);
  }
  return map;
};

const spaceHeatSystemHeatSourceWetLinkMessagesForElement = (
  element: Element,
  elements: Element[],
): string[] => {
  if (element.type !== 'System' || (element as System).subcategory !== 'SpaceHeatSystem') return [];
  const heatSources = heatSourceWetReferenceMap(elements);
  const spaceHeatSystems = readRecord(readRecord(element.extra_json).SpaceHeatSystem);
  const messages: string[] = [];
  for (const [name, rawSystem] of Object.entries(spaceHeatSystems)) {
    const system = readRecord(rawSystem);
    const systemType = typeof system.type === 'string' ? system.type : '';
    if (systemType !== 'WetDistribution' && systemType !== 'WarmAir') continue;
    const linkedName = readRecord(system.HeatSource).name;
    const linked = typeof linkedName === 'string' ? linkedName.trim() : '';
    if (!linked) {
      messages.push(`SpaceHeatSystem "${name}" must link a HeatSourceWet system`);
      continue;
    }
    const heatSource = heatSources.get(linked);
    if (!heatSource) {
      messages.push(`SpaceHeatSystem "${name}" links HeatSourceWet "${linked}" but no matching HeatSourceWet system exists`);
      continue;
    }
    if (systemType === 'WarmAir') {
      if (heatSource.type !== 'HeatPump') {
        messages.push(`WarmAir SpaceHeatSystem "${name}" must link a HeatPump HeatSourceWet system`);
      } else if (heatSource.sink_type !== 'Air') {
        messages.push(`WarmAir SpaceHeatSystem "${name}" must link a HeatSourceWet heat pump with sink_type "Air"`);
      }
    }
  }
  return messages;
};

function elementAssemblyLayers(element: Element): Array<{ kind: string; ventilation?: string }> {
  const envelope = parseVulcanAssemblyV1FromExtraJson((element as { extra_json?: unknown }).extra_json);
  const layers = envelope?.assemblySnapshot?.layers;
  if (!Array.isArray(layers)) return [];
  return layers.filter((layer) => layer && typeof layer === 'object') as Array<{
    kind: string;
    ventilation?: string;
  }>;
}

/** Max |Δz| across vertices (m) to treat a polygon as horizontal for pitch validation. */
const HORIZONTAL_POLYGON_Z_TOLERANCE_M = 0.03;

/**
 * XY shoelace area below this means the footprint is a segment/degenerate plan loop (e.g. vertical wall).
 * Adjacent fabric then validates like an opaque line wall (width × height), not like a horizontal polygon.
 */
const MIN_ADJACENT_PLAN_AREA_FOR_POLYGON_METRICS_M2 = 1e-6;
const SUSPENDED_FLOOR_BASE_HEIGHT_TOLERANCE_M = 0.08;

function isPolygonApproximatelyHorizontal(
  coordinates: Array<{ x: number; y: number; z: number }> | undefined,
): boolean {
  if (!coordinates || coordinates.length < 3) return false;
  const zs = coordinates.map((c) => c.z);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return maxZ - minZ <= HORIZONTAL_POLYGON_Z_TOLERANCE_M;
}

/** Default when omitted: treat as vertical (90°) for validation; CSV no longer injects 90. */
function effectiveElementPitchDeg(el: { pitch?: number }): number {
  const p = el.pitch;
  if (typeof p === 'number' && Number.isFinite(p)) return p;
  return 90;
}

function projectedVerticalHeightForStoreyCheck(
  element: { pitch?: unknown },
  height: number,
): number {
  const pitch = element.pitch;
  if (typeof pitch !== 'number' || !Number.isFinite(pitch)) return height;
  const projected = height * Math.abs(Math.sin((pitch * Math.PI) / 180));
  return Number.isFinite(projected) ? projected : height;
}

/**
 * A flat (horizontal) fabric polygon must declare pitch 0° (ceiling / upward) or 180° (floor / downward).
 * Vertical wall default 90° is invalid for coplanar horizontal geometry — common when a floor is drawn as a polygon but pitch was left as for a wall.
 */
function pushHorizontalPolygonPitchIssueIfNeeded(
  element: Element,
  issues: ValidationIssue[],
  geo: (message: string, fieldKey?: string) => ValidationIssue,
): void {
  if (getElementShape(element) === 'sloped-polygon') return;
  const coords = (element as { coordinates?: Array<{ x: number; y: number; z: number }> }).coordinates;
  if (!isPolygonApproximatelyHorizontal(coords)) return;
  const pitch = effectiveElementPitchDeg(element as { pitch?: number });
  if (pitch === 0 || pitch === 180) return;
  issues.push(
    geo(
      'Horizontal polygon: pitch must be 0° (ceiling) or 180° (floor) — vertical or sloped pitch is inconsistent with a flat polygon',
      'pitch',
    ),
  );
}

function pushOpaqueSemanticFlagShapeIssuesIfNeeded(
  element: BuildingElementOpaque,
  issues: ValidationIssue[],
  warnings: ValidationIssue[],
  geo: (message: string, fieldKey?: string) => ValidationIssue,
): void {
  const shape = getElementShape(element);

  if (element.is_unheated_pitched_roof === true && shape !== 'sloped-polygon') {
    issues.push(
      geo(
        'Unheated pitched roof must be an opaque sloped polygon',
        'is_unheated_pitched_roof',
      ),
    );
  }

  if (element.is_unheated_pitched_roof === true && shape === 'sloped-polygon') {
    const pitch = effectiveElementPitchDeg(element);
    if (pitch >= HEM_UNHEATED_PITCHED_ROOF_MAX_PITCH_DEG) {
      warnings.push(
        geo(
          'HEM only applies unheated pitched roof below 60° pitch; at 60° or above the engine treats it as a normal pitched roof',
          'pitch',
        ),
      );
    }

    const extra = element.extra_json && typeof element.extra_json === 'object' && !Array.isArray(element.extra_json)
      ? element.extra_json as Record<string, unknown>
      : {};
    if (Object.prototype.hasOwnProperty.call(extra, UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY)) {
      const ceilingElevation = readAuthoredUnheatedPitchedRoofCeilingElevationM(element);
      if (ceilingElevation === null) {
        warnings.push(
          geo(
            'Unheated pitched roof ceiling elevation must be a non-negative number; automatic wall/storey inference will be used instead',
            UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY,
          ),
        );
      } else {
        const baseHeight = element.base_height;
        if (
          typeof baseHeight === 'number' &&
          Number.isFinite(baseHeight) &&
          baseHeight >= 0 &&
          ceilingElevation > baseHeight + 0.05
        ) {
          warnings.push(
            geo(
              'Unheated pitched roof ceiling elevation is above the roof base height; check that the heat-loss ceiling boundary is not higher than the roof plane base',
              UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY,
            ),
          );
        }
      }
    }
  }

  if (element.is_external_door === true) {
    const pitch = effectiveElementPitchDeg(element);
    if (shape !== 'line' || Math.round(pitch) !== 90) {
      issues.push(
        geo(
          'External door must be an opaque vertical line opening',
          'is_external_door',
        ),
      );
    }
  }
}

// Validation utility function to check for missing or invalid data
export const validateElementCore = (
  element: Element,
  context: ValidationContext,
): ValidationResult => {
  // Optional debug instrumentation (off by default).
  // Enable in DevTools:
  //   window.__VULCAN_VALIDATE_DEBUG__ = { enabled: true, logEvery: 200 }
  const dbg = (() => {
    try {
      const v = (globalThis as ValidateDebugGlobal).__VULCAN_VALIDATE_DEBUG__;
      if (v && typeof v === 'object' && v.enabled) return v;
    } catch { /* swallow: best-effort */ }
    return null;
  })();
  const t0 = dbg ? performance.now() : 0;

  const issues: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  // Local aliases for the module-level helpers (geoIssue/schemaIssue/fhsIssue) so the long
  // switch below stays readable. Per-type validators in subsequent refactors call the
  // exported names directly.
  const geo = geoIssue;
  const schema = schemaIssue;
  const fhs = fhsIssue;
  const elementsById = context.elementsById;
  const zones = context.zones || [];
  const floors = context.floors;
  const complianceValidationEnabled = context.complianceValidationEnabled || false;
  const numberOfBedrooms = context.numberOfBedrooms;
  const defaultsLoading = context.defaultsLoading || false;
  const schemaPort = context.schemaPort;
  const junctionPsiWorkspaceByType = context.junctionPsiWorkspaceByType;
  const partFFindings = context.partFFindings;
  const appendPartFIssuesForElement = (elementId: string): void => {
    if (!partFFindings) return;
    for (const f of partFFindings) {
      if (f.affectedElementIds.includes(elementId)) {
        issues.push(fhs(f.fullMessage, partFFieldKeyForRule(f.rule)));
      }
    }
  };
  let linearThermalBridgeIssuesMemo: LinearThermalBridgeIssue[] | undefined =
    context.linearThermalBridgeIssues ? [...context.linearThermalBridgeIssues] : undefined;

  const getLinearThermalBridgeIssuesForModel = (): LinearThermalBridgeIssue[] => {
    if (linearThermalBridgeIssuesMemo) return linearThermalBridgeIssuesMemo;
    if (!elementsById || Object.keys(elementsById).length === 0) return [];
    linearThermalBridgeIssuesMemo = findLinearThermalBridgeIssues(Object.values(elementsById));
    return linearThermalBridgeIssuesMemo;
  };

  /** Issues from {@link findLinearThermalBridgeIssues} (TB geometry + colinear overlap for TB/duct/pipe). */
  const mergeLinearGeometryIssuesFromModel = (el: Element): void => {
    const modelIssues = getLinearThermalBridgeIssuesForModel();
    for (const li of modelIssues) {
      if (li.elementId !== el.id) continue;
      if (
        (el.type === 'MechanicalVentilationDuctwork' || el.type === 'WaterPipework') &&
        li.kind !== 'overlap_duplicate_colinear_segment'
      ) {
        continue;
      }
      const fieldKey =
        li.kind === 'overlap_duplicate_colinear_segment'
          ? 'coordinates'
          : li.kind === 'mismatch_basement_e22_elevation'
            ? 'coordinates'
          : li.kind === 'orphan_unresolved_parent'
            ? 'parent_element'
            : li.kind === 'mismatch_unknown_junction_type'
              ? 'junction_type'
              : undefined;
      const item = geo(li.message, fieldKey);
      if (li.severity === 'error') issues.push(item);
      else warnings.push(item);
    }
  };

  const allElements = elementsById ? Object.values(elementsById) : [];
  const floorStackWarnings = context.floorStackWarningElementIds
    ?? (floors ? getFloorStackWarningElementIds(allElements, floors) : new Set<string>());
  if (floorStackWarnings.has(element.id)) {
    warnings.push(geo(FLOOR_STACK_WARNING_MESSAGE, FLOOR_STACK_WARNING_FIELD_KEY));
  }
  const findElementByName = (name: string | null | undefined): Element | undefined => {
    const trimmed = name?.trim();
    return trimmed ? allElements.find((candidate) => candidate.name === trimmed) : undefined;
  };
  const linkedMvhrDucts = (mvhrName: string): MechanicalVentilationDuctwork[] =>
    allElements.filter(
      (candidate): candidate is MechanicalVentilationDuctwork =>
        candidate.type === 'MechanicalVentilationDuctwork' &&
        !candidate.isPlaceholder &&
        candidate.parent_element === mvhrName,
    );
  const linkedMvhrTerminals = (mvhrName: string): MechanicalVentilationTerminal[] =>
    allElements.filter(
      (candidate): candidate is MechanicalVentilationTerminal =>
        candidate.type === 'MechanicalVentilationTerminal' &&
        !candidate.isPlaceholder &&
        candidate.parent_element === mvhrName,
    );

  // Check required name
  if (!element.name || element.name.trim() === '') {
    issues.push(geo('Name is required', 'name'));
  }

  // Check floor assignment for BuildingElement types
  const buildingElementTypes = ['BuildingElementOpaque', 'BuildingElementTransparent', 'BuildingElementGround', 'BuildingElementAdjacentConditionedSpace', 'BuildingElementAdjacentUnconditionedSpace_Simple', 'BuildingElementPartyWall'];
  if (buildingElementTypes.includes(element.type) && (!element.floorId || element.floorId.trim() === '')) {
    const coords = element.coordinates;
    const inferredZ = Array.isArray(coords) && coords.length > 0 ? coords[0]?.z : undefined;
    const canInferFloor = typeof inferredZ === 'number' && Number.isFinite(inferredZ);
    if (!canInferFloor) {
      issues.push(geo('Floor required', 'floorId'));
    }
  }

  // Type-specific validation
  switch (element.type) {
    case 'BuildingElementOpaque': {
      const el = element as BuildingElementOpaque;
      const shape = getElementShape(el);

      if (shape === 'sloped-polygon' && el.coordinates && el.coordinates.length >= 3) {
        const derivedDimensions = deriveSlopedElementDimensions(el, context.globalOrientationOffset);
        pushSelfIntersectingSlopedPolygonWarning(el.coordinates, warnings);

        if (!derivedDimensions || derivedDimensions.width === 0) {
          issues.push(geo('Width cannot be 0', 'width'));
        }
        if (!derivedDimensions || derivedDimensions.height === 0) {
          issues.push(geo('Height cannot be 0', 'height'));
        }
        if (!derivedDimensions || derivedDimensions.area === 0) {
          warnings.push(geo('Area is 0 — check coordinates', 'area'));
        }
        pushSlopedDimensionOverrideWarnings(el, warnings, context.globalOrientationOffset);
      } else if (shape === 'polygon' && el.coordinates && el.coordinates.length >= 3) {
        // Use derived values for polygon validation
        const derivedArea = calculatePolygonArea(el.coordinates);
        const derivedWidth = Math.sqrt(derivedArea);
        const derivedHeight = derivedWidth;

        if (derivedWidth === 0) {
          issues.push(geo('Width cannot be 0', 'width'));
        }
        if (derivedHeight === 0) {
          issues.push(geo('Height cannot be 0', 'height'));
        }
        // Area is derived from polygon, so only warn if truly problematic
        if (derivedArea === 0) {
          warnings.push(geo('Area is 0 — check coordinates', 'area'));
        }
      } else {
        // Use stored values for line elements
        if (!el.width || el.width === 0) {
          issues.push(geo('Width cannot be 0', 'width'));
        }
        if (!el.height || el.height === 0) {
          issues.push(geo('Height cannot be 0', 'height'));
        }
      }
      // Do NOT check window-specific fields for opaque
      pushHorizontalPolygonPitchIssueIfNeeded(element, issues, geo);
      pushOpaqueSemanticFlagShapeIssuesIfNeeded(el, issues, warnings, geo);
      break;
    }
    case 'BuildingElementTransparent': {
      const el = element as BuildingElementTransparent;
      const shape = getElementShape(el);

      if (shape === 'sloped-polygon' && el.coordinates && el.coordinates.length >= 3) {
        const derivedDimensions = deriveSlopedElementDimensions(el, context.globalOrientationOffset);
        pushSelfIntersectingSlopedPolygonWarning(el.coordinates, warnings);

        if (!derivedDimensions || derivedDimensions.width === 0) {
          issues.push(geo('Width cannot be 0', 'width'));
        }
        if (!derivedDimensions || derivedDimensions.height === 0) {
          issues.push(geo('Height cannot be 0', 'height'));
        }
        if (!derivedDimensions || derivedDimensions.area === 0) {
          warnings.push(geo('Area is 0 — check coordinates', 'area'));
        }
        pushSlopedDimensionOverrideWarnings(el, warnings, context.globalOrientationOffset);
      } else if (shape === 'polygon' && el.coordinates && el.coordinates.length >= 3) {
        // Use derived values for polygon validation
        const derivedArea = calculatePolygonArea(el.coordinates);
        const derivedWidth = Math.sqrt(derivedArea);
        const derivedHeight = derivedWidth;

        if (derivedWidth === 0) {
          issues.push(geo('Width cannot be 0', 'width'));
        }
        if (derivedHeight === 0) {
          issues.push(geo('Height cannot be 0', 'height'));
        }
        // Area is derived from polygon, so only warn if truly problematic
        if (derivedArea === 0) {
          warnings.push(geo('Area is 0 — check coordinates', 'area'));
        }
      } else {
        // Use stored values for line elements
        if (!el.width || el.width === 0) {
          issues.push(geo('Width cannot be 0', 'width'));
        }
        if (!el.height || el.height === 0) {
          issues.push(geo('Height cannot be 0', 'height'));
        }
      }
      // Window-specific checks (only for transparent elements)
      if (!isPositiveFiniteNumber(el.frame_area_fraction)) {
        issues.push(geo('Frame Area Fraction is required and must be greater than 0', 'frame_area_fraction'));
      }
      if (!isPositiveFiniteNumber(el.free_area_height)) {
        issues.push(geo('Free Area Height should not be 0', 'free_area_height'));
      }
      if (!isPositiveFiniteNumber(el.mid_height)) {
        issues.push(geo('Mid Height should not be 0', 'mid_height'));
      }
      if (!isPositiveFiniteNumber(el.max_window_open_area)) {
        issues.push(geo('Max Window Open Area should not be 0', 'max_window_open_area'));
      }
      if (complianceValidationEnabled && context.complianceSettings) {
        const ventilationZoneBaseHeight = resolveEffectiveVentilationZoneBaseHeight({
          elements: allElements,
          floors,
          complianceSettings: context.complianceSettings,
        });
        if (ventilationZoneBaseHeight !== undefined) {
          const windowBaseHeight = getAreaBasedElementExportGeometry(el, context.globalOrientationOffset).baseHeight;
          if (windowBaseHeight < ventilationZoneBaseHeight) {
            issues.push(
              fhs(
                `Window base height (${formatNumberForIssue(windowBaseHeight)} m) is below the ventilation zone base height (${formatNumberForIssue(ventilationZoneBaseHeight)} m).`,
                'base_height',
              ),
            );
          }
        }
      }
      if (elementsById && el.name && el.zoneId) {
        const hasAttachedShading = Object.values(elementsById).some(
          (candidate): candidate is WindowShading =>
            candidate.type === 'WindowShading' &&
            !candidate.isPlaceholder &&
            candidate.zoneId === el.zoneId &&
            candidate.parent_element === el.name,
        );
        if (!hasAttachedShading) {
          warnings.push(geo('Consider adding shading, most windows have reveals', 'shading'));
        }
      }
      if (el.parent_element && elementsById && el.coordinates && el.coordinates.length >= 3) {
        const parent = Object.values(elementsById).find((candidate) => candidate.name === el.parent_element);
        if (
          parent &&
          parent.type === 'BuildingElementOpaque' &&
          Array.isArray(parent.coordinates) &&
          parent.coordinates.length >= 3 &&
          !isPanelFullyOnRoof(el, parent as BuildingElementOpaque)
        ) {
          issues.push(geo(`Opening extends beyond ${parent.name || 'parent element'}`, 'coordinates'));
        }
      }
      pushHorizontalPolygonPitchIssueIfNeeded(element, issues, geo);
      break;
    }

    case 'BuildingElementGround': {
      const groundElement = element as BuildingElementGround;
      if (!groundElement.area || groundElement.area === 0) {
        issues.push(geo('Area cannot be 0', 'area'));
      }
      if (!groundElement.total_area || groundElement.total_area === 0) {
        issues.push(geo('Total Area cannot be 0', 'total_area'));
      }
      if (!groundElement.perimeter || groundElement.perimeter === 0) {
        issues.push(geo('Perimeter cannot be 0', 'perimeter'));
      }
      if (!groundElement.floor_type) {
        issues.push(geo('Floor Type is required', 'floor_type'));
      }
      if (!groundElement.isPlaceholder) {
        const layers = elementAssemblyLayers(groundElement);
        if (layers.length > 0) {
          const hasWellVentilatedCavity = layers.some(
            (layer) => layer.kind === 'cavity' && layer.ventilation === 'well_ventilated',
          );
          if (groundElement.floor_type === 'Suspended_floor' && !hasWellVentilatedCavity) {
            issues.push(
              schema(
                'Suspended floor with applied assembly must include one well ventilated cavity for the underfloor void',
                'floor_type',
              ),
            );
          }
          if (groundElement.floor_type !== 'Suspended_floor' && hasWellVentilatedCavity) {
            issues.push(
              schema(
                'Only suspended floors can use an assembly with a well ventilated cavity (underfloor void)',
                'floor_type',
              ),
            );
          }
        }
      }
      break;
    }

    case 'BuildingElementAdjacentConditionedSpace':
    case 'BuildingElementAdjacentUnconditionedSpace_Simple':
    case 'BuildingElementPartyWall': {
      const adjacentElement = element as BuildingElementAdjacentConditionedSpace | BuildingElementAdjacentUnconditionedSpace_Simple | BuildingElementPartyWall;
      if (element.type === 'BuildingElementPartyWall' && getElementShape(adjacentElement) !== 'line') {
        issues.push(geo('Party wall must be a single wall segment (line), not a polygon', 'coordinates'));
      }
      const adjacentShape = getElementShape(adjacentElement);
      const adjCoords = adjacentElement.coordinates;
      const planArea =
        adjCoords && adjCoords.length >= 3 ? calculatePolygonArea(adjCoords) : 0;
      const usePolygonDerivedAdjacentValidation =
        adjacentShape === 'polygon' &&
        !!adjCoords &&
        adjCoords.length >= 3 &&
        planArea > MIN_ADJACENT_PLAN_AREA_FOR_POLYGON_METRICS_M2;

      if (adjacentShape === 'sloped-polygon' && adjCoords && adjCoords.length >= 3) {
        const derivedDimensions = deriveSlopedElementDimensions(adjacentElement, context.globalOrientationOffset);
        pushSelfIntersectingSlopedPolygonWarning(adjCoords, warnings);

        if (!derivedDimensions || derivedDimensions.width === 0) {
          issues.push(geo('Width cannot be 0', 'width'));
        }
        if (!derivedDimensions || derivedDimensions.height === 0) {
          issues.push(geo('Height cannot be 0', 'height'));
        }
        if (!derivedDimensions || derivedDimensions.area === 0) {
          issues.push(geo('Area cannot be 0', 'area'));
        }
        pushSlopedDimensionOverrideWarnings(adjacentElement, warnings, context.globalOrientationOffset);
      } else if (usePolygonDerivedAdjacentValidation) {
        // Horizontal-ish polygons (internal floors / ceilings): derive metrics from plan footprint
        const derivedArea = planArea;
        const derivedWidth = Math.sqrt(derivedArea);
        const derivedHeight = derivedWidth;

        if (derivedWidth === 0) {
          issues.push(geo('Width cannot be 0', 'width'));
        }
        if (derivedHeight === 0) {
          issues.push(geo('Height cannot be 0', 'height'));
        }
        if (derivedArea === 0) {
          issues.push(geo('Area cannot be 0', 'area'));
        }
      } else {
        // Line segments and vertical faces (zero XY footprint): same rules as opaque line walls — width & height only
        if (!adjacentElement.width || adjacentElement.width === 0) {
          issues.push(geo('Width cannot be 0', 'width'));
        }
        if (!adjacentElement.height || adjacentElement.height === 0) {
          issues.push(geo('Height cannot be 0', 'height'));
        }
      }

      if (element.type === 'BuildingElementAdjacentUnconditionedSpace_Simple' && !element.isPlaceholder) {
        const unheated = element as BuildingElementAdjacentUnconditionedSpace_Simple;
        const ru = unheated.extra_json?.thermal_resistance_unconditioned_space;
        if (typeof ru !== 'number' || !Number.isFinite(ru) || ru <= 0) {
          issues.push(
            schema(
              'R_u (thermal resistance of unheated space) must be set — use Advanced → R_u calculator or enter a value',
              'thermal_resistance_unconditioned_space',
            ),
          );
        } else if (ru > 3) {
          warnings.push(
            fhs(
              'R_u is above the HEM FHS schema maximum (3 m²·K/W). Lower inputs or the value before export — JSON schema validation will reject higher values.',
              'thermal_resistance_unconditioned_space',
            ),
          );
        }
      }
      if (element.type === 'BuildingElementPartyWall' && !element.isPlaceholder) {
        const extra = adjacentElement.extra_json ?? {};
        const cavityType = extra.party_wall_cavity_type;
        if (typeof cavityType !== 'string' || cavityType.trim() === '') {
          issues.push(schema('Party wall cavity type must be set', 'party_wall_cavity_type'));
        } else {
          const layers = elementAssemblyLayers(adjacentElement);
          if (layers.length > 0) {
            const hasCavityLayer = layers.some((layer) => layer.kind === 'cavity');
            const expectsCavityLayer = cavityType.trim() !== 'solid';
            if (expectsCavityLayer && !hasCavityLayer) {
              issues.push(
                schema(
                  'Party wall cavity type expects a cavity, but the applied assembly has no cavity layer',
                  'party_wall_cavity_type',
                ),
              );
            }
            if (!expectsCavityLayer && hasCavityLayer) {
              issues.push(
                schema(
                  'Party wall cavity type is solid, but the applied assembly contains a cavity layer',
                  'party_wall_cavity_type',
                ),
              );
            }
          }
        }
      }
      pushHorizontalPolygonPitchIssueIfNeeded(element, issues, geo);
      break;
    }

    case 'ThermalBridgeLinear': {
      const linearElement = element as ThermalBridgeLinear;
      if (!thermalBridgeLinearHasPositiveRun(linearElement)) {
        issues.push(geo('Length cannot be 0', 'length'));
      }
      {
        const junctionType = linearElement.extra_json?.junction_type;
        const psi = linearElement.linear_thermal_transmittance;
        let isWorkspacePsi = false;
        let isApportionedPsi = false;
        if (
          junctionPsiWorkspaceByType &&
          typeof junctionType === 'string' &&
          junctionType.trim() !== '' &&
          typeof psi === 'number' &&
          Number.isFinite(psi)
        ) {
          const eff = getEffectiveLinearPsiFromWorkspaceSparseMap(junctionType, junctionPsiWorkspaceByType);
          if (eff !== undefined && Math.abs(psi - eff) < 1e-9) {
            isWorkspacePsi = true;
          }
        }
        if (
          typeof junctionType === 'string' &&
          junctionType.trim() !== '' &&
          typeof psi === 'number' &&
          Number.isFinite(psi) &&
          elementsById
        ) {
          const eff = getPApportionedLinearPsiForEditor(
            junctionType,
            junctionPsiWorkspaceByType,
            elementsById,
            linearElement.extra_json,
          );
          if (eff !== undefined && Math.abs(psi - eff) < 1e-9) {
            isApportionedPsi = true;
          }
        }
        if (
          !isWorkspacePsi &&
          !isApportionedPsi &&
          typeof junctionType === 'string' &&
          junctionType.trim() !== '' &&
          typeof psi === 'number' &&
          Number.isFinite(psi) &&
          inferPsiSourceFromValue(junctionType, psi) === 'custom'
        ) {
          warnings.push(
            geo(`ψ mismatch "${junctionType}" (Table 3.7) — check value`, 'linear_thermal_transmittance'),
          );
        }
      }
      mergeLinearGeometryIssuesFromModel(linearElement);
      break;
    }

    case 'ThermalBridgePoint': {
      const pointElement = element as ThermalBridgePoint;
      if (typeof pointElement.heat_transfer_coeff !== 'number' || !Number.isFinite(pointElement.heat_transfer_coeff)) {
        issues.push(geo('Heat Transfer Coefficient is required', 'heat_transfer_coeff'));
      }
      break;
    }

    case 'WindowShading': {
      const shadingElement = element as WindowShading;
      if (!shadingElement.shading_type) {
        issues.push(geo('Shading Type is required', 'shading_type'));
        break;
      }
      if (shadingElement.shading_type === 'object') {
        if (!shadingElement.distance || shadingElement.distance === 0) {
          issues.push(geo('Distance cannot be 0', 'distance'));
        }
        if (!shadingElement.height || shadingElement.height === 0) {
          issues.push(geo('Height cannot be 0', 'height'));
        }
        if (shadingElement.transparency === undefined || shadingElement.transparency === null || shadingElement.transparency < 0) {
          issues.push(geo('Transparency is required and must be >= 0', 'transparency'));
        }
      } else {
        // For overhang/sidefin/reveal types, distance is user-input
        if (!shadingElement.distance || shadingElement.distance === 0) {
          issues.push(geo('Distance cannot be 0', 'distance'));
        }
        if (!shadingElement.depth || shadingElement.depth === 0) {
          issues.push(geo('Depth cannot be 0', 'depth'));
        }
      }
      break;
    }

    case 'Lighting': {
      const lightingElement = element as Lighting;
      if (!isPositiveFiniteNumber(lightingElement.efficacy)) {
        issues.push(geo('Efficacy is required and must be greater than 0', 'efficacy'));
      }
      if (!lightingElement.simplified_lighting) {
        if (!isPositiveFiniteNumber(lightingElement.count)) {
          issues.push(geo('Count is required and must be greater than 0', 'count'));
        }
        if (!isPositiveFiniteNumber(lightingElement.power)) {
          issues.push(geo('Power is required and must be greater than 0', 'power'));
        }
      }
      break;
    }

    case 'MechanicalVentilationDuctwork': {
      const ductElement = element as MechanicalVentilationDuctwork;
      if (!isMvhrDuctRole((ductElement as { duct_type?: unknown }).duct_type)) {
        issues.push(geo('Duct Type is required', 'duct_type'));
      }
      if (!ductElement.length || ductElement.length === 0) {
        issues.push(geo('Length cannot be 0', 'length'));
      }
      const parentName = ductElement.parent_element?.trim();
      if (!parentName) {
        warnings.push(geo('Duct is not assigned to an MVHR unit', 'parent_element'));
      } else if (elementsById) {
        const parent = findElementByName(parentName);
        if (!parent) {
          issues.push(geo('MVHR unit not found', 'parent_element'));
        } else if (parent.type !== 'MechanicalVentilation') {
          issues.push(geo('Parent must be a MechanicalVentilation MVHR unit', 'parent_element'));
        } else if ((parent as MechanicalVentilation).vent_type !== 'MVHR') {
          issues.push(geo('Parent ventilation system must use MVHR', 'parent_element'));
        } else if (isMvhrDuctRole(ductElement.duct_type)) {
          collectMvhrDuctTopologyWarnings(linkedMvhrDucts(parent.name), {
            unitPoint: getFirstPoint3(parent),
            unitLabel: parent.name,
            roles: [ductElement.duct_type],
          }).forEach((warning) => warnings.push(geo(warning.message, 'coordinates')));
        }
      }
      mergeLinearGeometryIssuesFromModel(ductElement);
      break;
    }

    case 'MechanicalVentilationTerminal': {
      const terminalElement = element as MechanicalVentilationTerminal;
      if (!isMvhrTerminalRole((terminalElement as { terminal_type?: unknown }).terminal_type)) {
        issues.push(geo('Terminal Type is required', 'terminal_type'));
      }
      const parentName = terminalElement.parent_element?.trim();
      const hostName = terminalElement.host_element?.trim();
      const parent = parentName ? findElementByName(parentName) : undefined;
      const host = hostName ? findElementByName(hostName) : undefined;

      if (!parentName) {
        issues.push(geo('MVHR unit is required', 'parent_element'));
      } else if (elementsById) {
        if (!parent) {
          issues.push(geo('MVHR unit not found', 'parent_element'));
        } else if (parent.type !== 'MechanicalVentilation') {
          issues.push(geo('Parent must be a MechanicalVentilation MVHR unit', 'parent_element'));
        } else if ((parent as MechanicalVentilation).vent_type !== 'MVHR') {
          issues.push(geo('Parent ventilation system must use MVHR', 'parent_element'));
        }
      }

      const manualOrientation = terminalElement.orientation360;
      const manualPitch = terminalElement.pitch;
      if (!hostName) {
        if (typeof manualOrientation !== 'number' || !Number.isFinite(manualOrientation)) {
          issues.push(geo('Manual external orientation is required', 'orientation360'));
        } else if (manualOrientation < 0 || manualOrientation > 360) {
          issues.push(geo('Manual external orientation must be between 0 and 360°', 'orientation360'));
        }
        if (typeof manualPitch !== 'number' || !Number.isFinite(manualPitch)) {
          issues.push(geo('Manual external pitch is required', 'pitch'));
        } else if (manualPitch < 0 || manualPitch > 180) {
          issues.push(geo('Manual external pitch must be between 0 and 180°', 'pitch'));
        }
      } else if (elementsById) {
        if (!host) {
          issues.push(geo('Mounted host not found', 'host_element'));
        } else if (!isMvhrTerminalHost(host)) {
          issues.push(geo('Mounted on must be an external wall or window', 'host_element'));
        }
      }

      const position = deriveMechanicalVentilationTerminalPosition(terminalElement, host);
      if (!position) {
        const hasCompleteManualAngles =
          !hostName &&
          typeof manualOrientation === 'number' && Number.isFinite(manualOrientation) &&
          typeof manualPitch === 'number' && Number.isFinite(manualPitch);
        if (hostName || hasCompleteManualAngles) {
          issues.push(geo(
            hostName
              ? 'Terminal position, pitch, and orientation must resolve from the mounted host'
              : 'Manual external terminal position must have a valid height',
            'mid_height_air_flow_path',
          ));
        }
      } else if (position.mid_height_air_flow_path < 1 || position.mid_height_air_flow_path > 60) {
        issues.push(geo('mid_height_air_flow_path must be between 1 and 60 m', 'mid_height_air_flow_path'));
      }

      if (elementsById && parent?.type === 'MechanicalVentilation' && (parent as MechanicalVentilation).vent_type === 'MVHR' && isMvhrTerminalRole(terminalElement.terminal_type)) {
        const sameRoleTerminals = linkedMvhrTerminals(parent.name).filter(
          (terminal) => terminal.terminal_type === terminalElement.terminal_type,
        );
        if (sameRoleTerminals.length > 1) {
          issues.push(geo(`MVHR accepts one ${terminalElement.terminal_type} terminal`, 'terminal_type'));
        }
        const matchingDucts = linkedMvhrDucts(parent.name).filter((duct) => duct.duct_type === terminalElement.terminal_type);
        if (matchingDucts.length > 0 && !terminalIsNearDuctEndpoint(terminalElement, matchingDucts)) {
          warnings.push(geo(`Terminal is not near a ${terminalElement.terminal_type} duct endpoint`, 'coordinates'));
        }
      }
      break;
    }

    case 'WetEmitter': {
      const emitterElement = element as WetEmitter;
      if (!emitterElement.subcategory) {
        issues.push(geo('Emitter Type is required', 'subcategory'));
      }
      if (emitterElement.subcategory === 'radiator' || emitterElement.subcategory === 'fancoil') {
        if (!emitterElement.unit_number || emitterElement.unit_number === 0) {
          issues.push(geo('Unit Number cannot be 0', 'unit_number'));
        }
      }
      if (emitterElement.subcategory === 'ufh' && (!emitterElement.area || emitterElement.area === 0)) {
        issues.push(geo('Area cannot be 0', 'area'));
      }
      const linkedSpaceHeatSystemName =
        typeof emitterElement.space_heat_system === 'string'
          ? emitterElement.space_heat_system.trim()
          : '';
      if (!linkedSpaceHeatSystemName) {
        issues.push(geo('SpaceHeatSystem link is required', 'space_heat_system'));
      } else if (elementsById) {
        const linkedSystemExists = Object.values(elementsById).some((candidate) =>
          candidate.type === 'System'
          && (candidate as System).subcategory === 'SpaceHeatSystem'
          && candidate.name === linkedSpaceHeatSystemName
        );
        if (!linkedSystemExists) {
          issues.push(geo('Linked SpaceHeatSystem was not found', 'space_heat_system'));
        }
      }
      break;
    }

    case 'WaterPipework': {
      const pipeworkElement = element as WaterPipework;
      if (!pipeworkElement.location) {
        issues.push(geo('Location is required', 'location'));
      }
      const pipeworkType = pipeworkElement.pipework_type ?? 'primary';
      if (pipeworkType !== 'primary' && pipeworkType !== 'distribution') {
        issues.push(geo('Pipework Type must be primary or distribution', 'pipework_type'));
      }
      if (!pipeworkElement.length || pipeworkElement.length === 0) {
        issues.push(geo('Length cannot be 0', 'length'));
      }
      mergeLinearGeometryIssuesFromModel(pipeworkElement);
      break;
    }

    case 'Appliance': {
      const applianceElement = element as Appliance;
      const applianceKey =
        typeof applianceElement.appliancekey === 'string' ? applianceElement.appliancekey.trim() : '';
      if (!applianceKey) {
        issues.push(geo('Appliance Key is required', 'appliancekey'));
      }
      if (complianceValidationEnabled && applianceKey && elementsById) {
        const duplicateAppliances = Object.values(elementsById).filter((candidate) => {
          if (!candidate || candidate.isPlaceholder || candidate.type !== 'Appliance') return false;
          const candidateKey =
            typeof (candidate as Appliance).appliancekey === 'string'
              ? (candidate as Appliance).appliancekey.trim()
              : '';
          return candidateKey === applianceKey;
        });
        if (duplicateAppliances.length > 1) {
          const duplicateNames = duplicateAppliances
            .map((candidate) => candidate.name)
            .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
          warnings.push(
            fhs(
              `FHS: duplicate appliance key "${applianceKey}" (${duplicateNames.join(', ')}) will collapse to one Appliances.${applianceKey} JSON entry`,
              'appliancekey',
            ),
          );
        }
      }
      break;
    }

    case 'HotWaterDemand': {
      const hotWaterElement = element as HotWaterDemand;
      if (!hotWaterElement.subcategory) {
        issues.push(geo('Outlet Type is required', 'subcategory'));
      }
      if (hotWaterElement.subcategory === 'Bath' && (!hotWaterElement.size || hotWaterElement.size === 0)) {
        issues.push(geo('Size cannot be 0', 'size'));
      }
      if (
        complianceValidationEnabled &&
        hotWaterElement.subcategory === 'Bath' &&
        typeof hotWaterElement.size === 'number' &&
        Number.isFinite(hotWaterElement.size)
      ) {
        const minimumBathSize = minimumFhsBathSizeLitres(numberOfBedrooms);
        if (minimumBathSize !== undefined && hotWaterElement.size < minimumBathSize) {
          warnings.push(fhs(`FHS: increase bath size to at least ${minimumBathSize} L`, 'size'));
        }
      }
      if (
        hotWaterElement.subcategory !== 'InstantElecShower' &&
        hotWaterElement.subcategory !== 'Bath' &&
        (!hotWaterElement.flowrate || hotWaterElement.flowrate === 0)
      ) {
        issues.push(geo('Flowrate cannot be 0', 'flowrate'));
      }
      if (hotWaterElement.subcategory === 'InstantElecShower' && (!hotWaterElement.rated_power || hotWaterElement.rated_power === 0)) {
        issues.push(geo('Rated Power cannot be 0', 'rated_power'));
      }

      // Core schema range validations (red errors)
      if (hotWaterElement.subcategory === 'OtherWaterUseDetails' && hotWaterElement.flowrate !== undefined) {
        if (hotWaterElement.flowrate < 0.1) {
          issues.push(geo('Flowrate must be at least 0.1 L/min for Other water use', 'flowrate'));
        }
        if (hotWaterElement.flowrate > 15) {
          issues.push(geo('Flowrate cannot exceed 15 L/min', 'flowrate'));
        }
      }
      if (hotWaterElement.subcategory !== 'InstantElecShower' && hotWaterElement.flowrate !== undefined) {
        if (hotWaterElement.flowrate > 15) {
          issues.push(geo('Flowrate cannot exceed 15 L/min', 'flowrate'));
        }
      }
      if (hotWaterElement.subcategory === 'InstantElecShower' && hotWaterElement.rated_power !== undefined) {
        if (hotWaterElement.rated_power > 30) {
          issues.push(geo('Rated Power cannot exceed 30 W', 'rated_power'));
        }
      }

      // FHS wrapper-specific validations (orange warnings - stricter than schema)
      if (hotWaterElement.subcategory === 'MixerShower' && hotWaterElement.flowrate !== undefined) {
        if (hotWaterElement.flowrate < 8.0) {
          warnings.push(fhs('FHS: Shower ≥8 L/min', 'flowrate'));
        }
      }
      break;
    }

    case 'ContextShading': {
      const contextElement = element as ContextShading;
      if (contextElement.shading_type !== 'obstacle' && contextElement.shading_type !== 'overhang') {
        issues.push(geo('Shading Type is required', 'shading_type'));
      }
      if (typeof contextElement.height !== 'number' || !Number.isFinite(contextElement.height) || contextElement.height <= 0) {
        issues.push(geo('Height must be greater than 0', 'height'));
      }
      // Distance is derived from geometry - calculate it rather than checking stored value
      if (contextElement.parent_element && elementsById) {
        const parent = Object.values(elementsById).find(e => e.name === contextElement.parent_element);
        if (parent && contextElement.coordinates && parent.coordinates && context.calculateContextShadingDistance) {
          const derivedDistance = context.calculateContextShadingDistance(contextElement, parent);
          if (derivedDistance === 0) {
            issues.push(geo('Distance 0 (derived)', 'distance'));
          }
        } else {
          issues.push(geo('Missing parent or coordinates', 'parent_element'));
        }
      } else {
        issues.push(geo('Parent required', 'parent_element'));
      }
      break;
    }

    // NEW: InfiltrationVentilation validation
    case 'Vents': {
      const ventsElement = element as Vents;
      if (!ventsElement.mid_height_air_flow_path || ventsElement.mid_height_air_flow_path === 0) {
        issues.push(geo('Mid Height Air Flow Path cannot be 0', 'mid_height_air_flow_path'));
      }
      if (!ventsElement.area_cm2 || ventsElement.area_cm2 === 0) {
        issues.push(geo('Area (cm²) cannot be 0', 'area_cm2'));
      }
      if (!ventsElement.parent_element || ventsElement.parent_element.trim() === '') {
        warnings.push(geo('Link parent (recommended)', 'parent_element'));
      } else if (elementsById) {
        const parent = Object.values(elementsById).find(e => e.name === ventsElement.parent_element);
        if (!parent) {
          issues.push(geo('Parent not found', 'parent_element'));
        } else if (parent.type !== 'BuildingElementOpaque' && parent.type !== 'BuildingElementTransparent') {
          issues.push(geo('Parent must be wall or window', 'parent_element'));
        }
      }
      if (complianceValidationEnabled) appendPartFIssuesForElement(ventsElement.id);
      break;
    }

    case 'MechanicalVentilation': {
      const mechVentElement = element as MechanicalVentilation;
      if (!mechVentElement.vent_type || mechVentElement.vent_type.trim() === '') {
        issues.push(geo('Vent Type is required', 'vent_type'));
      }
      pushMechanicalVentilationPerformanceValidation(mechVentElement, issues, warnings);
      const parentName = mechVentElement.parent_element?.trim();
      if (parentName) {
        if (!canMechanicalVentilationInheritHostPlacement(mechVentElement.vent_type)) {
          warnings.push(geo('Parent only applies to hosted MEV fan types', 'parent_element'));
        } else if (elementsById) {
          const parent = Object.values(elementsById).find(e => e.name === parentName);
          if (!parent) {
            issues.push(geo('Parent not found', 'parent_element'));
          } else if (parent.type !== 'BuildingElementOpaque' && parent.type !== 'BuildingElementTransparent') {
            issues.push(geo('Parent must be wall or window', 'parent_element'));
          }
        }
      }
      if (complianceValidationEnabled) appendPartFIssuesForElement(mechVentElement.id);
      if (mechVentElement.vent_type === 'MVHR' && elementsById) {
        const ducts = linkedMvhrDucts(mechVentElement.name);
        const unitPoint = getFirstPoint3(mechVentElement);
        if (ducts.length === 0) {
          issues.push(
            (complianceValidationEnabled ? fhs : geo)('MVHR needs linked ductwork', 'vent_type'),
          );
        }
        const missingRoles = MVHR_DUCT_ROLES.filter(
          (role) => !ducts.some((duct) => duct.duct_type === role),
        );
        if (missingRoles.length > 0) {
          warnings.push(geo(`Missing MVHR duct roles: ${missingRoles.join(', ')}`));
        }
        collectMvhrDuctTopologyWarnings(ducts, { unitPoint }).forEach((warning) => {
          warnings.push(geo(warning.message));
        });

        const terminals = linkedMvhrTerminals(mechVentElement.name);
        for (const role of ['intake', 'exhaust'] as const) {
          const roleTerminals = terminals.filter((terminal) => terminal.terminal_type === role);
          if (roleTerminals.length === 0) {
            issues.push(geo(`MVHR needs a linked ${role} terminal`));
          } else if (roleTerminals.length > 1) {
            issues.push(geo(`MVHR accepts one ${role} terminal`));
          }
          const roleDucts = ducts.filter((duct) => duct.duct_type === role);
          if (
            roleTerminals.length === 1 &&
            roleDucts.length > 0 &&
            !terminalIsNearDuctEndpoint(roleTerminals[0]!, roleDucts)
          ) {
            warnings.push(geo(`${role} terminal is not near a matching duct endpoint`));
          }
        }
      }
      break;
    }

    case 'CombustionAppliances': {
      const combustionElement = element as CombustionAppliances;
      if (!combustionElement.appliance_type || combustionElement.appliance_type.trim() === '') {
        issues.push(geo('Appliance Type is required', 'appliance_type'));
      }
      if (!combustionElement.exhaust_situation || combustionElement.exhaust_situation.trim() === '') {
        issues.push(geo('Exhaust Situation is required', 'exhaust_situation'));
      }
      if (!combustionElement.fuel_type || combustionElement.fuel_type.trim() === '') {
        issues.push(geo('Fuel Type is required', 'fuel_type'));
      }
      if (!combustionElement.supply_situation || combustionElement.supply_situation.trim() === '') {
        issues.push(geo('Supply Situation is required', 'supply_situation'));
      }
      break;
    }

    case 'OnSiteGeneration': {
      const onSiteElement = element as OnSiteGeneration;
      if (!onSiteElement.peak_power || onSiteElement.peak_power < 0.001 || onSiteElement.peak_power > 100) {
        issues.push(geo('Peak Power must be between 0.001 and 100 kWp', 'peak_power'));
      }
      if (onSiteElement.pitch === undefined || onSiteElement.pitch < 0 || onSiteElement.pitch > 90) {
        issues.push(geo('Pitch must be between 0 and 90 degrees', 'pitch'));
      }
      if (onSiteElement.orientation360 === undefined || onSiteElement.orientation360 < 0 || onSiteElement.orientation360 > 360) {
        issues.push(geo('Orientation must be between 0 and 360 degrees', 'orientation360'));
      }
      if (onSiteElement.base_height === undefined || onSiteElement.base_height <= 0 || onSiteElement.base_height > 500) {
        issues.push(geo('Base Height must be between 0.01 and 500 m', 'base_height'));
      }
      if (!onSiteElement.width || onSiteElement.width <= 0 || onSiteElement.width > 100) {
        issues.push(geo('Width must be between 0 and 100 m', 'width'));
      }
      if (!onSiteElement.height || onSiteElement.height <= 0 || onSiteElement.height > 100) {
        issues.push(geo('Height must be between 0 and 100 m', 'height'));
      }
      if (
        typeof onSiteElement.pitch === 'number' &&
        onSiteElement.pitch > 0 &&
        onSiteElement.coordinates &&
        onSiteElement.coordinates.length >= 3
      ) {
        pushSelfIntersectingSlopedPolygonWarning(
          onSiteElement.coordinates,
          warnings,
          'PV footprint self-intersects; width, height and footprint area may be misleading',
        );
      }
      // Soft host link: when the panel is attached to a roof, surface non-blocking warnings if
      // the panel hangs off the roof or its (overridden) properties diverge from the roof's.
      if (onSiteElement._pvHostRoofId && elementsById) {
        const host = elementsById[onSiteElement._pvHostRoofId];
        if (host && host.type === 'BuildingElementOpaque') {
          const hostRoof = host as BuildingElementOpaque;
          const hostName = hostRoof.name || 'host roof';
          if (!isPanelFullyOnRoof(onSiteElement, hostRoof)) {
            warnings.push(geo(`Panel extends beyond ${hostName}`, 'coordinates'));
          }
          const derived = deriveFromHostRoof(
            onSiteElement,
            hostRoof,
            elementsById ? withEffectiveStoreyHeights(floors ?? [], Object.values(elementsById)) : floors,
            context.globalOrientationOffset,
          );
          const epsAng = 0.5;
          const epsBh = 0.01;
          if (
            typeof onSiteElement.pitch === 'number' &&
            typeof derived.pitch === 'number' &&
            Math.abs(onSiteElement.pitch - derived.pitch) > epsAng
          ) {
            warnings.push(
              geo(`Pitch differs from ${hostName} (${roundToTwoDecimals(derived.pitch)}°)`, 'pitch'),
            );
          }
          if (
            typeof onSiteElement.orientation360 === 'number' &&
            typeof derived.orientation360 === 'number' &&
            Math.abs(onSiteElement.orientation360 - derived.orientation360) > epsAng
          ) {
            warnings.push(
              geo(
                `Orientation differs from ${hostName} (${roundToTwoDecimals(derived.orientation360)}°)`,
                'orientation360',
              ),
            );
          }
          if (
            typeof onSiteElement.base_height === 'number' &&
            typeof derived.base_height === 'number' &&
            Math.abs(onSiteElement.base_height - derived.base_height) > epsBh
          ) {
            warnings.push(
              geo(
                `Base height differs from ${hostName} surface (${derived.base_height} m)`,
                'base_height',
              ),
            );
          }
        }
      }
      break;
    }

    case 'ElectricBattery': {
      const batteryElement = element as ElectricBattery;
      if (!batteryElement.capacity || batteryElement.capacity <= 0 || batteryElement.capacity > 50) {
        issues.push(geo('Capacity must be between 0 and 50 kWh', 'capacity'));
      }
      if (batteryElement.charge_discharge_efficiency_round_trip === undefined || batteryElement.charge_discharge_efficiency_round_trip < 0 || batteryElement.charge_discharge_efficiency_round_trip > 1) {
        issues.push(geo('Charge/Discharge Efficiency must be between 0 and 1', 'charge_discharge_efficiency_round_trip'));
      }
      if (!batteryElement.battery_location || (batteryElement.battery_location !== 'inside' && batteryElement.battery_location !== 'outside')) {
        issues.push(geo('Battery Location must be "inside" or "outside"', 'battery_location'));
      }
      break;
    }

    case 'System': {
      const sysElement = element as System;
      const validSubcategories = [
        'HeatSourceWet',
        'HotWaterSource',
        'HotWaterDemand',
        'InfiltrationVentilation',
        'SpaceCoolSystem',
        'SpaceHeatSystem',
        'WWHRS',
      ];
      if (!sysElement.subcategory || !validSubcategories.includes(sysElement.subcategory)) {
        issues.push(geo('System target root must be a supported FHS family', 'subcategory'));
      }
      const preset = sysElement.system_preset;
      const hasPresetName = typeof preset === 'string' && preset.trim() !== '';
      const extraJson = sysElement.extra_json;
      const hasPcdbPayload =
        extraJson &&
        typeof extraJson === 'object' &&
        !Array.isArray(extraJson) &&
        (extraJson as Record<string, unknown>)._pcdb &&
        typeof (extraJson as Record<string, unknown>)._pcdb === 'object' &&
        !Array.isArray((extraJson as Record<string, unknown>)._pcdb);
      const isSpaceHeatSystem = sysElement.subcategory === 'SpaceHeatSystem';
      const hasSpaceHeatSystemPayload = systemElementProvidesSpaceHeatSystem(sysElement);
      if (!sysElement.isPlaceholder && isSpaceHeatSystem && !hasSpaceHeatSystemPayload) {
        issues.push(
          geo(
            'SpaceHeatSystem payload is required — choose a space-heating preset or complete Advanced fields',
            'system_preset',
          ),
        );
      }
      if (
        !sysElement.isPlaceholder &&
        !hasPresetName &&
        !hasPcdbPayload &&
        !(isSpaceHeatSystem && !hasSpaceHeatSystemPayload)
      ) {
        warnings.push(
          geo(
            'No system preset selected — pick a library preset or complete required fields in Advanced',
            'system_preset',
          ),
        );
      }
      if (complianceValidationEnabled && elementsById) {
        for (const msg of hotWaterSourceHeatSourceWetLinkMessagesForElement(
          element,
          Object.values(elementsById),
        )) {
          issues.push(fhs(msg, 'extra_json'));
        }
        for (const msg of spaceHeatSystemHeatSourceWetLinkMessagesForElement(
          element,
          Object.values(elementsById),
        )) {
          issues.push(fhs(msg, 'extra_json'));
        }
      }
      break;
    }
  }

  // Schema checks are an explicit host capability. The Community composition may
  // omit them while retaining all schema-independent geometry validation.
  if (schemaPort.availability === 'available') {
    const schemaSubtype = schemaPort.getSchemaSubtypeForElementData(
      element.type,
      element as unknown as Record<string, unknown>,
    );

    // Active-schema validation: use FHS when compliance validation is enabled, core otherwise.
    const schemaMode = complianceValidationEnabled ? 'fhs' : 'core';
    const activeSubschema = schemaPort.getElementSubschema(schemaMode, element.type, schemaSubtype);
    if (activeSubschema) {
      const elementData = element as unknown as Record<string, unknown>;
      const extraJson = readRecord(elementData.extra_json);
      const opaqueFabricVariant =
        element.type === 'BuildingElementOpaque'
          ? classifyOpaqueFabricVariantFromElement(elementData as Record<string, unknown>)
          : undefined;
      const issueFactory = complianceValidationEnabled ? fhs : schema;
      const schemaProperties = readRecord(activeSubschema.properties);
      const requiredFields: string[] = Array.isArray(activeSubschema.required)
        ? activeSubschema.required.filter((field): field is string => typeof field === 'string')
        : [];
      const conditionalRequiredFields = schemaPort.getConditionalRequiredFields(
        schemaMode,
        element.type,
        elementData,
        schemaSubtype,
      );
      const allRequiredFields = [...new Set([...requiredFields, ...conditionalRequiredFields])];

      for (const field of allRequiredFields) {
        // Check if field exists in element directly or in extra_json
        // Also check for null/undefined values (they count as missing)
        // NOTE: OnSiteGeneration has a naming collision:
        // - In GeometryCanvas state, element.type is the element-kind (e.g. "OnSiteGeneration")
        // - In the FHS schema, OnSiteGeneration.<name>.type is the PV system kind and must be "PhotovoltaicSystem"
        // In the UI we store the PV system kind as generation_type, so map it here for schema checks.
        const isOnSiteTypeCollision = element.type === 'OnSiteGeneration' && field === 'type';
        const fieldValue = isOnSiteTypeCollision
          ? (elementData.generation_type ?? extraJson.generation_type ?? extraJson.type)
          : (
            element.type === 'BuildingElementOpaque' && field === 'area'
                    ? (elementsById ? getElementEffectiveArea(element, elementsById, context.globalOrientationOffset) : elementData[field] ?? extraJson[field])
              : (elementData[field] ?? extraJson[field])
          );
        const hasField = isOnSiteTypeCollision
          ? (('generation_type' in elementData) || (extraJson && ('generation_type' in extraJson || 'type' in extraJson)))
          : (field in elementData || (extraJson && field in extraJson));
        const hasValue = requiredSchemaFieldHasValue(
          field,
          hasField,
          fieldValue,
          { properties: schemaProperties },
        );

        if (!hasValue) {
          // While defaults are still loading, assume template defaults exist to
          // avoid showing false "required" errors that disappear once defaults arrive.
          if (defaultsLoading) continue;

          // Check if field has a default value (from defaults template or schema)
          // If a default exists, don't add a validation issue (defaults will be applied)
          // For MechanicalVentilation, pass vent_type as subtype to filter defaults correctly
          const hasDefault = (context.defaultsLookup?.hasDefaultValue ?? hasDefaultValue)(
            field,
            element.type,
            activeSubschema as unknown as {
              properties?: Record<string, { default?: unknown } | undefined>;
            },
            element.type === 'MechanicalVentilation' ? schemaSubtype : undefined,
            opaqueFabricVariant,
          );

          if (!hasDefault) {
            // Format field name for display (convert snake_case to Title Case)
            const displayName = field
              .split('_')
              .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');
            const message = complianceValidationEnabled
              ? `FHS: ${displayName} required`
              : `${displayName} required`;
            issues.push(issueFactory(message, field));
          }
        }
      }

      // Additionally validate schema constraints (min/max/enum/etc.) for any values
      // the user has set. This catches cases that are not "missing required fields"
      // but still fail active-schema validation on save.
      for (const [field, fieldSchema] of Object.entries(schemaProperties)) {
        const isOnSiteTypeCollision = element.type === 'OnSiteGeneration' && field === 'type';
        const fieldValue = isOnSiteTypeCollision
          ? (elementData.generation_type ?? extraJson.generation_type ?? extraJson.type)
          : (
            element.type === 'BuildingElementOpaque' && field === 'area'
                  ? (elementsById ? getElementEffectiveArea(element, elementsById, context.globalOrientationOffset) : elementData[field] ?? extraJson[field])
              : (elementData[field] ?? extraJson[field])
          );
        if (fieldValue === null || fieldValue === undefined) continue;

        // Only run AJV validation for fields that actually declare constraints,
        // to keep this lightweight.
        const fs = readRecord(fieldSchema);
        const hasConstraints =
          fs.minimum !== undefined ||
          fs.maximum !== undefined ||
          fs.exclusiveMinimum !== undefined ||
          fs.exclusiveMaximum !== undefined ||
          (Array.isArray(fs.enum) && fs.enum.length > 0);

        if (!hasConstraints) continue;

        const v = schemaPort.validateProperty(
          schemaMode,
          element.type,
          schemaSubtype,
          field,
          fieldValue,
        );
        if (!v.valid && v.errors && v.errors.length > 0) {
          const displayName = field
            .split('_')
            .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
          const message = complianceValidationEnabled
            ? `FHS: ${displayName} — ${v.errors[0]}`
            : `${displayName} — ${v.errors[0]}`;
          issues.push(issueFactory(message, field));
        }
      }
    }
  }

  // FHS strict: areal heat capacity on fabric elements must be one of the discrete mass bands (J/m²K).
  // Use the same effective value as the construction table / HEM merge: extra_json, assembly envelope,
  // then project defaults_template (via getDefaultValueForElementField inside effectiveFabricDisplayValues).
  const fabricTypesForArealHeat = [
    'BuildingElementOpaque',
    'BuildingElementGround',
    'BuildingElementAdjacentConditionedSpace',
    'BuildingElementAdjacentUnconditionedSpace_Simple',
    'BuildingElementPartyWall',
  ];
  if (
    complianceValidationEnabled &&
    !defaultsLoading &&
    fabricTypesForArealHeat.includes(element.type)
  ) {
    const eff = effectiveFabricDisplayValues(element, context.defaultsLookup);
    const kJ = eff.arealHeat_kJ_m2K;
    if (kJ != null && Number.isFinite(kJ)) {
      const ahc = kJ * 1000;
      if (!matchesFhsDiscreteArealHeatCapacity(ahc)) {
        issues.push(
          fhs(
            `FHS: areal heat capacity must be one of 50,000 / 75,000 / 110,000 / 175,000 / 250,000 J/(m²·K) (effective ${Math.round(ahc)})`,
            'areal_heat_capacity',
          ),
        );
      }
    }
  }

  if (dbg) {
    const dt = performance.now() - t0;
    // Keep a tiny counter on the debug object (stored on window) so it survives HMR.
    dbg.calls = (dbg.calls ?? 0) + 1;
    dbg.ms = (dbg.ms ?? 0) + dt;
    const every = dbg.logEvery ?? 200;
    if (dbg.calls % every === 0) {
      console.info('[validateElement][debug]', {
        calls: dbg.calls,
        msTotal: Math.round(dbg.ms),
        msAvg: Math.round((dbg.ms / dbg.calls) * 1000) / 1000,
        last: { type: element.type, name: element.name, hasContext: !!elementsById },
      });
    }
  }

  // u_value vs thermal_resistance_construction: HEM stores construction R (layers only); U includes
  // ISO 13789 surface resistances — same rule as `assemblyCalculator.computeOpaqueUAndTotals`.
  // Ground / soil paths use a different U↔R relationship — skip.
  const layeredConstructionFabricTypes = [
    'BuildingElementOpaque',
    'BuildingElementTransparent',
    'BuildingElementAdjacentConditionedSpace',
    'BuildingElementAdjacentUnconditionedSpace_Simple',
    'BuildingElementPartyWall',
  ];
  if (layeredConstructionFabricTypes.includes(element.type)) {
    const elData = element as unknown as Record<string, unknown>;
    const extra = readRecord(elData.extra_json);
    const rValue = elData.thermal_resistance_construction ?? extra.thermal_resistance_construction;
    const uValue = elData.u_value ?? extra.u_value;
    if (
      typeof rValue === 'number' && Number.isFinite(rValue) && rValue > 0 &&
      typeof uValue === 'number' && Number.isFinite(uValue) && uValue > 0
    ) {
      const pitchRaw = elData.pitch ?? extra.pitch;
      const pitchDeg =
        typeof pitchRaw === 'number' && Number.isFinite(pitchRaw) ? pitchRaw : 90;
      const { u: expectedU } = computeOpaqueUAndTotals(rValue, pitchDeg);
      if (Math.abs(uValue - expectedU) >= 0.02) {
        const fmtU = roundToTwoDecimals(expectedU).toFixed(2);
        const fmtR = roundToTwoDecimals(rValue).toFixed(2);
        warnings.push(
          geo(
            `U/R mismatch — expected U≈${fmtU} W/m²K from construction R=${fmtR} m²K/W (incl. ISO 13789 surface resistances)`,
            'u_value',
          ),
        );
      }
    }
  }

  // Warning checks (only if elementsById is provided for context)
  if (elementsById) {
    // Check for FHS zone consolidation warning
    // This warning appears on elements in zones that will be consolidated
    if (element.zoneId && !element.isPlaceholder) {
      if (complianceValidationEnabled) {
        const realZones = zones.filter(z => !z.isPlaceholder);
        if (realZones.length > 1) {
          // FHS consolidation keeps the first defined real zone.
          const firstZone = realZones[0];
          const elementZone = zones.find(z => z.id === element.zoneId);

          // If this element belongs to a zone that will be consolidated (not the first zone)
          if (elementZone && elementZone.id !== firstZone.id) {
            warnings.push(geo(`"${elementZone.name}"→"${firstZone.name}" (FHS)`, 'zoneId'));
          }
        }
      }
    }

    if (element.type === 'BuildingElementGround' && !element.isPlaceholder) {
      const ground = element as BuildingElementGround;
      const details = computeGroundExposedPerimeterDetails(elementsById, ground);
      const perimeter = typeof ground.perimeter === 'number' && Number.isFinite(ground.perimeter)
        ? ground.perimeter
        : null;
      const hasReliableExposedPerimeter =
        details.valueM > 0 ||
        (details.shapePerimeterM > 0 && details.linkedBoundaryPerimeterM >= Math.max(0, details.shapePerimeterM - 0.05));
      if (hasReliableExposedPerimeter && perimeter != null && Math.abs(perimeter - details.valueM) > 0.05) {
        warnings.push(
          geo(
            `Perimeter ${formatNumberForIssue(perimeter)} m differs from exposed wall-linked perimeter ${formatNumberForIssue(details.valueM)} m`,
            'perimeter',
          ),
        );
      }
      // A non-basement ground element drawn on an upper canvas storey is almost always a legacy
      // room-tool artefact — it exports ground-contact fabric on a floor that isn't the ground.
      // Basements (z < 0) and the ground storey (z = 0) never warn.
      if (!isBasementGroundElement(ground)) {
        const canvasFloorZ = getElementCanvasFloorZValue(element, floors);
        if (canvasFloorZ !== undefined && canvasFloorZ >= 1) {
          warnings.push(
            geo(
              'Ground-contact floor above the ground storey — change the element type if this should be an internal or exposed floor',
            ),
          );
        }
      }
    }

    // Helper functions for warning checks
    const getSnappedVertices = (el: Element): number => {
      if (!el.coordinates) return 0;
      let count = 0;
      el.coordinates.forEach((coord) => {
        for (const otherId of Object.keys(elementsById)) {
          if (otherId === el.id) continue;
          const other = elementsById[otherId];
          if (!other.coordinates) continue;
          for (const otherCoord of other.coordinates) {
            if (coord.x === otherCoord.x && coord.y === otherCoord.y && coord.z === otherCoord.z) {
              count++;
              return;
            }
          }
        }
      });
      return count;
    };

    // Warning 1: Windows/doors without parents
    if (element.type === 'BuildingElementTransparent' ||
        (element.type === 'BuildingElementOpaque' && (element as BuildingElementOpaque).is_external_door)) {
      if (!element.parent_element || element.parent_element.trim() === '') {
        warnings.push(geo('Link wall/roof parent', 'parent_element'));
      }
    }

    const floorControlParent = getFloorControlParentElement(element, elementsById);
    const parentControlledFloorZ = getParentControlledFloorZ(element, elementsById, floors);
    if (floorControlParent && parentControlledFloorZ !== undefined) {
      const hasExplicitFloorId = typeof element.floorId === 'string' && element.floorId.trim() !== '';
      const canCompareFloor =
        !preservesCoordinateZForParentControlledFloor(element) || hasExplicitFloorId;
      const elementFloorZ = canCompareFloor ? getElementCanvasFloorZValue(element, floors) : undefined;
      if (elementFloorZ !== undefined && Math.floor(elementFloorZ) !== Math.floor(parentControlledFloorZ)) {
        warnings.push(
          geo(
            `Floor is inherited from parent ${floorControlParent.name || 'element'}`,
            'floorId',
          ),
        );
      }
    }

    // Warning 2: BuildingElementOpaque (line type) not external doors missing snaps
    if (element.type === 'BuildingElementOpaque') {
      const opaque = element as BuildingElementOpaque;
      if (!opaque.is_external_door && opaque.coordinates && opaque.coordinates.length === 2) {
        const snappedCount = getSnappedVertices(opaque);
        if (snappedCount < 2) {
          warnings.push(geo('Line ends not snapped'));
        }
      }
    }

    // Warning 3: Ground elements overlapping on multiple floors
    if (element.type === 'BuildingElementGround' && element.coordinates && element.coordinates.length >= 3) {
      const elementZ = element.coordinates[0]?.z;
      for (const otherId of Object.keys(elementsById)) {
        const other = elementsById[otherId];
        if (other.id === element.id || other.type !== 'BuildingElementGround' || !other.coordinates || other.coordinates.length < 3) continue;
        const otherZ = other.coordinates[0]?.z;
        // Check if same x,y position but different z (different floors)
        if (otherZ !== elementZ && elementZ > otherZ) {
          // Simple bounding box check for overlap
          const xs1 = element.coordinates.map(c => c.x);
          const ys1 = element.coordinates.map(c => c.y);
          const xs2 = other.coordinates.map(c => c.x);
          const ys2 = other.coordinates.map(c => c.y);
          const minX1 = Math.min(...xs1); const maxX1 = Math.max(...xs1);
          const minY1 = Math.min(...ys1); const maxY1 = Math.max(...ys1);
          const minX2 = Math.min(...xs2); const maxX2 = Math.max(...xs2);
          const minY2 = Math.min(...ys2); const maxY2 = Math.max(...ys2);
          if (!(maxX1 < minX2 || maxX2 < minX1 || maxY1 < minY2 || maxY2 < minY1)) {
            warnings.push(geo('Ground overlaps storey — check Z'));
            break;
          }
        }
      }
    }

    // Warning 4: Polygon objects with unsnapped vertices (only for specific element types)
    const polygonCapableTypes = [
      'BuildingElementOpaque',
      'BuildingElementGround',
      'BuildingElementAdjacentConditionedSpace',
      'BuildingElementAdjacentUnconditionedSpace_Simple',
      'BuildingElementPartyWall',
    ];
    if (element.coordinates && element.coordinates.length >= 3 && polygonCapableTypes.includes(element.type)) {
      const shape = getElementShape(element);
      if (shape === 'polygon') {
        const snappedCount = getWallSupportedSnappedVertices(element, elementsById).size;
        const totalVertices = element.coordinates.length;
        if (snappedCount < totalVertices) {
          warnings.push(geo(`${totalVertices - snappedCount} corners not snapped`));
        }
      }
    }

    // Warning 5: base_height on upper floors should sit inside the storey it belongs to.
    // - Below the slab → the user likely entered a height-above-floor instead of an absolute height.
    // - Above the storey ceiling → either the element is on the wrong floor or the floor heights need adjusting.
    // - Fabric whose projected top edge clears the ceiling → flagged separately so users can correct
    //   either the element height/pitch or the storey height in the floor picker.
    // Adjacent/party types are excluded — HEM has no fabric base_height there; optional `_base_height` / base_height is for 3D plot only.
    if (floors && floors.length > 0) {
      const fabricWithBaseHeight = ['BuildingElementOpaque', 'BuildingElementTransparent'] as const;
      if (fabricWithBaseHeight.includes(element.type as (typeof fabricWithBaseHeight)[number]) && !element.isPlaceholder) {
        const coords = element.coordinates;
        if (coords && coords.length > 0) {
          const z = coords[0].z;
          if (typeof z === 'number' && Number.isFinite(z)) {
            const floorZIndex = Math.floor(z);
            const bh = (element as { base_height?: unknown }).base_height;
            const hasBaseHeight = typeof bh === 'number' && Number.isFinite(bh);
            const allElements = elementsById ? Object.values(elementsById) : [];
            const effFloors = withEffectiveStoreyHeights(floors, allElements);
            if (floorZIndex !== 0 && hasBaseHeight) {
              const plate = calculateDerivedBaseHeight(z, effFloors);
              const TOL = 0.05;
              if ((bh as number) + TOL < plate) {
                warnings.push(
                  geo(
                    `Base height ${bh} m < slab ~${plate} m — use height above ground`,
                    'base_height',
                  ),
                );
              }
            }
            if (hasBaseHeight) {
              const floor = floors.find((f) => f.zIndex === floorZIndex);
              if (floor) {
                const storey = getEffectiveStoreyHeight(floor, allElements);
                if (storey > 0) {
                  const plate = calculateDerivedBaseHeight(z, effFloors);
                  const ceiling = plate + storey;
                  const TOL = 0.05;
                  if ((bh as number) > ceiling + TOL) {
                    warnings.push(
                      geo(
                        `Base height ${bh} m > storey ceiling ~${roundToTwoDecimals(ceiling)} m`,
                        'base_height',
                      ),
                    );
                  }
                  const elementHeight = (element as { height?: unknown }).height;
                  if (
                    typeof elementHeight === 'number' &&
                    Number.isFinite(elementHeight) &&
                    elementHeight > 0
                  ) {
                    const verticalHeight = projectedVerticalHeightForStoreyCheck(
                      element as { pitch?: unknown },
                      elementHeight,
                    );
                    const top = (bh as number) + verticalHeight;
                    if (top > ceiling + TOL) {
                      warnings.push(
                        geo(
                          `Top of element ~${roundToTwoDecimals(top)} m > storey ceiling ~${roundToTwoDecimals(ceiling)} m`,
                          'height',
                        ),
                      );
                    }
                  }
                }
              }
            }
            if (element.type === 'BuildingElementOpaque' && isExternalLineWall(element) && allElements.length > 0) {
              const suspendedTarget = findSuspendedGroundSurfaceForLineElement(element, allElements);
              if (suspendedTarget) {
                const baseEl = elementBaseElevationMForTb(element, effFloors);
                if (Math.abs(baseEl - suspendedTarget.surfaceM) > SUSPENDED_FLOOR_BASE_HEIGHT_TOLERANCE_M) {
                  warnings.push(
                    geo(
                      `Base height should match suspended floor upper surface ~${roundToTwoDecimals(suspendedTarget.surfaceM)} m`,
                      'base_height',
                    ),
                  );
                }
              }
              const basementTarget = findLinkedBasementGroundForLineElement(element, allElements);
              if (basementTarget) {
                const baseEl = elementBaseElevationMForTb(element, effFloors);
                if (Math.abs(baseEl - basementTarget.targetBaseHeightM) > SUSPENDED_FLOOR_BASE_HEIGHT_TOLERANCE_M) {
                  const targetLabel = basementTarget.ground.floor_type === 'Unheated_basement'
                    ? 'unheated basement wall height above ground'
                    : 'basement floor surface';
                  warnings.push(
                    geo(
                      `Base height should match ${targetLabel} ~${roundToTwoDecimals(basementTarget.targetBaseHeightM)} m`,
                      'base_height',
                    ),
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  const label = element.name && element.name.trim()
    ? `${element.name.trim()} (${element.type})`
    : element.type;
  const prefix = label ? `${label}: ` : '';
  const withPrefix = (item: ValidationIssue): ValidationIssue => ({
    ...item,
    message: prefix ? `${prefix}${item.message}` : item.message,
  });
  const prefixedIssues = issues.map(withPrefix);
  const prefixedWarnings = warnings.map(withPrefix);

  const deduplicateByFieldKey = (items: ValidationIssue[]): ValidationIssue[] => {
    const sourcePriority: Record<ValidationSource, number> = { geometry: 0, schema: 1, fhs: 2 };
    const byFieldKey = new Map<string, ValidationIssue>();
    const noFieldKey: ValidationIssue[] = [];
    for (const item of items) {
      if (!item.fieldKey) {
        noFieldKey.push(item);
        continue;
      }
      const existing = byFieldKey.get(item.fieldKey);
      if (!existing || sourcePriority[item.source] < sourcePriority[existing.source]) {
        byFieldKey.set(item.fieldKey, item);
      }
    }
    return [...byFieldKey.values(), ...noFieldKey];
  };
  const dedupedIssues = deduplicateByFieldKey(prefixedIssues);
  const dedupedWarnings = deduplicateByFieldKey(prefixedWarnings);

  return {
    hasIssues: dedupedIssues.length > 0,
    issues: dedupedIssues,
    hasWarnings: dedupedWarnings.length > 0,
    warnings: dedupedWarnings,
    hasMissingElements: false,
    missingElements: []
  };
};

export type GeometryValidationSummary = {
  warnings: string[];
  criticalIssues: string[];
  missingElements: MissingElement[];
};

export const collectGeometryValidation = (
  zones: Zone[],
  elements: Element[],
  options: {
    schemaPort: GeometrySchemaPort;
    floors?: Floor[];
    complianceValidationEnabled?: boolean;
    defaultThermalBridging?: number;
    partOActiveCoolingRequired?: boolean;
    partFContext?: PartFDetectionContext;
    calculateContextShadingDistance?: (contextElement: ContextShading, parent: Element) => number;
    defaultsLoading?: boolean;
    junctionPsiWorkspaceByType?: Record<string, number>;
    complianceSettings?: GlobalSettingsShape;
    globalOrientationOffset?: number;
  },
): GeometryValidationSummary => {
  const warnings: string[] = [];
  const criticalIssues: string[] = [];
  const elementsById: Record<string, Element> = {};

  elements.forEach((element) => {
    if (!element?.id) return;
    elementsById[element.id] = element;
  });

  const linearThermalBridgeIssues = findLinearThermalBridgeIssues(elements);
  const floorStackWarningElementIds = options.floors
    ? getFloorStackWarningElementIds(elements, options.floors)
    : new Set<string>();

  elements.forEach((element) => {
    if (element.isPlaceholder) return;
    const validation = validateElementCore(element, {
      schemaPort: options.schemaPort,
      elementsById,
      zones,
      floors: options.floors,
      globalOrientationOffset: options.globalOrientationOffset,
      complianceValidationEnabled: options.complianceValidationEnabled || false,
      complianceSettings: options.complianceSettings,
      numberOfBedrooms: options.complianceSettings?.NumberOfBedrooms,
      calculateContextShadingDistance: options.calculateContextShadingDistance,
      defaultsLoading: options.defaultsLoading,
      junctionPsiWorkspaceByType: options.junctionPsiWorkspaceByType,
      linearThermalBridgeIssues,
      floorStackWarningElementIds,
    });
    warnings.push(...validation.warnings.map(w => w.message));
    criticalIssues.push(...validation.issues.map(i => i.message));
  });

  const primaryFhsZoneId = zones.find((zone) => !zone.isPlaceholder)?.id;
  zones.forEach((zone) => {
    if (zone.isPlaceholder) return;
    const validation = validateZone(zone, {
      elementsById,
      complianceValidationEnabled: options.complianceValidationEnabled || false,
      defaultThermalBridging: options.defaultThermalBridging,
      primaryFhsZoneId,
    });
    warnings.push(...validation.warnings.map(w => w.message));
    criticalIssues.push(...validation.issues.map(i => i.message));
  });

  const missingElements = detectMissingElements(
    zones,
    elementsById,
    options.complianceValidationEnabled || false,
    options.defaultThermalBridging,
    options.partOActiveCoolingRequired,
    options.partFContext,
  );
  if (options.complianceValidationEnabled) {
    const partFInput = options.partFContext
      ? partFInputFromContext(options.partFContext, elements)
      : null;
    if (!partFInput) {
      warnings.push(
        'Part F ventilation sufficiency was not checked (dwelling room counts missing).',
      );
    }
  }
  if (options.complianceSettings) {
    warnings.push(
      ...collectGlobalSettingsWarnings({
        elements,
        floors: options.floors,
        zones,
        complianceValidationEnabled: options.complianceValidationEnabled,
        complianceSettings: options.complianceSettings,
        globalOrientationOffset: options.globalOrientationOffset,
      }),
    );
  }

  const summary = {
    warnings,
    criticalIssues,
    missingElements,
  };
  return summary;
};
