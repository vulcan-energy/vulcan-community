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
 * Where the top edge is not above the bottom edge: the first and last t (0..1) where they are
 * closer than {@link MIN_WALL_FACE_GAP_M} (they may meet at the wall ends, as a gable triangle
 * whose eaves sit on the foot does). Null when they are apart everywhere. Both edges are straight
 * between points, so checking every bend of either edge proves it everywhere.
 */
export function wallFaceOverlap(top: ProfilePoint[], bottom: ProfilePoint[]): [number, number] | null {
  const low = wallFaceBreakpoints(top, bottom).filter((t) => {
    const gap = interpolateProfileHeight(top, t) - interpolateProfileHeight(bottom, t);
    return gap < (t === 0 || t === 1 ? 0 : MIN_WALL_FACE_GAP_M) - 1e-9;
  });
  return low.length === 0 ? null : [low[0]!, low[low.length - 1]!];
}

/**
 * The one check for a wall face. Heights may not be negative (below the foot). Returns the
 * message to show, saying what to change, or null.
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
    if (!ordered) return `${label} points must run in order along the wall. Make each distance larger than the one before it.`;
    if (profile.some((p) => p.h < 0)) return `${label} heights cannot be below the base. Set them to 0 or more.`;
  }
  const overlap = wallFaceOverlap(top, bottom);
  if (!overlap) return null;
  const at = (t: number) => `${(t * widthM).toFixed(2)} m`;
  return overlap[0] === overlap[1]
    ? `Top must be above bottom (at ${at(overlap[0])}). Raise the top or lower the bottom there.`
    : `Top must be above bottom (from ${at(overlap[0])} to ${at(overlap[1])}). Raise the top or lower the bottom there.`;
}

/** Two points at the same height: the shape a Flat edge stores. */
export function isFlatProfile(profile: ProfilePoint[], h?: number): boolean {
  return profile.length === 2 && profile[0].h === profile[1].h && (h === undefined || profile[0].h === h);
}

// Micrometre rounding only removes float noise, so foot and profile heights authored to any
// practical precision survive export → import exactly (2 dp would drift the foot).
const roundMicro = (v: number) => Math.round(v * 1e6) / 1e6;

const lowestBottom = (face: ProfileLineFace) => Math.min(...face.bottom_profile.map((p) => p.h));

/**
 * HEM base_height is the distance from the ground to the element's lowest edge. For a valid
 * profiled wall that is the foot plus its lowest bottom point; the editor stores the foot.
 * {@link wallFootFromExportedBaseHeight} is the inverse, used by the CSV reader.
 */
export function exportedBaseHeightForWallFace(foot: number, face: ProfileLineFace): number {
  const lowest = lowestBottom(face);
  return lowest === 0 ? Math.round(foot * 100) / 100 : roundMicro(foot + lowest);
}

/** Inverse of {@link exportedBaseHeightForWallFace}. An invalid face is left alone: validation reports it. */
export function wallFootFromExportedBaseHeight(
  baseHeight: number | undefined,
  extra: unknown,
): number | undefined {
  const face = readProfiledLineFace(extra);
  if (baseHeight === undefined || !face || wallFaceProblem(face.top_profile, face.bottom_profile, 1)) {
    return baseHeight;
  }
  const lowest = lowestBottom(face);
  return lowest === 0 ? baseHeight : roundMicro(baseHeight - lowest);
}

// Rounded so flipping twice gives back the stored t exactly.
const reverseT = (t: number) => Math.round((1 - t) * 1e12) / 1e12;

/** The same face seen from a wall whose coordinates run the other way. */
export function reverseProfiledLineFace<T extends ProfileLineFace>(face: T): T {
  const reverse = (points: ProfilePoint[]) => points.map((p) => ({ ...p, t: reverseT(p.t) })).reverse();
  return { ...face, top_profile: reverse(face.top_profile), bottom_profile: reverse(face.bottom_profile) };
}

/**
 * For every path that reverses a line wall's coordinates (flip facing, plan mirror): returns
 * extra_json with a profiled face reversed to match, or the same object when there is none.
 */
export function reverseGeometryFaceInExtraJson<T>(extra: T): T {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return extra;
  const face = (extra as Record<string, unknown>).geometry_face as ProfileLineFace | undefined;
  if (!face || face.kind !== 'profiled-line-face' || !Array.isArray(face.top_profile) || !Array.isArray(face.bottom_profile)) {
    return extra;
  }
  return { ...extra, geometry_face: reverseProfiledLineFace(face) };
}

/** What the face readers below need from a line element. */
type LineFaceHost = { height?: unknown; extra_json?: unknown };

/** Sorted profiles of a stored profiled face, or null for a plain element (or a face too broken to read; validation names it). */
function readFaceEdges(el: LineFaceHost): { top: ProfilePoint[]; bottom: ProfilePoint[] } | null {
  const face = readProfiledLineFace(el.extra_json);
  const top = face && normalizeProfilePoints(face.top_profile);
  const bottom = face && normalizeProfilePoints(face.bottom_profile);
  return top && bottom ? { top, bottom } : null;
}

