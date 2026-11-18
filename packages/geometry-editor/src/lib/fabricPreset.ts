// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { TargetRules } from '../../../geometry-editor-host/src/schemaPort';
import type { Element } from '../geometry/types';
import { ASSEMBLY_SET_ASIDE_KEY } from './assemblyAppliedUi';
import { GROUND_U_VALUE_MANUAL_KEY } from './groundSuspendedFabricSync';
import type { CreationDefaultAssemblyIds } from './multiSelectAssemblyApply';
import { classifyOpaqueFabricVariantFromElement } from './opaqueFabricVariant';

/**
 * Fabric presets: a named set of fabric values per construction type, picked in the Fabric tab and
 * stored once, in the model's `FabricPreset` Metadata row. The converter
 * (`vulcan-model-transform` `fabric_preset.rs`) gives each element the preset's values it does not
 * state itself; the merged model holds them as ordinary element values. Elements never carry
 * preset values: the editor shows them as the element's default (`presetValueFor`). The model's
 * defaults file never changes: a pinned target runs only its own. The rules here match the
 * converter's.
 */

export type FabricRow = 'wall' | 'adjacent_wall' | 'roof' | 'ground_floor' | 'window' | 'door';
export const FABRIC_ROWS: readonly FabricRow[] = ['wall', 'adjacent_wall', 'roof', 'ground_floor', 'window', 'door'];

/**
 * The values a preset sets per construction type. Not a ground floor's U-value: the floor
 * calculation derives it from the construction's resistance and the drawing.
 */
export const FABRIC_PRESET_KEYS: Readonly<Record<FabricRow, readonly string[]>> = {
  wall: ['u_value'],
  adjacent_wall: ['u_value'],
  roof: ['u_value'],
  door: ['u_value'],
  ground_floor: ['thermal_resistance_floor_construction'],
  window: ['u_value', 'g_value'],
};

/** The range a preset value must be in, with its unit. */
const PRESET_RANGES: Readonly<Record<string, { min: number; max: number; minExclusive?: boolean; label: string; unit: string }>> = {
  u_value: { min: 0, max: 10, minExclusive: true, label: 'U-value', unit: ' W/m²K' },
  g_value: { min: 0, max: 1, label: 'g-value', unit: '' },
  thermal_resistance_floor_construction: { min: 0, max: 20, minExclusive: true, label: 'construction resistance', unit: ' m²K/W' },
};

/** The element values that keep a preset value off: the value itself, the other way of stating it, and a build-up (which writes it). */
function blockingKeys(row: FabricRow, key: string): readonly string[] {
  if (row === 'window') return [key];
  if (row === 'ground_floor') return ['thermal_resistance_floor_construction', 'vulcan_assembly_v1'];
  return ['u_value', 'thermal_resistance_construction', 'vulcan_assembly_v1'];
}

/** The fabric values an element can state for itself. A ground U-value counts only when the user stated it. */
const OWN_FABRIC_KEYS: Readonly<Record<FabricRow, readonly string[]>> = {
  wall: ['u_value', 'thermal_resistance_construction', 'vulcan_assembly_v1'],
  adjacent_wall: ['u_value', 'thermal_resistance_construction', 'vulcan_assembly_v1'],
  roof: ['u_value', 'thermal_resistance_construction', 'vulcan_assembly_v1'],
  door: ['u_value', 'thermal_resistance_construction', 'vulcan_assembly_v1'],
  ground_floor: ['u_value', 'thermal_resistance_floor_construction', 'vulcan_assembly_v1'],
  window: ['u_value', 'g_value'],
};

export type FabricPreset = Readonly<{
  name: string;
  /** The targets the preset is for: HEM:EPC new build or FHS. */
  family: 'fhs' | 'epc';
  values: Readonly<Partial<Record<FabricRow, Readonly<Record<string, number>>>>>;
  /** The build-ups new elements take, saved with a user's preset. */
  buildUps?: CreationDefaultAssemblyIds;
}>;

