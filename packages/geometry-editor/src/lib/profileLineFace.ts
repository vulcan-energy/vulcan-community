// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Helpers for extra_json.geometry_face profiled-line-face (variable height along a line wall).
 */

export type ProfilePoint = { t: number; h: number };

export function normalizeProfilePoints(raw: unknown): ProfilePoint[] | null {
  if (!Array.isArray(raw)) return null;

  const sorted = raw
    .filter(
      (point): point is { t: number; h: number } =>
        !!point &&
        typeof point === 'object' &&
        typeof (point as Record<string, unknown>).t === 'number' &&
        Number.isFinite((point as Record<string, unknown>).t) &&
        typeof (point as Record<string, unknown>).h === 'number' &&
        Number.isFinite((point as Record<string, unknown>).h),
    )
    .map((point) => ({
      t: Math.min(Math.max(point.t, 0), 1),
      h: point.h,
    }))
    .sort((left, right) => left.t - right.t);

  if (sorted.length < 2) return null;

  const deduped: ProfilePoint[] = [];
  for (const point of sorted) {
    if (deduped.length > 0 && Math.abs(deduped[deduped.length - 1].t - point.t) < 1e-9) {
      deduped[deduped.length - 1] = point;
      continue;
    }
    deduped.push(point);
  }

  if (deduped.length < 2) return null;
  if (deduped[0].t > 0) deduped.unshift({ t: 0, h: deduped[0].h });
  if (deduped[deduped.length - 1].t < 1) deduped.push({ t: 1, h: deduped[deduped.length - 1].h });
  deduped[0] = { ...deduped[0], t: 0 };
  deduped[deduped.length - 1] = { ...deduped[deduped.length - 1], t: 1 };
  return deduped;
}

export function interpolateProfileHeight(profile: ProfilePoint[], t: number): number {
  if (profile.length === 0) return 0;
  if (t <= profile[0].t) return profile[0].h;
  if (t >= profile[profile.length - 1].t) return profile[profile.length - 1].h;

  for (let index = 0; index < profile.length - 1; index += 1) {
    const start = profile[index];
    const end = profile[index + 1];
    if (t < start.t || t > end.t) continue;
    const span = end.t - start.t;
    if (Math.abs(span) < 1e-9) return end.h;
    const ratio = (t - start.t) / span;
    return start.h + (end.h - start.h) * ratio;
  }

  return profile[profile.length - 1].h;
}

export type ProfileLineFace = {
  kind: 'profiled-line-face';
  top_profile: ProfilePoint[];
  bottom_profile: ProfilePoint[];
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
