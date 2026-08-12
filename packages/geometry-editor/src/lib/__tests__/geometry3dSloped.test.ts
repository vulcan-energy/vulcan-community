// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import { buildGeometry3DPrimitives } from '../geometry3dMapper';
import { computeSlopedPolygonInwardNormal2D, elevationAtSlopedVertexM } from '../geometry3dSloped';
import { slopedPolygonPlaneBasis } from '../slopePitchAxis';

describe('computeSlopedPolygonInwardNormal2D', () => {
  it('points upslope into the interior for a rectangle whose first edge is the bottom', () => {
    const pts: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 2],
      [0, 2],
    ];
    const n = computeSlopedPolygonInwardNormal2D(pts);
    expect(n).not.toBeNull();
    expect(n![0]).toBeCloseTo(0, 5);
    expect(n![1]).toBeCloseTo(1, 5);
  });
});

describe('elevationAtSlopedVertexM', () => {
  it('is flat on the eaves line and rises with perpendicular run', () => {
    const eaves: [number, number] = [0, 0];
    const inward: [number, number] = [0, 1];
    const h0 = elevationAtSlopedVertexM([0, 0], eaves, inward, 2.4, 45);
    const h1 = elevationAtSlopedVertexM([0, 1], eaves, inward, 2.4, 45);
    expect(h0).toBe(2.4);
    expect(h1).toBeCloseTo(2.4 + Math.tan(Math.PI / 4), 5);
  });
});

describe('bottom-edge pitch-axis zero drift', () => {
  it('preserves the existing anchor, normal, and vertex elevations exactly', () => {
    const points: Array<[number, number]> = [[1, 2], [5, 2], [4, 5], [0, 4]];
    const existingNormal = computeSlopedPolygonInwardNormal2D(points)!;
    const basis = slopedPolygonPlaneBasis(points, 'bottom-edge', 271, 37);

    expect(basis).toEqual({ anchorXY: points[0], upslope2D: existingNormal });
    expect(points.map((point) => elevationAtSlopedVertexM(
      point,
      basis!.anchorXY,
      basis!.upslope2D,
      2.4,
      35,
    ))).toEqual(points.map((point) => elevationAtSlopedVertexM(
      point,
      points[0]!,
      existingNormal,
      2.4,
      35,
    )));
  });

  it('maps the existing bottom-edge primitive with the same basis and elevations', () => {
    const points: Array<[number, number]> = [[1, 2], [5, 2], [4, 5], [0, 4]];
    const element = {
      id: 'bottom-roof',
      name: 'Bottom roof',
      type: 'BuildingElementOpaque',
      parent_element: null,
      coordinates: points.map(([x, y]) => ({ x, y, z: 0 })),
      pitch: 35,
      orientation360: 271,
      base_height: 2.4,
      width: 4,
      height: 3,
      area: 12,
    } as Element;
    const [primitive] = buildGeometry3DPrimitives({
      elementsById: { [element.id]: element },
      elementIds: [element.id],
      floors: [],
      globalOrientationOffset: 37,
    });
    expect(primitive?.kind).toBe('polygon-sloped');
    if (!primitive || primitive.kind !== 'polygon-sloped') return;

    const existingNormal = computeSlopedPolygonInwardNormal2D(points)!;
    expect(primitive.hingeAnchorXY).toEqual(points[0]);
    expect(primitive.inwardNormal2D).toEqual(existingNormal);
    expect(points.map((point) => elevationAtSlopedVertexM(
      point,
      primitive.hingeAnchorXY,
      primitive.inwardNormal2D,
      primitive.baseElevationM,
      primitive.pitchDeg,
    ))).toEqual(points.map((point) => elevationAtSlopedVertexM(
      point,
      points[0]!,
      existingNormal,
      2.4,
      35,
    )));
  });
});
