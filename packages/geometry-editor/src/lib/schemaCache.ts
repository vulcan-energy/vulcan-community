// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { getAjvInstance, ensureRootSchema } from './ajvCache';
import { errorMessageFromUnknown, isRecord } from './jsonTypes';
import { asSchemaNode, isSchemaNode, type SchemaNode } from './schemaTypes';
import { resolveRefNode } from './schemaRefResolver';
import type { GeometrySchemaMode } from '../../../geometry-editor-host/src/schemaPort';

export type GeometrySchemaAssetSource = Readonly<{
  loadText(mode: GeometrySchemaMode): Promise<string>;
}>;

let schemaAssetSource: GeometrySchemaAssetSource | null = null;

/**
 * Registers the host-owned schema assets used by the canonical resolver.
 * Hosts choose where the assets live; parsing, caching, resolution and
 * property validation remain one public implementation.
 */
export function configureGeometrySchemaAssetSource(
  source: GeometrySchemaAssetSource,
): void {
  schemaAssetSource = source;
}

/** Clears configured assets and both caches. Intended only for isolated tests. */
export function resetGeometrySchemaAssetsForTests(): void {
  schemaAssetSource = null;
  __resetSchemaCacheForTests();
  __resetFHSSchemaCacheForTests();
}

async function loadSchemaText(mode: GeometrySchemaMode): Promise<string> {
  if (!schemaAssetSource) {
    throw new Error(
      'Geometry schema assets are not configured. Call configureGeometrySchemaAssetSource() before preload.',
    );
  }
  return schemaAssetSource.loadText(mode);
}

type PropertyValidator = ReturnType<ReturnType<typeof getAjvInstance>['compile']>;

let schemaText: string | null = null;
let schemaObj: SchemaNode | null = null;
/** In-flight load so concurrent callers await the same fetch (see preloadSchema). */
let preloadCoreSchemaPromise: Promise<void> | null = null;

// Cache compiled single-property validators to avoid ajv.compile() churn in hot paths.
// We key by the property schema object identity (WeakMap) and keep separate caches for core vs FHS roots.
// Note: WeakMaps can't be cleared, so we reassign on schema (re)load/reset.
let compiledPropValidatorCore: WeakMap<object, PropertyValidator> = new WeakMap();
let compiledPropValidatorFhs: WeakMap<object, PropertyValidator> = new WeakMap();

// Optional debug instrumentation (off by default).
// Enable in DevTools:
//   window.__VULCAN_SCHEMA_DEBUG__ = { enabled: true, logEvery: 200 }
type VulcanSchemaDebug = { enabled?: boolean; logEvery?: number };
const getSchemaDebug = (): VulcanSchemaDebug | null => {
  try {
    const dbg = (globalThis as typeof globalThis & { __VULCAN_SCHEMA_DEBUG__?: unknown }).__VULCAN_SCHEMA_DEBUG__;
    if (dbg && typeof dbg === 'object') {
      const candidate = dbg as VulcanSchemaDebug;
      if (candidate.enabled) return candidate;
    }
  } catch { /* swallow: best-effort */ }
  return null;
};
let dbgCalls = 0;
let dbgCompileCalls = 0;
let dbgCompileMs = 0;
const dbgSchemaId = new WeakMap<object, number>();
let dbgNextId = 1;
function getDbgId(obj: object): number {
  const existing = dbgSchemaId.get(obj);
  if (existing) return existing;
  const id = dbgNextId++;
  dbgSchemaId.set(obj, id);
  return id;
}

function schemaStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

// FHS schema cache (separate from Core schema)
let fhsSchemaText: string | null = null;
let fhsSchemaObj: SchemaNode | null = null;
let fhsPreloadStarted = false;

export async function preloadSchema(): Promise<void> {
  if (schemaObj) return;
  if (!preloadCoreSchemaPromise) {
    preloadCoreSchemaPromise = (async () => {
      try {
        const txt = await loadSchemaText('core');
        schemaText = txt;
        schemaObj = asSchemaNode(JSON.parse(txt));
        if (!schemaObj) {
          throw new Error('Core geometry schema root must be an object');
        }
        // Schema-driven coercion caches depend on schema contents; invalidate after (re)load.
        try { strictestIntegerKeysCache.clear(); } catch { /* swallow: best-effort */ }
        // Reset compiled validator cache for core schema
        compiledPropValidatorCore = new WeakMap();
      } catch (e) {
        schemaText = null;
        schemaObj = null;
        console.error('[SchemaCache] Core schema load failed', e);
        throw e;
      }
    })().finally(() => {
      preloadCoreSchemaPromise = null;
    });
  }
  await preloadCoreSchemaPromise;
}

export function getSchemaText(): string | null { return schemaText; }
export function getSchemaObject(): SchemaNode | null { return schemaObj; }
export function getSchemaObjectForMode(useFHSSchema: boolean): SchemaNode | null {
  return useFHSSchema ? getFHSSchemaObject() : getSchemaObject();
}

/**
 * Returns appliance keys from the active root schema `Appliances.patternProperties`.
 * Example schema pattern key:
 *   "Clothes_washing|Clothes_drying|Dishwasher|Fridge|..."
 */
export function getApplianceKeysForMode(useFHSSchema: boolean): string[] {
  const root = getSchemaObjectForMode(useFHSSchema);
  const appliances = root?.properties?.Appliances;
  const patternProps = appliances?.patternProperties;
  if (!patternProps) return [];

  const keys = new Set<string>();
  for (const patternKey of Object.keys(patternProps)) {
    for (const token of patternKey.split('|')) {
      const trimmed = token.trim();
      if (trimmed.length > 0) keys.add(trimmed);
    }
  }
  return [...keys];
}

/**
 * Resolved JSON Schema object for one HEM element type (and optional subtype), using the same
 * root as compliance-driven UI (`input_fhs` vs `input_core`).
 *
 * **Long-term direction (incremental):**
 * 1. **Single pipeline** — this delegates to {@link resolveElementSubschemaForProfile} on the active root
 *    (`getSchemaObjectForMode`), so mode switching does not re-implement `core` vs `fhs` branching.
 * 2. **Shared merge helpers** — repeated `allOf` / `if` / `then` merges live in small helpers next to the resolvers.
 * 3. **Optional adapter layer** — if drift remains costly, introduce a tiny internal IR (`properties`, `required`,
 *    optional `conditionals`) with one adapter per published input; keep public API stable.
 */
export function getElementSubschemaForMode(
  useFHSSchema: boolean,
  elementType: string,
  subtype?: string,
): SchemaNode | null {
  return resolveElementSubschemaForProfile(
    getSchemaObjectForMode(useFHSSchema),
    useFHSSchema ? 'fhs' : 'core',
    elementType,
    subtype,
  );
}

/**
 * Discriminator-style sub-keys used by `getSubschemaForElementType` / `getFHSSubschemaForElementType`
 * (e.g. ground `floor_type`, MV `vent_type`). Keeps call sites aligned with schema resolution.
 */
export function getSchemaSubtypeForElementData(
  elementType: string,
  elementData: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!elementData || typeof elementData !== 'object') return undefined;
  const s = (k: string) => {
    const v = elementData[k];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  switch (elementType) {
    case 'BuildingElementGround':
      return s('floor_type');
    case 'MechanicalVentilation':
      return s('vent_type');
    case 'WetEmitter':
      return s('subcategory');
    case 'Appliance':
      return s('appliancekey');
    case 'HotWaterDemand':
      return s('subcategory');
    case 'WindowShading':
      return s('shading_type');
    case 'ContextShading':
      return s('shading_type');
    case 'System':
      return s('subcategory');
    default:
      return undefined;
  }
}

/**
 * Simplified fabric Form view walks JSON pointers into `$defs` (e.g. ZoneFHS → BuildingElement).
 * Some call sites pass a root that only has `properties` and omits `$defs`, so pointer remap never runs
 * and legacy `#/$defs/BuildingElement` fails. Merge the preloaded core defs when missing.
 */
export function schemaRootForFabricEditor(root: unknown): unknown {
  if (!isSchemaNode(root)) return root;
  if (root.$defs && Object.keys(root.$defs).length > 0) return root;
  const cached = getSchemaObject();
  if (cached?.$defs && Object.keys(cached.$defs).length > 0) {
    return { ...root, $defs: cached.$defs };
  }
  return root;
}

// FHS schema loading and caching
export async function preloadFHSSchema(): Promise<void> {
  if (fhsSchemaObj) return;
  if (fhsPreloadStarted) return;
  fhsPreloadStarted = true;
  try {
    const txt = await loadSchemaText('fhs');
    fhsSchemaText = txt;
    fhsSchemaObj = asSchemaNode(JSON.parse(txt));
    if (!fhsSchemaObj) {
      throw new Error('FHS geometry schema root must be an object');
    }
    // Schema-driven coercion caches depend on schema contents; invalidate after (re)load.
    try { strictestIntegerKeysCache.clear(); } catch { /* swallow: best-effort */ }
    // Reset compiled validator cache for FHS schema
    compiledPropValidatorFhs = new WeakMap();
    if (!fhsSchemaObj.$defs && !fhsSchemaObj.properties) {
      throw new Error('FHS geometry schema is missing properties and $defs');
    }
  } catch (e: unknown) {
    fhsSchemaText = null;
    fhsSchemaObj = null;
    fhsPreloadStarted = false;
    console.error('[SchemaCache] FHS schema load failed:', errorMessageFromUnknown(e));
    throw e;
  }
}

export function getFHSSchemaText(): string | null { return fhsSchemaText; }
export function getFHSSchemaObject(): SchemaNode | null { return fhsSchemaObj; }

export function getCoreSchemaText(): string | null { return getSchemaText(); }
export function getCoreSchemaObject(): SchemaNode | null { return getSchemaObject(); }

// Schema type definitions
export type SchemaType = 'input_core' | 'input_fhs';
export type ModeAwareSchemaType = SchemaType;

export function getDefaultInputSchemaType(useFHSSchema: boolean): ModeAwareSchemaType {
  return useFHSSchema ? 'input_fhs' : 'input_core';
}

// Get schema by type
export function getSchemaByType(type: SchemaType): { text: string | null; obj: SchemaNode | null } {
  switch (type) {
    case 'input_core':
      return { text: getCoreSchemaText(), obj: getCoreSchemaObject() };
    case 'input_fhs':
      return { text: getFHSSchemaText(), obj: getFHSSchemaObject() };
  }
}

// Preload all schemas
export async function preloadAllSchemas(): Promise<void> {
  await Promise.all([
    preloadSchema(),
    preloadFHSSchema(),
  ]);
}

