// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * HEM Table 3.6.b — solar transmittance reduction factors for curtains/blinds.
 * Maps to `WindowTreatment.trans_red` with `delta_r` and `controls` from the form.
 */

export type WindowTreatmentControl =
  | 'auto_motorised'
  | 'combined_light_blind_HVAC'
  | 'manual'
  | 'manual_motorised';

export type TreatmentCategory = 'white_venetian' | 'white_curtains' | 'coloured' | 'aluminium';

/** Persisted next to `treatment` so the simplified UI can round-trip table selections. */
export interface TreatmentUiV1 {
  v: 1;
  source: 'table' | 'custom';
  category: TreatmentCategory;
  tier: 0 | 1 | 2;
  mounting: 'inside' | 'outside';
  /** Coloured textiles only */
  colouredKind?: 'blinds' | 'curtains';
}

export const TREATMENT_UI_KEY = '_treatment_ui' as const;

export interface HemTableRow {
  alpha: number;
  tau: number;
  inside: number;
  outside: number;
}

const TABLE: Record<TreatmentCategory, { tiers: HemTableRow[]; fixedType: 'blinds' | 'curtains' | null }> = {
  white_venetian: {
    fixedType: 'blinds',
    tiers: [
      { alpha: 0.1, tau: 0.05, inside: 0.25, outside: 0.1 },
      { alpha: 0.1, tau: 0.1, inside: 0.3, outside: 0.15 },
      { alpha: 0.1, tau: 0.3, inside: 0.45, outside: 0.35 },
    ],
  },
  white_curtains: {
    fixedType: 'curtains',
    tiers: [
      { alpha: 0.1, tau: 0.5, inside: 0.65, outside: 0.55 },
      { alpha: 0.1, tau: 0.7, inside: 0.8, outside: 0.75 },
      { alpha: 0.1, tau: 0.9, inside: 0.95, outside: 0.95 },
    ],
  },
  coloured: {
    fixedType: null,
    tiers: [
      { alpha: 0.3, tau: 0.1, inside: 0.42, outside: 0.17 },
      { alpha: 0.3, tau: 0.3, inside: 0.57, outside: 0.37 },
      { alpha: 0.3, tau: 0.5, inside: 0.77, outside: 0.57 },
    ],
  },
  aluminium: {
    fixedType: 'blinds',
    tiers: [{ alpha: 0.2, tau: 0.05, inside: 0.2, outside: 0.08 }],
  },
};

export function getTierRow(category: TreatmentCategory, tier: 0 | 1 | 2): HemTableRow | undefined {
  const t = TABLE[category]?.tiers[tier];
  return t;
}

export function getTableTransRed(
  category: TreatmentCategory,
  tier: 0 | 1 | 2,
  mounting: 'inside' | 'outside',
): number | undefined {
  const row = getTierRow(category, tier);
  if (!row) return undefined;
  return mounting === 'inside' ? row.inside : row.outside;
}

export function categoryDefaultType(
  category: TreatmentCategory,
  colouredKind: 'blinds' | 'curtains',
): 'blinds' | 'curtains' {
  const f = TABLE[category].fixedType;
  if (f) return f;
  return colouredKind;
}

/** Curtains are normally room-side; outside is unusual. */
export function mountingOutsideAllowed(category: TreatmentCategory, colouredKind: 'blinds' | 'curtains'): boolean {
  if (category === 'white_curtains') return false;
  if (category === 'coloured' && colouredKind === 'curtains') return false;
  return true;
}

export interface WindowTreatmentFormValues {
  enabled: boolean;
  source: 'table' | 'custom';
  category: TreatmentCategory | '';
  tier: 0 | 1 | 2;
  mounting: 'inside' | 'outside';
  colouredKind: 'blinds' | 'curtains';
  delta_r: string;
  /** HEM `WindowTreatment.controls` (single source — no duplicate UI) */
  controls: WindowTreatmentControl;
  custom_type: 'blinds' | 'curtains' | '';
  custom_trans_red: string;
}

