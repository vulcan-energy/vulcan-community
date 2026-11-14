// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Bay window and conservatory bundles for existing-building EPC models. Like a dormer bundle,
// a bundle is a set of ordinary elements, so it draws, renders and exports like any other
// geometry. Each member carries `extra_json.hemie_bundle` (kind, bundle id, role, host wall);
// the front wall is the anchor: a child of the host wall that holds the parameters and nets
// the opening it covers from the host wall's area.

import type { BuildingElementGround, BuildingElementOpaque, Element } from '../geometry/types';
import { normalizeOrientation360Deg, roundToTwoDecimals } from '../geometry/constants';
import { orientation360FromSegmentOutwardModelXY } from './openingSegmentOutward';
import { isPointInPolygon2D } from './pointInPolygon';

export type HemieBundleKind = 'bay' | 'conservatory';
export type ConservatoryType = 'non-separated' | 'separated' | 'unheated';
/** HEMIE's unheated space types for a sheltered wall. */
export type AdjacentSpaceType = 'corridor' | 'garage' | 'roof void' | 'stairwell';

export interface BayParameters {
  /** Distance along the host wall, from its first point to the middle of the opening (m). */
  centre: number;
  openingWidth: number;
  depth: number;
  /** Width of the front facet (m): the opening width is a square bay. */
  frontWidth: number;
  /** Height of the bay walls (m); absent, the host wall's height. */
  wallHeight?: number;
  roof: 'flat' | 'pitched' | 'none';
  sideWindows: boolean;
  sillHeight: number;
  windowHeight: number;
}

export interface ConservatoryParameters {
  centre: number;
  width: number;
  depth: number;
  /** Floor to eaves (m). */
  wallHeight: number;
  /** Opaque wall below the glazing (m). */
  dwarfWallHeight: number;
  /** Dual: a ridge from the host wall to a gable over the front wall. */
  roof: 'flat' | 'lean-to' | 'dual';
  roofPitch: number;
  conservatoryType: ConservatoryType;
  /** Unheated only: the space the host wall, sheltered where it adjoins, borders. */
  adjacentSpaceType?: AdjacentSpaceType;
}

export type HemieBundleParameters = BayParameters | ConservatoryParameters;

export interface HemieBundleTag {
  kind: HemieBundleKind;
  bundle_id: string;
  role: string;
  host_wall: string;
  conservatory_type?: ConservatoryType;
  adjacent_space_type?: AdjacentSpaceType;
  /** On the anchor (front wall) only: the parameters, and the stem of the member names. */
  parameters?: HemieBundleParameters;
  bundle_name?: string;
}

export interface HemieBundleMemberDraft {
  role: string;
  type: 'BuildingElementOpaque' | 'BuildingElementTransparent' | 'BuildingElementGround';
  name: string;
  parent_element: string | null;
  updates: Record<string, unknown> & { coordinates: Element['coordinates']; extra_json: Record<string, unknown> };
}

/** HEMIE's pitched bay roof is one 35° slope facing the wall (the drawing follows it). */
const BAY_ROOF_PITCH = 35;
const WINDOW_INSET = 0.1;
const MIN_FACET = 0.3;

export const BAY_DEFAULTS: Omit<BayParameters, 'centre'> = {
  openingWidth: 2,
  depth: 0.6,
  frontWidth: 0.8,
  roof: 'flat',
  sideWindows: true,
  sillHeight: 0.8,
  windowHeight: 1.3,
};

export const CONSERVATORY_DEFAULTS: Omit<ConservatoryParameters, 'centre'> = {
  width: 3,
  depth: 3,
  wallHeight: 2.4,
  dwarfWallHeight: 0.6,
  roof: 'lean-to',
  roofPitch: 20,
  conservatoryType: 'non-separated',
};