/**
 * The built-in FHS presets: the fabric of the shipped Part L 2021 and HEM case study defaults
 * files (`fixtures/defaults/defaults_partyL2021.json`, `defaults_targetHEMCaseStudy.json`), their
 * `wall 0`, `wall 4` and `wall 5` (the adjacent walls, one value for both), `roof 0`,
 * `external door`, `ground` and `window 0` values where they differ from the standard template.
 * The ground's U-value is left out: the floor calculation derives it. Their other differences
 * (ventilation keys, the ground's floor type, wall 5's unconditioned-space resistance) are not
 * fabric and are left out too.
 */
export const BUILT_IN_FABRIC_PRESETS: readonly FabricPreset[] = [
  {
    name: 'Part L 2021',
    family: 'fhs',
    values: {
      wall: { u_value: 0.26 },
      adjacent_wall: { u_value: 0.26 },
      roof: { u_value: 0.16 },
      door: { u_value: 1.6 },
      ground_floor: { thermal_resistance_floor_construction: 4.5 },
      window: { u_value: 1.6, g_value: 0.63 },
    },
  },
  {
    name: 'HEM case study',
    family: 'fhs',
    values: {
      adjacent_wall: { u_value: 0.18 },
      roof: { u_value: 0.1 },
      ground_floor: { thermal_resistance_floor_construction: 5.5 },
      window: { g_value: 0.45 },
    },
  },
];

/** The Fabric tab's row of a construction type, as a Global Settings field key (the "default" link opens it). */
export const fabricRowField = (row: FabricRow): string => `FabricRow_${row}`;

/** The construction type an element counts under, as the converter matches the defaults file's elements. */
export function fabricRowKey(element: Element): FabricRow | undefined {
  if ((element as { isPlaceholder?: boolean }).isPlaceholder && !element.coordinates?.length) return undefined;
  if (element.type === 'BuildingElementTransparent') return 'window';
  if (element.type === 'BuildingElementGround') return 'ground_floor';
  if (element.type === 'BuildingElementAdjacentConditionedSpace' || element.type === 'BuildingElementAdjacentUnconditionedSpace_Simple') return 'adjacent_wall';
  if (element.type !== 'BuildingElementOpaque') return undefined;
  const variant = classifyOpaqueFabricVariantFromElement(element as unknown as Record<string, unknown>);
  return variant === 'external_door' ? 'door' : variant;
}

const stated = (value: unknown) => value !== undefined && value !== null && value !== '';
/** An element value as the converter reads it: its CSV column (an element field), else `extra_json`. */
function ownValue(element: Element, key: string): unknown {
  const column = (element as unknown as Record<string, unknown>)[key];
  return stated(column) ? column : (element.extra_json as Record<string, unknown> | undefined)?.[key];
}

/** The fabric keys the element states itself. A ground U-value the floor calculation wrote is not one. */
export function ownFabricKeys(element: Element, row: FabricRow): string[] {
  return OWN_FABRIC_KEYS[row].filter((key) => stated(ownValue(element, key))
    && !(row === 'ground_floor' && key === 'u_value' && ownValue(element, GROUND_U_VALUE_MANUAL_KEY) !== true));
}

/**
 * The preset values the converter gives the element: each one it does not state itself. Pure and
 * display-only: an editor shows them as the element's default ("default · Fabric <name>").
 * `preset` must be the one the target takes (`fabricPresetForTarget`).
 */
export function presetValueFor(element: Element, preset: FabricPreset | null): Record<string, number> {
  const row = fabricRowKey(element);
  const values = row ? preset?.values[row] : undefined;
  if (!row || !values) return {};
  return Object.fromEntries(Object.entries(values).filter(([key]) => !blockingKeys(row, key).some((own) => stated(ownValue(element, own)))));
}

/**
 * The patch "Apply to all" makes on an element: its own fabric values go, in a CSV column or in
 * `extra_json`, with a stated ground U-value's flag. A build-up goes with the values it set that
 * still hold its value (`buildUpValues`, from `assemblySourceValuesFor`), such as the heat
 * capacity, so none of them stays without it.
 */
