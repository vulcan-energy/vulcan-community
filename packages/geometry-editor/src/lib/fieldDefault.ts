// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Where an element field's value comes from when nobody entered it: the one answer the element
// editors show ("default", "from the assembly") and the provenance table compares against.

import type { ArealHeatCapacityInput } from '../../../geometry-editor-host/src/schemaPort';
import { roundToTwoDecimals, SUSPENDED_GROUND_DEFAULT_HEIGHT_UPPER_SURFACE_M } from '../geometry/constants';
import type { Element } from '../geometry/types';
import { parseVulcanAssemblyV1FromExtraJson } from './assemblyAppliedUi';
import { arealHeatCapacityBandFromJPerM2K, arealHeatCapacityWrite } from './assemblyCalculator';
import { ROW_ONLY_ELEMENT_TYPES } from '../geometry/io/geometryCsvLayouts';
import type { DefaultsLookup, OpaqueFabricVariant } from './defaultsCache';
import { parseWindShieldLocation } from './groundUValueCalculator';
import { readRecord } from './jsonTypes';
import { classifyOpaqueFabricVariant, classifyOpaqueFabricVariantFromElement } from './opaqueFabricVariant';

// Every control looks its default up on every render, and a miss walks the whole tree:
// one answer per defaults document, lookup and query.
const defaultValueCache = new WeakMap<object, WeakMap<object, Map<string, unknown>>>();

// Helper to get default value for a specific path, preferring the current elementType subtree
export function getDefaultValue(
  defaults: unknown,
  defaultsLookup: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
  propertyName: string,
  elementType?: string,
  subtype?: string,
  opaqueFabricVariant?: OpaqueFabricVariant,
): unknown {
  if (!defaults || typeof defaults !== 'object') return undefined;
  let byLookup = defaultValueCache.get(defaults);
  if (!byLookup) defaultValueCache.set(defaults, (byLookup = new WeakMap()));
  let cache = byLookup.get(defaultsLookup);
  if (!cache) byLookup.set(defaultsLookup, (cache = new Map()));
  const key = JSON.stringify([propertyName, elementType ?? null, subtype ?? null, opaqueFabricVariant ?? null]);
  if (!cache.has(key)) cache.set(key, findDefaultValue(defaults, defaultsLookup, propertyName, elementType, subtype, opaqueFabricVariant));
  return cache.get(key);
}

