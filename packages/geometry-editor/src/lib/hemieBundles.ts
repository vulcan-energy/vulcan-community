// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Bay window and conservatory bundles for existing-building EPC models. Like a dormer bundle,
// a bundle is a set of ordinary elements, so it draws, renders and exports like any other
// geometry. Each member carries `extra_json.hemie_bundle` (kind, bundle id, role, host wall);
// the front wall is the anchor: a child of the host wall that holds the parameters and nets
// the opening it covers from the host wall's area.

import type { BuildingElementGround, BuildingElementOpaque, Element, ElementDraft } from '../geometry/types';
import { normalizeOrientation360Deg, roundToTwoDecimals } from '../geometry/constants';
import { orientation360FromSegmentOutwardModelXY } from './openingSegmentOutward';
import { isPointInPolygon2D } from './pointInPolygon';
import type { RoofParameters } from './roofPart';

export type HemieBundleKind = 'bay' | 'conservatory' | 'roof';
export type ConservatoryType = 'non-separated' | 'separated' | 'unheated';
/** HEMIE's unheated space types for a sheltered wall. */
export type AdjacentSpaceType = 'corridor' | 'garage' | 'roof void' | 'stairwell';

/**
 * A bay's inputs. Placement draws the opening and the projection; nothing else has a built-in
 * size. A value left out is either derived (shown as such) or required.
 */
export interface BayParameters {
  /** Distance along the host wall, from its first point to the middle of the opening (m). */
  centre: number;
  openingWidth: number;
  depth: number;
  /** Width of the front facet (m); absent, a box bay (the opening width). */
  frontWidth?: number;
  /** Height of the bay walls (m); absent, the host wall's height. */
  wallHeight?: number;
  /** Required unless a bay above covers it (then it has none). 'none' is a bay saved with no roof. */
  roof?: 'flat' | 'pitched' | 'none';
  /** The front window (m): required. */
  windowWidth?: number;
  windowHeight?: number;
  /** One window size in both sides; absent or false, none. */
  sideWindows?: boolean;
  sideWindowWidth?: number;
  sideWindowHeight?: number;
  /** Above the bay floor (m); absent, each window is centred on the bay height. */
  sillHeight?: number;
}

/** A conservatory's inputs, in HEM:EPC's terms. Placement draws the width and the projection. */
export interface ConservatoryParameters {
  centre: number;
  width: number;
  depth: number;
  /** Floor to eaves (m): required. Drawn at the host wall's height until given. */
  wallHeight?: number;
  /** The glazed share of the wall height, from the top: required, above 0 and up to 1. */
  wallGlazingFraction?: number;
  /** Dual: a ridge from the host wall to a gable over the front wall. Required. */
  roof?: 'flat' | 'lean-to' | 'dual';
  /** Degrees; absent, HEM:EPC's default (`CONSERVATORY_DEFAULT_PITCH`). */
  roofPitch?: number;
  /** The glazed share of each roof plane: required, above 0 and up to 1. */
  roofGlazingFraction?: number;
  /** Asked before placing: absent after a "No" until Separated or Unheated is chosen. */
  conservatoryType?: ConservatoryType;
  /** Unheated only: the space the host wall, sheltered where it adjoins, borders. */
  adjacentSpaceType?: AdjacentSpaceType;
}

export type HemieBundleParameters = BayParameters | ConservatoryParameters | RoofParameters;

