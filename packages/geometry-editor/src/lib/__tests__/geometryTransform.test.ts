// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  modelToCanvas2D,
  canvasToModel2D,
  modelXYToThreeXZ,
  modelXYToExtrudeShapeXY,
  threeXZToModelXY,
  modelSegmentToThreeYaw,
  PIXELS_PER_METER,
} from '../geometryTransform';

describe('geometryTransform', () => {
  it('round-trips model <-> canvas coordinates', () => {
    const transform = {
      scale: 1.25,
      panOffset: { x: 120, y: -80 },
      canvasCenter: { x: 640, y: 360 },
    };
    const model = { x: -5.363, y: -0.576 };

    const canvas = modelToCanvas2D(model, transform);
    const back = canvasToModel2D(canvas, transform);

    expect(back.x).toBeCloseTo(model.x, 10);
    expect(back.y).toBeCloseTo(model.y, 10);
  });

  it('maps north upward on the 2D canvas', () => {
    const transform = {
      scale: 1,
      panOffset: { x: 0, y: 0 },
      canvasCenter: { x: 0, y: 0 },
    };

    const south = modelToCanvas2D({ x: 0, y: -1 }, transform);
    const north = modelToCanvas2D({ x: 0, y: 1 }, transform);

    expect(north.y).toBeLessThan(south.y);
  });

  it('round-trips model <-> three ground coordinates', () => {
    const modelPoint: [number, number] = [-1.595, 3.519];
    const threePoint = modelXYToThreeXZ(modelPoint);
    const back = threeXZToModelXY(threePoint);

    expect(back[0]).toBeCloseTo(modelPoint[0], 10);
    expect(back[1]).toBeCloseTo(modelPoint[1], 10);
  });

  it('computes Three.js Ry yaw from model deltas (matches atan2(dy,dx), not atan2 after Z mirror)', () => {
    // Along +X in model → no rotation so wall length stays on world +X.
    expect(modelSegmentToThreeYaw([0, 0], [5, 0])).toBeCloseTo(0, 10);

    // Along +Y in model → wall runs on world -Z after mirror.
    expect(modelSegmentToThreeYaw([0, 0], [0, 4])).toBeCloseTo(Math.PI / 2, 10);

    const start: [number, number] = [-1.595, 3.519];
    const end: [number, number] = [3.797, -1.386];
    const yaw = modelSegmentToThreeYaw(start, end);
    const expected = Math.atan2(end[1] - start[1], end[0] - start[0]);
    expect(yaw).toBeCloseTo(expected, 10);
    expect(Math.abs(yaw)).toBeGreaterThan(0.01);
  });

  it('keeps extrude shape-space mapping consistent with three world mapping', () => {
    const modelPoint: [number, number] = [2.25, 3.75];
    const [, shapeY] = modelXYToExtrudeShapeXY(modelPoint);
    const [, worldZ] = modelXYToThreeXZ(modelPoint);

    // For ExtrudeGeometry rotated by -PI/2 around X: worldZ = -shapeY.
    expect(worldZ).toBeCloseTo(-shapeY, 10);
  });

  it('keeps 2D canvas handedness aligned with the 3D ground plane', () => {
    const transform = {
      scale: 1,
      panOffset: { x: 0, y: 0 },
      canvasCenter: { x: 0, y: 0 },
    };
    const modelPoint = { x: 2.25, y: 3.75 };

    const canvasPoint = modelToCanvas2D(modelPoint, transform);
    const [threeX, threeZ] = modelXYToThreeXZ([modelPoint.x, modelPoint.y]);

    expect(canvasPoint.x).toBeCloseTo(threeX * PIXELS_PER_METER, 10);
    expect(canvasPoint.y).toBeCloseTo(threeZ * PIXELS_PER_METER, 10);
  });
});
