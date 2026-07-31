// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import {
  buildPvPanelRectangleCoords,
  rebuildPvRectangleFromBottomEdgeDimensions,
  derivePvDimensionsFromCoords,
  getPvFootprintDimensionsFromPreset,
  readPvFootprintFlags,
  rebuildPvRectangleFromBottomEdge,
} from '../pvPanelFootprint';

describe('pvPanelFootprint', () => {
  it('getPvFootprintDimensionsFromPreset uses max/min of width and height', () => {
    expect(getPvFootprintDimensionsFromPreset({ width: 2, height: 1 })).toEqual({
      longM: 2,
      shortM: 1,
    });
    expect(getPvFootprintDimensionsFromPreset({ width: 1, height: 3 })).toEqual({
      longM: 3,
      shortM: 1,
    });
  });

  it('readPvFootprintFlags defaults', () => {
    expect(readPvFootprintFlags(undefined)).toEqual({
      flipUpslope: false,
      bottomIsLong: true,
    });
    expect(readPvFootprintFlags({ _pv_footprint_flip: true, _pv_bottom_is_long: false })).toEqual({
      flipUpslope: true,
      bottomIsLong: false,
    });
  });

  it('buildPvPanelRectangleCoords: axis-aligned bottom along +x, upslope +y', () => {
    const q = buildPvPanelRectangleCoords({
      A: { x: 0, y: 0 },
      B_dir: { x: 10, y: 0 },
      z: 0,
      longM: 2,
      shortM: 1,
      flipUpslope: false,
      bottomIsLong: true,
    });
    expect(q).toHaveLength(4);
    expect(q[0]).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(q[1]).toMatchObject({ x: 2, y: 0, z: 0 });
    expect(q[2]).toMatchObject({ x: 2, y: 1, z: 0 });
    expect(q[3]).toMatchObject({ x: 0, y: 1, z: 0 });
  });

  it('buildPvPanelRectangleCoords projects actual upslope dimension by pitch', () => {
    const q = buildPvPanelRectangleCoords({
      A: { x: 0, y: 0 },
      B_dir: { x: 10, y: 0 },
      z: 0,
      longM: 2,
      shortM: 2,
      flipUpslope: false,
      bottomIsLong: true,
      pitchDegrees: 60,
    });

    expect(q[1]).toMatchObject({ x: 2, y: 0, z: 0 });
    expect(q[2]).toMatchObject({ x: 2, y: 1, z: 0 });
    expect(q[3]).toMatchObject({ x: 0, y: 1, z: 0 });
  });

  it('derivePvDimensionsFromCoords returns first-edge width and pitch-corrected upslope height', () => {
    const derived = derivePvDimensionsFromCoords(
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 0, y: 1 },
      ],
      60,
    );

    expect(derived?.width).toBeCloseTo(2, 6);
    expect(derived?.height).toBeCloseTo(2, 6);
  });

  it('derivePvDimensionsFromCoords uses the first edge rather than the axis-aligned bbox', () => {
    const derived = derivePvDimensionsFromCoords(
      [
        { x: 0, y: 0 },
        { x: 2, y: 2 },
        { x: 1, y: 3 },
        { x: -1, y: 1 },
      ],
      0,
    );

    expect(derived?.width).toBeCloseTo(Math.sqrt(8), 6);
    expect(derived?.height).toBeCloseTo(Math.SQRT2, 6);
  });

  it('rebuildPvRectangleFromBottomEdge matches build with long bottom', () => {
    const a = rebuildPvRectangleFromBottomEdge(
      { x: 1, y: 2, z: 3 },
      { x: 5, y: 2, z: 3 },
      2,
      1,
      false,
      true
    );
    const b = buildPvPanelRectangleCoords({
      A: { x: 1, y: 2 },
      B_dir: { x: 5, y: 2 },
      z: 3,
      longM: 2,
      shortM: 1,
      flipUpslope: false,
      bottomIsLong: true,
    });
    expect(a).toEqual(b);
  });

  it('rebuildPvRectangleFromBottomEdgeDimensions treats width as low edge and height as upslope', () => {
    const q = rebuildPvRectangleFromBottomEdgeDimensions(
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      5,
      2,
      false,
      60,
    );

    expect(q).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
      { x: 5, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ]);
  });
});
