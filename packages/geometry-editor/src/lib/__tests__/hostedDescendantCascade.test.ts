// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import {
  cascadeHostedDescendantGeometry,
  cascadeHostedDescendantTranslation,
  collectHostedDescendantElementIds,
} from '../hostedDescendantCascade';

function elementsById(elements: Element[]): Record<string, Element> {
  return Object.fromEntries(elements.map((element) => [element.id, element]));
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
