// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';
import { CLOSE_SHADING_KINDS } from './windowOpenings';
import { windowSections } from './hemieBundles';
import { readProfiledLineFace } from './profileLineFace';

/**
 * The next window starts from the last one: the values an assessor states on a window (its
 * height, sill, opening type, glazing description or U and g, and close shading) carry to the
 * next window drawn. Never its name, host or position, and never the width: the drawn line is
 * the width. A rooflight carries from the last rooflight; a door is not a window and never
 * carries into one.
 */
export type OpeningKind = 'window' | 'rooflight';

/** A window is drawn as a line in a wall; a rooflight as a shape on a roof. */
export function openingKind(element: Element | undefined): OpeningKind | null {
  if (element?.type !== 'BuildingElementTransparent') return null;
  return element.coordinates?.length === 2 ? 'window' : 'rooflight';
}

const THERMAL_KEYS = ['u_value', 'g_value', 'thermal_resistance_construction'] as const;
const TOP_KEYS: Record<OpeningKind, readonly string[]> = {
  window: ['height', 'base_height', 'frame_area_fraction', 'free_area_height', ...THERMAL_KEYS],
  // A rooflight's size and height come from the shape drawn on the roof.
  // Its free area height would outgrow a smaller rooflight, so that stays its own too.
  rooflight: ['frame_area_fraction', ...THERMAL_KEYS],
};
const EXTRA_KEYS: readonly string[] = [
  'window_sections',
  'glazing_type', 'frame_material', 'glazing_gap', 'areal_heat_capacity', 'age_band',
  ...THERMAL_KEYS,
  'has_trickle_vent',
  ...CLOSE_SHADING_KINDS.map(({ kind }) => kind),
];

const stated = (value: unknown) => value !== undefined && value !== null && value !== '';

/** The values a window carries to the next one of its kind; null when it states none. */
export function openingCarry(element: Element | undefined): Partial<Element> | null {
  const kind = openingKind(element);
  if (!kind || !element) return null;
  const record = element as unknown as Record<string, unknown>;
  const extra = (element.extra_json ?? {}) as Record<string, unknown>;
  const top = Object.fromEntries(TOP_KEYS[kind].flatMap((key) => (stated(record[key]) ? [[key, record[key]]] : [])));
  const carriedExtra = Object.fromEntries(EXTRA_KEYS.flatMap((key) => (stated(extra[key]) ? [[key, structuredClone(extra[key])]] : [])));
  // Security risk follows the storey unless the assessor changed it: only a stated one carries,
  // and it carries as stated, so the new window's storey does not reset it.
  const riskFlag = (element as { _windowSecurityRiskUserOverride?: boolean })._windowSecurityRiskUserOverride;
  const riskStated = riskFlag === true || (riskFlag === undefined && extra._window_security_risk_user_override === true);
  if (riskStated && typeof extra.security_risk === 'boolean') {
    carriedExtra.security_risk = extra.security_risk;
    top._windowSecurityRiskUserOverride = true;
  }
  if (!Object.keys(top).length && !Object.keys(carriedExtra).length) return null;
  return { ...top, ...(Object.keys(carriedExtra).length ? { extra_json: carriedExtra } : {}) } as Partial<Element>;
}

const capital = (value: unknown) => {
  const text = String(value);
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const metres = (value: unknown) => `${Number(value).toFixed(2)} m`;

/** The toolbar's line: what the next window takes, so nothing is hidden. */
export function openingCarrySummary(carry: Partial<Element>): string {
  const record = carry as unknown as Record<string, unknown>;
  const extra = (carry.extra_json ?? {}) as Record<string, unknown>;
  const value = (key: string) => (stated(extra[key]) ? extra[key] : record[key]);
  const sections = windowSections({ extra_json: extra } as unknown as Element);
  const statedOf = (keys: readonly string[]) => keys.flatMap((key) => (stated(extra[key]) ? [capital(extra[key])] : []));
  const glazing = statedOf(['glazing_type', 'frame_material', 'glazing_gap']);
  const shading = statedOf(CLOSE_SHADING_KINDS.map(({ kind }) => kind));
  return [
    stated(record.height) ? `${metres(record.height)} high` : '',
    stated(record.base_height) ? `sill ${metres(record.base_height)}` : '',
    sections.flatMap((section) => (stated(section.windowType) ? [capital(section.windowType)] : [])).join(' + '),
    glazing.join(', '),
    stated(value('u_value')) ? `U ${value('u_value')}` : '',
    stated(value('g_value')) ? `g ${value('g_value')}` : '',
    shading.length ? `shading: ${shading.join(', ')}` : '',
    extra.has_trickle_vent === true ? 'trickle vent' : '',
    typeof extra.security_risk === 'boolean' ? `security risk: ${extra.security_risk ? 'yes' : 'no'}` : '',
  ].filter(Boolean).join(' · ');
}

const sameValue = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.005;
  return JSON.stringify(a) === JSON.stringify(b);
};
/** A carry as flat keys: top-level ones as they are, extra_json ones as `extra.<key>`. */
const flatCarry = (carry: Partial<Element> | null): Record<string, unknown> => {
  const { extra_json: extra, ...top } = (carry ?? {}) as Record<string, unknown>;
  return { ...top, ...Object.fromEntries(Object.entries((extra ?? {}) as Record<string, unknown>).map(([key, value]) => [`extra.${key}`, value])) };
};
const changedKeys = (a: Partial<Element> | null, b: Partial<Element> | null): string[] => {
  const left = flatCarry(a);
  const right = flatCarry(b);
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((key) => !sameValue(left[key], right[key]));
};

