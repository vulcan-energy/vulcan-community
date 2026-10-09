// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  Element,
  ElementDraft,
  Floor,
  MechanicalVentilation,
  MechanicalVentilationDuctwork,
  MechanicalVentilationTerminal,
  SpaceLabel,
  WaterPipework,
} from '../geometry/types';
import { normalizeOrientation360Deg, roundToTwoDecimals } from '../geometry/constants';
import { calculateDerivedBaseHeight, getElementCanvasFloorZValue, networkPoint3, parseExtraJsonRecord } from './elementCanvasFloor';
import { extractAdjacentConditionedFootprintOuterRings, extractGroundFootprintOuterRings } from './buildingFootprintDimensions';
import { orientation360FromSegmentOutwardModelXY, polygonPlanCentroid } from './openingSegmentOutward';
import { isPrimaryPipeworkPlant, planOrthogonalElbow, pointsConnected } from './snapUtils';
import { isPointInPolygon2D as pointInPolygon } from './pointInPolygon';
import { resolveRoomTypeRule } from './spaceLabelDerivation';

export const MVHR_DUCT_ROLES = ['supply', 'extract', 'intake', 'exhaust'] as const;
export type MvhrDuctRole = (typeof MVHR_DUCT_ROLES)[number];

export const MVHR_TERMINAL_ROLES = ['intake', 'exhaust'] as const;
export type MvhrTerminalRole = (typeof MVHR_TERMINAL_ROLES)[number];

export type MvhrDuctRoleStyle = {
  stroke: string;
  strokeWidth: number;
  dash: readonly number[];
};

export const MVHR_DUCT_ROLE_STYLES: Record<MvhrDuctRole, MvhrDuctRoleStyle> = {
  supply: { stroke: '#4ADE80', strokeWidth: 2, dash: [] },
  extract: { stroke: '#22C55E', strokeWidth: 2, dash: [6, 4] },
  intake: { stroke: '#86EFAC', strokeWidth: 2, dash: [12, 5] },
  exhaust: { stroke: '#15803D', strokeWidth: 2, dash: [10, 4, 2, 4] },
};

export function isMvhrDuctRole(value: unknown): value is MvhrDuctRole {
  return typeof value === 'string' && (MVHR_DUCT_ROLES as readonly string[]).includes(value);
}

export function isMvhrTerminalRole(value: unknown): value is MvhrTerminalRole {
  return typeof value === 'string' && (MVHR_TERMINAL_ROLES as readonly string[]).includes(value);
}

export function getMvhrDuctRoleStyle(value: unknown): MvhrDuctRoleStyle {
  return MVHR_DUCT_ROLE_STYLES[isMvhrDuctRole(value) ? value : 'supply'];
}

export function getMechanicalVentilationDuctworkRoleStyle(
  duct: Pick<MechanicalVentilationDuctwork, 'duct_type'>,
): MvhrDuctRoleStyle {
  return getMvhrDuctRoleStyle(duct.duct_type);
}

export type MvhrTerminalPosition = {
  mid_height_air_flow_path: number;
  orientation360: number;
  pitch: number;
};

export type Point3 = { x: number; y: number; z: number };

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function isMvhrTerminalHost(element: Element | undefined): boolean {
  if (!element) return false;
  if (element.type === 'BuildingElementTransparent') return true;
  if (element.type !== 'BuildingElementOpaque') return false;
  if (!Array.isArray(element.coordinates) || element.coordinates.length !== 2) return false;
  return element.is_external_door !== true;
}

export function deriveHostOrientation360(host: Element | undefined): number | undefined {
  if (!host || !isMvhrTerminalHost(host)) return undefined;
  const explicit = finiteNumber((host as { orientation360?: unknown }).orientation360);
  if (explicit !== undefined) return normalizeOrientation360Deg(explicit);
  const coords = host.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return undefined;
  const a = coords[0]!;
  const b = coords[1]!;
  const derived = orientation360FromSegmentOutwardModelXY(a.x, a.y, b.x, b.y, 0);
  return derived === null ? undefined : roundToTwoDecimals(derived);
}

export function deriveHostPitch(host: Element | undefined): number | undefined {
  if (!host || !isMvhrTerminalHost(host)) return undefined;
  const explicit = finiteNumber((host as { pitch?: unknown }).pitch);
  if (explicit !== undefined) return explicit;
  if (Array.isArray(host.coordinates) && host.coordinates.length === 2) return 90;
  return undefined;
}

export function getFirstPoint3(element: Pick<Element, 'coordinates'>): Point3 | undefined {
  const point = element.coordinates?.[0];
  if (!point) return undefined;
  const x = finiteNumber(point.x);
  const y = finiteNumber(point.y);
  const z = finiteNumber(point.z);
  if (x === undefined || y === undefined || z === undefined) return undefined;
  return { x, y, z };
}

