// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ComplianceSettings, ParsedCsvMetadata } from '../geometry/io/parseCsvToGeometry';
import type { ContextShading, Element, Floor, Zone } from '../geometry/types';
import { roundToTwoDecimals } from '../geometry/constants';
import { calculatePolygonArea } from './polygonSync';
import {
  calculateContextShadingAngularRangeFromCoordinates,
  calculateContextShadingDistanceFromCoordinates,
} from './contextShadingGeometry';
import { deriveFloorsFromElements } from './floorDerivation';
import { elementBaseElevationMForTb, slabElevationMForFloorZ } from './geometry3dMapper';
import { fhsStoreyToCanvasFloor } from './storeySemantics';
import { isWalkableFloorHorizontalPolygon, withEffectiveStoreyHeights } from './zoneDerivation';

export const DEVELOPMENT_CONTEXT_SHADING_META_KEY = 'development_context_shading';

const SAME_FLOOR_TOLERANCE_M = 0.25;
const FOOTPRINT_OVERLAP_TOLERANCE_M2 = 0.01;

type Coord = { x: number; y: number; z: number };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export type DevelopmentContextVerticalRelation = 'same' | 'above' | 'below';
type DevelopmentContextShadingSourceKind = 'model_footprint' | 'explicit_context_shading';

export interface DevelopmentContextShadingModel {
  stem: string;
  elements: Element[];
  zones?: Zone[];
  floors?: Floor[];
  metadata?: ParsedCsvMetadata;
}

export interface DevelopmentModelVerticalContext {
  baseM: number;
  topM: number;
  heightM: number;
  heightKnown: boolean;
  source: 'element_base_height' | 'ventilation_zone_base_height' | 'storey_of_dwelling' | 'local_model';
}

export interface SyncDevelopmentContextShadingArgs {
  projectId: string;
  activeStem: string;
  elementsById: Record<string, Element>;
  elementIds: string[];
  zones: Zone[];
  floors: Floor[];
  complianceSettings?: ComplianceSettings;
  contextModels: DevelopmentContextShadingModel[];
  globalOrientationOffset?: number;
}

export interface SyncDevelopmentContextShadingResult {
  elementsById: Record<string, Element>;
  elementIds: string[];
  changed: boolean;
  generatedCount: number;
  skippedSameFloorOverlapCount: number;
  skippedUnknownHeightCount: number;
}

type FootprintCandidate = {
  element: Element;
  areaM2: number;
  baseM: number;
  bounds: Bounds;
};