export function getHemieBundle(element: Element | null | undefined): HemieBundleTag | null {
  const tag = element?.extra_json?.hemie_bundle as Partial<HemieBundleTag> | undefined;
  if (!tag || (tag.kind !== 'bay' && tag.kind !== 'conservatory') || !tag.bundle_id || !tag.role) return null;
  return tag as HemieBundleTag;
}

export function getHemieBundleMembers(elements: Iterable<Element>, bundleId: string): Element[] {
  return [...elements].filter((element) => getHemieBundle(element)?.bundle_id === bundleId);
}

/** A straight wall a bundle can be placed on: a two-point vertical opaque wall that is not itself a member. */
export function isHemieBundleHost(element: Element | null | undefined): element is BuildingElementOpaque {
  return element?.type === 'BuildingElementOpaque'
    && element.coordinates.length === 2
    && !element.is_external_door
    && (element.pitch === undefined || element.pitch === 90)
    && !getHemieBundle(element)
    && !element.extra_json?.dormer_bundle;
}

type V = [number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k];
const round3 = (n: number) => Math.round(n * 1000) / 1000;

interface HostFrame {
  start: V;
  length: number;
  /** Along the host wall. */
  t: V;
  /** Outward: the side the wall faces (right of its direction). */
  n: V;
  level: number;
  base: number;
  height: number;
}

function hostFrame(host: BuildingElementOpaque): HostFrame {
  const [A, B] = host.coordinates;
  const length = Math.hypot(B.x - A.x, B.y - A.y);
  const t: V = [(B.x - A.x) / length, (B.y - A.y) / length];
  return {
    start: [A.x, A.y],
    length,
    t,
    n: [t[1], -t[0]],
    level: Math.floor(A.z),
    base: host.base_height ?? 0,
    height: host.height,
  };
}

/** Distance along the host wall of the point nearest `p`, kept clear of its ends by `half`. */
export function centreOnHost(host: BuildingElementOpaque, p: { x: number; y: number }, half: number): number {
  const f = hostFrame(host);
  const along = (p.x - f.start[0]) * f.t[0] + (p.y - f.start[1]) * f.t[1];
  return round3(Math.min(Math.max(along, half), f.length - half));
}

function bearing(a: V, b: V, offset: number): number {
  return roundToTwoDecimals(normalizeOrientation360Deg(
    (orientation360FromSegmentOutwardModelXY(a[0], a[1], b[0], b[1], 0) ?? 0) - offset,
  ));
}

function uniqueStem(kind: string, existingNames: Iterable<string>): string {
  const names = [...existingNames];
  for (let i = 1; ; i += 1) {
    const stem = `${kind} ${i}`;
    if (!names.some((name) => name === stem || name.startsWith(`${stem} `))) return stem;
  }
}

function wall(f: HostFrame, a: V, b: V, height: number, offset: number, extra: Record<string, unknown>) {
  const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return {
    coordinates: [{ x: a[0], y: a[1], z: f.level }, { x: b[0], y: b[1], z: f.level }],
    width: round3(width),
    height,
    area: round3(width * height),
    pitch: 90,
    orientation360: bearing(a, b, offset),
    base_height: f.base,
    extra_json: extra,
  };
}

/** A window centred in wall a→b, inset at each end, from `sill` above the wall base. */
function windowIn(f: HostFrame, a: V, b: V, sill: number, height: number, offset: number, extra: Record<string, unknown>) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const width = round3(length - 2 * WINDOW_INSET);
  const u: V = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const p = add(a, scale(u, WINDOW_INSET));
  const q = add(a, scale(u, length - WINDOW_INSET));
  const base = round3(f.base + sill);
  return {
    coordinates: [{ x: p[0], y: p[1], z: f.level }, { x: q[0], y: q[1], z: f.level }],
    width,
    height,
    area: round3(width * height),
    pitch: 90,
    orientation360: bearing(a, b, offset),
    base_height: base,
    free_area_height: height,
    mid_height: round3(base + height / 2),
    max_window_open_area: round3(width * height),
    extra_json: extra,
  };
}