// Test-only helpers for FHS schema
export function __setFHSSchemaObjectForTests(obj: SchemaNode | null): void {
  fhsSchemaObj = obj;
  try { strictestIntegerKeysCache.clear(); } catch { /* swallow: best-effort */ }
  compiledPropValidatorFhs = new WeakMap();
}
export function __resetFHSSchemaCacheForTests(): void {
  fhsSchemaText = null;
  fhsSchemaObj = null;
  fhsPreloadStarted = false;
  try { strictestIntegerKeysCache.clear(); } catch { /* swallow: best-effort */ }
  compiledPropValidatorFhs = new WeakMap();
}

/**
 * In `input_fhs.schema.json`, `BuildingElementGround` adds floor-type-specific fields via
 * `then.allOf` with `if.properties.floor_type.const` or `if.anyOf[].properties.floor_type.const`.
 */
function fhsGroundNestedFloorTypeIfMatches(ifCond: SchemaNode | null | undefined, subtype: string): boolean {
  if (!ifCond) return false;
  const ft = ifCond.properties?.floor_type;
  if (ft?.const === subtype) return true;
  const anyOf = ifCond.anyOf;
  if (Array.isArray(anyOf)) {
    return anyOf.some((c) => c.properties?.floor_type?.const === subtype);
  }
  return false;
}

/** `BuildingElement` FHS `allOf` blocks match on `properties.type.const` or `anyOf[].properties.type.const`. */
function fhsBuildingElementAllOfTypeMatches(ifCond: SchemaNode | null | undefined, elementType: string): boolean {
  if (!ifCond) return false;
  if (ifCond.properties?.type?.const === elementType) return true;
  const anyOf = ifCond.anyOf;
  if (Array.isArray(anyOf)) {
    return anyOf.some((cond) => cond.properties?.type?.const === elementType);
  }
  return false;
}

/**
 * Merge `allOf` branches keyed by `if.properties.vent_type.const` into running props/required.
 * - `overwrite`: then.properties win on key collisions (FHS MV + core MV primary merge).
 * - `fillMissing`: only add keys not already present (core schema augmented from loaded FHS).
 */
function mergeMechanicalVentilationAllOfBySubtype(
  mergedProps: Record<string, SchemaNode>,
  mergedRequired: string[],
  allOf: SchemaNode[] | undefined | null,
  subtype: string | undefined,
  mode: 'overwrite' | 'fillMissing',
): void {
  if (!subtype || !Array.isArray(allOf)) return;
  try {
    for (const block of allOf) {
      const cond = block?.if?.properties?.vent_type?.const;
      if (cond && cond === subtype) {
        const thenProps = block?.then?.properties;
        const thenReq = block?.then?.required;
        if (thenProps) {
          if (mode === 'fillMissing') {
            for (const [key, value] of Object.entries(thenProps)) {
              if (!(key in mergedProps)) {
                mergedProps[key] = value;
              }
            }
          } else {
            Object.assign(mergedProps, thenProps);
          }
        }
        mergedRequired.push(...schemaStringArray(thenReq));
      }
      // FHS: `if: { anyOf: [ { properties: { vent_type: { const } } }, ... ] }` (e.g. SFP for Intermittent MEV)
      const anyConds = block?.if?.anyOf;
      if (Array.isArray(anyConds)) {
        const matches = anyConds.some(
          (c) => c.properties?.vent_type?.const === subtype,
        );
        if (matches) {
          const thenProps = block?.then?.properties;
          const thenReq = block?.then?.required;
          if (thenProps) {
            if (mode === 'fillMissing') {
              for (const [key, value] of Object.entries(thenProps)) {
                if (!(key in mergedProps)) {
                  mergedProps[key] = value;
                }
              }
            } else {
              Object.assign(mergedProps, thenProps);
            }
          }
          mergedRequired.push(...schemaStringArray(thenReq));
        }
      }
    }
  } catch {
    // keep base behavior
  }
}

/**
 * FHS: first `allOf` block is `if vent_type=MVHR` / `else` { oneOf: [ exhaust path alts ] } for all non-MVHR types.
 * Advanced Fields only sees `properties`; merge the first oneOf option (mid_height + orientation + pitch) so
 * users can author what schema validation requires for Intermittent / Decentralised / Centralised MEV.
 *
 * Required fields from the branch are intentionally NOT merged here — the schema's `oneOf` accepts
 * either Branch A (flat fields) or Branch B (`position_exhaust` object), and `getConditionalRequiredFieldsForMode`
 * evaluates which branch is satisfied. Pushing required here would force Branch A even if the user
 * authored Branch B.
 */
function mergeMechanicalVentilationNonMvhrPositionBranch(
  mergedProps: Record<string, SchemaNode>,
  allOf: SchemaNode[] | undefined | null,
  subtype: string | undefined,
): void {
  if (!subtype || subtype === 'MVHR' || !Array.isArray(allOf) || allOf.length === 0) return;
  const first = allOf[0];
  if (first?.if?.properties?.vent_type?.const !== 'MVHR') return;
  const oneOf = first?.else?.oneOf;
  if (!Array.isArray(oneOf) || !oneOf[0]?.properties) return;
  const firstBranch = oneOf[0];
  Object.assign(mergedProps, firstBranch.properties);
}

/** Nested `then.allOf` for FHS `BuildingElementGround` floor_type variants (e.g. Suspended_floor). */
function mergeFhsGroundNestedFloorTypeAllOf(
  mergedProps: Record<string, SchemaNode>,
  mergedRequired: string[],
  thenBlock: SchemaNode | null | undefined,
  floorSubtype: string | undefined,
): void {
  if (!floorSubtype || !thenBlock?.allOf || !Array.isArray(thenBlock.allOf)) return;
  for (const nb of thenBlock.allOf) {
    if (!fhsGroundNestedFloorTypeIfMatches(nb?.if, floorSubtype)) continue;
    const nThenProps = nb.then?.properties;
    const nThenReq = nb.then?.required;
    if (nThenProps) {
      Object.assign(mergedProps, nThenProps);
    }
    mergedRequired.push(...schemaStringArray(nThenReq));
  }
}

/**
 * FHS `BuildingElementPartyWall`: lining type and cavity R live under `then.allOf` branches keyed on
 * `party_wall_cavity_type`. Merge them into flat `properties` so Advanced Fields / fabric defaults UI can resolve `$ref`s.
 *
 * Required fields from these branches are intentionally NOT merged — they are conditional on the
 * cavity_type value and must be evaluated by `getConditionalRequiredFieldsForMode` instead.
 */
function mergeFhsPartyWallNestedAllOf(
  mergedProps: Record<string, SchemaNode>,
  thenBlock: SchemaNode | null | undefined,
): void {
  if (!thenBlock?.allOf || !Array.isArray(thenBlock.allOf)) return;
  for (const nb of thenBlock.allOf) {
    const nThenProps = nb?.then?.properties;
    if (nThenProps && typeof nThenProps === 'object') {
      Object.assign(mergedProps, nThenProps);
    }
  }
}

function mergeAllOfThenPropertiesByType(
  mergedProps: Record<string, SchemaNode>,
  mergedRequired: string[],
  allOf: SchemaNode[] | undefined | null,
  elementType: string,
): void {
  if (!Array.isArray(allOf)) return;
  for (const block of allOf) {
    if (!fhsBuildingElementAllOfTypeMatches(block?.if, elementType) || !block?.then) continue;
    const thenProps = block.then.properties;
    const thenReq = block.then.required;
    if (thenProps) {
      Object.assign(mergedProps, thenProps);
    }
    mergedRequired.push(...schemaStringArray(thenReq));
  }
}

/** Maps app element kinds to the section key / $defs name used in both published roots. */
const ELEMENT_TYPE_TO_SCHEMA_KEY: Record<string, string> = {
  'BuildingElementGround': 'BuildingElement',
  'BuildingElementOpaque': 'BuildingElement',
  'BuildingElementTransparent': 'BuildingElement',
  'BuildingElementAdjacentConditionedSpace': 'BuildingElement',
  'BuildingElementAdjacentUnconditionedSpace_Simple': 'BuildingElement',
  'BuildingElementPartyWall': 'BuildingElement',
  'ThermalBridgeLinear': 'ThermalBridgingDetails',
  'ThermalBridgePoint': 'ThermalBridgingDetails',
  'MechanicalVentilation': 'MechanicalVentilation',
  'WindowShading': 'WindowShading',
  'Lighting': 'Lighting',
  'MechanicalVentilationDuctwork': 'MechanicalVentilationDuctwork',
  'WaterPipework': 'WaterPipework',
  'WetEmitter': 'WetEmitter',
  'Appliance': 'Appliance',
  'HotWaterDemand': 'HotWaterDemand',
  'ContextShading': 'ContextShading',
  'Vents': 'Vents',
  'CombustionAppliances': 'CombustionAppliances',
  'OnSiteGeneration': 'OnSiteGeneration',
  'ElectricBattery': 'ElectricBattery',
  'System': 'System',
};

function unwrapAdditionalProperties(node: unknown): SchemaNode | null {
  const schemaNode = asSchemaNode(node);
  if (!schemaNode) return null;
  return isSchemaNode(schemaNode.additionalProperties) ? schemaNode.additionalProperties : schemaNode;
}

function getDefsZoneDef(schema: SchemaNode): SchemaNode | undefined {
  return schema?.$defs?.['Zone'] || schema?.$defs?.['ZoneFHS'];
}

function getFhsZoneDef(schema: SchemaNode): SchemaNode | undefined {
  return schema?.properties?.['Zone'] || getDefsZoneDef(schema);
}

function getFhsZoneSchema(schema: SchemaNode): SchemaNode | null {
  return unwrapAdditionalProperties(getFhsZoneDef(schema));
}

function getFhsZonePropertySchema(schema: SchemaNode, key: string): SchemaNode | null {
  const prop = getFhsZoneSchema(schema)?.properties?.[key];
  return unwrapAdditionalProperties(prop);
}

function getFhsRootPropertySchema(schema: SchemaNode, key: string): SchemaNode | null {
  const prop = schema?.properties?.[key];
  return unwrapAdditionalProperties(prop);
}

function getFhsInfiltrationVentilationPropertySchema(schema: SchemaNode, key: string): SchemaNode | null {
  const prop = schema?.properties?.['InfiltrationVentilation']?.properties?.[key];
  return unwrapAdditionalProperties(prop);
}

function resolveFhsBuildingElementBaseSchema(schema: SchemaNode): SchemaNode | null {
  return getFhsZonePropertySchema(schema, 'BuildingElement');
}

