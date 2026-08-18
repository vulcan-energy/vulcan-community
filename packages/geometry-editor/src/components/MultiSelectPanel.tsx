// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Pencil, X as XIcon, type IconNode } from 'lucide';
import {
  useGeometryStore,
  useGeometryStoreApi,
  DUCT_TYPES,
  isGlobalObject,
  type DuctType,
} from '../stores/geometryStore';
import { StandardInput } from './StandardInput';
import { StandardDropdown } from './StandardDropdown';
import { SearchableDescribedSelect, type SearchableDescribedOption } from './SearchableDescribedSelect';
import { Tooltip } from './Tooltip';
import { loadBundledAssemblyLibrary, type BundledAssemblyLibrary } from '../lib/assemblyLibrary';
import type { AssemblyExample, VulcanAssemblyV1Envelope } from '../lib/assemblyTypes';
import { parseVulcanAssemblyV1FromExtraJson } from '../lib/assemblyAppliedUi';
import type { GroundFloorType } from '../lib/groundUValueCalculator';
import { getElementTypeDisplayName } from '../lib/displayNames';
import { isVulcanUiPartyFloorElement } from '../lib/assemblyMaterialFabric';
import {
  assemblyElementMode,
  assemblyPitchDegForElement,
  computePatchFromSavedAssembly,
  isFabricAssemblyElement,
  libraryElementTypeForElement,
  effectiveFabricDisplayValues,
} from '../lib/multiSelectAssemblyApply';
import { getElementShape } from '../lib/shapeUtils';
import { ELEMENT_TYPE_ORDER } from '../lib/elementTypeMetadata';
import type { WindowShading, Element, BuildingElementOpaque, BuildingElementTransparent, BuildingElementGround, BuildingElementAdjacentConditionedSpace, BuildingElementAdjacentUnconditionedSpace_Simple, BuildingElementPartyWall, WetEmitter, WaterPipework } from '../geometry/types';
import {
  AREAL_HEAT_CAPACITY_ENUM,
  MASS_DISTRIBUTION_CLASS_ENUM,
} from '../geometry/fieldTargets';
import { fhsFloorLabelForCanvasFloor } from '../lib/storeySemantics';
import {
  getParentControlledFloorZ,
  isElementFloorControlledByParent,
} from '../lib/parentControlledFloor';
import { getElementCanvasFloorZValue } from '../lib/elementCanvasFloor';
import { getSchemaParamIdForField } from '../lib/fieldTooltipMap';
import { formatSchemaInfoForTooltip } from '../utils/schemaTooltipHelpers';
import { resolveFieldPresentation, type ResolvedFieldPresentation } from '../lib/fieldPresentation';
import { classifyOpaqueFabricVariantFromElement } from '../lib/opaqueFabricVariant';
import {
  groundFloorTypeSupportsViewerElevation,
  isBasementGroundFloorType,
} from '../lib/groundFloorSubtype';
import {
  inferRadiatorThermalMode,
  pruneRadiatorEmitterExtraJson,
  type RadiatorThermalMode,
} from '../lib/radiatorEmitterBranches';
import { LazyModalFallback } from './LazyModuleFallback';
import {
  unavailableGeometryWorkspaceResourcePort,
  type GeometryWorkspaceResourcePort,
} from '../../../geometry-editor-host/src/workspaceResourcePort';
import { useGeometrySchemaPort } from '../../../geometry-editor-host/src/editorServicePorts';
import type { ExternalDetailCataloguePort } from '../geometry/thermalBridge/externalDetailContracts';
import { useKeyedState } from '../hooks/useKeyedState';
import { buildLightingPatch, getLightingFieldValue } from './elementForms/lighting';
import { projectWindowShadingPointToSegment } from './elementForms/windowShading';

const loadAssemblyCalculatorModal = () => import('./AssemblyCalculatorModal');

const prefetchAssemblyCalculatorModal = () => {
  void loadAssemblyCalculatorModal();
};

const intentPrefetchHandlers = (prefetch: () => void) => ({
  onPointerEnter: prefetch,
  onFocus: prefetch,
  onMouseDown: prefetch,
});

const AssemblyCalculatorModal = React.lazy(async () => {
  const module = await loadAssemblyCalculatorModal();
  return { default: module.AssemblyCalculatorModal };
});

const LucideSvgIcon: React.FC<{ node: IconNode; size?: number; strokeWidth?: number }> = ({
  node,
  size = 12,
  strokeWidth = 2,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {node.map(([tag, attrs], index) =>
      React.createElement(tag as keyof React.JSX.IntrinsicElements, {
        key: index,
        ...(attrs as Record<string, unknown>),
      }),
    )}
  </svg>
);

function elementRowLabel(el: Element): string {
  const n = typeof el.name === 'string' ? el.name.trim() : '';
  if (n.length > 0) return n;
  return `${getElementTypeDisplayName(el.type)} (${el.id.slice(0, 8)})`;
}

function initialAssemblySnapshotFromElement(el: Element): VulcanAssemblyV1Envelope['assemblySnapshot'] | null {
  const env = parseVulcanAssemblyV1FromExtraJson(el.extra_json);
  const snap = env?.assemblySnapshot;
  if (!snap || typeof snap !== 'object') return null;
  const layers = (snap as { layers?: unknown }).layers;
  if (!Array.isArray(layers) || layers.length === 0) return null;
  return snap as VulcanAssemblyV1Envelope['assemblySnapshot'];
}

// Field name to schema parameter ID mapping for MultiSelectPanel
// Using simple field names since findParameterInSchema does fuzzy matching
// and will find the property in the appropriate BuildingElement oneOf variant
const MULTISELECT_FIELD_MAP: Record<string, string> = {
  'wallHeight': 'height', // Will find BuildingElementOpaque.height via fuzzy matching
  'wallBaseHeight': 'base_height',
  'winHeight': 'height', // Will find BuildingElementTransparent.height
  'winBaseHeight': 'base_height',
  'winWidth': 'width', // Will find BuildingElementTransparent.width
  'freeAreaHeight': 'free_area_height',
  'midHeight': 'mid_height',
  'maxOpenArea': 'max_window_open_area',
  'frameAreaFraction': 'frame_area_fraction',
  'manualUValue': 'u_value',
  'manualThermalResistanceConstruction': 'thermal_resistance_construction',
  'manualArealHeatCapacity': 'areal_heat_capacity',
  'manualMassDistributionClass': 'mass_distribution_class',
  'manualColour': 'colour',
  'securityRisk': 'security_risk',
  'isUnheatedPitchedRoof': 'is_unheated_pitched_roof',
  'pitch': 'pitch',
  'floorType': 'floor_type',
  'depthBasementFloor': 'depth_basement_floor',
  'thicknessWalls': 'thickness_walls',
  'psiWallFloorJunc': 'psi_wall_floor_junc',
  'thermalResistanceUnconditionedSpace': 'thermal_resistance_unconditioned_space',
  'partyWallCavityResistance': 'thermal_resistance_cavity',
  'linearThermalTransmittance': 'linear_thermal_transmittance',
  'thermalBridgeLength': 'length',
  'heatTransferCoeff': 'heat_transfer_coeff',
  'ductInternalDiameter': 'internal_diameter_mm',
  'ductExternalDiameter': 'external_diameter_mm',
  'ductInsulationConductivity': 'insulation_thermal_conductivity',
  'ductInsulationThickness': 'insulation_thickness_mm',
  'pipeInternalDiameter': 'internal_diameter_mm',
  'pipeExternalDiameter': 'external_diameter_mm',
  'pipeInsulationConductivity': 'insulation_thermal_conductivity',
  'pipeInsulationThickness': 'insulation_thickness_mm',
  'ventMidHeight': 'mid_height_air_flow_path',
  'ventAreaCm2': 'area_cm2',
  'emitterArea': 'area',
  'emitterUnitNumber': 'unit_number',
  'lightingEfficacy': 'efficacy',
  'lightingCount': 'count',
  'lightingPower': 'power',
  'windowShadingDistance': 'distance',
  'windowShadingDepth': 'depth',
  'windowShadingHeight': 'height',
  'windowShadingTransparency': 'transparency',
};

const MANUAL_METRIC_TOOLTIP_FIELD_KEY: Record<string, string> = {
  u: 'manualUValue',
  r: 'manualThermalResistanceConstruction',
  mass: 'manualMassDistributionClass',
  areal: 'manualArealHeatCapacity',
};

interface MultiSelectPanelProps {
  selectedElementIds: string[];
  onDelete: () => void;
  workspaceResourcePort?: GeometryWorkspaceResourcePort;
  externalDetailCatalogue?: ExternalDetailCataloguePort;
}

type PropertyDistribution = {
  entries: Array<{ label: string; count: number }>;
  totalEligible: number;
};

type FabricScope = {
  key: string;
  label: string;
  order: number;
};
type FabricScopeGroup = FabricScope & {
  elements: Element[];
};
type SelectionTypeGroup = {
  type: Element['type'];
  label: string;
  elementIds: string[];
  count: number;
  order: number;
};
type SecondaryGroup = {
  key: string;
  label: string;
  elementIds: string[];
  count: number;
  order: number;
};

type OpaqueSurfaceMode = 'wall' | 'flat' | 'sloped' | 'door';
type SurfaceGeometryMode = 'wall' | 'flat' | 'sloped';

type LiveNumberBounds = {
  min?: number;
  max?: number;
  exclusiveMin?: boolean;
};

const LIVE_NUMBER_BOUNDS: Record<string, LiveNumberBounds> = {
  wallHeight: { min: 0.001, max: 50 },
  wallBaseHeight: { min: 0, max: 500 },
  winHeight: { min: 0.001, max: 50 },
  windowBaseHeight: { min: 0, max: 500 },
  winWidth: { min: 0.001, max: 100 },
  freeAreaHeight: { min: 0, max: 100 },
  midHeight: { min: 0, exclusiveMin: true, max: 100 },
  maxOpenArea: { min: 0, max: 100 },
  frameAreaFraction: { min: 0, max: 1 },
  manualUValue: { min: 0, exclusiveMin: true },
  manualThermalResistanceConstruction: { min: 0, exclusiveMin: true },
  pitch: { min: 0, max: 180 },
  depthBasementFloor: { min: 0, max: 20 },
  thicknessWalls: { min: 0, max: 5 },
  psiWallFloorJunc: { min: 0, max: 2 },
  thermalResistanceUnconditionedSpace: { min: 0, max: 3 },
  partyWallCavityResistance: { min: 0, exclusiveMin: true },
  linearThermalTransmittance: { min: 0 },
  thermalBridgeLength: { min: 0 },
  heatTransferCoeff: { min: 0 },
  ductDiameter: { min: 0, max: 1000 },
  ductInsulationConductivity: { min: 0 },
  ductInsulationThickness: { min: 0, max: 100 },
  pipeDiameter: { min: 5, max: 50 },
  pipeInsulationConductivity: { min: 0, exclusiveMin: true },
  pipeInsulationThickness: { min: 0 },
  ventMidHeight: { min: 1, max: 60 },
  ventAreaCm2: { min: 1, max: 999999 },
  emitterArea: { min: 0 },
  emitterUnitNumber: { min: 1 },
  lightingEfficacy: { min: 0, exclusiveMin: true },
  lightingCount: { min: 1 },
  lightingPower: { min: 0, exclusiveMin: true },
  windowShadingDistance: { min: 0, exclusiveMin: true },
  windowShadingDepth: { min: 0, exclusiveMin: true },
  windowShadingHeight: { min: 0, exclusiveMin: true },
  windowShadingTransparency: { min: 0, max: 1 },
  emitterFracConvective: { min: 0, max: 1 },
  emitterN: { min: 0, exclusiveMin: true, max: 2 },
  emitterLength: { min: 0, exclusiveMin: true },
  emitterCPerM: { min: 0, exclusiveMin: true },
  emitterC: { min: 0, exclusiveMin: true, max: 2 },
  emitterThermalMassPerM: { min: 0, exclusiveMin: true },
  emitterThermalMass: { min: 0, exclusiveMin: true },
  emitterEquivalentSpecificThermalMass: { min: 0 },
  emitterSystemPerformanceFactor: { min: 0 },
};

const HORIZONTAL_POLYGON_PITCH_OPTIONS: { value: string; label: string }[] = [
  { value: '0', label: 'Facing up (0°)' },
  { value: '180', label: 'Facing down (180°)' },
];

const isTransparent = (el: Element): el is BuildingElementTransparent => el.type === 'BuildingElementTransparent';
const isGround = (el: Element): el is BuildingElementGround => el.type === 'BuildingElementGround';
const isOpaque = (el: Element): el is BuildingElementOpaque => el.type === 'BuildingElementOpaque';
const isAdjacentUnconditioned = (el: Element): el is BuildingElementAdjacentUnconditionedSpace_Simple =>
  el.type === 'BuildingElementAdjacentUnconditionedSpace_Simple';
const isPartyWall = (el: Element): el is BuildingElementPartyWall => el.type === 'BuildingElementPartyWall';
const isThermalBridgeLinear = (el: Element): el is Element & { type: 'ThermalBridgeLinear'; length: number; linear_thermal_transmittance: number } =>
  el.type === 'ThermalBridgeLinear';
const isThermalBridgePoint = (el: Element): el is Element & { type: 'ThermalBridgePoint'; heat_transfer_coeff: number } =>
  el.type === 'ThermalBridgePoint';
const isDuctwork = (el: Element): el is Element & { type: 'MechanicalVentilationDuctwork'; duct_type?: string; length?: number } =>
  el.type === 'MechanicalVentilationDuctwork';
const isWaterPipework = (el: Element): el is Element & { type: 'WaterPipework'; location?: string; length?: number; pipework_type?: string } =>
  el.type === 'WaterPipework';
const isWetEmitter = (el: Element): el is Element & { type: 'WetEmitter'; subcategory?: string; area?: number; unit_number?: number; space_heat_system?: string } =>
  el.type === 'WetEmitter';
const isVent = (el: Element): el is Element & { type: 'Vents'; mid_height_air_flow_path?: number; area_cm2?: number } =>
  el.type === 'Vents';
const isLighting = (el: Element): el is Element & { type: 'Lighting'; efficacy?: number; count?: number; power?: number; bulbs?: Record<string, { efficacy?: number; count?: number; power?: number }> } =>
  el.type === 'Lighting';
const isWindowShading = (el: Element): el is WindowShading => el.type === 'WindowShading';
const isAnyElement = (el: Element): el is Element => !!el;

// Building fabric that can be wall- or polygon-shaped (3+ vertices).
type WallLikeElement = BuildingElementOpaque | BuildingElementAdjacentConditionedSpace | BuildingElementAdjacentUnconditionedSpace_Simple | BuildingElementPartyWall;
const isWallLike = (el: Element): el is WallLikeElement =>
  el.type === 'BuildingElementOpaque' ||
  el.type === 'BuildingElementAdjacentConditionedSpace' ||
  el.type === 'BuildingElementAdjacentUnconditionedSpace_Simple' ||
  el.type === 'BuildingElementPartyWall';

/** Line-segment walls only: geometry cleanup tools apply to vertical segments (2 points), not polygons. */
const isLineWallLike = (el: Element): el is WallLikeElement => isWallLike(el) && getElementShape(el) === 'line';

const isVariablePitchWallLike = (el: Element): el is WallLikeElement => {
  if (!isWallLike(el)) return false;
  const shape = getElementShape(el);
  return shape === 'line' || shape === 'sloped-polygon';
};

const isHorizontalPolygonPitchWallLike = (el: Element): el is WallLikeElement =>
  isWallLike(el) && getElementShape(el) === 'polygon';

const isVariablePitchTransparent = (el: Element): el is BuildingElementTransparent => {
  if (!isTransparent(el)) return false;
  const shape = getElementShape(el);
  return shape === 'line' || shape === 'sloped-polygon';
};

const isHorizontalPolygonTransparent = (el: Element): el is BuildingElementTransparent =>
  isTransparent(el) && getElementShape(el) === 'polygon';

function surfaceGeometryMode(el: Element): SurfaceGeometryMode {
  const shape = getElementShape(el);
  if (shape === 'polygon') return 'flat';
  if (shape === 'sloped-polygon') return 'sloped';

  const pitch = (el as { pitch?: number }).pitch;
  if (typeof pitch === 'number' && Number.isFinite(pitch) && pitch > 0 && pitch < 90) {
    return 'sloped';
  }
  return 'wall';
}

function horizontalPolygonSurfaceSelectValue(pitch: unknown): string {
  if (typeof pitch !== 'number' || !Number.isFinite(pitch)) return '';
  const rounded = Math.round(pitch);
  if (rounded === 0) return '0';
  if (rounded === 180) return '180';
  return '';
}

function horizontalPolygonSurfaceLabel(pitch: unknown): string | undefined {
  const value = horizontalPolygonSurfaceSelectValue(pitch);
  if (!value) return undefined;
  return HORIZONTAL_POLYGON_PITCH_OPTIONS.find((option) => option.value === value)?.label;
}

type ElementCoordinate = { x: number; y: number; z: number };

/** Plot/base elevation for batch summaries: opaque uses HEM `base_height`; adjacent/party use `_base_height` (3D). */
function wallPlotBaseHeightM(el: WallLikeElement): number | undefined {
  if (
    el.type === 'BuildingElementAdjacentConditionedSpace' ||
    el.type === 'BuildingElementAdjacentUnconditionedSpace_Simple' ||
    el.type === 'BuildingElementPartyWall'
  ) {
    const u = el as { _base_height?: number; base_height?: number };
    if (typeof u._base_height === 'number' && Number.isFinite(u._base_height)) return u._base_height;
    if (typeof u.base_height === 'number' && Number.isFinite(u.base_height)) return u.base_height;
    return undefined;
  }
  const u = el as BuildingElementOpaque;
  if (typeof u.base_height === 'number' && Number.isFinite(u.base_height)) return u.base_height;
  return undefined;
}

const formatValueLabel = (value: number) => {
  if (!Number.isFinite(value)) return '-';
  return Number(value.toFixed(2)).toString();
};

const formatScalarLabel = (value: unknown) => {
  if (typeof value === 'number') return formatValueLabel(value);
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'string' && value.trim().length > 0) return value;
  return '-';
};

const extraJsonRecord = (el: Element): Record<string, unknown> =>
  el.extra_json && typeof el.extra_json === 'object' && !Array.isArray(el.extra_json)
    ? (el.extra_json as Record<string, unknown>)
    : {};

const WINDOW_DETAIL_COPY_KEYS = ['window_part_list', 'treatment', '_treatment_ui', 'shading'] as const;
type WindowDetailCopyKey = typeof WINDOW_DETAIL_COPY_KEYS[number];
const WINDOW_DETAIL_VISIBLE_KEYS = ['window_part_list', 'treatment', 'shading'] as const;
type WindowDetailVisibleKey = typeof WINDOW_DETAIL_VISIBLE_KEYS[number];

const WINDOW_DETAIL_COPY_KEY_GROUPS: Record<WindowDetailVisibleKey, readonly WindowDetailCopyKey[]> = {
  window_part_list: ['window_part_list'],
  treatment: ['treatment', '_treatment_ui'],
  shading: ['shading'],
};

const WINDOW_DETAIL_COPY_LABELS: Record<WindowDetailVisibleKey, string> = {
  window_part_list: 'window parts',
  treatment: 'treatment',
  shading: 'shading',
};

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneExtraJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneExtraJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, cloneExtraJsonValue(child)]),
    );
  }
  return value;
}

function extraJsonValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => extraJsonValuesEqual(item, b[index]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const aEntries = Object.entries(a as Record<string, unknown>);
    const bRecord = b as Record<string, unknown>;
    if (aEntries.length !== Object.keys(bRecord).length) return false;
    return aEntries.every(([key, value]) =>
      Object.prototype.hasOwnProperty.call(bRecord, key) && extraJsonValuesEqual(value, bRecord[key]),
    );
  }
  return false;
}

