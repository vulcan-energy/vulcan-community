// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import { elevationAtSlopedVertexM } from '../geometry3dSloped';
import {
  orientation360SlopedFromFirstEdge,
  segmentTangentAndOpeningOutwardModelXY,
} from '../openingSegmentOutward';
import {
  downslopeUnitModelXY,
  findLowVertexIndex,
  isOrientationPitchAxis,
  slopedPolygonPlaneBasis,
} from '../slopePitchAxis';

const orientationElement = (overrides: Partial<Element> = {}): Element => ({
  id: 'roof',
  name: 'Roof',
  type: 'BuildingElementOpaque',
  parent_element: null,
  coordinates: [
    { x: 0, y: 2, z: 0 },
    { x: 4, y: 2, z: 0 },
    { x: 2, y: 0, z: 0 },
  ],
  pitch: 45,
  orientation360: 180,
  extra_json: { _slope_pitch_axis: 'orientation' },
  ...overrides,
} as Element);

describe('slope pitch axis', () => {
  it('round-trips first-edge orientation to the same downslope direction (chirality pin)', () => {
    const ax = 1;
    const ay = -2;
    const bx = 4;
    const by = 2;
    const offset = 23;
    const bearing = orientation360SlopedFromFirstEdge(ax, ay, bx, by, offset);

    expect(bearing).not.toBeNull();
    const downslope = downslopeUnitModelXY(bearing!, offset);
    const { openingOutward } = segmentTangentAndOpeningOutwardModelXY(ax, ay, bx, by);
    expect(downslope[0]).toBeCloseTo(openingOutward[0], 12);
    expect(downslope[1]).toBeCloseTo(openingOutward[1], 12);
  });

  it('uses the apex-down low vertex as the hinge and lifts the other vertices from it', () => {
    const points: Array<[number, number]> = [[0, 2], [4, 2], [2, 0]];
    const downslope = downslopeUnitModelXY(180, 0);
    expect(findLowVertexIndex(points, downslope)).toBe(2);

    const basis = slopedPolygonPlaneBasis(points, 'orientation', 180, 0);
    expect(basis).toEqual({ anchorXY: [2, 0], upslope2D: [0, 1] });
    expect(elevationAtSlopedVertexM(points[2]!, basis!.anchorXY, basis!.upslope2D, 3, 45)).toBe(3);
    expect(elevationAtSlopedVertexM(points[0]!, basis!.anchorXY, basis!.upslope2D, 3, 45)).toBeCloseTo(5, 12);
    expect(elevationAtSlopedVertexM(points[1]!, basis!.anchorXY, basis!.upslope2D, 3, 45)).toBeCloseTo(5, 12);
  });

  it('degenerates exactly to the bottom-edge basis when the authored low contour is the first edge', () => {
    const points: Array<[number, number]> = [[0, 0], [4, 0], [4, 2], [0, 2]];
    expect(slopedPolygonPlaneBasis(points, 'orientation', 180, 0)).toEqual(
      slopedPolygonPlaneBasis(points, 'bottom-edge', 0, 0),
    );
  });

  it('resolves low-contour ties to the lowest vertex index', () => {
    const points: Array<[number, number]> = [[0, 0], [4, 0], [4, 2], [0, 2]];
    expect(findLowVertexIndex(points, [0, -1])).toBe(0);
    expect(findLowVertexIndex([[0, 0], [1, -0.0000005], [2, 1]], [0, -1])).toBe(0);
    expect(findLowVertexIndex([[0, 0], [1, 0.0000005], [2, 0.0000012]], [0, 1])).toBe(1);
  });

  it('applies a non-zero global orientation offset to the model-space direction', () => {
    expect(downslopeUnitModelXY(60, 30)[0]).toBeCloseTo(1, 12);
    expect(downslopeUnitModelXY(60, 30)[1]).toBe(0);
  });

  it('recognises only opted-in opaque or transparent sloped polygons', () => {
    expect(isOrientationPitchAxis(orientationElement())).toBe(true);
    expect(isOrientationPitchAxis(orientationElement({ extra_json: { _slope_pitch_axis: 'other' } }))).toBe(false);
    expect(isOrientationPitchAxis(orientationElement({ pitch: 0 }))).toBe(false);
    expect(isOrientationPitchAxis(orientationElement({ type: 'OnSiteGeneration' } as Partial<Element>))).toBe(false);
  });
});
