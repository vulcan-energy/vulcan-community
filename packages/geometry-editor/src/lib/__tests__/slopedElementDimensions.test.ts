// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  deriveSlopedElementDimensions,
  getPolygonScalarDimensionSemantics,
  getSlopedPolygonSurfaceArea,
  hasSelfIntersectingPolygonEdges,
  rebuildSlopedPolygonRectangleFromLowEdgeDimensions,
  slopedPolygonNeedsRectangleRebuild,
} from '../slopedElementDimensions';

describe('sloped element dimensions', () => {
  it('uses the first edge as width and derives equivalent sloped height from surface area', () => {
    const element = {
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 6, y: 0, z: 0 },
        { x: 6, y: 3, z: 0 },
        { x: 0, y: 3, z: 0 },
      ],
      pitch: 30,
    };

    expect(getSlopedPolygonSurfaceArea(element.coordinates, element)).toBe(20.78);
    expect(deriveSlopedElementDimensions(element)).toEqual({
      width: 6,
      height: 3.46,
      area: 20.78,
    });
  });

  it('keeps surface area consistent for non-rectangular sloped polygons (height stays true slope length, width becomes equivalent)', () => {
    const element = {
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 3, y: 2, z: 0 },
        { x: 0, y: 3, z: 0 },
      ],
      pitch: 45,
    };

    const derived = deriveSlopedElementDimensions(element);

    expect(derived).not.toBeNull();
    // Farthest vertex from the eaves edge is (0, 3): true up-slope length = 3 / cos(45deg).
    expect(derived?.height).toBeCloseTo(3 / Math.cos((45 * Math.PI) / 180), 2);
    expect(derived?.width).not.toBe(4); // no longer the low-edge length for a tapered shape
    expect(derived ? Math.abs(Number((derived.width * derived.height).toFixed(2)) - derived.area) : 0).toBeLessThanOrEqual(0.03);
  });

  it('does not derive dimensions when the low edge is degenerate', () => {
    expect(deriveSlopedElementDimensions({
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      pitch: 30,
    })).toBeNull();
  });

  it('identifies tapered sloped quadrilaterals as equivalent-height shapes', () => {
    const semantics = getPolygonScalarDimensionSemantics([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 3 },
      { x: -1, y: 3 },
    ]);

    expect(semantics).toMatchObject({
      lowEdgeWidth: 4,
      farEdgeWidth: 6,
      vertexCount: 4,
      usesEquivalentWidth: true,
    });
  });

  it('does not mark a true parallelogram as equivalent-height-only', () => {
    const semantics = getPolygonScalarDimensionSemantics([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 3 },
      { x: 1, y: 3 },
    ]);

    expect(semantics).toMatchObject({
      lowEdgeWidth: 4,
      farEdgeWidth: 4,
      vertexCount: 4,
      usesEquivalentWidth: false,
    });
  });

  it('identifies non-quadrilateral sloped polygons as equivalent-height shapes', () => {
    const semantics = getPolygonScalarDimensionSemantics([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 2 },
      { x: 2, y: 4 },
      { x: 0, y: 2 },
    ]);

    expect(semantics).toMatchObject({
      lowEdgeWidth: 4,
      vertexCount: 5,
      usesEquivalentWidth: true,
    });
  });

  it('identifies self-intersecting polygon edges', () => {
    expect(hasSelfIntersectingPolygonEdges([
      { x: 0, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 4, y: 0 },
    ])).toBe(true);
  });

  it('does not mark a simple sloped polygon as self-intersecting', () => {
    expect(hasSelfIntersectingPolygonEdges([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 3 },
      { x: 1, y: 3 },
    ])).toBe(false);
  });

  it('rebuilds a sloped rectangle from low-edge width and actual upslope height', () => {
    expect(rebuildSlopedPolygonRectangleFromLowEdgeDimensions({
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 4, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      widthM: 5,
      heightM: 2,
      pitchDegrees: 60,
    })).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
      { x: 5, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ]);
  });

  it('preserves the current upslope side when rebuilding a sloped rectangle', () => {
    expect(rebuildSlopedPolygonRectangleFromLowEdgeDimensions({
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 4, y: -1, z: 0 },
        { x: 0, y: -1, z: 0 },
      ],
      widthM: 5,
      heightM: 2,
      pitchDegrees: 60,
    })).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
      { x: 5, y: -1, z: 0 },
      { x: 0, y: -1, z: 0 },
    ]);
  });

  it('does not request a rebuild for an already rectangular sloped polygon', () => {
    expect(slopedPolygonNeedsRectangleRebuild({
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 4, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      widthM: 4,
      heightM: 2,
      pitchDegrees: 60,
    })).toBe(false);
  });

  it('requests a rebuild for a skewed sloped polygon', () => {
    expect(slopedPolygonNeedsRectangleRebuild({
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 5, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      widthM: 4,
      heightM: 2,
      pitchDegrees: 60,
    })).toBe(true);
  });
});