function hasOwnExtraJsonKey(record: Record<string, unknown>, key: WindowDetailCopyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function buildWindowDetailCopyExtraJson(
  source: BuildingElementTransparent,
  target: BuildingElementTransparent,
  detailKey?: WindowDetailVisibleKey,
): Record<string, unknown> {
  const sourceExtra = extraJsonRecord(source);
  const nextExtra: Record<string, unknown> = { ...extraJsonRecord(target) };
  const copyKeys = detailKey ? WINDOW_DETAIL_COPY_KEY_GROUPS[detailKey] : WINDOW_DETAIL_COPY_KEYS;
  if (
    detailKey === 'treatment' &&
    (!hasOwnExtraJsonKey(sourceExtra, 'treatment') || sourceExtra.treatment == null)
  ) {
    delete nextExtra.treatment;
    delete nextExtra._treatment_ui;
    return nextExtra;
  }
  for (const key of copyKeys) {
    if (!hasOwnExtraJsonKey(sourceExtra, key) || sourceExtra[key] == null) {
      delete nextExtra[key];
      continue;
    }
    nextExtra[key] = cloneExtraJsonValue(sourceExtra[key]);
  }
  return nextExtra;
}

function windowShadingProjectionPatch(
  shading: WindowShading,
  parentName: string | null | undefined,
  nextShadingType: WindowShading['shading_type'] | 'object' | undefined,
  allElements: Element[],
): Pick<WindowShading, 'coordinates'> | null {
  if (!parentName || nextShadingType === 'object') return null;
  const point = shading.coordinates?.[0] as ElementCoordinate | undefined;
  if (!point) return null;
  const parent = allElements.find(
    (candidate): candidate is BuildingElementTransparent =>
      candidate.type === 'BuildingElementTransparent' && candidate.name === parentName,
  );
  if (!parent) return null;
  if (!Array.isArray(parent.coordinates) || parent.coordinates.length < 2) return null;
  const [a, b] = parent.coordinates as [ElementCoordinate, ElementCoordinate];
  if (!a || !b) return null;
  const coordinates = [projectWindowShadingPointToSegment(point, a, b)];
  return { coordinates } as Pick<WindowShading, 'coordinates'>;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function detailTypeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[_-]+/g, ' ');
}

function windowPartCountSummary(el: BuildingElementTransparent): string {
  const extra = extraJsonRecord(el);
  const value = extra.window_part_list;
  if (!hasOwnExtraJsonKey(extra, 'window_part_list') || value == null) return 'No parts';
  if (!Array.isArray(value)) return '1 part';
  if (value.length === 0) return 'No parts';
  return countLabel(value.length, 'part');
}

function windowPartDetailSummary(el: BuildingElementTransparent): string {
  const extra = extraJsonRecord(el);
  const value = extra.window_part_list;
  if (!hasOwnExtraJsonKey(extra, 'window_part_list') || value == null) return 'none';
  if (!Array.isArray(value)) return 'custom';
  if (value.length === 0) return 'none';
  const baseHeight = finiteNumber(el.base_height) ?? 0;
  const relMidpoints = value
    .map((entry) => (isRecordValue(entry) ? finiteNumber(entry.mid_height_air_flow_path) : undefined))
    .filter((midpoint): midpoint is number => midpoint !== undefined)
    .map((midpoint) => Math.max(0, midpoint - baseHeight));
  if (relMidpoints.length === 0) return countLabel(value.length, 'part');
  const preview = relMidpoints
    .slice(0, 2)
    .map((midpoint) => `${formatValueLabel(midpoint)}m`)
    .join(', ');
  const more = relMidpoints.length > 2 ? ` +${relMidpoints.length - 2}` : '';
  return `${countLabel(value.length, 'part')} @ ${preview}${more}`;
}

function windowTreatmentDetailSummary(el: BuildingElementTransparent): string {
  const extra = extraJsonRecord(el);
  const value = extra.treatment;
  if (!hasOwnExtraJsonKey(extra, 'treatment') || value == null) return 'none';
  if (!Array.isArray(value)) return 'custom';
  if (value.length === 0) return 'none';
  const first = value[0];
  if (!isRecordValue(first)) return countLabel(value.length, 'treatment');
  const type = detailTypeLabel(first.type) ?? 'treatment';
  const controls = detailTypeLabel(first.controls);
  const suffix = value.length > 1 ? ` +${value.length - 1}` : '';
  return `${type}${controls ? `, ${controls}` : ''}${suffix}`;
}

function windowShadingDetailSummary(el: BuildingElementTransparent, attachedShading: WindowShading[] = []): string {
  if (attachedShading.length > 0) {
    const types = attachedShading
      .map((entry) => detailTypeLabel(entry.shading_type))
      .filter((type): type is string => !!type);
    const uniqueTypes = [...new Set(types)];
    if (uniqueTypes.length === 1) {
      return countLabel(attachedShading.length, uniqueTypes[0]!);
    }
    if (uniqueTypes.length > 1) return `${countLabel(attachedShading.length, 'item')} mixed`;
    return countLabel(attachedShading.length, 'item');
  }

  const extra = extraJsonRecord(el);
  const value = extra.shading;
  if (!hasOwnExtraJsonKey(extra, 'shading') || value == null) return 'none';
  if (!Array.isArray(value)) return 'custom';
  if (value.length === 0) return 'none';
  const types = value
    .map((entry) => (isRecordValue(entry) ? detailTypeLabel(entry.type ?? entry.shading_type) : null))
    .filter((type): type is string => !!type);
  const uniqueTypes = [...new Set(types)];
  if (uniqueTypes.length === 1) {
    return countLabel(value.length, uniqueTypes[0]!);
  }
  if (uniqueTypes.length > 1) return `${countLabel(value.length, 'item')} mixed`;
  return countLabel(value.length, 'item');
}

function windowDetailSummary(
  el: BuildingElementTransparent,
  key: WindowDetailVisibleKey,
  attachedShading: WindowShading[] = [],
): string {
  if (key === 'window_part_list') return windowPartDetailSummary(el);
  if (key === 'treatment') return windowTreatmentDetailSummary(el);
  return windowShadingDetailSummary(el, attachedShading);
}

function formatOtherWindowCount(count: number): string {
  return `${count} other ${count === 1 ? 'window' : 'windows'}`;
}

function fabricScopeForElement(el: Element): FabricScope {
  if (el.type === 'BuildingElementOpaque') {
    if ((el as { is_external_door?: boolean }).is_external_door) {
      return { key: 'doors', label: 'Doors', order: 40 };
    }
    const mode = surfaceGeometryMode(el);
    if (mode === 'flat') {
      return { key: 'flat-surfaces', label: 'Flat surfaces', order: 20 };
    }
    if (mode === 'sloped') {
      return { key: 'sloped-surfaces', label: 'Sloped surfaces', order: 30 };
    }
    return { key: 'walls', label: 'Walls', order: 10 };
  }
  if (el.type === 'BuildingElementGround') {
    return { key: 'floors', label: 'Floors', order: 30 };
  }
  if (el.type === 'BuildingElementPartyWall') {
    const mode = surfaceGeometryMode(el);
    if (mode === 'flat') return { key: 'flat-surfaces', label: 'Flat surfaces', order: 52 };
    if (mode === 'sloped') return { key: 'sloped-surfaces', label: 'Sloped surfaces', order: 54 };
    return { key: 'walls', label: 'Walls', order: 50 };
  }
  if (el.type === 'BuildingElementAdjacentConditionedSpace') {
    if (isVulcanUiPartyFloorElement(el)) {
      return { key: 'party-floors', label: 'Party floors', order: 55 };
    }
    const mode = surfaceGeometryMode(el);
    if (mode === 'flat') return { key: 'flat-surfaces', label: 'Flat surfaces', order: 62 };
    if (mode === 'sloped') return { key: 'sloped-surfaces', label: 'Sloped surfaces', order: 64 };
    return { key: 'walls', label: 'Walls', order: 60 };
  }
  if (el.type === 'BuildingElementAdjacentUnconditionedSpace_Simple') {
    const mode = surfaceGeometryMode(el);
    if (mode === 'flat') return { key: 'flat-surfaces', label: 'Flat surfaces', order: 72 };
    if (mode === 'sloped') return { key: 'sloped-surfaces', label: 'Sloped surfaces', order: 74 };
    return { key: 'walls', label: 'Walls', order: 70 };
  }
  return { key: el.type, label: getElementTypeDisplayName(el.type), order: 100 };
}

function buildFabricScopeGroups(elements: Element[]): FabricScopeGroup[] {
  const byKey = new Map<string, FabricScopeGroup>();
  for (const el of elements) {
    const scope = fabricScopeForElement(el);
    const existing = byKey.get(scope.key);
    if (existing) existing.elements.push(el);
    else byKey.set(scope.key, { ...scope, elements: [el] });
  }
  for (const group of byKey.values()) {
    group.elements.sort((a, b) => elementRowLabel(a).localeCompare(elementRowLabel(b)));
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.label.localeCompare(b.label);
  });
}

function buildSelectionTypeGroups(elements: Element[]): SelectionTypeGroup[] {
  const byType = new Map<Element['type'], SelectionTypeGroup>();
  for (const el of elements) {
    const existing = byType.get(el.type);
    if (existing) {
      existing.elementIds.push(el.id);
      existing.count += 1;
      continue;
    }
    byType.set(el.type, {
      type: el.type,
      label: getElementTypeDisplayName(el.type),
      elementIds: [el.id],
      count: 1,
      order: ELEMENT_TYPE_ORDER_INDEX.get(el.type) ?? 999,
    });
  }
  for (const group of byType.values()) {
    group.elementIds.sort();
  }
  return [...byType.values()].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.label.localeCompare(b.label);
  });
}

function optionLabel(
  options: readonly { value: string; label: string }[],
  value: string,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function buildSecondaryGroups<T extends Element>(
  elements: T[],
  resolve: (el: T) => { key: string; label: string; order: number },
): SecondaryGroup[] {
  const byKey = new Map<string, SecondaryGroup>();
  for (const el of elements) {
    const group = resolve(el);
    const existing = byKey.get(group.key);
    if (existing) {
      existing.elementIds.push(el.id);
      existing.count += 1;
      continue;
    }
    byKey.set(group.key, { ...group, elementIds: [el.id], count: 1 });
  }
  for (const group of byKey.values()) {
    group.elementIds.sort();
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.label.localeCompare(b.label);
  });
}

function activeGroupKey(groups: SecondaryGroup[], draft: string | null): string | null {
  if (draft && groups.some((group) => group.key === draft)) return draft;
  return groups[0]?.key ?? null;
}

function groupElementIds(groups: SecondaryGroup[], key: string | null): string[] {
  return groups.find((group) => group.key === key)?.elementIds ?? [];
}

function windowShadingTypeLabel(value: string): string {
  return optionLabel(WINDOW_SHADING_TYPE_OPTIONS, value);
}

function wetEmitterSubcategoryLabel(value: string): string {
  return optionLabel(WET_EMITTER_SUBCATEGORY_OPTIONS, value);
}

function radiatorThermalModeLabel(value: string): string {
  return optionLabel(RADIATOR_THERMAL_MODE_OPTIONS, value);
}

function opaqueSurfaceModeLabel(value: string, plural = false): string {
  if (value === 'door') return plural ? 'Doors' : 'Door';
  if (value === 'flat') return plural ? 'Flat surfaces' : 'Flat surface';
  if (value === 'sloped') return plural ? 'Sloped surfaces' : 'Sloped surface';
  return plural ? 'Walls' : 'Wall';
}

function opaqueSurfaceMode(el: BuildingElementOpaque): OpaqueSurfaceMode {
  if ((el as { is_external_door?: boolean }).is_external_door) return 'door';
  return surfaceGeometryMode(el);
}

function windowSurfaceModeLabel(value: string, plural = false): string {
  if (value === 'flat') return plural ? 'Flat rooflights' : 'Flat rooflight';
  if (value === 'sloped') return plural ? 'Sloped rooflights' : 'Sloped rooflight';
  return plural ? 'Windows' : 'Window';
}

function buildWetEmitterSubcategoryPatch(
  el: Element & { type: 'WetEmitter'; subcategory?: string; area?: number; unit_number?: number; space_heat_system?: string },
  subcategory: WetEmitter['subcategory'],
): Partial<Element> {
  const currentExtra = extraJsonRecord(el);
  const nextExtra = { ...currentExtra };
  if (subcategory !== 'radiator') {
    delete nextExtra.length;
    delete nextExtra.c_per_m;
    delete nextExtra.thermal_mass_per_m;
    delete nextExtra.c;
    delete nextExtra.thermal_mass;
    delete nextExtra.n;
  }
  if (subcategory !== 'ufh') {
    delete nextExtra.equivalent_specific_thermal_mass;
    delete nextExtra.system_performance_factor;
    delete nextExtra.emitter_floor_area;
  }
  if (subcategory !== 'fancoil') {
    delete nextExtra.n_units;
    delete nextExtra.fancoil_test_data;
  }

  const patch: Partial<Element> = {
    subcategory,
  } as Partial<Element>;
  if (!extraJsonValuesEqual(currentExtra, nextExtra)) {
    (patch as { extra_json?: Record<string, unknown> }).extra_json = nextExtra;
  }
  if (subcategory === 'ufh') {
    if (el.unit_number !== undefined) {
      (patch as Partial<WetEmitter>).unit_number = undefined;
    }
  } else if (el.area !== undefined) {
    (patch as Partial<WetEmitter>).area = undefined;
  }
  return patch;
}

