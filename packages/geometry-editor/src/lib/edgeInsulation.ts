// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Helpers for `edge_insulation` on BuildingElementGround (Slab_edge_insulation):
 * a JSON array with at most one horizontal and one vertical segment object. An existing
 * building may state a segment's thickness, material and thermal conductivity in place of its
 * resistance.
 */

export type EdgeInsulationOrientation = 'horizontal' | 'vertical';

export interface EdgeInsulationSegmentValues {
  edgeThermalResistance: string;
  /** Width for a horizontal segment, depth for a vertical one. */
  widthOrDepth: string;
  thickness: string;
  material: string;
  thermalConductivity: string;
}

export interface EdgeInsulationFormValues {
  horizontal: EdgeInsulationSegmentValues;
  vertical: EdgeInsulationSegmentValues;
}

const emptySegment = (): EdgeInsulationSegmentValues => ({ edgeThermalResistance: '', widthOrDepth: '', thickness: '', material: '', thermalConductivity: '' });

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const numStr = (x: unknown): string => (typeof x === 'number' && Number.isFinite(x) ? String(x) : '');

/** Parse `extra_json.edge_insulation` into form strings (no defaults). */
export function extraJsonEdgeInsulationToFormValues(value: unknown): EdgeInsulationFormValues {
  const out: EdgeInsulationFormValues = { horizontal: emptySegment(), vertical: emptySegment() };
  if (!Array.isArray(value)) return out;
  for (const seg of value) {
    if (!isRecord(seg)) continue;
    if (seg.type !== 'horizontal' && seg.type !== 'vertical') continue;
    out[seg.type] = {
      edgeThermalResistance: numStr(seg.edge_thermal_resistance),
      widthOrDepth: numStr(seg.type === 'horizontal' ? seg.width : seg.depth),
      thickness: numStr(seg.thickness),
      material: typeof seg.material === 'string' ? seg.material : '',
      thermalConductivity: numStr(seg.thermal_conductivity),
    };
  }
  return out;
}

export type EdgeInsulationSerialized =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'incomplete' };

/**
 * Turn form state into `extra_json.edge_insulation` (array of the filled segments) or `null` when
 * both are empty. Returns `ok: false` while a segment is half filled or not a finite number.
 */
export function formValuesToExtraJsonEdgeInsulation(v: EdgeInsulationFormValues, partial = false): EdgeInsulationSerialized {
  const value: Record<string, unknown>[] = [];
  for (const type of ['horizontal', 'vertical'] as const) {
    const rStr = v[type].edgeThermalResistance.trim();
    const dimStr = v[type].widthOrDepth.trim();
    const thicknessStr = v[type].thickness.trim();
    const kStr = v[type].thermalConductivity.trim();
    const material = v[type].material;
    if (!rStr && !dimStr && !thicknessStr && !kStr && !material) continue;
    // `Number('')` is 0 — treat empty fields as incomplete while the user is typing. An existing
    // building (`partial`) may give one of the two: the conversion takes a default for a blank resistance or vertical depth.
    if (!partial && (!rStr || !dimStr)) return { ok: false, reason: 'incomplete' };
    const [r, dim, thickness, k] = [rStr, dimStr, thicknessStr, kStr].map((str) => (str ? Number(str) : undefined));
    if ([r, dim, thickness, k].some((n) => n !== undefined && !Number.isFinite(n))) return { ok: false, reason: 'incomplete' };
    // A horizontal width has no default.
    if (type === 'horizontal' && !dimStr) return { ok: false, reason: 'incomplete' };
    value.push({
      type,
      ...(r !== undefined && { edge_thermal_resistance: r }),
      ...(dim !== undefined && { [type === 'horizontal' ? 'width' : 'depth']: dim }),
      ...(thickness !== undefined && { thickness }),
      ...(material && { material }),
      ...(k !== undefined && { thermal_conductivity: k }),
    });
  }
  return { ok: true, value: value.length ? value : null };
}

/** How an existing building states its edge insulation: by resistance, or by thickness and material. */
export type EdgeInsulationMethod = 'resistance' | 'thickness';
const THICKNESS_FIELDS = ['thickness', 'material', 'thermalConductivity'] as const;

/** The method the values state, or undefined when they state neither. */
export function edgeInsulationMethod(v: EdgeInsulationFormValues): EdgeInsulationMethod | undefined {
  const segments = [v.horizontal, v.vertical];
  if (segments.some((seg) => seg.edgeThermalResistance.trim())) return 'resistance';
  if (segments.some((seg) => THICKNESS_FIELDS.some((key) => seg[key].trim()))) return 'thickness';
  return undefined;
}

/** The values with the other method's fields cleared on both segments; width and depth stay. */
export function switchEdgeInsulationMethod(v: EdgeInsulationFormValues, to: EdgeInsulationMethod): EdgeInsulationFormValues {
  const clear = (seg: EdgeInsulationSegmentValues): EdgeInsulationSegmentValues =>
    to === 'resistance' ? { ...seg, thickness: '', material: '', thermalConductivity: '' } : { ...seg, edgeThermalResistance: '' };
  return { horizontal: clear(v.horizontal), vertical: clear(v.vertical) };
}
