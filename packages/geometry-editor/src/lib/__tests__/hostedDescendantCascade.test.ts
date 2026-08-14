// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import {
  cascadeHostedDescendantGeometry,
  cascadeHostedDescendantTranslation,
  collectHostedDescendantElementIds,
} from '../hostedDescendantCascade';
import { segmentTangentAndOpeningOutwardModelXY } from '../openingSegmentOutward';

type TestCoordinate = { x: number; y: number; z: number };

function elementsById(elements: Element[]): Record<string, Element> {
  return Object.fromEntries(elements.map((element) => [element.id, element]));
}

function windowShadingFallbackDistance(
  point: TestCoordinate,
  [a, b]: [TestCoordinate, TestCoordinate],
): number {
  const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const { openingOutward } = segmentTangentAndOpeningOutwardModelXY(a.x, a.y, b.x, b.y);
  return Math.max(
    0.1,
    (point.x - midpoint.x) * openingOutward[0] +
      (point.y - midpoint.y) * openingOutward[1],
  );
}

describe('cascadeHostedDescendantGeometry', () => {
  it('cascades line-host movement through child openings to hosted vents', () => {
    const wall = {
      id: 'wall',
      name: 'Wall',
      type: 'BuildingElementOpaque',
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      orientation360: 0,
      pitch: 90,
      parent_element: null,
    } as Element;
    const window = {
      id: 'window',
      name: 'Window',
      type: 'BuildingElementTransparent',
      coordinates: [{ x: 0.5, y: 0, z: 0 }, { x: 1.5, y: 0, z: 0 }],
      parent_element: 'Wall',
      orientation360: 0,
      pitch: 90,
      base_height: 1,
    } as Element;
    const vent = {
      id: 'vent',
      name: 'Vent',
      type: 'Vents',
      coordinates: [{ x: 1, y: 0, z: 0 }],
      parent_element: 'Window',
      orientation360: 0,
      pitch: 90,
      mid_height_air_flow_path: 1.2,
      area_cm2: 5000,
    } as Element;
    const shading = {
      id: 'shade',
      name: 'Shade',
      type: 'WindowShading',
      parent_element: 'Window',
      shading_type: 'overhang',
      depth: 0.4,
    } as Element;
    const previousElementsById = elementsById([wall, window, vent, shading]);
    const nextWall = {
      ...wall,
      coordinates: [{ x: 0, y: 2, z: 0 }, { x: 4, y: 2, z: 0 }],
      orientation360: 90,
    } as Element;
    const nextElementsById = {
      ...previousElementsById,
      wall: nextWall,
    };

    const result = cascadeHostedDescendantGeometry({
      previousElementsById,
      nextElementsById,
      changedElementIds: ['wall'],
    });

    expect(result.changedElementIds).toEqual(new Set(['wall', 'window', 'vent', 'shade']));
    expect(result.elementsById.window.coordinates).toEqual([
      { x: 1.5, y: 2, z: 0 },
      { x: 2.5, y: 2, z: 0 },
    ]);
    expect(result.elementsById.vent.coordinates).toEqual([{ x: 2, y: 2, z: 0 }]);
    expect(result.elementsById.shade).toBe(shading);
  });

  it('carries drawn window shading when its window translates along the wall', () => {
    const window = {
      id: 'window',
      name: 'Window',
      type: 'BuildingElementTransparent',
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      parent_element: 'Wall',
    } as Element;
    const shading = {
      id: 'shade',
      name: 'Overhang',
      type: 'WindowShading',
      coordinates: [{ x: 0.5, y: 0, z: 1.25 }],
      parent_element: 'Window',
      shading_type: 'overhang',
      depth: 0.4,
    } as Element;
    const previousElementsById = elementsById([window, shading]);
    const nextWindow = {
      ...window,
      coordinates: [{ x: 2, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
    } as Element;

    const result = cascadeHostedDescendantGeometry({
      previousElementsById,
      nextElementsById: { ...previousElementsById, window: nextWindow },
      changedElementIds: ['window'],
    });

    expect(result.changedElementIds).toEqual(new Set(['window', 'shade']));
    expect(result.elementsById.shade.coordinates).toEqual([{ x: 2.5, y: 0, z: 1.25 }]);
  });

  it('does not rewrite off-segment shading for a non-geometric parent update', () => {
    const window = {
      id: 'window',
      name: 'Window',
      type: 'BuildingElementTransparent',
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      parent_element: 'Wall',
      u_value: 1.2,
    } as Element;
    const shading = {
      id: 'shade',
      name: 'Side fin',
      type: 'WindowShading',
      coordinates: [{ x: 2.5, y: 0, z: 1 }],
      parent_element: 'Window',
      shading_type: 'sidefinright',
      depth: 0.3,
      _v: 7,
    } as Element;
    const previousElementsById = elementsById([window, shading]);
    const nextWindow = { ...window, u_value: 0.9 } as Element;

    const result = cascadeHostedDescendantGeometry({
      previousElementsById,
      nextElementsById: { ...previousElementsById, window: nextWindow },
      changedElementIds: ['window'],
    });

    expect(result.elementsById.shade).toBe(shading);
    expect(result.elementsById.shade._v).toBe(7);
  });

  it('translates off-segment shading without losing its tangential offset', () => {
    const window = {
      id: 'window',
      name: 'Window',
      type: 'BuildingElementTransparent',
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      parent_element: 'Wall',
    } as Element;
    const shading = {
      id: 'shade',
      name: 'Side fin',
      type: 'WindowShading',
      coordinates: [{ x: 2.5, y: 0, z: 1 }],
      parent_element: 'Window',
      shading_type: 'sidefinright',
      depth: 0.3,
    } as Element;
    const previousElementsById = elementsById([window, shading]);
    const nextWindow = {
      ...window,
      coordinates: [{ x: 3, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }],
    } as Element;

    const result = cascadeHostedDescendantGeometry({
      previousElementsById,
      nextElementsById: { ...previousElementsById, window: nextWindow },
      changedElementIds: ['window'],
    });

    expect(result.elementsById.shade.coordinates).toEqual([{ x: 5.5, y: 0, z: 1 }]);
  });

  it('preserves shading position and signed standoff when its window rotates', () => {
    const window = {
      id: 'window',
      name: 'Window',
      type: 'BuildingElementTransparent',
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
      parent_element: 'Wall',
    } as Element;
    const shading = {
      id: 'shade',
      name: 'Side fin',
      type: 'WindowShading',
      coordinates: [{ x: 1, y: -2, z: 3.5 }],
      parent_element: 'Window',
      shading_type: 'sidefinleft',
      depth: 0.3,
    } as Element;
    const previousElementsById = elementsById([window, shading]);
    const nextWindow = {
      ...window,
      coordinates: [{ x: 10, y: 10, z: 0 }, { x: 10, y: 14, z: 0 }],
    } as Element;

    const result = cascadeHostedDescendantGeometry({
      previousElementsById,
      nextElementsById: { ...previousElementsById, window: nextWindow },
      changedElementIds: ['window'],
    });

    expect(result.elementsById.shade.coordinates).toEqual([{ x: 12, y: 11, z: 3.5 }]);
  });

  it('keeps object shading standoff instead of snapping it onto the moved window', () => {
    const window = {
      id: 'window',
      name: 'Window',
      type: 'BuildingElementTransparent',
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
      parent_element: 'Wall',
    } as Element;
    const shading = {
      id: 'shade',
      name: 'Object shading',
      type: 'WindowShading',
      coordinates: [{ x: 3, y: -1.5, z: 2 }],
      parent_element: 'Window',
      shading_type: 'object',
      height: 2,
      transparency: 0,
    } as Element;
    const previousElementsById = elementsById([window, shading]);
    const nextWindow = {
      ...window,
      coordinates: [{ x: 10, y: 5, z: 0 }, { x: 18, y: 5, z: 0 }],
    } as Element;

    const result = cascadeHostedDescendantGeometry({
      previousElementsById,
      nextElementsById: { ...previousElementsById, window: nextWindow },
      changedElementIds: ['window'],
    });

    const nextPoint = result.elementsById.shade.coordinates?.[0] as TestCoordinate;
    expect(nextPoint).toEqual({ x: 16, y: 3.5, z: 2 });
    const previousFallbackDistance = windowShadingFallbackDistance(
      shading.coordinates?.[0] as TestCoordinate,
      window.coordinates as [TestCoordinate, TestCoordinate],
    );
    const nextFallbackDistance = windowShadingFallbackDistance(
      nextPoint,
      nextWindow.coordinates as [TestCoordinate, TestCoordinate],
    );
    expect(previousFallbackDistance).toBe(1.5);
    expect(nextFallbackDistance).toBe(previousFallbackDistance);
  });

  it('does not move shading when the next parent segment is degenerate', () => {
    const window = {
      id: 'window',
      name: 'Window',
      type: 'BuildingElementTransparent',
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      parent_element: 'Wall',
    } as Element;
    const shading = {
      id: 'shade',
      name: 'Object shading',
      type: 'WindowShading',
      coordinates: [{ x: 1, y: -1, z: 2 }],
      parent_element: 'Window',
      shading_type: 'object',
      height: 2,
      transparency: 0,
    } as Element;
    const previousElementsById = elementsById([window, shading]);
    const nextWindow = {
      ...window,
      coordinates: [{ x: 3, y: 4, z: 0 }, { x: 3, y: 4, z: 0 }],
    } as Element;

    const result = cascadeHostedDescendantGeometry({
      previousElementsById,
      nextElementsById: { ...previousElementsById, window: nextWindow },
      changedElementIds: ['window'],
    });

    expect(result.elementsById.shade).toBe(shading);
  });

  it('does not move shading when the previous parent segment is degenerate', () => {
    const window = {
      id: 'window',
      name: 'Window',
      type: 'BuildingElementTransparent',
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }],
      parent_element: 'Wall',
    } as Element;
    const shading = {
      id: 'shade',
      name: 'Object shading',
      type: 'WindowShading',
      coordinates: [{ x: 1, y: -1, z: 2 }],
      parent_element: 'Window',
      shading_type: 'object',
      height: 2,
      transparency: 0,
    } as Element;
    const previousElementsById = elementsById([window, shading]);
    const nextWindow = {
      ...window,
      coordinates: [{ x: 3, y: 4, z: 0 }, { x: 5, y: 4, z: 0 }],
    } as Element;

    const result = cascadeHostedDescendantGeometry({
      previousElementsById,
      nextElementsById: { ...previousElementsById, window: nextWindow },
      changedElementIds: ['window'],
    });

    expect(result.elementsById.shade).toBe(shading);
  });

  it('cascades a wall rotation through its window to window shading in one pass', () => {
    const wall = {
      id: 'wall',
      name: 'Wall',
      type: 'BuildingElementOpaque',
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
      parent_element: null,
    } as Element;
    const window = {
      id: 'window',
      name: 'Window',
      type: 'BuildingElementTransparent',
      coordinates: [{ x: 2, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
      parent_element: 'Wall',
    } as Element;
    const shading = {
      id: 'shade',
      name: 'Overhang',
      type: 'WindowShading',
      coordinates: [{ x: 2.5, y: 0, z: 1 }],
      parent_element: 'Window',
      shading_type: 'overhang',
      depth: 0.4,
    } as Element;
    const previousElementsById = elementsById([wall, window, shading]);
    const nextWall = {
      ...wall,
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 20, z: 0 }],
    } as Element;

    const result = cascadeHostedDescendantGeometry({
      previousElementsById,
      nextElementsById: { ...previousElementsById, wall: nextWall },
      changedElementIds: ['wall'],
    });

    expect(result.changedElementIds).toEqual(new Set(['wall', 'window', 'shade']));
    expect(result.elementsById.window.coordinates).toEqual([
      { x: 0, y: 5, z: 0 },
      { x: 0, y: 7, z: 0 },
    ]);
    expect(result.elementsById.shade.coordinates).toEqual([{ x: 0, y: 5.5, z: 1 }]);
  });

  it('cascades to shading through a window that produced no patch of its own', () => {
    // The store re-anchors direct line children INLINE before this cascade runs
    // (updateElement / commitVertexPositionUpdates), using the same math, so the
    // window normally arrives already correct and updateLineOpeningChild returns
    // null. The grandchild shading is only reachable by traversing THROUGH that
    // window, so it must still be queued as a parent.
    //
    // An explicit non-default security_risk is what makes this reproducible:
    // syncWindowSecurityRiskForStorey returns the element untouched once the value
    // is no longer 'auto' (storey 0 defaults to true), so extra_json keeps its
    // reference and elementPatchChanged goes false. When the value IS auto, sync
    // allocates a fresh extra_json and the reference inequality alone kept this
    // chain alive — an accident, not a mechanism.
    const wall = {
      id: 'wall',
      name: 'Wall',
      type: 'BuildingElementOpaque',
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
      parent_element: null,
    } as Element;
    const window = {
      id: 'window',
      name: 'Window',
      type: 'BuildingElementTransparent',
      coordinates: [{ x: 2, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
      parent_element: 'Wall',
      extra_json: { security_risk: false },
    } as Element;
    const shading = {
      id: 'shade',
      name: 'Object shading',
      type: 'WindowShading',
      coordinates: [{ x: 3, y: -1.5, z: 0 }],
      parent_element: 'Window',
      shading_type: 'object',
      distance: 1.5,
      height: 2,
      transparency: 0,
    } as Element;
    const previousElementsById = elementsById([wall, window, shading]);

    // The wall turns 90 degrees CCW about the origin; the store has already put the
    // window on the new wall, so only the shading is left behind.
    const nextWall = {
      ...wall,
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }],
    } as Element;
    const nextWindow = {
      ...window,
      coordinates: [{ x: 0, y: 2, z: 0 }, { x: 0, y: 4, z: 0 }],
    } as Element;

    const result = cascadeHostedDescendantGeometry({
      previousElementsById,
      nextElementsById: { ...previousElementsById, wall: nextWall, window: nextWindow },
      changedElementIds: ['wall'],
      floors: [{ id: '0', zIndex: 0 }],
    });

    // The same rigid rotation the window underwent: (x,y) -> (-y,x).
    expect(result.elementsById.shade.coordinates).toEqual([{ x: 1.5, y: 3, z: 0 }]);
    // The window really did produce no patch — that is the condition under test.
    expect(result.elementsById.window.coordinates).toEqual(nextWindow.coordinates);
    expect(result.changedElementIds).toEqual(new Set(['wall', 'shade']));
  });

  it('leaves shading alone when the previous parent segment is near-degenerate', () => {
    // t is unclamped so that shading beyond either end round-trips exactly, which
    // means a vanishing previous segment amplifies without bound. A 1e-6 m window
    // with shading 0.5 m along it gives t = 5e5 and would fling the shading ~10^6 m.
    const wall = {
      id: 'wall',
      name: 'Wall',
      type: 'BuildingElementOpaque',
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
      parent_element: null,
    } as Element;
    const window = {
      id: 'window',
      name: 'Window',
      type: 'BuildingElementTransparent',
      coordinates: [{ x: 2, y: 0, z: 0 }, { x: 2.000001, y: 0, z: 0 }],
      parent_element: 'Wall',
      extra_json: { security_risk: false },
    } as Element;
    const shading = {
      id: 'shade',
      name: 'Object shading',
      type: 'WindowShading',
      coordinates: [{ x: 2.5, y: -1.5, z: 0 }],
      parent_element: 'Window',
      shading_type: 'object',
      distance: 1.5,
      height: 2,
      transparency: 0,
    } as Element;
    const previousElementsById = elementsById([wall, window, shading]);
    const nextWall = {
      ...wall,
      coordinates: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }],
    } as Element;
    const nextWindow = {
      ...window,
      coordinates: [{ x: 0, y: 2, z: 0 }, { x: 0, y: 2.000001, z: 0 }],
    } as Element;

    const result = cascadeHostedDescendantGeometry({
      previousElementsById,
      nextElementsById: { ...previousElementsById, wall: nextWall, window: nextWindow },
      changedElementIds: ['wall'],
      floors: [{ id: '0', zIndex: 0 }],
    });

    expect(result.elementsById.shade.coordinates).toEqual(shading.coordinates);
    expect(result.changedElementIds.has('shade')).toBe(true);
  });

  it('skips a non-line parent entirely, so its shading is never visited', () => {
    const polygon = {
      id: 'polygon',
      name: 'Polygon',
      type: 'BuildingElementOpaque',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 4, y: 2, z: 0 },
        { x: 0, y: 2, z: 0 },
      ],
      parent_element: null,
    } as Element;
    const shading = {
      id: 'shade',
      name: 'Object shading',
      type: 'WindowShading',
      coordinates: [{ x: 2, y: -1, z: 1 }],
      parent_element: 'Polygon',
      shading_type: 'object',
      distance: 1,
      height: 2,
      transparency: 0,
    } as Element;
    const previousElementsById = elementsById([polygon, shading]);
    const nextPolygon = {
      ...polygon,
      coordinates: [
        { x: -1, y: 0, z: 0 },
        ...polygon.coordinates.slice(1),
      ],
    } as Element;

    const result = cascadeHostedDescendantGeometry({
      previousElementsById,
      nextElementsById: { ...previousElementsById, polygon: nextPolygon },
      changedElementIds: ['polygon'],
    });

    expect(result.changedElementIds).toEqual(new Set(['polygon']));
    expect(result.elementsById.shade).toBe(shading);
  });
});