function resolveFhsMechanicalVentilationBaseSchema(schema: SchemaNode, schemaKey: string): SchemaNode | null {
  let baseSchema = getFhsInfiltrationVentilationPropertySchema(schema, 'MechanicalVentilation');
  if (!baseSchema) {
    baseSchema = getFhsRootPropertySchema(schema, 'MechanicalVentilation');
  }
  if (!baseSchema) {
    const fhsSchema = schema?.$defs?.['MechanicalVentilationFHS'];
    if (fhsSchema && fhsSchema.properties) {
      baseSchema = fhsSchema;
    } else {
      baseSchema = schema.$defs?.[schemaKey] ?? null;
    }
  }
  return baseSchema;
}

/**
 * FHS `MechanicalVentilationDuctwork` does not exist as a standalone schema node.
 * Ductwork fields are declared as `MechanicalVentilation` (MVHR branch) → `ductwork.items`.
 */
function extractFhsMvhrDuctworkItemSchema(schema: SchemaNode): SchemaNode | null {
  const mvBase = resolveFhsMechanicalVentilationBaseSchema(schema, 'MechanicalVentilation');
  const allOf = mvBase?.allOf;
  if (!Array.isArray(allOf)) return null;
  for (const block of allOf) {
    if (block?.if?.properties?.vent_type?.const !== 'MVHR') continue;
    const item = block?.then?.properties?.ductwork?.items;
    if (item && typeof item === 'object') return item;
  }
  return null;
}

/** FHS primary water pipework is nested under HotWaterSource storage-tank variants. */
function extractFhsPrimaryWaterPipeworkItemSchema(schema: SchemaNode): SchemaNode | null {
  const itemSchema = schema?.$defs?.Tank?.properties?.primary_pipework?.items
    ?? schema?.properties?.HotWaterSource?.properties?.['hw cylinder']?.properties?.primary_pipework?.items;
  if (!itemSchema || typeof itemSchema !== 'object') return null;
  return itemSchema;
}

function resolveFhsThermalBridgingBaseSchema(schema: SchemaNode, schemaKey: string): SchemaNode | null {
  const zoneSchema = getFhsZonePropertySchema(schema, 'ThermalBridging');
  if (zoneSchema) return zoneSchema;
  return schema.$defs?.[schemaKey] ?? null;
}

function resolveFhsElectricBatteryBaseSchema(schema: SchemaNode): SchemaNode | null {
  // FHS defines ElectricBattery under ElectricityFuelProperties and applies it via EnergySupply.
  const batterySchema = schema?.$defs?.['ElectricityFuelProperties']?.properties?.['ElectricBattery'];
  if (batterySchema && typeof batterySchema === 'object') {
    return unwrapAdditionalProperties(batterySchema);
  }
  return null;
}

function getCoreBuildingElementContainerSchema(schema: SchemaNode): SchemaNode | null {
  const zoneDef = getDefsZoneDef(schema);
  const buildingElementProp = zoneDef?.properties?.BuildingElement;
  return isSchemaNode(buildingElementProp?.additionalProperties)
    ? buildingElementProp.additionalProperties
    : null;
}

function resolveCoreMechanicalVentilationBaseSchema(schema: SchemaNode, schemaKey: string): SchemaNode | null {
  const mechVentProp = schema?.properties?.['InfiltrationVentilation']?.properties?.['MechanicalVentilation'];
  if (mechVentProp?.anyOf && Array.isArray(mechVentProp.anyOf)) {
    const anyOfEntry = mechVentProp.anyOf.find((entry) => isSchemaNode(entry.additionalProperties));
    const additionalProperties = isSchemaNode(anyOfEntry?.additionalProperties)
      ? anyOfEntry.additionalProperties
      : null;
    if (additionalProperties?.$ref) {
      return resolveRefNode(schema, additionalProperties);
    }
    if (additionalProperties) {
      return additionalProperties;
    }
  } else if (isSchemaNode(mechVentProp?.additionalProperties)) {
    if (mechVentProp.additionalProperties.$ref) {
      return resolveRefNode(schema, mechVentProp.additionalProperties);
    }
    return mechVentProp.additionalProperties;
  } else if (mechVentProp) {
    return mechVentProp;
  }

  const fhsSchema = schema?.$defs?.['MechanicalVentilationFHS'];
  if (fhsSchema && fhsSchema.properties) {
    return fhsSchema;
  }
  return schema.$defs?.[schemaKey] ?? null;
}

function getCoreThermalBridgingZoneSchema(schema: SchemaNode): SchemaNode | undefined {
  return getDefsZoneDef(schema)?.properties?.ThermalBridging;
}

function resolveSchemaFromMappingEntry(schema: SchemaNode, variantRef: unknown): SchemaNode | null {
  if (!variantRef) return null;
  if (typeof variantRef === 'string') {
    return resolveRefNode(schema, { $ref: variantRef });
  }
  if (isSchemaNode(variantRef)) {
    return variantRef;
  }
  return null;
}

function matchesSchemaOptionByElementType(resolved: SchemaNode | null | undefined, option: SchemaNode | null | undefined, elementType: string): boolean {
  const title = resolved?.title || option?.title;
  const typeEnum = resolved?.properties?.type?.enum || option?.properties?.type?.enum;
  const typeConst = resolved?.properties?.type?.const || option?.properties?.type?.const;
  return title === elementType || (typeEnum && typeEnum.includes(elementType)) || typeConst === elementType;
}

/** `SpaceHeatSystem` map values: `additionalProperties` with `allOf` discriminated by `type`. */
function getFhsSpaceHeatSystemEntrySchema(schema: SchemaNode): SchemaNode | null {
  const node = schema?.properties?.SpaceHeatSystem;
  const ap = node?.additionalProperties;
  return ap && typeof ap === 'object' ? ap : null;
}

/**
 * FHS `emitters[].` item schema lives under `SpaceHeatSystem` → `WetDistribution` → `emitters.items`
 * (not `$defs.WetEmitter`).
 */
function extractFhsWetDistributionEmittersItemSchema(schema: SchemaNode): SchemaNode | null {
  const entry = getFhsSpaceHeatSystemEntrySchema(schema);
  const allOf = entry?.allOf;
  if (!Array.isArray(allOf)) return null;
  for (const block of allOf) {
    if (block?.if?.properties?.type?.const !== 'WetDistribution') continue;
    const items = block?.then?.properties?.emitters?.items;
    if (items && typeof items === 'object' && items.properties && typeof items.properties === 'object') {
      return items;
    }
  }
  return null;
}

function mergeThenPropertiesRecursive(thenBlock: SchemaNode | null | undefined): Record<string, SchemaNode> {
  if (!thenBlock) return {};
  const out: Record<string, SchemaNode> = { ...(thenBlock.properties || {}) };
  if (thenBlock.then) Object.assign(out, mergeThenPropertiesRecursive(thenBlock.then));
  if (thenBlock.else) Object.assign(out, mergeThenPropertiesRecursive(thenBlock.else));
  return out;
}

/**
 * Flatten `emitters.items` for JsonForms: merge `allOf` branches whose `if` fixes `wet_emitter_type`
 * to the geometry `subcategory` (radiator | ufh | fancoil). Nested if/then/else under `then` (e.g. the
 * radiator per-metre `length`+`c_per_m` vs lumped `c` branch) becomes a union of property *shapes*, but
 * its `required` is intentionally NOT unioned: requiring both `c_per_m` and `c` would flag the inactive
 * branch (a lumped radiator with `c` would be told "c_per_m required"). The nested conditional is
 * returned so the resolved subschema keeps it in `allOf`, where `getConditionalRequiredFieldsForMode`
 * evaluates the active branch from the data (mirrors the MEV position / PartyWall cavity pattern).
 */
function mergeFhsWetEmitterItemPropertiesForSubtype(
  items: SchemaNode,
  subtype: string | undefined,
): { properties: Record<string, SchemaNode>; required: string[]; conditional: SchemaNode | null } {
  const mergedProps: Record<string, SchemaNode> = { ...(items.properties || {}) };
  let mergedReq: string[] = Array.isArray(items.required) ? [...items.required] : [];
  let conditional: SchemaNode | null = null;
  const st = typeof subtype === 'string' && subtype.trim().length > 0 ? subtype.trim() : undefined;

  if (st && Array.isArray(items.allOf)) {
    for (const block of items.allOf) {
      const wetConst = block?.if?.properties?.wet_emitter_type?.const;
      if (wetConst !== st) continue;
      const thenB = block.then;
      if (!thenB) continue;
      Object.assign(mergedProps, mergeThenPropertiesRecursive(thenB));
      // Only the unconditional required (e.g. radiator `n`); branch-specific required stays conditional.
      mergedReq.push(...schemaStringArray(thenB.required));
      if (thenB.if && (thenB.then || thenB.else)) {
        conditional = { if: thenB.if, then: thenB.then, else: thenB.else };
      }
    }
  }

  mergedReq = Array.from(new Set(mergedReq));
  return { properties: mergedProps, required: mergedReq, conditional };
}

/** Advanced Fields + validation for geometry `WetEmitter` rows (FHS emitter item keys in `extra_json`). */
function resolveFhsWetEmitterItemSubschema(schema: SchemaNode, subtype?: string): SchemaNode | null {
  const items = extractFhsWetDistributionEmittersItemSchema(schema);
  if (!items) return null;
  const { properties, required, conditional } = mergeFhsWetEmitterItemPropertiesForSubtype(items, subtype);
  return {
    type: 'object',
    properties,
    required,
    $defs: schema.$defs || {},
    allOf: conditional ? [conditional] : [],
    additionalProperties: true,
  };
}