export function getTerminalPoint(terminal: Pick<MechanicalVentilationTerminal, 'coordinates'>): Point3 | undefined {
  return getFirstPoint3(terminal);
}

export function deriveMechanicalVentilationTerminalPosition(
  terminal: Pick<MechanicalVentilationTerminal, 'coordinates' | 'orientation360' | 'pitch'>,
  host: Element | undefined,
): MvhrTerminalPosition | null {
  const point = getTerminalPoint(terminal);
  const orientation360 = isMvhrTerminalHost(host)
    ? deriveHostOrientation360(host)
    : finiteNumber(terminal.orientation360);
  const pitch = isMvhrTerminalHost(host)
    ? deriveHostPitch(host)
    : finiteNumber(terminal.pitch);
  if (!point || orientation360 === undefined || pitch === undefined) return null;
  return {
    mid_height_air_flow_path: roundToTwoDecimals(point.z),
    orientation360: roundToTwoDecimals(normalizeOrientation360Deg(orientation360)),
    pitch: roundToTwoDecimals(pitch),
  };
}

export function distance3d(a: Point3, b: Point3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function sameDuctPoint(a: Point3, b: Point3): boolean {
  return pointsConnected(undefined, a, undefined, b);
}

export function ductEndpoints(duct: Pick<MechanicalVentilationDuctwork, 'coordinates'>): [Point3, Point3] | null {
  const coords = duct.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const a = coords[0]!;
  const b = coords[coords.length - 1]!;
  if (![a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite)) return null;
  return [a, b];
}

type DuctEndpointComponents = {
  endpoints: [Point3, Point3][];
  roots: number[];
};

function buildDuctEndpointComponents(
  ducts: ReadonlyArray<Pick<MechanicalVentilationDuctwork, 'coordinates'>>,
): DuctEndpointComponents {
  const endpoints = ducts.map(ductEndpoints).filter((v): v is [Point3, Point3] => v !== null);
  if (endpoints.length <= 1) return { endpoints, roots: endpoints.map((_, index) => index) };
  const parent = endpoints.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!;
      index = parent[index]!;
    }
    return index;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i < endpoints.length; i += 1) {
    for (let j = i + 1; j < endpoints.length; j += 1) {
      const a = endpoints[i]!;
      const b = endpoints[j]!;
      if (
        sameDuctPoint(a[0], b[0]) ||
        sameDuctPoint(a[0], b[1]) ||
        sameDuctPoint(a[1], b[0]) ||
        sameDuctPoint(a[1], b[1])
      ) {
        union(i, j);
      }
    }
  }
  return { endpoints, roots: endpoints.map((_, index) => find(index)) };
}

export function countDuctEndpointComponents(
  ducts: ReadonlyArray<Pick<MechanicalVentilationDuctwork, 'coordinates'>>,
): number {
  const components = buildDuctEndpointComponents(ducts);
  return new Set(components.roots).size;
}

/** Ducts grouped into runs: each run is one endpoint component (ducts joined end to end). */
export function ductEndpointRuns<T extends Pick<MechanicalVentilationDuctwork, 'coordinates'>>(
  ducts: ReadonlyArray<T>,
): T[][] {
  const valid = ducts.filter((duct) => ductEndpoints(duct) !== null);
  const { roots } = buildDuctEndpointComponents(valid);
  const runs = new Map<number, T[]>();
  valid.forEach((duct, index) => {
    const root = roots[index]!;
    runs.set(root, [...(runs.get(root) ?? []), duct]);
  });
  return [...runs.values()];
}

function ductRunTouchesPoint(
  run: ReadonlyArray<Pick<MechanicalVentilationDuctwork, 'coordinates'>>,
  point: Point3,
): boolean {
  return run.some((duct) => ductEndpoints(duct)!.some((end) => sameDuctPoint(end, point)));
}

export function allDuctEndpointComponentsConnectToPoint(
  ducts: ReadonlyArray<Pick<MechanicalVentilationDuctwork, 'coordinates'>>,
  point: Point3,
): boolean {
  const runs = ductEndpointRuns(ducts);
  return runs.length > 0 && runs.every((run) => ductRunTouchesPoint(run, point));
}

export type MvhrCrossRoleEndpointOverlap = {
  roles: [MvhrDuctRole, MvhrDuctRole];
  ductNames: [string | undefined, string | undefined];
  point: Point3;
};