type GeneratedMeta = {
  version: 1;
  projectId: string;
  activeStem: string;
  sourceStem: string;
  sourceKind?: 'model_footprint';
  sourceElementId: string;
  sourceKey: string;
  sourceFingerprint: string;
  generatedSignature: string;
  verticalRelation: DevelopmentContextVerticalRelation;
  sharedId?: string;
  sourceName?: string;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function roundCoord(coord: Coord): Coord {
  return {
    x: roundToTwoDecimals(coord.x),
    y: roundToTwoDecimals(coord.y),
    z: roundToTwoDecimals(coord.z),
  };
}

function roundPlanCoord(coord: Coord): { x: number; y: number } {
  return {
    x: roundToTwoDecimals(coord.x),
    y: roundToTwoDecimals(coord.y),
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
}

function simpleHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function generatedElementId(sourceKey: string): string {
  return `dev-context-shading-${simpleHash(sourceKey)}`;
}

function polygonBounds(coords: Coord[]): Bounds | null {
  if (coords.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const coord of coords) {
    minX = Math.min(minX, coord.x);
    minY = Math.min(minY, coord.y);
    maxX = Math.max(maxX, coord.x);
    maxY = Math.max(maxY, coord.y);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY };
}

function boundsOverlapArea(a: Bounds, b: Bounds): number {
  const width = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const height = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  return width * height;
}

function isContextGeneratedElement(element: Element): element is ContextShading {
  return element.type === 'ContextShading' && !!readGeneratedMeta(element);
}

export function isDevelopmentContextGeneratedShading(
  element: Element | null | undefined,
): boolean {
  return isDevelopmentContextModelFootprintShading(element);
}

export function getDevelopmentContextShadingSourceKind(
  meta: Pick<GeneratedMeta, 'sourceKind'> | null | undefined,
): DevelopmentContextShadingSourceKind {
  return meta?.sourceKind === 'model_footprint' ? 'model_footprint' : 'explicit_context_shading';
}

export function isDevelopmentContextModelFootprintShading(
  element: Element | null | undefined,
): boolean {
  if (!element || element.type !== 'ContextShading') return false;
  return getDevelopmentContextShadingSourceKind(readGeneratedMeta(element)) === 'model_footprint';
}

function isFootprintElement(element: Element): boolean {
  if (element.type === 'ContextShading') return false;
  return element.type === 'BuildingElementGround' || isWalkableFloorHorizontalPolygon(element);
}

function getFootprintCandidates(elements: Element[], floors: Floor[]): FootprintCandidate[] {
  const effectiveFloors = withEffectiveStoreyHeights(floors, elements) ?? [];
  return elements
    .filter(isFootprintElement)
    .map((element) => {
      const coords = element.coordinates ?? [];
      const bounds = polygonBounds(coords);
      const areaM2 = Math.abs(calculatePolygonArea(coords));
      if (!bounds || coords.length < 3 || areaM2 <= 0) return null;
      return {
        element,
        areaM2,
        baseM: elementBaseElevationMForTb(element, effectiveFloors),
        bounds,
      };
    })
    .filter((candidate): candidate is FootprintCandidate => Boolean(candidate));
}

function selectLowestOccupiedFootprint(elements: Element[], floors: Floor[]): FootprintCandidate | null {
  const candidates = getFootprintCandidates(elements, floors);
  candidates.sort((a, b) => {
    const baseDelta = a.baseM - b.baseM;
    if (Math.abs(baseDelta) > SAME_FLOOR_TOLERANCE_M) return baseDelta;
    return b.areaM2 - a.areaM2;
  });
  return candidates[0] ?? null;
}

function normalizePitch180(raw: unknown): number | null {
  const pitch = parseFiniteNumber(raw);
  if (pitch === null) return null;
  const normalized = ((pitch % 360) + 360) % 360;
  return normalized > 180 ? 360 - normalized : normalized;
}

function elementVerticalHeightM(element: Element): number {
  if (element.type === 'BuildingElementGround') return 0;
  const rawHeight = parseFiniteNumber((element as { height?: unknown }).height);
  if (rawHeight === null || rawHeight <= 0) return 0;
  const pitch = normalizePitch180((element as { pitch?: unknown }).pitch);
  if (pitch === null) return rawHeight;
  if (Math.abs(pitch) < 0.001 || Math.abs(pitch - 180) < 0.001) return 0;
  return rawHeight * Math.sin(pitch * Math.PI / 180);
}

function maxZoneHeight(zones: Zone[] | undefined): number {
  return Math.max(
    0,
    ...(zones ?? []).map((zone) => parseFiniteNumber((zone as { height?: unknown }).height) ?? 0),
  );
}

function maxEffectiveStoreyHeight(floors: Floor[]): number {
  return Math.max(0, ...floors.map((floor) => floor.height).filter(isFiniteNumber));
}

function positiveOrUndefined(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function metadataBaseHeightM(
  complianceSettings: ComplianceSettings | undefined,
  floors: Floor[],
  localModelHeightM: number | undefined,
): { baseM: number; source: DevelopmentModelVerticalContext['source'] } {
  const ventilationBase = parseFiniteNumber(complianceSettings?.Ventilation_ventilation_zone_base_height);
  if (ventilationBase !== null) {
    return { baseM: ventilationBase, source: 'ventilation_zone_base_height' };
  }

  const storeyOfDwelling = parseFiniteNumber(complianceSettings?.storey_of_dwelling);
  if (storeyOfDwelling !== null) {
    const floorZ = fhsStoreyToCanvasFloor(storeyOfDwelling);
    if (floorZ === 0) return { baseM: 0, source: 'storey_of_dwelling' };
    const slab = floorZ > 0 ? slabElevationMForFloorZ(floorZ, floors) : 0;
    if (slab > 0) return { baseM: slab, source: 'storey_of_dwelling' };
    if (localModelHeightM !== undefined) {
      return {
        baseM: floorZ * localModelHeightM,
        source: 'storey_of_dwelling',
      };
    }
  }

  return { baseM: 0, source: 'local_model' };
}

export function resolveDevelopmentModelVerticalContext(args: {
  elements: Element[];
  zones?: Zone[];
  floors?: Floor[];
  complianceSettings?: ComplianceSettings;
}): DevelopmentModelVerticalContext {
  const floors = withEffectiveStoreyHeights(args.floors ?? deriveFloorsFromElements(args.elements), args.elements) ?? [];
  const footprint = selectLowestOccupiedFootprint(args.elements, floors);
  const localBaseM = footprint?.baseM ?? 0;
  const elementTops = args.elements
    .filter((element) => element.type !== 'ContextShading')
    .map((element) => elementBaseElevationMForTb(element, floors) + elementVerticalHeightM(element))
    .filter(isFiniteNumber);
  const localTopM = Math.max(localBaseM, ...elementTops);
  const heightCandidates = [
    positiveOrUndefined(localTopM - localBaseM),
    positiveOrUndefined(maxZoneHeight(args.zones)),
    positiveOrUndefined(maxEffectiveStoreyHeight(floors)),
    positiveOrUndefined(parseFiniteNumber(args.complianceSettings?.AirPermeability_ventilation_zone_height) ?? 0),
  ];
  const knownHeightM = heightCandidates.find((height): height is number => height !== undefined);
  const metadataBase = metadataBaseHeightM(args.complianceSettings, floors, knownHeightM);
  const usesElementBase = localBaseM > SAME_FLOOR_TOLERANCE_M;
  const baseM = usesElementBase ? localBaseM : metadataBase.baseM;
  const heightM = knownHeightM ?? 0;

  return {
    baseM: roundToTwoDecimals(baseM),
    topM: roundToTwoDecimals(baseM + heightM),
    heightM: roundToTwoDecimals(heightM),
    heightKnown: knownHeightM !== undefined,
    source: usesElementBase ? 'element_base_height' : metadataBase.source,
  };
}

export function classifyDevelopmentContextVerticalRelation(
  active: DevelopmentModelVerticalContext,
  context: DevelopmentModelVerticalContext,
): DevelopmentContextVerticalRelation {
  if (context.baseM > active.baseM + SAME_FLOOR_TOLERANCE_M) return 'above';
  if (context.baseM < active.baseM - SAME_FLOOR_TOLERANCE_M) return 'below';
  return 'same';
}

function getModelComplianceSettings(model: DevelopmentContextShadingModel): ComplianceSettings | undefined {
  return model.metadata?.complianceSettings;
}

function sourceKeyFor(
  projectId: string,
  activeStem: string,
  sourceStem: string,
  sourceKind: DevelopmentContextShadingSourceKind = 'model_footprint',
  sourceElementId = '',
): string {
  if (sourceKind === 'model_footprint') {
    return `${projectId}\u0000${activeStem}\u0000${sourceStem}`;
  }
  return `${projectId}\u0000${activeStem}\u0000${sourceStem}\u0000${sourceKind}\u0000${sourceElementId}`;
}

function modelFootprintSourceFingerprint(model: DevelopmentContextShadingModel, footprint: FootprintCandidate, vertical: DevelopmentModelVerticalContext): string {
  return simpleHash(stableStringify({
    stem: model.stem,
    sourceKind: 'model_footprint',
    footprintElementId: footprint.element.id,
    footprintCoords: footprint.element.coordinates.map(roundCoord),
    vertical,
  }));
}

function explicitContextShadingSourceFingerprint(model: DevelopmentContextShadingModel, source: ContextShading): string {
  return simpleHash(stableStringify({
    stem: model.stem,
    sourceKind: 'explicit_context_shading',
    sourceName: source.name,
    shading_type: source.shading_type,
    height: roundToTwoDecimals(source.height),
    coordinates: (source.coordinates ?? []).map(roundCoord),
  }));
}

function explicitContextShadingDedupeKey(source: ContextShading): string {
  return simpleHash(stableStringify({
    sourceKind: 'explicit_context_shading',
    shading_type: source.shading_type,
    height: roundToTwoDecimals(source.height),
    coordinates: (source.coordinates ?? []).map(roundPlanCoord),
  }));
}

function readDevelopmentContextShadingExtraRecord(element: Element): Record<string, unknown> | null {
  const raw = element.extra_json?.[DEVELOPMENT_CONTEXT_SHADING_META_KEY];
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
}

export function getDevelopmentContextSharedContextShadingId(
  element: Element | null | undefined,
): string | null {
  if (!element || element.type !== 'ContextShading') return null;
  const record = readDevelopmentContextShadingExtraRecord(element);
  const sharedId = record?.sharedId;
  return typeof sharedId === 'string' && sharedId.trim() ? sharedId.trim() : null;
}

export function getExplicitContextShadingSharedId(
  projectId: string,
  source: ContextShading,
): string {
  return getDevelopmentContextSharedContextShadingId(source)
    ?? `ctx-${simpleHash(stableStringify({
      projectId,
      sourceKind: 'explicit_context_shading',
      dedupeKey: explicitContextShadingDedupeKey(source),
    }))}`;
}

function explicitContextShadingIdentityKey(projectId: string, source: ContextShading): string {
  return getExplicitContextShadingSharedId(projectId, source);
}

function generatedElementSignature(element: ContextShading): string {
  return stableStringify({
    name: element.name,
    shading_type: element.shading_type,
    start_angle: roundToTwoDecimals(element.start_angle),
    end_angle: roundToTwoDecimals(element.end_angle),
    distance: roundToTwoDecimals(element.distance),
    height: roundToTwoDecimals(element.height),
    parent_element: element.parent_element,
    coordinates: (element.coordinates ?? []).map(roundCoord),
  });
}

function readGeneratedMeta(element: Element): GeneratedMeta | null {
  const record = readDevelopmentContextShadingExtraRecord(element) as Partial<GeneratedMeta> | null;
  if (!record) return null;
  if (
    record.version !== 1 ||
    typeof record.projectId !== 'string' ||
    typeof record.activeStem !== 'string' ||
    typeof record.sourceStem !== 'string'
  ) {
    return null;
  }
  return record as GeneratedMeta;
}

function generatedSourceKeyForActiveStem(meta: GeneratedMeta, activeStem: string): string {
  const sourceKind = getDevelopmentContextShadingSourceKind(meta);
  return sourceKeyFor(
    meta.projectId,
    activeStem,
    meta.sourceStem,
    sourceKind,
    sourceKind === 'explicit_context_shading'
      ? meta.sharedId ?? meta.sourceElementId ?? ''
      : '',
  );
}

function makeUniqueName(baseName: string, usedNames: Set<string>): string {
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName);
    return baseName;
  }
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${baseName} ${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }
  const fallback = `${baseName} ${simpleHash(`${baseName}:${usedNames.size}`)}`;
  usedNames.add(fallback);
  return fallback;
}

function withoutGeneratedMeta(extraJson: Record<string, unknown> | undefined): Record<string, unknown> {
  const next = { ...(extraJson ?? {}) };
  delete next[DEVELOPMENT_CONTEXT_SHADING_META_KEY];
  return next;
}

function materializeSharedContextShadingSource(
  projectId: string,
  element: ContextShading,
): ContextShading {
  if (readGeneratedMeta(element)) return element;
  const record = readDevelopmentContextShadingExtraRecord(element);
  if (record?.sourceKind === 'model_footprint') return element;

  const sharedId = getDevelopmentContextSharedContextShadingId(element)
    ?? getExplicitContextShadingSharedId(projectId, element);
  const nextRecord = {
    ...(record ?? {}),
    sharedId,
    projectId,
    ...(typeof record?.sourceName === 'string' ? { sourceName: record.sourceName } : {}),
  };
  if (stableStringify(record ?? {}) === stableStringify(nextRecord)) return element;
  return {
    ...element,
    extra_json: {
      ...(element.extra_json ?? {}),
      [DEVELOPMENT_CONTEXT_SHADING_META_KEY]: nextRecord,
    },
  };
}

export function normalizeDevelopmentContextShadingExtraJsonForCsv(
  element: ContextShading,
): Record<string, unknown> | undefined {
  const extra = element.extra_json as Record<string, unknown> | undefined;
  const meta = readGeneratedMeta(element);
  if (!meta || getDevelopmentContextShadingSourceKind(meta) === 'model_footprint') {
    return extra;
  }

  const sharedId = meta.sharedId ?? getDevelopmentContextSharedContextShadingId(element);
  if (!sharedId) return extra;

  const next = withoutGeneratedMeta(extra);
  next[DEVELOPMENT_CONTEXT_SHADING_META_KEY] = {
    sharedId,
    projectId: meta.projectId,
    ...(meta.sourceName ? { sourceName: meta.sourceName } : {}),
  };
  return Object.keys(next).length > 0 ? next : undefined;
}

function buildGeneratedContextShadingFromCoordinates(args: {
  id: string;
  name: string;
  parent: Element;
  sourceModel: DevelopmentContextShadingModel;
  sourceElementId: string;
  sourceKind: DevelopmentContextShadingSourceKind;
  sourceKey: string;
  sourceFingerprint: string;
  sourceCoordinates: Coord[];
  shadingType: ContextShading['shading_type'];
  heightM: number;
  verticalRelation: DevelopmentContextVerticalRelation;
  projectId: string;
  activeStem: string;
  globalOrientationOffset: number;
  sharedId?: string;
  sourceName?: string;
}): ContextShading {
  const parentZ = args.parent.coordinates[0]?.z ?? 0;
  const coordinates = args.sourceCoordinates.map((coord) => ({
    x: coord.x,
    y: coord.y,
    z: parentZ,
  }));
  const draft: ContextShading = {
    id: args.id,
    name: args.name,
    type: 'ContextShading',
    shading_type: args.shadingType,
    start_angle: 0,
    end_angle: 0,
    distance: 0,
    height: roundToTwoDecimals(args.heightM),
    parent_element: args.parent.name,
    coordinates,
  };
  const angles = calculateContextShadingAngularRangeFromCoordinates(
    draft,
    args.parent,
    args.globalOrientationOffset,
  );
  draft.start_angle = roundToTwoDecimals(angles.start_angle);
  draft.end_angle = roundToTwoDecimals(angles.end_angle);
  draft.distance = calculateContextShadingDistanceFromCoordinates(draft, args.parent);

  const metaWithoutSignature = {
    version: 1 as const,
    projectId: args.projectId,
    activeStem: args.activeStem,
    sourceStem: args.sourceModel.stem,
    ...(args.sourceKind === 'model_footprint' ? { sourceKind: 'model_footprint' as const } : {}),
    sourceElementId: args.sourceElementId,
    sourceKey: args.sourceKey,
    sourceFingerprint: args.sourceFingerprint,
    generatedSignature: '',
    verticalRelation: args.verticalRelation,
    ...(args.sharedId ? { sharedId: args.sharedId } : {}),
    ...(args.sourceName ? { sourceName: args.sourceName } : {}),
  };
  const withMeta: ContextShading = {
    ...draft,
    extra_json: {
      [DEVELOPMENT_CONTEXT_SHADING_META_KEY]: {
        ...metaWithoutSignature,
        generatedSignature: generatedElementSignature(draft),
      },
    },
  };
  return withMeta;
}

function buildGeneratedContextShading(args: {
  id: string;
  name: string;
  parent: Element;
  sourceModel: DevelopmentContextShadingModel;
  sourceFootprint: FootprintCandidate;
  sourceVertical: DevelopmentModelVerticalContext;
  activeVertical: DevelopmentModelVerticalContext;
  projectId: string;
  activeStem: string;
  globalOrientationOffset: number;
}): ContextShading {
  const key = sourceKeyFor(args.projectId, args.activeStem, args.sourceModel.stem);
  return buildGeneratedContextShadingFromCoordinates({
    id: args.id,
    name: args.name,
    parent: args.parent,
    sourceModel: args.sourceModel,
    sourceElementId: args.sourceFootprint.element.id,
    sourceKind: 'model_footprint',
    sourceKey: key,
    sourceFingerprint: modelFootprintSourceFingerprint(args.sourceModel, args.sourceFootprint, args.sourceVertical),
    sourceCoordinates: args.sourceFootprint.element.coordinates,
    shadingType: 'obstacle',
    heightM: args.sourceVertical.topM,
    verticalRelation: classifyDevelopmentContextVerticalRelation(args.activeVertical, args.sourceVertical),
    projectId: args.projectId,
    activeStem: args.activeStem,
    globalOrientationOffset: args.globalOrientationOffset,
  });
}

function sameGeneratedElement(a: Element | undefined, b: Element): boolean {
  if (!a) return false;
  return stableStringify(a) === stableStringify(b);
}

export function syncDevelopmentContextShadingElements(
  args: SyncDevelopmentContextShadingArgs,
): SyncDevelopmentContextShadingResult {
  let changed = false;
  const nextById: Record<string, Element> = { ...args.elementsById };
  let nextIds = [...args.elementIds];
  const activeElements = Object.values(args.elementsById)
    .filter((element) => !isContextGeneratedElement(element))
    .map((element) => {
      if (element.type !== 'ContextShading') return element;
      const materialized = materializeSharedContextShadingSource(args.projectId, element);
      if (materialized === element) return element;
      nextById[element.id] = materialized;
      changed = true;
      return materialized;
    });
  const activeFloors = withEffectiveStoreyHeights(args.floors, activeElements) ?? [];
  const activeParent = selectLowestOccupiedFootprint(activeElements, activeFloors);
  const activeVertical = resolveDevelopmentModelVerticalContext({
    elements: activeElements,
    zones: args.zones,
    floors: activeFloors,
    complianceSettings: args.complianceSettings,
  });

  const existingGenerated = new Map<string, { id: string; element: ContextShading }>();
  const generatedToRemove: string[] = [];
  for (const id of args.elementIds) {
    const element = args.elementsById[id];
    if (!element || element.type !== 'ContextShading') continue;
    const meta = readGeneratedMeta(element);
    if (!meta || meta.projectId !== args.projectId) continue;
    const generatedForActiveStem = meta.activeStem === args.activeStem;
    const generatedForDraftBeingNamed =
      args.activeStem !== 'draft_model' && meta.activeStem === 'draft_model';
    if (!generatedForActiveStem && !generatedForDraftBeingNamed) continue;
    generatedToRemove.push(id);
    existingGenerated.set(generatedSourceKeyForActiveStem(meta, args.activeStem), {
      id,
      element,
    });
  }

  const usedNames = new Set(
    Object.values(args.elementsById)
      .filter((element) => {
        if (element.type !== 'ContextShading') return true;
        const meta = readGeneratedMeta(element);
        return !meta;
      })
      .map((element) => element.name)
      .filter(Boolean),
  );

  const targets = new Map<string, ContextShading>();
  const seenExplicitContextShading = new Set(
    activeElements
      .filter((element): element is ContextShading => element.type === 'ContextShading')
      .map((element) => explicitContextShadingIdentityKey(args.projectId, element)),
  );
  let skippedSameFloorOverlapCount = 0;
  let skippedUnknownHeightCount = 0;

  if (activeParent) {
    for (const model of args.contextModels) {
      if (!model.stem || model.stem === args.activeStem) continue;
      const modelFloors = withEffectiveStoreyHeights(model.floors ?? deriveFloorsFromElements(model.elements), model.elements) ?? [];
      const sourceFootprint = selectLowestOccupiedFootprint(model.elements, modelFloors);
      const sourceVertical = resolveDevelopmentModelVerticalContext({
        elements: model.elements,
        zones: model.zones,
        floors: modelFloors,
        complianceSettings: getModelComplianceSettings(model),
      });
      if (sourceFootprint) {
        const sameFloor =
          Math.abs(sourceVertical.baseM - activeVertical.baseM) <= SAME_FLOOR_TOLERANCE_M;
        const overlappingFootprint =
          boundsOverlapArea(activeParent.bounds, sourceFootprint.bounds) > FOOTPRINT_OVERLAP_TOLERANCE_M2;
        if (overlappingFootprint) {
          if (sameFloor) skippedSameFloorOverlapCount++;
        } else if (!sourceVertical.heightKnown) {
          skippedUnknownHeightCount++;
        } else {
          const key = sourceKeyFor(args.projectId, args.activeStem, model.stem);
          const existing = existingGenerated.get(key);
          const name = makeUniqueName(`Project context - ${model.stem}`, usedNames);
          targets.set(key, buildGeneratedContextShading({
            id: existing?.id ?? generatedElementId(key),
            name,
            parent: activeParent.element,
            sourceModel: model,
            sourceFootprint,
            sourceVertical,
            activeVertical,
            projectId: args.projectId,
            activeStem: args.activeStem,
            globalOrientationOffset: args.globalOrientationOffset ?? 0,
          }));
        }
      }

      for (const sourceContext of model.elements) {
        if (sourceContext.type !== 'ContextShading' || readGeneratedMeta(sourceContext)) continue;
        const sharedId = getExplicitContextShadingSharedId(args.projectId, sourceContext);
        const dedupeKey = explicitContextShadingIdentityKey(args.projectId, sourceContext);
        if (seenExplicitContextShading.has(dedupeKey)) continue;
        seenExplicitContextShading.add(dedupeKey);

        const key = sourceKeyFor(args.projectId, args.activeStem, model.stem, 'explicit_context_shading', sharedId);
        const existing = existingGenerated.get(key);
        const name = makeUniqueName(`Project context - ${model.stem} - ${sourceContext.name}`, usedNames);
        targets.set(key, buildGeneratedContextShadingFromCoordinates({
          id: existing?.id ?? generatedElementId(key),
          name,
          parent: activeParent.element,
          sourceModel: model,
          sourceElementId: sourceContext.id,
          sourceKind: 'explicit_context_shading',
          sourceKey: key,
          sourceFingerprint: explicitContextShadingSourceFingerprint(model, sourceContext),
          sourceCoordinates: sourceContext.coordinates ?? [],
          shadingType: sourceContext.shading_type,
          heightM: sourceContext.height,
          verticalRelation: classifyDevelopmentContextVerticalRelation(activeVertical, sourceVertical),
          projectId: args.projectId,
          activeStem: args.activeStem,
          globalOrientationOffset: args.globalOrientationOffset ?? 0,
          sharedId,
          sourceName: sourceContext.name,
        }));
      }
    }
  }

  for (const [key, target] of targets) {
    const existing = existingGenerated.get(key);
    const elementToWrite: ContextShading = {
      ...target,
      extra_json: {
        ...withoutGeneratedMeta(existing?.element.extra_json),
        ...target.extra_json,
      },
    };
    if (!sameGeneratedElement(nextById[elementToWrite.id], elementToWrite)) {
      nextById[elementToWrite.id] = elementToWrite;
      changed = true;
    }
    if (!nextIds.includes(elementToWrite.id)) {
      nextIds.push(elementToWrite.id);
      changed = true;
    }
  }

  const targetIds = new Set([...targets.values()].map((element) => element.id));
  for (const id of generatedToRemove) {
    if (targetIds.has(id)) continue;
    delete nextById[id];
    nextIds = nextIds.filter((elementId) => elementId !== id);
    changed = true;
  }

  return {
    elementsById: changed ? nextById : args.elementsById,
    elementIds: changed ? nextIds : args.elementIds,
    changed,
    generatedCount: targets.size,
    skippedSameFloorOverlapCount,
    skippedUnknownHeightCount,
  };
}