/**
 * Bottom and top edge of a line element at t (0..1 from coordinate 0 to 1), in metres above its
 * foot (`base_height`). A plain element spans 0..height; a profiled face is read from its edges.
 * The one place thermal-bridge and validation code reads a wall's vertical extent.
 */
export function lineFaceEdgesAt(el: LineFaceHost, t: number): { bottom: number; top: number } {
  const face = readFaceEdges(el);
  if (!face) return { bottom: 0, top: typeof el.height === 'number' && el.height > 0 ? el.height : 0 };
  return { bottom: interpolateProfileHeight(face.bottom, t), top: interpolateProfileHeight(face.top, t) };
}

/**
 * How far a shaped bottom's mean is above its lowest point (0 for a plain element). A window's
 * base is its lowest point, so its middle is this much above base + height / 2.
 */
export function bottomMeanAboveLowest(el: LineFaceHost): number {
  const bottom = readFaceEdges(el)?.bottom;
  if (!bottom) return 0;
  const mean = bottom.slice(1).reduce((sum, p, k) => sum + ((p.t - bottom[k]!.t) * (p.h + bottom[k]!.h)) / 2, 0);
  return mean - Math.min(...bottom.map((p) => p.h));
}

/** Lowest bottom and highest top over the whole element (its bounding band above the foot). */
export function lineFaceEnvelope(el: LineFaceHost): { bottom: number; top: number } {
  const face = readFaceEdges(el);
  if (!face) return lineFaceEdgesAt(el, 0);
  return { bottom: Math.min(...face.bottom.map((p) => p.h)), top: Math.max(...face.top.map((p) => p.h)) };
}

/**
 * The parts of the run [loM, hiM] (metres along the line from coordinate 0; the line is `lengthM`
 * long) where the face reaches height `h` above the foot, within `tol`: bottom − tol ≤ h ≤ top + tol.
 * A floor at the foot is `h = 0`: a wall standing on a roof has no run there. A plain element
 * returns the run unchanged; callers keep their own vertical test for it.
 */
export function lineFaceRunsAtHeight(
  el: LineFaceHost,
  lengthM: number,
  loM: number,
  hiM: number,
  h: number,
  tol: number,
): Array<[number, number]> {
  const face = readFaceEdges(el);
  if (!face || lengthM <= 0) return [[loM, hiM]];
  const lo = loM / lengthM;
  const hi = hiM / lengthM;
  const ts = [lo, ...wallFaceBreakpoints(face.top, face.bottom).filter((t) => t > lo && t < hi), hi];
  // Both conditions are linear in t between breakpoints, so each piece keeps one interval.
  const limits = [
    (t: number) => interpolateProfileHeight(face.bottom, t) - tol - h,
    (t: number) => h - interpolateProfileHeight(face.top, t) - tol,
  ];
  const toM = (t: number) => (t === lo ? loM : t === hi ? hiM : t * lengthM);
  const runs: Array<[number, number]> = [];
  for (let i = 0; i < ts.length - 1; i += 1) {
    const a = ts[i]!;
    const b = ts[i + 1]!;
    let s = a;
    let e = b;
    for (const f of limits) {
      const fa = f(a);
      const fb = f(b);
      if (fa <= 0 && fb <= 0) continue;
      if (fa > 0 && fb > 0) { e = s - 1; break; }
      const cross = a + ((b - a) * fa) / (fa - fb);
      if (fa > 0) s = Math.max(s, cross);
      else e = Math.min(e, cross);
    }
    if (e <= s) continue;
    const last = runs[runs.length - 1];
    if (last && Math.abs(last[1] - toM(s)) < 1e-9) last[1] = toM(e);
    else runs.push([toM(s), toM(e)]);
  }
  return runs;
}

/** {@link lineFaceEdgesAt} at the plan point on the element's line nearest `p`. */
export function lineFaceEdgesAtPoint(
  el: LineFaceHost & { coordinates: ReadonlyArray<{ x: number; y: number }> },
  p: { x: number; y: number },
): { bottom: number; top: number } {
  const a = el.coordinates[0]!;
  const b = el.coordinates[1]!;
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = len2 < 1e-18 ? 0 : ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2;
  return lineFaceEdgesAt(el, Math.min(1, Math.max(0, t)));
}

/**
 * A profiled face's outline as (t, h) points: the bottom edge from t = 0 to 1, then the top edge
 * back, without repeating a point where the edges meet (a gable's ends). Null for a plain element
 * or an invalid face (validation names the problem).
 */
export function lineFaceOutline(el: LineFaceHost): ProfilePoint[] | null {
  const raw = readProfiledLineFace(el.extra_json);
  const face = readFaceEdges(el);
  if (!raw || !face || wallFaceProblem(raw.top_profile, raw.bottom_profile, 1)) return null;
  const ring = [...face.bottom, ...[...face.top].reverse()];
  return ring.filter((p, i) => {
    const prev = ring[(i + ring.length - 1) % ring.length]!;
    return p.t !== prev.t || p.h !== prev.h;
  });
}