// FHS subschema resolution (mirrors getSubschemaForElementType but uses FHS schema)
function resolveFhsElementSubschemaFromRoot(schema: SchemaNode | null, elementType: string, subtype?: string): SchemaNode | null {
  if (!schema || (!schema.$defs && !schema.properties)) {
    return null;
  }

  // Geometry `WetEmitter` ↔ FHS `SpaceHeatSystem` → `WetDistribution` → `emitters[]` item (no standalone WetEmitter def).
  if (elementType === 'WetEmitter') {
    const wet = resolveFhsWetEmitterItemSubschema(schema, subtype);
    if (wet) return wet;
  }

  // Geometry `MechanicalVentilationDuctwork` rows store one MVHR `ductwork.items` entry in `extra_json`.
  if (elementType === 'MechanicalVentilationDuctwork') {
    const item = extractFhsMvhrDuctworkItemSchema(schema);
    if (!item || !item.properties || typeof item.properties !== 'object') return null;
    return {
      type: 'object',
      properties: item.properties,
      required: Array.isArray(item.required) ? item.required : [],
      $defs: schema.$defs || {},
      allOf: Array.isArray(item.allOf) ? item.allOf : [],
    };
  }

  // Geometry `WaterPipework` rows author FHS `HotWaterSource.<source>.primary_pipework[]` entries.
  if (elementType === 'WaterPipework') {
    const item = extractFhsPrimaryWaterPipeworkItemSchema(schema);
    if (!item || !item.properties || typeof item.properties !== 'object') return null;
    return {
      type: 'object',
      properties: item.properties,
      required: Array.isArray(item.required) ? item.required : [],
      $defs: schema.$defs || {},
      allOf: Array.isArray(item.allOf) ? item.allOf : [],
    };
  }

  // Geometry `System` rows merge `extra_json` shaped like `{ HeatSourceWet: { … } }` (etc.).
  // In published roots these maps live under **root `properties`** (e.g. `properties.HeatSourceWet`),
  // not `$defs[subtype]` — resolve either so Advanced Fields and evidence pickers work.
  if (elementType === 'System' && subtype) {
    const inner = schema.$defs?.[subtype] ?? schema.properties?.[subtype];
    if (inner && typeof inner === 'object') {
      return {
        type: 'object',
        properties: {
          [subtype]: inner,
        },
        $defs: schema.$defs || {},
      };
    }
    return null;
  }

  const schemaKey = ELEMENT_TYPE_TO_SCHEMA_KEY[elementType];

  // Special handling for BuildingElement - it's not in $defs, it's a property in Zone
  let baseSchema: SchemaNode | null = null;
  if (schemaKey === 'BuildingElement') {
    // In FHS schema, Zone is a root-level property with additionalProperties
    // Structure: schema.properties.Zone.additionalProperties.properties.BuildingElement.additionalProperties
    baseSchema = resolveFhsBuildingElementBaseSchema(schema);
  } else if (schemaKey) {
    // For FHS schema, prefer FHS variants (e.g., MechanicalVentilationFHS)
    if (elementType === 'MechanicalVentilation') {
      baseSchema = resolveFhsMechanicalVentilationBaseSchema(schema, schemaKey);
    } else if (schemaKey === 'Vents' || schemaKey === 'CombustionAppliances') {
      // Vents and CombustionAppliances are in InfiltrationVentilation.properties
      baseSchema = getFhsInfiltrationVentilationPropertySchema(schema, schemaKey);
    } else if (schemaKey === 'ThermalBridgingDetails') {
      baseSchema = resolveFhsThermalBridgingBaseSchema(schema, schemaKey);
    } else {
      // Try $defs first (for Core schema compatibility and FHS schema $defs)
      baseSchema = schema.$defs?.[schemaKey] ?? null;
    }

    // Fallback: some element types are defined as root-level sections (e.g., OnSiteGeneration, ElectricBattery)
    if (!baseSchema) {
      baseSchema = getFhsRootPropertySchema(schema, schemaKey);
    }

    // FHS ElectricBattery fields are currently declared via ElectricityFuelProperties.
    if (!baseSchema && elementType === 'ElectricBattery') {
      baseSchema = resolveFhsElectricBatteryBaseSchema(schema);
    }

    // Additional fallback: some elements are in Zone.properties (e.g., Lighting, WindowShading, etc.)
    if (!baseSchema) {
      baseSchema = getFhsZonePropertySchema(schema, schemaKey);
    }

    // Special case: Appliance maps to Appliances in FHS schema
    if (!baseSchema && elementType === 'Appliance') {
      baseSchema = getFhsRootPropertySchema(schema, 'Appliances');
    }
  }

  if (!baseSchema) {
    return null;
  }

  if (schemaKey === 'ThermalBridgingDetails' && baseSchema?.properties) {
    const mergedProps: Record<string, SchemaNode> = { ...baseSchema.properties };
    let mergedRequired: string[] = Array.isArray(baseSchema.required) ? [...baseSchema.required] : [];
    mergeAllOfThenPropertiesByType(mergedProps, mergedRequired, baseSchema.allOf, elementType);
    mergedRequired = Array.from(new Set(mergedRequired));
    return {
      type: 'object',
      properties: mergedProps,
      required: mergedRequired,
      $defs: schema.$defs || {},
      allOf: Array.isArray(baseSchema.allOf) ? baseSchema.allOf : [],
    };
  }

  // Special handling for MechanicalVentilation in FHS schema: merge conditional properties based on vent_type subtype.
  // In input_fhs.schema.json, MVHR-specific fields are provided via allOf/if/then blocks.
  if (elementType === 'MechanicalVentilation' && baseSchema?.properties) {
    const mergedProps: Record<string, SchemaNode> = { ...baseSchema.properties };
    let mergedRequired: string[] = Array.isArray(baseSchema.required) ? [...baseSchema.required] : [];
    mergeMechanicalVentilationAllOfBySubtype(mergedProps, mergedRequired, baseSchema.allOf, subtype, 'overwrite');
    mergeMechanicalVentilationNonMvhrPositionBranch(mergedProps, baseSchema.allOf, subtype);
    mergedRequired = Array.from(new Set(mergedRequired));
    return {
      type: 'object',
      properties: mergedProps,
      required: mergedRequired,
      $defs: schema.$defs || schema.properties || {},
      allOf: Array.isArray(baseSchema.allOf) ? baseSchema.allOf : []
    };
  }

  // Handle BuildingElement in FHS schema
  // FHS schema structure: BuildingElement.additionalProperties has allOf with if/then blocks (not discriminator)
  // Each if/then block checks type === "BuildingElementOpaque" etc. and adds conditional properties
  if (schemaKey === 'BuildingElement') {
    if (baseSchema && baseSchema.properties) {
      // Start with base properties
      const mergedProps: Record<string, SchemaNode> = { ...baseSchema.properties };
      let mergedRequired: string[] = Array.isArray(baseSchema.required) ? [...baseSchema.required] : [];

      // Merge conditional properties from allOf blocks based on element type
      const allOf = baseSchema.allOf;
      if (elementType && Array.isArray(allOf)) {
        for (const block of allOf) {
          const ifCond = block?.if;
          if (!ifCond || !fhsBuildingElementAllOfTypeMatches(ifCond, elementType) || !block.then) continue;

          const thenProps = block.then.properties;
          const thenReq = block.then.required;
          if (thenProps && typeof thenProps === 'object') {
            Object.assign(mergedProps, thenProps);
          }
          if (Array.isArray(thenReq)) {
            mergedRequired.push(...thenReq);
          }

          if (elementType === 'BuildingElementGround') {
            mergeFhsGroundNestedFloorTypeAllOf(mergedProps, mergedRequired, block.then, subtype);
          }
          if (elementType === 'BuildingElementPartyWall') {
            mergeFhsPartyWallNestedAllOf(mergedProps, block.then);
          }
        }
      }

      // De-dupe required
      mergedRequired = Array.from(new Set(mergedRequired));

      return {
        type: 'object',
        properties: mergedProps,
        required: mergedRequired,
        $defs: schema.$defs || schema.properties || {},
        // Preserve raw `allOf` so `getFHSConditionalRequiredFields` can evaluate nested if/then
        // (e.g. BuildingElementGround → floor_type variants) while Advanced Fields still strip it for JsonForms.
        allOf: Array.isArray(baseSchema.allOf) ? baseSchema.allOf : [],
      };
    }

    // Fallback: return baseSchema with properties if available
    return {
      type: 'object',
      properties: (baseSchema && baseSchema.properties) ? baseSchema.properties : {},
      required: (baseSchema && baseSchema.required) ? baseSchema.required : [],
      $defs: schema.$defs || schema.properties || {},
      allOf: Array.isArray(baseSchema?.allOf) ? baseSchema.allOf : [],
    };
  }

  // Handle BuildingElement which is a oneOf union (Core schema pattern, fallback)
  if (baseSchema.oneOf) {
    const floorTypeToVariant: Record<string, string> = {
      'Suspended_floor': 'BuildingElementGroundSuspendedFloor',
      'Heated_basement': 'BuildingElementGroundHeatedBasement',
      'Unheated_basement': 'BuildingElementGroundUnheatedBasement',
      'Slab_edge_insulation': 'BuildingElementGroundSlabEdgeInsulation',
      'Slab_no_edge_insulation': 'BuildingElementGroundSlabNoEdgeInsulation'
    };

    const resolveRef = (ref: unknown): SchemaNode | null => {
      return resolveRefNode(schema, ref);
    };

    let specificSchema: SchemaNode | null = null;
    for (let i = 0; i < baseSchema.oneOf.length; i++) {
      const item = baseSchema.oneOf[i];

      // Check for discriminator with floor_type (for BuildingElementGround)
      if (item.discriminator && item.discriminator.propertyName === 'floor_type') {
        if (elementType === 'BuildingElementGround' && subtype) {
          const mapping = item.discriminator.mapping || {};
          const variantRef = mapping[subtype];
          if (variantRef) {
            const refName = variantRef.replace('#/$defs/', '');
            specificSchema = schema.$defs?.[refName] ?? null;
            if (specificSchema) break;
          }
        }
        continue;
      }

      const resolved = resolveRef(item);
      if (resolved && resolved.title) {
        if (elementType === 'BuildingElementGround' && subtype) {
          const expectedVariant = floorTypeToVariant[subtype];
          if (expectedVariant && resolved.title === expectedVariant) {
            specificSchema = resolved;
            break;
          }
        } else if (resolved.title === elementType || resolved.title.startsWith(elementType)) {
          specificSchema = resolved;
          break;
        }
      }
    }

    if (!specificSchema && elementType === 'BuildingElementGround') {
      // Fallback: use first BuildingElementGround variant
      for (const item of baseSchema.oneOf) {
        if (item.discriminator && item.discriminator.propertyName === 'floor_type') {
          const mapping = item.discriminator.mapping || {};
          const firstVariantRef = Object.values(mapping)[0] as string;
          if (firstVariantRef) {
            const refName = firstVariantRef.replace('#/$defs/', '');
            specificSchema = schema.$defs?.[refName] ?? null;
            break;
          }
        }
      }
    }

    if (specificSchema) {
      return {
        type: 'object',
        properties: specificSchema.properties || {},
        required: specificSchema.required || [],
        $defs: schema.$defs,
        // Include allOf for conditional requirements
        allOf: specificSchema.allOf || []
      };
    }
  }

  // For other schemas (including BuildingElement with anyOf), return with allOf for conditional requirements
  // In FHS schema, BuildingElement has allOf at the additionalProperties level
  return {
    type: 'object',
    properties: baseSchema.properties || {},
    required: baseSchema.required || [],
    $defs: schema.$defs,
    allOf: baseSchema.allOf || [] // Include allOf for conditional requirements (e.g., Suspended_floor)
  };
}