function selectionForElement(el: Element, focusFieldKey?: string): { type: 'element' | 'global'; id: string; focusFieldKey?: string } {
  return {
    type: isGlobalObject(el) ? 'global' : 'element',
    id: el.id,
    ...(focusFieldKey ? { focusFieldKey } : {}),
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

const computeDistribution = <T extends Element>(
  elements: Element[],
  predicate: (el: Element) => el is T,
  accessor: (el: T) => number | null | undefined
): PropertyDistribution | null => {
  const eligible = elements.filter(predicate) as T[];
  if (eligible.length === 0) return null;

  const counts = new Map<string, number>();
  for (const el of eligible) {
    const raw = accessor(el);
    const label = raw === null || raw === undefined ? '-' : formatValueLabel(raw);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const entries = Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
  return { entries, totalEligible: eligible.length };
};

const computeScalarDistribution = <T extends Element>(
  elements: Element[],
  predicate: (el: Element) => el is T,
  accessor: (el: T) => unknown,
): PropertyDistribution | null => {
  const eligible = elements.filter(predicate) as T[];
  if (eligible.length === 0) return null;

  const counts = new Map<string, number>();
  for (const el of eligible) {
    const label = formatScalarLabel(accessor(el));
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const entries = Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
  return { entries, totalEligible: eligible.length };
};

const describeDistribution = (distribution: PropertyDistribution | null) => {
  if (!distribution) {
    return {
      kind: 'none' as const,
      text: 'No eligible elements',
      title: 'No eligible elements in selection',
      inputValue: '',
      placeholder: 'Not in selection'
    };
  }

  const entryToString = (entry: { label: string; count: number }) => `${entry.label} (${entry.count})`;
  const sortedEntries = [...distribution.entries].sort((a, b) => {
    if (a.label === '-' && b.label !== '-') return 1;
    if (b.label === '-' && a.label !== '-') return -1;
    if (a.count !== b.count) return b.count - a.count;
    return a.label.localeCompare(b.label);
  });

  const previewEntries = sortedEntries.slice(0, 2);
  const previewText = previewEntries.length > 0 ? previewEntries.map(entryToString).join(', ') : '-';
  const hasMore = sortedEntries.length > 2;
  const onlyEntry = sortedEntries.length === 1 ? sortedEntries[0] : null;

  if (onlyEntry) {
    return {
      kind: onlyEntry.label === '-' ? 'empty' as const : 'all' as const,
      text: onlyEntry.label === '-' ? 'No current value' : `Current: ${entryToString(onlyEntry)}`,
      title: `Current values (${distribution.totalEligible} eligible): ${entryToString(onlyEntry)}`,
      inputValue: onlyEntry.label === '-' ? '' : onlyEntry.label,
      placeholder: onlyEntry.label === '-' ? 'No current value' : ''
    };
  }

  return {
    kind: 'mixed' as const,
    text: `Current: ${previewText}${hasMore ? ', …' : ''}`,
    title: `Current values (${distribution.totalEligible} eligible): ${sortedEntries.map(entryToString).join(', ')}`,
    inputValue: '',
    placeholder: `Mixed: ${previewText}${hasMore ? ', …' : ''}`
  };
};

const compactValueSummary = (values: unknown[]): string => {
  if (values.length === 0) return '-';
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = formatScalarLabel(value);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const entries = [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => {
      if (a.label === '-' && b.label !== '-') return 1;
      if (b.label === '-' && a.label !== '-') return -1;
      if (a.count !== b.count) return b.count - a.count;
      return a.label.localeCompare(b.label);
    });
  const showCounts = values.length > 1;
  return entries
    .slice(0, 2)
    .map((entry) => showCounts ? `${entry.label} (${entry.count})` : entry.label)
    .join(', ') + (entries.length > 2 ? ', ...' : '');
};

const assemblyImpactValue = (currentValues: unknown[], nextValues: unknown[]): string => {
  const current = compactValueSummary(currentValues);
  const next = compactValueSummary(nextValues);
  return current === next ? current : `${current} -> ${next}`;
};

const SummaryCaption: React.FC<{ summary: ReturnType<typeof describeDistribution> }> = ({ summary }) => {
  return (
    <div className="multi-select-summary-caption" title={summary.title}>
      {summary.text}
    </div>
  );
};

const BOOLEAN_SELECT_OPTIONS = [
  { value: 'true', label: 'True' },
  { value: 'false', label: 'False' },
] as const;
const WINDOW_SHADING_TYPE_OPTIONS = [
  { value: 'object', label: 'Obstacle' },
  { value: 'overhang', label: 'Overhang' },
  { value: 'sidefinleft', label: 'Left fin' },
  { value: 'sidefinright', label: 'Right fin' },
  { value: 'reveal', label: 'Reveal' },
] as const;
const COLOUR_OPTIONS = ['Light', 'Intermediate', 'Dark'].map((value) => ({ value, label: value }));
const FLOOR_TYPE_OPTIONS = [
  { value: 'Heated_basement', label: 'Heated Basement' },
  { value: 'Slab_no_edge_insulation', label: 'Slab No Edge Insulation' },
  { value: 'Slab_edge_insulation', label: 'Slab Edge Insulation' },
  { value: 'Suspended_floor', label: 'Suspended Floor' },
  { value: 'Unheated_basement', label: 'Unheated Basement' },
] as const;
const PARTY_WALL_CAVITY_OPTIONS = [
  { value: 'solid', label: 'Solid' },
  { value: 'unfilled_unsealed', label: 'Unfilled, unsealed' },
  { value: 'unfilled_sealed', label: 'Unfilled, sealed' },
  { value: 'filled_sealed', label: 'Filled, sealed' },
  { value: 'filled_unsealed', label: 'Filled, unsealed' },
  { value: 'defined_resistance', label: 'Defined resistance' },
] as const;
const PARTY_WALL_LINING_OPTIONS = [
  { value: 'wet_plaster', label: 'Wet plaster' },
  { value: 'dry_lined', label: 'Dry lined' },
] as const;
const PARTY_WALL_LINING_REQUIRED_CAVITY_TYPES = new Set([
  'unfilled_unsealed',
  'unfilled_sealed',
  'filled_unsealed',
]);
const CROSS_SECTION_OPTIONS = [
  { value: 'circular', label: 'Circular' },
  { value: 'rectangular', label: 'Rectangular' },
] as const;
const PIPE_CONTENT_OPTIONS = [
  { value: 'water', label: 'Water' },
  { value: 'glycol25', label: 'Glycol 25%' },
] as const;
const WET_EMITTER_SUBCATEGORY_OPTIONS = [
  { value: 'radiator', label: 'Radiator' },
  { value: 'ufh', label: 'Underfloor heating' },
  { value: 'fancoil', label: 'Fan coil' },
] as const;
const RADIATOR_THERMAL_MODE_OPTIONS = [
  { value: 'per_metre', label: 'Per metre' },
  { value: 'lumped', label: 'Lumped' },
] as const;
const JUNCTION_TYPE_OPTIONS = [
  'E1','E2','E3','E4','E5','E6','E7','E8','E9','E10','E11','E12','E13','E14','E15','E16','E17','E18','E19','E20','E21','E22','E23','E24','E25',
  'P1','P2','P3','P4','P5','P6','P7','P8',
  'R1','R2','R3','R4','R5','R6','R7','R8','R9','R10','R11',
].map((value) => ({ value, label: value }));
const ELEMENT_TYPE_ORDER_INDEX = new Map<Element['type'], number>(
  ELEMENT_TYPE_ORDER.map((type, index) => [type, index]),
);

const RowLabel: React.FC<{ label: string; hint?: string }> = ({ label, hint }) => (
  <>
    <span>{label}</span>
    {hint ? <span className="multi-select-row__hint">{hint}</span> : null}
  </>
);

const SecondaryGroupPills: React.FC<{
  ariaLabel: string;
  groups: SecondaryGroup[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  caption?: string;
  labelPrefix?: string;
}> = ({ ariaLabel, groups, activeKey, onSelect, caption = 'Scope', labelPrefix }) => {
  if (groups.length <= 1) return null;
  return (
    <div className="multi-select-scope-strip" role="group" aria-label={ariaLabel}>
      <span className="multi-select-scope-strip__label">{caption}</span>
      <div className="multi-select-scope-strip__chips">
        {groups.map((group) => {
          const active = group.key === activeKey;
          const accessibleLabel = labelPrefix
            ? `${labelPrefix} ${group.label} ${group.count}`
            : `${group.label} ${group.count}`;
          return (
            <button
              key={group.key}
              type="button"
              className={`multi-select-mode-button ${active ? 'multi-select-mode-button--active' : ''}`}
              aria-pressed={active}
              aria-label={accessibleLabel}
              onClick={() => onSelect(group.key)}
            >
              <span>{group.label}</span>
              <span className="multi-select-subgroup-count">{group.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const validateLiveNumberDraft = (raw: string, bounds: LiveNumberBounds | undefined): string | null => {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return 'Must be a valid number';
  if (bounds?.min !== undefined) {
    if (bounds.exclusiveMin ? parsed <= bounds.min : parsed < bounds.min) {
      return bounds.exclusiveMin
        ? `Must be greater than ${bounds.min}`
        : `Must be at least ${bounds.min}`;
    }
  }
  if (bounds?.max !== undefined && parsed > bounds.max) {
    return `Must be at most ${bounds.max}`;
  }
  return null;
};

export const MultiSelectPanel: React.FC<MultiSelectPanelProps> = ({
  selectedElementIds,
  onDelete,
  workspaceResourcePort = unavailableGeometryWorkspaceResourcePort,
  externalDetailCatalogue,
}) => {
  const geometryStore = useGeometryStoreApi();
  const schemaPort = useGeometrySchemaPort();

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      prefetchAssemblyCalculatorModal();
    }, 500);

    return () => {
      globalThis.clearTimeout(timer);
    };
  }, []);

  const {
    elementsById,
    floors,
    duplicateElements,
    updateElementsFloor,
    updateElementsBulk,
    applyExtraJsonMergeBulk,
    copyWindowShadingDetails,
    updateElement,
    setSelectedElementIds,
    setSelection,
    snapSelectedElements,
    rightAlignSelectedElements,
    mergeSelectedRooms,
    mirrorSelectedElements,
    rotateSelectedElements,
  } = useGeometryStore();
  const complianceValidationEnabled = useGeometryStore(
    (s) => !!s.complianceSettings?.complianceValidationEnabled,
  );
  const defaultsLookup = useGeometryStore((s) => s.getDefaultsLookup());

  const selectedElements = useMemo(
    () => selectedElementIds.map(id => elementsById[id]).filter(Boolean) as Element[],
    [selectedElementIds, elementsById],
  );
  const typeGroups = useMemo(
    () => buildSelectionTypeGroups(selectedElements),
    [selectedElements],
  );
  const [activeTypeDraft, setActiveTypeDraft] = useState<Element['type'] | null>(null);
  const activeType = useMemo(() => {
    if (activeTypeDraft && typeGroups.some((group) => group.type === activeTypeDraft)) return activeTypeDraft;
    return typeGroups[0]?.type ?? null;
  }, [activeTypeDraft, typeGroups]);
  if (activeTypeDraft !== activeType) {
    setActiveTypeDraft(activeType);
  }
  const activeTypeGroup = useMemo(
    () => typeGroups.find((group) => group.type === activeType) ?? null,
    [activeType, typeGroups],
  );
  const activeElementIds = useMemo(
    () => activeTypeGroup?.elementIds ?? [],
    [activeTypeGroup],
  );
  const activeElements = useMemo(
    () => activeElementIds.map((id) => elementsById[id]).filter(Boolean) as Element[],
    [activeElementIds, elementsById],
  );
  const resolveTooltipElementType = useCallback((targetIds?: string[]): Element['type'] | undefined => {
    const ids = targetIds && targetIds.length > 0 ? targetIds : activeElementIds;
    for (const id of ids) {
      const type = elementsById[id]?.type;
      if (type) return type;
    }
    return activeType ?? undefined;
  }, [activeElementIds, activeType, elementsById]);
  const rowPresentationCache = new Map<string, ResolvedFieldPresentation>();
  const resolveRowFieldPresentation = (
    fieldKey: string | undefined,
    label: string,
    targetIds?: string[],
  ): ResolvedFieldPresentation | null => {
    const elementType = resolveTooltipElementType(targetIds);
    const paramId = (fieldKey ? MULTISELECT_FIELD_MAP[fieldKey] : undefined)
      ?? getSchemaParamIdForField(label, elementType);
    if (!paramId) return null;
    const ids = targetIds && targetIds.length > 0 ? targetIds : activeElementIds;
    const element = ids.map((id) => elementsById[id]).find(Boolean) as Element | undefined;
    const record = element as unknown as Record<string, unknown> | undefined;
    const subtype = elementType === 'BuildingElementGround'
      ? String(record?.floor_type ?? '') || undefined
      : elementType === 'WetEmitter' || elementType === 'HotWaterDemand' || elementType === 'System'
        ? String(record?.subcategory ?? '') || undefined
        : elementType === 'MechanicalVentilation'
          ? String(record?.vent_type ?? '') || undefined
          : undefined;
    const opaqueFabricVariant = elementType === 'BuildingElementOpaque' && record
      ? classifyOpaqueFabricVariantFromElement(record)
      : undefined;
    const cacheKey = [
      complianceValidationEnabled ? 'fhs' : 'core',
      elementType ?? '',
      subtype ?? '',
      opaqueFabricVariant ?? '',
      paramId,
      label,
    ].join('|');
    const cached = rowPresentationCache.get(cacheKey);
    if (cached) return cached;
    const presentation = resolveFieldPresentation({
      mode: complianceValidationEnabled ? 'fhs' : 'core',
      propertyKey: paramId,
      elementType,
      subtype,
      opaqueFabricVariant,
      label,
    }, schemaPort);
    rowPresentationCache.set(cacheKey, presentation);
    return presentation;
  };
  const rowFieldUnit = (fieldKey: string, label: string, targetIds?: string[]) => {
    const presentation = resolveRowFieldPresentation(fieldKey, label, targetIds);
    return presentation?.unit.status === 'resolved' ? presentation.unit.display : undefined;
  };
  const renderTooltipRowLabel = (
    fieldKey: string | undefined,
    label: string,
    enabled: boolean,
    hint?: string,
    targetIds?: string[],
  ): React.ReactNode => {
    const presentation = resolveRowFieldPresentation(fieldKey, label, targetIds);
    const labelContent = (
      <div className={`multi-select-row__label ${enabled ? '' : 'multi-select-row__label--disabled'}`}>
        <RowLabel label={presentation?.label ?? label} hint={hint} />
      </div>
    );

    if (presentation?.tooltipInfo) {
      return (
        <Tooltip
          content={formatSchemaInfoForTooltip(presentation.tooltipInfo)}
          useFHSSchema={complianceValidationEnabled}
          position="right"
          maxWidth={350}
        >
          {labelContent}
        </Tooltip>
      );
    }

    return labelContent;
  };
  const allElements = useMemo(() => Object.values(elementsById).filter(Boolean) as Element[], [elementsById]);
  const floorEditableElementIds = activeElements
    .filter((element) => !isElementFloorControlledByParent(element, elementsById))
    .map((element) => element.id);
  const floorSelectionDisabled = activeElements.length > 0 && floorEditableElementIds.length === 0;

  // Get the current floor of selected elements (they're all the same floor)
  const firstSelected = activeElements[0];
  const currentFloorZ = firstSelected
    ? getParentControlledFloorZ(firstSelected, elementsById, floors) ?? getElementCanvasFloorZValue(firstSelected, floors)
    : undefined;
  const currentFloorValue = typeof currentFloorZ === 'number' ? String(Math.floor(currentFloorZ)) : '';
  const floorDropdownOptions = useMemo(() => {
    const zValues = new Set<number>();
    for (const floor of floors) {
      if (Number.isFinite(floor.zIndex)) zValues.add(Math.floor(floor.zIndex));
    }
    const selectedZ = currentFloorValue === '' ? NaN : Number(currentFloorValue);
    if (Number.isFinite(selectedZ)) zValues.add(Math.floor(selectedZ));
    if (zValues.size === 0) zValues.add(0);
    return [...zValues].sort((a, b) => a - b).map((z) => ({
      value: String(z),
      label: fhsFloorLabelForCanvasFloor(z),
    }));
  }, [currentFloorValue, floors]);

  const handleFloorChange = (value: string) => {
    const newFloorZ = Math.floor(parseInt(value || '0', 10));
    if (floorEditableElementIds.length === 0) return;
    updateElementsFloor(floorEditableElementIds, newFloorZ);
  };

  // --- Batch properties state ---
  const [snapTolerance, setSnapTolerance] = useState<string>('0.02');
  const [angleTolerance, setAngleTolerance] = useState<string>('5');
  const [mirrorDirection, setMirrorDirection] = useState<'left-right' | 'top-bottom'>('left-right');
  const [rotateDirection, setRotateDirection] = useState<'clockwise' | 'counter-clockwise'>('clockwise');
  const [rotateAngle, setRotateAngle] = useState<string>('90');

  const [assemblyLibrary, setAssemblyLibrary] = useState<BundledAssemblyLibrary | null>(null);
  const [assemblyLibraryError, setAssemblyLibraryError] = useState<string | null>(null);
  const [libraryModalOpen, setLibraryModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadBundledAssemblyLibrary(workspaceResourcePort)
      .then((lib) => {
        if (!cancelled) {
          setAssemblyLibrary(lib);
          setAssemblyLibraryError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setAssemblyLibrary(null);
          setAssemblyLibraryError(e instanceof Error ? e.message : 'Failed to load assembly library');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceResourcePort]);

  const fabricElements = useMemo(
    () => activeElements.filter(isFabricAssemblyElement),
    [activeElements],
  );

  const fabricScopeGroups = useMemo(
    () => buildFabricScopeGroups(fabricElements),
    [fabricElements],
  );
  const constructionScopeGroups = useMemo<SecondaryGroup[]>(
    () => fabricScopeGroups.map((group) => ({
      key: group.key,
      label: group.label,
      elementIds: group.elements.map((el) => el.id),
      count: group.elements.length,
      order: group.order,
    })),
    [fabricScopeGroups],
  );
  const [activeConstructionScopeDraft, setActiveConstructionScopeDraft] = useState<string | null>(null);
  const activeConstructionScope = activeGroupKey(constructionScopeGroups, activeConstructionScopeDraft);
  if (activeConstructionScopeDraft !== activeConstructionScope) {
    setActiveConstructionScopeDraft(activeConstructionScope);
  }
  const activeConstructionScopeGroup = useMemo(
    () => fabricScopeGroups.find((group) => group.key === activeConstructionScope) ?? null,
    [activeConstructionScope, fabricScopeGroups],
  );
  const activeConstructionScopeElements = useMemo(
    () => activeConstructionScopeGroup?.elements ?? [],
    [activeConstructionScopeGroup],
  );

  const libraryModalRepresentative = useMemo(
    () => (fabricElements.length > 0 ? fabricElements[0] : null),
    [fabricElements],
  );

  const reloadAssemblyLibrary = useCallback(() => {
    loadBundledAssemblyLibrary(workspaceResourcePort)
      .then(setAssemblyLibrary)
      .catch((e: unknown) => {
        setAssemblyLibraryError(e instanceof Error ? e.message : 'Failed to reload assembly library');
      });
  }, [workspaceResourcePort]);

  const selectionKinds = useMemo(() => {
    const kinds = new Set<string>();
    for (const el of activeElements) {
      if (el?.type) kinds.add(el.type);
    }
    return kinds;
  }, [activeElements]);

  // Wall height/base-height batch controls apply to wall-like fabric, including polygons.
  const activeWallLikeElements = useMemo(
    () => activeElements.filter(isWallLike),
    [activeElements],
  );
  const hasWallLikeElements = activeWallLikeElements.length > 0;
  const hasLineWalls = useMemo(
    () =>
      activeElements.some(isLineWallLike),
    [activeElements]
  );
  const hasWindows = useMemo(() => selectionKinds.has('BuildingElementTransparent'), [selectionKinds]);
  const activeWindows = useMemo(() => activeElements.filter(isTransparent), [activeElements]);
  const windowSurfaceModeGroups = useMemo(
    () => buildSecondaryGroups(activeWindows, (el) => {
      const mode = surfaceGeometryMode(el);
      return {
        key: mode,
        label: windowSurfaceModeLabel(mode, true),
        order: mode === 'wall' ? 10 : mode === 'flat' ? 20 : 30,
      };
    }),
    [activeWindows],
  );
  const [activeWindowSurfaceModeDraft, setActiveWindowSurfaceModeDraft] = useState<string | null>(null);
  const activeWindowSurfaceMode = activeGroupKey(windowSurfaceModeGroups, activeWindowSurfaceModeDraft);
  if (activeWindowSurfaceModeDraft !== activeWindowSurfaceMode) {
    setActiveWindowSurfaceModeDraft(activeWindowSurfaceMode);
  }
  const activeWindowSurfaceIds = useMemo(
    () => groupElementIds(windowSurfaceModeGroups, activeWindowSurfaceMode),
    [activeWindowSurfaceMode, windowSurfaceModeGroups],
  );
  const activeWindowSurfaceElements = useMemo(
    () => activeWindowSurfaceIds.map((id) => elementsById[id]).filter(isTransparent),
    [activeWindowSurfaceIds, elementsById],
  );
  const activeWindowVariablePitchIds = useMemo(
    () => activeWindowSurfaceElements.filter(isVariablePitchTransparent).map((el) => el.id),
    [activeWindowSurfaceElements],
  );
  const activeWindowVariablePitchElements = useMemo(
    () => activeWindowVariablePitchIds.map((id) => elementsById[id]).filter(isTransparent),
    [activeWindowVariablePitchIds, elementsById],
  );
  const activeWindowSurfaceFacingIds = useMemo(
    () => activeWindowSurfaceElements.filter(isHorizontalPolygonTransparent).map((el) => el.id),
    [activeWindowSurfaceElements],
  );
  const activeWindowSurfaceFacingElements = useMemo(
    () => activeWindowSurfaceFacingIds.map((id) => elementsById[id]).filter(isTransparent),
    [activeWindowSurfaceFacingIds, elementsById],
  );
  const attachedWindowShadingByWindowId = useMemo(() => {
    const byWindowId = new Map<string, WindowShading[]>();
    for (const windowElement of activeWindows) {
      byWindowId.set(windowElement.id, []);
    }
    if (activeWindows.length === 0) return byWindowId;

    for (const element of allElements) {
      if (!isWindowShading(element)) continue;
      for (const windowElement of activeWindows) {
        if (
          element.zoneId === windowElement.zoneId &&
          element.parent_element === windowElement.name
        ) {
          byWindowId.get(windowElement.id)?.push(element);
          break;
        }
      }
    }
    for (const entries of byWindowId.values()) {
      entries.sort((a, b) => elementRowLabel(a).localeCompare(elementRowLabel(b)));
    }
    return byWindowId;
  }, [activeWindows, allElements]);
  const hasFloors = useMemo(() => selectionKinds.has('BuildingElementGround'), [selectionKinds]);
  const hasFabricElements = fabricElements.length > 0;

  const activeWindowShadingElements = useMemo(
    () => activeElements.filter(isWindowShading),
    [activeElements],
  );
  const windowShadingTypeGroups = useMemo(
    () => buildSecondaryGroups(activeWindowShadingElements, (el) => {
      const order = WINDOW_SHADING_TYPE_OPTIONS.findIndex((option) => option.value === el.shading_type);
      return {
        key: el.shading_type,
        label: windowShadingTypeLabel(el.shading_type),
        order: order >= 0 ? order : 99,
      };
    }),
    [activeWindowShadingElements],
  );
  const [activeWindowShadingTypeDraft, setActiveWindowShadingTypeDraft] = useState<string | null>(null);
  const activeWindowShadingType = activeGroupKey(windowShadingTypeGroups, activeWindowShadingTypeDraft);
  if (activeWindowShadingTypeDraft !== activeWindowShadingType) {
    setActiveWindowShadingTypeDraft(activeWindowShadingType);
  }
  const activeWindowShadingIds = useMemo(
    () => groupElementIds(windowShadingTypeGroups, activeWindowShadingType),
    [activeWindowShadingType, windowShadingTypeGroups],
  );
  const activeWindowShadingGroupElements = useMemo(
    () => activeWindowShadingIds.map((id) => elementsById[id]).filter(isWindowShading),
    [activeWindowShadingIds, elementsById],
  );

  const activeWetEmitterElements = useMemo(
    () => activeElements.filter(isWetEmitter),
    [activeElements],
  );
  const emitterSubcategoryGroups = useMemo(
    () => buildSecondaryGroups(activeWetEmitterElements, (el) => {
      const key: string = el.subcategory || 'uncategorised';
      const order = WET_EMITTER_SUBCATEGORY_OPTIONS.findIndex((option) => option.value === key);
      return {
        key,
        label: key === 'uncategorised' ? 'Uncategorised' : wetEmitterSubcategoryLabel(key),
        order: order >= 0 ? order : 99,
      };
    }),
    [activeWetEmitterElements],
  );
  const [activeEmitterSubcategoryDraft, setActiveEmitterSubcategoryDraft] = useState<string | null>(null);
  const activeEmitterSubcategory = activeGroupKey(emitterSubcategoryGroups, activeEmitterSubcategoryDraft);
  if (activeEmitterSubcategoryDraft !== activeEmitterSubcategory) {
    setActiveEmitterSubcategoryDraft(activeEmitterSubcategory);
  }
  const activeEmitterIds = useMemo(
    () => groupElementIds(emitterSubcategoryGroups, activeEmitterSubcategory),
    [activeEmitterSubcategory, emitterSubcategoryGroups],
  );
  const activeEmitterGroupElements = useMemo(
    () => activeEmitterIds.map((id) => elementsById[id]).filter(isWetEmitter),
    [activeEmitterIds, elementsById],
  );
  const activeRadiatorElements = useMemo(
    () => activeEmitterGroupElements.filter((el) => el.subcategory === 'radiator'),
    [activeEmitterGroupElements],
  );
  const radiatorThermalModeGroups = useMemo(
    () => buildSecondaryGroups(activeRadiatorElements, (el) => {
      const mode = inferRadiatorThermalMode(extraJsonRecord(el));
      const order = RADIATOR_THERMAL_MODE_OPTIONS.findIndex((option) => option.value === mode);
      return {
        key: mode,
        label: radiatorThermalModeLabel(mode),
        order: order >= 0 ? order : 99,
      };
    }),
    [activeRadiatorElements],
  );
  const [activeRadiatorThermalModeDraft, setActiveRadiatorThermalModeDraft] = useState<string | null>(null);
  const activeRadiatorThermalMode = activeGroupKey(radiatorThermalModeGroups, activeRadiatorThermalModeDraft);
  if (activeRadiatorThermalModeDraft !== activeRadiatorThermalMode) {
    setActiveRadiatorThermalModeDraft(activeRadiatorThermalMode);
  }
  const activeRadiatorModeIds = useMemo(
    () => groupElementIds(radiatorThermalModeGroups, activeRadiatorThermalMode),
    [activeRadiatorThermalMode, radiatorThermalModeGroups],
  );
  const activeRadiatorModeElements = useMemo(
    () => activeRadiatorModeIds.map((id) => elementsById[id]).filter(isWetEmitter),
    [activeRadiatorModeIds, elementsById],
  );

  const activeOpaqueElements = useMemo(
    () => activeElements.filter(isOpaque),
    [activeElements],
  );
  const opaqueSurfaceModeGroups = useMemo(
    () => buildSecondaryGroups(activeOpaqueElements, (el) => {
      const mode = opaqueSurfaceMode(el);
      return {
        key: mode,
        label: opaqueSurfaceModeLabel(mode, true),
        order: mode === 'wall' ? 10 : mode === 'flat' ? 20 : mode === 'sloped' ? 30 : 40,
      };
    }),
    [activeOpaqueElements],
  );
  const [activeOpaqueSurfaceModeDraft, setActiveOpaqueSurfaceModeDraft] = useState<string | null>(null);
  const activeOpaqueSurfaceMode = activeGroupKey(opaqueSurfaceModeGroups, activeOpaqueSurfaceModeDraft);
  if (activeOpaqueSurfaceModeDraft !== activeOpaqueSurfaceMode) {
    setActiveOpaqueSurfaceModeDraft(activeOpaqueSurfaceMode);
  }
  const activeOpaqueSurfaceIds = useMemo(
    () => groupElementIds(opaqueSurfaceModeGroups, activeOpaqueSurfaceMode),
    [activeOpaqueSurfaceMode, opaqueSurfaceModeGroups],
  );
  const activeOpaqueSurfaceElements = useMemo(
    () => activeOpaqueSurfaceIds.map((id) => elementsById[id]).filter(isOpaque),
    [activeOpaqueSurfaceIds, elementsById],
  );
  const activeOpaqueVariablePitchIds = useMemo(
    () => activeOpaqueSurfaceElements.filter(isVariablePitchWallLike).map((el) => el.id),
    [activeOpaqueSurfaceElements],
  );
  const activeOpaqueVariablePitchElements = useMemo(
    () => activeOpaqueVariablePitchIds.map((id) => elementsById[id]).filter(isWallLike),
    [activeOpaqueVariablePitchIds, elementsById],
  );
  const activeOpaqueSurfaceFacingIds = useMemo(
    () => activeOpaqueSurfaceElements.filter(isHorizontalPolygonPitchWallLike).map((el) => el.id),
    [activeOpaqueSurfaceElements],
  );
  const activeOpaqueSurfaceFacingElements = useMemo(
    () => activeOpaqueSurfaceFacingIds.map((id) => elementsById[id]).filter(isWallLike),
    [activeOpaqueSurfaceFacingIds, elementsById],
  );
  const wallDimensionIds = useMemo(
    () => {
      if (activeOpaqueSurfaceIds.length > 0) return activeOpaqueSurfaceIds;
      if (
        activeType !== 'BuildingElementOpaque' &&
        constructionScopeGroups.length > 1 &&
        activeConstructionScopeElements.length > 0
      ) {
        return activeConstructionScopeElements.filter(isWallLike).map((el) => el.id);
      }
      return activeWallLikeElements.map((el) => el.id);
    },
    [
      activeConstructionScopeElements,
      activeOpaqueSurfaceIds,
      activeType,
      activeWallLikeElements,
      constructionScopeGroups.length,
    ],
  );
  const wallDimensionElements = useMemo(
    () => wallDimensionIds.map((id) => elementsById[id]).filter(isWallLike),
    [elementsById, wallDimensionIds],
  );
  const nonOpaqueWallDimensionIds = useMemo(
    () => wallDimensionElements.filter((el) => !isOpaque(el)).map((el) => el.id),
    [wallDimensionElements],
  );
  const nonOpaqueWallDimensionElements = useMemo(
    () => nonOpaqueWallDimensionIds.map((id) => elementsById[id]).filter(isWallLike),
    [elementsById, nonOpaqueWallDimensionIds],
  );
  const nonOpaqueVariablePitchIds = useMemo(
    () => nonOpaqueWallDimensionElements.filter(isVariablePitchWallLike).map((el) => el.id),
    [nonOpaqueWallDimensionElements],
  );
  const nonOpaqueVariablePitchElements = useMemo(
    () => nonOpaqueVariablePitchIds.map((id) => elementsById[id]).filter(isWallLike),
    [elementsById, nonOpaqueVariablePitchIds],
  );
  const nonOpaqueSurfaceFacingIds = useMemo(
    () => nonOpaqueWallDimensionElements.filter(isHorizontalPolygonPitchWallLike).map((el) => el.id),
    [nonOpaqueWallDimensionElements],
  );
  const nonOpaqueSurfaceFacingElements = useMemo(
    () => nonOpaqueSurfaceFacingIds.map((id) => elementsById[id]).filter(isWallLike),
    [elementsById, nonOpaqueSurfaceFacingIds],
  );
  const constructionTargetElements = useMemo(() => {
    if (activeType === 'BuildingElementOpaque') return activeOpaqueSurfaceElements;
    if (constructionScopeGroups.length > 1 && activeConstructionScopeElements.length > 0) {
      return activeConstructionScopeElements;
    }
    return fabricElements;
  }, [
    activeConstructionScopeElements,
    activeOpaqueSurfaceElements,
    activeType,
    constructionScopeGroups.length,
    fabricElements,
  ]);
  const constructionTargetIds = useMemo(
    () => constructionTargetElements.map((el) => el.id),
    [constructionTargetElements],
  );
  const constructionFieldScopeKey = useMemo(() => {
    if (activeType === 'BuildingElementOpaque') return `opaque:${activeOpaqueSurfaceMode ?? 'all'}`;
    return activeConstructionScope ?? activeType ?? 'fabric';
  }, [activeConstructionScope, activeOpaqueSurfaceMode, activeType]);
  const currentAssemblyId = useMemo(() => {
    const ids = new Set<string>();
    for (const el of constructionTargetElements) {
      const id = parseVulcanAssemblyV1FromExtraJson(el.extra_json)?.assemblyId;
      if (id) ids.add(id);
    }
    return ids.size === 1 ? [...ids][0]! : '';
  }, [constructionTargetElements]);
  const computeAssemblyPatchForTargets = useCallback((row: AssemblyExample) => {
    if (!assemblyLibrary) {
      return {
        patches: {} as Record<string, Record<string, unknown>>,
        appliedCount: 0,
        skippedCount: constructionTargetElements.length,
        description: 'Assembly library is not loaded.',
      };
    }

    const patches: Record<string, Record<string, unknown>> = {};
    const currentU: unknown[] = [];
    const nextU: unknown[] = [];
    const currentR: unknown[] = [];
    const nextR: unknown[] = [];
    const currentMass: unknown[] = [];
    const nextMass: unknown[] = [];
    const currentAreal: unknown[] = [];
    const nextAreal: unknown[] = [];
    let appliedCount = 0;
    let skippedCount = 0;

    for (const el of constructionTargetElements) {
      if (row.elementType !== libraryElementTypeForElement(el)) {
        skippedCount += 1;
        continue;
      }
      const mode = assemblyElementMode(el);
      if (!mode) {
        skippedCount += 1;
        continue;
      }
      const comp = computePatchFromSavedAssembly(
        row,
        assemblyLibrary,
        mode,
        assemblyPitchDegForElement(el),
        {
          fhsComplianceSnapArealHeat: complianceValidationEnabled,
          groundFloorType: el.type === 'BuildingElementGround' ? el.floor_type : null,
        },
      );
      if (!comp || comp.errors.length > 0 || Object.keys(comp.patch).length === 0) {
        skippedCount += 1;
        continue;
      }

      const current = effectiveFabricDisplayValues(el, defaultsLookup);
      currentU.push(current.u);
      nextU.push(comp.preview.u);
      currentR.push(current.r);
      nextR.push(comp.preview.r);
      currentMass.push(current.mass);
      nextMass.push(comp.preview.mass);
      currentAreal.push(current.arealHeat_kJ_m2K);
      nextAreal.push(comp.preview.arealHeat_kJ_m2K);
      patches[el.id] = comp.patch;
      appliedCount += 1;
    }

    const skipped = skippedCount > 0 ? `; skips ${skippedCount}` : '';
    const description = appliedCount === 0
      ? `No compatible selected elements${skippedCount > 0 ? `; skips ${skippedCount}` : ''}.`
      : [
          `Applies to ${countLabel(appliedCount, 'element')}${skipped}`,
          `U ${assemblyImpactValue(currentU, nextU)}`,
          `R ${assemblyImpactValue(currentR, nextR)}`,
          `Mass ${assemblyImpactValue(currentMass, nextMass)}`,
          `kappa ${assemblyImpactValue(currentAreal, nextAreal)}`,
        ].join(' · ');

    return { patches, appliedCount, skippedCount, description };
  }, [assemblyLibrary, complianceValidationEnabled, constructionTargetElements, defaultsLookup]);

  const assemblyOptions = useMemo<SearchableDescribedOption[]>(() => {
    if (!assemblyLibrary || constructionTargetElements.length === 0) return [];
    const options: SearchableDescribedOption[] = [];
    for (const row of assemblyLibrary.examples) {
      const impact = computeAssemblyPatchForTargets(row);
      if (impact.appliedCount === 0) continue;
      options.push({
        value: row.id,
        label: row.name,
        description: impact.description,
        searchText: `${row.elementType} ${impact.description}`,
      });
    }
    return options;
  }, [assemblyLibrary, computeAssemblyPatchForTargets, constructionTargetElements.length]);

  const handleAssemblySelect = useCallback((assemblyId: string) => {
    if (!assemblyLibrary || !assemblyId) return;
    const row = assemblyLibrary.examples.find((example) => example.id === assemblyId);
    if (!row) return;
    const { patches } = computeAssemblyPatchForTargets(row);
    if (Object.keys(patches).length === 0) return;
    applyExtraJsonMergeBulk(patches);
  }, [applyExtraJsonMergeBulk, assemblyLibrary, computeAssemblyPatchForTargets]);

  const wallHeightDistribution = useMemo(
    () => computeDistribution(wallDimensionElements, isWallLike, (el) => el.height),
    [wallDimensionElements]
  );
  const wallBaseHeightDistribution = useMemo(
    () =>
      computeDistribution(wallDimensionElements, isWallLike, (el) => wallPlotBaseHeightM(el)),
    [wallDimensionElements]
  );
  const wallPitchDistribution = useMemo(
    () =>
      computeDistribution(nonOpaqueVariablePitchElements, isWallLike, (el) => (el as { pitch?: number }).pitch),
    [nonOpaqueVariablePitchElements]
  );
  const wallSurfaceFacingDistribution = useMemo(
    () =>
      computeScalarDistribution(
        nonOpaqueSurfaceFacingElements,
        isWallLike,
        (el) => horizontalPolygonSurfaceLabel((el as { pitch?: number }).pitch),
      ),
    [nonOpaqueSurfaceFacingElements]
  );
  const windowBaseHeightDistribution = useMemo(
    () =>
      computeDistribution(activeWindowSurfaceElements, isTransparent, (el) => (el as { base_height?: number }).base_height),
    [activeWindowSurfaceElements]
  );
  const windowHeightDistribution = useMemo(
    () => computeDistribution(activeWindowSurfaceElements, isTransparent, (el) => el.height),
    [activeWindowSurfaceElements]
  );
  const windowWidthDistribution = useMemo(
    () => computeDistribution(activeWindowSurfaceElements, isTransparent, (el) => el.width),
    [activeWindowSurfaceElements]
  );
  const freeAreaHeightDistribution = useMemo(
    () => computeDistribution(activeWindowSurfaceElements, isTransparent, (el) => el.free_area_height),
    [activeWindowSurfaceElements]
  );
  const midHeightDistribution = useMemo(
    () => computeDistribution(activeWindowSurfaceElements, isTransparent, (el) => el.mid_height),
    [activeWindowSurfaceElements]
  );
  const maxOpenAreaDistribution = useMemo(
    () => computeDistribution(activeWindowSurfaceElements, isTransparent, (el) => el.max_window_open_area),
    [activeWindowSurfaceElements]
  );
  const frameAreaFractionDistribution = useMemo(
    () => computeDistribution(activeWindowSurfaceElements, isTransparent, (el) => el.frame_area_fraction),
    [activeWindowSurfaceElements]
  );
  const windowSecurityRiskDistribution = useMemo(
    () => computeScalarDistribution(activeWindowSurfaceElements, isTransparent, (el) => extraJsonRecord(el).security_risk),
    [activeWindowSurfaceElements]
  );
  const windowPitchDistribution = useMemo(
    () =>
      computeDistribution(activeWindowVariablePitchElements, isTransparent, (el) => (el as { pitch?: number }).pitch),
    [activeWindowVariablePitchElements]
  );
  const windowSurfaceFacingDistribution = useMemo(
    () =>
      computeScalarDistribution(
        activeWindowSurfaceFacingElements,
        isTransparent,
        (el) => horizontalPolygonSurfaceLabel((el as { pitch?: number }).pitch),
      ),
    [activeWindowSurfaceFacingElements]
  );

  const wallHeightSummary = describeDistribution(wallHeightDistribution);
  const wallBaseHeightSummary = describeDistribution(wallBaseHeightDistribution);
  const wallPitchSummary = describeDistribution(wallPitchDistribution);
  const wallSurfaceFacingSummary = describeDistribution(wallSurfaceFacingDistribution);
  const windowHeightSummary = describeDistribution(windowHeightDistribution);
  const windowBaseHeightSummary = describeDistribution(windowBaseHeightDistribution);
  const windowWidthSummary = describeDistribution(windowWidthDistribution);
  const windowPitchSummary = describeDistribution(windowPitchDistribution);
  const windowSurfaceFacingSummary = describeDistribution(windowSurfaceFacingDistribution);
  const freeAreaHeightSummary = describeDistribution(freeAreaHeightDistribution);
  const midHeightSummary = describeDistribution(midHeightDistribution);
  const maxOpenAreaSummary = describeDistribution(maxOpenAreaDistribution);
  const frameAreaFractionSummary = describeDistribution(frameAreaFractionDistribution);
  const windowSecurityRiskSummary = describeDistribution(windowSecurityRiskDistribution);
  const constructionUValueSummary = describeDistribution(
    computeDistribution(constructionTargetElements, isAnyElement, (el) =>
      effectiveFabricDisplayValues(el, defaultsLookup).u,
    ),
  );
  const constructionResistanceSummary = describeDistribution(
    computeDistribution(constructionTargetElements, isAnyElement, (el) =>
      effectiveFabricDisplayValues(el, defaultsLookup).r,
    ),
  );
  const constructionMassSummary = describeDistribution(
    computeScalarDistribution(constructionTargetElements, isAnyElement, (el) =>
      effectiveFabricDisplayValues(el, defaultsLookup).mass,
    ),
  );
  const constructionArealSummary = describeDistribution(
    computeScalarDistribution(constructionTargetElements, isAnyElement, (el) => {
      const band = extraJsonRecord(el).areal_heat_capacity;
      if (typeof band === 'string' && band.trim().length > 0) return band;
      const effective = effectiveFabricDisplayValues(el, defaultsLookup).arealHeat_kJ_m2K;
      return effective == null ? null : `${formatValueLabel(effective)} kJ/(m²·K)`;
    }),
  );

  const selectedElementKey = useMemo(
    () => [
      activeType ?? '',
      activeElementIds.join('|'),
      activeWindowShadingType ?? '',
      activeEmitterSubcategory ?? '',
      activeRadiatorThermalMode ?? '',
      activeOpaqueSurfaceMode ?? '',
      activeConstructionScope ?? '',
    ].join(':'),
    [
      activeElementIds,
      activeConstructionScope,
      activeEmitterSubcategory,
      activeOpaqueSurfaceMode,
      activeRadiatorThermalMode,
      activeType,
      activeWindowShadingType,
    ],
  );
  const emptyLiveDrafts = useMemo<Record<string, string>>(() => ({}), []);
  const [liveDrafts, setLiveDrafts] = useKeyedState(selectedElementKey, emptyLiveDrafts);

  const clearLiveDraft = useCallback((fieldKey: string) => {
    setLiveDrafts((prev) => {
      if (!(fieldKey in prev)) return prev;
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  }, [setLiveDrafts]);

  const liveNumberValue = (
    fieldKey: string,
    summary: ReturnType<typeof describeDistribution>,
    enabled: boolean,
  ) => {
    const draft = liveDrafts[fieldKey];
    if (draft !== undefined) return draft;
    if (!enabled) return '';
    return summary.inputValue;
  };

  const liveNumberPlaceholder = (
    summary: ReturnType<typeof describeDistribution>,
    enabled: boolean,
    fallback: string,
  ) => {
    if (!enabled) return 'Not in selection';
    return summary.placeholder || fallback;
  };

  /**
   * Runs `buildPatch` over the target elements and keeps only non-empty patches, keyed by id.
   * Every bulk edit on this panel starts this way.
   */
  const buildPerElementPatches = useCallback(<TPatch extends object>(
    targetIds: string[],
    buildPatch: (element: Element) => TPatch | null,
  ): Record<string, TPatch> => {
    const perId: Record<string, TPatch> = {};
    for (const id of targetIds) {
      const element = elementsById[id];
      if (!element) continue;
      const patch = buildPatch(element);
      if (patch && Object.keys(patch).length > 0) perId[id] = patch;
    }
    return perId;
  }, [elementsById]);

  /** Records the draft keystroke, then runs `apply` only for a valid, in-bounds number. */
  const withValidLiveNumber = useCallback((
    fieldKey: string,
    raw: string,
    bounds: LiveNumberBounds | undefined,
    apply: (value: number) => void,
  ) => {
    setLiveDrafts((prev) => ({ ...prev, [fieldKey]: raw }));
    const trimmed = raw.trim();
    if (trimmed === '') return;
    if (validateLiveNumberDraft(raw, bounds)) return;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    apply(parsed);
  }, [setLiveDrafts]);

  const commitLiveNumber = useCallback((
    fieldKey: string,
    raw: string,
    bounds: LiveNumberBounds | undefined,
    buildPatch: (el: Element, value: number) => Partial<Element> | null,
    targetIds: string[] = activeElementIds,
  ) => {
    withValidLiveNumber(fieldKey, raw, bounds, (value) => {
      const perId = buildPerElementPatches(targetIds, (el) => buildPatch(el, value));
      if (Object.keys(perId).length === 0) return;
      updateElementsBulk(perId, { mode: 'replace' });
    });
  }, [activeElementIds, buildPerElementPatches, updateElementsBulk, withValidLiveNumber]);

  const applyElementPatches = useCallback((
    buildPatch: (el: Element) => Partial<Element> | null,
    targetIds: string[] = activeElementIds,
  ) => {
    const entries = Object.entries(buildPerElementPatches(targetIds, buildPatch));
    entries.forEach(([id, patch], index) => {
      updateElement(id, patch, index < entries.length - 1);
    });
  }, [activeElementIds, buildPerElementPatches, updateElement]);

  const applyExtraJsonPatches = useCallback((
    patches: Record<string, Record<string, unknown>>,
    options?: { clearAssemblyEnvelope?: boolean },
  ) => {
    const entries = Object.entries(patches).filter(([, patch]) => Object.keys(patch).length > 0);
    if (entries.length === 0) return;
    entries.forEach(([id, patch], index) => {
      const el = elementsById[id];
      if (!el) return;
      const nextExtra = { ...extraJsonRecord(el), ...patch };
      if (options?.clearAssemblyEnvelope) {
        delete nextExtra.vulcan_assembly_v1;
      }
      updateElement(id, { extra_json: nextExtra }, index < entries.length - 1);
    });
  }, [elementsById, updateElement]);

  const applyExtraJsonChoice = useCallback((
    buildPatch: (el: Element) => Record<string, unknown> | null,
    options?: { clearAssemblyEnvelope?: boolean },
    targetIds: string[] = activeElementIds,
  ) => {
    applyExtraJsonPatches(buildPerElementPatches(targetIds, buildPatch), options);
  }, [activeElementIds, applyExtraJsonPatches, buildPerElementPatches]);

  const commitElementNumber = useCallback((
    fieldKey: string,
    raw: string,
    bounds: LiveNumberBounds | undefined,
    buildPatch: (el: Element, value: number) => Partial<Element> | null,
    targetIds: string[] = activeElementIds,
  ) => {
    withValidLiveNumber(fieldKey, raw, bounds, (value) => {
      applyElementPatches((el) => buildPatch(el, value), targetIds);
    });
  }, [activeElementIds, applyElementPatches, withValidLiveNumber]);

  const commitExtraJsonNumber = useCallback((
    fieldKey: string,
    raw: string,
    bounds: LiveNumberBounds | undefined,
    buildPatch: (el: Element, value: number) => Record<string, unknown> | null,
    targetIds: string[] = activeElementIds,
  ) => {
    withValidLiveNumber(fieldKey, raw, bounds, (value) => {
      applyExtraJsonPatches(buildPerElementPatches(targetIds, (el) => buildPatch(el, value)));
    });
  }, [activeElementIds, applyExtraJsonPatches, buildPerElementPatches, withValidLiveNumber]);

  const commitManualScopeExtraJsonNumber = useCallback((
    fieldKey: string,
    targetIds: string[],
    raw: string,
    bounds: LiveNumberBounds | undefined,
    buildPatch: (el: Element, value: number) => Record<string, unknown> | null,
  ) => {
    withValidLiveNumber(fieldKey, raw, bounds, (value) => {
      applyExtraJsonPatches(
        buildPerElementPatches(targetIds, (el) => buildPatch(el, value)),
        { clearAssemblyEnvelope: true },
      );
    });
  }, [applyExtraJsonPatches, buildPerElementPatches, withValidLiveNumber]);

  const applyManualScopeExtraJsonChoice = useCallback((
    targetIds: string[],
    buildPatch: (el: Element) => Record<string, unknown> | null,
  ) => {
    applyExtraJsonPatches(buildPerElementPatches(targetIds, buildPatch), {
      clearAssemblyEnvelope: true,
    });
  }, [applyExtraJsonPatches, buildPerElementPatches]);

  const buildTransparentLivePatch = useCallback((
    el: Element,
    directPatch: Record<string, number>,
  ): Partial<Element> | null => {
    if (!isTransparent(el)) return null;
    return directPatch as Partial<Element>;
  }, []);

  /**
   * Shared props for the panel's live-editing number inputs. The three variants differ only in
   * where the committed value lands (element field, extra_json, or manual-scope extra_json).
   */
  const numberInputProps = <TPatch,>(
    commit: (
      fieldKey: string,
      raw: string,
      bounds: LiveNumberBounds | undefined,
      buildPatch: (el: Element, value: number) => TPatch | null,
      targetIds: string[],
    ) => void,
  ) => (
    fieldKey: string,
    summary: ReturnType<typeof describeDistribution>,
    enabled: boolean,
    fallbackPlaceholder: string,
    buildPatch: (el: Element, value: number) => TPatch | null,
    bounds: LiveNumberBounds | undefined = LIVE_NUMBER_BOUNDS[fieldKey],
    targetIds: string[] = activeElementIds,
  ) => {
    const draft = liveDrafts[fieldKey];
    const error = draft !== undefined ? validateLiveNumberDraft(draft, bounds) : null;
    return {
      value: liveNumberValue(fieldKey, summary, enabled),
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        commit(fieldKey, e.target.value, bounds, buildPatch, targetIds),
      onBlur: () => clearLiveDraft(fieldKey),
      placeholder: liveNumberPlaceholder(summary, enabled, fallbackPlaceholder),
      disabled: !enabled,
      min: bounds?.min,
      max: bounds?.max,
      error: error ?? undefined,
      'aria-invalid': error ? true : undefined,
    };
  };

  const liveNumberInputProps = numberInputProps<Partial<Element>>(commitLiveNumber);
  const elementNumberInputProps = numberInputProps<Partial<Element>>(commitElementNumber);
  const extraJsonNumberInputProps = numberInputProps<Record<string, unknown>>(commitExtraJsonNumber);

  const renderNumberRow = (
    fieldKey: string,
    label: string,
    summary: ReturnType<typeof describeDistribution>,
    enabled: boolean,
    fallbackPlaceholder: string,
    buildPatch: (el: Element, value: number) => Partial<Element> | null,
    hint?: string,
    bounds: LiveNumberBounds | undefined = LIVE_NUMBER_BOUNDS[fieldKey],
    targetIds: string[] = activeElementIds,
  ) => (
    <div className="batch-row multi-select-row">
      {renderTooltipRowLabel(fieldKey, label, enabled, hint, targetIds)}
      <div className="multi-select-row__control">
        <StandardInput
          type="text"
          inputMode="decimal"
          unit={rowFieldUnit(fieldKey, label, targetIds)}
          step="0.01"
          variant="ghost"
          size="md"
          {...liveNumberInputProps(
            fieldKey,
            summary,
            enabled,
            fallbackPlaceholder,
            buildPatch,
            bounds,
            targetIds,
          )}
          aria-label={label}
        />
        <SummaryCaption summary={summary} />
      </div>
    </div>
  );

  const renderElementNumberRow = (
    fieldKey: string,
    label: string,
    summary: ReturnType<typeof describeDistribution>,
    enabled: boolean,
    fallbackPlaceholder: string,
    buildPatch: (el: Element, value: number) => Partial<Element> | null,
    hint?: string,
    bounds: LiveNumberBounds | undefined = LIVE_NUMBER_BOUNDS[fieldKey],
    targetIds: string[] = activeElementIds,
  ) => (
    <div className="batch-row multi-select-row">
      {renderTooltipRowLabel(fieldKey, label, enabled, hint, targetIds)}
      <div className="multi-select-row__control">
        <StandardInput
          type="text"
          inputMode="decimal"
          unit={rowFieldUnit(fieldKey, label, targetIds)}
          step="0.01"
          variant="ghost"
          size="md"
          {...elementNumberInputProps(
            fieldKey,
            summary,
            enabled,
            fallbackPlaceholder,
            buildPatch,
            bounds,
            targetIds,
          )}
          aria-label={label}
        />
        <SummaryCaption summary={summary} />
      </div>
    </div>
  );

  const renderExtraJsonNumberRow = (
    fieldKey: string,
    label: string,
    summary: ReturnType<typeof describeDistribution>,
    enabled: boolean,
    fallbackPlaceholder: string,
    buildPatch: (el: Element, value: number) => Record<string, unknown> | null,
    hint?: string,
    bounds: LiveNumberBounds | undefined = LIVE_NUMBER_BOUNDS[fieldKey],
    targetIds: string[] = activeElementIds,
  ) => (
    <div className="batch-row multi-select-row">
      {renderTooltipRowLabel(fieldKey, label, enabled, hint, targetIds)}
      <div className="multi-select-row__control">
        <StandardInput
          type="text"
          inputMode="decimal"
          unit={rowFieldUnit(fieldKey, label, targetIds)}
          step="0.01"
          variant="ghost"
          size="md"
          {...extraJsonNumberInputProps(
            fieldKey,
            summary,
            enabled,
            fallbackPlaceholder,
            buildPatch,
            bounds,
            targetIds,
          )}
          aria-label={label}
        />
        <SummaryCaption summary={summary} />
      </div>
    </div>
  );

  // Check if we can merge (2+ floors on same floor)
  const canMerge = useMemo(() => {
    if (!hasFloors) return false;
    const floors = activeElements.filter(el =>
      el.type === 'BuildingElementGround' &&
      el.coordinates &&
      el.coordinates.length >= 3
    );
    if (floors.length < 2) return false;

    // Check if all floors are on same floor (z-coordinate)
    const floorZ = floors[0]?.coordinates?.[0]?.z ?? 0;
    const floorZInt = Math.floor(floorZ);
    return floors.every(floor => {
      const z = floor.coordinates?.[0]?.z ?? 0;
      return Math.floor(z) === floorZInt;
    });
  }, [activeElements, hasFloors]);

  // Check if we can snap (2+ opaque line walls on same floor)
  const canSnap = useMemo(() => {
    if (!hasLineWalls) return false;
    const walls = activeElements.filter(el =>
      el.type === 'BuildingElementOpaque' &&
      el.coordinates &&
      el.coordinates.length === 2
    );
    if (walls.length < 2) return false;

    // Check if all walls are on same floor
    const floorZ = walls[0]?.coordinates?.[0]?.z ?? 0;
    const floorZInt = Math.floor(floorZ);
    return walls.every(wall => {
      const z = wall.coordinates?.[0]?.z ?? 0;
      return Math.floor(z) === floorZInt;
    });
  }, [activeElements, hasLineWalls]);

  const handleSnap = () => {
    const tol = parseFloat(snapTolerance);
    if (isNaN(tol) || tol <= 0) return;
    snapSelectedElements(activeElementIds, tol);
  };

  const handleTrim = () => {
    const tol = parseFloat(snapTolerance);
    if (isNaN(tol) || tol <= 0) return;
    // Reuse same floor validation as canSnap
    if (!canSnap) return;
    geometryStore.getState().trimSelectedElements(activeElementIds, tol);
  };

  const handleRightAlign = () => {
    const tol = parseFloat(angleTolerance);
    if (isNaN(tol) || tol <= 0) return;
    rightAlignSelectedElements(activeElementIds, tol);
  };

  const handleMerge = () => {
    if (!canMerge) return;
    mergeSelectedRooms(activeElementIds);
  };

  const transformableElementIds = selectedElementIds.filter(
    (id) => (elementsById[id]?.coordinates?.length ?? 0) > 0,
  );
  const canTransform = transformableElementIds.length > 0;

  const handleMirror = () => {
    if (!canTransform) return;
    mirrorSelectedElements(selectedElementIds, mirrorDirection);
  };

  const handleRotate = () => {
    const angle = parseFloat(rotateAngle);
    if (!canTransform || !Number.isFinite(angle) || angle <= 0) return;
    rotateSelectedElements(
      selectedElementIds,
      rotateDirection === 'clockwise' ? angle : -angle,
    );
  };

  const manualScopeNumberInputProps = (
    scopeKey: string,
    targetIds: string[],
    metricKey: string,
    summary: ReturnType<typeof describeDistribution>,
    fallbackPlaceholder: string,
    buildPatch: (el: Element, value: number) => Record<string, unknown> | null,
    bounds: LiveNumberBounds | undefined,
  ) => {
    const fieldKey = `manual:${scopeKey}:${metricKey}`;
    const draft = liveDrafts[fieldKey];
    const error = draft !== undefined ? validateLiveNumberDraft(draft, bounds) : null;
    return {
      value: liveNumberValue(fieldKey, summary, targetIds.length > 0),
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        commitManualScopeExtraJsonNumber(
          fieldKey,
          targetIds,
          e.target.value,
          bounds,
          buildPatch,
        ),
      onBlur: () => clearLiveDraft(fieldKey),
      placeholder: liveNumberPlaceholder(summary, true, fallbackPlaceholder),
      min: bounds?.min,
      max: bounds?.max,
      error: error ?? undefined,
      'aria-invalid': error ? true : undefined,
    };
  };

  const renderManualNumberRow = (
    scopeKey: string,
    targetIds: string[],
    metricKey: string,
    label: string,
    summary: ReturnType<typeof describeDistribution>,
    fallbackPlaceholder: string,
    buildPatch: (el: Element, value: number) => Record<string, unknown> | null,
    bounds: LiveNumberBounds | undefined,
  ) => (
    <div className="batch-row multi-select-row">
      {renderTooltipRowLabel(
        MANUAL_METRIC_TOOLTIP_FIELD_KEY[metricKey] ?? metricKey,
        label,
        targetIds.length > 0,
        undefined,
        targetIds,
      )}
      <div className="multi-select-row__control">
        <StandardInput
          type="text"
          inputMode="decimal"
          unit={rowFieldUnit(
            MANUAL_METRIC_TOOLTIP_FIELD_KEY[metricKey] ?? metricKey,
            label,
            targetIds,
          )}
          step="0.01"
          variant="ghost"
          size="md"
          aria-label={label}
          disabled={targetIds.length === 0}
          {...manualScopeNumberInputProps(
            scopeKey,
            targetIds,
            metricKey,
            summary,
            fallbackPlaceholder,
            buildPatch,
            bounds,
          )}
        />
        <SummaryCaption summary={summary} />
      </div>
    </div>
  );

  const renderManualSelectRow = (
    scopeKey: string,
    targetIds: string[],
    metricKey: string,
    label: string,
    summary: ReturnType<typeof describeDistribution>,
    options: readonly { value: string; label: string }[],
    buildPatch: (el: Element, value: string) => Record<string, unknown> | null,
  ) => {
    const enabled = targetIds.length > 0;
    const currentOption =
      summary.kind === 'all'
        ? options.find((option) => option.value === summary.inputValue || option.label === summary.inputValue)
        : undefined;
    const placeholder =
      summary.kind === 'mixed'
        ? summary.text
        : summary.kind === 'empty'
          ? 'No current value'
          : summary.inputValue || 'Set value...';

    return (
      <div className="batch-row multi-select-row">
        {renderTooltipRowLabel(
          MANUAL_METRIC_TOOLTIP_FIELD_KEY[metricKey] ?? metricKey,
          label,
          enabled,
          undefined,
          targetIds,
        )}
        <div className="multi-select-row__control">
        <select
          className="standard-input-ghost multi-select-field-select"
          aria-label={label}
          value={currentOption?.value ?? ''}
          disabled={!enabled}
          onChange={(e) => {
            const value = e.target.value;
            if (!value) return;
            applyManualScopeExtraJsonChoice(
              targetIds,
              (el) => buildPatch(el, value),
            );
          }}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <SummaryCaption summary={summary} />
        </div>
      </div>
    );
  };

  const renderSelectRow = (
    label: string,
    summary: ReturnType<typeof describeDistribution>,
    enabled: boolean,
    options: readonly { value: string; label: string }[],
    onSelect: (value: string) => void,
    hint?: string,
    targetIds?: string[],
  ) => {
    const currentOption =
      summary.kind === 'all'
        ? options.find((option) => option.value === summary.inputValue || option.label === summary.inputValue)
        : undefined;
    const placeholder =
      summary.kind === 'mixed'
        ? summary.text
        : summary.kind === 'empty'
          ? 'No current value'
          : 'Set value...';
    return (
      <div className="batch-row multi-select-row">
        {renderTooltipRowLabel(undefined, label, enabled, hint, targetIds)}
        <div className="multi-select-row__control">
          <select
            className="standard-input-ghost multi-select-field-select"
            aria-label={label}
            value={currentOption?.value ?? '__placeholder__'}
            disabled={!enabled}
            onChange={(e) => {
              if (e.target.value === '__placeholder__') return;
              onSelect(e.target.value);
            }}
          >
            <option value="__placeholder__">{placeholder}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <SummaryCaption summary={summary} />
        </div>
      </div>
    );
  };

  const renderExtraJsonSelectRow = (
    fieldKey: string,
    label: string,
    summary: ReturnType<typeof describeDistribution>,
    enabled: boolean,
    options: readonly { value: string; label: string }[],
    onSelect: (value: string) => void,
    hint?: string,
    targetIds?: string[],
  ) => {
    const currentOption =
      summary.kind === 'all'
        ? options.find((option) => option.value === summary.inputValue || option.label === summary.inputValue)
        : undefined;
    return (
      <div className="batch-row multi-select-row">
        {renderTooltipRowLabel(fieldKey, label, enabled, hint, targetIds)}
        <div className="multi-select-row__control">
          <select
            className="standard-input-ghost multi-select-field-select"
            aria-label={label}
            value={currentOption?.value ?? ''}
            disabled={!enabled}
            onChange={(e) => {
              if (!e.target.value) return;
              onSelect(e.target.value);
            }}
          >
            <option value="">Set value...</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <SummaryCaption summary={summary} />
        </div>
      </div>
    );
  };

  const renderSurfaceFacingRow = (
    summary: ReturnType<typeof describeDistribution>,
    targetIds: string[],
    isEligible: (el: Element) => boolean = isHorizontalPolygonPitchWallLike,
  ) => {
    const enabled = targetIds.length > 0;
    const currentOption =
      summary.kind === 'all'
        ? HORIZONTAL_POLYGON_PITCH_OPTIONS.find((option) => option.value === summary.inputValue || option.label === summary.inputValue)
        : undefined;
    const placeholder =
      summary.kind === 'mixed'
        ? summary.text
        : summary.kind === 'empty'
          ? 'No current value'
          : 'Set value...';
    return (
      <div className="batch-row multi-select-row">
        {renderTooltipRowLabel('pitch', 'Surface facing', enabled, undefined, targetIds)}
        <div className="multi-select-row__control">
          <select
            className="standard-input-ghost multi-select-field-select"
            aria-label="Surface facing"
            value={currentOption?.value ?? '__placeholder__'}
            disabled={!enabled}
            onChange={(e) => {
              if (e.target.value === '__placeholder__') return;
              const pitch = e.target.value === '180' ? 180 : 0;
              applyElementPatches(
                (el) => (isEligible(el) ? { pitch } as Partial<Element> : null),
                targetIds,
              );
            }}
          >
            <option value="__placeholder__">{placeholder}</option>
            {HORIZONTAL_POLYGON_PITCH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <SummaryCaption summary={summary} />
        </div>
      </div>
    );
  };

  const opaquePitchSummary = describeDistribution(
    computeDistribution(activeOpaqueVariablePitchElements, isOpaque, (el) => el.pitch),
  );
  const opaqueSurfaceFacingSummary = describeDistribution(
    computeScalarDistribution(activeOpaqueSurfaceFacingElements, isWallLike, (el) =>
      horizontalPolygonSurfaceLabel((el as { pitch?: number }).pitch),
    ),
  );
  const opaqueExternalDoorSummary = describeDistribution(
    computeScalarDistribution(activeOpaqueSurfaceElements, isOpaque, (el) => !!(el as { is_external_door?: boolean }).is_external_door),
  );
  const opaqueUnheatedRoofSummary = describeDistribution(
    computeScalarDistribution(activeOpaqueSurfaceElements, isOpaque, (el) => el.is_unheated_pitched_roof),
  );
  const opaqueColourSummary = describeDistribution(
    computeScalarDistribution(activeOpaqueSurfaceElements, isOpaque, (el) => extraJsonRecord(el).colour),
  );
  const activeGroundElements = activeElements.filter(isGround);
  const allActiveGroundsAreBasement =
    activeGroundElements.length > 0 &&
    activeGroundElements.every((el) => isBasementGroundFloorType(el.floor_type));
  const groundFloorTypeSummary = describeDistribution(
    computeScalarDistribution(activeElements, isGround, (el) => el.floor_type),
  );
  const groundDepthBasementSummary = describeDistribution(
    computeDistribution(activeGroundElements, isGround, (el) => el.depth_basement_floor),
  );
  const groundThicknessWallsSummary = describeDistribution(
    computeDistribution(activeElements, isGround, (el) => el.thickness_walls),
  );
  const groundPsiWallFloorSummary = describeDistribution(
    computeDistribution(activeElements, isGround, (el) => finiteNumber(extraJsonRecord(el).psi_wall_floor_junc)),
  );
  const unconditionedResistanceSummary = describeDistribution(
    computeDistribution(wallDimensionElements, isAdjacentUnconditioned, (el) =>
      finiteNumber(extraJsonRecord(el).thermal_resistance_unconditioned_space),
    ),
  );
  const partyWallCavityTypeSummary = describeDistribution(
    computeScalarDistribution(wallDimensionElements, isPartyWall, (el) => extraJsonRecord(el).party_wall_cavity_type),
  );
  const partyWallLiningTypeSummary = describeDistribution(
    computeScalarDistribution(wallDimensionElements, isPartyWall, (el) => extraJsonRecord(el).party_wall_lining_type),
  );
  const partyWallCavityResistanceSummary = describeDistribution(
    computeDistribution(wallDimensionElements, isPartyWall, (el) =>
      finiteNumber(extraJsonRecord(el).thermal_resistance_cavity),
    ),
  );
  const thermalBridgeLengthSummary = describeDistribution(
    computeDistribution(activeElements, isThermalBridgeLinear, (el) => el.length),
  );
  const thermalBridgePsiSummary = describeDistribution(
    computeDistribution(activeElements, isThermalBridgeLinear, (el) => el.linear_thermal_transmittance),
  );
  const thermalBridgeJunctionTypeSummary = describeDistribution(
    computeScalarDistribution(activeElements, isThermalBridgeLinear, (el) => extraJsonRecord(el).junction_type),
  );
  const thermalBridgePointHtcSummary = describeDistribution(
    computeDistribution(activeElements, isThermalBridgePoint, (el) => el.heat_transfer_coeff),
  );
  const ductParentSummary = describeDistribution(
    computeScalarDistribution(activeElements, isDuctwork, (el) => el.parent_element),
  );
  const ductTypeSummary = describeDistribution(
    computeScalarDistribution(activeElements, isDuctwork, (el) => el.duct_type),
  );
  const ductCrossSectionSummary = describeDistribution(
    computeScalarDistribution(activeElements, isDuctwork, (el) => extraJsonRecord(el).cross_section_shape),
  );
  const ductInternalDiameterSummary = describeDistribution(
    computeDistribution(activeElements, isDuctwork, (el) => finiteNumber(extraJsonRecord(el).internal_diameter_mm)),
  );
  const ductExternalDiameterSummary = describeDistribution(
    computeDistribution(activeElements, isDuctwork, (el) => finiteNumber(extraJsonRecord(el).external_diameter_mm)),
  );
  const ductInsulationConductivitySummary = describeDistribution(
    computeDistribution(activeElements, isDuctwork, (el) => finiteNumber(extraJsonRecord(el).insulation_thermal_conductivity)),
  );
  const ductInsulationThicknessSummary = describeDistribution(
    computeDistribution(activeElements, isDuctwork, (el) => finiteNumber(extraJsonRecord(el).insulation_thickness_mm)),
  );
  const ductReflectiveSummary = describeDistribution(
    computeScalarDistribution(activeElements, isDuctwork, (el) => extraJsonRecord(el).reflective),
  );
  const pipeLocationSummary = describeDistribution(
    computeScalarDistribution(activeElements, isWaterPipework, (el) => el.location),
  );
  const pipeInternalDiameterSummary = describeDistribution(
    computeDistribution(activeElements, isWaterPipework, (el) => finiteNumber(extraJsonRecord(el).internal_diameter_mm)),
  );
  const pipeExternalDiameterSummary = describeDistribution(
    computeDistribution(activeElements, isWaterPipework, (el) => finiteNumber(extraJsonRecord(el).external_diameter_mm)),
  );
  const pipeInsulationConductivitySummary = describeDistribution(
    computeDistribution(activeElements, isWaterPipework, (el) => finiteNumber(extraJsonRecord(el).insulation_thermal_conductivity)),
  );
  const pipeInsulationThicknessSummary = describeDistribution(
    computeDistribution(activeElements, isWaterPipework, (el) => finiteNumber(extraJsonRecord(el).insulation_thickness_mm)),
  );
  const pipeReflectivitySummary = describeDistribution(
    computeScalarDistribution(activeElements, isWaterPipework, (el) => extraJsonRecord(el).surface_reflectivity),
  );
  const pipeContentsSummary = describeDistribution(
    computeScalarDistribution(activeElements, isWaterPipework, (el) => extraJsonRecord(el).pipe_contents),
  );
  const ventParentSummary = describeDistribution(
    computeScalarDistribution(activeElements, isVent, (el) => el.parent_element),
  );
  const ventMidHeightSummary = describeDistribution(
    computeDistribution(activeElements, isVent, (el) => el.mid_height_air_flow_path),
  );
  const ventAreaSummary = describeDistribution(
    computeDistribution(activeElements, isVent, (el) => el.area_cm2),
  );
  const emitterSubcategorySummary = describeDistribution(
    computeScalarDistribution(activeEmitterGroupElements, isWetEmitter, (el) =>
      el.subcategory ? wetEmitterSubcategoryLabel(el.subcategory) : undefined,
    ),
  );
  const emitterSystemSummary = describeDistribution(
    computeScalarDistribution(activeEmitterGroupElements, isWetEmitter, (el) => el.space_heat_system),
  );
  const emitterAreaSummary = describeDistribution(
    computeDistribution(activeEmitterGroupElements, isWetEmitter, (el) => el.area),
  );
  const emitterUnitNumberSummary = describeDistribution(
    computeDistribution(activeEmitterGroupElements, isWetEmitter, (el) => el.unit_number),
  );
  const emitterFracConvectiveSummary = describeDistribution(
    computeDistribution(activeEmitterGroupElements, isWetEmitter, (el) =>
      finiteNumber(extraJsonRecord(el).frac_convective),
    ),
  );
  const emitterEquivalentSpecificThermalMassSummary = describeDistribution(
    computeDistribution(activeEmitterGroupElements, isWetEmitter, (el) =>
      finiteNumber(extraJsonRecord(el).equivalent_specific_thermal_mass),
    ),
  );
  const emitterSystemPerformanceFactorSummary = describeDistribution(
    computeDistribution(activeEmitterGroupElements, isWetEmitter, (el) =>
      finiteNumber(extraJsonRecord(el).system_performance_factor),
    ),
  );
  const radiatorThermalModeSummary = describeDistribution(
    computeScalarDistribution(activeRadiatorModeElements, isWetEmitter, (el) =>
      radiatorThermalModeLabel(inferRadiatorThermalMode(extraJsonRecord(el))),
    ),
  );
  const radiatorLengthSummary = describeDistribution(
    computeDistribution(activeRadiatorModeElements, isWetEmitter, (el) => finiteNumber(extraJsonRecord(el).length)),
  );
  const radiatorNExponentSummary = describeDistribution(
    computeDistribution(activeRadiatorModeElements, isWetEmitter, (el) => finiteNumber(extraJsonRecord(el).n)),
  );
  const radiatorCPerMSummary = describeDistribution(
    computeDistribution(activeRadiatorModeElements, isWetEmitter, (el) => finiteNumber(extraJsonRecord(el).c_per_m)),
  );
  const radiatorThermalMassPerMSummary = describeDistribution(
    computeDistribution(activeRadiatorModeElements, isWetEmitter, (el) =>
      finiteNumber(extraJsonRecord(el).thermal_mass_per_m),
    ),
  );
  const radiatorCSummary = describeDistribution(
    computeDistribution(activeRadiatorModeElements, isWetEmitter, (el) => finiteNumber(extraJsonRecord(el).c)),
  );
  const radiatorThermalMassSummary = describeDistribution(
    computeDistribution(activeRadiatorModeElements, isWetEmitter, (el) => finiteNumber(extraJsonRecord(el).thermal_mass)),
  );
  const windowShadingTypeSummary = describeDistribution(
    computeScalarDistribution(activeWindowShadingGroupElements, isWindowShading, (el) =>
      windowShadingTypeLabel(el.shading_type),
    ),
  );
  const windowShadingParentSummary = describeDistribution(
    computeScalarDistribution(activeWindowShadingGroupElements, isWindowShading, (el) => el.parent_element),
  );
  const windowShadingDistanceSummary = describeDistribution(
    computeDistribution(activeWindowShadingGroupElements, isWindowShading, (el) => el.distance),
  );
  const windowShadingDepthSummary = describeDistribution(
    computeDistribution(activeWindowShadingGroupElements, isWindowShading, (el) => el.depth),
  );
  const windowShadingHeightSummary = describeDistribution(
    computeDistribution(activeWindowShadingGroupElements, isWindowShading, (el) => el.height),
  );
  const windowShadingTransparencySummary = describeDistribution(
    computeDistribution(activeWindowShadingGroupElements, isWindowShading, (el) => el.transparency),
  );
  const lightingEfficacySummary = describeDistribution(
    computeDistribution(activeElements, isLighting, (el) => getLightingFieldValue(el, 'efficacy', true)),
  );
  const lightingCountSummary = describeDistribution(
    computeDistribution(activeElements, isLighting, (el) => getLightingFieldValue(el, 'count', true)),
  );
  const lightingPowerSummary = describeDistribution(
    computeDistribution(activeElements, isLighting, (el) => getLightingFieldValue(el, 'power', true)),
  );

  const ductParentOptions = useMemo(() => [
    { value: '', label: 'None' },
    ...allElements
      .filter((el) => el.type === 'MechanicalVentilation' && (el as { vent_type?: string }).vent_type === 'MVHR')
      .map((el) => ({ value: el.name, label: el.name })),
  ], [allElements]);
  const ventParentOptions = useMemo(() => [
    { value: '', label: 'None' },
    ...allElements
      .filter((el) => el.type === 'BuildingElementOpaque' || el.type === 'BuildingElementTransparent')
      .map((el) => ({ value: el.name, label: el.name })),
  ], [allElements]);
  const windowShadingParentOptions = useMemo(() => [
    { value: '', label: 'None' },
    ...allElements
      .filter((el) => el.type === 'BuildingElementTransparent')
      .map((el) => ({ value: el.name, label: el.name })),
  ], [allElements]);
  const spaceHeatSystemOptions = useMemo(() => {
    const values = new Map<string, string>();
    values.set('', 'None');
    for (const el of allElements) {
      if (el.type === 'System' && (el as { subcategory?: string }).subcategory === 'SpaceHeatSystem') {
        values.set(el.name, el.name);
      }
    }
    for (const el of activeElements) {
      if (isWetEmitter(el) && el.space_heat_system) values.set(el.space_heat_system, el.space_heat_system);
    }
    return [...values.entries()].map(([value, label]) => ({ value, label }));
  }, [activeElements, allElements]);

  const handleCopyWindowDetails = useCallback((sourceId: string, detailKey: WindowDetailVisibleKey) => {
    const source = elementsById[sourceId];
    if (!source || !isTransparent(source)) return;
    const targetWindows = activeWindowSurfaceIds
      .filter((id) => id !== sourceId)
      .map((id) => elementsById[id])
      .filter((element): element is BuildingElementTransparent => !!element && isTransparent(element));
    if (detailKey === 'shading') {
      copyWindowShadingDetails(sourceId, targetWindows.map((target) => target.id));
      return;
    }
    const patches = targetWindows
      .map((target) => ({
        target,
        extra_json: buildWindowDetailCopyExtraJson(source, target, detailKey),
      }))
      .filter(({ target, extra_json }) => !extraJsonValuesEqual(extraJsonRecord(target), extra_json));
    patches.forEach(({ target, extra_json }, index) => {
      updateElement(
        target.id,
        { extra_json } as Partial<Element>,
        index < patches.length - 1,
      );
    });
  }, [activeWindowSurfaceIds, copyWindowShadingDetails, elementsById, updateElement]);

  const handleEditWindowDetails = useCallback((sourceId: string, detailKey: WindowDetailVisibleKey) => {
    const source = elementsById[sourceId];
    if (!source || !isTransparent(source)) return;
    setSelectedElementIds([sourceId]);
    setSelection(selectionForElement(source, detailKey));
  }, [elementsById, setSelectedElementIds, setSelection]);

  const handleRemoveTypeFromSelection = useCallback((type: Element['type']) => {
    const remainingIds = selectedElementIds.filter((id) => elementsById[id]?.type !== type);
    setSelectedElementIds(remainingIds);
    if (remainingIds.length === 0) {
      setSelection(null);
      return;
    }
    if (remainingIds.length === 1) {
      const remaining = elementsById[remainingIds[0]!];
      setSelection(remaining ? selectionForElement(remaining) : null);
      return;
    }
    if (activeType === type) {
      const remainingTypes = buildSelectionTypeGroups(
        remainingIds.map((id) => elementsById[id]).filter(Boolean) as Element[],
      );
      setActiveTypeDraft(remainingTypes[0]?.type ?? null);
    }
  }, [activeType, elementsById, selectedElementIds, setSelectedElementIds, setSelection]);

  if (selectedElementIds.length === 0) {
    return null;
  }

  return (
    <div className="multi-select-panel">
      {/* Header – matches ElementCreator style */}
      <span className="controls-label multi-select-panel__title">Edit Multiple Elements</span>

      {typeGroups.length > 0 && (
        <div className="multi-select-type-rail" aria-label="Selected element types">
          {typeGroups.map((group) => {
            const active = group.type === activeType;
            return (
              <div
                key={group.type}
                className={`multi-select-type-pill ${active ? 'multi-select-type-pill--active' : ''}`}
              >
                <button
                  type="button"
                  className="multi-select-type-pill__select"
                  aria-pressed={active}
                  onClick={() => setActiveTypeDraft(group.type)}
                >
                  <span className="multi-select-type-pill__label">{group.label}</span>
                  <span className="multi-select-type-pill__count">{group.count}</span>
                </button>
                <button
                  type="button"
                  className="multi-select-type-pill__remove"
                  aria-label={`Remove ${group.label} from selection`}
                  title={`Remove ${group.label} from selection`}
                  onClick={() => handleRemoveTypeFromSelection(group.type)}
                >
                  <LucideSvgIcon node={XIcon} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {activeType === 'BuildingElementOpaque' && (
        <SecondaryGroupPills
          ariaLabel="External surface types"
          groups={opaqueSurfaceModeGroups}
          activeKey={activeOpaqueSurfaceMode}
          onSelect={setActiveOpaqueSurfaceModeDraft}
        />
      )}
      {activeType === 'BuildingElementTransparent' && (
        <SecondaryGroupPills
          ariaLabel="Window / rooflight types"
          groups={windowSurfaceModeGroups}
          activeKey={activeWindowSurfaceMode}
          onSelect={setActiveWindowSurfaceModeDraft}
        />
      )}
      {activeType === 'WindowShading' && (
        <SecondaryGroupPills
          ariaLabel="Window shading types"
          groups={windowShadingTypeGroups}
          activeKey={activeWindowShadingType}
          onSelect={setActiveWindowShadingTypeDraft}
        />
      )}
      {activeType === 'WetEmitter' && (
        <>
          <SecondaryGroupPills
            ariaLabel="Emitter subcategories"
            groups={emitterSubcategoryGroups}
            activeKey={activeEmitterSubcategory}
            onSelect={setActiveEmitterSubcategoryDraft}
          />
          {activeEmitterSubcategory === 'radiator' && (
            <SecondaryGroupPills
            ariaLabel="Radiator sizing input modes"
            groups={radiatorThermalModeGroups}
            activeKey={activeRadiatorThermalMode}
            onSelect={setActiveRadiatorThermalModeDraft}
            caption="Sizing"
          />
          )}
        </>
      )}
      {activeType !== 'BuildingElementOpaque' && hasFabricElements && (
        <SecondaryGroupPills
          ariaLabel="Fabric construction groups"
          groups={constructionScopeGroups}
          activeKey={activeConstructionScope}
          onSelect={setActiveConstructionScopeDraft}
        />
      )}

      {/* Scrollable content: floor + inputs (reuse details-panel form scroller) */}
      <div className="element-form details-form-scroll multi-select-panel__body">
        <div className="multi-select-field-group multi-select-floor-row batch-row multi-select-row">
          <Tooltip
            content="Assigns the selected elements to a project floor/storey. Elements controlled by a parent use the parent floor."
            position="right"
            maxWidth={350}
          >
            <div className="multi-select-row__label">Floor:</div>
          </Tooltip>
          <div className="multi-select-row__control">
            <StandardDropdown
              value={currentFloorValue}
              onChange={handleFloorChange}
              options={floorDropdownOptions}
              placeholder="Floor"
              variant="ghost"
              size="md"
              disabled={floorSelectionDisabled}
            />
          </div>
        </div>

        {selectionKinds.has('BuildingElementOpaque') && (
          <div className="multi-select-field-group">
            {renderSelectRow(
              'External Door',
              opaqueExternalDoorSummary,
              activeOpaqueSurfaceIds.length > 0,
              BOOLEAN_SELECT_OPTIONS,
              (value) => applyElementPatches((el) =>
                isOpaque(el) ? { is_external_door: value === 'true' } as Partial<Element> : null,
                activeOpaqueSurfaceIds,
              ),
            )}
            {activeOpaqueVariablePitchIds.length > 0 && renderElementNumberRow(
              'pitch',
              'Pitch (degrees)',
              opaquePitchSummary,
              activeOpaqueVariablePitchIds.length > 0,
              'e.g. 90',
              (el, value) => (isOpaque(el) && isVariablePitchWallLike(el) ? { pitch: value } as Partial<Element> : null),
              undefined,
              LIVE_NUMBER_BOUNDS.pitch,
              activeOpaqueVariablePitchIds,
            )}
            {activeOpaqueSurfaceFacingIds.length > 0 && renderSurfaceFacingRow(
              opaqueSurfaceFacingSummary,
              activeOpaqueSurfaceFacingIds,
            )}
            {activeOpaqueSurfaceMode === 'sloped' && (
              renderSelectRow(
                'Unheated Pitched Roof',
                opaqueUnheatedRoofSummary,
                activeOpaqueSurfaceIds.length > 0,
                BOOLEAN_SELECT_OPTIONS,
                (value) => applyElementPatches((el) =>
                  isOpaque(el) ? { is_unheated_pitched_roof: value === 'true' } as Partial<Element> : null,
                  activeOpaqueSurfaceIds,
                ),
              )
            )}
            {renderSelectRow(
              'Colour',
              opaqueColourSummary,
              activeOpaqueSurfaceIds.length > 0,
              COLOUR_OPTIONS,
              (value) => applyExtraJsonChoice((el) => (isOpaque(el) ? { colour: value } : null), undefined, activeOpaqueSurfaceIds),
            )}
          </div>
        )}

        {nonOpaqueWallDimensionIds.length > 0 && (
          <div className="multi-select-field-group">
            {nonOpaqueVariablePitchIds.length > 0 && renderElementNumberRow(
              'pitch',
              'Pitch (degrees)',
              wallPitchSummary,
              nonOpaqueVariablePitchIds.length > 0,
              'e.g. 90',
              (el, value) => (isWallLike(el) && !isOpaque(el) && isVariablePitchWallLike(el) ? { pitch: value } as Partial<Element> : null),
              undefined,
              LIVE_NUMBER_BOUNDS.pitch,
              nonOpaqueVariablePitchIds,
            )}
            {nonOpaqueSurfaceFacingIds.length > 0 && renderSurfaceFacingRow(
              wallSurfaceFacingSummary,
              nonOpaqueSurfaceFacingIds,
            )}
          </div>
        )}

        {selectionKinds.has('BuildingElementAdjacentUnconditionedSpace_Simple') && (
          <div className="multi-select-field-group">
            {renderExtraJsonNumberRow(
              'thermalResistanceUnconditionedSpace',
              'Unconditioned Space Resistance',
              unconditionedResistanceSummary,
              wallDimensionIds.length > 0,
              'e.g. 1.50',
              (el, value) => (isAdjacentUnconditioned(el) ? { thermal_resistance_unconditioned_space: value } : null),
              undefined,
              LIVE_NUMBER_BOUNDS.thermalResistanceUnconditionedSpace,
              wallDimensionIds,
            )}
          </div>
        )}

        {selectionKinds.has('BuildingElementPartyWall') && (
          <div className="multi-select-field-group">
            {renderSelectRow(
              'Party Wall Cavity Type',
              partyWallCavityTypeSummary,
              wallDimensionIds.length > 0,
              PARTY_WALL_CAVITY_OPTIONS,
              (value) => applyElementPatches((el) => {
                if (!isPartyWall(el)) return null;
                const nextExtra: Record<string, unknown> = {
                  ...extraJsonRecord(el),
                  party_wall_cavity_type: value,
                };
                if (!PARTY_WALL_LINING_REQUIRED_CAVITY_TYPES.has(value)) {
                  delete nextExtra.party_wall_lining_type;
                }
                if (value !== 'defined_resistance') {
                  delete nextExtra.thermal_resistance_cavity;
                }
                return { extra_json: nextExtra } as Partial<Element>;
              }, wallDimensionIds),
              undefined,
              wallDimensionIds,
            )}
            {renderSelectRow(
              'Party Wall Lining Type',
              partyWallLiningTypeSummary,
              wallDimensionIds.length > 0,
              PARTY_WALL_LINING_OPTIONS,
              (value) => applyExtraJsonChoice((el) => (isPartyWall(el) ? { party_wall_lining_type: value } : null), undefined, wallDimensionIds),
              undefined,
              wallDimensionIds,
            )}
            {renderExtraJsonNumberRow(
              'partyWallCavityResistance',
              'Cavity Resistance (m²K/W)',
              partyWallCavityResistanceSummary,
              wallDimensionIds.length > 0,
              'e.g. 0.18',
              (el, value) => (isPartyWall(el) ? { thermal_resistance_cavity: value } : null),
              undefined,
              LIVE_NUMBER_BOUNDS.partyWallCavityResistance,
              wallDimensionIds,
            )}
          </div>
        )}

        {hasWallLikeElements && (
        <div className="multi-select-field-group">
          <div className="batch-row multi-select-row">
          {renderTooltipRowLabel('wallHeight', 'Height (m)', wallDimensionIds.length > 0, undefined, wallDimensionIds)}
          <div className="multi-select-row__control">
            <StandardInput
              type="text"
              inputMode="decimal"
              unit={rowFieldUnit('wallHeight', 'Height (m)', wallDimensionIds)}
              step="0.01"
              variant="ghost"
              size="md"
              {...liveNumberInputProps(
                'wallHeight',
                wallHeightSummary,
                wallDimensionIds.length > 0,
                'e.g. 2.40',
                (el, value) => (isWallLike(el) ? { height: value } : null),
                undefined,
                wallDimensionIds,
              )}
            />
            <SummaryCaption summary={wallHeightSummary} />
          </div>
        </div>

        <div className="batch-row multi-select-row">
          {renderTooltipRowLabel('wallBaseHeight', 'Base Height (m)', wallDimensionIds.length > 0, undefined, wallDimensionIds)}
          <div className="multi-select-row__control">
            <StandardInput
              type="text"
              inputMode="decimal"
              unit={rowFieldUnit('wallBaseHeight', 'Base Height (m)', wallDimensionIds)}
              step="0.01"
              variant="ghost"
              size="md"
              {...liveNumberInputProps(
                'wallBaseHeight',
                wallBaseHeightSummary,
                wallDimensionIds.length > 0,
                'e.g. 0 — bottom edge above ground',
                (el, value) => {
                  if (!isWallLike(el)) return null;
                  const patch: Record<string, number> = {};
                  patch[el.type === 'BuildingElementOpaque' ? 'base_height' : '_base_height'] = value;
                  return patch;
                },
                undefined,
                wallDimensionIds,
              )}
            />
            <SummaryCaption summary={wallBaseHeightSummary} />
          </div>
        </div>
        </div>
        )}

        {hasWindows && (
        <div className="multi-select-field-group">
        {activeWindowVariablePitchIds.length > 0 && renderElementNumberRow(
          'pitch',
          'Pitch (degrees)',
          windowPitchSummary,
          activeWindowVariablePitchIds.length > 0,
          'e.g. 90',
          (el, value) => (isTransparent(el) && isVariablePitchTransparent(el) ? { pitch: value } as Partial<Element> : null),
          undefined,
          LIVE_NUMBER_BOUNDS.pitch,
          activeWindowVariablePitchIds,
        )}
        {activeWindowSurfaceFacingIds.length > 0 && renderSurfaceFacingRow(
          windowSurfaceFacingSummary,
          activeWindowSurfaceFacingIds,
          isHorizontalPolygonTransparent,
        )}
        {activeWindowSurfaceMode !== 'flat' && (
          <div className="batch-row multi-select-row">
            {renderTooltipRowLabel('winHeight', 'Height (m)', activeWindowSurfaceIds.length > 0, undefined, activeWindowSurfaceIds)}
            <div className="multi-select-row__control">
              <StandardInput
                type="text"
                inputMode="decimal"
                unit={rowFieldUnit('winHeight', 'Height (m)', activeWindowSurfaceIds)}
                step="0.01"
                variant="ghost"
                size="md"
                {...liveNumberInputProps(
                  'winHeight',
                  windowHeightSummary,
                  activeWindowSurfaceIds.length > 0,
                  'e.g. 1.20',
                  (el, value) => buildTransparentLivePatch(el, { height: value }),
                  undefined,
                  activeWindowSurfaceIds,
                )}
              />
              <SummaryCaption summary={windowHeightSummary} />
            </div>
          </div>
        )}
        <div className="batch-row multi-select-row">
          {renderTooltipRowLabel('winBaseHeight', 'Base Height (m)', activeWindowSurfaceIds.length > 0, undefined, activeWindowSurfaceIds)}
          <div className="multi-select-row__control">
            <StandardInput
              type="text"
              inputMode="decimal"
              unit={rowFieldUnit('winBaseHeight', 'Base Height (m)', activeWindowSurfaceIds)}
              step="0.01"
              variant="ghost"
              size="md"
              {...liveNumberInputProps(
                'windowBaseHeight',
                windowBaseHeightSummary,
                activeWindowSurfaceIds.length > 0,
                'e.g. 0.90 — sill above ground',
                (el, value) => buildTransparentLivePatch(el, { base_height: value }),
                undefined,
                activeWindowSurfaceIds,
              )}
            />
            <SummaryCaption summary={windowBaseHeightSummary} />
          </div>
        </div>
        {activeWindowSurfaceMode !== 'flat' && (
          <div className="batch-row multi-select-row">
            {renderTooltipRowLabel('winWidth', 'Width (m)', activeWindowSurfaceIds.length > 0, undefined, activeWindowSurfaceIds)}
            <div className="multi-select-row__control">
              <StandardInput
                type="text"
                inputMode="decimal"
                unit={rowFieldUnit('winWidth', 'Width (m)', activeWindowSurfaceIds)}
                step="0.01"
                variant="ghost"
                size="md"
                {...liveNumberInputProps(
                  'winWidth',
                  windowWidthSummary,
                  activeWindowSurfaceIds.length > 0,
                  'e.g. 1.00',
                  (el, value) => buildTransparentLivePatch(el, { width: value }),
                  undefined,
                  activeWindowSurfaceIds,
                )}
              />
              <SummaryCaption summary={windowWidthSummary} />
            </div>
          </div>
        )}
        <div className="batch-row multi-select-row">
          {renderTooltipRowLabel('freeAreaHeight', 'Free Area Height (m)', activeWindowSurfaceIds.length > 0, undefined, activeWindowSurfaceIds)}
          <div className="multi-select-row__control">
            <StandardInput
              type="text"
              inputMode="decimal"
              unit={rowFieldUnit('freeAreaHeight', 'Free Area Height (m)', activeWindowSurfaceIds)}
              step="0.01"
              variant="ghost"
              size="md"
              {...liveNumberInputProps(
                'freeAreaHeight',
                freeAreaHeightSummary,
                activeWindowSurfaceIds.length > 0,
                'e.g. 0.40',
                (el, value) => buildTransparentLivePatch(el, { free_area_height: value }),
                undefined,
                activeWindowSurfaceIds,
              )}
            />
            <SummaryCaption summary={freeAreaHeightSummary} />
          </div>
        </div>
        <div className="batch-row multi-select-row">
          {renderTooltipRowLabel('midHeight', 'Mid Height (m)', activeWindowSurfaceIds.length > 0, undefined, activeWindowSurfaceIds)}
          <div className="multi-select-row__control">
            <StandardInput
              type="text"
              inputMode="decimal"
              unit={rowFieldUnit('midHeight', 'Mid Height (m)', activeWindowSurfaceIds)}
              step="0.01"
              variant="ghost"
              size="md"
              {...liveNumberInputProps(
                'midHeight',
                midHeightSummary,
                activeWindowSurfaceIds.length > 0,
                'e.g. 1.20',
                (el, value) => buildTransparentLivePatch(el, { mid_height: value }),
                undefined,
                activeWindowSurfaceIds,
              )}
            />
            <SummaryCaption summary={midHeightSummary} />
          </div>
        </div>
        <div className="batch-row multi-select-row">
          {renderTooltipRowLabel('maxOpenArea', 'Max Window Open Area (m²)', activeWindowSurfaceIds.length > 0, undefined, activeWindowSurfaceIds)}
          <div className="multi-select-row__control">
            <StandardInput
              type="text"
              inputMode="decimal"
              unit={rowFieldUnit('maxOpenArea', 'Max Window Open Area (m²)', activeWindowSurfaceIds)}
              step="0.01"
              variant="ghost"
              size="md"
              {...liveNumberInputProps(
                'maxOpenArea',
                maxOpenAreaSummary,
                activeWindowSurfaceIds.length > 0,
                'e.g. 0.50',
                (el, value) => buildTransparentLivePatch(el, { max_window_open_area: value }),
                undefined,
                activeWindowSurfaceIds,
              )}
            />
            <SummaryCaption summary={maxOpenAreaSummary} />
          </div>
        </div>
        <div className="batch-row multi-select-row">
          {renderTooltipRowLabel('frameAreaFraction', 'Frame Area Fraction', activeWindowSurfaceIds.length > 0, undefined, activeWindowSurfaceIds)}
          <div className="multi-select-row__control">
            <StandardInput
              type="text"
              inputMode="decimal"
              unit={rowFieldUnit('frameAreaFraction', 'Frame Area Fraction', activeWindowSurfaceIds)}
              step="0.01"
              variant="ghost"
              size="md"
              {...liveNumberInputProps(
                'frameAreaFraction',
                frameAreaFractionSummary,
                activeWindowSurfaceIds.length > 0,
                'e.g. 0.25',
                (el, value) => (el.type === 'BuildingElementTransparent' ? { frame_area_fraction: value } : null),
                undefined,
                activeWindowSurfaceIds,
              )}
            />
            <SummaryCaption summary={frameAreaFractionSummary} />
          </div>
        </div>
        {renderExtraJsonSelectRow(
          'securityRisk',
          'Security Risk',
          windowSecurityRiskSummary,
          activeWindowSurfaceIds.length > 0,
          BOOLEAN_SELECT_OPTIONS,
          (value) =>
            applyExtraJsonChoice((el) =>
              isTransparent(el) ? { security_risk: value === 'true' } : null,
              undefined,
              activeWindowSurfaceIds,
            ),
          undefined,
          activeWindowSurfaceIds,
        )}

        {activeWindowSurfaceElements.length > 0 && (
          <div className="multi-select-window-copy">
            <div className="element-label multi-select-field-subtitle">Window Details</div>
            {activeWindowSurfaceElements.map((windowElement) => {
              const targetCount = activeWindowSurfaceElements.length - 1;
              const targetLabel = formatOtherWindowCount(targetCount);
              const windowLabel = elementRowLabel(windowElement);
              const attachedShading = attachedWindowShadingByWindowId.get(windowElement.id) ?? [];
              return (
                <div key={windowElement.id} className="multi-select-window-copy__item">
                  <div className="multi-select-window-copy__summary">
                    <span className="multi-select-window-copy__name">{windowLabel}</span>
                    <span className="multi-select-window-copy__meta">{windowPartCountSummary(windowElement)}</span>
                  </div>
                  <div className="multi-select-window-copy__fields">
                    {WINDOW_DETAIL_VISIBLE_KEYS.map((key) => {
                      const label = WINDOW_DETAIL_COPY_LABELS[key];
                      const summary = windowDetailSummary(windowElement, key, attachedShading);
                      const copyDisabled = targetCount === 0;
                      const copyTitle = `Copy ${label} from ${windowLabel} to ${targetLabel}`;
                      return (
                        <div key={key} className="multi-select-window-copy__field">
                          <button
                            type="button"
                            className="multi-select-window-copy__chip"
                            aria-label={`Edit ${label} for ${windowLabel}: ${summary}`}
                            title={`Edit ${label} for ${windowLabel}`}
                            onClick={() => handleEditWindowDetails(windowElement.id, key)}
                          >
                            <span className="multi-select-window-copy__chip-label">{label}</span>
                            <span className="multi-select-window-copy__chip-value">{summary}</span>
                            <LucideSvgIcon node={Pencil} size={11} />
                          </button>
                          <button
                            type="button"
                            className="multi-select-window-copy__copy"
                            aria-label={`Copy ${label} from ${windowLabel} to ${targetLabel}`}
                            title={copyTitle}
                            disabled={copyDisabled}
                            onClick={() => handleCopyWindowDetails(windowElement.id, key)}
                          >
                            <LucideSvgIcon node={Copy} size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        </div>
        )}

        {selectionKinds.has('WindowShading') && (
          <div className="multi-select-field-group">
            {renderSelectRow(
              'Linked Window',
              windowShadingParentSummary,
              activeWindowShadingIds.length > 0,
              windowShadingParentOptions,
              (value) => applyElementPatches((el) => {
                if (!isWindowShading(el)) return null;
                const parentName = value || null;
                return {
                  parent_element: parentName,
                  ...windowShadingProjectionPatch(el, parentName, el.shading_type, allElements),
                } as Partial<Element>;
              }, activeWindowShadingIds),
            )}
            {renderSelectRow(
              'Shading Type',
              windowShadingTypeSummary,
              activeWindowShadingIds.length > 0,
              WINDOW_SHADING_TYPE_OPTIONS,
              (value) => applyElementPatches((el) => {
                if (!isWindowShading(el)) return null;
                if (value === 'object') {
                  return {
                    shading_type: 'object',
                    depth: undefined,
                  } as Partial<Element>;
                }
                const nextShadingType = value as WindowShading['shading_type'];
                return {
                  shading_type: nextShadingType,
                  height: undefined,
                  transparency: undefined,
                  ...windowShadingProjectionPatch(el, el.parent_element, nextShadingType, allElements),
                } as Partial<Element>;
              }, activeWindowShadingIds),
            )}
            {renderElementNumberRow(
              'windowShadingDistance',
              'Distance (m)',
              windowShadingDistanceSummary,
              activeWindowShadingIds.length > 0,
              'e.g. 0.50',
              (el, value) => (isWindowShading(el) ? { distance: value } as Partial<Element> : null),
              undefined,
              LIVE_NUMBER_BOUNDS.windowShadingDistance,
              activeWindowShadingIds,
            )}
            {activeWindowShadingType === 'object' ? (
              <>
                {renderElementNumberRow(
                  'windowShadingHeight',
                  'Height (m)',
                  windowShadingHeightSummary,
                  activeWindowShadingIds.length > 0,
                  'e.g. 1.50',
                  (el, value) => (isWindowShading(el) ? { height: value } as Partial<Element> : null),
                  undefined,
                  LIVE_NUMBER_BOUNDS.windowShadingHeight,
                  activeWindowShadingIds,
                )}
                {renderElementNumberRow(
                  'windowShadingTransparency',
                  'Transparency',
                  windowShadingTransparencySummary,
                  activeWindowShadingIds.length > 0,
                  'e.g. 0.25',
                  (el, value) => (isWindowShading(el) ? { transparency: value } as Partial<Element> : null),
                  undefined,
                  LIVE_NUMBER_BOUNDS.windowShadingTransparency,
                  activeWindowShadingIds,
                )}
              </>
            ) : (
              renderElementNumberRow(
                'windowShadingDepth',
                'Depth (m)',
                windowShadingDepthSummary,
                activeWindowShadingIds.length > 0,
                'e.g. 0.30',
                (el, value) => (isWindowShading(el) ? { depth: value } as Partial<Element> : null),
                undefined,
                LIVE_NUMBER_BOUNDS.windowShadingDepth,
                activeWindowShadingIds,
              )
            )}
          </div>
        )}

        {selectionKinds.has('BuildingElementGround') && (
          <div className="multi-select-field-group">
            {renderSelectRow(
              'Floor Type',
              groundFloorTypeSummary,
              true,
              FLOOR_TYPE_OPTIONS,
              (value) => applyElementPatches((el) =>
                isGround(el)
                  ? {
                      floor_type: value as BuildingElementGround['floor_type'],
                      ...(!groundFloorTypeSupportsViewerElevation(value) ? { _base_height: undefined } : {}),
                    } as Partial<Element>
                  : null,
              ),
            )}
            {allActiveGroundsAreBasement && (
              renderNumberRow(
                'depthBasementFloor',
                'Basement Floor Depth (m)',
                groundDepthBasementSummary,
                true,
                'e.g. 2.50',
                (el, value) => (isGround(el) && isBasementGroundFloorType(el.floor_type) ? { depth_basement_floor: value } : null),
                undefined,
                LIVE_NUMBER_BOUNDS.depthBasementFloor,
              )
            )}
            {renderNumberRow(
              'thicknessWalls',
              'Wall Thickness (m)',
              groundThicknessWallsSummary,
              true,
              'e.g. 0.30',
              (el, value) => (isGround(el) ? { thickness_walls: value } : null),
              undefined,
              LIVE_NUMBER_BOUNDS.thicknessWalls,
            )}
            {renderExtraJsonNumberRow(
              'psiWallFloorJunc',
              'Wall-Floor Junction Psi',
              groundPsiWallFloorSummary,
              true,
              'e.g. 0.16',
              (el, value) => (isGround(el) ? { psi_wall_floor_junc: value } : null),
              undefined,
              LIVE_NUMBER_BOUNDS.psiWallFloorJunc,
            )}
          </div>
        )}

        {(selectionKinds.has('ThermalBridgeLinear') || selectionKinds.has('ThermalBridgePoint')) && (
          <div className="multi-select-field-group">
            {selectionKinds.has('ThermalBridgeLinear') && (
              <>
                {renderNumberRow(
                  'thermalBridgeLength',
                  'Length (m)',
                  thermalBridgeLengthSummary,
                  true,
                  'e.g. 3.00',
                  (el, value) => (isThermalBridgeLinear(el) ? { length: value } : null),
                  undefined,
                  LIVE_NUMBER_BOUNDS.thermalBridgeLength,
                )}
                {renderNumberRow(
                  'linearThermalTransmittance',
                  'Linear Thermal Transmittance',
                  thermalBridgePsiSummary,
                  true,
                  'e.g. 0.05',
                  (el, value) => (isThermalBridgeLinear(el) ? { linear_thermal_transmittance: value } : null),
                  undefined,
                  LIVE_NUMBER_BOUNDS.linearThermalTransmittance,
                )}
                {renderSelectRow(
                  'Junction Type',
                  thermalBridgeJunctionTypeSummary,
                  true,
                  JUNCTION_TYPE_OPTIONS,
                  (value) => applyExtraJsonChoice((el) => (isThermalBridgeLinear(el) ? { junction_type: value } : null)),
                )}
              </>
            )}
            {selectionKinds.has('ThermalBridgePoint') && renderNumberRow(
              'heatTransferCoeff',
              'Heat Transfer Coefficient',
              thermalBridgePointHtcSummary,
              true,
              'e.g. 5.00',
              (el, value) => (isThermalBridgePoint(el) ? { heat_transfer_coeff: value } : null),
              undefined,
              LIVE_NUMBER_BOUNDS.heatTransferCoeff,
            )}
          </div>
        )}

        {selectionKinds.has('MechanicalVentilationDuctwork') && (
          <div className="multi-select-field-group">
            {renderSelectRow(
              'MVHR Unit',
              ductParentSummary,
              true,
              ductParentOptions,
              (value) => applyElementPatches((el) =>
                isDuctwork(el) ? { parent_element: value || null } as Partial<Element> : null,
              ),
            )}
            {renderSelectRow(
              'Duct Type',
              ductTypeSummary,
              true,
              DUCT_TYPES.map((value) => ({ value, label: value })),
              (value) => applyElementPatches((el) =>
                isDuctwork(el) ? { duct_type: value as DuctType } as Partial<Element> : null,
              ),
            )}
            {renderSelectRow(
              'Cross Section',
              ductCrossSectionSummary,
              true,
              CROSS_SECTION_OPTIONS,
              (value) => applyExtraJsonChoice((el) => (isDuctwork(el) ? { cross_section_shape: value } : null)),
            )}
            {renderExtraJsonNumberRow('ductInternalDiameter', 'Internal Diameter (mm)', ductInternalDiameterSummary, true, 'e.g. 125', (el, value) => isDuctwork(el) ? { internal_diameter_mm: value } : null, undefined, LIVE_NUMBER_BOUNDS.ductDiameter)}
            {renderExtraJsonNumberRow('ductExternalDiameter', 'External Diameter (mm)', ductExternalDiameterSummary, true, 'e.g. 150', (el, value) => isDuctwork(el) ? { external_diameter_mm: value } : null, undefined, LIVE_NUMBER_BOUNDS.ductDiameter)}
            {renderExtraJsonNumberRow('ductInsulationConductivity', 'Insulation Conductivity', ductInsulationConductivitySummary, true, 'e.g. 0.04', (el, value) => isDuctwork(el) ? { insulation_thermal_conductivity: value } : null, undefined, LIVE_NUMBER_BOUNDS.ductInsulationConductivity)}
            {renderExtraJsonNumberRow('ductInsulationThickness', 'Insulation Thickness (mm)', ductInsulationThicknessSummary, true, 'e.g. 25', (el, value) => isDuctwork(el) ? { insulation_thickness_mm: value } : null, undefined, LIVE_NUMBER_BOUNDS.ductInsulationThickness)}
            {renderSelectRow(
              'Reflective',
              ductReflectiveSummary,
              true,
              BOOLEAN_SELECT_OPTIONS,
              (value) => applyExtraJsonChoice((el) => (isDuctwork(el) ? { reflective: value === 'true' } : null)),
            )}
          </div>
        )}

        {selectionKinds.has('WaterPipework') && (
          <div className="multi-select-field-group">
            {renderSelectRow(
              'Location',
              pipeLocationSummary,
              true,
              [
                { value: 'internal', label: 'Internal' },
                { value: 'external', label: 'External' },
              ],
              (value) => applyElementPatches((el) =>
                isWaterPipework(el) ? { location: value as WaterPipework['location'] } as Partial<Element> : null,
              ),
              'Primary pipework fields are used by FHS.',
            )}
            {renderExtraJsonNumberRow('pipeInternalDiameter', 'Internal Diameter (mm)', pipeInternalDiameterSummary, true, 'e.g. 15', (el, value) => isWaterPipework(el) ? { internal_diameter_mm: value } : null, undefined, LIVE_NUMBER_BOUNDS.pipeDiameter)}
            {renderExtraJsonNumberRow('pipeExternalDiameter', 'External Diameter (mm)', pipeExternalDiameterSummary, true, 'e.g. 22', (el, value) => isWaterPipework(el) ? { external_diameter_mm: value } : null, undefined, LIVE_NUMBER_BOUNDS.pipeDiameter)}
            {renderExtraJsonNumberRow('pipeInsulationConductivity', 'Insulation Conductivity', pipeInsulationConductivitySummary, true, 'e.g. 0.04', (el, value) => isWaterPipework(el) ? { insulation_thermal_conductivity: value } : null, undefined, LIVE_NUMBER_BOUNDS.pipeInsulationConductivity)}
            {renderExtraJsonNumberRow('pipeInsulationThickness', 'Insulation Thickness (mm)', pipeInsulationThicknessSummary, true, 'e.g. 10', (el, value) => isWaterPipework(el) ? { insulation_thickness_mm: value } : null, undefined, LIVE_NUMBER_BOUNDS.pipeInsulationThickness)}
            {renderSelectRow(
              'Surface Reflectivity',
              pipeReflectivitySummary,
              true,
              BOOLEAN_SELECT_OPTIONS,
              (value) => applyExtraJsonChoice((el) => (isWaterPipework(el) ? { surface_reflectivity: value === 'true' } : null)),
            )}
            {renderSelectRow(
              'Pipe Contents',
              pipeContentsSummary,
              true,
              PIPE_CONTENT_OPTIONS,
              (value) => applyExtraJsonChoice((el) => (isWaterPipework(el) ? { pipe_contents: value } : null)),
            )}
          </div>
        )}

        {selectionKinds.has('Vents') && (
          <div className="multi-select-field-group">
            {renderSelectRow(
              'Parent Element',
              ventParentSummary,
              true,
              ventParentOptions,
              (value) => applyElementPatches((el) => (isVent(el) ? { parent_element: value || null } as Partial<Element> : null)),
            )}
            {renderNumberRow('ventMidHeight', 'Mid Height Air Flow Path (m)', ventMidHeightSummary, true, 'e.g. 1.50', (el, value) => isVent(el) ? { mid_height_air_flow_path: value } : null, undefined, LIVE_NUMBER_BOUNDS.ventMidHeight)}
            {renderNumberRow('ventAreaCm2', 'Area (cm²)', ventAreaSummary, true, 'e.g. 4000', (el, value) => isVent(el) ? { area_cm2: value } : null, undefined, LIVE_NUMBER_BOUNDS.ventAreaCm2)}
          </div>
        )}

        {selectionKinds.has('WetEmitter') && (
          <div className="multi-select-field-group">
            {renderSelectRow(
              'Subcategory',
              emitterSubcategorySummary,
              activeEmitterIds.length > 0,
              WET_EMITTER_SUBCATEGORY_OPTIONS,
              (value) => applyElementPatches((el) =>
                isWetEmitter(el) ? buildWetEmitterSubcategoryPatch(el, value as WetEmitter['subcategory']) : null,
                activeEmitterIds,
              ),
            )}
            {renderSelectRow(
              'Space Heat System',
              emitterSystemSummary,
              activeEmitterIds.length > 0,
              spaceHeatSystemOptions,
              (value) => applyElementPatches((el) =>
                isWetEmitter(el) ? { space_heat_system: value || undefined } as Partial<Element> : null,
                activeEmitterIds,
              ),
            )}
            {renderExtraJsonNumberRow(
              `emitterFracConvective:${activeEmitterSubcategory ?? 'none'}`,
              'Frac Convective',
              emitterFracConvectiveSummary,
              activeEmitterIds.length > 0,
              'e.g. 0.4',
              (el, value) => (isWetEmitter(el) ? { frac_convective: value } : null),
              undefined,
              LIVE_NUMBER_BOUNDS.emitterFracConvective,
              activeEmitterIds,
            )}
            {activeEmitterSubcategory === 'ufh' && (
              <>
                {renderElementNumberRow(
                  `emitterArea:${activeEmitterSubcategory}`,
                  'Area (m²)',
                  emitterAreaSummary,
                  activeEmitterIds.length > 0,
                  'e.g. 12',
                  (el, value) => isWetEmitter(el) ? { area: value } as Partial<Element> : null,
                  undefined,
                  LIVE_NUMBER_BOUNDS.emitterArea,
                  activeEmitterIds,
                )}
                {renderExtraJsonNumberRow(
                  `emitterEquivalentSpecificThermalMass:${activeEmitterSubcategory}`,
                  'Equivalent Specific Thermal Mass',
                  emitterEquivalentSpecificThermalMassSummary,
                  activeEmitterIds.length > 0,
                  'e.g. 80',
                  (el, value) => (isWetEmitter(el) ? { equivalent_specific_thermal_mass: value } : null),
                  undefined,
                  LIVE_NUMBER_BOUNDS.emitterEquivalentSpecificThermalMass,
                  activeEmitterIds,
                )}
                {renderExtraJsonNumberRow(
                  `emitterSystemPerformanceFactor:${activeEmitterSubcategory}`,
                  'System Performance Factor',
                  emitterSystemPerformanceFactorSummary,
                  activeEmitterIds.length > 0,
                  'e.g. 5',
                  (el, value) => (isWetEmitter(el) ? { system_performance_factor: value } : null),
                  undefined,
                  LIVE_NUMBER_BOUNDS.emitterSystemPerformanceFactor,
                  activeEmitterIds,
                )}
              </>
            )}
            {(activeEmitterSubcategory === 'radiator' || activeEmitterSubcategory === 'fancoil') && renderElementNumberRow(
              `emitterUnitNumber:${activeEmitterSubcategory}`,
              'Unit Number',
              emitterUnitNumberSummary,
              activeEmitterIds.length > 0,
              'e.g. 1',
              (el, value) => isWetEmitter(el) ? { unit_number: Math.round(value) } as Partial<Element> : null,
              undefined,
              LIVE_NUMBER_BOUNDS.emitterUnitNumber,
              activeEmitterIds,
            )}
            {activeEmitterSubcategory === 'radiator' && (
              <>
                {renderSelectRow(
                  'Sizing Input',
                  radiatorThermalModeSummary,
                  activeRadiatorModeIds.length > 0,
                  RADIATOR_THERMAL_MODE_OPTIONS,
                  (value) => applyElementPatches((el) => {
                    if (!isWetEmitter(el)) return null;
                    return {
                      extra_json: pruneRadiatorEmitterExtraJson(
                        extraJsonRecord(el),
                        value as RadiatorThermalMode,
                      ),
                    } as Partial<Element>;
                  }, activeRadiatorModeIds),
                )}
                {renderExtraJsonNumberRow(
                  `emitterN:${activeRadiatorThermalMode ?? 'none'}`,
                  'N',
                  radiatorNExponentSummary,
                  activeRadiatorModeIds.length > 0,
                  'e.g. 1.2',
                  (el, value) => (isWetEmitter(el) ? { n: value } : null),
                  undefined,
                  LIVE_NUMBER_BOUNDS.emitterN,
                  activeRadiatorModeIds,
                )}
                {activeRadiatorThermalMode === 'per_metre' ? (
                  <>
                    {renderExtraJsonNumberRow(
                      `emitterLength:${activeRadiatorThermalMode}`,
                      'Length (m)',
                      radiatorLengthSummary,
                      activeRadiatorModeIds.length > 0,
                      'e.g. 0.6',
                      (el, value) => (isWetEmitter(el) ? { length: value } : null),
                      undefined,
                      LIVE_NUMBER_BOUNDS.emitterLength,
                      activeRadiatorModeIds,
                    )}
                    {renderExtraJsonNumberRow(
                      `emitterCPerM:${activeRadiatorThermalMode}`,
                      'C per m',
                      radiatorCPerMSummary,
                      activeRadiatorModeIds.length > 0,
                      'e.g. 0.0112',
                      (el, value) => (isWetEmitter(el) ? { c_per_m: value } : null),
                      undefined,
                      LIVE_NUMBER_BOUNDS.emitterCPerM,
                      activeRadiatorModeIds,
                    )}
                    {renderExtraJsonNumberRow(
                      `emitterThermalMassPerM:${activeRadiatorThermalMode}`,
                      'Thermal mass per m',
                      radiatorThermalMassPerMSummary,
                      activeRadiatorModeIds.length > 0,
                      'e.g. 0.019',
                      (el, value) => (isWetEmitter(el) ? { thermal_mass_per_m: value } : null),
                      undefined,
                      LIVE_NUMBER_BOUNDS.emitterThermalMassPerM,
                      activeRadiatorModeIds,
                    )}
                  </>
                ) : (
                  <>
                    {renderExtraJsonNumberRow(
                      `emitterC:${activeRadiatorThermalMode ?? 'none'}`,
                      'C',
                      radiatorCSummary,
                      activeRadiatorModeIds.length > 0,
                      'e.g. 0.08',
                      (el, value) => (isWetEmitter(el) ? { c: value } : null),
                      undefined,
                      LIVE_NUMBER_BOUNDS.emitterC,
                      activeRadiatorModeIds,
                    )}
                    {renderExtraJsonNumberRow(
                      `emitterThermalMass:${activeRadiatorThermalMode ?? 'none'}`,
                      'Thermal mass',
                      radiatorThermalMassSummary,
                      activeRadiatorModeIds.length > 0,
                      'e.g. 0.5',
                      (el, value) => (isWetEmitter(el) ? { thermal_mass: value } : null),
                      undefined,
                      LIVE_NUMBER_BOUNDS.emitterThermalMass,
                      activeRadiatorModeIds,
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {selectionKinds.has('Lighting') && (
          <div className="multi-select-field-group">
            {renderElementNumberRow('lightingEfficacy', 'Efficacy', lightingEfficacySummary, true, 'e.g. 80', (el, value) => isLighting(el) ? buildLightingPatch(el, { efficacy: value }, { finiteFallback: true, markDetailed: true }) : null, undefined, LIVE_NUMBER_BOUNDS.lightingEfficacy)}
            {renderElementNumberRow('lightingCount', 'Count', lightingCountSummary, true, 'e.g. 4', (el, value) => isLighting(el) ? buildLightingPatch(el, { count: Math.round(value) }, { finiteFallback: true }) : null, undefined, LIVE_NUMBER_BOUNDS.lightingCount)}
            {renderElementNumberRow('lightingPower', 'Power (W)', lightingPowerSummary, true, 'e.g. 8', (el, value) => isLighting(el) ? buildLightingPatch(el, { power: value }, { finiteFallback: true, markDetailed: true }) : null, undefined, LIVE_NUMBER_BOUNDS.lightingPower)}
          </div>
        )}

        {hasFabricElements && (
          <div className="multi-select-field-group">
            <div className="batch-row multi-select-row">
              <div className="multi-select-row__label">Assembly</div>
              <div className="multi-select-row__control">
                <div className="multi-select-assembly-control">
                  <SearchableDescribedSelect
                    value={currentAssemblyId}
                    placeholder={assemblyLibrary ? 'Search assemblies…' : 'Loading assemblies…'}
                    searchPlaceholder="Search assemblies…"
                    disabled={!assemblyLibrary || assemblyOptions.length === 0}
                    minWidth="100%"
                    sections={[{ options: assemblyOptions }]}
                    triggerVariant="standard"
                    onChange={handleAssemblySelect}
                  />
                  <button
                    type="button"
                    className="btn editor-action-btn editor-action-btn--secondary element-editor-input-action"
                    disabled={!libraryModalRepresentative || !assemblyElementMode(libraryModalRepresentative)}
                    {...intentPrefetchHandlers(prefetchAssemblyCalculatorModal)}
                    onClick={() => {
                      prefetchAssemblyCalculatorModal();
                      setLibraryModalOpen(true);
                    }}
                    title="Open the assembly calculator to edit layers and save new assemblies to the library (uses the first selected fabric element for preview)."
                  >
                    Library
                  </button>
                </div>
                {assemblyLibraryError && (
                  <div className="multi-select-error">{assemblyLibraryError}</div>
                )}
              </div>
            </div>
            {renderManualNumberRow(
              constructionFieldScopeKey,
              constructionTargetIds,
              'u',
              'U Value',
              constructionUValueSummary,
              'Set U',
              (_el, value) => ({ u_value: value }),
              LIVE_NUMBER_BOUNDS.manualUValue,
            )}
            {renderManualNumberRow(
              constructionFieldScopeKey,
              constructionTargetIds,
              'r',
              'Thermal Resistance Construction',
              constructionResistanceSummary,
              'Set R',
              (el, value) => ({
                [isGround(el)
                  ? 'thermal_resistance_floor_construction'
                  : 'thermal_resistance_construction']: value,
              }),
              LIVE_NUMBER_BOUNDS.manualThermalResistanceConstruction,
            )}
            {renderManualSelectRow(
              constructionFieldScopeKey,
              constructionTargetIds,
              'mass',
              'Mass Distribution Class',
              constructionMassSummary,
              MASS_DISTRIBUTION_CLASS_ENUM.map((value) => ({ value, label: value })),
              (_el, value) => ({ mass_distribution_class: value }),
            )}
            {renderManualSelectRow(
              constructionFieldScopeKey,
              constructionTargetIds,
              'areal',
              'Areal Heat Capacity',
              constructionArealSummary,
              AREAL_HEAT_CAPACITY_ENUM.map((value) => ({ value, label: value })),
              (_el, value) => ({ areal_heat_capacity: value }),
            )}
          </div>
        )}

      </div>

      {/* Sticky footer: geometry operations row + actions row */}
      <div className="element-creator-sticky-footer multi-select-footer">
        {/* Geometry Operations Row */}
        {(hasLineWalls || hasFloors || canTransform) && (
          <div className="form-actions multi-select-geometry-row">
            <div className="multi-select-geometry-actions">
              {hasLineWalls && (
                <div className="multi-select-operation-group">
                  <button
                    type="button"
                    className="btn editor-action-btn editor-action-btn--secondary multi-select-geometry-action"
                    onClick={handleSnap}
                    disabled={!canSnap || parseFloat(snapTolerance) <= 0}
                    title={canSnap ? 'Snap selected line-wall endpoints to nearby intersections using this tolerance.' : 'Select 2+ line walls on the same floor'}
                  >
                    Snap Ends
                  </button>
                  <button
                    type="button"
                    className="btn editor-action-btn editor-action-btn--secondary multi-select-geometry-action"
                    onClick={handleTrim}
                    disabled={!canSnap || parseFloat(snapTolerance) <= 0}
                    title={canSnap ? 'Trim selected line walls at overlaps and extensions using this tolerance.' : 'Select 2+ line walls on the same floor'}
                  >
                    Trim Walls
                  </button>
                  <label className="multi-select-operation-label" htmlFor="multi-select-snap-tolerance">Tol.</label>
                  <StandardInput
                    id="multi-select-snap-tolerance"
                    aria-label="Snap and trim tolerance"
                    type="text"
                    inputMode="decimal"
                    value={snapTolerance}
                    onChange={(e) => setSnapTolerance(e.target.value)}
                    step="0.01"
                    variant="ghost"
                    size="sm"
                    placeholder="0.02"
                    min="0"
                    className="multi-select-tolerance-input--snap"
                  />
                  <span className="multi-select-operation-unit">m</span>
                </div>
              )}
              {hasFloors && (
                <div className="multi-select-operation-group">
                  <button
                    type="button"
                    className="btn editor-action-btn editor-action-btn--secondary multi-select-geometry-action"
                    onClick={handleMerge}
                    disabled={!canMerge}
                    title={canMerge ? 'Merge selected floor polygons into one' : 'Select 2+ floor polygons on the same floor'}
                  >
                    Merge Floors
                  </button>
                </div>
              )}
              {hasLineWalls && (
                <div className="multi-select-operation-group">
                  <button
                    type="button"
                    className="btn editor-action-btn editor-action-btn--secondary multi-select-geometry-action"
                    onClick={handleRightAlign}
                    disabled={parseFloat(angleTolerance) <= 0}
                    title="Straighten selected line walls close to 0°, 90°, 180°, or 270° using this tolerance."
                  >
                    Right Align
                  </button>
                  <label className="multi-select-operation-label" htmlFor="multi-select-align-tolerance">Tol.</label>
                  <StandardInput
                    id="multi-select-align-tolerance"
                    aria-label="Right align tolerance"
                    type="text"
                    inputMode="decimal"
                    value={angleTolerance}
                    onChange={(e) => setAngleTolerance(e.target.value)}
                    step="1"
                    variant="ghost"
                    size="sm"
                    placeholder="5"
                    min="0"
                    className="multi-select-tolerance-input--angle"
                  />
                  <span className="multi-select-operation-unit">°</span>
                </div>
              )}
              {canTransform && (
                <>
                  <div className="multi-select-operation-group">
                    <button
                      type="button"
                      className="btn editor-action-btn editor-action-btn--secondary multi-select-geometry-action"
                      onClick={handleMirror}
                    >
                      Mirror
                    </button>
                    <select
                      aria-label="Mirror direction"
                      className="multi-select-operation-select"
                      value={mirrorDirection}
                      onChange={(event) => setMirrorDirection(event.target.value as 'left-right' | 'top-bottom')}
                    >
                      <option value="left-right">Left/right</option>
                      <option value="top-bottom">Top/bottom</option>
                    </select>
                  </div>
                  <div className="multi-select-operation-group multi-select-operation-group--last">
                    <button
                      type="button"
                      className="btn editor-action-btn editor-action-btn--secondary multi-select-geometry-action"
                      onClick={handleRotate}
                      disabled={!Number.isFinite(parseFloat(rotateAngle)) || parseFloat(rotateAngle) <= 0}
                    >
                      Rotate
                    </button>
                    <select
                      aria-label="Rotate direction"
                      className="multi-select-operation-select"
                      value={rotateDirection}
                      onChange={(event) => setRotateDirection(event.target.value as 'clockwise' | 'counter-clockwise')}
                    >
                      <option value="clockwise">Clockwise</option>
                      <option value="counter-clockwise">Counter-clockwise</option>
                    </select>
                    <StandardInput
                      aria-label="Rotate angle"
                      type="text"
                      inputMode="decimal"
                      value={rotateAngle}
                      onChange={(event) => setRotateAngle(event.target.value)}
                      step="1"
                      variant="ghost"
                      size="sm"
                      placeholder="90"
                      min="0"
                      className="multi-select-rotate-angle"
                    />
                    <span className="multi-select-operation-unit">°</span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Actions Row */}
        <div className="form-actions multi-select-actions-row element-editor-actions-row element-editor-actions-row--two">
          <div className="element-editor-footer-group">
            <button
              className="btn editor-action-btn editor-action-btn--secondary"
              onClick={() => duplicateElements(selectedElementIds)}
            >
              Duplicate
            </button>
          </div>
          <div className="element-editor-footer-group element-editor-footer-group--danger">
            <button
              className="btn btn-standard btn-danger editor-action-btn editor-action-btn--danger"
              onClick={onDelete}
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {libraryModalOpen && libraryModalRepresentative && assemblyElementMode(libraryModalRepresentative) ? (
        <React.Suspense fallback={<LazyModalFallback label="Opening assembly calculator..." />}>
          <AssemblyCalculatorModal
            isOpen={libraryModalOpen}
            onClose={() => {
              setLibraryModalOpen(false);
              reloadAssemblyLibrary();
            }}
            elementMode={assemblyElementMode(libraryModalRepresentative)!}
            elementPitchDeg={assemblyPitchDegForElement(libraryModalRepresentative)}
            initialAssemblySnapshot={initialAssemblySnapshotFromElement(libraryModalRepresentative)}
            appliedEnvelope={parseVulcanAssemblyV1FromExtraJson(libraryModalRepresentative.extra_json)}
            complianceValidationEnabled={complianceValidationEnabled}
            groundFloorType={
              libraryModalRepresentative.type === 'BuildingElementGround'
                ? ((libraryModalRepresentative as { floor_type?: GroundFloorType }).floor_type ?? null)
                : null
            }
            workspaceResourcePort={workspaceResourcePort}
            externalDetailCataloguePort={externalDetailCatalogue}
            onApply={(patch) => {
              const el = libraryModalRepresentative;
              const prev =
                el.extra_json && typeof el.extra_json === 'object' && !Array.isArray(el.extra_json)
                  ? (el.extra_json as Record<string, unknown>)
                  : {};
              updateElement(el.id, { extra_json: { ...prev, ...patch } });
            }}
          />
        </React.Suspense>
      ) : null}
    </div>
  );
};
