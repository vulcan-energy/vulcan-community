// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, MechanicalVentilationDuctwork, MechanicalVentilationTerminal } from '../geometry/types';
import { normalizeOrientation360Deg, roundToTwoDecimals } from '../geometry/constants';
import { orientation360FromSegmentOutwardModelXY } from './openingSegmentOutward';

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

export const MVHR_DUCT_TOPOLOGY_TOLERANCE_M = 0.35;

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

export function point3dEquals(a: Point3, b: Point3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
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
  tolerance = MVHR_DUCT_TOPOLOGY_TOLERANCE_M,
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
        distance3d(a[0], b[0]) <= tolerance ||
        distance3d(a[0], b[1]) <= tolerance ||
        distance3d(a[1], b[0]) <= tolerance ||
        distance3d(a[1], b[1]) <= tolerance
      ) {
        union(i, j);
      }
    }
  }
  return { endpoints, roots: endpoints.map((_, index) => find(index)) };
}

export function countDuctEndpointComponents(
  ducts: ReadonlyArray<Pick<MechanicalVentilationDuctwork, 'coordinates'>>,
  tolerance = MVHR_DUCT_TOPOLOGY_TOLERANCE_M,
): number {
  const components = buildDuctEndpointComponents(ducts, tolerance);
  return new Set(components.roots).size;
}

export function allDuctEndpointComponentsConnectToPoint(
  ducts: ReadonlyArray<Pick<MechanicalVentilationDuctwork, 'coordinates'>>,
  point: Point3,
  tolerance = MVHR_DUCT_TOPOLOGY_TOLERANCE_M,
): boolean {
  const components = buildDuctEndpointComponents(ducts, tolerance);
  if (components.endpoints.length === 0) return false;
  const roots = new Set(components.roots);
  const connectedRoots = new Set<number>();
  components.endpoints.forEach((endpoints, index) => {
    if (distance3d(endpoints[0], point) <= tolerance || distance3d(endpoints[1], point) <= tolerance) {
      connectedRoots.add(components.roots[index]!);
    }
  });
  return [...roots].every((root) => connectedRoots.has(root));
}

export type MvhrCrossRoleEndpointOverlap = {
  roles: [MvhrDuctRole, MvhrDuctRole];
  ductNames: [string | undefined, string | undefined];
  point: Point3;
};

export function findExactCrossRoleDuctEndpointOverlap(
  ducts: ReadonlyArray<Pick<MechanicalVentilationDuctwork, 'coordinates' | 'duct_type' | 'name'>>,
  ignoredPoint?: Point3,
  ignoredTolerance = MVHR_DUCT_TOPOLOGY_TOLERANCE_M,
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
          if (!point3dEquals(pointA, pointB)) continue;
          if (ignoredPoint && distance3d(pointA, ignoredPoint) <= ignoredTolerance) continue;
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
  tolerance = MVHR_DUCT_TOPOLOGY_TOLERANCE_M,
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