describe('hosted descendant translation cascade', () => {
  it('collects hosted descendants recursively through generic parent links', () => {
    const host = {
      id: 'roof',
      name: 'Roof',
      type: 'BuildingElementOpaque',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 4, y: 2, z: 0 },
        { x: 0, y: 2, z: 0 },
      ],
      parent_element: null,
    } as Element;
    const opening = {
      id: 'opening',
      name: 'Roof light',
      type: 'BuildingElementTransparent',
      coordinates: [
        { x: 1, y: 0.5, z: 0 },
        { x: 2, y: 0.5, z: 0 },
        { x: 2, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      parent_element: 'Roof',
    } as Element;
    const vent = {
      id: 'vent',
      name: 'Vent',
      type: 'Vents',
      coordinates: [{ x: 1.5, y: 0.75, z: 0 }],
      parent_element: 'Roof light',
    } as Element;
    const duct = {
      id: 'duct',
      name: 'Duct',
      type: 'MechanicalVentilationDuctwork',
      coordinates: [
        { x: 1.5, y: 0.75, z: 0 },
        { x: 1.5, y: 1.25, z: 0 },
      ],
      parent_element: 'Vent',
    } as Element;

    expect(collectHostedDescendantElementIds(elementsById([host, opening, vent, duct]), 'roof')).toEqual([
      'opening',
      'vent',
      'duct',
    ]);
  });

  it('translates generic descendants for a whole sloped polygon host move without changing child shape', () => {
    const roof = {
      id: 'roof',
      name: 'Sloped Roof',
      type: 'BuildingElementOpaque',
      pitch: 35,
      orientation360: 180,
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 4, y: 0, z: 1 },
        { x: 4, y: 2, z: 1 },
        { x: 0, y: 2, z: 1 },
      ],
      parent_element: null,
    } as Element;
    const opening = {
      id: 'opening',
      name: 'Roof Opening',
      type: 'BuildingElementTransparent',
      coordinates: [
        { x: 1, y: 0.5, z: 1 },
        { x: 2, y: 0.5, z: 1 },
        { x: 2, y: 1, z: 1 },
        { x: 1, y: 1, z: 1 },
      ],
      parent_element: 'Sloped Roof',
    } as Element;
    const shading = {
      id: 'shade',
      name: 'Object shading',
      type: 'WindowShading',
      shading_type: 'object',
      coordinates: [
        { x: 0.8, y: 0.2, z: 1 },
        { x: 2.2, y: 0.2, z: 1 },
        { x: 2.2, y: 1.3, z: 1 },
        { x: 0.8, y: 1.3, z: 1 },
      ],
      parent_element: 'Roof Opening',
    } as Element;
    const mechanicalVentilation = {
      id: 'mv',
      name: 'MVHR supply',
      type: 'MechanicalVentilation',
      vent_type: 'MVHR',
      coordinates: [{ x: 1.5, y: 0.75, z: 1 }],
      parent_element: 'Roof Opening',
    } as Element;
    const previousElementsById = elementsById([roof, opening, shading, mechanicalVentilation]);
    const nextRoof = {
      ...roof,
      coordinates: roof.coordinates.map((coord) => ({
        ...coord,
        x: coord.x + 3,
        y: coord.y - 2,
      })),
    } as Element;

    const result = cascadeHostedDescendantTranslation({
      previousElementsById,
      nextElementsById: {
        ...previousElementsById,
        roof: nextRoof,
      },
      changedElementIds: ['roof'],
    });

    expect(result.changedElementIds).toEqual(new Set(['roof', 'opening', 'shade', 'mv']));
    expect(result.elementsById.opening.coordinates).toEqual([
      { x: 4, y: -1.5, z: 1 },
      { x: 5, y: -1.5, z: 1 },
      { x: 5, y: -1, z: 1 },
      { x: 4, y: -1, z: 1 },
    ]);
    expect(result.elementsById.shade.coordinates).toEqual([
      { x: 3.8, y: -1.8, z: 1 },
      { x: 5.2, y: -1.8, z: 1 },
      { x: 5.2, y: -0.7, z: 1 },
      { x: 3.8, y: -0.7, z: 1 },
    ]);
    expect(result.elementsById.mv.coordinates).toEqual([{ x: 4.5, y: -1.25, z: 1 }]);
  });

  it('does not translate polygon-hosted descendants for a host vertex edit', () => {
    const host = {
      id: 'host',
      name: 'Polygon Host',
      type: 'BuildingElementOpaque',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 4, y: 2, z: 0 },
        { x: 0, y: 2, z: 0 },
      ],
      parent_element: null,
    } as Element;
    const child = {
      id: 'child',
      name: 'Hosted Polygon',
      type: 'BuildingElementTransparent',
      coordinates: [
        { x: 1, y: 0.5, z: 0 },
        { x: 2, y: 0.5, z: 0 },
        { x: 2, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      parent_element: 'Polygon Host',
    } as Element;
    const previousElementsById = elementsById([host, child]);
    const nextElementsById = {
      ...previousElementsById,
      host: {
        ...host,
        coordinates: [
          { x: -0.5, y: 0.25, z: 0 },
          ...host.coordinates.slice(1),
        ],
      } as Element,
    };

    const result = cascadeHostedDescendantTranslation({
      previousElementsById,
      nextElementsById,
      changedElementIds: ['host'],
    });

    expect(result.changedElementIds).toEqual(new Set(['host']));
    expect(result.elementsById.child).toBe(child);
  });
});