export function defaultWindowTreatmentFormValues(): WindowTreatmentFormValues {
  return {
    enabled: false,
    source: 'table',
    category: 'white_venetian',
    tier: 0,
    mounting: 'inside',
    colouredKind: 'blinds',
    delta_r: '',
    controls: 'manual',
    custom_type: '',
    custom_trans_red: '',
  };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function parseTreatmentUi(raw: unknown): TreatmentUiV1 | null {
  if (!isRecord(raw)) return null;
  if (raw.v !== 1) return null;
  if (raw.source !== 'table' && raw.source !== 'custom') return null;
  const cat = raw.category;
  if (cat !== 'white_venetian' && cat !== 'white_curtains' && cat !== 'coloured' && cat !== 'aluminium') {
    return null;
  }
  const tier = raw.tier;
  if (tier !== 0 && tier !== 1 && tier !== 2) return null;
  const m = raw.mounting;
  if (m !== 'inside' && m !== 'outside') return null;
  const ck = raw.colouredKind;
  if (ck !== undefined && ck !== 'blinds' && ck !== 'curtains') return null;
  return {
    v: 1,
    source: raw.source,
    category: cat,
    tier,
    mounting: m,
    colouredKind: ck,
  };
}

function isWindowTreatmentControl(s: string): s is WindowTreatmentControl {
  return (
    s === 'auto_motorised' ||
    s === 'combined_light_blind_HVAC' ||
    s === 'manual' ||
    s === 'manual_motorised'
  );
}

function resolveControls(form: WindowTreatmentFormValues): WindowTreatmentControl | undefined {
  return isWindowTreatmentControl(form.controls) ? form.controls : undefined;
}

/** Build form from `extra_json.treatment` + optional `_treatment_ui`. */
export function extraJsonToWindowTreatmentForm(
  treatment: unknown,
  treatmentUi: unknown,
): WindowTreatmentFormValues {
  const base = defaultWindowTreatmentFormValues();
  const ui = parseTreatmentUi(treatmentUi);
  if (!Array.isArray(treatment) || treatment.length === 0) {
    return base;
  }
  const first = treatment[0];
  if (!isRecord(first)) return base;
  const tr = first.trans_red;
  const dr = first.delta_r;
  const ty = first.type;
  const ct = first.controls;
  if (typeof tr !== 'number' || !Number.isFinite(tr)) return base;
  if (typeof dr !== 'number' || !Number.isFinite(dr)) return base;
  if (ty !== 'blinds' && ty !== 'curtains') return base;
  if (typeof ct !== 'string' || !isWindowTreatmentControl(ct)) return base;

  base.enabled = true;
  base.delta_r = String(dr);
  base.controls = ct;

  if (ui) {
    base.source = ui.source;
    base.category = ui.category;
    base.tier = ui.tier;
    base.mounting = ui.mounting;
    if (ui.colouredKind) base.colouredKind = ui.colouredKind;
    const expected = getTableTransRed(ui.category, ui.tier, ui.mounting);
    if (ui.source === 'table' && expected !== undefined && Math.abs(expected - tr) > 1e-6) {
      // Value differs from Table 3.6.b — treat as custom so it round-trips (use "Custom solar" to edit).
      base.source = 'custom';
      base.custom_type = ty;
      base.custom_trans_red = String(tr);
    }
    if (ui.source === 'custom') {
      base.custom_type = ty;
      base.custom_trans_red = String(tr);
    }
    return base;
  }

  // No UI snapshot: try to match table (e.g. hand-edited JSON still on table values)
  for (const cat of Object.keys(TABLE) as TreatmentCategory[]) {
    const kinds: readonly ('blinds' | 'curtains')[] =
      cat === 'coloured'
        ? (['blinds', 'curtains'] as const)
        : ([categoryDefaultType(cat, 'blinds')] as ('blinds' | 'curtains')[]);
    for (const ck of kinds) {
      if (categoryDefaultType(cat, ck) !== ty) continue;
      const maxT = TABLE[cat].tiers.length;
      for (let ti = 0; ti < maxT; ti++) {
        for (const m of ['inside', 'outside'] as const) {
          if (!mountingOutsideAllowed(cat, ck) && m === 'outside') continue;
          const expected = getTableTransRed(cat, ti as 0 | 1 | 2, m);
          if (expected === undefined) continue;
          if (Math.abs(expected - tr) > 1e-5) continue;
          base.source = 'table';
          base.category = cat;
          base.tier = ti as 0 | 1 | 2;
          base.mounting = m;
          if (cat === 'coloured') base.colouredKind = ck;
          return base;
        }
      }
    }
  }

  base.source = 'custom';
  base.custom_type = ty;
  base.custom_trans_red = String(tr);
  return base;
}

export type WindowTreatmentSerialized =
  | { ok: true; treatment: unknown; treatmentUi: TreatmentUiV1 | null }
  | { ok: false; reason: 'incomplete' };

/**
 * Serialize form to `treatment` (single-element array or null) and `_treatment_ui` (or null).
 */
export function windowTreatmentFormToExtraJson(form: WindowTreatmentFormValues): WindowTreatmentSerialized {
  if (!form.enabled) {
    return { ok: true, treatment: null, treatmentUi: null };
  }

  const deltaRStr = form.delta_r.trim();
  if (!deltaRStr) {
    return { ok: false, reason: 'incomplete' };
  }
  const delta_r = Number(deltaRStr);
  if (!Number.isFinite(delta_r)) {
    return { ok: false, reason: 'incomplete' };
  }

  const controls = resolveControls(form);
  if (!controls) {
    return { ok: false, reason: 'incomplete' };
  }

  if (form.source === 'custom') {
    const tty = form.custom_type;
    if (tty !== 'blinds' && tty !== 'curtains') {
      return { ok: false, reason: 'incomplete' };
    }
    const trStr = form.custom_trans_red.trim();
    if (!trStr) {
      return { ok: false, reason: 'incomplete' };
    }
    const trans_red = Number(trStr);
    if (!Number.isFinite(trans_red)) {
      return { ok: false, reason: 'incomplete' };
    }
    const treatmentUi: TreatmentUiV1 = {
      v: 1,
      source: 'custom',
      category: 'white_venetian',
      tier: 0,
      mounting: 'inside',
    };
    return {
      ok: true,
      treatment: [{ type: tty, controls, delta_r, trans_red }],
      treatmentUi,
    };
  }

  // Table
  if (!form.category) {
    return { ok: false, reason: 'incomplete' };
  }
  const cat = form.category;
  const tier: 0 | 1 | 2 = cat === 'aluminium' ? 0 : form.tier;
  if (cat === 'coloured' && form.colouredKind !== 'blinds' && form.colouredKind !== 'curtains') {
    return { ok: false, reason: 'incomplete' };
  }
  if (!mountingOutsideAllowed(cat, form.colouredKind) && form.mounting === 'outside') {
    return { ok: false, reason: 'incomplete' };
  }

  const trans_red = getTableTransRed(cat, tier, form.mounting);
  if (trans_red === undefined) {
    return { ok: false, reason: 'incomplete' };
  }

  const wtype = categoryDefaultType(cat, form.colouredKind);

  const treatmentUi: TreatmentUiV1 = {
    v: 1,
    source: 'table',
    category: cat,
    tier,
    mounting: form.mounting,
    colouredKind: cat === 'coloured' ? form.colouredKind : undefined,
  };

  return {
    ok: true,
    treatment: [{ type: wtype, controls, delta_r, trans_red }],
    treatmentUi,
  };
}