function polygon(points: V[], z: number) {
  return points.map(([x, y]) => ({ x, y, z }));
}

/**
 * A rooflight over the whole roof plane: a conservatory roof is glazed throughout unless the user
 * resizes its glazing, and its glazing fraction is the glazed share of the plane.
 */
function rooflight(
  eavesA: V,
  eavesB: V,
  run: number,
  pitch: number,
  eaves: number,
  orientation360: number,
  level: number,
  extra: Record<string, unknown>,
) {
  const width = round3(Math.hypot(eavesB[0] - eavesA[0], eavesB[1] - eavesA[1]));
  const height = round3(run / Math.cos((pitch * Math.PI) / 180));
  return {
    coordinates: [{ x: eavesA[0], y: eavesA[1], z: level }, { x: eavesB[0], y: eavesB[1], z: level }],
    width,
    height,
    area: round3(width * height),
    pitch,
    orientation360,
    base_height: round3(eaves),
    free_area_height: height,
    mid_height: round3(eaves + (height / 2) * Math.sin((pitch * Math.PI) / 180)),
    max_window_open_area: round3(width * height),
    extra_json: extra,
  };
}

function profile(high: number, low: number, rising: boolean) {
  return {
    kind: 'profiled-line-face',
    top_profile: rising ? [{ t: 0, h: low }, { t: 1, h: high }] : [{ t: 0, h: high }, { t: 1, h: low }],
    bottom_profile: [{ t: 0, h: 0 }, { t: 1, h: 0 }],
  };
}

const FLOOR_FIELDS = ['floor_type', 'depth_basement_floor', 'thickness_walls'] as const;

/** The floor fields a bay or conservatory floor takes from the dwelling's ground floor. */
function floorFieldsFrom(ground: BuildingElementGround | null | undefined): Record<string, unknown> {
  if (!ground) return {};
  const { floor_type, depth_basement_floor, thickness_walls } = ground;
  const fabric = Object.fromEntries(Object.entries(ground.extra_json ?? {}).filter(([key]) => key !== 'hemie_bundle'));
  return { floor_type, depth_basement_floor, thickness_walls, extra_json: fabric };
}

export interface BundleDraftInput<P> {
  host: BuildingElementOpaque;
  parameters: P;
  /** The ground floor under the host wall, whose floor type and fabric a new floor takes. */
  groundFloor?: BuildingElementGround | null;
  existingNames: Iterable<string>;
  globalOrientationOffset: number;
  /** Regenerating: the bundle keeps its id, name and member names. */
  bundleId?: string;
  bundleName?: string;
  names?: Record<string, string>;
}

export interface HemieBundleDraft {
  bundleId: string;
  members: HemieBundleMemberDraft[];
}

/**
 * A bay's saved parameters with a front width: a bay saved with a side angle (degrees to the
 * host wall) gets the front width that angle gives.
 */
export function bayParameters(saved: BayParameters & { sideAngle?: number }): BayParameters {
  if (typeof saved.frontWidth === 'number' || typeof saved.sideAngle !== 'number') return saved;
  const { sideAngle, ...rest } = saved;
  const taper = sideAngle >= 90 ? 0 : saved.depth / Math.tan((sideAngle * Math.PI) / 180);
  return { ...rest, frontWidth: round3(saved.openingWidth - 2 * taper) };
}

const bayWallHeight = (host: BuildingElementOpaque, p: BayParameters) => (typeof p.wallHeight === 'number' ? p.wallHeight : host.height);