export function findExactCrossRoleDuctEndpointOverlap(
  ducts: ReadonlyArray<Pick<MechanicalVentilationDuctwork, 'coordinates' | 'duct_type' | 'name'>>,
  ignoredPoint?: Point3,
): MvhrCrossRoleEndpointOverlap | null {
  for (let i = 0; i < ducts.length; i += 1) {
    const ductA = ducts[i]!;
    if (!isMvhrDuctRole(ductA.duct_type)) continue;
    const endpointsA = ductEndpoints(ductA);
    if (!endpointsA) continue;

    for (let j = i + 1; j < ducts.length; j += 1) {
      const ductB = ducts[j]!;
      if (!isMvhrDuctRole(ductB.duct_type) || ductA.duct_type === ductB.duct_type) continue;
      const endpointsB = ductEndpoints(ductB);
      if (!endpointsB) continue;

      for (const pointA of endpointsA) {
        for (const pointB of endpointsB) {
          if (!sameDuctPoint(pointA, pointB)) continue;
          if (ignoredPoint && sameDuctPoint(pointA, ignoredPoint)) continue;
          return {
            roles: [ductA.duct_type, ductB.duct_type],
            ductNames: [ductA.name, ductB.name],
            point: pointA,
          };
        }
      }
    }
  }
  return null;
}

export type MvhrDuctTopologyWarning =
  | { kind: 'cross-role-endpoint-overlap'; message: string; overlap: MvhrCrossRoleEndpointOverlap }
  | { kind: 'disconnected-role'; role: MvhrDuctRole; message: string }
  | { kind: 'role-not-connected-to-unit'; role: MvhrDuctRole; message: string };

export function collectMvhrDuctTopologyWarnings(
  ducts: ReadonlyArray<Pick<MechanicalVentilationDuctwork, 'coordinates' | 'duct_type' | 'name'>>,
  options: {
    unitPoint?: Point3;
    unitLabel?: string;
    roles?: readonly MvhrDuctRole[];
  } = {},
): MvhrDuctTopologyWarning[] {
  const warnings: MvhrDuctTopologyWarning[] = [];
  const roles = options.roles ?? MVHR_DUCT_ROLES;
  const unitLabel = options.unitLabel ?? 'the MVHR unit';

  const crossRoleOverlap = findExactCrossRoleDuctEndpointOverlap(ducts, options.unitPoint);
  if (crossRoleOverlap) {
    warnings.push({
      kind: 'cross-role-endpoint-overlap',
      message: 'Different MVHR duct roles share an endpoint away from the MVHR unit',
      overlap: crossRoleOverlap,
    });
  }

  for (const role of roles) {
    const roleDucts = ducts.filter((duct) => duct.duct_type === role);
    if (roleDucts.length > 1 && countDuctEndpointComponents(roleDucts) > 1) {
      warnings.push({
        kind: 'disconnected-role',
        role,
        message: `Disconnected ${role} duct run for ${unitLabel}`,
      });
    }
    if (
      options.unitPoint &&
      roleDucts.length > 0 &&
      !allDuctEndpointComponentsConnectToPoint(roleDucts, options.unitPoint)
    ) {
      warnings.push({
        kind: 'role-not-connected-to-unit',
        role,
        message: `${role} duct run is not connected to ${unitLabel}`,
      });
    }
  }

  return warnings;
}

/** A duct end coincides with the terminal point (both are metres, so the one connectivity rule applies). */
export function terminalConnectsToDuctEndpoint(
  terminal: Pick<MechanicalVentilationTerminal, 'coordinates'>,
  ducts: ReadonlyArray<Pick<MechanicalVentilationDuctwork, 'coordinates'>>,
): boolean {
  const point = getTerminalPoint(terminal);
  return !!point && ducts.some((duct) => ductEndpoints(duct)?.some((end) => sameDuctPoint(end, point)));
}

type DuctRunContext = {
  unitPoint: Point3;
  roleDucts: MechanicalVentilationDuctwork[];
  run: MechanicalVentilationDuctwork[];
};

/**
 * The duct's run (its endpoint component among same-unit, same-role ducts) and its MVHR unit point
 * in metres, resolved the way validation resolves them. Null when the unit or the duct's geometry
 * is missing. `effectiveFloors` carry effective storey heights (`withEffectiveStoreyHeights`).
 */
function ductRunContext(
  duct: MechanicalVentilationDuctwork,
  elements: ReadonlyArray<Element>,
  effectiveFloors: Floor[],
): DuctRunContext | null {
  const parentName = duct.parent_element?.trim();
  if (!parentName || !isMvhrDuctRole(duct.duct_type)) return null;
  const units = elements.filter(
    (el): el is MechanicalVentilation => el.type === 'MechanicalVentilation' && el.name.trim() === parentName,
  );
  const unit = units.length === 1 ? units[0]! : undefined;
  const unitPoint = unit && unit.vent_type === 'MVHR' ? networkPoint3(unit, effectiveFloors) : undefined;
  if (!unit || !unitPoint) return null;
  const roleDucts = elements.filter(
    (el): el is MechanicalVentilationDuctwork =>
      el.type === 'MechanicalVentilationDuctwork' &&
      !el.isPlaceholder &&
      el.parent_element === unit.name &&
      el.duct_type === duct.duct_type,
  );
  const run = ductEndpointRuns(roleDucts).find((candidate) => candidate.includes(duct));
  return run ? { unitPoint, roleDucts, run } : null;
}

