// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Preview proposals for **roof window / rooflight** linear TBs (SAP R1 head, R2 sill, R3 jambs, optional R11 kerb in plan).
 *
 * **Selection** — Transparent roof openings must have a finite `pitch` other than 90° (vertical façade
 * windows stay on the E-series pass). Current rooflights are expected to be sloped/flat polygons hosted
 * by a roof; the legacy 2-point line form is still accepted for older CSVs.
 * Unset `pitch` is treated as a vertical wall opening, not a roof window.
 *
 * **Geometry** — Same rectangular approximation as façade openings: head/sill run along the segment in
 * plan at `zSill` and `zSill + height`; jambs are vertical at the two segment endpoints. Skewed real
 * geometry should be corrected in the canvas rather than inferred here.
 *
 * **No E5/E6** — Wall–floor substitutions under openings are not applied to roof windows.
 */

import { roundToTwoDecimals } from '../constants';
import type { BuildingElementOpaque, BuildingElementTransparent, Element } from '../types';
import type { Floor } from '../../geometry/types';
import { roofTopElevationAtPlanM } from '../../lib/roofTopElevationAtPlanM';
import { isOrientationPitchAxis } from '../../lib/slopePitchAxis';
import { isRoofLikeOpaqueElement } from '../../lib/roofElement';
import { withEffectiveStoreyHeights } from '../../lib/zoneDerivation';
import {
  jambReason,
  openingSillElevationMForFacadeTb,
  psiTable37ForCode,
  type FacadeOpeningTbProposal,
} from './proposeFacadeOpenings';