function findDefaultValue(
  defaults: unknown,
  defaultsLookup: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
  propertyName: string,
  elementType?: string,
  subtype?: string,
  opaqueFabricVariant?: OpaqueFabricVariant,
): unknown {
  // R4.6b-2: takes the property name outright. It used to take the control's dot-joined
  // `path` and recover the name as `path.split('.').pop()` — the same guess every control
  // was making separately, and the same one a '.'-bearing leaf key breaks. The caller has
  // the real key now (see `AdvancedControlProps.propKey`).
  // The converter never fills these rows from the defaults: showing a template value would mislead.
  if (!defaults || !propertyName || (elementType && ROW_ONLY_ELEMENT_TYPES.has(elementType))) {
    return undefined;
  }
  const defaultsRecord = readRecord(defaults);

  // Special handling for MechanicalVentilation: filter by vent_type (subtype)
  if (elementType === 'MechanicalVentilation' && subtype) {
    try {
      const mvMap = readRecord(readRecord(defaultsRecord.InfiltrationVentilation).MechanicalVentilation);
      if (Object.keys(mvMap).length > 0) {
        // Only check defaults from entries matching the vent_type
        for (const entry of Object.values(mvMap)) {
          const entryRecord = readRecord(entry);
          if (entryRecord.vent_type === subtype) {
            if (Object.prototype.hasOwnProperty.call(entry, propertyName)) {
              return entryRecord[propertyName];
            }
          }
        }
      }
      // No default found for this vent_type
      return undefined;
    } catch {
      // Fall through to generic search on error
    }
  }

  // FHS MVHR ductwork defaults are nested under:
  // InfiltrationVentilation.MechanicalVentilation.*.ductwork[]
  // (not a standalone MechanicalVentilationDuctwork object tree).
  if (elementType === 'MechanicalVentilationDuctwork') {
    try {
      const mvMap = readRecord(readRecord(defaultsRecord.InfiltrationVentilation).MechanicalVentilation);
      if (Object.keys(mvMap).length > 0) {
        for (const entry of Object.values(mvMap)) {
          const entryRecord = readRecord(entry);
          if (entryRecord.vent_type !== 'MVHR') continue;
          const ducts = entryRecord.ductwork;
          if (!Array.isArray(ducts)) continue;
          // If caller provides a duct subtype, prefer that duct; otherwise use first matching key.
          const ductsByType = new Map<unknown, unknown>();
          let byKey: unknown;
          let hasByKey = false;
          for (const duct of ducts) {
            const ductRecord = readRecord(duct);
            if (!ductsByType.has(ductRecord.duct_type)) {
              ductsByType.set(ductRecord.duct_type, duct);
            }
            if (!hasByKey && Object.prototype.hasOwnProperty.call(ductRecord, propertyName)) {
              byKey = duct;
              hasByKey = true;
            }
          }
          const preferred = typeof subtype === 'string' ? ductsByType.get(subtype) : undefined;
          const selected = readRecord(preferred ?? byKey);
          if (Object.prototype.hasOwnProperty.call(selected, propertyName)) {
            return selected[propertyName];
          }
        }
      }

      // Backward compatibility for older defaults layouts.
      const legacyMap = readRecord(defaultsRecord.MechanicalVentilationDuctwork);
      if (Object.keys(legacyMap).length > 0) {
        for (const entry of Object.values(legacyMap)) {
          const entryRecord = readRecord(entry);
          if (Object.prototype.hasOwnProperty.call(entryRecord, propertyName)) {
            return entryRecord[propertyName];
          }
        }
      }
    } catch {
      // Fall through to generic search on error
    }
  }

  // FHS primary pipework defaults live under:
  // HotWaterSource.<source>.primary_pipework[]
  // (not under a standalone WaterPipework node).
  if (elementType === 'WaterPipework') {
    try {
      const hotWaterSources = readRecord(defaultsRecord.HotWaterSource);
      if (Object.keys(hotWaterSources).length > 0) {
        for (const source of Object.values(hotWaterSources)) {
          const primaryPipework = readRecord(source).primary_pipework;
          if (!Array.isArray(primaryPipework)) continue;
          const byKey = primaryPipework.find(
            (pipe) => Object.prototype.hasOwnProperty.call(readRecord(pipe), propertyName),
          );
          const byKeyRecord = readRecord(byKey);
          if (Object.prototype.hasOwnProperty.call(byKeyRecord, propertyName)) {
            return byKeyRecord[propertyName];
          }
        }
      }

      // Backward compatibility for older defaults layouts.
      const legacyMap = readRecord(defaultsRecord.WaterPipework);
      if (Object.keys(legacyMap).length > 0) {
        for (const entry of Object.values(legacyMap)) {
          const entryRecord = readRecord(entry);
          if (Object.prototype.hasOwnProperty.call(entryRecord, propertyName)) {
            return entryRecord[propertyName];
          }
        }
      }
    } catch {
      // Fall through to generic search on error
    }
  }

  // Fast-path for OnSiteGeneration: defaults live under OnSiteGeneration["Default PV"]
  // in defaults_template.json. Use this as the source of PV defaults so that
  // inverter fields (DC/AC, is_inside, type, ventilation_strategy, EnergySupply)
  // surface as placeholders in Advanced Fields.
  if (elementType === 'OnSiteGeneration') {
    try {
      const pvDefaults = readRecord(readRecord(defaultsRecord.OnSiteGeneration)['Default PV']);
      if (Object.prototype.hasOwnProperty.call(pvDefaults, propertyName)) {
        return pvDefaults[propertyName];
      }
    } catch {
      // Fall through to generic search on error
    }
  }

  // Fast-path for ElectricBattery: defaults are stored under
  // EnergySupply.<supply>.ElectricBattery (without a typed `type` node),
  // so the typed DFS below will not find them.
  if (elementType === 'ElectricBattery') {
    try {
      const energySupplyMap = readRecord(defaultsRecord.EnergySupply);
      if (Object.keys(energySupplyMap).length > 0) {
        const mainsElecBattery = readRecord(readRecord(energySupplyMap['mains elec']).ElectricBattery);
        if (Object.prototype.hasOwnProperty.call(mainsElecBattery, propertyName)) {
          return mainsElecBattery[propertyName];
        }
        for (const supply of Object.values(energySupplyMap)) {
          const batteryDefaults = readRecord(readRecord(supply).ElectricBattery);
          if (Object.prototype.hasOwnProperty.call(batteryDefaults, propertyName)) {
            return batteryDefaults[propertyName];
          }
        }
      }
    } catch {
      // Fall through to generic search on error
    }
  }

  // FHS WetEmitter defaults live under:
  // SpaceHeatSystem.<system>.emitters[] (with wet_emitter_type discriminator),
  // not under a standalone WetEmitter node.
  if (elementType === 'WetEmitter') {
    try {
      const systems = readRecord(defaultsRecord.SpaceHeatSystem);
      if (Object.keys(systems).length > 0) {
        const subtypeKey = typeof subtype === 'string' ? subtype : undefined;
        for (const sys of Object.values(systems)) {
          const systemRecord = readRecord(sys);
          if (systemRecord.type !== 'WetDistribution') continue;
          const emitters = systemRecord.emitters;
          if (!Array.isArray(emitters)) continue;

          // Prefer defaults from the matching emitter subtype.
          if (subtypeKey) {
            const typed = emitters.find(
              (em) => readRecord(em).wet_emitter_type === subtypeKey,
            );
            const typedRecord = readRecord(typed);
            if (Object.prototype.hasOwnProperty.call(typedRecord, propertyName)) {
              return typedRecord[propertyName];
            }
          }

          // Fallback to first emitter that defines this property.
          const byProp = emitters.find(
            (em) => Object.prototype.hasOwnProperty.call(readRecord(em), propertyName),
          );
          const byPropRecord = readRecord(byProp);
          if (Object.prototype.hasOwnProperty.call(byPropRecord, propertyName)) {
            return byPropRecord[propertyName];
          }
        }
      }
    } catch {
      // Fall through to generic search on error
    }
  }

  // BuildingElementOpaque: prefer variant-specific defaults (wall / roof / external door)
  // aligned with CSV merge and {@link defaultsCache} indexing.
  if (elementType === 'BuildingElementOpaque' && opaqueFabricVariant) {
    const fromCache = defaultsLookup.getDefaultValueForElementField(
      propertyName,
      elementType,
      opaqueFabricVariant,
    );
    if (fromCache !== undefined) return fromCache;
  }

  // Depth-first search: only return defaults from nodes whose `type` exactly
  // matches the current elementType (with a special-case for OnSiteGeneration →
  // PhotovoltaicSystem).  No cross-type fallback – e.g. a ground floor's
  // u_value must never be shown as the default for a wall.
  const visited = new WeakSet<object>();

  function isRelevantNode(node: unknown): boolean {
    const nodeRecord = readRecord(node);
    const t = nodeRecord.type;
    // For BuildingElement types, look for BuildingElement* nodes (for ordering priority)
    if (elementType && elementType.startsWith('BuildingElement')) {
      return typeof t === 'string' && t.startsWith('BuildingElement');
    }
    // Special-case for OnSiteGeneration: defaults live under PhotovoltaicSystem
    if (elementType === 'OnSiteGeneration') {
      return typeof t === 'string' && t === 'PhotovoltaicSystem';
    }
    // For other types (Appliance, etc.), look for exact type match
    return typeof t === 'string' && t === elementType;
  }

  function dfs(node: unknown): unknown {
    if (!node || typeof node !== 'object') return undefined;
    if (visited.has(node)) return undefined;
    visited.add(node);
    const nodeRecord = readRecord(node);

    // Only return a value from nodes whose type exactly matches elementType
    const t = nodeRecord.type;
    const matchesElementType =
      (elementType && t === elementType) ||
      // Special-case: OnSiteGeneration defaults live under PhotovoltaicSystem
      (elementType === 'OnSiteGeneration' && t === 'PhotovoltaicSystem');
    const matchesOpaqueVariant =
      elementType !== 'BuildingElementOpaque' ||
      !opaqueFabricVariant ||
      classifyOpaqueFabricVariant(node) === opaqueFabricVariant;
    if (
      matchesElementType &&
      matchesOpaqueVariant &&
      Object.prototype.hasOwnProperty.call(node, propertyName)
    ) {
      return nodeRecord[propertyName];
    }
    // When no elementType is provided, accept any typed node that has the property
    if (!elementType && isRelevantNode(node) && Object.prototype.hasOwnProperty.call(node, propertyName)) {
      return nodeRecord[propertyName];
    }

    // Recurse into children, visiting relevant children first for speed
    const entries = Array.isArray(node) ? node : Object.values(node);
    const relevantFirst = entries.filter(isRelevantNode).concat(entries.filter((n) => !isRelevantNode(n)));
    for (const child of relevantFirst) {
      const found = dfs(child);
      if (found !== undefined) return found;
    }

    return undefined;
  }

  const fromDefaultsTree = dfs(defaults);
  if (fromDefaultsTree !== undefined) return fromDefaultsTree;
  if (
    elementType === 'BuildingElementGround' &&
    subtype === 'Suspended_floor' &&
    propertyName === 'height_upper_surface'
  ) {
    return SUSPENDED_GROUND_DEFAULT_HEIGHT_UPPER_SURFACE_M;
  }
  return undefined;
}

