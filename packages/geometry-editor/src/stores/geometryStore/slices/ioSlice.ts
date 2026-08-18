// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { StateCreator } from 'zustand';
import {
  deriveZoneProperties,
  calculateDerivedFloorArea,
  calculateDerivedHeight,
  calculateGroundFloorArea,
  calculateDwellingDetailsSuggestion,
  calculateSuggestedVentilationBaseHeight,
  calculateSuggestedVentilationHeight,
  withEffectiveStoreyHeights,
  ZONE_OVERRIDE_EPSILON,
} from '../../../lib/zoneDerivation';
import { calculateDwellingLengthWidthFromGroundElements } from '../../../lib/buildingFootprintDimensions';
import { aggregateDwellingCounts, dwellingCountZoneIds } from '../../../lib/spaceLabelDerivation';
import { resolveEffectiveDwellingDetails } from '../../../lib/effectiveDwellingDetails';
import { coerceElementToStrictestNumericTyping } from '../../../lib/schemaCoercion';
import { parseCsvToGeometry } from '../../../geometry/io/parseCsvToGeometry';
import {
  encodeGuideOverlayMetadataValue,
  encodeGuideOverlaySourceMetadataValue,
} from '../../../geometry/guideOverlay';
import {
  resolveGuideOverlayForFloor,
  resolveGuideOverlaySourceForFloor,
} from '../../../geometry/guideOverlayByFloor';
import { resolveBuildingElementPitch } from '../../../geometry/derivePitchFromGeometry';
import { formatCoords } from '../../../geometry/coords';
import { roundToTwoDecimals } from '../../../geometry/constants';
import type { BuildingElementOpaque, BuildingElementTransparent, Element, Floor, OnSiteGeneration, SpaceLabel } from '../../../geometry/types';
import type { GeometryState } from '../../geometryStore';
import type { GeometryModelSchemaProfilePort } from '../../../../../geometry-editor-host/src/modelSchemaProfilePort';
import type { GeometrySchemaPort } from '../../../../../geometry-editor-host/src/schemaPort';
import type { GeometryWorkspaceResourcePort } from '../../../../../geometry-editor-host/src/workspaceResourcePort';
import {
  alignHostedSlopedPanelToHostOrientation,
  buildHostDerivedPatch,
  buildTransparentHostDerivedPatch,
  deriveFromHostRoof,
  findHostRoofId,
  inferPvHostOverrideFlags,
} from '../../../lib/pvHostDerivation';
import {
  getAreaBasedElementExportGeometry,
  getElementGrossArea,
  getOpaqueElementExportGeometry,
} from '../../../lib/elementArea';
import {
  deriveLegacySlopedElementDimensions,
  deriveSlopedElementDimensions,
  slopedDimensionDiffers,
} from '../../../lib/slopedElementDimensions';
import { isOrientationPitchAxis } from '../../../lib/slopePitchAxis';
import {
  getElementCanvasFloorZValue,
  getThermalBridgeExtraJsonFloorStorey,
  mergeServiceLineExtraJsonFloorId,
  mergeThermalBridgeExtraJsonFloorId,
  resolvePhysicalZElementStoreyForCsvLoad,
} from '../../../lib/elementCanvasFloor';
import {
  ingestThermalBridgeLinearPostParse,
  resolveThermalBridgeLinearFloorIdAfterHostsReady,
} from '../../../lib/thermalBridgeFloorIngest';
import {
  encodePromotedExtraJsonFields,
  EXPECTED_SECTION_HEADERS,
  zoneExportHeaders,
} from '../../../geometry/io/geometryCsvLayouts';
import {
  defaultsReadPathAttempts,
  normalizeDefaultsPathForMetadata,
} from '../../../lib/workspacePaths';
import { FLOOR_AREA_MATCH_EPSILON_M2, applySpaceLabelsToZonesAndCompliance } from '../../../lib/spaceLabelDerivation';
import { normalizeDevelopmentContextShadingExtraJsonForCsv } from '../../../lib/developmentContextShading';
import {
  getMechanicalVentilationCsvFlatPositionValues,
  getMechanicalVentilationExtraJsonForCsv,
} from '../../../lib/mechanicalVentilationBranches';
import { syncSpaceHeatSystemZoneNameInExtraJson } from '../../../lib/spaceHeatSystemSync';
import { collectDuplicateElementNameWarnings } from '../../../lib/elementNameDuplicates';
import { buildHistoryDocumentSnapshotFromState } from '../../../lib/geometryHistorySnapshot';
import { isMvhrTerminalHost } from '../../../lib/mvhrDuctwork';
import {
  applyFloorBaseHeightOverrides,
  applyFloorHeightOverrides,
} from '../../../lib/floorDerivation';
import {
  CURRENT_PROVENANCE_MARKERS_VERSION,
  FLOOR_BASE_HEIGHT_OVERRIDE_DESCRIPTOR,
  FLOOR_HEIGHT_OVERRIDE_DESCRIPTOR,
  OVERRIDE_PROVENANCE_REGISTRY,
  PROVENANCE_MARKERS_METADATA_KEY,
  PV_HOST_OVERRIDE_DESCRIPTORS,
  SLOPED_HEIGHT_OVERRIDE_DESCRIPTOR,
  SLOPED_WIDTH_OVERRIDE_DESCRIPTOR,
  ZONE_FLOOR_AREA_OVERRIDE_DESCRIPTOR,
  ZONE_HEIGHT_OVERRIDE_DESCRIPTOR,
  isOverrideActive,
  isOverrideDescriptorAuthoritative,
  projectOverrideMarkersForExport,
  promoteOverrideMarkersOnImport,
} from '../../../lib/overrideProvenance';

export { DEFAULT_DEFAULTS_PATH } from '../../../lib/workspacePaths';

export interface IoSlice {
  generateCSV: () => string;
  /** Returns non-fatal data-loss warnings from CSV parsing; load UIs must surface them. */
  loadFromCSV: (csvContent: string) => { warnings: string[] };
  /** CSV at the moment of the last successful save or load; null until either occurs. */
  lastSavedCsv: string | null;
  /** Set after a successful save or load. */
  setLastSavedCsv: (csv: string | null) => void;
  /** Internal cancellation hook used by document-boundary reset actions. */
  cancelPendingLoadedCsvWorkForDocumentBoundary: () => void;
}
export type GeometryStoreSlice = StateCreator<GeometryState, [], [], IoSlice>;
export type IoSliceOptions = Readonly<{
  defaultDefaultsPath: string | undefined;
  modelSchemaProfilePort: GeometryModelSchemaProfilePort;
  schemaPort: GeometrySchemaPort;
  workspaceResourcePort: GeometryWorkspaceResourcePort;
  hostDocumentMetadataKeys: readonly string[];
}>;
type CancelScheduledWork = () => void;
type LoadedCsvWorkScheduler = {
  cancelPending: CancelScheduledWork | null;
  version: number;
  defaultsVersion: number;
  defaultsRetryTimers: Set<ReturnType<typeof globalThis.setTimeout>>;
};
type ElementByType<T extends Element['type']> = Extract<Element, { type: T }>;
type NonExposedElement =
  | ElementByType<'BuildingElementAdjacentConditionedSpace'>
  | ElementByType<'BuildingElementAdjacentUnconditionedSpace_Simple'>
  | ElementByType<'BuildingElementPartyWall'>;
type ThermalBridgeElement = ElementByType<'ThermalBridgeLinear'> | ElementByType<'ThermalBridgePoint'>;
type VentilationElement =
  | ElementByType<'MechanicalVentilation'>
  | ElementByType<'Vents'>
  | ElementByType<'MechanicalVentilationDuctwork'>
  | ElementByType<'MechanicalVentilationTerminal'>;
type ServiceLineFloorElement =
  | ElementByType<'WaterPipework'>
  | ElementByType<'MechanicalVentilationDuctwork'>
  | ElementByType<'ThermalBridgePoint'>;

function scheduleIdleWork(callback: () => void): CancelScheduledWork {
  if (
    typeof globalThis.requestIdleCallback === 'function' &&
    typeof globalThis.cancelIdleCallback === 'function'
  ) {
    const id = globalThis.requestIdleCallback(callback, { timeout: 1200 });
    return () => globalThis.cancelIdleCallback(id);
  }

  const id = globalThis.setTimeout(callback, 180);
  return () => globalThis.clearTimeout(id);
}

function scheduleLoadedCsvBaseline(
  get: () => GeometryState,
  set: (partial: Partial<GeometryState>) => void,
  scheduler: LoadedCsvWorkScheduler,
  loadedCsvBaseline: string,
): void {
  scheduler.cancelPending?.();
  const version = ++scheduler.version;

  set({
    history: [],
    historyIndex: -1,
    canUndo: false,
    canRedo: false,
    // Capture the normalized loaded document synchronously. Idle history work
    // may observe later edits, but it must never redefine what was loaded.
    lastSavedCsv: loadedCsvBaseline,
  });

  scheduler.cancelPending = scheduleIdleWork(() => {
    if (version !== scheduler.version) return;
    scheduler.cancelPending = null;
    const state = get();
    const snapshot = buildHistoryDocumentSnapshotFromState(state) as GeometryState['history'][number];

    set({
      history: [snapshot],
      historyIndex: 0,
      canUndo: false,
      canRedo: false,
    });
  });
}

function invalidatePendingDefaultsWork(scheduler: LoadedCsvWorkScheduler): number {
  scheduler.defaultsVersion += 1;
  for (const timer of scheduler.defaultsRetryTimers) {
    globalThis.clearTimeout(timer);
  }
  scheduler.defaultsRetryTimers.clear();
  return scheduler.defaultsVersion;
}

function normalizedElementRefName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function findImportedElementByName(elements: Element[], name: string): Element | undefined {
  if (!name) return undefined;
  return elements.find((candidate) => candidate.name === name);
}

function importedElementStorey(
  element: Element | undefined,
  floors: GeometryState['floors'],
): number | undefined {
  return element ? getElementCanvasFloorZValue(element, floors) : undefined;
}

function resolveMechanicalVentilationDuctworkStoreyForCsvLoad(
  ductwork: ElementByType<'MechanicalVentilationDuctwork'>,
  elements: Element[],
  floors: GeometryState['floors'],
): number {
  const explicitStorey = getThermalBridgeExtraJsonFloorStorey(ductwork, floors);
  if (explicitStorey !== undefined) return explicitStorey;

  const parentName = normalizedElementRefName(ductwork.parent_element);
  const parent = findImportedElementByName(elements, parentName);
  if (parent?.type === 'MechanicalVentilation') {
    const parentStorey = importedElementStorey(parent, floors);
    if (parentStorey !== undefined) return parentStorey;
  }

  return 0;
}

function resolveMechanicalVentilationTerminalStoreyForCsvLoad(
  terminal: ElementByType<'MechanicalVentilationTerminal'>,
  elements: Element[],
  floors: GeometryState['floors'],
): number {
  const hostName = normalizedElementRefName(terminal.host_element);
  const host = findImportedElementByName(elements, hostName);
  if (host?.type === 'BuildingElementOpaque' || host?.type === 'BuildingElementTransparent') {
    const hostStorey = importedElementStorey(host, floors);
    if (hostStorey !== undefined) return hostStorey;
  }

  const parentName = normalizedElementRefName(terminal.parent_element);
  const parent = findImportedElementByName(elements, parentName);
  if (parent?.type === 'MechanicalVentilation') {
    const parentStorey = importedElementStorey(parent, floors);
    if (parentStorey !== undefined) return parentStorey;
  }

  return 0;
}

function isWorkspaceUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Workspace folder not selected')
    || message.includes('Geometry workspace resource read is unavailable');
}

const escapeCSV = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (stringValue.includes('"')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  if (stringValue.includes(',')) {
    return `"${stringValue}"`;
  }
  return stringValue;
};