function dist2XY(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dist3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function isFinitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * True for 2-point transparent openings with explicit non-vertical pitch (sloped or flat roof window).
 * Complement of {@link isWallFacadeOpening} for qualifying geometry: wall openings use unset or 90° pitch.
 */
export function isRoofWindowOpening(el: BuildingElementTransparent): boolean {
  if (el.isPlaceholder) return false;
  const coords = el.coordinates;
  if (!coords || (coords.length !== 2 && coords.length < 4)) return false;

  const pitch = el.pitch;
  if (typeof pitch !== 'number' || !Number.isFinite(pitch) || pitch === 90) {
    return false;
  }

  if (coords.length === 2) {
    const w = isFinitePositive(el.width) ? el.width : dist2XY(coords[0], coords[1]);
    const h = isFinitePositive(el.height) ? el.height : 0;
    if (w <= 0 || h <= 0) return false;
  } else if (!isFinitePositive(el.area) && (!isFinitePositive(el.width) || !isFinitePositive(el.height))) {
    return false;
  }

  return true;
}

function findRoofHost(t: BuildingElementTransparent, elements: Element[]): BuildingElementOpaque | null {
  const parentName = t.parent_element?.trim();
  if (!parentName) return null;
  const parent = elements.find((el) => el.name === parentName);
  if (!parent || parent.type !== 'BuildingElementOpaque') return null;
  if (!Array.isArray(parent.coordinates) || parent.coordinates.length < 3) return null;
  if (!isRoofLikeOpaqueElement(parent)) return null;
  return parent as BuildingElementOpaque;
}

function roofOpeningVertex(
  t: BuildingElementTransparent,
  host: BuildingElementOpaque | null,
  point: { x: number; y: number; z: number },
  floors: Floor[] | undefined,
): { x: number; y: number; z: number } {
  const source = host ?? (t as unknown as BuildingElementOpaque);
  const zOnRoof = roofTopElevationAtPlanM(source, point.x, point.y, floors);
  if (typeof zOnRoof === 'number' && Number.isFinite(zOnRoof)) {
    return { x: point.x, y: point.y, z: zOnRoof };
  }
  if (typeof t.base_height === 'number' && Number.isFinite(t.base_height)) {
    return { x: point.x, y: point.y, z: t.base_height };
  }
  return point;
}

function polygonRoofOpeningProposals(
  t: BuildingElementTransparent,
  elements: Element[],
  floors: Floor[] | undefined,
): FacadeOpeningTbProposal[] {
  const coords = t.coordinates;
  if (!coords || coords.length < 4) return [];
  const host = findRoofHost(t, elements);
  const p0 = roofOpeningVertex(t, host, coords[0], floors);
  const p1 = roofOpeningVertex(t, host, coords[1], floors);
  const p2 = roofOpeningVertex(t, host, coords[2], floors);
  const p3 = roofOpeningVertex(t, host, coords[3], floors);
  const roles = [
    {
      role: 'roof_window_head' as const,
      coords: [p2, p3] as [typeof p2, typeof p3],
      length: dist3(p2, p3),
      junctionCode: 'R1',
      reason: `Roof window head (R1) along upper edge of "${t.name}"${host ? ` on "${host.name}"` : ''}`,
    },
    {
      role: 'roof_window_sill' as const,
      coords: [p0, p1] as [typeof p0, typeof p1],
      length: dist3(p0, p1),
      junctionCode: 'R2',
      reason: `Roof window sill (R2) along lower edge of "${t.name}"${host ? ` on "${host.name}"` : ''}`,
    },
    {
      role: 'rooflight_kerb' as const,
      coords: [p0, p1] as [typeof p0, typeof p1],
      length: dist3(p0, p1),
      junctionCode: 'R11',
      reason: `Kerb or upstand (R11) along lower edge of "${t.name}" — if your detail is a sill, use R2; else R11 for kerb/upstand per Table 3.7`,
    },
    {
      role: 'roof_window_jamb_first' as const,
      coords: [p1, p2] as [typeof p1, typeof p2],
      length: dist3(p1, p2),
      junctionCode: 'R3',
      reason: `Roof window jamb (R3) along first side edge of "${t.name}"`,
    },
    {
      role: 'roof_window_jamb_second' as const,
      coords: [p3, p0] as [typeof p3, typeof p0],
      length: dist3(p3, p0),
      junctionCode: 'R3',
      reason: `Roof window jamb (R3) along second side edge of "${t.name}"`,
    },
  ] as const;

  return roles.map((row) => ({
    proposalId: `${t.id}:${row.role}`,
    openingId: t.id,
    openingName: t.name,
    zoneId: t.zoneId,
    edgeRole: row.role,
    junctionCode: row.junctionCode,
    suggestedLengthM: roundToTwoDecimals(row.length),
    linearThermalTransmittance: psiTable37ForCode(row.junctionCode),
    reason: row.reason,
    coordinates: row.coords,
  }));
}

/** Up to four linear TB proposals (R1, R2, two R3) per qualifying roof window / rooflight. */
export function proposeRoofOpeningThermalBridges(
  elements: Element[],
  floors?: Floor[],
): FacadeOpeningTbProposal[] {
  floors = withEffectiveStoreyHeights(floors, elements);
  const out: FacadeOpeningTbProposal[] = [];

  for (const el of elements) {
    if (el.type !== 'BuildingElementTransparent') continue;
    const t = el as BuildingElementTransparent;
    if (!isRoofWindowOpening(t)) continue;
    // T1 safe guard: an Orientation-axis plane hinges on the authored fall line, and
    // roofTopElevationAtPlanM has no offset here, so jamb lengths would silently
    // flatten to plan lengths. Skip; the opening surfaces as unproposed until T2.
    const orientationHost = findRoofHost(t, elements);
    if (isOrientationPitchAxis(t) || (orientationHost && isOrientationPitchAxis(orientationHost))) continue;
    if (t.coordinates.length >= 4) {
      out.push(...polygonRoofOpeningProposals(t, elements, floors));
      continue;
    }

    const coords = t.coordinates;
    const p0 = coords[0];
    const p1 = coords[1];
    const { zBottomM, zCoord0: z0, zCoord1: z1, usedBaseHeight } = openingSillElevationMForFacadeTb(t);

    const zSill = zBottomM;
    const geomWidthM = roundToTwoDecimals(dist2XY(p0, p1));
    const width = typeof t.width === 'number' && t.width > 0 ? t.width : geomWidthM;
    const height = typeof t.height === 'number' && t.height > 0 ? t.height : 0;
    const zTop = zSill + height;

    const sillA = { x: p0.x, y: p0.y, z: zSill };
    const sillB = { x: p1.x, y: p1.y, z: zSill };
    const headA = { x: p0.x, y: p0.y, z: zTop };
    const headB = { x: p1.x, y: p1.y, z: zTop };
    const horizontalLengthM = geomWidthM > 0 ? geomWidthM : width;

    const roles = [
      {
        role: 'roof_window_head' as const,
        coords: [headA, headB] as [typeof headA, typeof headB],
        length: horizontalLengthM,
        reason: `Roof window head (R1) along top of "${t.name}" (segment length in plan)`,
      },
      {
        role: 'roof_window_sill' as const,
        coords: [sillA, sillB] as [typeof sillA, typeof sillB],
        length: horizontalLengthM,
        reason: `Roof window sill (R2) along bottom of "${t.name}"`,
      },
      {
        role: 'rooflight_kerb' as const,
        coords: [sillA, sillB] as [typeof sillA, typeof sillB],
        length: horizontalLengthM,
        reason: `Kerb or upstand (R11) in plan at bottom of "${t.name}" — if your detail is a sill, use R2; else R11 for kerb/upstand per Table 3.7`,
      },
      {
        role: 'roof_window_jamb_first' as const,
        coords: [sillA, headA] as [typeof sillA, typeof headA],
        length: height,
        reason: jambReason(t.name, 'first', usedBaseHeight, z0, z1).replace(/^Jamb/, 'Roof window jamb (R3)'),
      },
      {
        role: 'roof_window_jamb_second' as const,
        coords: [sillB, headB] as [typeof sillB, typeof headB],
        length: height,
        reason: jambReason(t.name, 'second', usedBaseHeight, z0, z1).replace(/^Jamb/, 'Roof window jamb (R3)'),
      },
    ] as const;

    for (const row of roles) {
      const junctionCode =
        row.role === 'roof_window_head'
          ? 'R1'
          : row.role === 'roof_window_sill' || row.role === 'rooflight_kerb'
            ? row.role === 'rooflight_kerb'
              ? 'R11'
              : 'R2'
            : 'R3';
      out.push({
        proposalId: `${t.id}:${row.role}`,
        openingId: t.id,
        openingName: t.name,
        zoneId: t.zoneId,
        edgeRole: row.role,
        junctionCode,
        suggestedLengthM: roundToTwoDecimals(row.length),
        linearThermalTransmittance: psiTable37ForCode(junctionCode),
        reason: row.reason,
        coordinates: row.coords,
      });
    }
  }

  return out;
}