/**
 * The other windows of the same kind with this window's width, outline and carried values, in
 * model order: the windows "like this one" that an edit to it can be applied to.
 */
export function matchingOpenings(element: Element | undefined, elements: readonly Element[]): Element[] {
  const kind = openingKind(element);
  if (!kind || !element) return [];
  const carry = openingCarry(element);
  if (!carry) return [];
  const width = (element as { width?: number }).width;
  const face = readProfiledLineFace(element.extra_json);
  return elements.filter((other) => other.id !== element.id
    && openingKind(other) === kind
    && (kind === 'rooflight' || sameValue((other as { width?: number }).width, width))
    && sameValue(readProfiledLineFace(other.extra_json), face)
    && changedKeys(openingCarry(other), carry).length === 0);
}

/**
 * The carried values (flat keys) an edit changed on one window. None once its outline changed:
 * a shaped window's height comes from its shape, which an apply does not copy.
 */
export function carryChanges(before: Element, after: Element): string[] {
  if (!sameValue(readProfiledLineFace(before.extra_json), readProfiledLineFace(after.extra_json))) return [];
  return changedKeys(openingCarry(before), openingCarry(after));
}

/** Copies the changed carried values from `source` onto `target`; everything else stays the target's. */
export function carryPatch(target: Element, source: Element, keys: readonly string[]): Partial<Element> {
  const record = source as unknown as Record<string, unknown>;
  const sourceExtra = (source.extra_json ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  const extra = { ...((target.extra_json ?? {}) as Record<string, unknown>) };
  let extraChanged = false;
  for (const key of keys) {
    if (key.startsWith('extra.')) {
      const name = key.slice('extra.'.length);
      if (stated(sourceExtra[name])) extra[name] = structuredClone(sourceExtra[name]);
      else delete extra[name];
      extraChanged = true;
    } else {
      // A stated security risk may be marked only in extra_json (older files): read it as carried.
      patch[key] = key === '_windowSecurityRiskUserOverride' ? openingCarry(source)?._windowSecurityRiskUserOverride : record[key];
    }
  }
  if (extraChanged) patch.extra_json = extra;
  return patch as Partial<Element>;
}

const GLAZING = 'glazing';
const CHANGE_NAMES: Record<string, string> = {
  height: 'height', base_height: 'sill', window_sections: 'opening type', free_area_height: 'free area height',
  frame_area_fraction: GLAZING, u_value: GLAZING, g_value: GLAZING, thermal_resistance_construction: GLAZING,
  glazing_type: GLAZING, frame_material: GLAZING, glazing_gap: GLAZING, areal_heat_capacity: GLAZING, age_band: GLAZING,
  has_trickle_vent: 'trickle vent',
  ...Object.fromEntries(CLOSE_SHADING_KINDS.map(({ kind }) => [kind, 'close shading'])),
  security_risk: 'security risk', _windowSecurityRiskUserOverride: 'security risk',
};
const CHANGE_ORDER = ['height', 'sill', 'opening type', 'free area height', GLAZING, 'trickle vent', 'close shading', 'security risk'];

/** "Height 1.3 m" for one size change; "Height and sill" or "Height, glazing and close shading" otherwise. */
export function carryChangeLabel(keys: readonly string[], source: Element): string {
  const names = CHANGE_ORDER.filter((name) => keys.some((key) => CHANGE_NAMES[key.replace(/^extra\./, '')] === name));
  const record = source as unknown as Record<string, unknown>;
  const only = keys.length === 1 ? keys[0]! : '';
  const value = (only === 'height' || only === 'base_height') && stated(record[only]) ? ` ${Number(Number(record[only]).toFixed(2))} m` : '';
  const text = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');
  return `${capital(text)}${value}`;
}
