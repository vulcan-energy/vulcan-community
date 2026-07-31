// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  BuildingElementTransparent,
  Element,
  Floor,
  Zone,
} from '../geometry/types';
import { resolveBuildingElementPitch } from '../geometry/derivePitchFromGeometry';
import { getAreaBasedElementExportGeometry } from './elementArea';
import {
  calculateGroundFloorBasementVentilationBaseHeight,
  calculateDwellingDetailsSuggestion,
  calculateSuggestedVentilationBaseHeight,
  calculateSuggestedVentilationHeight,
  hasGroundFloorBasementVentilationBaseHeightCandidate,
  withEffectiveStoreyHeights,
} from './zoneDerivation';
import { fhsStoreyToCanvasFloor } from './storeySemantics';
import { calculateDwellingLengthWidthFromGroundElements } from './buildingFootprintDimensions';

/**
 * Parse a dwelling-dimension override typed into a global-settings field.
 *
 * Returns `undefined` for anything that is not a usable measurement — text, a
 * lone minus sign, a negative number — meaning "no override, use the derived
 * value", exactly as clearing the field does. Coercing such input to 0 instead
 * stores a hard `0` as an *explicit manual override*, which reaches the HEM
 * input as a deliberate value and silently replaces the derived geometry.
 */
export function parseDimensionOverride(raw: string): number | undefined {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * FHS occupancy is undefined below one bedroom.
 *
 * The upstream wrapper bails out of `calc_n_occupants` with
 * "Invalid number of bedrooms: 0", and the FHS schema declares
 * `NumberOfBedrooms` as `{"type": "integer", "minimum": 0}` — so a 0 is
 * schema-valid and survives all the way to the run, surfacing as an opaque
 * `[fhs_preflight]` failure at save time. Catch it in the editor instead.
 *
 * A bedsit counts as one bedroom (HEM-FHS guidance, Dwelling Details §2.2.4).
 *
 * Returns `undefined` when the count is unset or non-finite — "missing" is a
 * separate required-field issue, not an invalid value.
 */
export function fhsBedroomCountIssue(bedrooms: number | undefined): string | undefined {
  if (typeof bedrooms !== 'number' || !Number.isFinite(bedrooms)) return undefined;
  if (bedrooms >= 1) return undefined;
  return 'FHS requires at least one bedroom (a bedsit counts as one). Assign bedroom space labels or set the count manually.';
}

export type GlobalSettingsShape = Partial<{
  build_type: 'flat' | 'house';
  storeys_in_dwelling: number;
  storey_of_dwelling: number;
  storeys_in_building: number;
  NumberOfBedrooms: number;
  BuildingLength: number;
  BuildingWidth: number;
  ColdWaterSource: 'mains water' | 'header tank';
  AirPermeability_ventilation_zone_height: number;
  Ventilation_ventilation_zone_base_height: number;
}>;

const STOREY_BASE_HEIGHT_TOLERANCE_M = 0.1;
const BUILDING_DIMENSION_TOLERANCE_M = 1e-4;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function hasCompleteFloorHeightsForBase(elements: Element[], floors: Floor[] | undefined, floorIndex: number): boolean {
  if (floorIndex === 0) return true;
  if (!floors) return false;
  const effectiveFloors = withEffectiveStoreyHeights(floors, elements);
  if (!effectiveFloors) return false;
  const requiredZs =
    floorIndex > 0
      ? Array.from({ length: floorIndex }, (_, index) => index)
      : Array.from({ length: Math.abs(floorIndex) }, (_, index) => floorIndex + index);
  for (const z of requiredZs) {
    const floor = effectiveFloors.find((candidate) => candidate.zIndex === z);
    if (!floor || !Number.isFinite(floor.height) || floor.height <= 0) return false;
  }
  return true;
}

function canCheckVentilationBaseHeight(args: {
  elements: Element[];
  floors?: Floor[];
  buildType?: 'flat' | 'house';
  storeysInDwelling?: number;
  storeyOfDwelling?: number;
  ventilationZoneHeight?: number;
}): boolean {
  if (getBasementGroundFloorBaseHeightCheckWarning(args)) return false;
  if (args.buildType === 'house') return true;
  if (args.storeyOfDwelling === undefined) return true;

  const floorIndex = fhsStoreyToCanvasFloor(args.storeyOfDwelling);
  if (floorIndex === 0) return true;
  if (hasCompleteFloorHeightsForBase(args.elements, args.floors, floorIndex)) return true;

  return (
    args.ventilationZoneHeight !== undefined &&
    args.ventilationZoneHeight > 0 &&
    args.storeysInDwelling !== undefined &&
    args.storeysInDwelling > 0
  );
}

export function resolveEffectiveVentilationZoneBaseHeight(args: {
  elements: Element[];
  floors?: Floor[];
  complianceSettings: GlobalSettingsShape;
}): number | undefined {
  const explicit = finiteNumber(
    args.complianceSettings.Ventilation_ventilation_zone_base_height,
  );
  if (explicit !== undefined) return explicit;

  const dwelling = calculateDwellingDetailsSuggestion(args.elements);
  const buildType = args.complianceSettings.build_type ?? dwelling.buildType;
  if (!buildType) return undefined;

  const storeysInDwelling = finiteNumber(args.complianceSettings.storeys_in_dwelling)
    ?? dwelling.storeysInDwelling;
  const storeyOfDwelling = finiteNumber(args.complianceSettings.storey_of_dwelling)
    ?? dwelling.storeyOfDwelling;
  if (buildType === 'flat' && storeyOfDwelling === undefined) return undefined;

  const derivedVentilationHeight = calculateSuggestedVentilationHeight(
    args.elements,
    args.floors,
  );
  const ventilationZoneHeight = finiteNumber(
    args.complianceSettings.AirPermeability_ventilation_zone_height,
  ) ?? (derivedVentilationHeight > 0 ? derivedVentilationHeight : undefined);

  if (!canCheckVentilationBaseHeight({
    elements: args.elements,
    floors: args.floors,
    buildType,
    storeysInDwelling,
    storeyOfDwelling,
    ventilationZoneHeight,
  })) {
    return undefined;
  }

  return calculateSuggestedVentilationBaseHeight(args.elements, args.floors, {
    buildType,
    storeysInDwelling,
    storeyOfDwelling,
    ventilationZoneHeight,
  });
}

const FHS_MAX_GLAZING_FRACTION = 0.25;
const FHS_ROOFLIGHT_REFERENCE_U_VALUE = 1.2;
const FHS_UPWARDS_PITCH_LIMIT_DEG = 60;
const R_SI_UPWARDS = 1 / (5.13 + 5);
const R_SE = 1 / (20 + 4.14);

function readFiniteElementValue(
  element: BuildingElementTransparent,
  key: string,
): number | undefined {
  const direct = (element as unknown as Record<string, unknown>)[key];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  const extra = element.extra_json?.[key];
  return typeof extra === 'number' && Number.isFinite(extra) ? extra : undefined;
}

function resolveTransparentElementUValue(
  element: BuildingElementTransparent,
): number | undefined {
  const uValue = readFiniteElementValue(element, 'u_value');
  if (uValue !== undefined && uValue > 0) return uValue;

  const constructionResistance = readFiniteElementValue(
    element,
    'thermal_resistance_construction',
  );
  if (constructionResistance === undefined) return undefined;
  const totalResistance = constructionResistance + R_SI_UPWARDS + R_SE;
  return totalResistance > 0 ? 1 / totalResistance : undefined;
}

function formatAreaForWarning(value: number): string {
  return String(Math.round((value + Number.EPSILON) * 100) / 100);
}

export function collectFhsGlazingLimitWarnings(args: {
  elements: Element[];
  zones: Zone[];
}): string[] {
  const zones = args.zones.filter((zone) => !zone.isPlaceholder);
  if (
    zones.length === 0
    || zones.some((zone) => !Number.isFinite(zone.floorArea) || zone.floorArea <= 0)
  ) {
    return [];
  }

  const totalFloorArea = zones.reduce((sum, zone) => sum + zone.floorArea, 0);
  const windows = args.elements.filter(
    (element): element is BuildingElementTransparent =>
      !element.isPlaceholder && element.type === 'BuildingElementTransparent',
  );
  if (windows.length === 0) return [];

  let totalGlazingArea = 0;
  let totalRooflightArea = 0;
  let rooflightUValueArea = 0;

  for (const window of windows) {
    const { width, height } = getAreaBasedElementExportGeometry(window);
    if (!(width > 0) || !(height > 0)) return [];
    const area = width * height;
    totalGlazingArea += area;

    const pitch = resolveBuildingElementPitch(window);
    if (pitch === undefined) return [];
    if (pitch >= FHS_UPWARDS_PITCH_LIMIT_DEG) continue;

    const uValue = resolveTransparentElementUValue(window);
    if (uValue === undefined) return [];
    totalRooflightArea += area;
    rooflightUValueArea += area * uValue;
  }

  const rooflightCorrection = totalRooflightArea === 0
    ? 0
    : Math.max(
        0,
        (totalRooflightArea / totalFloorArea)
          * ((rooflightUValueArea / totalRooflightArea) - FHS_ROOFLIGHT_REFERENCE_U_VALUE)
          / FHS_ROOFLIGHT_REFERENCE_U_VALUE,
      );
  const glazingLimit = (FHS_MAX_GLAZING_FRACTION - rooflightCorrection) * totalFloorArea;
  if (totalGlazingArea <= glazingLimit) return [];

  return [
    `Total glazing (${formatAreaForWarning(totalGlazingArea)} m²) exceeds the FHS notional glazing limit (${formatAreaForWarning(glazingLimit)} m²). FHS preprocessing is known to fail on such models.`,
  ];
}

function getBasementGroundFloorBaseHeightCheckWarning(args: {
  elements: Element[];
  buildType?: 'flat' | 'house';
  storeyOfDwelling?: number;
}): string | undefined {
  const hasBasementGroundFloor = hasGroundFloorBasementVentilationBaseHeightCandidate(args.elements);
  if (!hasBasementGroundFloor) return undefined;
  if (calculateGroundFloorBasementVentilationBaseHeight(args.elements) !== null) return undefined;
  const isRelevant =
    args.buildType === 'house' ||
    (args.buildType === 'flat' &&
      args.storeyOfDwelling !== undefined &&
      fhsStoreyToCanvasFloor(args.storeyOfDwelling) <= 0);
  return isRelevant
    ? 'Ventilation zone base height cannot be checked because basement ground-floor depth/height is missing.'
    : undefined;
}

export function collectGlobalSettingsWarnings(args: {
  elements: Element[];
  floors?: Floor[];
  zones?: Zone[];
  complianceValidationEnabled?: boolean;
  complianceSettings: GlobalSettingsShape;
}): string[] {
  const warnings: string[] = [];
  if (args.complianceValidationEnabled && args.zones) {
    warnings.push(...collectFhsGlazingLimitWarnings({
      elements: args.elements,
      zones: args.zones,
    }));
  }
  const settings = args.complianceSettings;
  const dwelling = calculateDwellingDetailsSuggestion(args.elements);
  const buildType = settings.build_type ?? dwelling.buildType;
  const storeysInDwelling = finiteNumber(settings.storeys_in_dwelling) ?? dwelling.storeysInDwelling;
  const storeyOfDwelling = finiteNumber(settings.storey_of_dwelling) ?? dwelling.storeyOfDwelling;
  const derivedDimensions = calculateDwellingLengthWidthFromGroundElements(args.elements);

  const manualBuildingLength = finiteNumber(settings.BuildingLength);
  if (
    manualBuildingLength !== undefined &&
    derivedDimensions.lengthM > 0 &&
    Math.abs(manualBuildingLength - derivedDimensions.lengthM) > BUILDING_DIMENSION_TOLERANCE_M
  ) {
    warnings.push(
      `Building length is manually set to ${manualBuildingLength} m, but geometry calculates ${derivedDimensions.lengthM} m.`,
    );
  }

  const manualBuildingWidth = finiteNumber(settings.BuildingWidth);
  if (
    manualBuildingWidth !== undefined &&
    derivedDimensions.widthM > 0 &&
    Math.abs(manualBuildingWidth - derivedDimensions.widthM) > BUILDING_DIMENSION_TOLERANCE_M
  ) {
    warnings.push(
      `Building width is manually set to ${manualBuildingWidth} m, but geometry calculates ${derivedDimensions.widthM} m.`,
    );
  }

  if (
    settings.storeys_in_dwelling !== undefined &&
    dwelling.storeysInDwelling !== undefined &&
    settings.storeys_in_dwelling !== dwelling.storeysInDwelling
  ) {
    warnings.push(
      `Storeys in dwelling is ${settings.storeys_in_dwelling}, but floor geometry suggests ${dwelling.storeysInDwelling}.`,
    );
  }

  const explicitBaseHeight = finiteNumber(settings.Ventilation_ventilation_zone_base_height);
  if (explicitBaseHeight !== undefined && buildType !== undefined) {
    const derivedVentHeight = calculateSuggestedVentilationHeight(args.elements, args.floors);
    const effectiveVentHeight = finiteNumber(settings.AirPermeability_ventilation_zone_height)
      ?? (derivedVentHeight > 0 ? derivedVentHeight : undefined);
    const basementGroundFloorCheckWarning = getBasementGroundFloorBaseHeightCheckWarning({
      elements: args.elements,
      buildType,
      storeyOfDwelling,
    });
    const canCheckBaseHeight = canCheckVentilationBaseHeight({
      elements: args.elements,
      floors: args.floors,
      buildType,
      storeysInDwelling,
      storeyOfDwelling,
      ventilationZoneHeight: effectiveVentHeight,
    });
    if (!canCheckBaseHeight) {
      warnings.push(
        basementGroundFloorCheckWarning
          ?? 'Ventilation zone base height cannot be checked because no storey height or ventilation zone height is available.',
      );
    } else {
      const suggestedBaseHeight = calculateSuggestedVentilationBaseHeight(args.elements, args.floors, {
        buildType,
        storeysInDwelling,
        storeyOfDwelling,
        ventilationZoneHeight: effectiveVentHeight,
      });

      if (Math.abs(explicitBaseHeight - suggestedBaseHeight) > STOREY_BASE_HEIGHT_TOLERANCE_M) {
        const suggestedBy = buildType === 'house' ? 'build type' : 'storey of dwelling';
        warnings.push(
          `Ventilation zone base height is ${explicitBaseHeight} m, but ${suggestedBy} suggests ${suggestedBaseHeight} m.`,
        );
      }
    }
  }

  if (buildType !== 'flat') return warnings;

  if (settings.storey_of_dwelling === 0) {
    warnings.push(
      'Storey of dwelling 0 means one basement level below ground. Use 1 for a ground-floor flat.',
    );
  }

  const storeysInBuilding = finiteNumber(settings.storeys_in_building);
  if (
    storeysInBuilding !== undefined &&
    storeysInDwelling !== undefined &&
    storeyOfDwelling !== undefined
  ) {
    const highestOccupiedStorey = storeyOfDwelling + storeysInDwelling - 1;
    if (highestOccupiedStorey > storeysInBuilding) {
      warnings.push(
        `Storey of dwelling (${storeyOfDwelling}) plus storeys in dwelling (${storeysInDwelling}) exceeds storeys in building (${storeysInBuilding}).`,
      );
    }
  }

  return Array.from(new Set(warnings));
}
