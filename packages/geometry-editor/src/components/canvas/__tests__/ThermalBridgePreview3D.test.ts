// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { AutoThermalBridgeCandidate } from '../../../geometry/thermalBridge/autoThermalBridgeCandidates';
import {
  isThermalBridgePreviewClick,
  incidentThermalBridgePreviewSurfaces,
  thermalBridgePreviewCandidateIdsAtHit,
  thermalBridgePreviewWorldPoints,
  offsetThermalBridgePreviewWorldPoints,
  type ThermalBridgePreviewIntersection,
} from '../thermalBridgePreview3dGeometry';
import {
  thermalBridgeCandidatesForRender,
  thermalBridgeIssuesForRender,
} from '../thermalBridgePreviewRenderRows';

function hit(distance: number, userData: ThermalBridgePreviewIntersection['object']['userData']): ThermalBridgePreviewIntersection {
  return { distance, object: { userData } };
}

describe('ThermalBridgePreview3D helpers', () => {
  it('maps plan coordinates to Three.js XZ and keeps physical z as height', () => {
    expect(thermalBridgePreviewWorldPoints([
      { x: 2, y: 3, z: 4 },
      { x: -1, y: 5, z: 7 },
    ])).toEqual([
      [2, 4, -3],
      [-1, 7, -5],
    ]);
  });

  it('groups candidate lines hit by the same ray up to the nearest opaque fabric', () => {
    const intersections = [
      hit(2, { thermalBridgePreviewCandidateId: 'candidate-a' }),
      hit(2.25, { thermalBridgePreviewCandidateId: 'candidate-b' }),
      hit(2.5, { thermalBridgePreviewCandidateId: 'candidate-a' }),
      hit(3, { thermalBridgePreviewOccludes: true }),
      hit(3.5, { thermalBridgePreviewCandidateId: 'candidate-c' }),
    ];

    expect(thermalBridgePreviewCandidateIdsAtHit(intersections, 'candidate-a')).toEqual([
      'candidate-a',
      'candidate-b',
    ]);
  });

  it('does not activate or hover candidates behind the nearest opaque fabric', () => {
    const intersections = [
      hit(2, { thermalBridgePreviewCandidateId: 'candidate-front' }),
      hit(2.5, { thermalBridgePreviewOccludes: true }),
      hit(3, { thermalBridgePreviewCandidateId: 'candidate-behind' }),
    ];

    expect(thermalBridgePreviewCandidateIdsAtHit(intersections, 'candidate-behind')).toEqual([]);
    expect(thermalBridgePreviewCandidateIdsAtHit(intersections)).toEqual(['candidate-front']);
  });

  it('offsets only the displayed line toward the camera by the host surface depth', () => {
    const original = [[0, 1, 0], [2, 1, 0]] as const;
    const wallFace = { point: [0, 1, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], thicknessM: 0.05 };
    const offset = offsetThermalBridgePreviewWorldPoints(original, { x: 1, y: 100, z: 0.01 }, wallFace);
    expect(offset[0]![2]).toBeCloseTo(0.03);
    expect(offset[1]![2]).toBeCloseTo(0.03);
    expect(offset[0]![1]).toBe(1);
    expect(offset[1]![1]).toBe(1);
    expect(original).toEqual([[0, 1, 0], [2, 1, 0]]);
    expect(offsetThermalBridgePreviewWorldPoints([[0, 1, 0]], { x: 1, y: 100, z: 0.01 }, wallFace)[0]![2])
      .toBeCloseTo(0.03);
  });

  it('selects the incident host face and retains both faces for a true corner line', () => {
    const faceA = { hostElementId: 'wall-a', point: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], thicknessM: 0.1 };
    const unrelatedFace = { hostElementId: 'wall-a', point: [0, 0, 0] as [number, number, number], normal: [1, 0, 0] as [number, number, number], thicknessM: 0.1 };
    const lineOnA = [[1, 0, 0], [2, 0, 0]] as [number, number, number][];
    expect(incidentThermalBridgePreviewSurfaces(lineOnA, [faceA, unrelatedFace])).toEqual([faceA]);

    const coplanarFaceCopy = { ...faceA, point: [8, 0, 0] as [number, number, number] };
    expect(incidentThermalBridgePreviewSurfaces(lineOnA, [faceA, coplanarFaceCopy])).toEqual([faceA]);

    const cornerLine = [[0, 0, 0], [0, 1, 0]] as [number, number, number][];
    expect(incidentThermalBridgePreviewSurfaces(cornerLine, [faceA, unrelatedFace])).toEqual([faceA, unrelatedFace]);
  });

  it('accepts a stationary click and rejects orbit-drag movement', () => {
    expect(isThermalBridgePreviewClick(0)).toBe(true);
    expect(isThermalBridgePreviewClick(5)).toBe(true);
    expect(isThermalBridgePreviewClick(6)).toBe(false);
    expect(isThermalBridgePreviewClick(Number.NaN)).toBe(false);
  });
});

describe('pinned preview rendering', () => {
  it('keeps only chooser rows after A release and permits all rows while A remains held', () => {
    const row = (proposalId: string): AutoThermalBridgeCandidate => ({
      proposalId, openingId: `opening-${proposalId}`, openingName: proposalId, zoneId: 'zone',
      edgeRole: 'lintel', junctionCode: 'E1', junctionOptions: ['E1'], suggestedLengthM: 1,
      linearThermalTransmittance: 0.1, reason: 'test', status: 'new',
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    } as AutoThermalBridgeCandidate);
    const candidates = [row('kept'), row('hidden')];
    const menuState = { pinned: true, held: false, menu: { ids: ['kept'] } };
    expect(thermalBridgeCandidatesForRender(candidates, menuState).map((candidate) => candidate.proposalId)).toEqual(['kept']);
    expect(thermalBridgeCandidatesForRender(candidates, { ...menuState, held: true })).toBe(candidates);
  });

  it('also filters issue markers if a pinned chooser represents issue rows', () => {
    const issues = [{ tb: { id: 'keep' } }, { tb: { id: 'hide' } }] as never[];
    expect(thermalBridgeIssuesForRender(issues, { pinned: true, held: false, menu: { ids: ['issue:keep'] } }))
      .toEqual([issues[0]]);
  });
});
