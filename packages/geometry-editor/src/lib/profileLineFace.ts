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
  /** Set when an edge was fitted to the roof (a snapshot, not a live link). */
  top_mode?: 'roof';
  bottom_mode?: 'roof';
};

/** Smallest gap allowed between the top and bottom edge of a wall face. */
export const MIN_WALL_FACE_GAP_M = 0.01;

/**
 * Reads `extra_json.geometry_face` as a profiled line face without sorting or repairing the
 * points, so {@link wallFaceProblem} sees what is stored. Null when it is not a profiled face.
 */
export function readProfiledLineFace(extra: unknown): ProfileLineFace | null {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return null;
  const gf = (extra as Record<string, unknown>).geometry_face as Record<string, unknown> | undefined;
  if (!gf || typeof gf !== 'object' || gf.kind !== 'profiled-line-face') return null;
  const points = (raw: unknown): ProfilePoint[] =>
    (Array.isArray(raw) ? raw : []).map((p) => ({ t: Number(p?.t), h: Number(p?.h) }));
  return {
    kind: 'profiled-line-face',
    top_profile: points(gf.top_profile),
    bottom_profile: points(gf.bottom_profile),
    ...(gf.top_mode === 'roof' ? { top_mode: 'roof' as const } : {}),
    ...(gf.bottom_mode === 'roof' ? { bottom_mode: 'roof' as const } : {}),
  };
}

/** Every t where either edge bends. */
export function wallFaceBreakpoints(top: ProfilePoint[], bottom: ProfilePoint[]): number[] {
  return Array.from(new Set([...top, ...bottom].map((p) => p.t))).sort((a, b) => a - b);
}

/**
 * The one check for a wall face. Both edges are straight between points, so checking the gap
 * at every bend of either edge proves it everywhere. Heights may not be negative (below the
 * foot). Returns the message to show, or null.
 */
export function wallFaceProblem(
  top: ProfilePoint[],
  bottom: ProfilePoint[],
  widthM: number,
): string | null {
  for (const [label, profile] of [['Top', top], ['Bottom', bottom]] as const) {
    const ordered = profile.length >= 2 && profile.every((p, i) =>
      Number.isFinite(p.t) && Number.isFinite(p.h) && p.t >= 0 && p.t <= 1
      && (i === 0 || p.t > profile[i - 1].t));
    if (!ordered) return `${label} points must run in order along the wall.`;
    if (profile.some((p) => p.h < 0)) return `${label} heights cannot be below the base.`;
  }
  // The edges may meet at the wall ends (a gable triangle whose eaves sit on the foot); between
  // the ends they must stay MIN_WALL_FACE_GAP_M apart.
  const low = wallFaceBreakpoints(top, bottom).filter((t) => {
    const gap = interpolateProfileHeight(top, t) - interpolateProfileHeight(bottom, t);
    return gap < (t === 0 || t === 1 ? 0 : MIN_WALL_FACE_GAP_M) - 1e-9;
  });
  if (low.length === 0) return null;
  const at = (t: number) => `${(t * widthM).toFixed(2)} m`;
  return low.length === 1
    ? `Top must be above bottom (at ${at(low[0])}).`
    : `Top must be above bottom (from ${at(low[0])} to ${at(low[low.length - 1])}).`;
}

/** Two points at the same height: the shape a Flat edge stores. */
export function isFlatProfile(profile: ProfilePoint[], h?: number): boolean {
  return profile.length === 2 && profile[0].h === profile[1].h && (h === undefined || profile[0].h === h);
}

/**
 * Export writes a profiled wall's base_height as its lowest edge (foot + lowest bottom point);
 * the editor stores the foot. Import uses this to undo the offset so the foot round-trips.
 * An invalid face is left alone: validation reports it.
 */
export function wallFootFromExportedBaseHeight(
  baseHeight: number | undefined,
  extra: unknown,
): number | undefined {
  const face = readProfiledLineFace(extra);
  if (baseHeight === undefined || !face || wallFaceProblem(face.top_profile, face.bottom_profile, 1)) {
    return baseHeight;
  }
  const lowest = Math.min(...face.bottom_profile.map((p) => p.h));
  return lowest === 0 ? baseHeight : Math.round((baseHeight - lowest) * 1000) / 1000;
}
