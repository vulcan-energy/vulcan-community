// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { getAreaBasedElementExportGeometry, getElementEffectiveArea, getElementGrossArea, getTransparentExportMidHeight } from '../elementArea';
import type {
  BuildingElementAdjacentConditionedSpace,
  BuildingElementOpaque,
  BuildingElementPartyWall,
  BuildingElementTransparent,
} from '../../geometry/types';

describe('getTransparentExportMidHeight', () => {
  it('uses base + height/2 for a uniform line window', () => {
    const el = {
      type: 'BuildingElementTransparent',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      width: 2,
      height: 1,
      base_height: 1.5,
    } as BuildingElementTransparent;
    expect(getTransparentExportMidHeight(el)).toBe(2);
  });

  it('uses equivalent rectangle for profiled line face', () => {
    const el = {
      type: 'BuildingElementTransparent',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 1.2, y: 0, z: 0 },
      ],
      width: 1.2,
      height: 0.4,
      base_height: 3.1,
      extra_json: {
        geometry_face: {
          kind: 'profiled-line-face',
          top_profile: [
            { t: 0, h: 0.6 },
            { t: 1, h: 0.2 },
          ],
          bottom_profile: [
            { t: 0, h: 0 },
            { t: 1, h: 0 },
          ],
        },
      },
    } as BuildingElementTransparent;
    const exp = getAreaBasedElementExportGeometry(el);
    expect(getTransparentExportMidHeight(el)).toBeCloseTo(exp.baseHeight + exp.height / 2, 4);
  });
});

describe('getAreaBasedElementExportGeometry sloped polygons', () => {
  it('exports actual sloped dimensions derived from the low edge convention', () => {
    const el = {
      type: 'BuildingElementOpaque',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 6, y: 0, z: 0 },
        { x: 6, y: 3, z: 0 },
        { x: 0, y: 3, z: 0 },
      ],
      width: 4.56,
      height: 4.56,
      area: 20.78,
      pitch: 30,
      base_height: 2,
      parent_element: null,
    } as BuildingElementOpaque;

    expect(getAreaBasedElementExportGeometry(el)).toEqual({
      width: 6,
      height: 3.46,
      baseHeight: 2,
    });
  });

  it('honours an explicit sloped width override on export', () => {
    const el = {
      type: 'BuildingElementOpaque',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 6, y: 0, z: 0 },
        { x: 6, y: 3, z: 0 },
        { x: 0, y: 3, z: 0 },
      ],
      width: 4,
      height: 2,
      area: 20.78,
      pitch: 30,
      base_height: 2,
      parent_element: null,
      _widthUserOverride: true,
    } as BuildingElementOpaque;

    expect(getAreaBasedElementExportGeometry(el)).toEqual({
      width: 4,
      height: 3.46,
      baseHeight: 2,
    });
  });
});

describe('getElementGrossArea adjacent conditioned internal area', () => {
  it('doubles line internal elements for both sides', () => {
    const el = {
      type: 'BuildingElementAdjacentConditionedSpace',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
      width: 4,
      height: 2.5,
      area: 10,
      pitch: 90,
      parent_element: null,
    } as BuildingElementAdjacentConditionedSpace;

    expect(getElementGrossArea(el)).toBe(20);
  });

  it('ignores stale party-floor metadata on line internal elements', () => {
    const el = {
      type: 'BuildingElementAdjacentConditionedSpace',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
      width: 4,
      height: 2.5,
      area: 10,
      pitch: 90,
      parent_element: null,
      extra_json: { _vulcan_ui_party_element: true },
    } as BuildingElementAdjacentConditionedSpace;

    expect(getElementGrossArea(el)).toBe(20);
  });

  it('doubles sloped-polygon internal elements using surface area', () => {
    const el = {
      type: 'BuildingElementAdjacentConditionedSpace',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
        { x: 3, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
      width: 3,
      height: 4,
      area: 12,
      pitch: 60,
      parent_element: null,
    } as BuildingElementAdjacentConditionedSpace;

    expect(getElementGrossArea(el)).toBeCloseTo(48, 2);
  });

  it('keeps party-floor polygons single-sided', () => {
    const el = {
      type: 'BuildingElementAdjacentConditionedSpace',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 6, y: 0, z: 0 },
        { x: 6, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
      width: 6,
      height: 4,
      area: 24,
      pitch: 0,
      parent_element: null,
      extra_json: { _vulcan_ui_party_element: true },
    } as BuildingElementAdjacentConditionedSpace;

    expect(getElementGrossArea(el)).toBe(24);
  });

  it('keeps dedicated party walls single-sided', () => {
    const el = {
      type: 'BuildingElementPartyWall',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
      width: 4,
      height: 2.5,
      area: 10,
      pitch: 90,
      parent_element: null,
    } as BuildingElementPartyWall;

    expect(getElementGrossArea(el)).toBe(10);
  });
});

describe('getElementGrossArea unheated pitched roof plan area', () => {
  const slopedRoof = (overrides: Partial<BuildingElementOpaque> = {}): BuildingElementOpaque => ({
    id: 'roof-1',
    name: 'Cold pitched roof',
    zoneId: 'zone-1',
    floorId: 'floor-0',
    type: 'BuildingElementOpaque',
    width: 3,
    height: 4,
    area: 12,
    pitch: 30,
    orientation360: 0,
    base_height: 0,
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 3, y: 4, z: 0 },
      { x: 0, y: 4, z: 0 },
    ],
    ...overrides,
  });

  it('uses horizontal plan area for an unheated pitched roof sloped polygon', () => {
    expect(getElementGrossArea(slopedRoof({ is_unheated_pitched_roof: true }))).toBe(12);
  });

  it('uses horizontal plan area for an unheated pitched roof with explicit 3D face geometry', () => {
    expect(getElementGrossArea(slopedRoof({
      area: 18,
      is_unheated_pitched_roof: true,
      extra_json: {
        geometry_face: {
          kind: 'planar-face-3d',
          points: [
            { x: 0, y: 0, z: 0 },
            { x: 3, y: 0, z: 0 },
            { x: 3, y: 4, z: 2 },
            { x: 0, y: 4, z: 2 },
          ],
        },
      },
    }))).toBe(12);
  });

  it('keeps warm sloped roof polygons on sloped surface area', () => {
    expect(getElementGrossArea(slopedRoof({ is_unheated_pitched_roof: false }))).toBeCloseTo(13.86, 2);
  });
});

describe('getElementEffectiveArea external door netting', () => {
  const wall = {
    id: 'wall-1',
    name: 'Wall',
    zoneId: 'zone-1',
    floorId: 'floor-0',
    type: 'BuildingElementOpaque',
    width: 4,
    height: 2,
    area: 8,
    pitch: 90,
    orientation360: 0,
    base_height: 0,
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
  } as BuildingElementOpaque;

  it('subtracts only vertical line external doors from opaque parent area', () => {
    const lineDoor = {
      ...wall,
      id: 'door-line',
      name: 'Line Door',
      width: 1,
      height: 2,
      area: 2,
      is_external_door: true,
      parent_element: 'Wall',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
    } as BuildingElementOpaque;
    const polygonDoor = {
      ...lineDoor,
      id: 'door-poly',
      name: 'Polygon Door',
      pitch: 0,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
    } as BuildingElementOpaque;

    expect(getElementEffectiveArea(wall, {
      [wall.id]: wall,
      [lineDoor.id]: lineDoor,
      [polygonDoor.id]: polygonDoor,
    })).toBe(6);
  });
});
