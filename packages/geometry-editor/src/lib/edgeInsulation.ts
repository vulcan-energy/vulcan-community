// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Helpers for `edge_insulation` on BuildingElementGround (Slab_edge_insulation):
 * a JSON array with at most one horizontal and one vertical segment object.
 */

export type EdgeInsulationOrientation = 'horizontal' | 'vertical';

export interface EdgeInsulationSegmentValues {
  edgeThermalResistance: string;
  /** Width for a horizontal segment, depth for a vertical one. */
  widthOrDepth: string;
}

export interface EdgeInsulationFormValues {
  horizontal: EdgeInsulationSegmentValues;
  vertical: EdgeInsulationSegmentValues;
}

const emptySegment = (): EdgeInsulationSegmentValues => ({ edgeThermalResistance: '', widthOrDepth: '' });

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
    if (seg.type === 'horizontal') {
      out.horizontal = { edgeThermalResistance: numStr(seg.edge_thermal_resistance), widthOrDepth: numStr(seg.width) };
    } else if (seg.type === 'vertical') {
      out.vertical = { edgeThermalResistance: numStr(seg.edge_thermal_resistance), widthOrDepth: numStr(seg.depth) };
    }
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
    if (!rStr && !dimStr) continue;
    // `Number('')` is 0 — treat empty fields as incomplete while the user is typing. An existing
    // building (`partial`) may give one of the two: the conversion takes a default for a blank resistance or vertical depth.
    if (!partial && (!rStr || !dimStr)) return { ok: false, reason: 'incomplete' };
    const r = rStr ? Number(rStr) : undefined;
    const dim = dimStr ? Number(dimStr) : undefined;
    if ((r !== undefined && !Number.isFinite(r)) || (dim !== undefined && !Number.isFinite(dim))) return { ok: false, reason: 'incomplete' };
    // A horizontal width has no default.
    if (type === 'horizontal' && !dimStr) return { ok: false, reason: 'incomplete' };
    value.push({ type, ...(r !== undefined && { edge_thermal_resistance: r }), ...(dim !== undefined && { [type === 'horizontal' ? 'width' : 'depth']: dim }) });
  }
  return { ok: true, value: value.length ? value : null };
}
