// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementOpaque, Element, Floor } from '../../geometry/types';
import {
  getUnheatedPitchedRoofCeilingElevationM,
  mergeUnheatedPitchedRoofCeilingElevationExtraJson,
  UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY,
} from '../unheatedPitchedRoofCeiling';

const floors: Floor[] = [
  { id: 'f0', name: 'Ground', zIndex: 0, height: 2.8, isRoofSpace: false },
  { id: 'f1', name: 'First', zIndex: 1, height: 2.8, isRoofSpace: false },
  { id: 'f2', name: 'Roof', zIndex: 2, height: 0, isRoofSpace: true },
];

function coldRoof(overrides: Partial<BuildingElementOpaque> = {}): BuildingElementOpaque {
  return {
    id: 'roof',
    name: 'Cold pitched roof',
    zoneId: 'z1',
    floorId: 'f2',
    type: 'BuildingElementOpaque',
    parent_element: null,
    width: 4,
    height: 4,
    area: 16,
    pitch: 40,
    base_height: 6.2,
    is_unheated_pitched_roof: true,
    coordinates: [
      { x: 0, y: 0, z: 2 },
      { x: 4, y: 0, z: 2 },
      { x: 4, y: 3, z: 2 },
      { x: 0, y: 3, z: 2 },
    ],
    ...overrides,
  };
}

function upperWall(overrides: Partial<BuildingElementOpaque> = {}): BuildingElementOpaque {
  return {
    id: 'upper-wall',
    name: 'Upper wall',
    zoneId: 'z1',
    floorId: 'f1',
    type: 'BuildingElementOpaque',
    parent_element: null,
    width: 4,
    height: 2.8,
    area: 11.2,
    pitch: 90,
    base_height: 2.8,
    coordinates: [
      { x: 0, y: 0, z: 1 },
      { x: 4, y: 0, z: 1 },
    ],
    ...overrides,
  };
}

describe('getUnheatedPitchedRoofCeilingElevationM', () => {
  it('uses the authored ceiling elevation when present', () => {
    const roof = coldRoof({
      extra_json: {
        [UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY]: 5.35,
      },
    });

    const result = getUnheatedPitchedRoofCeilingElevationM(roof, [roof, upperWall()] as Element[], floors);

    expect(result).toEqual({ value: 5.35, source: 'authored' });
  });

  it('infers the heat-loss boundary from wall tops below a higher roof-plane base', () => {
    const roof = coldRoof({ base_height: 6.2 });
    const result = getUnheatedPitchedRoofCeilingElevationM(roof, [roof, upperWall()] as Element[], floors);

    expect(result).toEqual({ value: 5.6, source: 'wall-top' });
  });

  it('falls back to the roof storey ceiling when no matching walls are available', () => {
    const roof = coldRoof({ base_height: 6.2 });
    const result = getUnheatedPitchedRoofCeilingElevationM(roof, [roof] as Element[], floors);

    expect(result).toEqual({ value: 5.6, source: 'storey-ceiling' });
  });

  it('uses roof base height when there is no authored value, wall top, or storey ceiling', () => {
    const roof = coldRoof({
      floorId: undefined,
      base_height: 1.2,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 4, y: 3, z: 0 },
        { x: 0, y: 3, z: 0 },
      ],
    });

    const result = getUnheatedPitchedRoofCeilingElevationM(roof, [roof] as Element[], undefined);

    expect(result).toEqual({ value: 1.2, source: 'roof-base' });
  });
});

describe('mergeUnheatedPitchedRoofCeilingElevationExtraJson', () => {
  it('writes and clears the authored ceiling elevation without dropping other metadata', () => {
    const extra = mergeUnheatedPitchedRoofCeilingElevationExtraJson({ keep: true }, 5.6);
    expect(extra).toEqual({
      keep: true,
      [UNHEATED_PITCHED_ROOF_CEILING_ELEVATION_KEY]: 5.6,
    });

    expect(mergeUnheatedPitchedRoofCeilingElevationExtraJson(extra, '')).toEqual({ keep: true });
  });
});