export interface HemieBundleTag {
  kind: HemieBundleKind;
  bundle_id: string;
  role: string;
  host_wall: string;
  conservatory_type?: ConservatoryType;
  adjacent_space_type?: AdjacentSpaceType;
  /** A roof's members: its shape and pitch choice, which the converter reads. */
  shape?: string;
  pitch_choice?: string | number;
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

/** HEM:EPC's pitched bay roof: one 35° slope facing the wall (the drawing follows it). */
export const BAY_ROOF_PITCH = 35;
/** HEM:EPC's conservatory roof pitch when none is entered. Drawn at it; sent only when typed. */
export const CONSERVATORY_DEFAULT_PITCH = 20;
const WINDOW_INSET = 0.1;
const MIN_FACET = 0.3;

export function getHemieBundle(element: Element | null | undefined): HemieBundleTag | null {
  const tag = element?.extra_json?.hemie_bundle as Partial<HemieBundleTag> | undefined;
  if (!tag || (tag.kind !== 'bay' && tag.kind !== 'conservatory' && tag.kind !== 'roof') || !tag.bundle_id || !tag.role) return null;
  return tag as HemieBundleTag;
}

/** The member that opens a part and holds its parameters: a bay's or conservatory's front, a roof's first slope. */
export function isHemieBundleAnchor(tag: HemieBundleTag | null | undefined): boolean {
  return !!tag && (tag.role === 'front-wall' || (tag.kind === 'roof' && !!tag.parameters));
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

/**
 * Where `p` falls against the host wall: its distance along the wall (kept on the wall), the
 * point there, and its distance outward from the wall (negative inside).
 */
export function onHost(host: BuildingElementOpaque, p: { x: number; y: number }): { along: number; out: number; point: { x: number; y: number } } {
  const f = hostFrame(host);
  const dx = p.x - f.start[0];
  const dy = p.y - f.start[1];
  const along = Math.min(Math.max(dx * f.t[0] + dy * f.t[1], 0), f.length);
  const point = add(f.start, scale(f.t, along));
  return { along, out: dx * f.n[0] + dy * f.n[1], point: { x: point[0], y: point[1] } };
}

function bearing(a: V, b: V, offset: number): number {
  return roundToTwoDecimals(normalizeOrientation360Deg(
    (orientation360FromSegmentOutwardModelXY(a[0], a[1], b[0], b[1], 0) ?? 0) - offset,
  ));
}

/** `<prefix>-<n>` for the first n no bundle uses (a renamed part keeps its id, so names cannot tell). */
export function uniqueBundleId(prefix: string, existing: Iterable<string> = []): string {
  const taken = new Set(existing);
  for (let i = 1; ; i += 1) {
    if (!taken.has(`${prefix}-${i}`)) return `${prefix}-${i}`;
  }
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

/** A window `width` wide, centred in wall a→b, from `sill` above the wall base. */
function windowIn(f: HostFrame, a: V, b: V, sill: number, width: number, height: number, offset: number, extra: Record<string, unknown>) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u: V = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const p = add(a, scale(u, (length - width) / 2));
  const q = add(a, scale(u, (length + width) / 2));
  const base = round3(f.base + sill);
  return {
    coordinates: [{ x: p[0], y: p[1], z: f.level }, { x: q[0], y: q[1], z: f.level }],
    width: round3(width),
    height: round3(height),
    area: round3(width * height),
    pitch: 90,
    orientation360: bearing(a, b, offset),
    base_height: base,
    free_area_height: round3(height),
    mid_height: round3(base + height / 2),
    max_window_open_area: round3(width * height),
    extra_json: extra,
  };
}

function polygon(points: V[], z: number) {
  return points.map(([x, y]) => ({ x, y, z }));
}

/**
 * A rooflight across the roof plane from its eaves, `fraction` of the way up: the conservatory's
 * roof glazing fraction is the glazed share of the plane.
 */
function rooflight(
  eavesA: V,
  eavesB: V,
  run: number,
  fraction: number,
  pitch: number,
  eaves: number,
  orientation360: number,
  level: number,
  extra: Record<string, unknown>,
) {
  const width = round3(Math.hypot(eavesB[0] - eavesA[0], eavesB[1] - eavesA[1]));
  const height = round3((fraction * run) / Math.cos((pitch * Math.PI) / 180));
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
  /** A bay only: the storey above covers it, so it has no roof (`bayCoveredAbove`). */
  covered?: boolean;
  existingNames: Iterable<string>;
  /** Bundle ids already in the model: a new bundle's id differs from them all. */
  existingBundleIds?: Iterable<string>;
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

const OLD_WINDOW_WIDTH = (facet: number) => round3(facet - 2 * WINDOW_INSET);

/**
 * A bay's saved parameters in today's terms. A bay saved with a side angle (degrees to the host
 * wall) gets the front width that angle gives. A bay saved before its windows were sized by
 * hand reads the windows it had (the facet less 0.1 m at each end), and keeps its sill and its
 * roof (a 'none' roof stays none): what the file stated reads as entered.
 */
export function bayParameters(saved: BayParameters & { sideAngle?: number; roof?: string }): BayParameters {
  let p = saved as BayParameters & { sideAngle?: number; roof?: string };
  if (typeof p.frontWidth !== 'number' && typeof p.sideAngle === 'number') {
    const { sideAngle, ...rest } = p;
    const taper = sideAngle >= 90 ? 0 : p.depth / Math.tan((sideAngle * Math.PI) / 180);
    p = { ...rest, frontWidth: round3(p.openingWidth - 2 * taper) };
  }
  if (typeof p.windowHeight === 'number' && typeof p.windowWidth !== 'number') {
    const front = p.frontWidth ?? p.openingWidth;
    const side = Math.hypot(p.depth, (p.openingWidth - front) / 2);
    p = {
      ...p,
      windowWidth: OLD_WINDOW_WIDTH(front),
      ...(p.sideWindows ? { sideWindowWidth: OLD_WINDOW_WIDTH(side), sideWindowHeight: p.windowHeight } : {}),
    };
  }
  return p as BayParameters;
}

const bayWallHeight = (host: BuildingElementOpaque, p: BayParameters) => (typeof p.wallHeight === 'number' ? p.wallHeight : host.height);
const bayFront = (p: BayParameters) => p.frontWidth ?? p.openingWidth;
const baySide = (p: BayParameters) => Math.hypot(p.depth, (p.openingWidth - bayFront(p)) / 2);
/** A window's sill: typed, or centred on the bay height. */
const baySill = (p: BayParameters, H: number, height: number) => (typeof p.sillHeight === 'number' ? p.sillHeight : (H - height) / 2);
const given = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Why these parameters cannot be drawn on this host, or null. Missing inputs are not problems (`hemieBundleMissing`). */
export function bayParametersProblem(host: BuildingElementOpaque, p: BayParameters): string | null {
  const f = hostFrame(host);
  const H = bayWallHeight(host, p);
  if (!(p.depth > 0) || !(p.openingWidth > 0)) return 'Give the bay a projection and an opening width above 0.';
  const front = bayFront(p);
  if (!(front >= MIN_FACET && front <= p.openingWidth)) return `Give the front facet width from ${MIN_FACET} m to the opening width (${roundToTwoDecimals(p.openingWidth)} m).`;
  if (!(H > 0 && H <= host.height)) return `Give the bay wall height above 0 m and no more than the wall height (${host.height} m), or leave it blank.`;
  if (p.centre - p.openingWidth / 2 < -1e-6 || p.centre + p.openingWidth / 2 > f.length + 1e-6) return `The opening runs past the ends of '${host.name}' (${roundToTwoDecimals(f.length)} m long).`;
  if (given(p.windowWidth) && !(p.windowWidth > 0 && p.windowWidth <= front + 1e-6)) return `Give the front window a width above 0 m and no more than the front facet (${roundToTwoDecimals(front)} m).`;
  const side = baySide(p);
  if (p.sideWindows && given(p.sideWindowWidth) && !(p.sideWindowWidth > 0 && p.sideWindowWidth <= side + 1e-6)) return `Give the side windows a width above 0 m and no more than the sides (${roundToTwoDecimals(side)} m).`;
  if (given(p.sillHeight) && p.sillHeight < 0) return 'Give the sill a height of 0 m or more, or leave it blank to centre the windows.';
  const heights = [p.windowHeight, ...(p.sideWindows ? [p.sideWindowHeight] : [])].filter(given);
  if (heights.some((h) => !(h > 0) || baySill(p, H, h) + h > H + 1e-6)) return `The windows reach above the bay walls (${roundToTwoDecimals(H)} m): lower the sill or the window height.`;
  return null;
}

export function buildBayBundleDraft(input: BundleDraftInput<BayParameters>): HemieBundleDraft {
  const { host, parameters: p, globalOrientationOffset: offset } = input;
  const f = hostFrame(host);
  const stem = input.bundleName ?? uniqueStem('Bay', input.existingNames);
  const bundleId = input.bundleId ?? uniqueBundleId(`bay-${host.name}`, input.existingBundleIds);
  const name = (role: string, label: string) => input.names?.[role] ?? `${stem} ${label}`;
  const tag = (role: string, extra: Partial<HemieBundleTag> = {}) => ({
    hemie_bundle: { kind: 'bay', bundle_id: bundleId, role, host_wall: host.name, ...extra },
  });
  const taper = (p.openingWidth - bayFront(p)) / 2;
  const c = add(f.start, scale(f.t, p.centre));
  const a = add(c, scale(f.t, -p.openingWidth / 2));
  const b = add(c, scale(f.t, p.openingWidth / 2));
  const f0 = add(add(a, scale(f.t, taper)), scale(f.n, p.depth));
  const f1 = add(add(b, scale(f.t, -taper)), scale(f.n, p.depth));
  const H = bayWallHeight(host, p);
  const roof = input.covered || p.roof === 'none' ? undefined : p.roof;
  const rise = roof === 'pitched' ? round3(p.depth * Math.tan((BAY_ROOF_PITCH * Math.PI) / 180)) : 0;
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
  // A window is drawn once its size is given.
  if (given(p.windowWidth) && given(p.windowHeight)) {
    members.push({
      role: 'front-window',
      type: 'BuildingElementTransparent',
      name: name('front-window', 'front window'),
      parent_element: members[0].name,
      updates: windowIn(f, f0, f1, baySill(p, H, p.windowHeight), p.windowWidth, p.windowHeight, offset, tag('front-window')),
    });
  }
  if (p.sideWindows && given(p.sideWindowWidth) && given(p.sideWindowHeight)) {
    const sill = baySill(p, H, p.sideWindowHeight);
    members.push(
      { role: 'left-window', type: 'BuildingElementTransparent', name: name('left-window', 'left window'), parent_element: members[1].name, updates: windowIn(f, a, f0, sill, p.sideWindowWidth, p.sideWindowHeight, offset, tag('left-window')) },
      { role: 'right-window', type: 'BuildingElementTransparent', name: name('right-window', 'right window'), parent_element: members[2].name, updates: windowIn(f, f1, b, sill, p.sideWindowWidth, p.sideWindowHeight, offset, tag('right-window')) },
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
  if (roof) {
    members.push({
      role: 'roof',
      type: 'BuildingElementOpaque',
      name: name('roof', 'roof'),
      parent_element: null,
      updates: {
        // The eaves edge first: a sloped plane falls across its first edge.
        coordinates: polygon([f0, f1, b, a], f.level + 1),
        width: round3(p.openingWidth - taper),
        height: round3(roof === 'pitched' ? p.depth / Math.cos((BAY_ROOF_PITCH * Math.PI) / 180) : p.depth),
        area: round3(roof === 'pitched' ? footprint / Math.cos((BAY_ROOF_PITCH * Math.PI) / 180) : footprint),
        pitch: roof === 'pitched' ? BAY_ROOF_PITCH : 0,
        orientation360: bearing(f0, f1, offset),
        base_height: round3(f.base + H),
        is_unheated_pitched_roof: false,
        extra_json: tag('roof'),
      },
    });
  }
  return { bundleId, members };
}

/** A footprint's plan polygon from its two side walls (each runs from the host wall outward or back). */
function sidePolygon(left: Element, right: Element): Array<{ x: number; y: number }> {
  return [left.coordinates[0], left.coordinates[1], right.coordinates[0], right.coordinates[1]];
}

/** Whether a bay on the storey `offset` from this one stands over (or under) this bay's footprint. */
function bayStacked(host: BuildingElementOpaque, p: BayParameters, elements: Iterable<Element>, offset: 1 | -1): boolean {
  const f = hostFrame(host);
  const middle = add(add(f.start, scale(f.t, p.centre)), scale(f.n, p.depth / 2));
  const point = { x: middle[0], y: middle[1] };
  const above = [...elements].filter((element) => Math.floor(element.coordinates[0]?.z ?? NaN) === f.level + offset);
  const bays = new Map<string, Element[]>();
  for (const element of above) {
    const tag = getHemieBundle(element);
    if (tag?.kind === 'bay') bays.set(tag.bundle_id, [...(bays.get(tag.bundle_id) ?? []), element]);
  }
  return [...bays.values()].some((members) => {
    const left = members.find((m) => getHemieBundle(m)!.role === 'left-wall');
    const right = members.find((m) => getHemieBundle(m)!.role === 'right-wall');
    return !!left && !!right && isPointInPolygon2D(point, sidePolygon(left, right));
  });
}

/**
 * Whether a bay above covers this one. A covered bay has no roof: HEM:EPC enters a roof only on
 * the top bay of a stack, as the converter does.
 */
export function bayCoveredAbove(host: BuildingElementOpaque, p: BayParameters, elements: Iterable<Element>): boolean {
  return bayStacked(host, p, elements, 1);
}

/**
 * A conservatory's saved parameters in today's terms. One saved with a dwarf wall reads it as the
 * wall glazing fraction (1 − dwarf ÷ height), and its roof glazing fraction from its rooflights'
 * share of the roof planes. A conservatory saved in today's terms is returned as it is.
 */
export function conservatoryParameters(
  saved: ConservatoryParameters & { dwarfWallHeight?: number },
  members: Element[],
): ConservatoryParameters {
  if (typeof saved.dwarfWallHeight !== 'number') return saved;
  const { dwarfWallHeight, ...rest } = saved;
  const byRole = (role: string) => members.find((m) => getHemieBundle(m)?.role === role);
  const planes = ['', '-2'].flatMap((suffix) => {
    const plane = byRole(`roof${suffix}`);
    return plane ? [{ plane, light: byRole(`roof-glazing${suffix}`) }] : [];
  });
  const area = (e: Element | undefined) => {
    const { width = 0, height = 0 } = (e ?? {}) as { width?: number; height?: number };
    return width * height;
  };
  const planeArea = planes.reduce((sum, { plane }) => sum + area(plane), 0);
  const glazed = planes.reduce((sum, { light }) => sum + area(light), 0);
  return {
    ...rest,
    ...(typeof rest.wallHeight === 'number' && rest.wallHeight > 0
      ? { wallGlazingFraction: round3(1 - dwarfWallHeight / rest.wallHeight) }
      : {}),
    ...(planeArea > 0 ? { roofGlazingFraction: round3(Math.min(glazed / planeArea, 1)) } : {}),
  };
}

const conservatoryWallHeight = (host: BuildingElementOpaque, p: ConservatoryParameters) => (given(p.wallHeight) ? p.wallHeight : host.height);
const fractionProblem = (value: number | undefined, label: string) => (given(value) && !(value > 0 && value <= 1)
  ? `Give the ${label} above 0 and up to 1.`
  : null);

export function conservatoryParametersProblem(host: BuildingElementOpaque, p: ConservatoryParameters): string | null {
  const f = hostFrame(host);
  if (!(p.width >= MIN_FACET) || !(p.depth >= MIN_FACET)) return `Give the conservatory a width and a projection of at least ${MIN_FACET} m.`;
  if (given(p.wallHeight) && !(p.wallHeight > 0)) return 'Give the wall height to eaves above 0 m.';
  const fraction = fractionProblem(p.wallGlazingFraction, 'wall glazing fraction') ?? fractionProblem(p.roofGlazingFraction, 'roof glazing fraction');
  if (fraction) return fraction;
  if (p.roof && p.roof !== 'flat' && given(p.roofPitch) && !(p.roofPitch > 0 && p.roofPitch < 60)) return 'Give the roof a pitch between 1° and 59°, or leave it blank.';
  if (p.centre - p.width / 2 < -1e-6 || p.centre + p.width / 2 > f.length + 1e-6) return `The conservatory runs past the ends of '${host.name}' (${roundToTwoDecimals(f.length)} m long).`;
  if (f.level !== 0) return 'A conservatory is a single storey on the ground: place it on a ground-floor wall.';
  return null;
}

export function buildConservatoryBundleDraft(input: BundleDraftInput<ConservatoryParameters>): HemieBundleDraft {
  const { host, parameters: p, globalOrientationOffset: offset } = input;
  const f = hostFrame(host);
  const stem = input.bundleName ?? uniqueStem('Conservatory', input.existingNames);
  const bundleId = input.bundleId ?? uniqueBundleId(`conservatory-${host.name}`, input.existingBundleIds);
  const name = (role: string, label: string) => input.names?.[role] ?? `${stem} ${label}`;
  const tag = (role: string, extra: Partial<HemieBundleTag> = {}) => ({
    hemie_bundle: {
      kind: 'conservatory',
      bundle_id: bundleId,
      role,
      host_wall: host.name,
      ...(p.conservatoryType ? { conservatory_type: p.conservatoryType } : {}),
      ...(p.conservatoryType === 'unheated' && p.adjacentSpaceType ? { adjacent_space_type: p.adjacentSpaceType } : {}),
      ...extra,
    },
  });
  const c = add(f.start, scale(f.t, p.centre));
  const a = add(c, scale(f.t, -p.width / 2));
  const b = add(c, scale(f.t, p.width / 2));
  const fa = add(a, scale(f.n, p.depth));
  const fb = add(b, scale(f.n, p.depth));
  const H = conservatoryWallHeight(host, p);
  const leanTo = p.roof === 'lean-to';
  const dual = p.roof === 'dual';
  const pitch = p.roof === 'flat' || !p.roof ? 0 : (p.roofPitch ?? CONSERVATORY_DEFAULT_PITCH);
  const tan = Math.tan((pitch * Math.PI) / 180);
  // A lean-to rises over the depth to the host wall; a dual roof over half the width to the ridge.
  const rise = round3((dual ? p.width / 2 : p.depth) * tan);
  // Non-separated, the conservatory is part of the dwelling and the wall it adjoins is internal.
  const nets = p.conservatoryType === 'non-separated' ? { parent_netting_area: round3(p.width * f.height) } : {};
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
  ];
  // Each wall is glazed from (1 − fraction) of its height to the eaves, once the fraction is given.
  if (given(p.wallGlazingFraction)) {
    const glazed = p.wallGlazingFraction * H;
    const sill = H - glazed;
    const glazing = (role: string, label: string, parent: string, from: V, to: V) => ({
      role,
      type: 'BuildingElementTransparent' as const,
      name: name(role, label),
      parent_element: parent,
      updates: windowIn(f, from, to, sill, Math.hypot(to[0] - from[0], to[1] - from[1]) - 2 * WINDOW_INSET, glazed, offset, tag(role)),
    });
    members.push(
      glazing('front-glazing', 'front glazing', names.front, fa, fb),
      glazing('left-glazing', 'left glazing', names.left, a, fa),
      glazing('right-glazing', 'right glazing', names.right, fb, b),
    );
  }
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
  if (!p.roof) return { bundleId, members };
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
    if (given(p.roofGlazingFraction)) {
      members.push({
        role: `roof-glazing${plane.suffix}`,
        type: 'BuildingElementTransparent',
        name: name(`roof-glazing${plane.suffix}`, `roof glazing${plane.label ? ` ${plane.label}` : ''}`),
        parent_element: roofName,
        updates: rooflight(e0, e1, plane.run, p.roofGlazingFraction, pitch, f.base + H, orientation360, f.level + 1, tag(`roof-glazing${plane.suffix}`)),
      });
    }
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

/** HEMIE's opening types for a window (its schema `WindowType`). The DESNZ guidance gives no default. */
export const WINDOW_OPENING_TYPES = [
  'closed', 'full opening', 'half opening top', 'half opening vertical bottom', 'half opening vertical top',
  'top third opening', 'sliding window', 'sliding glass door', 'hinged glass door',
  'central dual air flow path', 'top dual air flow path', 'multi air flow path',
] as const;

export function conservatoryGlazingOpeningType(window: Element): string | null {
  const sections = window.extra_json?.window_sections;
  const first = Array.isArray(sections) ? (sections[0] as { window_type?: unknown } | undefined) : undefined;
  return typeof first?.window_type === 'string' ? first.window_type : null;
}

/** How many opening parts each opening type has (a closed section has none), as HEMIE counts them. */
const OPENING_PART_COUNT: Readonly<Record<string, number>> = {
  closed: 0, 'top dual air flow path': 2, 'central dual air flow path': 2, 'multi air flow path': 3,
};

export type WindowSectionInput = Readonly<{ windowType: string; widthFraction?: number; openingAngle?: string }>;

/** A window's sections, left to right: opening type, width fraction and opening angle (standard when not stated). */
export function windowSections(window: Element): WindowSectionInput[] {
  const sections = window.extra_json?.window_sections;
  if (!Array.isArray(sections)) return [];
  return sections.map((raw) => {
    const section = (raw ?? {}) as { window_type?: unknown; width_fraction?: unknown; window_part_list?: unknown };
    const parts = Array.isArray(section.window_part_list) ? section.window_part_list as { opening_angle_category?: unknown }[] : [];
    const angle = parts[0]?.opening_angle_category;
    return {
      windowType: typeof section.window_type === 'string' ? section.window_type : '',
      ...(typeof section.width_fraction === 'number' && { widthFraction: section.width_fraction }),
      ...(typeof angle === 'string' && { openingAngle: angle }),
    };
  });
}

/** The window's extra_json with these sections; an opening angle other than standard is stated on each of the section's parts. */
export function withWindowSections(window: Element, sections: readonly WindowSectionInput[]): Record<string, unknown> {
  const rest = { ...window.extra_json };
  delete rest.window_sections;
  if (!sections.length) return rest;
  return {
    ...rest,
    window_sections: sections.map((section) => {
      const parts = OPENING_PART_COUNT[section.windowType] ?? 1;
      return {
        window_type: section.windowType,
        ...(section.widthFraction !== undefined && { width_fraction: section.widthFraction }),
        ...(section.openingAngle && section.openingAngle !== 'standard' && parts > 0
          && { window_part_list: Array.from({ length: parts }, () => ({ opening_angle_category: section.openingAngle })) }),
      };
    }),
  };
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

/** A bundle's parameters, read in today's terms (`bayParameters`, `conservatoryParameters`). */
export function hemieBundleParameters(anchor: Element, elements: Iterable<Element>): HemieBundleParameters | null {
  const tag = getHemieBundle(anchor);
  if (!tag?.parameters) return null;
  return tag.kind === 'bay'
    ? bayParameters(tag.parameters as BayParameters)
    : conservatoryParameters(tag.parameters as ConservatoryParameters, getHemieBundleMembers(elements, tag.bundle_id));
}

const listed = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * The required inputs a bundle still lacks, as one sentence naming it, or null. Shown on its
 * anchor as a blocking issue: nothing is drawn or entered for a missing input.
 */
export function hemieBundleMissing(anchor: Element, elements: Iterable<Element>, epc = true): string | null {
  const tag = getHemieBundle(anchor);
  if (tag?.role !== 'front-wall') return null;
  const all = [...elements];
  const p = hemieBundleParameters(anchor, all);
  if (!p) return null;
  const name = tag.bundle_name ?? anchor.name;
  const missing: string[] = [];
  if (tag.kind === 'bay') {
    const bay = p as BayParameters;
    const host = hemieBundleHost(anchor, all);
    // Its bay below was deleted or detached: an upper bay with nothing below has no floor.
    if (host && Math.floor(host.coordinates[0].z) > 0 && !bayStacked(host, bay, all, -1)) {
      return `${name} stands above the ground floor with no bay below it: place a bay below, or delete this one.`;
    }
    if (!bay.roof && !(host && bayCoveredAbove(host, bay, all))) missing.push('a roof');
    // HEM:EPC requires the front window; elsewhere a bay may have none.
    if (epc && (!given(bay.windowWidth) || !given(bay.windowHeight))) missing.push('a front window width and height');
    if (bay.sideWindows && (!given(bay.sideWindowWidth) || !given(bay.sideWindowHeight))) missing.push('a side window width and height');
  } else {
    const conservatory = p as ConservatoryParameters;
    if (!conservatory.conservatoryType) return `Choose Separated or Unheated for ${name}.`;
    if (conservatory.conservatoryType === 'unheated' && !conservatory.adjacentSpaceType) return `Choose the unheated space ${name} adjoins.`;
    if (conservatory.conservatoryType !== 'non-separated') return null;
    if (!given(conservatory.wallHeight)) missing.push('a wall height to eaves');
    if (!given(conservatory.wallGlazingFraction)) missing.push('a wall glazing fraction');
    if (!conservatory.roof) missing.push('a roof');
    if (!given(conservatory.roofGlazingFraction)) missing.push('a roof glazing fraction');
  }
  return missing.length ? `Give ${name} ${listed(missing)}.` : null;
}

/** Bundles part-way through `drawHemieBundle`. */
const drawing = new Set<string>();

/** The store actions a bundle edit uses. */
export interface HemieBundleStore {
  elementsById: Record<string, Element>;
  globalOrientationOffset: number;
  addElements: (elements: ElementDraft[]) => string[];
  updateElementsBulk: (perIdUpdates: Record<string, Partial<Element>>) => void;
  removeElement: (id: string) => void;
}

/**
 * Draws a bundle on `host`: places a new one, or brings `anchor`'s members to these parameters
 * (what the user set on a member stays). Returns the anchor's id, or why it cannot be drawn.
 */
export function drawHemieBundle(
  state: HemieBundleStore,
  kind: HemieBundleKind,
  host: BuildingElementOpaque,
  parameters: HemieBundleParameters,
  anchor?: Element,
): { anchorId: string } | { problem: string } {
  const problem = kind === 'bay'
    ? bayParametersProblem(host, parameters as BayParameters)
    : conservatoryParametersProblem(host, parameters as ConservatoryParameters);
  if (problem) return { problem };
  const all = Object.values(state.elementsById);
  // A bay above the ground floor stands on a bay below; one with nothing below (an oriel) has
  // no floor to lose heat through and HEM:EPC cannot enter it.
  if (!anchor && kind === 'bay' && Math.floor(host.coordinates[0].z) > 0 && !bayStacked(host, parameters as BayParameters, all, -1)) {
    return { problem: 'A bay above the ground floor stands on a bay below it: place that bay first.' };
  }
  const tag = anchor ? getHemieBundle(anchor) : null;
  const members = tag ? getHemieBundleMembers(all, tag.bundle_id) : [];
  const input = {
    host,
    groundFloor: groundFloorUnderWall(host, all),
    existingNames: all.map((element) => element.name),
    existingBundleIds: all.flatMap((element) => getHemieBundle(element)?.bundle_id ?? []),
    globalOrientationOffset: state.globalOrientationOffset,
    ...(tag ? { bundleId: tag.bundle_id, bundleName: tag.bundle_name, names: bundleMemberNames(members) } : {}),
  };
  const draft = kind === 'bay'
    ? buildBayBundleDraft({ ...input, parameters: parameters as BayParameters, covered: bayCoveredAbove(host, parameters as BayParameters, all) })
    : buildConservatoryBundleDraft({ ...input, parameters: parameters as ConservatoryParameters });
  const plan = planBundleUpdate(members, draft);
  // Its writes land one by one: the follower leaves this bundle alone until they all have.
  drawing.add(draft.bundleId);
  try {
    state.updateElementsBulk(plan.update as Record<string, Partial<Element>>);
    const added = plan.add.length
      ? state.addElements(plan.add.map((member) => ({
        ...member.updates,
        name: member.name,
        type: member.type,
        zoneId: host.zoneId,
        parent_element: member.parent_element,
      }) as ElementDraft))
      : [];
    for (const id of plan.remove) state.removeElement(id);
    return { anchorId: anchor?.id ?? added[plan.add.findIndex((member) => member.role === 'front-wall')] };
  } finally {
    drawing.delete(draft.bundleId);
  }
}

/** Member rows of a part editor: one per wall, the roof and the floor, and the windows together. */
const PART_ROWS: Array<{ label: string; takes: (role: string) => boolean }> = [
  { label: 'Front', takes: (role) => role === 'front-wall' },
  { label: 'Left side', takes: (role) => role === 'left-wall' },
  { label: 'Right side', takes: (role) => role === 'right-wall' },
  { label: 'Roof', takes: (role) => role.startsWith('roof') && !role.includes('glazing') },
  { label: 'Floor', takes: (role) => role === 'floor' },
  { label: 'windows', takes: (role) => role.endsWith('-window') || role.endsWith('-glazing') && !role.startsWith('roof') },
  // A rooflight takes other inputs than wall glazing (no close shading): its own row.
  { label: 'Roof glazing', takes: (role) => role.startsWith('roof-glazing') },
];

/** Element fields a bundle sets itself: geometry, identity and its own tags. */
const BUNDLE_OWNED = new Set([
  'id', 'name', 'zoneId', 'parent_element', 'coordinates', 'width', 'height', 'area', 'perimeter', 'orientation360', 'pitch',
  'base_height', 'mid_height', 'free_area_height', 'max_window_open_area', 'isPlaceholder', 'extra_json', 'floorId',
]);
const BUNDLE_OWNED_EXTRA = new Set(['hemie_bundle', 'geometry_face', 'parent_netting_area', '_name_auto_sync']);

/** What the user set on an element (its fabric, a window's opening type), as element fields and its extra_json. */
export function authoredFields(element: Element): Record<string, unknown> {
  const record = element as unknown as Record<string, unknown>;
  // Keys starting `_` are the editor's own bookkeeping, not what the user set.
  const own = Object.keys(record).filter((key) => !BUNDLE_OWNED.has(key) && !key.startsWith('_')).sort().map((key) => [key, record[key]]);
  const extra = element.extra_json ?? {};
  const set = Object.keys(extra).filter((key) => !BUNDLE_OWNED_EXTRA.has(key) && !key.startsWith('_') && key !== 'dormer_bundle').sort().map((key) => [key, extra[key]]);
  return { ...Object.fromEntries(own), extra_json: Object.fromEntries(set) };
}

/** Two members agree when this does. */
const authored = (element: Element) => JSON.stringify(authoredFields(element));

export interface HemieBundlePart {
  label: string;
  ids: string[];
  /** The members of the row differ in what the user set on them. */
  mixed: boolean;
}

export function hemieBundleParts(members: Element[]): HemieBundlePart[] {
  const kind = getHemieBundle(members[0])?.kind;
  // A roof's slopes, each its own part, named as its member is (without the roof's name).
  if (kind === 'roof') {
    const stem = getHemieBundle(members.find((m) => getHemieBundle(m)?.bundle_name) ?? members[0])?.bundle_name ?? '';
    return members.map((m) => ({ label: m.name.startsWith(`${stem} `) ? m.name.slice(stem.length + 1) : m.name, ids: [m.id], mixed: false }));
  }
  return PART_ROWS.flatMap(({ label, takes }) => {
    const row = members.filter((member) => takes(getHemieBundle(member)!.role));
    if (!row.length) return [];
    const name = label !== 'windows' ? label
      : kind === 'conservatory' ? `${row.length} glazing`
        : row.length === 1 ? 'Window' : `${row.length} windows`;
    return [{ label: name, ids: row.map((member) => member.id), mixed: new Set(row.map(authored)).size > 1 }];
  });
}

/**
 * What deleting `ids` deletes: a bundle goes whole, with any member and with its host wall (a
 * bundle has no meaning without it). Returns every id and the bundles' names.
 */
export function hemieBundleDeletion(elementsById: Record<string, Element>, ids: string[]): { ids: string[]; names: string[] } {
  const all = Object.values(elementsById);
  const out = new Set(ids);
  const names: string[] = [];
  // Each bundle by its anchor: deleted with any member, or with its host wall.
  for (const anchor of all) {
    const tag = getHemieBundle(anchor);
    if (!tag || !isHemieBundleAnchor(tag)) continue;
    const members = getHemieBundleMembers(all, tag.bundle_id);
    const hostGone = tag.kind !== 'roof' && out.has(hemieBundleHost(anchor, all)?.id ?? '');
    if (!hostGone && !members.some((member) => out.has(member.id))) continue;
    for (const member of members) out.add(member.id);
    names.push(tag.bundle_name ?? anchor.name);
  }
  return { ids: [...out], names };
}

/** Makes a bundle's members ordinary elements: they keep their geometry and fabric, not the bundle. */
export function detachHemieBundle(state: Pick<HemieBundleStore, 'elementsById' | 'updateElementsBulk'>, bundleId: string): void {
  const members = getHemieBundleMembers(Object.values(state.elementsById), bundleId);
  state.updateElementsBulk(Object.fromEntries(members.map((member) => {
    const extra = { ...member.extra_json };
    delete extra.hemie_bundle;
    return [member.id, { extra_json: extra }];
  })));
}

/** A bundle is stale when its host wall moved, was renamed or changed height, or a bay's roof no longer matches what covers it. */
function bundleStale(anchor: Element, all: Element[], previous: Record<string, Element>): boolean {
  const tag = getHemieBundle(anchor);
  if (tag?.role !== 'front-wall' || !tag.parameters || drawing.has(tag.bundle_id)) return false;
  const host = hemieBundleHost(anchor, all);
  if (!host) return false;
  const before = previous[host.id] as BuildingElementOpaque | undefined;
  if (!before || host.name !== tag.host_wall || before.height !== host.height || before.base_height !== host.base_height
    || JSON.stringify(before.coordinates) !== JSON.stringify(host.coordinates)) return true;
  if (tag.kind !== 'bay') return false;
  const p = bayParameters(tag.parameters as BayParameters);
  const hasRoof = getHemieBundleMembers(all, tag.bundle_id).some((member) => getHemieBundle(member)!.role === 'roof');
  return hasRoof !== (!!p.roof && p.roof !== 'none' && !bayCoveredAbove(host, p, all));
}

/**
 * Keeps bundles on their host walls through the user's edits: a moved, renamed or resized host
 * redraws its bundles, and a bay under a new bay (or no longer under one) loses (or gets back) its
 * roof. The redraw rides in the user's undo step. A bundle that no longer fits keeps its place and
 * says so (`hemieBundleHostProblem`).
 */
export function followHemieBundleHosts<S extends HemieBundleStore & {
  writeIntent: () => string;
  asEditFollowUp: <T>(write: () => T) => T;
}>(store: { subscribe: (listener: (state: S, previous: S) => void) => () => void; getState: () => S }): void {
  let syncing = false;
  store.subscribe((state, previous) => {
    if (syncing || state.writeIntent() !== 'user' || state.elementsById === previous.elementsById) return;
    const all = Object.values(state.elementsById);
    const stale = all.flatMap((element) => (bundleStale(element, all, previous.elementsById) ? [element.id] : []));
    if (!stale.length) return;
    syncing = true;
    try {
      state.asEditFollowUp(() => {
        for (const id of stale) {
          const now = store.getState();
          const anchor = now.elementsById[id];
          const tag = getHemieBundle(anchor);
          const elements = Object.values(now.elementsById);
          const host = anchor && hemieBundleHost(anchor, elements);
          const parameters = anchor && hemieBundleParameters(anchor, elements);
          if (tag && host && parameters) drawHemieBundle(now, tag.kind, host, parameters, anchor);
        }
      });
    } finally {
      syncing = false;
    }
  });
}
