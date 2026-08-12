// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  deriveLegacySlopedElementDimensions,
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

  it('matches cos/tan of the exact decimal pitch, not a rounded integer', () => {
    // Regression pin for the pitch-decimal fix: pitch is never rounded before it reaches this
    // function (schemaCache's fallbackIntegerKeys and the CSV writer used to round it to an
    // integer before it got here — e.g. 22.5° silently became 23°). This function itself never
    // rounded pitch; it only rounds its *outputs* to 2dp (roundToTwoDecimals). Prove the two are
    // distinguishable: deriving from the exact 22.5° must not collapse onto what a rounded 23°
    // would have produced.
    const element = {
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 6, y: 0, z: 0 },
        { x: 6, y: 3, z: 0 },
        { x: 0, y: 3, z: 0 },
      ],
      pitch: 22.5,
    };

    const derived = deriveSlopedElementDimensions(element);
    expect(derived).not.toBeNull();

    const roundToTwoDp = (n: number): number => Math.round(n * 100) / 100;
    const exactHeight = roundToTwoDp(3 / Math.cos((22.5 * Math.PI) / 180));
    const roundedPitchHeight = roundToTwoDp(3 / Math.cos((23 * Math.PI) / 180));

    expect(derived?.height).toBe(exactHeight);
    expect(derived?.height).not.toBe(roundedPitchHeight); // measurable divergence from rounded-pitch geometry
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

// The equivalent-width formula change: for a non-parallelogram sloped shape (triangle,
// trapezoid), HEIGHT stays the true up-slope (slope-plane) length — HEM derives
// overhang/obstacle shading from it (projected_height = height*sin(pitch)) — and WIDTH
// becomes the equivalent dimension (area / height) instead. Parallelograms (including
// rectangles) are unaffected: width = low-edge length and height = area / width already
// equals the true slope length for that shape.
describe('deriveSlopedElementDimensions — equivalent-width formula for non-parallelogram slopes', () => {
  const roundToTwoDp = (n: number): number => Math.round(n * 100) / 100;

  it('triangle slope: height is the true up-slope length, not area / low-edge width', () => {
    // Eaves edge (0,0)->(4,0) = 4 m; apex (2,3) sits 3 m up-slope in plan, pitch 30 deg.
    const element = {
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 2, y: 3, z: 0 },
      ],
      pitch: 30,
    };

    const legacy = deriveLegacySlopedElementDimensions(element);
    expect(legacy).not.toBeNull();
    expect(legacy?.width).toBe(4); // old formula: width = low-edge length

    const derived = deriveSlopedElementDimensions(element);
    expect(derived).not.toBeNull();

    // True slope length to the farthest vertex (the apex, 3 m up-slope in plan): 3 / cos(30deg).
    const expectedHeight = 3 / Math.cos((30 * Math.PI) / 180);
    expect(derived?.height).toBeCloseTo(expectedHeight, 2);
    expect(derived?.height).toBeCloseTo(3.46, 2);

    // The old formula (height = area / low-edge width) is gone.
    expect(derived?.height).not.toBe(legacy?.height);
    expect(derived?.width).not.toBe(legacy?.width);

    // Width is now the equivalent dimension: area is preserved (width * height ~= area).
    if (derived) {
      expect(Math.abs(roundToTwoDp(derived.width * derived.height) - derived.area)).toBeLessThanOrEqual(0.03);
    }
  });

  it('trapezoid slope: height is the far-extent slope length, width is the equivalent dimension', () => {
    // Eaves edge (0,0)->(6,0) = 6 m (low edge); far edge (1,4)->(4,4) is shorter and set back
    // 4 m up-slope in plan, pitch 40 deg.
    const element = {
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 6, y: 0, z: 0 },
        { x: 4, y: 4, z: 0 },
        { x: 1, y: 4, z: 0 },
      ],
      pitch: 40,
    };

    const legacy = deriveLegacySlopedElementDimensions(element);
    expect(legacy).not.toBeNull();
    expect(legacy?.width).toBe(6);

    const derived = deriveSlopedElementDimensions(element);
    expect(derived).not.toBeNull();

    const expectedHeight = 4 / Math.cos((40 * Math.PI) / 180);
    expect(derived?.height).toBeCloseTo(expectedHeight, 2);

    // No longer pinned to the low-edge width, and no longer the old area/width value.
    expect(derived?.width).not.toBe(6);
    expect(derived?.height).not.toBe(legacy?.height);

    if (derived) {
      expect(Math.abs(roundToTwoDp(derived.width * derived.height) - derived.area)).toBeLessThanOrEqual(0.03);
    }
  });

  it('rectangle slope (parallelogram): unchanged regression pin', () => {
    const element = {
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 6, y: 0, z: 0 },
        { x: 6, y: 3, z: 0 },
        { x: 0, y: 3, z: 0 },
      ],
      pitch: 30,
    };

    const derived = deriveSlopedElementDimensions(element);
    const legacy = deriveLegacySlopedElementDimensions(element);

    expect(derived).toEqual({ width: 6, height: 3.46, area: 20.78 });
    // For a true parallelogram, the current and legacy formulas coincide.
    expect(derived).toEqual(legacy);
  });

  it('sheared parallelogram slope (opposite sides equal and parallel but not axis-aligned): unchanged regression pin', () => {
    const element = {
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 5, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      pitch: 60,
    };

    const derived = deriveSlopedElementDimensions(element);
    const legacy = deriveLegacySlopedElementDimensions(element);

    expect(derived).not.toBeNull();
    expect(derived).toEqual(legacy);
    expect(derived?.width).toBe(4);
  });
});
