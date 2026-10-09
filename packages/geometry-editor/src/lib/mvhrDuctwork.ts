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
} from '../geometry/types';
import { normalizeOrientation360Deg, roundToTwoDecimals } from '../geometry/constants';
import { getElementCanvasFloorZValue } from './elementCanvasFloor';
import { orientation360FromSegmentOutwardModelXY } from './openingSegmentOutward';
import { planOrthogonalElbow, pointsConnected } from './snapUtils';
import { pointInPolygon, polygonCentroid2d } from './spaceInference';
import { resolveRoomTypeRule } from './spaceLabelDerivation';
import { calculateDerivedBaseHeight, withEffectiveStoreyHeights } from './zoneDerivation';

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

/**
 * Terminals are the one near-miss exception to exact connectivity: a hosted terminal's point is
 * re-projected onto its wall or window (unrounded, z = air-flow-path height), while drawn duct ends
 * are rounded to 0.01 m, so the two cannot be relied on to coincide exactly.
 */
export const MVHR_TERMINAL_DUCT_TOLERANCE_M = 0.35;

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

export function terminalIsNearDuctEndpoint(
  terminal: Pick<MechanicalVentilationTerminal, 'coordinates'>,
  ducts: ReadonlyArray<Pick<MechanicalVentilationDuctwork, 'coordinates'>>,
  tolerance = MVHR_TERMINAL_DUCT_TOLERANCE_M,
): boolean {
  const point = getTerminalPoint(terminal);
  if (!point) return false;
  for (const duct of ducts) {
    const endpoints = ductEndpoints(duct);
    if (!endpoints) continue;
    if (distance3d(point, endpoints[0]) <= tolerance || distance3d(point, endpoints[1]) <= tolerance) {
      return true;
    }
  }
  return false;
}

type DuctRunContext = {
  unitPoint: Point3;
  roleDucts: MechanicalVentilationDuctwork[];
  run: MechanicalVentilationDuctwork[];
};

/**
 * The duct's run (its endpoint component among same-unit, same-role ducts) and its MVHR unit point,
 * resolved the way validation resolves them. Null when the unit or the duct's geometry is missing.
 */