/** The MVHR unit point when the duct's run reaches it, else null. */
export function ductRunUnitPoint(
  duct: MechanicalVentilationDuctwork,
  elements: ReadonlyArray<Element>,
  effectiveFloors: Floor[],
): Point3 | null {
  const context = ductRunContext(duct, elements, effectiveFloors);
  return context && ductRunTouchesPoint(context.run, context.unitPoint) ? context.unitPoint : null;
}

/**
 * Where the "Disconnected" chip goes for a duct whose run the topology check reports as loose:
 * the run's end nearest the unit, which is where the fix is. A run's far end in a room is never marked.
 */
export function looseDuctRunEndNearestUnit(
  duct: MechanicalVentilationDuctwork,
  elements: ReadonlyArray<Element>,
  effectiveFloors: Floor[],
): Point3 | null {
  const context = ductRunContext(duct, elements, effectiveFloors);
  if (!context || ductRunTouchesPoint(context.run, context.unitPoint)) return null;
  const warnings = collectMvhrDuctTopologyWarnings(context.roleDucts, {
    unitPoint: context.unitPoint,
    roles: [duct.duct_type],
  });
  if (!warnings.some((w) => w.kind === 'disconnected-role' || w.kind === 'role-not-connected-to-unit')) return null;
  return runEndNearest(context.run, [context.unitPoint]);
}

/** The run's free end (not a joint shared with another segment of the run) nearest any of `targets`. */
function runEndNearest(run: ReadonlyArray<Pick<Element, 'coordinates'>>, targets: Point3[]): Point3 | null {
  const freeEnds = run.flatMap((segment) =>
    ductEndpoints(segment)!.filter((end) =>
      !run.some((other) => other !== segment && ductEndpoints(other)!.some((p) => sameDuctPoint(p, end)))));
  const reach = (end: Point3) => Math.min(...targets.map((target) => distance3d(end, target)));
  return freeEnds.length === 0 ? null : freeEnds.reduce((best, end) => (reach(end) < reach(best) ? end : best));
}

type PlanPoint = { x: number; y: number };

/** Height above its storey's base a new MVHR terminal gets, whether drawn, added from the unit panel or auto-planned. */
export const DEFAULT_DRAWN_MVHR_TERMINAL_HEIGHT_M = 2.4;

/**
 * Physical z of a new terminal on a storey whose base is `storeyBaseHeightM` (from
 * `calculateDerivedBaseHeight` over effective floors), which is also its exported
 * `mid_height_air_flow_path`.
 */
export function defaultMvhrTerminalZ(storeyBaseHeightM: number): number {
  return roundToTwoDecimals(storeyBaseHeightM + DEFAULT_DRAWN_MVHR_TERMINAL_HEIGHT_M);
}

/** Clamped plan projection onto a segment, keeping the point's z. The store places hosted children with it. */
export function projectPointToSegment(
  point: { x: number; y: number; z?: number },
  segment: readonly [Point3, Point3],
): Point3 {
  const [a, b] = segment;
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const v2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * vx + (point.y - a.y) * vy) / v2));
  return { x: a.x + t * vx, y: a.y + t * vy, z: point.z ?? a.z };
}

/**
 * A terminal hosted on `host` at `planPoint`, at the default terminal height on the host's storey.
 * The unit panel's add button and the auto-duct planner both build terminals with it; the store
 * projects the point onto the host on commit.
 */
export function hostedMvhrTerminalDraft(
  role: MvhrTerminalRole,
  unitName: string,
  host: Element,
  planPoint: PlanPoint,
  effectiveFloors: Floor[],
): Extract<ElementDraft, { type: 'MechanicalVentilationTerminal' }> {
  const z = defaultMvhrTerminalZ(calculateDerivedBaseHeight(getElementCanvasFloorZValue(host, effectiveFloors) ?? 0, effectiveFloors));
  return {
    name: '',
    type: 'MechanicalVentilationTerminal',
    terminal_type: role,
    parent_element: unitName,
    host_element: host.name,
    floorId: host.floorId,
    coordinates: [{ x: planPoint.x, y: planPoint.y, z }],
    isPlaceholder: false,
  };
}

/** HEM takes ductwork only for MVHR: extract to wet rooms, supply to habitable rooms, intake and exhaust. */
const MVHR_AUTO_DUCT_ROLES = {
  rooms: [{ role: 'extract', wet: true }, { role: 'supply', wet: false }] as Array<{ role: MvhrDuctRole; wet: boolean }>,
  terminals: ['intake', 'exhaust'] as MvhrTerminalRole[],
};

/** Run ends sit at least this far inside a room's boundary. */
const ROOM_END_CLEARANCE_M = 0.1;
/**
 * Each run's room end is shifted by this times (its index mod RUN_END_STAGGER_STEPS), so neighbouring
 * runs never share an elbow or end, and a large plan never pushes a point out of a small room.
 */