const escapeCSVJson = (value: string): string => {
  if (!value) return '';
  const escapedValue = value.replace(/"/g, '""');
  return `"${escapedValue}"`;
};

/**
 * Pitch in degrees, rounded to 2dp (fractional degrees, e.g. 22.5°, are valid —
 * both Core and FHS schemas declare pitch `"type": "number"`; integer rounding is
 * an FHS-export-only concern handled at the correct layer: builder.rs's
 * `coerce_building_element_value` (vulcan-model-transform), gated on `is_fhs_schema` —
 * do not round to an integer here). 2dp matches every pitch import path
 * (`parseOptionalPitchColumn` et al. in ingestGeometryTabularSections.ts already
 * round to 2dp) and every typed-pitch commit point in the UI, so a save/load/save
 * cycle is idempotent from the first cycle — without rounding here, `String(pitch)`
 * can also emit float noise (e.g. 22.700000000000003) straight into the CSV cell.
 * 0 / 90 / 180 are all valid: do not use `value || 90` — 0 is falsy in JavaScript
 * and would be replaced by 90. When pitch is missing, emit an empty cell (no
 * implicit default). Same class of bug: `x || default` for optional numbers
 * (frame fraction, hot-water flow, etc.); use `??`, `formatOptionalFiniteNumberForCsv`,
 * or explicit `== null` checks.
 */
const formatBuildingElementPitchForCsv = (pitch: number | undefined | null): string => {
  if (typeof pitch === 'number' && Number.isFinite(pitch)) {
    return String(roundToTwoDecimals(pitch));
  }
  return '';
};

/**
 * Use for CSV cells where 0 is valid (e.g. solar pitch, peak power, angles).
 * Do not use `n || default` — 0 is falsy.
 */
const formatOptionalFiniteNumberForCsv = (n: number | undefined | null): string => {
  if (typeof n === 'number' && Number.isFinite(n)) {
    return String(n);
  }
  return '';
};

const formatPositiveFiniteNumberForCsv = (n: number | undefined | null): string => {
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
    return String(n);
  }
  return '';
};

const formatLooseOptionalCsvCell = (value: unknown): string =>
  value == null || value === '' ? '' : String(value);

const getElementsOfType = <T extends Element['type']>(
  elementsById: Record<string, Element>,
  type: T,
): ElementByType<T>[] =>
  Object.values(elementsById).filter((element): element is ElementByType<T> => element.type === type);

const isOriginPoint = (point: unknown): boolean => {
  if (!point || typeof point !== 'object') return false;
  const coord = point as { x?: unknown; y?: unknown; z?: unknown };
  return coord.x === 0 && coord.y === 0 && coord.z === 0;
};

const formatCoordsForCsv = (coords: Array<{ x: number; y: number; z: number }> | undefined | null): string => {
  return Array.isArray(coords) && coords.length > 0 ? formatCoords(coords) : '';
};

const formatElementCoordsForCsv = (element: { coordinates?: Array<{ x: number; y: number; z: number }>; isPlaceholder?: boolean }): string => {
  const coords = element.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return '';
  if (element.isPlaceholder && coords.length === 1 && isOriginPoint(coords[0])) return '';
  return formatCoords(coords);
};

const formatElementFirstCoordForCsv = (element: { coordinates?: Array<{ x: number; y: number; z: number }>; isPlaceholder?: boolean }): string => {
  const coords = element.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return '';
  if (element.isPlaceholder && coords.length === 1 && isOriginPoint(coords[0])) return '';
  return formatCoords([coords[0]]);
};

const mechanicalVentilationTerminalMidHeightForCsv = (
  element: ElementByType<'MechanicalVentilationTerminal'>,
): number | '' => {
  if (typeof element.mid_height_air_flow_path === 'number' && Number.isFinite(element.mid_height_air_flow_path)) {
    return roundToTwoDecimals(element.mid_height_air_flow_path);
  }
  const z = element.coordinates?.[0]?.z;
  return typeof z === 'number' && Number.isFinite(z) ? roundToTwoDecimals(z) : '';
};

const formatViewerBaseHeightForCsv = (element: { _base_height?: unknown; base_height?: unknown }): string => {
  if (typeof element._base_height === 'number' && Number.isFinite(element._base_height)) {
    return formatOptionalFiniteNumberForCsv(element._base_height);
  }
  if (typeof element.base_height === 'number' && Number.isFinite(element.base_height)) {
    return formatOptionalFiniteNumberForCsv(element.base_height);
  }
  return '';
};

const formatGroundViewerBaseHeightForCsv = (
  element: { floor_type?: unknown; _base_height?: unknown; base_height?: unknown },
): string => {
  if (element.floor_type === 'Heated_basement' || element.floor_type === 'Unheated_basement') {
    return '';
  }
  return formatViewerBaseHeightForCsv(element);
};

const roundOrientation360ForCsv = (raw: number | undefined | null): string => {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(Math.round(raw));
  }
  return '';
};

/**
 * Element types whose scalar width/height participate in the sloped-polygon auto-calc /
 * `_widthUserOverride` / `_heightUserOverride` tracking (see slopedElementDimensions.ts and
 * stores/geometryStore.ts's `applySlopedDimensionOverrideTracking`). Intentionally excludes
 * `OnSiteGeneration`: PV panels also carry `coordinates` + `pitch` (so
 * `deriveSlopedElementDimensions` would happily return a value for them too) but derive their
 * scalar dimensions from `derivePvDimensionsFromCoords`, a different formula entirely.
 */
const SLOPED_OVERRIDE_ELIGIBLE_TYPES = new Set<Element['type']>([
  'BuildingElementOpaque',
  'BuildingElementTransparent',
  'BuildingElementAdjacentConditionedSpace',
  'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
]);

/**
 * Legacy tolerance, gated on integer pitch: older CSVs were written with the pitch column
 * rounded to an integer (`Math.round(pitch)`) while the width/height columns were derived
 * from the unrounded in-session pitch — so re-deriving from the rounded pitch on import can
 * legitimately land up to half a degree away from the value the writer saw.
 * `formatBuildingElementPitchForCsv` no longer rounds pitch to an integer (it writes 2dp
 * verbatim), so a *decimal* pitch column (e.g. 22.5, 22.76) can only have come from a build
 * that already writes exact values — there is no rounding ambiguity to absorb for it, so it
 * gets exact matching only. An *integer* pitch column (90, 23, …) is ambiguous — it may be a
 * genuinely whole-number pitch, or it may be what a legacy build rounded a fractional pitch
 * down to — so it keeps the ±0.5° envelope permanently, padded by the usual sloped-dimension
 * epsilon, so files saved by older builds still reconstruct their override flags correctly.
 */
const PITCH_CSV_ROUNDING_HALF_STEP_DEG = 0.5;
const SLOPED_DIMENSION_EPSILON = 0.01;

const matchesDerivedAcrossPitchRounding = (
  csvValue: number,
  element: Element,
  derive: typeof deriveSlopedElementDimensions,
  key: 'width' | 'height',
  globalOrientationOffset: number,
): boolean => {
  const pitch = (element as { pitch?: unknown }).pitch;
  if (typeof pitch !== 'number' || !Number.isFinite(pitch)) return false;
  const coordinates = (element as { coordinates?: unknown }).coordinates as Array<{ x: number; y: number; z: number }>;
  // Only an integer pitch is ambiguous (see doc comment above) — decimal pitch gets exact
  // matching (dp = 0 only), so a genuine user override that happens to land inside the legacy
  // ±0.5° envelope is still correctly flagged as an override rather than silently absorbed.
  const pitchRoundingSteps = Number.isInteger(pitch)
    ? [-PITCH_CSV_ROUNDING_HALF_STEP_DEG, 0, PITCH_CSV_ROUNDING_HALF_STEP_DEG]
    : [0];
  const values: number[] = [];
  for (const dp of pitchRoundingSteps) {
    const candidatePitch = pitch + dp;
    if (candidatePitch <= 0 || candidatePitch >= 90) continue;
    const derived = derive({ ...element, coordinates, pitch: candidatePitch }, globalOrientationOffset);
    if (derived) values.push(derived[key]);
  }
  if (values.length === 0) return false;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return csvValue >= min - SLOPED_DIMENSION_EPSILON && csvValue <= max + SLOPED_DIMENSION_EPSILON;
};

/**
 * Restore `_widthUserOverride` / `_heightUserOverride` after CSV import. Versioned documents use
 * authored `extra_json` markers; unversioned documents run the prior migration heuristic, where a
 * value that still matches an auto-calc formula is treated as auto-calculated. That legacy path is
 * checked against both the current formula and the pre-"equivalent-width" legacy formula
 * (`deriveLegacySlopedElementDimensions`) so models saved before that change migrate cleanly
 * instead of getting a spurious override flag, and across the CSV pitch column's integer
 * rounding (`matchesDerivedAcrossPitchRounding`) so a 22.5° roof does not read back as
 * overridden. Values recognised as auto-calculated are snapped to the current formula so a
 * load → save round trip is idempotent and the editor shows what export/HEM will actually use.
 *
 * Elements carrying `extra_json.geometry_face` (dormer roof faces, profiled walls) are skipped
 * entirely: their export path (`getAreaBasedElementExportGeometry`) writes the stored
 * construction scalars verbatim, which legitimately match neither formula.
 *
 * Mutates elements in place, mirroring the zone floor-area/height override reconstruction this
 * runs alongside in `loadFromCSV`.
 */
const reconstructSlopedDimensionOverrideFlags = (
  elements: readonly Element[],
  globalOrientationOffset: number,
  provenanceMarkersVersion: number | undefined,
): void => {
  for (const element of elements) {
    if (!SLOPED_OVERRIDE_ELIGIBLE_TYPES.has(element.type)) continue;
    const extraJson = (element as { extra_json?: unknown }).extra_json;
    if (extraJson && typeof extraJson === 'object' && 'geometry_face' in (extraJson as Record<string, unknown>)) {
      continue;
    }
    const derivedNew = deriveSlopedElementDimensions(element, globalOrientationOffset);
    if (!derivedNew) continue;
    const record = element as unknown as {
      width?: unknown;
      height?: unknown;
      _widthUserOverride?: boolean;
      _heightUserOverride?: boolean;
    };

    const csvWidth = typeof record.width === 'number' && Number.isFinite(record.width) ? record.width : undefined;
    if (
      csvWidth
      && !isOverrideDescriptorAuthoritative(
        SLOPED_WIDTH_OVERRIDE_DESCRIPTOR,
        provenanceMarkersVersion,
      )
    ) {
      const matchesCurrent = matchesDerivedAcrossPitchRounding(csvWidth, element, deriveSlopedElementDimensions, 'width', globalOrientationOffset);
      const matchesLegacy = !isOrientationPitchAxis(element) && matchesDerivedAcrossPitchRounding(csvWidth, element, deriveLegacySlopedElementDimensions, 'width', globalOrientationOffset);
      if (!matchesCurrent && !matchesLegacy) {
        record._widthUserOverride = true;
      }
    }
    if (record._widthUserOverride !== true) {
      record.width = derivedNew.width;
    }

    const csvHeight = typeof record.height === 'number' && Number.isFinite(record.height) ? record.height : undefined;
    if (
      csvHeight
      && !isOverrideDescriptorAuthoritative(
        SLOPED_HEIGHT_OVERRIDE_DESCRIPTOR,
        provenanceMarkersVersion,
      )
    ) {
      const matchesCurrent = matchesDerivedAcrossPitchRounding(csvHeight, element, deriveSlopedElementDimensions, 'height', globalOrientationOffset);
      const matchesLegacy = !isOrientationPitchAxis(element) && matchesDerivedAcrossPitchRounding(csvHeight, element, deriveLegacySlopedElementDimensions, 'height', globalOrientationOffset);
      if (!matchesCurrent && !matchesLegacy) {
        record._heightUserOverride = true;
      }
    }
    if (record._heightUserOverride !== true) {
      record.height = derivedNew.height;
    }
  }
};

/**
 * Reconstruct a PV panel's soft host link (`_pvHostRoofId`) and restore its
 * `_baseHeightUserOverride` / `_pitchUserOverride` / `_orientationUserOverride` flags after CSV
 * import. The soft host remains derived on every load. Override flags come from authored
 * `extra_json` markers in versioned documents; unversioned documents retain the prior inference
 * migration. Without host re-detection, a freshly-loaded panel would silently stop tracking its
 * host roof — the roof-side
 * re-derivation loop in stores/geometryStore.ts's `updateElement` matches hosted panels by
 * `_pvHostRoofId`, so editing the roof would no longer move panels until each one is next
 * dragged. Re-detects the host by the same plan-view centroid test `updateElement` uses on a
 * coordinate change (`findHostRoofId`). With no host, persisted positive markers are promoted but
 * absent flags remain undefined so first-attach inference stays live.
 */