/** Why these parameters cannot be drawn on this host, or null. */
export function bayParametersProblem(host: BuildingElementOpaque, p: BayParameters): string | null {
  const f = hostFrame(host);
  const H = bayWallHeight(host, p);
  if (!(p.depth > 0) || !(p.openingWidth > 0)) return 'Give the bay a depth and an opening width above 0.';
  if (!(p.frontWidth >= MIN_FACET && p.frontWidth <= p.openingWidth)) return `Give the front width from ${MIN_FACET} m to the opening width (${roundToTwoDecimals(p.openingWidth)} m).`;
  if (!(H > 0 && H <= host.height)) return `Give the bay wall height above 0 m and no more than the wall height (${host.height} m), or leave it blank.`;
  if (p.centre - p.openingWidth / 2 < -1e-6 || p.centre + p.openingWidth / 2 > f.length + 1e-6) return `The opening runs past the ends of '${host.name}' (${roundToTwoDecimals(f.length)} m long).`;
  const side = Math.hypot(p.depth, (p.openingWidth - p.frontWidth) / 2);
  if (p.sideWindows && side <= 2 * WINDOW_INSET) return `The sides are ${roundToTwoDecimals(side)} m, too short for side windows: make the bay deeper or turn the side windows off.`;
  if (p.sillHeight + p.windowHeight > H) return `The windows reach above the bay walls (${H} m): lower the sill or the window height.`;
  return null;
}

export function buildBayBundleDraft(input: BundleDraftInput<BayParameters>): HemieBundleDraft {
  const { host, parameters: p, globalOrientationOffset: offset } = input;
  const f = hostFrame(host);
  const stem = input.bundleName ?? uniqueStem('Bay', input.existingNames);
  const bundleId = input.bundleId ?? `bay-${host.name}-${stem.replace(/\D+/g, '')}`;
  const name = (role: string, label: string) => input.names?.[role] ?? `${stem} ${label}`;
  const tag = (role: string, extra: Partial<HemieBundleTag> = {}) => ({
    hemie_bundle: { kind: 'bay', bundle_id: bundleId, role, host_wall: host.name, ...extra },
  });
  const taper = (p.openingWidth - p.frontWidth) / 2;
  const c = add(f.start, scale(f.t, p.centre));
  const a = add(c, scale(f.t, -p.openingWidth / 2));
  const b = add(c, scale(f.t, p.openingWidth / 2));
  const f0 = add(add(a, scale(f.t, taper)), scale(f.n, p.depth));
  const f1 = add(add(b, scale(f.t, -taper)), scale(f.n, p.depth));
  const H = bayWallHeight(host, p);
  const rise = p.roof === 'pitched' ? round3(p.depth * Math.tan((BAY_ROOF_PITCH * Math.PI) / 180)) : 0;
  const sideExtra = (role: string, rising: boolean) => ({
    ...tag(role),
    ...(rise > 0 ? { geometry_face: profile(H + rise, H, rising) } : {}),
  });
  const members: HemieBundleMemberDraft[] = [
    {
      role: 'front-wall',
      type: 'BuildingElementOpaque',
      name: name('front-wall', 'front'),
      parent_element: host.name,
      updates: wall(f, f0, f1, H, offset, {
        ...tag('front-wall', { parameters: p, bundle_name: stem }),
        parent_netting_area: round3(p.openingWidth * H),
      }),
    },
    { role: 'left-wall', type: 'BuildingElementOpaque', name: name('left-wall', 'left side'), parent_element: null, updates: wall(f, a, f0, H, offset, sideExtra('left-wall', false)) },
    { role: 'right-wall', type: 'BuildingElementOpaque', name: name('right-wall', 'right side'), parent_element: null, updates: wall(f, f1, b, H, offset, sideExtra('right-wall', true)) },
  ];
  members.push({
    role: 'front-window',
    type: 'BuildingElementTransparent',
    name: name('front-window', 'front window'),
    parent_element: members[0].name,
    updates: windowIn(f, f0, f1, p.sillHeight, p.windowHeight, offset, tag('front-window')),
  });
  if (p.sideWindows) {
    members.push(
      { role: 'left-window', type: 'BuildingElementTransparent', name: name('left-window', 'left window'), parent_element: members[1].name, updates: windowIn(f, a, f0, p.sillHeight, p.windowHeight, offset, tag('left-window')) },
      { role: 'right-window', type: 'BuildingElementTransparent', name: name('right-window', 'right window'), parent_element: members[2].name, updates: windowIn(f, f1, b, p.sillHeight, p.windowHeight, offset, tag('right-window')) },
    );
  }
  const footprint = round3((p.depth * (p.openingWidth + p.openingWidth - 2 * taper)) / 2);
  // HEMIE enters a bay floor only on the ground floor: there it adds to the floor's area and
  // exposed perimeter. Over a lower bay the floor is internal and not entered.
  if (f.level === 0) {
    const fields = floorFieldsFrom(input.groundFloor);
    members.push({
      role: 'floor',
      type: 'BuildingElementGround',
      name: name('floor', 'floor'),
      parent_element: null,
      updates: {
        ...fields,
        coordinates: polygon([a, f0, f1, b], f.level),
        width: 0,
        height: 0,
        area: footprint,
        perimeter: round3(Math.hypot(f0[0] - a[0], f0[1] - a[1]) * 2 + (p.openingWidth - 2 * taper)),
        extra_json: { ...(fields.extra_json as Record<string, unknown> | undefined), ...tag('floor') },
      },
    });
  }
  if (p.roof !== 'none') {
    members.push({
      role: 'roof',
      type: 'BuildingElementOpaque',
      name: name('roof', 'roof'),
      parent_element: null,
      updates: {
        // The eaves edge first: a sloped plane falls across its first edge.
        coordinates: polygon([f0, f1, b, a], f.level + 1),
        width: round3(p.openingWidth - taper),
        height: round3(p.roof === 'pitched' ? p.depth / Math.cos((BAY_ROOF_PITCH * Math.PI) / 180) : p.depth),
        area: round3(p.roof === 'pitched' ? footprint / Math.cos((BAY_ROOF_PITCH * Math.PI) / 180) : footprint),
        pitch: p.roof === 'pitched' ? BAY_ROOF_PITCH : 0,
        orientation360: bearing(f0, f1, offset),
        base_height: round3(f.base + H),
        is_unheated_pitched_roof: false,
        extra_json: tag('roof'),
      },
    });
  }
  return { bundleId, members };
}