export function getFHSSubschemaForElementType(elementType: string, subtype?: string): SchemaNode | null {
  return resolveFhsElementSubschemaFromRoot(getFHSSchemaObject(), elementType, subtype);
}

// Helper to parse schema conditional requirements.
//
// Walks the subschema's `allOf` array and recursively evaluates `if/then/else`, nested `allOf`,
// and `then.oneOf` (alternative required-sets) to produce a flat list of fields the UI should
// surface as required.
//
// `oneOf` semantics: schema requires exactly one branch to be satisfied. If any branch's
// `required` fields are all already present on the element, no hint is produced. Otherwise the
// first branch's `required` is surfaced as a canonical "fill these to satisfy the schema" hint.
// (Strict XOR enforcement, e.g. `not: { required: [SFP] }`, is left to AJV at save time.)
export function getConditionalRequiredFieldsForMode(
  useFHSSchema: boolean,
  elementType: string,
  elementData: Record<string, unknown> | null | undefined,
  subtype?: string
): string[] {
  const subschema = getElementSubschemaForMode(useFHSSchema, elementType, subtype);
  if (!subschema || !subschema.allOf || !Array.isArray(subschema.allOf)) {
    return [];
  }

  // Some discriminator fields (e.g. `party_wall_cavity_type`) live in `extra_json` rather than at the
  // top of the element. Fall back to `extra_json` so schema if/then conditions still evaluate.
  const readConditionValue = (propKey: string): unknown => {
    const top = elementData?.[propKey];
    if (top !== undefined) return top;
    const extraJson = isRecord(elementData?.extra_json) ? elementData.extra_json : null;
    return extraJson?.[propKey];
  };

  const fieldHasValue = (field: string): boolean => {
    const v = readConditionValue(field);
    return v !== undefined && v !== null && v !== '';
  };

  const conditionMatches = (condition: SchemaNode | null | undefined): boolean => {
    if (!condition) return false;
    // `if: { required: [...] }` (e.g. radiator per-metre branch keyed on `length`): the condition
    // holds when every listed field is present, matching JSON Schema `required` semantics.
    if (Array.isArray(condition.required)) {
      if (!condition.required.every(fieldHasValue)) return false;
      if (!condition.properties) return true;
    }
    if (condition.properties && typeof condition.properties === 'object') {
      for (const [propKey, propValue] of Object.entries(condition.properties)) {
        if (propValue && 'const' in propValue) {
          if (readConditionValue(propKey) === propValue.const) return true;
        }
      }
    }
    if (Array.isArray(condition.anyOf)) {
      for (const option of condition.anyOf) {
        if (conditionMatches(option)) return true;
      }
    }
    if (Array.isArray(condition.oneOf)) {
      for (const option of condition.oneOf) {
        if (conditionMatches(option)) return true;
      }
    }
    return false;
  };

  const conditionalRequired: string[] = [];

  // Recursively collect required fields from a `then` or `else` block (or any schema fragment with
  // `required`/`allOf`/`oneOf`).
  const applyBlock = (block: SchemaNode | null | undefined): void => {
    if (!block) return;

    if (Array.isArray(block.required)) {
      conditionalRequired.push(...block.required);
    }

    if (Array.isArray(block.allOf)) {
      for (const nested of block.allOf) {
        if (!nested?.if) {
          // No `if` — `allOf` member just contributes its own `required` / nested structure.
          applyBlock(nested);
          continue;
        }
        if (conditionMatches(nested.if)) {
          applyBlock(nested.then);
        } else {
          applyBlock(nested.else);
        }
      }
    }

    if (Array.isArray(block.oneOf) && block.oneOf.length > 0) {
      const anySatisfied = block.oneOf.some((branch) =>
        branch && Array.isArray(branch.required) && branch.required.every(fieldHasValue)
      );
      if (!anySatisfied) {
        const first = block.oneOf[0];
        if (first && Array.isArray(first.required)) {
          conditionalRequired.push(...first.required);
        }
      }
    }
  };

  for (const block of subschema.allOf) {
    if (!block || !block.if) continue;
    if (conditionMatches(block.if)) {
      applyBlock(block.then);
    } else {
      applyBlock(block.else);
    }
  }

  return conditionalRequired;
}

// Backwards-compatible FHS wrapper for existing callers.
export function getFHSConditionalRequiredFields(
  elementType: string,
  elementData: Record<string, unknown> | null | undefined,
  subtype?: string
): string[] {
  return getConditionalRequiredFieldsForMode(true, elementType, elementData, subtype);
}

// Test-only helpers to inject schema without fetch
export function __setSchemaObjectForTests(obj: SchemaNode | null): void {
  schemaObj = obj;
  try { strictestIntegerKeysCache.clear(); } catch { /* swallow: best-effort */ }
  compiledPropValidatorCore = new WeakMap();
}
export function __resetSchemaCacheForTests(): void {
  schemaText = null;
  schemaObj = null;
  preloadCoreSchemaPromise = null;
  try { strictestIntegerKeysCache.clear(); } catch { /* swallow: best-effort */ }
  compiledPropValidatorCore = new WeakMap();
}