const RUN_END_STAGGER_M = 0.05;
const RUN_END_STAGGER_STEPS = 4;

function roomServedByRole(label: SpaceLabel, wet: boolean): boolean {
  const { increments } = resolveRoomTypeRule(label.room_type ?? '').rule;
  return wet ? increments.NumberOfWetRooms === 1 : increments.NumberOfHabitableRooms === 1;
}

function distanceToSegment(p: PlanPoint, a: PlanPoint, b: PlanPoint): number {
  const q = projectPointToSegment(p, [{ ...a, z: 0 }, { ...b, z: 0 }]);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/**
 * Where a run ends in a room, shifted by `stagger` on both axes: the label's vertex centroid, or,
 * for a concave room, the first fan triangle's centroid, whichever lands strictly inside with
 * ROOM_END_CLEARANCE_M to every edge. Null when none does.
 */
function pointInsideRoom(ring: PlanPoint[], stagger: number): PlanPoint | null {
  const candidates = [polygonPlanCentroid(ring)!];
  for (let i = 1; i + 1 < ring.length; i += 1) candidates.push(polygonPlanCentroid([ring[0]!, ring[i]!, ring[i + 1]!])!);
  for (const c of candidates) {
    const p = { x: roundToTwoDecimals(c.x + stagger), y: roundToTwoDecimals(c.y + stagger) };
    if (!pointInPolygon(p, ring)) continue;
    if (ring.every((a, i) => distanceToSegment(p, a, ring[(i + 1) % ring.length]!) >= ROOM_END_CLEARANCE_M)) return p;
  }
  return null;
}

/** Shorter legs than this are dropped: a near-axis end runs straight rather than dog-legging a few mm. */
const MIN_LEG_M = 0.01;

/** The orthogonal L (longer axis first) at the unit's height from `start` to `end`, then a vertical leg when `end` is higher or lower. */
function orthogonalRun(start: Point3, end: Point3): Point3[] {
  const corner = { x: end.x, y: end.y, z: start.z };
  const elbow = planOrthogonalElbow(start, end, 0, false);
  const useElbow = elbow && distance3d(start, { ...elbow, z: start.z }) >= MIN_LEG_M && distance3d(corner, { ...elbow, z: start.z }) >= MIN_LEG_M;
  return [start, ...(useElbow ? [{ ...elbow, z: start.z }] : []), corner, end];
}

/**
 * Auto-duct plan for one MVHR unit (other unit types get none): one radial run per wet room
 * (extract) and per habitable room (supply), from the unit point to a point inside the room's space
 * label, plus a run to an intake and an exhaust terminal. Each segment is its own duct draft;
 * consecutive segments share exact endpoints so each run is one connected component touching the
 * unit, and runs share no vertex but the unit point (see RUN_END_STAGGER_M).
 *
 * Everything is in metres: the unit sits at its storey's base height. A room on another storey
 * gets its L at the unit's height and a riser at the room end up (or down) to the room storey's
 * base height; the riser belongs to the room's storey. A room's storey is its label's floor
 * (`floors[label.storey]`), never `label.storey` read as a zIndex, which differs once a basement
 * exists.
 *
 * A room whose space label already holds a free run end of that role on the room's storey is
 * skipped, as is a terminal role that already has a duct; an existing terminal without a duct gets
 * one ending on its point. Re-running only fills gaps. Output order is stable (rooms by id).
 * `effectiveFloors` carry effective storey heights (`withEffectiveStoreyHeights`) in store order.
 */
export function planAutoDucts(
  unit: MechanicalVentilation,
  elements: Element[],
  spaceLabels: readonly SpaceLabel[],
  effectiveFloors: Floor[],
): ElementDraft[] {
  const roles = unit.vent_type === 'MVHR' ? MVHR_AUTO_DUCT_ROLES : null;
  const unitPoint = networkPoint3(unit, effectiveFloors);
  const unitStorey = getElementCanvasFloorZValue(unit, effectiveFloors);
  const unitFloorId = effectiveFloors.find((floor) => floor.zIndex === unitStorey)?.id;
  if (!roles || !unitPoint || unitStorey === undefined || !unitFloorId) return [];

  const unitDucts = elements.filter(
    (el): el is MechanicalVentilationDuctwork =>
      el.type === 'MechanicalVentilationDuctwork' && !el.isPlaceholder && el.parent_element?.trim() === unit.name,
  );
  // Every duct vertex of this unit, existing or planned, bar the unit point: a new run may not
  // share one (a shared joint away from the unit is a topology warning or an overlap error).
  const takenPoints: Point3[] = [];
  for (const duct of unitDucts) {
    for (const q of ductEndpoints(duct) ?? []) if (!sameDuctPoint(q, unitPoint)) takenPoints.push(q);
  }
  const drafts: ElementDraft[] = [];
  const addRun = (role: MvhrDuctRole, points: Point3[], endFloorId = unitFloorId) => {
    for (let i = 0; i + 1 < points.length; i += 1) {
      const [a, b] = [points[i]!, points[i + 1]!];
      if (a.x === b.x && a.y === b.y && a.z === b.z) continue;
      const length = roundToTwoDecimals(distance3d(a, b));
      drafts.push({
        name: '',
        type: 'MechanicalVentilationDuctwork',
        duct_type: role,
        parent_element: unit.name,
        // Legs at the unit's height belong to its storey; a riser to the room's.
        floorId: a.z === unitPoint.z && b.z === unitPoint.z ? unitFloorId : endFloorId,
        coordinates: [a, b],
        length,
        isPlaceholder: false,
      });
      takenPoints.push(b);
    }
  };

  const labels = spaceLabels
    .flatMap((label) => {
      const floor = effectiveFloors[label.storey];
      return floor ? [{ label, floor, z: calculateDerivedBaseHeight(floor.zIndex, effectiveFloors) }] : [];
    })
    .sort((a, b) => (a.label.id < b.label.id ? -1 : a.label.id > b.label.id ? 1 : 0));
  let runIndex = 0;
  for (const { role, wet } of roles.rooms) {
    const roleDucts = unitDucts.filter((duct) => duct.duct_type === role);
    const ends = roleDucts.map((duct) => ductEndpoints(duct));
    // Free run ends with their duct's storey: not the unit point, and not a joint or elbow shared with another duct of the role.
    const freeEnds: Array<{ end: Point3; storey: number | undefined }> = [];
    roleDucts.forEach((duct, i) => {
      for (const end of ends[i] ?? []) {
        if (sameDuctPoint(end, unitPoint) || ends.some((other, j) => j !== i && other?.some((q) => sameDuctPoint(q, end)))) continue;
        freeEnds.push({ end, storey: getElementCanvasFloorZValue(duct, effectiveFloors) });
      }
    });
    for (const { label, floor, z } of labels) {
      if (!roomServedByRole(label, wet)) continue;
      // Every candidate room takes an index, served or not, so a re-run staggers exactly as the first plan did.
      const index = runIndex++;
      const ring = (label.coordinates ?? []).map((p) => ({ x: p.x, y: p.y }));
      if (ring.length < 3 || freeEnds.some(({ end, storey }) => storey === floor.zIndex && pointInPolygon(end, ring))) continue;
      // The first stagger whose run shares no vertex with another run. Stacked rooms on different
      // storeys share a centroid, so their runs would otherwise coincide on the unit's storey.
      // ponytail: a room whose every stagger collides is left for hand drawing; never seen in practice.
      for (let bump = 0; bump < RUN_END_STAGGER_STEPS; bump += 1) {
        const target = pointInsideRoom(ring, RUN_END_STAGGER_M * ((index + bump) % RUN_END_STAGGER_STEPS));
        // No interior point, or the unit sits on it: nothing sensible to route.
        if (!target || Math.hypot(target.x - unitPoint.x, target.y - unitPoint.y) < ROOM_END_CLEARANCE_M) break;
        const run = orthogonalRun(unitPoint, { ...target, z });
        if (run.slice(1).some((q) => takenPoints.some((t) => sameDuctPoint(q, t)))) continue;
        addRun(role, run, floor.id);
        break;
      }
    }
  }

  const terminals = elements.filter(
    (el): el is MechanicalVentilationTerminal => el.type === 'MechanicalVentilationTerminal' && !el.isPlaceholder,
  );
  const takenHosts = new Set(terminals.map((terminal) => terminal.host_element));
  const freeHosts = elements
    .flatMap((host) => {
      if (
        host.isPlaceholder || !isMvhrTerminalHost(host) || !(host.coordinates?.length >= 2) ||
        takenHosts.has(host.name) || getElementCanvasFloorZValue(host, effectiveFloors) !== unitStorey
      ) return [];
      const segment = [host.coordinates[0]!, host.coordinates[1]!] as const;
      const point = projectPointToSegment(unitPoint, segment);
      return [{ host, segment, distance: Math.hypot(point.x - unitPoint.x, point.y - unitPoint.y) }];
    })
    .sort((a, b) => a.distance - b.distance || (a.host.name < b.host.name ? -1 : a.host.name > b.host.name ? 1 : 0));
  const ownTerminalByRole = new Map(
    terminals.filter((terminal) => terminal.parent_element?.trim() === unit.name).map((terminal) => [terminal.terminal_type, terminal]),
  );
  for (const role of roles.terminals) {
    if (unitDucts.some((duct) => duct.duct_type === role)) continue;
    const existing = ownTerminalByRole.get(role);
    // A terminal on another storey is out of reach for now: no duct to it, and no second terminal.
    if (existing && getElementCanvasFloorZValue(existing, effectiveFloors) !== unitStorey) continue;
    const existingPoint = existing && getTerminalPoint(existing);
    if (existingPoint) {
      addRun(role, orthogonalRun(unitPoint, existingPoint));
      continue;
    }
    if (existing) continue;
    const nearest = freeHosts.shift();
    if (!nearest) continue;
    const terminal = hostedMvhrTerminalDraft(role, unit.name, nearest.host, projectPointToSegment(unitPoint, nearest.segment), effectiveFloors);
    // The duct ends where the store will put the terminal: the same projection of the same point.
    addRun(role, orthogonalRun(unitPoint, projectPointToSegment(terminal.coordinates[0] as Point3, nearest.segment)));
    drafts.push(terminal);
  }
  return drafts;
}

export type PrimaryPipeworkPair = { heatSource: Element; cylinder: Element; heatSourcePoint: Point3; cylinderPoint: Point3 };

/** Names of the HeatSourceWet a cylinder heats from: its StorageTank entries' HeatSourceWet heat sources. */
function cylinderHeatSourceNames(cylinder: Element): string[] {
  const names: string[] = [];
  const tanks = parseExtraJsonRecord(parseExtraJsonRecord(cylinder.extra_json)?.HotWaterSource) ?? {};
  for (const tank of Object.values(tanks)) {
    const record = parseExtraJsonRecord(tank);
    // The model transform attaches primary pipework to StorageTank sources only; a combi has none.
    if (record?.type !== 'StorageTank') continue;
    for (const [key, source] of Object.entries(parseExtraJsonRecord(record.HeatSource) ?? {})) {
      const heatSource = parseExtraJsonRecord(source);
      if (heatSource?.type !== 'HeatSourceWet') continue;
      names.push(typeof heatSource.name === 'string' && heatSource.name.trim() ? heatSource.name.trim() : key);
    }
  }
  return names;
}

/**
 * Each cylinder (a HotWaterSource System row with a StorageTank) with each HeatSourceWet System row
 * it heats from, both placed, in metres. Sorted by cylinder then heat source id.
 */
export function primaryPipeworkPairs(elements: ReadonlyArray<Element>, effectiveFloors: Floor[]): PrimaryPipeworkPair[] {
  const plant = elements.filter((el) => isPrimaryPipeworkPlant(el));
  const subcategory = (el: Element) => (el as { subcategory?: unknown }).subcategory;
  const pairs: PrimaryPipeworkPair[] = [];
  for (const cylinder of plant) {
    if (subcategory(cylinder) !== 'HotWaterSource') continue;
    const names = cylinderHeatSourceNames(cylinder);
    const cylinderPoint = networkPoint3(cylinder, effectiveFloors);
    for (const heatSource of plant) {
      const keys = Object.keys(parseExtraJsonRecord(parseExtraJsonRecord(heatSource.extra_json)?.HeatSourceWet) ?? {});
      if (subcategory(heatSource) !== 'HeatSourceWet' || !keys.some((key) => names.includes(key))) continue;
      const heatSourcePoint = networkPoint3(heatSource, effectiveFloors);
      if (cylinderPoint && heatSourcePoint) pairs.push({ heatSource, cylinder, heatSourcePoint, cylinderPoint });
    }
  }
  const byId = (a: Element, b: Element) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return pairs.sort((a, b) => byId(a.cylinder, b.cylinder) || byId(a.heatSource, b.heatSource));
}

function primaryPipes(elements: ReadonlyArray<Element>): WaterPipework[] {
  return elements.filter((el): el is WaterPipework =>
    el.type === 'WaterPipework' && !el.isPlaceholder && (el.pipework_type ?? 'primary') === 'primary');
}

/**
 * The dwelling footprint in plan: the lowest ground floor polygons, else (a flat) the lowest
 * horizontal adjacent-conditioned polygons, as for the FHS length and width.
 */
function dwellingFootprintRings(elements: Element[]): PlanPoint[][] {
  const ground = extractGroundFootprintOuterRings(elements);
  return ground.length > 0 ? ground : extractAdjacentConditionedFootprintOuterRings(elements);
}

/**
 * `a`→`b` split where its plan projection crosses a footprint edge, each piece with its location:
 * `internal` when its plan midpoint is inside the footprint. Adjacent pieces of one location merge.
 */
function splitAtFootprint(a: Point3, b: Point3, rings: PlanPoint[][]): Array<{ a: Point3; b: Point3; location: 'internal' | 'external' }> {
  const ts = [0, 1];
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  for (const ring of rings) {
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length]!;
      const [ex, ey] = [q.x - p.x, q.y - p.y];
      const denom = dx * ey - dy * ex;
      if (denom === 0) return; // Parallel (or a vertical leg): no crossing point.
      const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / denom;
      const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / denom;
      if (t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1) ts.push(t);
    });
  }
  const at = (t: number): Point3 => (t === 0 ? a : t === 1 ? b : { x: a.x + t * dx, y: a.y + t * dy, z: a.z + t * (b.z - a.z) });
  const pieces: Array<{ a: Point3; b: Point3; location: 'internal' | 'external' }> = [];
  [...new Set(ts)].sort((m, n) => m - n).forEach((t, i, sorted) => {
    if (i === 0) return;
    const [p, q] = [at(sorted[i - 1]!), at(t)];
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const location = rings.some((ring) => pointInPolygon(mid, ring)) ? 'internal' : 'external';
    const last = pieces[pieces.length - 1];
    if (last?.location === location) last.b = q;
    else pieces.push({ a: p, b: q, location });
  });
  return pieces;
}