export type FieldSourceInfo = {
  value: unknown;
  kind: 'assembly' | 'default';
};

/** The field's source: the applied assembly's value when it sets the field, else the default. */
export function resolveFieldSource(
  propKey: string | undefined,
  defaultValue: unknown,
  assemblySourceValues: Readonly<Record<string, unknown>> = {},
): FieldSourceInfo {
  if (propKey && Object.prototype.hasOwnProperty.call(assemblySourceValues, propKey)) {
    return { value: assemblySourceValues[propKey], kind: 'assembly' };
  }
  /** FHS suspended `shield_fact_location`: template often omits it; ISO 13370 path uses {@link parseWindShieldLocation}. */
  const templateDefault =
    propKey === 'shield_fact_location' ? parseWindShieldLocation(defaultValue) : defaultValue;
  return { value: templateDefault, kind: 'default' };
}

/** The values an applied assembly sets on the element, by field. */
export function assemblySourceValuesFor(
  extraJson: unknown,
  elementType: string | undefined,
  subtype: string | undefined,
  arealHeatCapacity: ArealHeatCapacityInput,
): Record<string, unknown> {
  const envelope = parseVulcanAssemblyV1FromExtraJson(extraJson);
  if (!envelope) return {};
  const out: Record<string, unknown> = {};
  if (typeof envelope.uValueWrittenToElement_W_m2K === 'number') {
    out.u_value = envelope.uValueWrittenToElement_W_m2K;
  }
  if (typeof envelope.thermalResistanceConstruction_m2K_W === 'number') {
    out[
      elementType === 'BuildingElementGround'
        ? 'thermal_resistance_floor_construction'
        : 'thermal_resistance_construction'
    ] = envelope.thermalResistanceConstruction_m2K_W;
  }
  if (typeof envelope.thermalResistanceGroundInsulation_m2K_W === 'number') {
    out.thermal_resist_insul = envelope.thermalResistanceGroundInsulation_m2K_W;
  }
  if (typeof envelope.arealHeatCapacityWrittenToElement_J_m2K === 'number' && elementType) {
    const jWritten = envelope.arealHeatCapacityWrittenToElement_J_m2K;
    // A target that takes a class stores its label; the envelope keeps the class's J/(m²·K).
    const write = arealHeatCapacityWrite(arealHeatCapacity, elementType);
    out.areal_heat_capacity = write === 'number' ? jWritten : arealHeatCapacityBandFromJPerM2K(jWritten, write);
  }
  if (typeof envelope.massDistributionClass === 'string') {
    out.mass_distribution_class = envelope.massDistributionClass;
  }
  if (
    elementType === 'BuildingElementGround' &&
    subtype === 'Suspended_floor' &&
    typeof envelope.suspendedHeightUpperSurfaceM === 'number' &&
    Number.isFinite(envelope.suspendedHeightUpperSurfaceM)
  ) {
    out.height_upper_surface = roundToTwoDecimals(envelope.suspendedHeightUpperSurfaceM);
  }
  return out;
}