// Advanced fields utilities
function resolveCoreElementSubschemaFromRoot(schema: SchemaNode | null, elementType: string, subtype?: string): SchemaNode | null {
  if (!schema || !schema.$defs) {
    return null;
  }

  // See resolveFhsElementSubschemaFromRoot: System `extra_json` follows HeatSourceWet / HotWaterSource / SpaceCoolSystem.
  if (elementType === 'System' && subtype) {
    const inner = schema.$defs?.[subtype] ?? schema.properties?.[subtype];
    if (inner && typeof inner === 'object') {
      return {
        type: 'object',
        properties: {
          [subtype]: inner,
        },
        $defs: schema.$defs || {},
      };
    }
    return null;
  }

  if (elementType === 'WetEmitter') {
    const fromShs = resolveFhsWetEmitterItemSubschema(schema, subtype);
    if (fromShs) return fromShs;
  }

  const resolveGroundSubtypeSchema = (candidate: SchemaNode | null): SchemaNode | null => {
    if (elementType !== 'BuildingElementGround' || !subtype || !candidate?.oneOf || !Array.isArray(candidate.oneOf)) {
      return candidate;
    }

    const floorTypeToVariant: Record<string, string> = {
      'Suspended_floor': 'BuildingElementGroundSuspendedFloor',
      'Heated_basement': 'BuildingElementGroundHeatedBasement',
      'Unheated_basement': 'BuildingElementGroundUnheatedBasement',
      'Slab_edge_insulation': 'BuildingElementGroundSlabEdgeInsulation',
      'Slab_no_edge_insulation': 'BuildingElementGroundSlabNoEdgeInsulation',
    };

    const resolveRef = (ref: unknown): SchemaNode | null => {
      return resolveRefNode(schema, ref);
    };

    for (const item of candidate.oneOf) {
      if (item?.discriminator?.propertyName === 'floor_type') {
        const mapping = item.discriminator.mapping || {};
        const variantRef = mapping[subtype];
        if (typeof variantRef === 'string') {
          const refName = variantRef.replace('#/$defs/', '');
          return schema.$defs?.[refName] || candidate;
        }
      }

      const resolved = resolveRef(item);
      const expectedVariant = floorTypeToVariant[subtype];
      if (resolved?.title && expectedVariant && resolved.title === expectedVariant) {
        return resolved;
      }
    }

    return candidate;
  };

  const schemaKey = ELEMENT_TYPE_TO_SCHEMA_KEY[elementType];

  // Special handling for BuildingElement - it's not in $defs, it's a property in Zone/ZoneFHS
  let baseSchema: SchemaNode | null = null;
  if (schemaKey === 'BuildingElement') {
    // Try to find BuildingElement in Zone or ZoneFHS properties
    const buildingElementAdditionalProps = getCoreBuildingElementContainerSchema(schema);
    if (buildingElementAdditionalProps) {
      // BuildingElement is defined as additionalProperties with oneOf or anyOf
      baseSchema = buildingElementAdditionalProps;

        // Check if it's an anyOf with discriminator (FHS pattern in Core schema too)
      if (baseSchema.anyOf && Array.isArray(baseSchema.anyOf)) {
        for (const branch of baseSchema.anyOf) {
          if (isSchemaNode(branch.additionalProperties) && branch.additionalProperties.discriminator) {
            const discriminator = branch.additionalProperties.discriminator;

            if (discriminator.propertyName === 'type') {
              const mapping = discriminator.mapping || {};
              const variantRef = mapping[elementType];

              if (variantRef) {
                const specificSchema = resolveGroundSubtypeSchema(
                  resolveSchemaFromMappingEntry(schema, variantRef),
                );

                if (specificSchema && specificSchema.properties) {
                  return {
                    type: 'object',
                    properties: specificSchema.properties,
                    required: specificSchema.required || [],
                    $defs: schema.$defs
                  };
                }
              }
            }
          }
        }
      }
    }
  } else if (schemaKey) {
    // Special handling for MechanicalVentilation - check InfiltrationVentilation.properties path
    if (elementType === 'MechanicalVentilation') {
      baseSchema = resolveCoreMechanicalVentilationBaseSchema(schema, schemaKey);
    } else {
      // For other element types, prefer $defs entry when available
      baseSchema = schema.$defs[schemaKey];
    }

    // Fallback: some element types (e.g. OnSiteGeneration) are defined as
    // root-level sections rather than $defs entries.
    if (!baseSchema && schema.properties && schema.properties[schemaKey]) {
      baseSchema = schema.properties[schemaKey];
    }
  }

  // Special handling for ThermalBridgingDetails - it can be:
  // 1. A $defs entry with oneOf (input.schema.json)
  // 2. A property in Zone with anyOf -> additionalProperties -> discriminator (legacy bundled schema shape)
  // This MUST be checked BEFORE the baseSchema null check, because ThermalBridgingDetails
  // might not exist in $defs but exists in Zone properties
  if (schemaKey === 'ThermalBridgingDetails') {
    // Case 1: Check if it's in Zone properties (FHS schema)
    const thermalBridgingProp = getCoreThermalBridgingZoneSchema(schema);

    if (thermalBridgingProp) {
      // Check if it's an anyOf with additionalProperties
      if (thermalBridgingProp.anyOf && Array.isArray(thermalBridgingProp.anyOf)) {
        for (const branch of thermalBridgingProp.anyOf) {
          if (isSchemaNode(branch.additionalProperties) && branch.additionalProperties.discriminator) {
            const discriminator = branch.additionalProperties.discriminator;

            if (discriminator.propertyName === 'type') {
              const mapping = discriminator.mapping || {};
              const variantRef = mapping[elementType];

              if (variantRef) {
                const specificSchema = resolveSchemaFromMappingEntry(schema, variantRef);

                if (specificSchema && specificSchema.properties) {
                  return {
                    type: 'object',
                    properties: specificSchema.properties,
                    required: specificSchema.required || [],
                    $defs: schema.$defs
                  };
                }
              }
            }
          }
        }
      }
    }

    // Case 2: Check if baseSchema has oneOf (non-FHS schema)
    if (baseSchema && baseSchema.oneOf && Array.isArray(baseSchema.oneOf)) {
      const resolveRef = (ref: unknown): SchemaNode | null => {
        return resolveRefNode(schema, ref);
      };

      for (const option of baseSchema.oneOf) {
        const resolved = resolveRef(option);
        if (matchesSchemaOptionByElementType(resolved, option, elementType)) {
          const props = resolved?.properties || option?.properties;
          if (props) {
            return {
              type: 'object',
              properties: props,
              required: resolved?.required || option?.required || [],
              $defs: schema.$defs
            };
          }
        }
      }

      // Debug: log if we couldn't find a match for BuildingElement types
      // (avoid relying on schemaKey's narrowed type in this block)
      if (elementType && elementType.startsWith('BuildingElement')) {
        console.warn(`[schemaCache] Could not find oneOf match for ${elementType}`, {
          oneOfCount: baseSchema.oneOf.length,
          oneOfTitles: baseSchema.oneOf.map((o) => {
            const r = resolveRef(o);
            return r?.title || o?.title || r?.properties?.type?.const || o?.properties?.type?.const || 'unknown';
          }).slice(0, 5)
        });
      }
    }

    // If we couldn't resolve it through either case, return null
    return null;
  }

  // Now check if baseSchema exists (for all other element types)
  if (!baseSchema) {
    return null;
  }

  // Special handling for MechanicalVentilation - merge conditional properties from allOf blocks
  // This works for both Core and FHS schemas, making Advanced Fields show all relevant fields
  if (elementType === 'MechanicalVentilation' && baseSchema) {
    if (baseSchema.properties) {
      const mergedProps: Record<string, SchemaNode> = { ...baseSchema.properties };
      let mergedRequired: string[] = Array.isArray(baseSchema.required) ? [...baseSchema.required] : [];

      mergeMechanicalVentilationAllOfBySubtype(mergedProps, mergedRequired, baseSchema.allOf, subtype, 'overwrite');

      // If subtype is provided and Core schema doesn't have allOf, also merge FHS conditional properties
      // This ensures Advanced Fields show all possible fields (Core base + FHS conditionals)
      // This is schema-driven and flexible - no hardcoding of vent_type values
      if (subtype && (!baseSchema.allOf || !Array.isArray(baseSchema.allOf) || baseSchema.allOf.length === 0)) {
        try {
          const fhsSchema = getFHSSchemaObject();
          if (fhsSchema) {
            // Find MechanicalVentilation in FHS schema
            // FHS schema structure: properties.InfiltrationVentilation.properties.MechanicalVentilation.additionalProperties
            const fhsMvProp = fhsSchema.properties?.['InfiltrationVentilation']?.properties?.['MechanicalVentilation'];
            const fhsMvSchema = isSchemaNode(fhsMvProp?.additionalProperties)
              ? fhsMvProp.additionalProperties
              : fhsMvProp;
            if (fhsMvSchema?.allOf && Array.isArray(fhsMvSchema.allOf)) {
              mergeMechanicalVentilationAllOfBySubtype(
                mergedProps,
                mergedRequired,
                fhsMvSchema.allOf,
                subtype,
                'fillMissing',
              );
            } else {
              // Debug: log if FHS schema structure is unexpected
              console.warn(`[schemaCache] FHS MechanicalVentilation schema missing allOf blocks`, {
                hasFhsMvProp: !!fhsMvProp,
                hasFhsMvSchema: !!fhsMvSchema,
                hasAllOf: !!fhsMvSchema?.allOf,
                allOfLength: Array.isArray(fhsMvSchema?.allOf) ? fhsMvSchema.allOf.length : 0
              });
            }
          } else {
            // Debug: log if FHS schema isn't loaded
            console.warn(`[schemaCache] FHS schema not loaded when merging MechanicalVentilation properties for subtype: ${subtype}`);
          }
        } catch (e) {
          // If FHS schema isn't loaded or accessible, continue with Core schema only
          console.warn(`[schemaCache] Error merging FHS conditional properties for MechanicalVentilation:`, e);
        }
      }

      // De-dupe required
      mergedRequired = Array.from(new Set(mergedRequired));
      return {
        type: 'object',
        properties: mergedProps,
        required: mergedRequired,
        $defs: schema.$defs
      };
    }
  }

  // Special handling for OnSiteGeneration:
  // The root-level OnSiteGeneration schema is an anyOf wrapper whose first
  // branch is an object with additionalProperties -> oneOf -> $ref to
  // PhotovoltaicSystem. For Advanced Fields we want the *inner* PV schema
  // (PhotovoltaicSystem) so that JsonForms can see its properties directly.
  if (elementType === 'OnSiteGeneration') {
    try {
      // Example structure:
      // "OnSiteGeneration": {
      //   "anyOf": [
      //     {
      //       "type": "object",
      //       "additionalProperties": {
      //         "discriminator": { ... },
      //         "oneOf": [ { "$ref": "#/$defs/PhotovoltaicSystem" } ]
      //       }
      //     },
      //     { "type": "null" }
      //   ]
      // }
      const anyOf = baseSchema.anyOf;
      if (Array.isArray(anyOf) && anyOf.length > 0) {
        const firstBranch = anyOf[0];
        const additionalProps = firstBranch && firstBranch.additionalProperties;
        if (isSchemaNode(additionalProps) && Array.isArray(additionalProps.oneOf) && additionalProps.oneOf.length > 0) {
          const firstOption = additionalProps.oneOf[0];
          const ref = firstOption.$ref as string | undefined;
          if (ref && ref.startsWith('#/$defs/')) {
            const refName = ref.replace('#/$defs/', '');
            const pvSchema = schema.$defs[refName];
            if (pvSchema && pvSchema.properties) {
              return {
                type: 'object',
                properties: pvSchema.properties,
                required: pvSchema.required || [],
                $defs: schema.$defs
              };
            }
          }
        }
      }
      // If we can't resolve the inner PV schema, fall through to the
      // generic handling below so we don't break other behavior.
    } catch (e) {
      // Be defensive: any error here should not break the app; just
      // fall back to the generic path.
      console.warn('[schemaCache] Failed to resolve OnSiteGeneration subschema:', e);
    }
  }

  // Handle BuildingElement which is a oneOf union
  if (baseSchema.oneOf) {
    // Map element types to possible schema titles (handles FHS variants)
    const titleVariants: Record<string, string[]> = {
      'BuildingElementOpaque': ['BuildingElementOpaque', 'BuildingElementOpaqueFHS'],
      'BuildingElementTransparent': ['BuildingElementTransparent', 'BuildingElementTransparentFHS'],
      'BuildingElementGround': ['BuildingElementGround', 'BuildingElementGroundHeatedBasement', 'BuildingElementGroundSlabEdgeInsulation', 'BuildingElementGroundSlabNoEdgeInsulation', 'BuildingElementGroundSuspendedFloor', 'BuildingElementGroundUnheatedBasement'],
      'BuildingElementAdjacentConditionedSpace': ['BuildingElementAdjacentConditionedSpace'],
      'BuildingElementAdjacentUnconditionedSpace_Simple': ['BuildingElementAdjacentUnconditionedSpace_Simple'],
      'BuildingElementPartyWall': ['BuildingElementPartyWall']
    };

    // Map floor_type values to BuildingElementGround schema variant names
    const floorTypeToVariant: Record<string, string> = {
      'Suspended_floor': 'BuildingElementGroundSuspendedFloor',
      'Heated_basement': 'BuildingElementGroundHeatedBasement',
      'Unheated_basement': 'BuildingElementGroundUnheatedBasement',
      'Slab_edge_insulation': 'BuildingElementGroundSlabEdgeInsulation',
      'Slab_no_edge_insulation': 'BuildingElementGroundSlabNoEdgeInsulation'
    };

    // Helper to resolve $ref to actual schema definition
    const resolveRef = (ref: unknown): SchemaNode | null => {
      return resolveRefNode(schema, ref);
    };

    // Helper to check if a resolved schema matches the element type
    const matchesElementType = (resolved: SchemaNode | null): boolean => {
      if (!resolved) return false;
      const title = resolved.title;
      if (!title) return false;

      // For BuildingElementGround with subtype, match the specific variant
      if (elementType === 'BuildingElementGround' && subtype) {
        const expectedVariant = floorTypeToVariant[subtype];
        if (expectedVariant && title === expectedVariant) {
          return true;
        }
      }

      // Check exact match first
      if (title === elementType) return true;

      // Check against title variants
      const variants = titleVariants[elementType];
      if (variants && variants.includes(title)) return true;

      // For BuildingElementOpaque/Transparent, also check if title starts with elementType
      if (elementType === 'BuildingElementOpaque' && title.startsWith('BuildingElementOpaque')) return true;
      if (elementType === 'BuildingElementTransparent' && title.startsWith('BuildingElementTransparent')) return true;

      return false;
    };

    // Resolve all oneOf items and find the matching one
    let specificSchema: SchemaNode | null = null;
    for (let i = 0; i < baseSchema.oneOf.length; i++) {
      const item = baseSchema.oneOf[i];

      // Check if this item has a discriminator with floor_type (for BuildingElementGround)
      if (item.discriminator && item.discriminator.propertyName === 'floor_type') {
        // This is the BuildingElementGround discriminator - use the mapping directly
        if (elementType === 'BuildingElementGround' && subtype) {
          const mapping = item.discriminator.mapping || {};
          const variantRef = mapping[subtype];
          if (variantRef) {
            const refName = variantRef.replace('#/$defs/', '');
            specificSchema = schema.$defs[refName];
            if (specificSchema) break;
          }
        }
        continue; // Skip this discriminator item if we're not looking for BuildingElementGround
      }

      const resolved = resolveRef(item);
      if (matchesElementType(resolved)) {
        specificSchema = resolved;
        break;
      }
    }

    if (!specificSchema) {
      // For BuildingElementGround, if no subtype match, try to find any BuildingElementGround variant
      if (elementType === 'BuildingElementGround') {
        // Look for any BuildingElementGround variant in the discriminator
        for (const item of baseSchema.oneOf) {
          if (item.discriminator && item.discriminator.propertyName === 'floor_type') {
            const mapping = item.discriminator.mapping || {};
            // Use the first available variant as fallback
            const firstVariantRef = Object.values(mapping)[0] as string;
            if (firstVariantRef) {
              const refName = firstVariantRef.replace('#/$defs/', '');
              specificSchema = schema.$defs[refName];
              break;
            }
          }
        }
      }

      if (!specificSchema) {
        // Try to find any variant that matches the element type (without subtype)
        for (const item of baseSchema.oneOf) {
          const resolved = resolveRef(item);
          if (matchesElementType(resolved)) {
            specificSchema = resolved;
            break;
          }
        }
      }

      // Last resort: return null instead of using first option (which might be wrong type)
      if (!specificSchema) {
        return null;
      }
    }

    if (specificSchema) {
      // Create a minimal schema with $defs for reference resolution
      return {
        type: 'object',
        // Only expose the properties of the exact subtype; do not bleed in union-level props like 'Type'
        properties: specificSchema.properties || {},
        required: specificSchema.required || [],
        $defs: schema.$defs // Include all definitions for reference resolution
      };
    }
  }

  // Handle schemas with additionalProperties (like HeatSourceWet)
  if (isSchemaNode(baseSchema.additionalProperties) && !baseSchema.properties) {
    // For additionalProperties schemas, we need to resolve the referenced schema
    const additionalSchema = baseSchema.additionalProperties;
    let resolvedSchema: SchemaNode | null = additionalSchema;

    // If it's a $ref, resolve it
    if (additionalSchema.$ref) {
      const refName = additionalSchema.$ref.replace('#/$defs/', '');
      resolvedSchema = schema.$defs[refName];
    }

    // If the resolved schema is a oneOf, we need to handle it differently
    if (resolvedSchema && resolvedSchema.oneOf) {
      // For now, return the first option as a representative schema
      // In the future, we might want to handle this more sophisticatedly
      const firstOption = resolvedSchema.oneOf[0];
      if (firstOption && firstOption.properties) {
        return {
          type: 'object',
          properties: firstOption.properties,
          required: firstOption.required || [],
          $defs: schema.$defs
        };
      }
    }

    // Fallback: return the resolved schema if it has properties
    if (resolvedSchema && resolvedSchema.properties) {
      return {
        type: 'object',
        properties: resolvedSchema.properties,
        required: resolvedSchema.required || [],
        $defs: schema.$defs
      };
    }
  }

  // For other schemas, create a minimal schema with $defs
  // Ensure we always return an object with properties (even if empty)
  const result: SchemaNode = {
    type: 'object',
    properties: baseSchema.properties || {},
    required: baseSchema.required || [],
    $defs: schema.$defs || schema.properties || {} // Include all definitions for reference resolution
  };

  // Include allOf if it exists (for conditional requirements)
  if (baseSchema.allOf && Array.isArray(baseSchema.allOf)) {
    result.allOf = baseSchema.allOf;
  }

  return result;
}

