// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Helpers for `edge_insulation` on BuildingElementGround (Slab_edge_insulation):
 * a JSON array of horizontal / vertical segment objects (we only edit the first entry in the UI).
 */

export type EdgeInsulationOrientation = 'horizontal' | 'vertical';

export interface EdgeInsulationFormValues {
  orientation: '' | EdgeInsulationOrientation;
  edgeThermalResistance: string;
  widthOrDepth: string;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Parse `extra_json.edge_insulation` into form strings (no defaults). */
export function extraJsonEdgeInsulationToFormValues(value: unknown): EdgeInsulationFormValues {
  if (value === null || value === undefined) {
    return { orientation: '', edgeThermalResistance: '', widthOrDepth: '' };
  }
  if (!Array.isArray(value) || value.length === 0) {
    return { orientation: '', edgeThermalResistance: '', widthOrDepth: '' };
  }
  const first = value[0];
  if (!isRecord(first)) {
    return { orientation: '', edgeThermalResistance: '', widthOrDepth: '' };
  }
  const t = first.type;
  const r = first.edge_thermal_resistance;
  if (t === 'horizontal') {
    const w = first.width;
    return {
      orientation: 'horizontal',
      edgeThermalResistance: typeof r === 'number' && Number.isFinite(r) ? String(r) : '',
      widthOrDepth: typeof w === 'number' && Number.isFinite(w) ? String(w) : '',
    };
  }
  if (t === 'vertical') {
    const d = first.depth;
    return {
      orientation: 'vertical',
      edgeThermalResistance: typeof r === 'number' && Number.isFinite(r) ? String(r) : '',
      widthOrDepth: typeof d === 'number' && Number.isFinite(d) ? String(d) : '',
    };
  }
  return { orientation: '', edgeThermalResistance: '', widthOrDepth: '' };
}

export type EdgeInsulationSerialized =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'incomplete' };

/**
 * Turn form state into `extra_json.edge_insulation` (single-element array) or `null` when cleared.
 * Returns `ok: false` while orientation is chosen but numbers are not yet valid finite values.
 */
export function formValuesToExtraJsonEdgeInsulation(v: EdgeInsulationFormValues): EdgeInsulationSerialized {
  if (!v.orientation) {
    return { ok: true, value: null };
  }
  const rStr = v.edgeThermalResistance.trim();
  const dimStr = v.widthOrDepth.trim();
  // `Number('')` is 0 — treat empty fields as incomplete while the user is typing.
  if (!rStr || !dimStr) {
    return { ok: false, reason: 'incomplete' };
  }
  const r = Number(rStr);
  const dim = Number(dimStr);
  if (!Number.isFinite(r) || !Number.isFinite(dim)) {
    return { ok: false, reason: 'incomplete' };
  }
  if (v.orientation === 'horizontal') {
    return {
      ok: true,
      value: [{ type: 'horizontal', edge_thermal_resistance: r, width: dim }],
    };
  }
  return {
    ok: true,
    value: [{ type: 'vertical', edge_thermal_resistance: r, depth: dim }],
  };
}
