// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';
import { parseVulcanAssemblyV1FromExtraJson } from './assemblyAppliedUi';
import { GROUND_U_VALUE_MANUAL_KEY } from './groundSuspendedFabricSync';
import { HEMIE_DETAIL_FIELDS } from './hemieFabric';

/**
 * How an element's U-value is known ("Thermal values from"): from its age band and construction
 * (existing building only), from a calculation (the assembly layers, or the ground floor's ISO
 * 13370 calculation), or entered. On an existing wall the converter sends a calculation's
 * build-up as HEM:EPC wall layers, not as an entered U-value (`hemie_layers.rs`).
 */
export type ThermalMethod = 'band' | 'calculation' | 'u_value';

const METHOD_TYPES: ReadonlySet<string> = new Set([
  'BuildingElementOpaque', 'BuildingElementTransparent', 'BuildingElementGround', 'BuildingElementAdjacentUnconditionedSpace_Simple',
  'BuildingElementPartyWall',
]);
const PARTY_WALL = 'BuildingElementPartyWall';
/** A party wall's U-value inputs: its half or whole U, or its resistance, with how the U was read. */
const PARTY_WALL_U_KEYS = ['u_value', 'u_value_whole_wall', 'thermal_resistance_construction',
  'u_value_interpretation', 'u_value_interpreted_value', 'construction_basis'] as const;

/**
 * Element types whose thermal values the "Thermal values from" block shows. An existing building's
 * party wall is not one: the converter fixes its resistance and takes only its cavity and lining.
 */
export const thermalMethodElementType = (type: string | undefined, constructionBands: boolean): boolean =>
  !!type && METHOD_TYPES.has(type) && !(constructionBands && type === PARTY_WALL);

/**
 * The methods an element type offers, in order; fewer than two means no choice to show. An
 * existing building takes the age band; a window has no layers.
 */
export function thermalMethods(
  elementType: string,
  constructionBands: boolean,
  /** A ground floor on an existing building has a calculated U-value to take (its drawing is complete). */
  groundCalculated = true,
): { value: ThermalMethod; label: string }[] {
  if (!thermalMethodElementType(elementType, constructionBands)) return [];
  const band = { value: 'band' as const, label: 'Age band' };
  const entered = { value: 'u_value' as const, label: 'U-value' };
  const calculation = {
    value: 'calculation' as const,
    label: constructionBands || elementType === 'BuildingElementGround' ? 'Calculation' : 'Layers',
  };
  // A window's band method is its glazing description; entered, it takes U and g.
  if (elementType === 'BuildingElementTransparent') return constructionBands ? [{ ...band, label: 'Glazing description' }, { ...entered, label: 'U and g' }] : [];
  if (constructionBands && elementType === 'BuildingElementGround' && !groundCalculated) return [band, entered];
  return constructionBands ? [band, calculation, entered] : [entered, calculation];
}

const finite = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
};
const stated = (element: Element, key: string): number | undefined =>
  finite((element.extra_json as Record<string, unknown> | undefined)?.[key]) ?? finite((element as unknown as Record<string, unknown>)[key]);

/**
 * The method an element's stored values say it uses. A file holding both a U-value and a band
 * opens on the U-value, which is the one the converter takes.
 */
export function inferThermalMethod(
  element: Element,
  constructionBands: boolean,
  /** The ground floor's calculated U-value, for a ground floor. */
  groundComputedU?: number | null,
): ThermalMethod {
  const extra = (element.extra_json ?? {}) as Record<string, unknown>;
  if (parseVulcanAssemblyV1FromExtraJson(extra)) return 'calculation';
  const u = stated(element, 'u_value');
  if (element.type === 'BuildingElementGround') {
    if (!constructionBands) return extra[GROUND_U_VALUE_MANUAL_KEY] === true ? 'u_value' : 'calculation';
    if (u === undefined) return 'band';
    return groundComputedU != null && Math.abs(groundComputedU - u) < 5e-4 ? 'calculation' : 'u_value';
  }
  if (u !== undefined || stated(element, 'thermal_resistance_construction') !== undefined
    || (element.type === PARTY_WALL && stated(element, 'u_value_whole_wall') !== undefined)) return 'u_value';
  return constructionBands ? 'band' : 'u_value';
}

/**
 * The existing-building construction fields that only work out the U-value, so a stated U-value
 * or calculation replaces them. What else HEM:EPC reads stays:
 * - a wall's age band, wall type and added insulation (with no build-up its default layers give the
 *   heat capacity and the added insulation applies; with one, HEM:EPC reads only the wall type and
 *   ignores `retrofit_insulation`);
 * - a window's glazing type (its g-value unless one is stated, `window.py` `g_value`);
 * - a roof's age band (its rooflights take it, `roof.py`) and insulation location (the roof type
 *   and its default mass distribution class).
 * The roof and floor details (`HEMIE_DETAIL_FIELDS`) only refine the band's U-value, so they go too.
 */
export function bandOnlyFields(constructionType: string | undefined): readonly string[] {
  if (!constructionType || constructionType.endsWith('_wall')) return [];
  if (constructionType === 'window') return ['age_band', 'glazing_gap'];
  const details = HEMIE_DETAIL_FIELDS[constructionType] ?? [];
  if (constructionType.endsWith('_roof')) return ['insulation_thickness', ...details];
  return ['age_band', 'insulation_location', 'insulation_thickness', ...details];
}

/**
 * The write that switches an element to another method: the old method's values go, in one
 * update (one undo step). Heat capacity and mass distribution stay: every method takes them.
 */
export function thermalMethodSwitchPatch(
  element: Element,
  from: ThermalMethod,
  to: ThermalMethod,
  options: { constructionBands: boolean; constructionType?: string; groundComputedU?: number | null },
): Partial<Element> {
  const extra = { ...((element.extra_json ?? {}) as Record<string, unknown>) };
  const top: Record<string, unknown> = {};
  const clear = (keys: readonly string[]) => {
    for (const key of keys) {
      delete extra[key];
      if ((element as unknown as Record<string, unknown>)[key] !== undefined) top[key] = undefined;
    }
  };
  const ground = element.type === 'BuildingElementGround';
  // A door's "insulated" is taken only with its U-value (HEM:EPC), so it goes with it.
  const uKeys = element.type === PARTY_WALL ? PARTY_WALL_U_KEYS : ['u_value', 'thermal_resistance_construction', 'is_insulated'];
  if (from === 'calculation') clear(['vulcan_assembly_v1', ...uKeys]);
  if (from === 'u_value') clear(uKeys);
  if (from === 'band') clear(bandOnlyFields(options.constructionType));
  if (ground) {
    delete extra[GROUND_U_VALUE_MANUAL_KEY];
    // Without construction bands the floor's U-value follows its calculation unless entered.
    if (to === 'u_value') extra[GROUND_U_VALUE_MANUAL_KEY] = true;
    if (to === 'calculation' && options.groundComputedU != null && options.groundComputedU > 0 && !parseVulcanAssemblyV1FromExtraJson(extra)) {
      extra.u_value = Number(options.groundComputedU.toFixed(4));
      // With construction bands a stated U-value replaces the age band, so the converter must see it as stated.
      if (options.constructionBands) extra[GROUND_U_VALUE_MANUAL_KEY] = true;
    }
  }
  return { ...top, extra_json: extra } as Partial<Element>;
}
