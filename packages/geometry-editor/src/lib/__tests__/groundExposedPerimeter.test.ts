// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementGround, Element } from '../../geometry/types';
import { computeGroundExposedPerimeterDetails } from '../groundExposedPerimeter';

const ground: BuildingElementGround = {
  id: 'g1',
  name: 'Ground floor',
  zoneId: 'z1',
  floorId: '0',
  type: 'BuildingElementGround',
  width: 5,
  height: 0,
  area: 20,
  total_area: 20,
  perimeter: 18,
  floor_type: 'Slab_no_edge_insulation',
  parent_element: null,
  coordinates: [
    { x: 0, y: 0, z: 0 },
    { x: 5, y: 0, z: 0 },
    { x: 5, y: 4, z: 0 },
    { x: 0, y: 4, z: 0 },
  ],
};

function wall(id: string, name: string, coordinates: Element['coordinates'], overrides: Partial<Element> = {}): Element {
  return {
    id,
    name,
    zoneId: 'z1',
    floorId: '0',
    type: 'BuildingElementOpaque',
    width: 5,
    height: 2.4,
    area: 12,
    pitch: 90,
    parent_element: null,
    coordinates,
    ...overrides,
  } as Element;
}

describe('computeGroundExposedPerimeterDetails', () => {
  it('counts external opaque and adjacent-unheated wall runs linked to the ground floor outline', () => {
    const south = wall('w1', 'South wall', [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ]);
    const eastAdjacent: Element = {
      id: 'a1',
      name: 'East adjacent',
      zoneId: 'z1',
      floorId: '0',
      type: 'BuildingElementAdjacentUnconditionedSpace_Simple',
      width: 4,
      height: 2.4,
      area: 9.6,
      parent_element: null,
      coordinates: [
        { x: 5, y: 0, z: 0 },
        { x: 5, y: 4, z: 0 },
      ],
    } as Element;
    const westParty: Element = {
      id: 'p1',
      name: 'West party',
      zoneId: 'z1',
      floorId: '0',
      type: 'BuildingElementPartyWall',
      width: 4,
      height: 2.4,
      area: 9.6,
      parent_element: null,
      coordinates: [
        { x: 0, y: 4, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
    } as Element;

    const result = computeGroundExposedPerimeterDetails({
      [ground.id]: ground,
      [south.id]: south,
      [eastAdjacent.id]: eastAdjacent,
      [westParty.id]: westParty,
    }, ground);

    expect(result.shapePerimeterM).toBe(18);
    expect(result.valueM).toBe(9);
    expect(result.exposedRuns.map((run) => run.elementId)).toEqual(['w1', 'a1']);
    expect(result.excludedRuns.map((run) => run.reason)).toEqual(['party wall']);
  });

  it('does not count a boundary wall after it is changed away from external opaque', () => {
    const partySouth: Element = {
      id: 'p1',
      name: 'South party',
      zoneId: 'z1',
      floorId: '0',
      type: 'BuildingElementPartyWall',
      width: 5,
      height: 2.4,
      area: 12,
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
      ],
    } as Element;

    const result = computeGroundExposedPerimeterDetails({ [ground.id]: ground, [partySouth.id]: partySouth }, ground);
    expect(result.valueM).toBe(0);
    expect(result.excludedRuns).toHaveLength(1);
  });

  it('merges overlapping external runs on the same edge', () => {
    const wholeSouth = wall('w1', 'Whole south', [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ]);
    const duplicateSouth = wall('w2', 'Duplicate south', [
      { x: 1, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ]);

    const result = computeGroundExposedPerimeterDetails({
      [ground.id]: ground,
      [wholeSouth.id]: wholeSouth,
      [duplicateSouth.id]: duplicateSouth,
    }, ground);

    expect(result.valueM).toBe(5);
    expect(result.exposedRuns).toHaveLength(2);
  });

  it('does not let opening-only lines define exposed perimeter without a wall run', () => {
    const window: Element = {
      id: 'win1',
      name: 'South window',
      zoneId: 'z1',
      floorId: '0',
      type: 'BuildingElementTransparent',
      width: 2,
      height: 1.2,
      area: 2.4,
      pitch: 90,
      parent_element: 'Missing wall',
      coordinates: [
        { x: 1, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ],
    } as Element;
    const door = wall(
      'door1',
      'South door',
      [
        { x: 3, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
      { is_external_door: true, parent_element: 'Missing wall' },
    );

    const result = computeGroundExposedPerimeterDetails({
      [ground.id]: ground,
      [window.id]: window,
      [door.id]: door,
    }, ground);

    expect(result.valueM).toBe(0);
    expect(result.linkedBoundaryPerimeterM).toBe(0);
    expect(result.exposedRuns).toEqual([]);
    expect(result.excludedRuns).toEqual([]);
  });

  it('counts the host wall once when a window or external door sits on the exposed run', () => {
    const south = wall('w1', 'South wall', [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ]);
    const window: Element = {
      id: 'win1',
      name: 'South window',
      zoneId: 'z1',
      floorId: '0',
      type: 'BuildingElementTransparent',
      width: 1,
      height: 1.2,
      area: 1.2,
      pitch: 90,
      parent_element: 'South wall',
      coordinates: [
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
    } as Element;
    const door = wall(
      'door1',
      'South door',
      [
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ],
      { is_external_door: true, parent_element: 'South wall' },
    );

    const result = computeGroundExposedPerimeterDetails({
      [ground.id]: ground,
      [south.id]: south,
      [window.id]: window,
      [door.id]: door,
    }, ground);

    expect(result.valueM).toBe(5);
    expect(result.exposedRuns.map((run) => run.elementId)).toEqual(['w1']);
  });
});