function ductRunContext(duct: MechanicalVentilationDuctwork, elements: ReadonlyArray<Element>): DuctRunContext | null {
  const parentName = duct.parent_element?.trim();
  if (!parentName || !isMvhrDuctRole(duct.duct_type)) return null;
  const units = elements.filter(
    (el): el is MechanicalVentilation => el.type === 'MechanicalVentilation' && el.name.trim() === parentName,
  );
  const unit = units.length === 1 ? units[0]! : undefined;
  const unitPoint = unit && unit.vent_type === 'MVHR' ? getFirstPoint3(unit) : undefined;
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
export function ductRunUnitPoint(duct: MechanicalVentilationDuctwork, elements: ReadonlyArray<Element>): Point3 | null {
  const context = ductRunContext(duct, elements);
  return context && ductRunTouchesPoint(context.run, context.unitPoint) ? context.unitPoint : null;
}

/**
 * Where the "Unsnapped vertex" chip goes for a duct whose run the topology check reports as loose:
 * the run's end nearest the unit, which is where the fix is. A run's far end in a room is never marked.
 */
export function looseDuctRunEndNearestUnit(
  duct: MechanicalVentilationDuctwork,
  elements: ReadonlyArray<Element>,
): Point3 | null {
  const context = ductRunContext(duct, elements);
  if (!context || ductRunTouchesPoint(context.run, context.unitPoint)) return null;
  const warnings = collectMvhrDuctTopologyWarnings(context.roleDucts, {
    unitPoint: context.unitPoint,
    roles: [duct.duct_type],
  });
  if (!warnings.some((w) => w.kind === 'disconnected-role' || w.kind === 'role-not-connected-to-unit')) return null;
  // Free ends only: a joint shared with another duct of the run is not where the run stops.
  const freeEnds = context.run.flatMap((runDuct) =>
    ductEndpoints(runDuct)!.filter((end) =>
      !context.run.some((other) => other !== runDuct && ductEndpoints(other)!.some((p) => sameDuctPoint(p, end)))));
  if (freeEnds.length === 0) return null;
  return freeEnds.reduce((best, end) =>
    distance3d(end, context.unitPoint) < distance3d(best, context.unitPoint) ? end : best);
}

type PlanPoint = { x: number; y: number };

/** Room roles and terminal roles each unit type gets ductwork for. Unlisted types get none. */
const AUTO_DUCT_ROLES: Partial<Record<MechanicalVentilation['vent_type'], {
  rooms: Array<{ role: MvhrDuctRole; wet: boolean }>;
  terminals: MvhrTerminalRole[];
}>> = {
  MVHR: { rooms: [{ role: 'extract', wet: true }, { role: 'supply', wet: false }], terminals: ['intake', 'exhaust'] },
  'Centralised continuous MEV': { rooms: [{ role: 'extract', wet: true }], terminals: ['exhaust'] },
};

function roomServedByRole(label: SpaceLabel, wet: boolean): boolean {
  const { increments } = resolveRoomTypeRule(label.room_type ?? '').rule;
  return wet ? increments.NumberOfWetRooms === 1 : increments.NumberOfHabitableRooms === 1;
}

/**
 * Where a run ends in a room: the label's vertex centroid, or, for a concave room whose centroid
 * falls outside it, the first fan triangle's centroid that lands inside.
 */
function pointInsideRoom(ring: PlanPoint[]): PlanPoint | null {
  const candidates = [polygonCentroid2d(ring)];
  for (let i = 1; i + 1 < ring.length; i += 1) candidates.push(polygonCentroid2d([ring[0]!, ring[i]!, ring[i + 1]!]));
  const inside = candidates.find((p) => pointInPolygon(p, ring));
  return inside ? { x: roundToTwoDecimals(inside.x), y: roundToTwoDecimals(inside.y) } : null;
}

/** The orthogonal L (longer axis first) from `start` to `end` at height z, or one leg when on-axis. */
function orthogonalRun(start: Point3, end: PlanPoint, z: number): Point3[] {
  const elbow = planOrthogonalElbow(start, end, 0, false);
  return [start, ...(elbow ? [{ ...elbow, z }] : []), { ...end, z }];
}

function projectOntoSegment(p: PlanPoint, a: PlanPoint, b: PlanPoint): PlanPoint {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
  return { x: roundToTwoDecimals(a.x + t * vx), y: roundToTwoDecimals(a.y + t * vy) };
}

/**
 * Auto-duct plan for one ventilation unit: one radial run per wet room (extract) and, for MVHR,
 * per habitable room (supply), from the unit point to a point inside the room's space label, plus
 * a run to the nearest free external host and an intake or exhaust terminal on it. Each segment is
 * its own duct draft; consecutive segments share exact endpoints so each run is one connected
 * component touching the unit.
 *
 * A room on another storey is reached by an L at the unit's height, then a riser at the room point
 * to that storey's draw height. The riser sits at the room end, not the unit, because every run
 * must leave the unit point itself: the bundle overlap exemption and the cross-role endpoint check
 * both key on the unit point, so a shared riser top would be flagged.
 *
 * Rooms already reached by a duct of that role, and terminal roles that already have a terminal or
 * duct, are skipped, so re-running only fills gaps. Output order is stable (rooms by id).
 */
export function planAutoDucts(
  unit: MechanicalVentilation,
  elements: Element[],
  spaceLabels: readonly SpaceLabel[],
  floors: Floor[],
): ElementDraft[] {
  const roles = AUTO_DUCT_ROLES[unit.vent_type];
  const unitPoint = getFirstPoint3(unit);
  const unitStorey = getElementCanvasFloorZValue(unit, floors);
  const unitFloorId = floors.find((floor) => floor.zIndex === unitStorey)?.id;
  if (!roles || !unitPoint || unitStorey === undefined || !unitFloorId) return [];

  const unitDucts = elements.filter(
    (el): el is MechanicalVentilationDuctwork =>
      el.type === 'MechanicalVentilationDuctwork' && !el.isPlaceholder && el.parent_element?.trim() === unit.name,
  );
  const drafts: ElementDraft[] = [];
  const addRun = (role: MvhrDuctRole, points: Point3[], floorIds: string[]) => {
    for (let i = 0; i + 1 < points.length; i += 1) {
      const [a, b] = [points[i]!, points[i + 1]!];
      const length = roundToTwoDecimals(distance3d(a, b));
      if (length === 0) continue;
      drafts.push({
        name: '',
        type: 'MechanicalVentilationDuctwork',
        duct_type: role,
        parent_element: unit.name,
        floorId: floorIds[i],
        coordinates: [a, b],
        length,
        isPlaceholder: false,
      });
    }
  };

  const effectiveFloors = withEffectiveStoreyHeights(floors, elements);
  const labels = [...spaceLabels].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const { role, wet } of roles.rooms) {
    for (const label of labels) {
      if (!roomServedByRole(label, wet)) continue;
      const ring = (label.coordinates ?? []).map((p) => ({ x: p.x, y: p.y }));
      if (ring.length < 3) continue;
      const served = unitDucts.some((duct) =>
        duct.duct_type === role &&
        getElementCanvasFloorZValue(duct, floors) === label.storey &&
        (ductEndpoints(duct) ?? []).some((end) => pointInPolygon(end, ring)));
      if (served) continue;
      const target = pointInsideRoom(ring);
      const roomFloorId = floors.find((floor) => floor.zIndex === label.storey)?.id;
      if (!target || !roomFloorId) continue;
      const run = orthogonalRun(unitPoint, target, unitPoint.z);
      const floorIds = run.slice(1).map(() => unitFloorId);
      if (label.storey !== unitStorey) {
        run.push({ ...target, z: calculateDerivedBaseHeight(label.storey, effectiveFloors) });
        floorIds.push(roomFloorId);
      }
      addRun(role, run, floorIds);
    }
  }

  const unitTerminals = elements.filter(
    (el): el is MechanicalVentilationTerminal =>
      el.type === 'MechanicalVentilationTerminal' && !el.isPlaceholder && el.parent_element?.trim() === unit.name,
  );
  const takenHosts = new Set(unitTerminals.map((terminal) => terminal.host_element));
  const hosts = elements
    .filter((el) =>
      !el.isPlaceholder && isMvhrTerminalHost(el) && el.coordinates?.length >= 2 &&
      getElementCanvasFloorZValue(el, floors) === unitStorey)
    .map((host) => ({ host, point: projectOntoSegment(unitPoint, host.coordinates[0]!, host.coordinates[1]!) }))
    .map((entry) => ({ ...entry, distance: Math.hypot(entry.point.x - unitPoint.x, entry.point.y - unitPoint.y) }))
    .sort((a, b) => a.distance - b.distance || (a.host.name < b.host.name ? -1 : a.host.name > b.host.name ? 1 : 0));
  for (const role of roles.terminals) {
    const done =
      unitTerminals.some((terminal) => terminal.terminal_type === role) ||
      unitDucts.some((duct) => duct.duct_type === role);
    const nearest = done ? undefined : hosts.find((entry) => !takenHosts.has(entry.host.name));
    if (!nearest) continue;
    takenHosts.add(nearest.host.name);
    const run = orthogonalRun(unitPoint, nearest.point, unitPoint.z);
    addRun(role, run, run.slice(1).map(() => unitFloorId));
    drafts.push({
      name: '',
      type: 'MechanicalVentilationTerminal',
      terminal_type: role,
      parent_element: unit.name,
      host_element: nearest.host.name,
      floorId: nearest.host.floorId ?? unitFloorId,
      coordinates: [run[run.length - 1]!],
      isPlaceholder: false,
    });
  }
  return drafts;
}