export function getSubschemaForElementType(elementType: string, subtype?: string): SchemaNode | null {
  return resolveCoreElementSubschemaFromRoot(getSchemaObject(), elementType, subtype);
}

/** Resolve an element subschema from an already-selected published root (`input_core` vs `input_fhs`). */
export function resolveElementSubschemaForProfile(
  schemaRoot: SchemaNode | null,
  profile: 'core' | 'fhs',
  elementType: string,
  subtype?: string,
): SchemaNode | null {
  if (!schemaRoot) return null;
  return profile === 'fhs'
    ? resolveFhsElementSubschemaFromRoot(schemaRoot, elementType, subtype)
    : resolveCoreElementSubschemaFromRoot(schemaRoot, elementType, subtype);
}

// Removed getRequiredFieldsForSubtype and getMissingRequiredFields functions
// Advanced fields validation is now purely schema-driven via JsonForms

// Base fields that should NOT appear in advanced fields (already handled in standard UI)
export function getBaseFieldsForElementType(elementType: string): string[] {
  const baseFieldsMap: Record<string, string[]> = {
    'BuildingElementOpaque': [
      'width', 'height', 'area', 'pitch', 'orientation360', 'base_height',
      'is_unheated_pitched_roof', 'is_external_door', 'parent_element', 'Type', 'type'
    ],
    'BuildingElementTransparent': [
      'width', 'height', 'area', 'pitch', 'orientation360', 'base_height',
      'frame_area_fraction', 'free_area_height', 'mid_height', 'max_window_open_area', 'parent_element', 'Type', 'type'
    ],
    'BuildingElementGround': [
      'width', 'height', 'area', 'total_area', 'perimeter', 'floor_type',
      'depth_basement_floor', 'thickness_walls', 'parent_element', 'Type', 'type', 'pitch'
    ],
    'BuildingElementAdjacentConditionedSpace': [
      'width', 'height', 'area', 'pitch', 'parent_element', 'Type', 'type'
    ],
    'BuildingElementAdjacentUnconditionedSpace_Simple': [
      'width', 'height', 'area', 'pitch', 'parent_element', 'Type', 'type'
    ],
    'BuildingElementPartyWall': [
      'width',
      'height',
      'area',
      'pitch',
      'party_wall_cavity_type',
      'party_wall_lining_type',
      'thermal_resistance_cavity',
      'parent_element',
      'Type',
      'type'
    ],
    'ThermalBridgeLinear': [
      'length', 'linear_thermal_transmittance', 'parent_element', 'type'
    ],
    'ThermalBridgePoint': [
      'heat_transfer_coeff', 'parent_element', 'type'
    ],
    'WindowShading': [
      'shading_type', 'depth', 'width', 'height', 'parent_element'
    ],
    'Lighting': [
      'simplified_lighting', 'efficacy', 'count', 'power', 'bulbs'
    ],
    'MechanicalVentilationDuctwork': [
      'duct_type', 'length', 'parent_element'
    ],
    'WaterPipework': [
      'simplified_pipework', 'location', 'pipework_type', 'length'
    ],
    'WetEmitter': [
      'subcategory', 'unit_number', 'parent_element', 'wet_emitter_type'
    ],
    'Appliance': [
      'appliancekey', 'parent_element'
    ],
    'HotWaterDemand': [
      'subcategory', 'size', 'flowrate', 'rated_power', 'parent_element',
      // Container fields that get populated from CSV - not for manual editing
      'Bath', 'Shower', 'Other', 'Distribution'
    ],
    'ContextShading': [
      'shading_type', 'start_angle', 'end_angle', 'parent_element'
    ],
    'Vents': [
      'mid_height_air_flow_path', 'area_cm2', 'orientation360', 'pitch', 'parent_element'
    ],
    'MechanicalVentilation': [
      'vent_type'
    ],
    'CombustionAppliances': [
      'appliance_type', 'exhaust_situation', 'fuel_type', 'supply_situation'
    ],
    // On-site PV: keep core geometric + primary capacity fields in the main UI,
    // everything else (ventilation, inverter, EnergySupply, shading, etc.)
    // should appear in Advanced Fields.
    'OnSiteGeneration': [
      'type', 'Type', // schema/type markers
      'peak_power',
      'pitch',
      'orientation360',
      'base_height',
      'height',
      'width',
      'area',
      'zoneId'
    ],
    // ElectricBattery: main capacity/efficiency/location flags in primary UI;
    // all detailed timing/threshold/tariff fields in Advanced Fields.
    'ElectricBattery': [
      'type', 'Type',
      'capacity',
      'charge_discharge_efficiency_round_trip',
      'battery_location',
      'zoneId'
    ],
    // System: standard fields are element-level; Advanced Fields edit `extra_json` only.
    'System': ['type', 'Type', 'subcategory', 'system_preset', 'zoneId', 'parent_element'],
  };

  return baseFieldsMap[elementType] || [];
}

// Derive advanced-field keys from subschema, excluding base fields.
// TDD target: callers expect only properties valid for the element subtype and
// not present in the base field list.
export function getAdvancedFieldKeysForMode(
  useFHSSchema: boolean,
  elementType: string,
  subtype?: string,
): string[] {
  const subschema = getElementSubschemaForMode(useFHSSchema, elementType, subtype);
  const props = subschema?.properties ? Object.keys(subschema.properties) : [];
  const base = new Set(getBaseFieldsForElementType(elementType));
  return props.filter((k) => !base.has(k));
}

/** Core schema only; prefer {@link getAdvancedFieldKeysForMode} when UI follows FHS compliance. */
export function getAdvancedFieldKeys(elementType: string): string[] {
  return getAdvancedFieldKeysForMode(false, elementType, undefined);
}

/**
 * Extract the expected type(s) from a property schema.
 * Handles type arrays, anyOf, oneOf, and $ref patterns.
 */
function extractSchemaType(propertySchema: SchemaNode | null | undefined): string[] {
  if (!propertySchema) return [];

  // Direct type declaration
  if (propertySchema.type) {
    return Array.isArray(propertySchema.type) ? propertySchema.type : [propertySchema.type];
  }

  // Check anyOf/oneOf for type declarations
  const checkUnion = (union: SchemaNode[]): string[] => {
    const types: string[] = [];
    for (const item of union) {
      if (item && typeof item === 'object' && item.type) {
        const itemTypes = Array.isArray(item.type) ? item.type : [item.type];
        types.push(...itemTypes);
      }
    }
    return types;
  };

  if (Array.isArray(propertySchema.anyOf)) {
    const types = checkUnion(propertySchema.anyOf);
    if (types.length > 0) return types;
  }

  if (Array.isArray(propertySchema.oneOf)) {
    const types = checkUnion(propertySchema.oneOf);
    if (types.length > 0) return types;
  }

  return [];
}

/**
 * Coerce a value to match the expected schema type(s).
 * Only coerces when safe (e.g., "0.5" -> 0.5 for number type).
 */
function coerceValueToSchemaType(value: unknown, expectedTypes: string[]): unknown {
  // If value already matches one of the expected types, return as-is
  for (const expectedType of expectedTypes) {
    if (expectedType === 'number' && typeof value === 'number') return value;
    if (expectedType === 'integer' && typeof value === 'number' && Number.isInteger(value)) return value;
    if (expectedType === 'boolean' && typeof value === 'boolean') return value;
    if (expectedType === 'string' && typeof value === 'string') return value;
  }

  // Only coerce if value is a string and we have numeric/boolean types
  if (typeof value !== 'string') return value;

  for (const expectedType of expectedTypes) {
    if (expectedType === 'number') {
      // Coerce string numbers to numbers (e.g., "0.5" -> 0.5)
      const num = Number(value);
      if (!Number.isNaN(num) && /^\s*-?\d+(\.\d+)?([eE][+-]?\d+)?\s*$/.test(value.trim())) {
        return num;
      }
    }
    if (expectedType === 'integer') {
      // Coerce string integers to integers (e.g., "5" -> 5, "5.0" -> 5)
      const num = Number(value);
      if (!Number.isNaN(num) && Number.isInteger(num)) {
        // Accept both "5" and "5.0" formats - if it parses to an integer, it's valid
        // Check that the string represents a valid number (with optional decimal part that equals zero)
        const trimmed = value.trim();
        if (/^\s*-?\d+(\.0+)?\s*$/.test(trimmed)) {
          return num;
        }
      }
    }
    if (expectedType === 'boolean') {
      // Coerce string booleans to booleans
      const trimmed = value.trim().toLowerCase();
      if (trimmed === 'true') return true;
      if (trimmed === 'false') return false;
    }
  }

  // No coercion possible or value doesn't match expected types
  return value;
}