export function conservatoryParametersProblem(host: BuildingElementOpaque, p: ConservatoryParameters): string | null {
  const f = hostFrame(host);
  if (!(p.width >= 1) || !(p.depth >= 1)) return 'Give the conservatory a width and a depth of at least 1 m.';
  if (!(p.wallHeight > p.dwarfWallHeight + 0.3)) return 'Make the walls at least 0.3 m taller than the dwarf wall, so they hold glazing.';
  if (!(p.dwarfWallHeight >= 0)) return 'Give the dwarf wall a height of 0 m or more.';
  if (p.roof !== 'flat' && !(p.roofPitch > 0 && p.roofPitch < 60)) return 'Give the roof a pitch between 1° and 59°.';
  if (p.centre - p.width / 2 < -1e-6 || p.centre + p.width / 2 > f.length + 1e-6) return `The conservatory runs past the ends of '${host.name}' (${roundToTwoDecimals(f.length)} m long).`;
  if (f.level !== 0) return 'A conservatory is a single storey on the ground: place it on a ground-floor wall.';
  return null;
}

export function buildConservatoryBundleDraft(input: BundleDraftInput<ConservatoryParameters>): HemieBundleDraft {
  const { host, parameters: p, globalOrientationOffset: offset } = input;
  const f = hostFrame(host);
  const stem = input.bundleName ?? uniqueStem('Conservatory', input.existingNames);
  const bundleId = input.bundleId ?? `conservatory-${host.name}-${stem.replace(/\D+/g, '')}`;
  const name = (role: string, label: string) => input.names?.[role] ?? `${stem} ${label}`;
  const tag = (role: string, extra: Partial<HemieBundleTag> = {}) => ({
    hemie_bundle: {
      kind: 'conservatory',
      bundle_id: bundleId,
      role,
      host_wall: host.name,
      conservatory_type: p.conservatoryType,
      ...(p.conservatoryType === 'unheated' && p.adjacentSpaceType ? { adjacent_space_type: p.adjacentSpaceType } : {}),
      ...extra,
    },
  });
  const c = add(f.start, scale(f.t, p.centre));
  const a = add(c, scale(f.t, -p.width / 2));
  const b = add(c, scale(f.t, p.width / 2));
  const fa = add(a, scale(f.n, p.depth));
  const fb = add(b, scale(f.n, p.depth));
  const H = p.wallHeight;
  const leanTo = p.roof === 'lean-to';
  const dual = p.roof === 'dual';
  const pitch = p.roof === 'flat' ? 0 : p.roofPitch;
  const tan = Math.tan((pitch * Math.PI) / 180);
  // A lean-to rises over the depth to the host wall; a dual roof over half the width to the ridge.
  const rise = round3((dual ? p.width / 2 : p.depth) * tan);
  // Non-separated, the conservatory is part of the dwelling and the wall it adjoins is internal.
  const nets = p.conservatoryType === 'non-separated' ? { parent_netting_area: round3(p.width * f.height) } : {};
  const glazingHeight = round3(H - p.dwarfWallHeight - WINDOW_INSET);
  const names = {
    front: name('front-wall', 'front'),
    left: name('left-wall', 'left side'),
    right: name('right-wall', 'right side'),
  };
  const members: HemieBundleMemberDraft[] = [
    {
      role: 'front-wall',
      type: 'BuildingElementOpaque',
      name: names.front,
      parent_element: host.name,
      updates: wall(f, fa, fb, H, offset, {
        ...tag('front-wall', { parameters: p, bundle_name: stem }),
        ...nets,
        ...(dual ? { geometry_face: { ...profile(H, H, true), top_profile: [{ t: 0, h: H }, { t: 0.5, h: H + rise }, { t: 1, h: H }] } } : {}),
      }),
    },
    {
      role: 'left-wall',
      type: 'BuildingElementOpaque',
      name: names.left,
      parent_element: null,
      updates: wall(f, a, fa, H, offset, { ...tag('left-wall'), ...(leanTo && rise > 0 ? { geometry_face: profile(H + rise, H, false) } : {}) }),
    },
    {
      role: 'right-wall',
      type: 'BuildingElementOpaque',
      name: names.right,
      parent_element: null,
      updates: wall(f, fb, b, H, offset, { ...tag('right-wall'), ...(leanTo && rise > 0 ? { geometry_face: profile(H + rise, H, true) } : {}) }),
    },
    { role: 'front-glazing', type: 'BuildingElementTransparent', name: name('front-glazing', 'front glazing'), parent_element: names.front, updates: windowIn(f, fa, fb, p.dwarfWallHeight, glazingHeight, offset, tag('front-glazing')) },
    { role: 'left-glazing', type: 'BuildingElementTransparent', name: name('left-glazing', 'left glazing'), parent_element: names.left, updates: windowIn(f, a, fa, p.dwarfWallHeight, glazingHeight, offset, tag('left-glazing')) },
    { role: 'right-glazing', type: 'BuildingElementTransparent', name: name('right-glazing', 'right glazing'), parent_element: names.right, updates: windowIn(f, fb, b, p.dwarfWallHeight, glazingHeight, offset, tag('right-glazing')) },
  ];
  const fields = floorFieldsFrom(input.groundFloor);
  members.push({
    role: 'floor',
    type: 'BuildingElementGround',
    name: name('floor', 'floor'),
    parent_element: null,
    updates: {
      ...fields,
      coordinates: polygon([a, fa, fb, b], f.level),
      width: 0,
      height: 0,
      area: round3(p.width * p.depth),
      perimeter: round3(p.width + 2 * p.depth),
      extra_json: { ...(fields.extra_json as Record<string, unknown> | undefined), ...tag('floor') },
    },
  });
  const cos = Math.cos((pitch * Math.PI) / 180);
  // Each roof plane: its eaves edge first (a sloped plane falls across its first edge) and its
  // run from the eaves.
  const ridgeHost = c;
  const ridgeFront = add(c, scale(f.n, p.depth));
  const planes: Array<{ suffix: string; label: string; pts: V[]; run: number }> = dual
    ? [
      { suffix: '', label: 'left', pts: [a, fa, ridgeFront, ridgeHost], run: p.width / 2 },
      { suffix: '-2', label: 'right', pts: [fb, b, ridgeHost, ridgeFront], run: p.width / 2 },
    ]
    : [{ suffix: '', label: '', pts: [fa, fb, b, a], run: p.depth }];
  for (const plane of planes) {
    const [e0, e1] = plane.pts;
    const along = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]);
    const slope = plane.run / cos;
    const roofName = name(`roof${plane.suffix}`, plane.label ? `roof ${plane.label}` : 'roof');
    const orientation360 = bearing(e0, e1, offset);
    members.push({
      role: `roof${plane.suffix}`,
      type: 'BuildingElementOpaque',
      name: roofName,
      parent_element: null,
      updates: {
        coordinates: polygon(plane.pts, f.level + 1),
        width: round3(along),
        height: round3(slope),
        area: round3(along * slope),
        pitch,
        orientation360,
        base_height: round3(f.base + H),
        is_unheated_pitched_roof: false,
        extra_json: tag(`roof${plane.suffix}`),
      },
    });
    members.push({
      role: `roof-glazing${plane.suffix}`,
      type: 'BuildingElementTransparent',
      name: name(`roof-glazing${plane.suffix}`, `roof glazing${plane.label ? ` ${plane.label}` : ''}`),
      parent_element: roofName,
      updates: rooflight(e0, e1, plane.run, pitch, f.base + H, orientation360, f.level + 1, tag(`roof-glazing${plane.suffix}`)),
    });
  }
  return { bundleId, members };
}

