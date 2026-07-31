// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Helpers for extra_json.geometry_face profiled-line-face (variable height along a line wall).
 */

export type ProfileLineFace = {
  kind: 'profiled-line-face';
  top_profile: Array<{ t: number; h: number }>;
  bottom_profile: Array<{ t: number; h: number }>;
};

export function buildProfileLineFaceFromTopHeights(heights: number[]): ProfileLineFace | null {
  const clean = heights.map((h) => Number(h)).filter((h) => Number.isFinite(h) && h >= 0);
  if (clean.length < 2) return null;
  const n = clean.length;
  const top_profile = clean.map((h, i) => ({
    t: n === 1 ? 0 : i / (n - 1),
    h,
  }));
  const bottom_profile = [
    { t: 0, h: 0 },
    { t: 1, h: 0 },
  ];
  return { kind: 'profiled-line-face', top_profile, bottom_profile };
}

export function extractTopHeightsFromExtraJson(extra: unknown): number[] | null {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return null;
  const gf = (extra as Record<string, unknown>).geometry_face;
  if (!gf || typeof gf !== 'object' || Array.isArray(gf)) return null;
  const kind = (gf as Record<string, unknown>).kind;
  if (kind !== 'profiled-line-face') return null;
  const raw = (gf as Record<string, unknown>).top_profile;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const pts = raw
    .filter((p): p is { t: number; h: number } => {
      if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
      const o = p as Record<string, unknown>;
      return typeof o.t === 'number' && typeof o.h === 'number' && Number.isFinite(o.t) && Number.isFinite(o.h);
    })
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;
  return pts.map((p) => p.h);
}