// The element field each type's editor reads its defaults subtype from.
const SUBTYPE_FIELD: Partial<Record<Element['type'], string>> = {
  Appliance: 'appliancekey',
  BuildingElementGround: 'floor_type',
  CombustionAppliances: 'appliance_type',
  ContextShading: 'shading_type',
  HotWaterDemand: 'subcategory',
  MechanicalVentilation: 'vent_type',
  MechanicalVentilationDuctwork: 'duct_type',
  System: 'subcategory',
  WetEmitter: 'subcategory',
  WindowShading: 'shading_type',
};

/** The subtype the element's editor passes to the defaults lookup. */
export function elementSubtype(element: Element): string | undefined {
  const field = SUBTYPE_FIELD[element.type];
  const value = field ? (element as unknown as Record<string, unknown>)[field] : undefined;
  return typeof value === 'string' && value ? value : undefined;
}

/** The element fields that pick a subtype (they choose which defaults apply, not a value). */
export const SUBTYPE_FIELDS: ReadonlySet<string> = new Set(Object.values(SUBTYPE_FIELD));

/**
 * The value an element field takes when nobody entered it, as its editor shows it: the applied
 * assembly's value, else the default for the element's type, subtype and fabric variant.
 */
export function elementFieldSource(
  element: Element,
  field: string,
  defaults: unknown,
  defaultsLookup: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
  arealHeatCapacity: ArealHeatCapacityInput,
): unknown {
  const subtype = elementSubtype(element);
  const variant = element.type === 'BuildingElementOpaque'
    ? classifyOpaqueFabricVariantFromElement(element as unknown as Record<string, unknown>)
    : undefined;
  return resolveFieldSource(
    field,
    getDefaultValue(defaults, defaultsLookup, field, element.type, subtype, variant),
    assemblySourceValuesFor(element.extra_json, element.type, subtype, arealHeatCapacity),
  ).value;
}