/** How to bring a bundle's members to a new draft: update by role, add new roles, remove the rest. */
export function planBundleUpdate(existing: Element[], draft: HemieBundleDraft): {
  update: Record<string, Record<string, unknown>>;
  add: HemieBundleMemberDraft[];
  remove: string[];
} {
  const byRole = new Map(existing.map((element) => [getHemieBundle(element)!.role, element]));
  const update: Record<string, Record<string, unknown>> = {};
  const add: HemieBundleMemberDraft[] = [];
  for (const member of draft.members) {
    const current = byRole.get(member.role);
    if (!current) {
      add.push(member);
      continue;
    }
    byRole.delete(member.role);
    // Keep what the user set on the element (its fabric, opening type, a floor's type); the
    // bundle owns the geometry, its tag, the wall profile and the netted opening. A new floor
    // takes its type and fabric from the ground floor; an existing one keeps its own.
    const authored = { ...current.extra_json };
    delete authored.geometry_face;
    delete authored.parent_netting_area;
    delete authored.hemie_bundle;
    const updates: Record<string, unknown> = { ...member.updates };
    for (const key of FLOOR_FIELDS) {
      if (key in current) delete updates[key];
    }
    update[current.id] = {
      ...updates,
      parent_element: member.parent_element,
      extra_json: { ...member.updates.extra_json, ...authored, hemie_bundle: member.updates.extra_json.hemie_bundle },
    };
  }
  return { update, add, remove: [...byRole.values()].map((element) => element.id) };
}