function validatePropertyValueAgainstSchemaRoot(
  rootSchema: SchemaNode | null,
  subschema: SchemaNode | null,
  elementType: string,
  key: string,
  value: unknown
): { valid: boolean; errors?: string[] } {
  // Only validate when value is set (undefined, null, '' => valid)
  if (value === undefined || value === null || value === '') {
    return { valid: true };
  }
  if (!rootSchema || !subschema || !subschema.properties || !subschema.properties[key]) {
    return { valid: true };
  }
  try {
    const ajv = getAjvInstance();
    // Build a minimal schema for just this property. Include $defs so $ref can resolve.
    const propertySchema = subschema.properties[key];

    // Coerce value to match schema type before validation
    const expectedTypes = extractSchemaType(propertySchema);
    const coercedValue = expectedTypes.length > 0 ? coerceValueToSchemaType(value, expectedTypes) : value;

    const dbg = getSchemaDebug();
    if (dbg) dbgCalls++;
    // Use a stable wrapper key ("v") so caching doesn't depend on the original property name.
    // We validate { v: value } against { properties: { v: <propertySchema> } }.
    const isFhsRoot = rootSchema === fhsSchemaObj;
    const cache = isFhsRoot ? compiledPropValidatorFhs : compiledPropValidatorCore;
    let validate = (propertySchema && typeof propertySchema === 'object') ? cache.get(propertySchema as object) : undefined;
    if (!validate) {
      const minimal = {
        type: 'object',
        properties: { v: propertySchema },
        required: [],
        $defs: rootSchema.$defs,
      };
      let t0 = 0;
      if (dbg) t0 = performance.now();
      validate = ajv.compile(minimal);
      if (propertySchema && typeof propertySchema === 'object') {
        cache.set(propertySchema as object, validate);
      }
      if (dbg) {
        dbgCompileCalls++;
        dbgCompileMs += (performance.now() - t0);
      }
    }
    if (dbg) {
      const every = dbg.logEvery ?? 200;
      if (dbgCompileCalls % every === 0) {
        const schemaId = (propertySchema && typeof propertySchema === 'object') ? getDbgId(propertySchema as object) : -1;
        // Keep logs small; the goal is to confirm compile churn, not spam.
        console.info('[SchemaCache][debug] ajv.compile churn', {
          calls: dbgCalls,
          compileCalls: dbgCompileCalls,
          compileMs: Math.round(dbgCompileMs),
          last: { elementType, key, schemaId },
        });
      }
    }
    const ok = validate({ v: coercedValue });
    if (ok) return { valid: true };
    const errs = (validate.errors || []).map((e) => e.message || 'invalid');
    return { valid: false, errors: errs };
  } catch (e) {
    return { valid: false, errors: [String(e)] };
  }
}

// Placeholder: per-field validation (to be implemented)
// Current behavior: always returns valid=true. Tests assert invalid cases
// to drive implementation.
export function validatePropertyValue(elementType: string, key: string, value: unknown): { valid: boolean; errors?: string[] } {
  // Only validate when value is set (undefined, null, '' => valid)
  if (value === undefined || value === null || value === '') {
    return { valid: true };
  }
  const root = getSchemaObject();
  const subschema = getSubschemaForElementType(elementType);
  if (!root || !subschema || !subschema.properties || !subschema.properties[key]) {
    // Fallback heuristic for common numeric properties when schema is unavailable in tests
    const numericFallbacks: Record<string, Set<string>> = {
      'BuildingElementOpaque': new Set(['u_value', 'areal_heat_capacity', 'g_value']),
      'BuildingElementTransparent': new Set(['g_value']),
      'BuildingElementGround': new Set(['height_upper_surface']),
      'MechanicalVentilation': new Set(['SFP'])
    };
    const nums = numericFallbacks[elementType];
    if (nums && nums.has(key)) {
      if (typeof value === 'number' && !Number.isNaN(value)) return { valid: true };
      if (typeof value === 'string') {
        const n = Number(value);
        if (!Number.isNaN(n) && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return { valid: true };
      }
      return { valid: false, errors: ['must be number'] };
    }
    return { valid: true };
  }
  try {
    ensureRootSchema(root);
    return validatePropertyValueAgainstSchemaRoot(root, subschema, elementType, key, value);
  } catch (e) {
    return { valid: false, errors: [String(e)] };
  }
}

export function validatePropertyValueForMode(
  useFHSSchema: boolean,
  elementType: string,
  subtype: string | undefined,
  key: string,
  value: unknown
): { valid: boolean; errors?: string[] } {
  if (!useFHSSchema) {
    const root = getSchemaObject();
    const subschema = getElementSubschemaForMode(false, elementType, subtype);
    if (!root || !subschema || !subschema.properties || !subschema.properties[key]) {
      return validatePropertyValue(elementType, key, value);
    }
    try {
      ensureRootSchema(root);
      return validatePropertyValueAgainstSchemaRoot(root, subschema, elementType, key, value);
    } catch (e) {
      return { valid: false, errors: [String(e)] };
    }
  }

  const root = getFHSSchemaObject();
  const subschema = getElementSubschemaForMode(true, elementType, subtype);
  return validatePropertyValueAgainstSchemaRoot(root, subschema, elementType, key, value);
}

// FHS-aware per-field validation. This mirrors validatePropertyValue() but uses
// the FHS schema cache + FHS subschema resolution (so min/max constraints match
// what the save worker enforces when ComplianceValidationEnabled=TRUE).
export function validatePropertyValueFHS(
  elementType: string,
  subtype: string | undefined,
  key: string,
  value: unknown
): { valid: boolean; errors?: string[] } {
  // Only validate when value is set (undefined, null, '' => valid)
  if (value === undefined || value === null || value === '') {
    return { valid: true };
  }
  return validatePropertyValueForMode(true, elementType, subtype, key, value);
}

// -------- Schema-driven numeric coercion helpers (strictest typing across Core/FHS) --------

type NumericKind = 'integer' | 'number';

// Cache: elementType|subtype -> Set of keys that should be treated as integers (strictest-of-both).
const strictestIntegerKeysCache = new Map<string, Set<string>>();

function schemaKeyForCache(elementType: string, subtype?: string): string {
  return `${elementType}::${subtype ?? ''}`;
}

function isNumericKindInSchema(fieldSchema: SchemaNode | null | undefined, kind: NumericKind): boolean {
  if (!fieldSchema) return false;

  const t = fieldSchema.type;
  if (t === kind) return true;
  if (Array.isArray(t) && t.includes(kind)) return true;

  // Common patterns in these schemas: anyOf / oneOf include { type: <kind> } alongside null etc.
  const anyOf = fieldSchema.anyOf;
  if (Array.isArray(anyOf) && anyOf.some((s) => isNumericKindInSchema(s, kind))) return true;
  const oneOf = fieldSchema.oneOf;
  if (Array.isArray(oneOf) && oneOf.some((s) => isNumericKindInSchema(s, kind))) return true;

  return false;
}

function collectIntegerKeysFromSubschema(subschema: SchemaNode | null): Set<string> {
  const out = new Set<string>();
  const props = subschema?.properties;
  if (!props || typeof props !== 'object') return out;
  for (const [k, v] of Object.entries(props)) {
    if (isNumericKindInSchema(v, 'integer')) out.add(k);
  }
  return out;
}

function fallbackIntegerKeys(elementType: string): Set<string> {
  // Fallback when schema isn't loaded (e.g. tests or early startup).
  // Keep this minimal and focused on known "integer-ish" fields that frequently cause UX issues.
  const map: Record<string, string[]> = {
    BuildingElementOpaque: ['pitch', 'orientation360'],
    BuildingElementTransparent: ['pitch', 'orientation360'],
    BuildingElementGround: ['pitch', 'orientation360'], // pitch appears on some ground variants
    BuildingElementAdjacentConditionedSpace: ['pitch'],
    BuildingElementAdjacentUnconditionedSpace_Simple: ['pitch'],
    BuildingElementPartyWall: ['pitch'],
    ContextShading: ['start_angle', 'end_angle'],
    OnSiteGeneration: ['pitch', 'orientation360'],
    Lighting: ['count'],
    WetEmitter: ['unit_number'],
    Vents: ['pitch', 'orientation360'],
  };
  return new Set<string>(map[elementType] || []);
}

/**
 * Returns the set of property keys that should be treated as integers for a given element type/subtype.
 * "Strictest" means: if either Core OR FHS schema declares the property as integer, we treat it as integer.
 *
 * This supports approach (A): strict numeric typing, while still validating required fields against the
 * selected schema (Core/FHS) elsewhere.
 */
export function getStrictestIntegerKeysForElementType(elementType: string, subtype?: string): Set<string> {
  const cacheKey = schemaKeyForCache(elementType, subtype);
  const cached = strictestIntegerKeysCache.get(cacheKey);
  if (cached) return cached;

  // If neither schema is loaded, fall back to a conservative hardcoded list.
  const coreRoot = getSchemaObject();
  const fhsRoot = getFHSSchemaObject();
  if (!coreRoot && !fhsRoot) {
    const fb = fallbackIntegerKeys(elementType);
    strictestIntegerKeysCache.set(cacheKey, fb);
    return fb;
  }

  const coreSub = getSubschemaForElementType(elementType, subtype);
  const fhsSub = getFHSSubschemaForElementType(elementType, subtype);

  const coreInts = collectIntegerKeysFromSubschema(coreSub);
  const fhsInts = collectIntegerKeysFromSubschema(fhsSub);

  // strictest-of-both: integer wins.
  const out = new Set<string>([...coreInts, ...fhsInts]);

  // Merge fallback as a safety net for partially-loaded schemas.
  for (const k of fallbackIntegerKeys(elementType)) out.add(k);

  strictestIntegerKeysCache.set(cacheKey, out);
  return out;
}