const reconstructPvHostLinkAndOverrideFlags = (
  elements: readonly Element[],
  elementsById: Record<string, Element>,
  floors: Floor[],
  globalOrientationOffset: number,
  provenanceMarkersVersion: number | undefined,
): void => {
  const effectiveFloors = withEffectiveStoreyHeights(floors, elements as Element[]);
  for (const element of elements) {
    if (element.type !== 'OnSiteGeneration') continue;
    const panel = element as OnSiteGeneration;
    // A persisted positive marker is meaningful even before host discovery. Absence is not: an
    // unhosted panel must keep undefined flags so updateElement can infer authorship on first attach.
    promoteOverrideMarkersOnImport(
      panel as unknown as Record<string, unknown>,
      PV_HOST_OVERRIDE_DESCRIPTORS,
      undefined,
    );
    const hostId = findHostRoofId(panel, elementsById);
    if (!hostId) continue;
    const hostRoof = elementsById[hostId];
    if (!hostRoof || hostRoof.type !== 'BuildingElementOpaque') continue;

    panel._pvHostRoofId = hostId;
    const derived = deriveFromHostRoof(panel, hostRoof as BuildingElementOpaque, effectiveFloors, globalOrientationOffset);
    // Once hosted, a versioned document's absent markers become authoritative false. Legacy
    // documents remain undefined and therefore take the existing value-vs-derived inference path.
    promoteOverrideMarkersOnImport(
      panel as unknown as Record<string, unknown>,
      PV_HOST_OVERRIDE_DESCRIPTORS,
      provenanceMarkersVersion,
    );
    Object.assign(panel, inferPvHostOverrideFlags(panel, derived));
    Object.assign(panel, buildHostDerivedPatch(panel, derived));
  }
};

const migrateElementsToNormalized = (
  elements: Element[]
): { elementsById: Record<string, Element>; elementIds: string[] } => {
  const elementsById: Record<string, Element> = {};
  const elementIds: string[] = [];

  elements.forEach(element => {
    const migratedElement = {
      ...element,
      _v: element._v ?? 0
    };

    elementsById[element.id] = migratedElement;
    elementIds.push(element.id);
  });

  return { elementsById, elementIds };
};