/** Member names by role, so a regenerated bundle keeps them. */
export function bundleMemberNames(members: Element[]): Record<string, string> {
  return Object.fromEntries(members.map((element) => [getHemieBundle(element)!.role, element.name]));
}

/** A window in a conservatory's wall or roof: its opening type defaults to closed. */
export function isConservatoryGlazing(window: Element, elementsById: Record<string, Element>): boolean {
  const host = Object.values(elementsById).find((element) => element.name === window.parent_element);
  return getHemieBundle(host)?.kind === 'conservatory';
}

export function conservatoryGlazingOpeningType(window: Element): string | null {
  const sections = window.extra_json?.window_sections;
  const first = Array.isArray(sections) ? (sections[0] as { window_type?: unknown } | undefined) : undefined;
  return typeof first?.window_type === 'string' ? first.window_type : null;
}

/** The window's extra_json with one section of this opening type, or none (the default). */
export function withConservatoryGlazingOpeningType(window: Element, windowType: string | null): Record<string, unknown> {
  const rest = { ...window.extra_json };
  delete rest.window_sections;
  return windowType ? { ...rest, window_sections: [{ window_type: windowType }] } : rest;
}

/** The ground floor the wall stands on: the floor-0 ground element just inside it. */
export function groundFloorUnderWall(host: BuildingElementOpaque, elements: Element[]): BuildingElementGround | null {
  const f = hostFrame(host);
  const inside = add(add(f.start, scale(f.t, f.length / 2)), scale(f.n, -0.1));
  return (elements.find((element) => element.type === 'BuildingElementGround'
    && !getHemieBundle(element)
    && isPointInPolygon2D({ x: inside[0], y: inside[1] }, element.coordinates)) as BuildingElementGround | undefined) ?? null;
}