export function ownFabricClear(element: Element, row: FabricRow, buildUpValues: Readonly<Record<string, unknown>>): Partial<Element> {
  const fields = element as unknown as Record<string, unknown>;
  const extra = { ...(element.extra_json as Record<string, unknown> | undefined) };
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(buildUpValues)) {
    if (JSON.stringify(extra[key]) === JSON.stringify(value)) delete extra[key];
  }
  for (const key of [...OWN_FABRIC_KEYS[row], ...(row === 'ground_floor' ? [GROUND_U_VALUE_MANUAL_KEY] : [])]) {
    delete extra[key];
    if (stated(fields[key])) patch[key] = undefined;
  }
  // An existing wall's edited age band layers, and layers a typed value set aside: the preset's values replace them too.
  delete extra.wall_layers;
  delete extra[ASSEMBLY_SET_ASIDE_KEY];
  return { ...patch, extra_json: extra } as Partial<Element>;
}

/** The family of presets the target takes; none under construction bands, where the age band gives the fabric. */
export function fabricPresetFamily(rules: Pick<TargetRules, 'requiredMetadataRows' | 'constructionBands'>): FabricPreset['family'] | undefined {
  if (rules.constructionBands) return undefined;
  return rules.requiredMetadataRows.includes('IsExistingBuilding') ? 'epc' : 'fhs';
}

/** The model's preset if the target takes it: an FHS preset waits unused on HEM:EPC, and the reverse. */
export const fabricPresetForTarget = (preset: FabricPreset | null, rules: Pick<TargetRules, 'requiredMetadataRows' | 'constructionBands'>): FabricPreset | null =>
  preset && preset.family === fabricPresetFamily(rules) ? preset : null;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** What is wrong with a preset's values, in words; undefined when every value is a known one in its range. */
export function fabricPresetValuesProblem(values: unknown): string | undefined {
  if (!isRecord(values)) return 'it has no values';
  for (const [row, rowValues] of Object.entries(values)) {
    const keys = FABRIC_PRESET_KEYS[row as FabricRow] ? new Set(FABRIC_PRESET_KEYS[row as FabricRow]) : undefined;
    if (!keys) return `"${row}" is not a construction type (use ${FABRIC_ROWS.join(', ')})`;
    if (!isRecord(rowValues)) return `the ${row} values are not a list of values`;
    for (const [key, value] of Object.entries(rowValues)) {
      const range = PRESET_RANGES[key];
      if (!keys.has(key) || !range) return `${row} takes ${[...keys].join(' and ')}, not ${key}`;
      if (typeof value !== 'number' || !Number.isFinite(value)) return `the ${row} ${range.label} is not a number`;
      if (value > range.max || (range.minExclusive ? value <= range.min : value < range.min)) {
        return `the ${row} ${range.label} ${value} is outside ${range.min} to ${range.max}${range.unit}`;
      }
    }
  }
  return undefined;
}

/**
 * A preset from its saved JSON (a model's FabricPreset row or a saved preset file); undefined
 * for no text. Throws, saying what is wrong, when the text is not a valid preset.
 */
export function parseFabricPreset(text: string | undefined): FabricPreset | undefined {
  if (!text) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Not a fabric preset: the text is not JSON.');
  }
  if (!isRecord(json) || typeof json.name !== 'string' || !json.name.trim()) throw new Error('Not a fabric preset: it has no name.');
  if (json.family !== 'fhs' && json.family !== 'epc') throw new Error(`Fabric preset "${json.name}": family must be "fhs" or "epc".`);
  const problem = fabricPresetValuesProblem(json.values);
  if (problem) throw new Error(`Fabric preset "${json.name}": ${problem}.`);
  if (json.buildUps !== undefined && (!isRecord(json.buildUps) || Object.values(json.buildUps).some((id) => typeof id !== 'string'))) {
    throw new Error(`Fabric preset "${json.name}": build-ups must be assembly ids.`);
  }
  return json as unknown as FabricPreset;
}