/**
 * Auto-pipe plan: primary pipework from each heat source to each cylinder it heats (see
 * `primaryPipeworkPairs`; a combi has no cylinder, so nothing). One orthogonal L at the heat
 * source's height, longer axis first, then a riser at the cylinder when it is on another storey,
 * as `planAutoDucts` routes. Runs start and end exactly on the two plant points. Each leg is split
 * where it crosses the dwelling footprint, so every pipe draft has one `location`; the HEM pipe
 * fields (diameters, insulation, contents) come from the defaults' primary pipework at merge, as
 * for drawn pipes. A pair already joined by a run of primary pipes is skipped. Without a footprint
 * the location can't be derived, so the plan is empty. Output order is stable (pairs by id).
 * `effectiveFloors` carry effective storey heights (`withEffectiveStoreyHeights`).
 */
export function planPrimaryPipework(elements: Element[], effectiveFloors: Floor[]): ElementDraft[] {
  const rings = dwellingFootprintRings(elements);
  if (rings.length === 0) return [];
  const runs = ductEndpointRuns(primaryPipes(elements));
  const floorIdOf = (el: Element) => effectiveFloors.find((floor) => floor.zIndex === getElementCanvasFloorZValue(el, effectiveFloors))?.id;
  const drafts: ElementDraft[] = [];
  for (const { heatSource, cylinder, heatSourcePoint: start, cylinderPoint: end } of primaryPipeworkPairs(elements, effectiveFloors)) {
    if (runs.some((run) => ductRunTouchesPoint(run, start) && ductRunTouchesPoint(run, end))) continue;
    const [startFloorId, endFloorId] = [floorIdOf(heatSource), floorIdOf(cylinder)];
    if (!startFloorId || !endFloorId) continue;
    const points = orthogonalRun(start, end);
    for (let i = 0; i + 1 < points.length; i += 1) {
      const [a, b] = [points[i]!, points[i + 1]!];
      if (a.x === b.x && a.y === b.y && a.z === b.z) continue;
      for (const piece of splitAtFootprint(a, b, rings)) {
        drafts.push({
          name: '',
          type: 'WaterPipework',
          pipework_type: 'primary',
          location: piece.location,
          simplified_pipework: false,
          parent_element: null,
          // Legs at the heat source's height belong to its storey; a riser to the cylinder's.
          floorId: a.z === start.z && b.z === start.z ? startFloorId : endFloorId,
          coordinates: [piece.a, piece.b],
          length: roundToTwoDecimals(distance3d(piece.a, piece.b)),
          isPlaceholder: false,
        });
      }
    }
  }
  return drafts;
}