const ON_HOST_TOL = 0.01;

/**
 * The anchor's host wall: by the bundle's `host_wall`, else by the anchor's parent (a rename
 * remaps the parent, so a bundle saved before `host_wall` was remapped still finds its wall).
 */
export function hemieBundleHost(anchor: Element, elements: Iterable<Element>): BuildingElementOpaque | null {
  const tag = getHemieBundle(anchor);
  const all = [...elements];
  const named = (name: unknown) => all.find((element) => element.name === name && isHemieBundleHost(element));
  return (named(tag?.host_wall) ?? named(anchor.parent_element) ?? null) as BuildingElementOpaque | null;
}

/**
 * Why a bundle no longer fits its host wall, or null: the host is gone, or a side wall no longer
 * starts on it (the host moved after the bundle was placed). Shown on the anchor; regenerating
 * the bundle from its parameters places it on the host again.
 */
export function hemieBundleHostProblem(anchor: Element, elements: Iterable<Element>): string | null {
  const tag = getHemieBundle(anchor);
  if (!tag || tag.role !== 'front-wall') return null;
  const all = [...elements];
  const label = tag.kind === 'bay' ? 'bay' : 'conservatory';
  const host = hemieBundleHost(anchor, all);
  if (!host) return `Its host wall '${tag.host_wall}' is gone. Delete the ${label} and place it again.`;
  if (host.name !== tag.host_wall) return `Its host wall '${tag.host_wall}' is now '${host.name}'. Choose Place again to attach the ${label} to it.`;
  const [A, B] = host.coordinates;
  const onHost = (p: { x: number; y: number }) => {
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const k = Math.min(Math.max(((p.x - A.x) * dx + (p.y - A.y) * dy) / (dx * dx + dy * dy), 0), 1);
    return Math.hypot(p.x - (A.x + k * dx), p.y - (A.y + k * dy)) <= ON_HOST_TOL;
  };
  const sides = getHemieBundleMembers(all, tag.bundle_id).filter((m) => ['left-wall', 'right-wall'].includes(getHemieBundle(m)!.role));
  const fits = sides.length === 2 && sides.every((side) => side.coordinates.filter(onHost).length === 1);
  return fits ? null : `The ${label} no longer sits on its host wall '${tag.host_wall}'. Choose Place again to move it onto the wall.`;
}