export const createIoSlice = (options: IoSliceOptions): GeometryStoreSlice => {
  // Scheduling belongs to this store instance. Separate editor stores must not
  // cancel or version one another's post-load history work.
  const loadedCsvWorkScheduler: LoadedCsvWorkScheduler = {
    cancelPending: null,
    version: 0,
    defaultsVersion: 0,
    defaultsRetryTimers: new Set(),
  };

  return (set, get) => ({
  lastSavedCsv: null,
  setLastSavedCsv: (csv) => set({ lastSavedCsv: csv }),
  cancelPendingLoadedCsvWorkForDocumentBoundary: () => {
    loadedCsvWorkScheduler.cancelPending?.();
    loadedCsvWorkScheduler.cancelPending = null;
    loadedCsvWorkScheduler.version += 1;
    invalidatePendingDefaultsWork(loadedCsvWorkScheduler);
  },

  generateCSV: () => {
    const rawState = get();
    // Project authored override flags onto `extra_json` once, up front, so every section sees a
    // current marker set and re-enabled automatic fields cannot leak stale markers.
    const state: GeometryState = {
      ...rawState,
      elementsById: projectOverrideMarkersForExport(
        rawState.elementsById,
        OVERRIDE_PROVENANCE_REGISTRY.element,
      ),
      spaceLabelsById: projectOverrideMarkersForExport(
        rawState.spaceLabelsById,
        OVERRIDE_PROVENANCE_REGISTRY.spaceLabel,
      ),
    };
    const lines: string[] = [];

    const ensureColumnCount = (row: string[], expectedCount: number): string => {
      const currentCount = row.length;
      if (currentCount < expectedCount) {
        return row.join(',') + ','.repeat(expectedCount - currentCount);
      } else if (currentCount > expectedCount) {
        return row.slice(0, expectedCount).join(',');
      }
      return row.join(',');
    };

    const orientationOffset = (
      typeof state.globalOrientationOffset === 'number' &&
      !Number.isNaN(state.globalOrientationOffset)
    )
      ? state.globalOrientationOffset
      : 0;
    lines.push('Metadata,,,,,,,,,,,,,');
    lines.push(`GlobalOrientationOffset,${orientationOffset},,,,,,,,,,,,,`);
    lines.push(
      `${PROVENANCE_MARKERS_METADATA_KEY},${CURRENT_PROVENANCE_MARKERS_VERSION},,,,,,,,,,,,,`,
    );
    if (options.modelSchemaProfilePort.availability === 'available') {
      const modelSchemaProfile = options.modelSchemaProfilePort.metadataValueForElements(
        Object.values(state.elementsById),
      );
      lines.push(`SchemaProfile,${modelSchemaProfile},,,,,,,,,,,,,`);
    }
    const rawDefaultsPath = state.defaultsPath?.trim() || options.defaultDefaultsPath;
    if (rawDefaultsPath) {
      const effectiveDefaultsPath = normalizeDefaultsPathForMetadata(rawDefaultsPath);
      lines.push(`DefaultsPath,${effectiveDefaultsPath},,,,,,,,,,,,,`);
    }
    if (state.propertyPostcode && state.propertyPostcode.trim() !== '') {
      lines.push(`Postcode,${escapeCSV(state.propertyPostcode.trim())},,,,,,,,,,,,,`);
    }
    const asmIds = state.creationDefaultAssemblyIds ?? {};
    lines.push(`DefaultAssemblyWall,${escapeCSV(asmIds.wall ?? '')},,,,,,,,,,,,,`);
    lines.push(`DefaultAssemblyRoof,${escapeCSV(asmIds.roof ?? '')},,,,,,,,,,,,,`);
    lines.push(`DefaultAssemblyGroundFloor,${escapeCSV(asmIds.ground_floor ?? '')},,,,,,,,,,,,,`);
    for (const key of options.hostDocumentMetadataKeys) {
      const value = state.hostDocumentMetadata[key]?.trim();
      if (value) lines.push(`${escapeCSV(key)},${escapeCSV(value)},,,,,,,,,,,,,`);
    }
    const defaultTB = (typeof state.defaultThermalBridging === 'number' && !isNaN(state.defaultThermalBridging))
      ? state.defaultThermalBridging
      : 0.2;
    lines.push(`DefaultThermalBridging,${defaultTB},,,,,,,,,,,,,`);
    // Per-floor overlay records are emitted in floor-index order so diffs stay stable.
    const overlayFloorKeys = Object.keys(state.guideOverlayByFloor)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    for (const floorIndex of overlayFloorKeys) {
      const overlay = state.guideOverlayByFloor[floorIndex];
      if (!overlay || !overlay.path || overlay.path.trim() === '') continue;
      const payload = encodeGuideOverlayMetadataValue(overlay);
      if (payload) {
        lines.push(`GuideOverlay,${floorIndex},${payload},,,,,,,,,,,,,`);
      }
    }
    const sourceFloorKeys = Object.keys(state.guideOverlaySourceByFloor)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    for (const floorIndex of sourceFloorKeys) {
      const source = state.guideOverlaySourceByFloor[floorIndex];
      if (!source) continue;
      const payload = encodeGuideOverlaySourceMetadataValue(source);
      if (payload) {
        lines.push(`GuideOverlaySource,${floorIndex},${payload},,,,,,,,,,,,,`);
      }
    }
    // Zone rows have no `extra_json` column, so their authored override markers live in Metadata
    // and identify the record by its unique CSV name.
    for (const zone of state.zones) {
      for (const descriptor of OVERRIDE_PROVENANCE_REGISTRY.zone) {
        if (isOverrideActive(zone as unknown as Record<string, unknown>, descriptor)) {
          lines.push(`${descriptor.key},${escapeCSV(zone.name)},,,,,,,,,,,,,`);
        }
      }
    }
    // Floor storey-height overrides: floors are otherwise re-created at import purely from
    // element z-values (ensureFloorForZ) with a wall-derived effective height, so a user-typed
    // override (Floor.heightUserOverride) has nowhere else to live in this format. Only floors
    // carrying an explicit override need a row — everything else reconstructs itself from walls,
    // exactly like today. Emitted in floor-index order for stable diffs, same as the GuideOverlay
    // per-floor records above.
    const heightOverrideFloors = [...state.floors]
      .filter((floor) =>
        isOverrideActive(
          floor as unknown as Record<string, unknown>,
          FLOOR_HEIGHT_OVERRIDE_DESCRIPTOR,
        ) && Number.isFinite(floor.height)
      )
      .sort((a, b) => a.zIndex - b.zIndex);
    for (const floor of heightOverrideFloors) {
      lines.push(
        `${FLOOR_HEIGHT_OVERRIDE_DESCRIPTOR.key},${floor.zIndex},${floor.height},,,,,,,,,,,,,`,
      );
    }
    const baseHeightOverrideFloors = [...state.floors]
      .filter((floor) =>
        isOverrideActive(
          floor as unknown as Record<string, unknown>,
          FLOOR_BASE_HEIGHT_OVERRIDE_DESCRIPTOR,
        ) && Number.isFinite(floor.baseHeight)
      )
      .sort((a, b) => a.zIndex - b.zIndex);
    for (const floor of baseHeightOverrideFloors) {
      lines.push(
        `${FLOOR_BASE_HEIGHT_OVERRIDE_DESCRIPTOR.key},${floor.zIndex},${floor.baseHeight},,,,,,,,,,,,,`,
      );
    }
    if (state.junctionPsiDefaultsPath && state.junctionPsiDefaultsPath.trim() !== '') {
      lines.push(`JunctionPsiDefaultsPath,${escapeCSV(state.junctionPsiDefaultsPath.trim())},,,,,,,,,,,,,`);
    }
    if (state.detailedBridgePsiProfile) {
      lines.push(`DetailedBridgePsiProfileSource,${escapeCSV(state.detailedBridgePsiProfile.source)},,,,,,,,,,,,,`);
      lines.push(`DetailedBridgePsiProfileId,${escapeCSV(state.detailedBridgePsiProfile.profileId)},,,,,,,,,,,,,`);
      lines.push(`DetailedBridgePsiProfileLabel,${escapeCSV(state.detailedBridgePsiProfile.label)},,,,,,,,,,,,,`);
    }

    const compliance = state.complianceSettings;

    // ----------------------------------------------------------------
    // Compute every geometry-derived dwelling value once. The CSV export
    // writes the manual override (`compliance.X`) when present, otherwise the
    // current geometry-derived value. This keeps re-imports stable: a CSV
    // round-trip preserves the values the user sees in the UI rather than
    // letting them silently fall back to the defaults JSON's hardcoded values
    // (e.g. `storeys_in_dwelling: 1`).
    //
    // The override → space-labels → derivation chain is centralised in
    // `resolveEffectiveDwellingDetails` — same source of truth used by the UI
    // editor (`GeometryBuilder.tsx`) and Part F validation
    // (`partFEffectiveContext.ts`). When that resolver gains a new field, all
    // three call sites pick it up.
    // ----------------------------------------------------------------
    const allElementsForExport = Object.values(state.elementsById);
    const dd = resolveEffectiveDwellingDetails({
      zones: state.zones,
      elementsById: state.elementsById,
      spaceLabelsById: state.spaceLabelsById,
      spaceLabelIds: state.spaceLabelIds,
      complianceSettings: compliance,
    });
    const derivedGFA = calculateGroundFloorArea(allElementsForExport); // local, used elsewhere below

    const effectiveBedrooms = dd.bedrooms;
    const effectiveWetRooms = dd.wetRooms;
    const effectiveHabitableRooms = dd.habitableRooms;
    const effectiveHotTappedRooms = dd.hotTappedRooms;
    const effectiveUtilityRooms = dd.utilityRooms;
    const effectiveBathrooms = dd.bathrooms;
    const effectiveSanitaryAccommodations = dd.sanitaryAccommodations;
    const effectiveStoreysInDwelling = dd.storeysInDwelling;
    const effectiveStoreyOfDwelling = dd.storeyOfDwelling;
    const effectiveBuildType = dd.buildType;

    if (compliance.PartO_active_cooling_required !== undefined) {
      lines.push(`PartO_active_cooling_required,${compliance.PartO_active_cooling_required ? 'TRUE' : 'FALSE'},,,,,,,,,,,,,`);
    }
    if (effectiveBedrooms !== undefined) {
      lines.push(`NumberOfBedrooms,${Math.round(effectiveBedrooms)},,,,,,,,,,,,,`);
    }
    if (effectiveWetRooms !== undefined) {
      lines.push(`NumberOfWetRooms,${Math.round(effectiveWetRooms)},,,,,,,,,,,,,`);
    }
    if (compliance.GroundFloorArea !== undefined) {
      lines.push(`GroundFloorArea,${compliance.GroundFloorArea},,,,,,,,,,,,,`);
    } else if (derivedGFA > 0) {
      lines.push(`GroundFloorArea,${derivedGFA},,,,,,,,,,,,,`);
    }
    if (compliance.HeatingControlType) {
      lines.push(`HeatingControlType,${compliance.HeatingControlType},,,,,,,,,,,,,`);
    }
    if (compliance.PartGcompliance !== undefined) {
      lines.push(`PartGcompliance,${compliance.PartGcompliance ? 'TRUE' : 'FALSE'},,,,,,,,,,,,,`);
    }
    if (compliance.ColdWaterSource) {
      lines.push(`ColdWaterSource,${compliance.ColdWaterSource},,,,,,,,,,,,,`);
    }
    if (compliance.complianceValidationEnabled !== undefined) {
      lines.push(`ComplianceValidationEnabled,${compliance.complianceValidationEnabled ? 'TRUE' : 'FALSE'},,,,,,,,,,,,,`);
    }
    if (compliance.scenariosBaseModelEnabled !== undefined) {
      lines.push(`ScenariosBaseModelEnabled,${compliance.scenariosBaseModelEnabled ? 'TRUE' : 'FALSE'},,,,,,,,,,,,,`);
    }
    if (compliance.AirPermeability_test_pressure !== undefined) {
      lines.push(`AirPermeability_test_pressure,${compliance.AirPermeability_test_pressure},,,,,,,,,,,,,`);
    }
    if (compliance.AirPermeability_test_result !== undefined) {
      lines.push(`AirPermeability_test_result,${compliance.AirPermeability_test_result},,,,,,,,,,,,,`);
    }
    const derivedVentHeight = calculateSuggestedVentilationHeight(allElementsForExport, state.floors);
    const effectiveVentHeight = compliance.AirPermeability_ventilation_zone_height
      ?? (derivedVentHeight > 0 ? derivedVentHeight : undefined);
    // Ventilation zone height: same export-on-derived-or-override pattern.
    // Without this, the geometry-derived suggestion (sum of per-floor wall heights)
    // is UI-only and is replaced on JSON merge by the defaults file's value.
    if (effectiveVentHeight !== undefined) {
      lines.push(`AirPermeability_ventilation_zone_height,${effectiveVentHeight},,,,,,,,,,,,,`);
    }
    if (compliance.Ventilation_shield_class) {
      lines.push(`Ventilation_shield_class,${compliance.Ventilation_shield_class},,,,,,,,,,,,,`);
    }
    if (compliance.Ventilation_terrain_class) {
      lines.push(`Ventilation_terrain_class,${compliance.Ventilation_terrain_class},,,,,,,,,,,,,`);
    }
    if (compliance.Ventilation_altitude !== undefined) {
      lines.push(`Ventilation_altitude,${compliance.Ventilation_altitude},,,,,,,,,,,,,`);
    }
    {
      const effectiveVentBaseHeight = compliance.Ventilation_ventilation_zone_base_height
        ?? calculateSuggestedVentilationBaseHeight(allElementsForExport, state.floors, {
          buildType: effectiveBuildType,
          storeysInDwelling: effectiveStoreysInDwelling,
          storeyOfDwelling: effectiveStoreyOfDwelling,
          ventilationZoneHeight: effectiveVentHeight,
        });
      lines.push(`Ventilation_ventilation_zone_base_height,${effectiveVentBaseHeight},,,,,,,,,,,,,`);
    }
    if (compliance.Ventilation_noise_nuisance !== undefined) {
      lines.push(`Ventilation_noise_nuisance,${compliance.Ventilation_noise_nuisance ? 'TRUE' : 'FALSE'},,,,,,,,,,,,,`);
    }
    // BuildingLength/Width also flow through the unified resolver above. The legacy
    // `derivedLengthWidth.lengthM > 0 ? ... : undefined` guard is preserved by `pickNumber`
    // inside the resolver (Number.isFinite + > 0 semantics on a positive measurement).
    const effectiveBuildingLength = dd.buildingLengthM;
    const effectiveBuildingWidth = dd.buildingWidthM;
    if (effectiveBuildingLength !== undefined) {
      lines.push(`BuildingLength,${effectiveBuildingLength},,,,,,,,,,,,,`);
    }
    if (effectiveBuildingWidth !== undefined) {
      lines.push(`BuildingWidth,${effectiveBuildingWidth},,,,,,,,,,,,,`);
    }
    if (effectiveHabitableRooms !== undefined) {
      lines.push(`NumberOfHabitableRooms,${Math.round(effectiveHabitableRooms)},,,,,,,,,,,,,`);
    }
    if (effectiveHotTappedRooms !== undefined) {
      lines.push(`NumberOfHotTappedRooms,${Math.round(effectiveHotTappedRooms)},,,,,,,,,,,,,`);
    }
    if (effectiveUtilityRooms !== undefined) {
      lines.push(`NumberOfUtilityRooms,${Math.round(effectiveUtilityRooms)},,,,,,,,,,,,,`);
    }
    if (effectiveBathrooms !== undefined) {
      lines.push(`NumberOfBathrooms,${Math.round(effectiveBathrooms)},,,,,,,,,,,,,`);
    }
    if (effectiveSanitaryAccommodations !== undefined) {
      lines.push(`NumberOfSanitaryAccommodations,${Math.round(effectiveSanitaryAccommodations)},,,,,,,,,,,,,`);
    }
    if (compliance.KitchenExtractorHoodExternal !== undefined) {
      lines.push(
        `KitchenExtractorHoodExternal,${compliance.KitchenExtractorHoodExternal ? 'TRUE' : 'FALSE'},,,,,,,,,,,,,`,
      );
    }
    // Dwelling type / storeys: export the user override OR the
    // geometry-derived suggestion. This makes CSV round-trips stable —
    // re-importing the same CSV preserves the values shown in the UI rather
    // than reverting to the defaults file's hardcoded `storeys_in_dwelling: 1`.
    if (effectiveBuildType !== undefined) {
      lines.push(`General_build_type,${effectiveBuildType},,,,,,,,,,,,,`);
    }
    // SAP built form is calculation-authoritative metadata. Unlike FHS build
    // type/storeys, it must never be inferred from geometry or defaulted.
    if (compliance.built_form !== undefined) {
      lines.push(`General_built_form,${compliance.built_form},,,,,,,,,,,,,`);
    }
    if (effectiveStoreysInDwelling !== undefined) {
      lines.push(`General_storeys_in_dwelling,${Math.round(effectiveStoreysInDwelling)},,,,,,,,,,,,,`);
    }
    if (effectiveBuildType === 'flat' && effectiveStoreyOfDwelling !== undefined) {
      lines.push(`General_storey_of_dwelling,${Math.round(effectiveStoreyOfDwelling)},,,,,,,,,,,,,`);
    }
    if (effectiveBuildType === 'flat' && compliance.storeys_in_building !== undefined) {
      lines.push(`General_storeys_in_building,${compliance.storeys_in_building},,,,,,,,,,,,,`);
    }

    lines.push(',,,,,,,,,,,,');

    const currentState = state;

    // Zone-scoped sections must never silently drop elements: a zone lookup
    // miss (stale zoneId after a zone deletion, or a missing zoneId) means the
    // element would vanish from the CSV and the merge would never see it.
    // Collect every miss and abort the export loudly below.
    const danglingZoneElements: Array<{ name: string; type: string; zoneId?: string }> = [];
    const resolveZoneForExport = (element: { name?: string; type?: string; zoneId?: string }) => {
      const zone = element.zoneId ? currentState.getZoneById(element.zoneId) : undefined;
      if (!zone) {
        danglingZoneElements.push({
          name: element.name || '(unnamed)',
          type: element.type || '(unknown type)',
          zoneId: element.zoneId,
        });
      }
      return zone;
    };

    const exportZones = currentState.zones;
    if (exportZones.length > 0) {
      const exportFhsAreaSplit = compliance.complianceValidationEnabled === true;
      const primaryZoneId = exportZones[0]?.id;
      const zoneHeader = [...zoneExportHeaders(exportFhsAreaSplit)];
      const zoneColumnCount = zoneHeader.length;

      lines.push('Zone,,,,,,,,,,,,,');
      lines.push(ensureColumnCount(zoneHeader, zoneColumnCount));
      exportZones.forEach(zone => {
        const volume = typeof zone.volume === 'number' && Number.isFinite(zone.volume)
          ? zone.volume
          : (
              typeof zone.floorArea === 'number' &&
              Number.isFinite(zone.floorArea) &&
              typeof zone.height === 'number' &&
              Number.isFinite(zone.height)
                ? zone.floorArea * zone.height
                : undefined
            );
        const isPrimaryFhsZone = exportFhsAreaSplit && zone.id === primaryZoneId;
        const livingroomArea = isPrimaryFhsZone
          ? zone.livingroom_area
          : undefined;
        const restOfDwellingArea = isPrimaryFhsZone
          ? zone.restofdwelling_area
          : (typeof zone.floorArea === 'number' && Number.isFinite(zone.floorArea) ? roundToTwoDecimals(zone.floorArea) : undefined);
        const zoneRow = [
          escapeCSV(zone.name),
          'Zone',
          escapeCSV(formatOptionalFiniteNumberForCsv(typeof volume === 'number' ? roundToTwoDecimals(volume) : undefined)),
          escapeCSV(formatOptionalFiniteNumberForCsv(typeof zone.floorArea === 'number' ? roundToTwoDecimals(zone.floorArea) : undefined)),
          escapeCSV(formatOptionalFiniteNumberForCsv(typeof zone.height === 'number' ? roundToTwoDecimals(zone.height) : undefined)),
          zone.simplifiedThermalBridging ? 'TRUE' : 'FALSE',
        ];
        if (exportFhsAreaSplit) {
          zoneRow.push(
            livingroomArea === undefined ? '' : escapeCSV(roundToTwoDecimals(livingroomArea)),
            restOfDwellingArea === undefined ? '' : escapeCSV(roundToTwoDecimals(restOfDwellingArea)),
          );
        }
        lines.push(ensureColumnCount(zoneRow, zoneColumnCount));
      });
      lines.push('');
    }

    const spaceLabelRows = currentState.spaceLabelIds
      .map((id) => currentState.spaceLabelsById[id])
      .filter((sl): sl is SpaceLabel => !!sl);
    if (spaceLabelRows.length > 0) {
      const slHeader = [...EXPECTED_SECTION_HEADERS['Space Labels']];
      const slColumnCount = slHeader.length;
      lines.push('Space Labels,,,,,,,,,,,,,,');
      lines.push(ensureColumnCount(slHeader, slColumnCount));
      spaceLabelRows.forEach((sl) => {
        const zone = currentState.getZoneById(sl.zoneId);
        if (!zone) return;
        const spaceLabelExtraJson = {
          ...(sl.extra_json ?? {}),
          ...(sl.source ? { space_label_source: sl.source } : {}),
        };
        const row = [
          escapeCSV(sl.name),
          escapeCSV(zone.name),
          escapeCSV(sl.storey),
          escapeCSV(sl.room_type),
          formatCoordsForCsv(sl.coordinates),
          escapeCSV(formatOptionalFiniteNumberForCsv(sl.height_override)),
          escapeCSVJson(Object.keys(spaceLabelExtraJson).length > 0 ? JSON.stringify(spaceLabelExtraJson) : ''),
        ];
        lines.push(ensureColumnCount(row, slColumnCount));
      });
      lines.push('');
    }

    const opaqueElements = getElementsOfType(state.elementsById, 'BuildingElementOpaque');
    if (opaqueElements.length > 0) {
      const exposedHeader = [...EXPECTED_SECTION_HEADERS['Exposed Elements']];
      const exposedColumnCount = exposedHeader.length;

      lines.push('Exposed Elements,,,,,,,,,,,,,,');
      lines.push(ensureColumnCount(exposedHeader, exposedColumnCount));
      opaqueElements.forEach(element => {
        const zone = resolveZoneForExport(element);
        if (zone) {
          const exportedArea = currentState.getEffectiveArea(element.id);
          const exportedGeometry = getOpaqueElementExportGeometry(element, state.globalOrientationOffset);
          const exposedRow = [
            escapeCSV(element.name),
            escapeCSV(zone.name),
            escapeCSV(element.type),
            escapeCSV(formatPositiveFiniteNumberForCsv(exportedArea)),
            escapeCSV(formatBuildingElementPitchForCsv(resolveBuildingElementPitch(element))),
            escapeCSV(formatPositiveFiniteNumberForCsv(exportedGeometry.width)),
            escapeCSV(formatPositiveFiniteNumberForCsv(exportedGeometry.height)),
            escapeCSV(roundOrientation360ForCsv(element.orientation360)),
            escapeCSV(formatOptionalFiniteNumberForCsv(
              exportedGeometry.height > 0 ||
              exportedGeometry.width > 0 ||
              (typeof element.base_height === 'number' && Number.isFinite(element.base_height))
                ? exportedGeometry.baseHeight
                : undefined
            )),
            element.is_unheated_pitched_roof ? 'TRUE' : 'FALSE',
            element.is_external_door ? 'TRUE' : 'FALSE',
            escapeCSV(element.parent_element || ''),
            formatElementCoordsForCsv(element),
            escapeCSVJson(element.extra_json ? JSON.stringify(element.extra_json) : '')
          ];
          lines.push(ensureColumnCount(exposedRow, exposedColumnCount));
        }
      });
      lines.push('');
    }

    const transparentElements = getElementsOfType(state.elementsById, 'BuildingElementTransparent');
    if (transparentElements.length > 0) {
      const windowHeader = [...EXPECTED_SECTION_HEADERS['Window Elements']];
      const windowColumnCount = windowHeader.length;

      lines.push('Window Elements,,,,,,,,,,,,,,');
      lines.push(ensureColumnCount(windowHeader, windowColumnCount));
      transparentElements.forEach(element => {
        const zone = resolveZoneForExport(element);
        if (zone) {
          const exportedGeometry = getAreaBasedElementExportGeometry(element, state.globalOrientationOffset);
          const exportedArea = getElementGrossArea(element, state.globalOrientationOffset);
          const exportedWidth = exportedGeometry.width > 0 ? exportedGeometry.width : undefined;
          const exportedHeight = exportedGeometry.height > 0 ? exportedGeometry.height : undefined;
          const exportedBaseHeight =
            exportedHeight !== undefined ||
            exportedWidth !== undefined ||
            (typeof element.base_height === 'number' && Number.isFinite(element.base_height))
              ? exportedGeometry.baseHeight
              : undefined;
          // mid_height has no dedicated override flag (unlike sloped width/height): the editor
          // (transparentOpeningDerivedFields.ts) keeps it auto-tracking base_height + height/2
          // in-session until the stored value diverges from that derived counterpart, so use the
          // same value-vs-derived check here rather than always overwriting it on export — that
          // silently discarded custom mid_height values on the very first save.
          const inSessionDerivedMidHeight =
            typeof element.height === 'number' && Number.isFinite(element.height) && element.height > 0
              ? roundToTwoDecimals(
                  (typeof element.base_height === 'number' && Number.isFinite(element.base_height)
                    ? element.base_height
                    : 0) + element.height / 2,
                )
              : undefined;
          const midHeightIsCustom =
            typeof element.mid_height === 'number' &&
            Number.isFinite(element.mid_height) &&
            (inSessionDerivedMidHeight === undefined ||
              slopedDimensionDiffers(element.mid_height, inSessionDerivedMidHeight));
          // Follow-up: the in-session path uses DERIVED_VALUE_EPSILON = 0.005 in
          // transparentOpeningDerivedFields.ts, while this export check uses
          // slopedDimensionDiffers' 0.01 default for the same auto-vs-manual decision.
          const exportedMidHeight = midHeightIsCustom
            ? element.mid_height
            : (
                exportedHeight !== undefined
                  ? roundToTwoDecimals((exportedBaseHeight ?? 0) + exportedHeight / 2)
                  : (
                      typeof element.mid_height === 'number' && Number.isFinite(element.mid_height)
                        ? element.mid_height
                        : undefined
                    )
              );
          const windowRow = [
            escapeCSV(element.name),
            escapeCSV(zone.name),
            escapeCSV(element.type),
            escapeCSV(formatPositiveFiniteNumberForCsv(exportedArea)),
            escapeCSV(formatBuildingElementPitchForCsv(resolveBuildingElementPitch(element))),
            escapeCSV(formatPositiveFiniteNumberForCsv(exportedWidth)),
            escapeCSV(formatPositiveFiniteNumberForCsv(exportedHeight)),
            escapeCSV(roundOrientation360ForCsv(element.orientation360)),
            escapeCSV(formatOptionalFiniteNumberForCsv(exportedBaseHeight)),
            escapeCSV(element.parent_element || ''),
            escapeCSV(formatOptionalFiniteNumberForCsv(element.frame_area_fraction)),
            escapeCSV(formatOptionalFiniteNumberForCsv(element.free_area_height)),
            escapeCSV(formatOptionalFiniteNumberForCsv(exportedMidHeight)),
            escapeCSV(formatOptionalFiniteNumberForCsv(element.max_window_open_area)),
            formatElementCoordsForCsv(element),
            escapeCSVJson(element.extra_json ? JSON.stringify(element.extra_json) : '')
          ];
          lines.push(ensureColumnCount(windowRow, windowColumnCount));
        }
      });
      lines.push('');
    }

    // 4. Window Shading section
    const windowShadingElements = getElementsOfType(state.elementsById, 'WindowShading');
    if (windowShadingElements.length > 0) {
      const shadingHeader = [...EXPECTED_SECTION_HEADERS['Window Shading']];
      const shadingColumnCount = shadingHeader.length;

      lines.push('Window Shading,,,,,,,,,,,,,,');
      lines.push(ensureColumnCount(shadingHeader, shadingColumnCount));
      windowShadingElements.forEach(element => {
        const zone = resolveZoneForExport(element);
        if (zone) {
          const depth = element.shading_type === 'object' ? '' : escapeCSV(formatLooseOptionalCsvCell(element.depth));
          const height = element.shading_type === 'object'
            ? escapeCSV(formatLooseOptionalCsvCell(element.height))
            : '';
          const distance = escapeCSV(formatLooseOptionalCsvCell(element.distance));
          const transparency = element.shading_type === 'object'
            ? escapeCSV(formatLooseOptionalCsvCell(element.transparency))
            : '';

          const shadingRow = [
            escapeCSV(element.name),
            escapeCSV(zone.name),
            escapeCSV(element.shading_type),
            escapeCSV(element.parent_element || ''),
            depth,
            height,
            distance,
            transparency,
            escapeCSV(formatGroundViewerBaseHeightForCsv(element)),
            formatElementFirstCoordForCsv(element),
            escapeCSVJson(element.extra_json ? JSON.stringify(element.extra_json) : '')
          ];
          lines.push(ensureColumnCount(shadingRow, shadingColumnCount));
        }
      });
      lines.push('');
    }

    // 5. Lighting section (explicit elements only; no per-zone autofill)
    const lightingElements = getElementsOfType(state.elementsById, 'Lighting');

    if (lightingElements.length > 0) {
      const lightingHeader = [...EXPECTED_SECTION_HEADERS.Lighting];
      const lightingColumnCount = lightingHeader.length;

      lines.push('Lighting,,,,,,,,,,,,,');
      lines.push(ensureColumnCount(lightingHeader, lightingColumnCount));

      lightingElements.forEach(element => {
        const zone = resolveZoneForExport(element);
        if (zone) {
          const count = escapeCSV(formatOptionalFiniteNumberForCsv(element.count));
          const power = escapeCSV(formatOptionalFiniteNumberForCsv(element.power));

          const lightingRow = [
            escapeCSV(element.name),
            escapeCSV(zone.name),
            escapeCSV(element.efficacy),
            count,
            power,
            escapeCSV(formatViewerBaseHeightForCsv(element)),
            formatElementCoordsForCsv(element),
            escapeCSVJson(element.extra_json ? JSON.stringify(element.extra_json) : '')
          ];
          lines.push(ensureColumnCount(lightingRow, lightingColumnCount));
        }
      });

      lines.push('');
    }

    // 6. Ground Elements section
    const groundElements = getElementsOfType(state.elementsById, 'BuildingElementGround');
    if (groundElements.length > 0) {
      const groundHeader = [...EXPECTED_SECTION_HEADERS['Ground Elements']];
      const groundColumnCount = groundHeader.length;

      lines.push('Ground Elements,,,,,,,,,,,,,');
      lines.push(ensureColumnCount(groundHeader, groundColumnCount));
      groundElements.forEach(element => {
        const zone = resolveZoneForExport(element);
        if (zone) {
          const groundRow = [
            escapeCSV(element.name),
            escapeCSV(zone.name),
            escapeCSV(element.type),
            escapeCSV(formatPositiveFiniteNumberForCsv(getElementGrossArea(element))),
            escapeCSV(formatPositiveFiniteNumberForCsv(element.width)),
            escapeCSV(formatPositiveFiniteNumberForCsv(element.height)),
            escapeCSV(formatPositiveFiniteNumberForCsv(element.perimeter)),
            escapeCSV(element.floor_type || ''),
            escapeCSV(formatOptionalFiniteNumberForCsv(element.depth_basement_floor)),
            escapeCSV(formatOptionalFiniteNumberForCsv(element.thickness_walls)),
            escapeCSV(formatViewerBaseHeightForCsv(element)),
            escapeCSV(element.parent_element || ''),
            formatElementCoordsForCsv(element),
            escapeCSVJson(element.extra_json ? JSON.stringify(element.extra_json) : '')
          ];
          lines.push(ensureColumnCount(groundRow, groundColumnCount));
        }
      });
      lines.push('');
    }

    // 7. Non-Exposed Elements section
    const nonExposedElements = Object.values(state.elementsById).filter((e): e is NonExposedElement =>
      (
        e.type === 'BuildingElementAdjacentConditionedSpace'
        || e.type === 'BuildingElementAdjacentUnconditionedSpace_Simple'
        || e.type === 'BuildingElementPartyWall'
      )
    );
    if (nonExposedElements.length > 0) {
      const nonExposedHeader = [...EXPECTED_SECTION_HEADERS['Non-Exposed Elements']];
      const nonExposedColumnCount = nonExposedHeader.length;

      lines.push('Non-Exposed Elements,,,,,,,,,,,');
      lines.push(ensureColumnCount(nonExposedHeader, nonExposedColumnCount));
      nonExposedElements.forEach(element => {
        const zone = resolveZoneForExport(element);
        if (zone) {
          const nonExposedRow = [
            escapeCSV(element.name),
            escapeCSV(zone.name),
            escapeCSV(element.type),
            escapeCSV(formatPositiveFiniteNumberForCsv(getElementGrossArea(element))),
            escapeCSV(formatBuildingElementPitchForCsv(resolveBuildingElementPitch(element))),
            escapeCSV(formatPositiveFiniteNumberForCsv(element.width)),
            escapeCSV(formatPositiveFiniteNumberForCsv(element.height)),
            escapeCSV(formatViewerBaseHeightForCsv(element)),
            escapeCSV(element.parent_element || ''),
            formatElementCoordsForCsv(element),
            escapeCSVJson(element.extra_json ? JSON.stringify(element.extra_json) : '')
          ];
          lines.push(ensureColumnCount(nonExposedRow, nonExposedColumnCount));
        }
      });
      lines.push('');
    }

    // 8. Thermal Bridging Elements section
    const thermalBridgeElements = Object.values(state.elementsById).filter((e): e is ThermalBridgeElement =>
      (e.type === 'ThermalBridgeLinear' || e.type === 'ThermalBridgePoint')
    );
    if (thermalBridgeElements.length > 0) {
      const bridgeHeader = [...EXPECTED_SECTION_HEADERS['Thermal Bridging Elements']];
      const bridgeColumnCount = bridgeHeader.length;

      lines.push('Thermal Bridging Elements,,,,,,,,,');
      lines.push(ensureColumnCount(bridgeHeader, bridgeColumnCount));
      thermalBridgeElements.forEach(element => {
        const zone = resolveZoneForExport(element);
        if (zone) {
          const bridgeRow = [
            escapeCSV(element.name),
            escapeCSV(zone.name),
            escapeCSV(element.type),
            escapeCSV(element.type === 'ThermalBridgePoint' ? element.heat_transfer_coeff : ''),
            escapeCSV(element.type === 'ThermalBridgeLinear' ? element.length : ''),
            escapeCSV(element.type === 'ThermalBridgeLinear' ? element.linear_thermal_transmittance : ''),
            escapeCSV(element.parent_element || ''),
            formatElementCoordsForCsv(element),
            escapeCSVJson(element.extra_json ? JSON.stringify(element.extra_json) : '')
          ];
          lines.push(ensureColumnCount(bridgeRow, bridgeColumnCount));
        }
      });
      lines.push('');
    }

    // 9. Ventilation Systems section
    const ventilationElements = Object.values(state.elementsById).filter((e): e is VentilationElement =>
      (
        e.type === 'MechanicalVentilation' ||
        e.type === 'Vents' ||
        e.type === 'MechanicalVentilationDuctwork' ||
        e.type === 'MechanicalVentilationTerminal'
      )
    );
    if (ventilationElements.length > 0) {
      const ventilationHeader = [...EXPECTED_SECTION_HEADERS['Ventilation Systems']];
      const ventilationColumnCount = ventilationHeader.length;

      lines.push('Ventilation Systems,,,,,,,,,,,,,,');
      lines.push(ensureColumnCount(ventilationHeader, ventilationColumnCount));
      ventilationElements.forEach(element => {
        const mechanicalVentilationFlatPosition =
          element.type === 'MechanicalVentilation'
            ? getMechanicalVentilationCsvFlatPositionValues(element.extra_json, element.vent_type)
            : {};
        const extraJsonForCsv =
          element.type === 'MechanicalVentilation'
            ? getMechanicalVentilationExtraJsonForCsv(element.extra_json, element.vent_type)
            : element.extra_json;
        const ventilationRow = [
          escapeCSV(element.name),
          escapeCSV(element.type),
          escapeCSV(element.type === 'MechanicalVentilationDuctwork' ? element.length : ''),
          escapeCSV(element.type === 'MechanicalVentilationDuctwork' ? element.duct_type : ''),
          escapeCSV(element.type === 'MechanicalVentilationTerminal' ? element.terminal_type : ''),
          escapeCSV(element.parent_element || ''),
          escapeCSV(element.type === 'MechanicalVentilationTerminal' ? element.host_element || '' : ''),
          escapeCSV(element.type === 'MechanicalVentilationTerminal'
            ? mechanicalVentilationTerminalMidHeightForCsv(element)
            : element.type === 'Vents'
              ? element.mid_height_air_flow_path
              : mechanicalVentilationFlatPosition.mid_height_air_flow_path ?? ''),
          escapeCSV(element.type === 'Vents' ? element.area_cm2 : ''),
          escapeCSV(element.type === 'Vents' || element.type === 'MechanicalVentilationTerminal'
            ? element.orientation360
            : mechanicalVentilationFlatPosition.orientation360 ?? ''),
          escapeCSV(element.type === 'Vents' || element.type === 'MechanicalVentilationTerminal'
            ? element.pitch
            : mechanicalVentilationFlatPosition.pitch ?? ''),
          escapeCSV(element.type === 'MechanicalVentilation' ? element.vent_type : ''),
          formatElementCoordsForCsv(element),
          escapeCSVJson(extraJsonForCsv ? JSON.stringify(extraJsonForCsv) : '')
        ];
        lines.push(ensureColumnCount(ventilationRow, ventilationColumnCount));
      });
      lines.push('');
    }

    // 10. Combustion Appliances section
    const combustionElements = getElementsOfType(state.elementsById, 'CombustionAppliances');
    if (combustionElements.length > 0) {
      const combustionHeader = [...EXPECTED_SECTION_HEADERS['Combustion Appliances']];
      const combustionColumnCount = combustionHeader.length;

      lines.push('Combustion Appliances,,,,,,,,,');
      lines.push(ensureColumnCount(combustionHeader, combustionColumnCount));
      combustionElements.forEach(element => {
        const combustionRow = [
          escapeCSV(element.name),
          escapeCSV(element.type),
          escapeCSV(element.appliance_type),
          escapeCSV(element.exhaust_situation),
          escapeCSV(element.fuel_type),
          escapeCSV(element.supply_situation),
          escapeCSV(formatViewerBaseHeightForCsv(element)),
          formatElementCoordsForCsv(element),
          escapeCSVJson(element.extra_json ? JSON.stringify(element.extra_json) : '')
        ];
        lines.push(ensureColumnCount(combustionRow, combustionColumnCount));
      });
      lines.push('');
    }

    // 11. Water Pipework section
    const pipeworkElements = Object.values(state.elementsById).filter((e): e is ElementByType<'WaterPipework'> =>
      e.type === 'WaterPipework' &&
      (!compliance.complianceValidationEnabled || (e.pipework_type ?? 'primary') !== 'distribution')
    );
    if (pipeworkElements.length > 0) {
      const pipeworkHeader = [...EXPECTED_SECTION_HEADERS['Water Pipework']];
      const pipeworkColumnCount = pipeworkHeader.length;

      lines.push('Water Pipework,,,,,,,,');
      lines.push(ensureColumnCount(pipeworkHeader, pipeworkColumnCount));
      pipeworkElements.forEach(element => {
        const pipeworkRow = [
          escapeCSV(element.name),
          escapeCSV(element.type),
          escapeCSV(element.length),
          escapeCSV(element.location),
          escapeCSV(element.pipework_type ?? 'primary'),
          formatElementCoordsForCsv(element),
          escapeCSVJson(element.extra_json ? JSON.stringify(element.extra_json) : '')
        ];
        lines.push(ensureColumnCount(pipeworkRow, pipeworkColumnCount));
      });
      lines.push('');
    }

    // 12. Wet Emitters section
    const wetEmitterElements = getElementsOfType(state.elementsById, 'WetEmitter');
    if (wetEmitterElements.length > 0) {
      const emittersHeader = [...EXPECTED_SECTION_HEADERS['Wet Emitters']];
      const emittersColumnCount = emittersHeader.length;

      lines.push('Wet Emitters,,,,,,,,,');
      lines.push(ensureColumnCount(emittersHeader, emittersColumnCount));
      wetEmitterElements.forEach(element => {
        const zone = resolveZoneForExport(element);
        if (zone) {
          const emittersRow = [
            escapeCSV(element.name),
            escapeCSV(zone.name),
            escapeCSV(element.type),
            escapeCSV(element.subcategory || ''),
            escapeCSV(formatOptionalFiniteNumberForCsv(element.area)),
            escapeCSV(formatOptionalFiniteNumberForCsv(element.unit_number)),
            escapeCSV(element.space_heat_system || ''),
            escapeCSV(formatViewerBaseHeightForCsv(element)),
            formatElementCoordsForCsv(element),
            escapeCSVJson(element.extra_json ? JSON.stringify(element.extra_json) : '')
          ];
          lines.push(ensureColumnCount(emittersRow, emittersColumnCount));
        }
      });
      lines.push('');
    }

    // 13. Appliances section
    const applianceElements = getElementsOfType(state.elementsById, 'Appliance');
    if (applianceElements.length > 0) {
      const appliancesHeader = [...EXPECTED_SECTION_HEADERS.Appliances];
      const appliancesColumnCount = appliancesHeader.length;

      lines.push('Appliances,,,,,');
      lines.push(ensureColumnCount(appliancesHeader, appliancesColumnCount));
      applianceElements.forEach(element => {
        const appliancesRow = [
          escapeCSV(element.name),
          escapeCSV(element.type),
          escapeCSV(element.appliancekey),
          escapeCSV(formatViewerBaseHeightForCsv(element)),
          formatElementCoordsForCsv(element),
          escapeCSVJson(element.extra_json ? JSON.stringify(element.extra_json) : '')
        ];
        lines.push(ensureColumnCount(appliancesRow, appliancesColumnCount));
      });
      lines.push('');
    }

    // 14. Hot Water Outlets section
    const hotWaterElements = getElementsOfType(state.elementsById, 'HotWaterDemand');
    if (hotWaterElements.length > 0) {
      const hotWaterHeader = [...EXPECTED_SECTION_HEADERS['Hot Water Outlets']];
      const hotWaterColumnCount = hotWaterHeader.length;

      lines.push('Hot Water Outlets,,,,,,,,,');
      lines.push(ensureColumnCount(hotWaterHeader, hotWaterColumnCount));
      hotWaterElements.forEach(element => {
        const fr = element.flowrate;
        const flowrateCell =
          element.subcategory === 'Bath' || element.subcategory === 'InstantElecShower'
            ? ''
            : formatLooseOptionalCsvCell(fr);
        const rated = element.rated_power;
        const ratedCell = formatLooseOptionalCsvCell(rated);
        const hotWaterRow = [
          escapeCSV(element.name),
          escapeCSV(element.type),
            escapeCSV(element.subcategory || ''),
          escapeCSV(flowrateCell),
          escapeCSV(element.size || ''),
          escapeCSV(ratedCell),
            escapeCSV(element.subcategory === 'MixerShower' && typeof element.allow_low_flowrate === 'boolean' ? (element.allow_low_flowrate ? 'TRUE' : 'FALSE') : ''),
          escapeCSV(formatViewerBaseHeightForCsv(element)),
          formatElementCoordsForCsv(element),
          escapeCSVJson(element.extra_json ? JSON.stringify(element.extra_json) : '')
        ];
        lines.push(ensureColumnCount(hotWaterRow, hotWaterColumnCount));
      });
      lines.push('');
    }

    // 15. Context Shading section (headers from `geometryCsvLayouts`)
    const contextShadingElements = getElementsOfType(state.elementsById, 'ContextShading');
    if (contextShadingElements.length > 0) {
      const contextHeader = [...EXPECTED_SECTION_HEADERS['Context Shading']];
      const contextColumnCount = contextHeader.length;

      lines.push('Context Shading,,,,,,,,,,');
      lines.push(ensureColumnCount(contextHeader, contextColumnCount));
      contextShadingElements.forEach(element => {
        const extraJson = normalizeDevelopmentContextShadingExtraJsonForCsv(element);
        const contextRow = [
          escapeCSV(element.name),
          escapeCSV(element.type),
          escapeCSV(element.shading_type),
          escapeCSV(formatOptionalFiniteNumberForCsv(element.start_angle)),
          escapeCSV(formatOptionalFiniteNumberForCsv(element.end_angle)),
          escapeCSV(formatOptionalFiniteNumberForCsv(element.distance)),
          escapeCSV(formatOptionalFiniteNumberForCsv(element.height)),
          escapeCSV(element.parent_element || ''),
          escapeCSV(formatViewerBaseHeightForCsv(element)),
          formatElementCoordsForCsv(element),
          escapeCSVJson(extraJson ? JSON.stringify(extraJson) : '')
        ];
        lines.push(ensureColumnCount(contextRow, contextColumnCount));
      });
      lines.push('');
    }

    // 16. On-Site Generation section
    const onSiteElements = getElementsOfType(state.elementsById, 'OnSiteGeneration');
    if (onSiteElements.length > 0) {
      const onSiteHeader = [...EXPECTED_SECTION_HEADERS['On-Site Generation']];
      const onSiteColumnCount = onSiteHeader.length;

      lines.push('On-Site Generation,,,,,,,,,');
      lines.push(ensureColumnCount(onSiteHeader, onSiteColumnCount));
      onSiteElements.forEach(element => {
        const onSiteRow = [
          escapeCSV(element.name),
          escapeCSV(element.type),
          escapeCSV(element.generation_type),
          // The schema never required integer pitch (both Core and FHS declare it a
          // fractional `number`) — this shares building-element pitch's own writer
          // (formatBuildingElementPitchForCsv), which now rounds to 2dp, not to an
          // integer. FHS-only integer rounding lives at the correct layer: builder.rs's
          // `coerce_building_element_value` (vulcan-model-transform), gated on
          // `is_fhs_schema`.
          escapeCSV(formatBuildingElementPitchForCsv(element.pitch)),
          escapeCSV(roundOrientation360ForCsv(element.orientation360)),
          escapeCSV(formatOptionalFiniteNumberForCsv(element.base_height)),
          escapeCSV(formatOptionalFiniteNumberForCsv(element.peak_power)),
          escapeCSV(formatOptionalFiniteNumberForCsv(element.width)),
          escapeCSV(formatOptionalFiniteNumberForCsv(element.height)),
          formatElementCoordsForCsv(element),
          escapeCSVJson(element.extra_json ? JSON.stringify(element.extra_json) : '')
        ];
        lines.push(ensureColumnCount(onSiteRow, onSiteColumnCount));
      });
      lines.push('');
    }

    // 17. Systems section (ElectricBattery + System)
    const batteryElements = getElementsOfType(state.elementsById, 'ElectricBattery');
    const systemElements = getElementsOfType(state.elementsById, 'System');
    if (batteryElements.length > 0 || systemElements.length > 0) {
      // subcategory doubles as battery column for ElectricBattery rows
      const systemsHeader = [...EXPECTED_SECTION_HEADERS.Systems];
      const systemsColumnCount = systemsHeader.length;

      lines.push('Systems,,,,,,,');
      lines.push(ensureColumnCount(systemsHeader, systemsColumnCount));

      // ElectricBattery rows
      batteryElements.forEach(element => {
        const zone = element.zoneId ? currentState.getZoneById(element.zoneId) : undefined;
        const zoneName = zone ? zone.name : '';
        const extraJson = encodePromotedExtraJsonFields(element);
        delete extraJson.grid_charging_possible;
        delete extraJson.threshold_charges;
        delete extraJson.threshold_prices;
        delete extraJson.tariff;
        const systemsRow = [
          escapeCSV(element.name),
          escapeCSV(zoneName),
          escapeCSV('ElectricBattery'),
          escapeCSV('ElectricBattery'),
          escapeCSV(''),
          escapeCSV(formatViewerBaseHeightForCsv(element)),
          formatElementCoordsForCsv(element),
          escapeCSVJson(JSON.stringify(extraJson))
        ];
        lines.push(ensureColumnCount(systemsRow, systemsColumnCount));
      });

      // System rows (PCDB MVP)
      systemElements.forEach(element => {
        const zone = element.zoneId ? currentState.getZoneById(element.zoneId) : undefined;
        const zoneName = zone ? zone.name : '';
        const extraJsonForCsv =
          element.subcategory === 'SpaceHeatSystem'
            ? syncSpaceHeatSystemZoneNameInExtraJson(element.extra_json, zoneName) ?? element.extra_json
            : element.extra_json;
        const systemsRow = [
          escapeCSV(element.name),
          escapeCSV(zoneName),
          escapeCSV('System'),
          escapeCSV(element.subcategory || ''),
          escapeCSV(element.system_preset || ''),
          escapeCSV(formatViewerBaseHeightForCsv(element)),
          formatElementCoordsForCsv(element),
          escapeCSVJson(extraJsonForCsv ? JSON.stringify(extraJsonForCsv) : '')
        ];
        lines.push(ensureColumnCount(systemsRow, systemsColumnCount));
      });

      lines.push('');
    }

    if (danglingZoneElements.length > 0) {
      const details = danglingZoneElements
        .map((e) => `"${e.name}" (${e.type}, zoneId=${e.zoneId || 'missing'})`)
        .join('; ');
      throw new Error(
        `Geometry export aborted: ${danglingZoneElements.length} element(s) reference missing zones ` +
        `and would be silently lost from the saved CSV: ${details}`,
      );
    }

    const csvContent = lines.join('\n');
    if (!csvContent.trim().startsWith('Metadata')) {
      console.error('[generateCSV] WARNING: Generated CSV does not start with Metadata section:', csvContent.substring(0, 100));
      return 'Metadata,,,,,,,,,,,,,\nGlobalOrientationOffset,0,,,,,,,,,,,,,\n,,,,,,,,,,,,,\n';
    }
    return csvContent;
  },

  loadFromCSV: (csvContent) => {
    const { zones: newZones, elements: newElements, spaceLabels: newSpaceLabels, metadata, warnings: parseWarnings } =
      parseCsvToGeometry(csvContent, {
        hostDocumentMetadataKeys: options.hostDocumentMetadataKeys,
      });
    const duplicateNameWarnings = collectDuplicateElementNameWarnings(newElements, newZones);

    const spaceLabelsById: Record<string, SpaceLabel> = {};
    const spaceLabelIds: string[] = [];
    for (const sl of newSpaceLabels) {
      spaceLabelsById[sl.id] = sl;
      spaceLabelIds.push(sl.id);
    }

    // Loaded elements already store orientation360 in the offset-adjusted form
    // they were saved with, so adopt the saved offset without re-running recompute.
    // Recompute is only meaningful when the user changes the offset interactively,
    // and at this point in loadFromCSV the new elements aren't in state yet anyway.
    get().setGlobalOrientationOffset(metadata.globalOrientationOffset, { recompute: false });
    {
      // Use the CSV's explicit path, or the embedding host's configured default.
      // Community supplies its one starter defaults_template.json resource;
      // other hosts retain their historic workspace defaults.
      const rawFromCsv = metadata.defaultsPath?.trim() || options.defaultDefaultsPath;
      const pathsToTry = rawFromCsv ? defaultsReadPathAttempts(rawFromCsv) : [];
      const defaultsPathForStore = rawFromCsv
        ? normalizeDefaultsPathForMetadata(rawFromCsv)
        : undefined;
      const defaultsLoadVersion = invalidatePendingDefaultsWork(loadedCsvWorkScheduler);
      set({
        defaultsPath: defaultsPathForStore,
        defaultsJson: null,
        defaultsLoading: pathsToTry.length > 0,
        creationDefaultAssemblyIds: metadata.creationDefaultAssemblyIds ?? {},
      });
      if (pathsToTry.length > 0) {
        // Clear any previous defaults and load per-CSV defaults asynchronously.
        // Uses retry logic (up to 5 attempts with increasing delay) because
        // the file system handle may not be ready on initial load, causing a
        // race condition where validation runs before defaults are available.
        const MAX_DEFAULTS_RETRIES = 5;
        const tryReadFirstAvailable = async (): Promise<string> => {
          let lastErr: unknown;
          for (const p of pathsToTry) {
            try {
              return await options.workspaceResourcePort.readText(p);
            } catch (e) {
              lastErr = e;
            }
          }
          throw lastErr ?? new Error('No defaults paths to try');
        };
        const loadDefaultsWithRetry = (attempt: number) => {
          tryReadFirstAvailable()
            .then((content) => {
              if (defaultsLoadVersion !== loadedCsvWorkScheduler.defaultsVersion) return;
              try {
                const parsed = JSON.parse(content);
                set({ defaultsJson: parsed, defaultsLoading: false });
              } catch (error) {
                console.warn('[DefaultsCache] Failed to parse CSV defaults JSON:', error);
                set({ defaultsLoading: false });
              }
            })
            .catch((error) => {
              if (defaultsLoadVersion !== loadedCsvWorkScheduler.defaultsVersion) return;
              if (isWorkspaceUnavailableError(error)) {
                set({ defaultsLoading: false });
                return;
              }
              if (attempt < MAX_DEFAULTS_RETRIES) {
                const delayMs = 1500 * attempt;
                const retryTimer = globalThis.setTimeout(() => {
                  loadedCsvWorkScheduler.defaultsRetryTimers.delete(retryTimer);
                  if (defaultsLoadVersion !== loadedCsvWorkScheduler.defaultsVersion) return;
                  loadDefaultsWithRetry(attempt + 1);
                }, delayMs);
                loadedCsvWorkScheduler.defaultsRetryTimers.add(retryTimer);
              } else {
                console.warn('[DefaultsCache] Failed to load CSV defaults after', MAX_DEFAULTS_RETRIES, 'attempts:', error);
                set({ defaultsLoading: false });
              }
            });
        };
        loadDefaultsWithRetry(1);
      }
    }
    set({
      hostDocumentMetadata: metadata.hostDocumentMetadata,
      propertyPostcode: metadata.propertyPostcode,
    });
    {
      const overlayByFloor = metadata.guideOverlayByFloor ?? {};
      const sourceByFloor = metadata.guideOverlaySourceByFloor ?? {};
      const activeZ = get().currentFloorZ ?? 0;
      set({
        guideOverlayByFloor: overlayByFloor,
        guideOverlaySourceByFloor: sourceByFloor,
        guideOverlay: resolveGuideOverlayForFloor(overlayByFloor, activeZ).value,
        guideOverlaySource: resolveGuideOverlaySourceForFloor(sourceByFloor, activeZ).value,
      });
    }
    if (metadata.defaultThermalBridging !== undefined) {
      get().setDefaultThermalBridging(metadata.defaultThermalBridging);
    }
    get().setJunctionPsiDefaultsPath(metadata.junctionPsiDefaultsPath);
    get().setDetailedBridgePsiProfile(metadata.detailedBridgePsiProfile);
    const importedSettings: typeof metadata.complianceSettings = { ...metadata.complianceSettings };
    if (Object.keys(importedSettings).length > 0) {
      // Auto-derived dwelling values (GFA, building length/width, storey/build-type,
      // and labelled-space-derived room counts) get re-emitted on every export.
      // If the imported value matches the value we'd derive from the geometry,
      // treat it as auto (undefined) so future geometry edits keep flowing
      // through. Only a genuine divergence indicates a manual override the user
      // wants to keep.
      const numericClose = (a: number, b: number) => Math.abs(a - b) < 1e-4;

      // GroundFloorArea
      if (importedSettings.GroundFloorArea !== undefined) {
        const derived = calculateGroundFloorArea(newElements);
        if (derived > 0 && numericClose(importedSettings.GroundFloorArea, derived)) {
          importedSettings.GroundFloorArea = undefined;
        }
      }
      // AirPermeability_ventilation_zone_height — uses floors as the fallback
      // signal for height; at import time we don't yet have floors set up so
      // pass none, but the line-walls path is enough to derive in most cases.
      if (importedSettings.AirPermeability_ventilation_zone_height !== undefined) {
        const derivedVent = calculateSuggestedVentilationHeight(newElements);
        if (derivedVent > 0
            && numericClose(importedSettings.AirPermeability_ventilation_zone_height, derivedVent)) {
          importedSettings.AirPermeability_ventilation_zone_height = undefined;
        }
      }
      // BuildingLength / BuildingWidth
      const derivedLW = calculateDwellingLengthWidthFromGroundElements(newElements);
      if (importedSettings.BuildingLength !== undefined && derivedLW.lengthM > 0
          && numericClose(importedSettings.BuildingLength, derivedLW.lengthM)) {
        importedSettings.BuildingLength = undefined;
      }
      if (importedSettings.BuildingWidth !== undefined && derivedLW.widthM > 0
          && numericClose(importedSettings.BuildingWidth, derivedLW.widthM)) {
        importedSettings.BuildingWidth = undefined;
      }
      // build_type / storeys_in_dwelling / storey_of_dwelling
      const dd = calculateDwellingDetailsSuggestion(newElements);
      if (
        importedSettings.storey_of_dwelling !== undefined &&
        dd.storeyOfDwelling !== undefined &&
        (importedSettings.build_type ?? dd.buildType) === 'flat'
      ) {
        const legacyZeroBasedStorey = dd.contributingFloorLevels[0];
        if (
          legacyZeroBasedStorey !== undefined &&
          importedSettings.storey_of_dwelling === legacyZeroBasedStorey &&
          importedSettings.storey_of_dwelling !== dd.storeyOfDwelling
        ) {
          importedSettings.storey_of_dwelling = dd.storeyOfDwelling;
        }
      }
      if (importedSettings.build_type !== undefined
          && dd.buildType !== undefined
          && importedSettings.build_type === dd.buildType) {
        importedSettings.build_type = undefined;
      }
      if (importedSettings.storeys_in_dwelling !== undefined
          && dd.storeysInDwelling !== undefined
          && importedSettings.storeys_in_dwelling === dd.storeysInDwelling) {
        importedSettings.storeys_in_dwelling = undefined;
      }
      if (importedSettings.storey_of_dwelling !== undefined
          && dd.storeyOfDwelling !== undefined
          && importedSettings.storey_of_dwelling === dd.storeyOfDwelling) {
        importedSettings.storey_of_dwelling = undefined;
      }
      if ((importedSettings.build_type ?? dd.buildType) === 'house') {
        importedSettings.storey_of_dwelling = undefined;
        importedSettings.storeys_in_building = undefined;
      }
      if (importedSettings.Ventilation_ventilation_zone_base_height !== undefined) {
        const derivedVentForBase = calculateSuggestedVentilationHeight(newElements);
        const effectiveVentForBase = importedSettings.AirPermeability_ventilation_zone_height
          ?? (derivedVentForBase > 0 ? derivedVentForBase : undefined);
        const derivedVentBase = calculateSuggestedVentilationBaseHeight(newElements, undefined, {
          buildType: importedSettings.build_type ?? dd.buildType,
          storeysInDwelling: importedSettings.storeys_in_dwelling ?? dd.storeysInDwelling,
          storeyOfDwelling: importedSettings.storey_of_dwelling ?? dd.storeyOfDwelling,
          ventilationZoneHeight: effectiveVentForBase,
        });
        if (numericClose(importedSettings.Ventilation_ventilation_zone_base_height, derivedVentBase)) {
          importedSettings.Ventilation_ventilation_zone_base_height = undefined;
        }
      }
      if (
        importedSettings.build_type === 'house' &&
        importedSettings.storey_of_dwelling === undefined &&
        importedSettings.storeys_in_building === undefined
      ) {
        importedSettings.build_type = undefined;
      }
      // Space-label-derived room counts, aggregated across every non-placeholder
      // zone: counts describe the dwelling, not the primary zone.
      const dwellingWide = aggregateDwellingCounts(
        newSpaceLabels,
        dwellingCountZoneIds(newZones),
      );
      if (dwellingWide.hasLabelledFootprints) {
        const agg = { dwellingCounts: dwellingWide.dwellingCounts };
        const roomFields: Array<[
          keyof typeof importedSettings,
          keyof typeof agg.dwellingCounts,
        ]> = [
          ['NumberOfBedrooms', 'NumberOfBedrooms'],
          ['NumberOfWetRooms', 'NumberOfWetRooms'],
          ['NumberOfHabitableRooms', 'NumberOfHabitableRooms'],
          ['NumberOfHotTappedRooms', 'NumberOfHotTappedRooms'],
          ['NumberOfUtilityRooms', 'NumberOfUtilityRooms'],
          ['NumberOfBathrooms', 'NumberOfBathrooms'],
          ['NumberOfSanitaryAccommodations', 'NumberOfSanitaryAccommodations'],
        ];
        for (const [csKey, aggKey] of roomFields) {
          const imported = importedSettings[csKey];
          const derivedCount = Math.round(agg.dwellingCounts[aggKey]);
          if (typeof imported === 'number' && imported === derivedCount) {
            (importedSettings as Record<string, unknown>)[csKey as string] = undefined;
          }
        }
      }
    }
    get().replaceComplianceSettings(importedSettings);

    newElements.forEach((element) => {
      try {
        if (element.type === 'ThermalBridgeLinear') {
          ingestThermalBridgeLinearPostParse(element, newElements);
          const storey = resolveThermalBridgeLinearFloorIdAfterHostsReady(element, newElements, get().floors);
          const floorId = get().ensureFloorForZ(storey);
          element.floorId = floorId;
          element.extra_json = mergeThermalBridgeExtraJsonFloorId(element, storey);
          return;
        }
        if (
          element.type === 'WaterPipework' ||
          element.type === 'ThermalBridgePoint'
        ) {
          const serviceLineElement: ServiceLineFloorElement = element;
          const storey = resolvePhysicalZElementStoreyForCsvLoad(element, get().floors);
          const floorId = get().ensureFloorForZ(storey);
          serviceLineElement.floorId = floorId;
          serviceLineElement.extra_json = mergeServiceLineExtraJsonFloorId(element, storey);
          return;
        }
        if (element.type === 'MechanicalVentilationDuctwork') {
          const storey = resolveMechanicalVentilationDuctworkStoreyForCsvLoad(element, newElements, get().floors);
          const floorId = get().ensureFloorForZ(storey);
          element.floorId = floorId;
          element.extra_json = mergeServiceLineExtraJsonFloorId(element, storey);
          return;
        }
        if (element.type === 'MechanicalVentilationTerminal') {
          const storey = resolveMechanicalVentilationTerminalStoreyForCsvLoad(element, newElements, get().floors);
          element.floorId = get().ensureFloorForZ(storey);
          return;
        }
        const coords = element.coordinates;
        const firstZ = Array.isArray(coords) && coords.length > 0 ? Math.floor(coords[0].z ?? 0) : 0;
        element.floorId = get().ensureFloorForZ(firstZ);
      } catch { /* swallow: best-effort */ }
    });

    // Apply persisted floor storey-height and base-elevation overrides now that every floor has
    // been (re-)created above from element z-values. Without this, a user-typed floor value
    // always reverted to its derived value on reload — the CSV had nowhere to record the
    // override, so `ensureFloorForZ` -> `addFloor(name, 0, false, z)` always recreated floors
    // without the corresponding override flag.
    //
    // The parsed rows are the COMPLETE override set for this document: loadFromCSV does not
    // clear floors and the production load flows call it without clearAll, so a floor reused
    // from a previously-open model can carry that model's heightUserOverride. Floors with no
    // row therefore have the flag cleared — otherwise the stale override would leak into the
    // newly loaded document and be persisted by its next save. A row whose zIndex has no
    // matching floor (e.g. a hand-edited or truncated CSV) is ignored: it cannot happen from a
    // save this store produced, but must not throw.
    set((state) => ({
      floors: applyFloorBaseHeightOverrides(
        applyFloorHeightOverrides(state.floors, metadata.floorHeightOverrides),
        metadata.floorBaseHeightOverrides,
      ),
    }));

    if (options.schemaPort.availability === 'available') {
      newElements.forEach((element) => {
        coerceElementToStrictestNumericTyping(element, options.schemaPort);
      });
    }

    const importedParentByName = new Map<string, Element>();
    for (const element of newElements) {
      if (element.name) importedParentByName.set(element.name, element);
    }
    for (const element of newElements) {
      if (element.type !== 'MechanicalVentilationTerminal') continue;
      const hostName = element.host_element?.trim();
      if (!hostName) continue;
      const host = importedParentByName.get(hostName);
      if (isMvhrTerminalHost(host)) continue;
      element.host_element = null;
      element.orientation360 = undefined;
      element.pitch = undefined;
      parseWarnings.push(
        `MechanicalVentilationTerminal '${element.name}' disconnected from ineligible host '${hostName}'`,
      );
    }
    // Effective (override-aware) storey heights, matching the in-session updateElement path and
    // the PV host reconstruction further below — computed once for every hosted-transparent
    // opening in this loop rather than per-iteration.
    const effectiveFloorsForHostedTransparent = withEffectiveStoreyHeights(get().floors, newElements);
    for (const element of newElements) {
      if (element.type !== 'BuildingElementTransparent') continue;
      const opening = element as BuildingElementTransparent;
      if (!opening.parent_element || !Array.isArray(opening.coordinates) || opening.coordinates.length < 3) continue;
      const parent = importedParentByName.get(opening.parent_element);
      if (
        !parent ||
        parent.type !== 'BuildingElementOpaque' ||
        !Array.isArray(parent.coordinates) ||
        parent.coordinates.length < 3
      ) {
        continue;
      }
      const roof = parent as BuildingElementOpaque;
      const aligned = alignHostedSlopedPanelToHostOrientation(opening, roof, metadata.globalOrientationOffset);
      if (aligned) {
        opening.coordinates = aligned;
      }
      const derived = deriveFromHostRoof(opening, roof, effectiveFloorsForHostedTransparent, metadata.globalOrientationOffset);
      Object.assign(opening, buildTransparentHostDerivedPatch(opening, derived));
    }

    const { elementsById, elementIds } = migrateElementsToNormalized(newElements);

    const allElements = Object.values(elementsById) as Element[];

    reconstructSlopedDimensionOverrideFlags(
      allElements,
      metadata.globalOrientationOffset,
      metadata.provenanceMarkersVersion,
    );
    reconstructPvHostLinkAndOverrideFlags(
      allElements,
      elementsById,
      get().floors,
      metadata.globalOrientationOffset,
      metadata.provenanceMarkersVersion,
    );

    // Before deriving zone properties, restore authored Metadata markers in versioned documents;
    // unversioned documents retain the existing CSV-vs-derived migration heuristic.
    const zonesWithOverrideFlags = newZones.map(zone => {
      const flags: Partial<typeof zone> = {};
      const csvFloorArea = zone.floorArea || 0;
      if (
        csvFloorArea > 0
        && !isOverrideDescriptorAuthoritative(
          ZONE_FLOOR_AREA_OVERRIDE_DESCRIPTOR,
          metadata.provenanceMarkersVersion,
        )
      ) {
        const { floorArea: derivedArea } = calculateDerivedFloorArea(zone.id, allElements);
        if (derivedArea > 0 && Math.abs(csvFloorArea - derivedArea) > FLOOR_AREA_MATCH_EPSILON_M2) {
          flags._floorAreaUserOverride = true;
        }
      }
      const csvHeight = zone.height || 0;
      if (
        csvHeight > 0
        && !isOverrideDescriptorAuthoritative(
          ZONE_HEIGHT_OVERRIDE_DESCRIPTOR,
          metadata.provenanceMarkersVersion,
        )
      ) {
        const derivedH = calculateDerivedHeight(zone.id, allElements);
        if (derivedH > 0 && Math.abs(csvHeight - derivedH) > ZONE_OVERRIDE_EPSILON) {
          flags._heightUserOverride = true;
        }
      }
      return Object.keys(flags).length > 0 ? { ...zone, ...flags } : zone;
    });

    const zonesWithDerivedProperties = zonesWithOverrideFlags.map(zone => {
      const zoneUpdates = deriveZoneProperties(zone, allElements);
      return Object.keys(zoneUpdates).length > 0 ? { ...zone, ...zoneUpdates } : zone;
    });

    const labelList = spaceLabelIds.map((id) => spaceLabelsById[id]).filter(Boolean);
    let zonesForStore = zonesWithDerivedProperties;
    let complianceFromLabels: Partial<GeometryState['complianceSettings']> = {};
    if (labelList.length > 0) {
      const cv = get().complianceSettings.complianceValidationEnabled === true;
      const applied = applySpaceLabelsToZonesAndCompliance(zonesForStore, labelList, cv, undefined, {
        preserveManualFloorAreaOverride: true,
      });
      zonesForStore = applied.zones;
      complianceFromLabels = applied.compliancePatch;
    }

    set({
      zones: zonesForStore,
      elementsById,
      elementIds,
      spaceLabelsById,
      spaceLabelIds,
      canvasViewResetKey: (get().canvasViewResetKey ?? 0) + 1,
    });

    // Missing name markers deliberately degrade to the existing naming heuristic in every
    // document version. Product-authored manual names carry false-sense markers; this fallback
    // protects names from hand-edited or incomplete producers without weakening those markers.
    set((state) => {
      let changed = false;
      const nextElementsById = { ...state.elementsById };
      for (const id of state.elementIds) {
        const element = state.elementsById[id];
        if (!element || element._nameAutoSync !== undefined) continue;
        nextElementsById[id] = {
          ...element,
          _nameAutoSync: state.wouldElementNameLookAutoGenerated(id),
        } as Element;
        changed = true;
      }
      return changed ? { elementsById: nextElementsById } : state;
    });

    if (Object.keys(complianceFromLabels).length > 0) {
      get().setComplianceSettings(complianceFromLabels);
    }

    const state = get();
    const floorsWithElements = state.floors.filter(floor =>
      Object.values(state.elementsById).some(element => element.floorId === floor.id)
    );

    if (floorsWithElements.length > 0) {
      get().setCurrentFloor(floorsWithElements[0].id);
    }
    void get().syncAutoGeneratedElementNames();

    // Round-trip through the canonical serializer after all synchronous load
    // normalization, before control returns to callers that may edit immediately.
    scheduleLoadedCsvBaseline(
      get,
      set,
      loadedCsvWorkScheduler,
      get().generateCSV(),
    );

    return { warnings: [...parseWarnings, ...duplicateNameWarnings] };
  },
  });
};