/**
 * Why a primary pipe's run is loose: it does not reach both the heat source and the cylinder of any
 * pair. `looseEnd` is the run's free end nearest the plant it misses (the chip goes there). Null for
 * a connected run, a non-primary pipe, or a model with no heat source and cylinder pair.
 */
export function primaryPipeRunGap(
  pipe: Element,
  elements: ReadonlyArray<Element>,
  effectiveFloors: Floor[],
): { message: string; looseEnd: Point3 | null } | null {
  if (pipe.type !== 'WaterPipework' || pipe.isPlaceholder || (pipe.pipework_type ?? 'primary') !== 'primary') return null;
  const pairs = primaryPipeworkPairs(elements, effectiveFloors);
  const run = pairs.length > 0 ? ductEndpointRuns(primaryPipes(elements)).find((r) => r.some((p) => p.id === pipe.id)) : undefined;
  if (!run) return null;
  const reaches = (point: Point3) => ductRunTouchesPoint(run, point);
  if (pairs.some((pair) => reaches(pair.heatSourcePoint) && reaches(pair.cylinderPoint))) return null;
  const pair = pairs.find((p) => reaches(p.heatSourcePoint) || reaches(p.cylinderPoint)) ?? pairs[0]!;
  const missed = ([[pair.heatSource, pair.heatSourcePoint], [pair.cylinder, pair.cylinderPoint]] as const)
    .filter(([, point]) => !reaches(point));
  return {
    message: `Primary pipework run is not connected to ${missed.map(([el]) => el.name).join(' and ')}`,
    looseEnd: runEndNearest(run, missed.map(([, point]) => point)),
  };
}
