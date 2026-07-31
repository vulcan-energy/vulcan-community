// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementOpaque, BuildingElementPartyWall, Element, OnSiteGeneration } from '../../geometry/types';
import {
  computePvRoofClearanceGuidance,
  PV_PARTY_WALL_CLEARANCE_GUIDANCE_M,
} from '../pvRoofClearance';

const square = (x0: number, y0: number, side: number, z = 0) => [
  { x: x0, y: y0, z },
  { x: x0 + side, y: y0, z },
  { x: x0 + side, y: y0 + side, z },
  { x: x0, y: y0 + side, z },
];

const makeRoof = (overrides: Partial<BuildingElementOpaque> = {}): BuildingElementOpaque =>
  ({
    id: 'roof-1',
    name: 'Main Roof',
    type: 'BuildingElementOpaque',
    parent_element: null,
    coordinates: square(0, 0, 10),
    width: 10,
    height: 10,
    pitch: 0,
    orientation360: 180,
    base_height: 2.5,
    ...overrides,
  }) as BuildingElementOpaque;

const makePanel = (overrides: Partial<OnSiteGeneration> = {}): OnSiteGeneration =>
  ({
    id: 'pv-1',
    name: 'PV Panel',
    type: 'OnSiteGeneration',
    generation_type: 'PhotovoltaicSystem',
    parent_element: null,
    coordinates: square(2, 2, 1),
    pitch: 0,
    orientation360: 180,
    base_height: 2.5,
    width: 1,
    height: 1,
    peak_power: 0.4,
    _pvHostRoofId: 'roof-1',
    ...overrides,
  }) as OnSiteGeneration;

const makePartyWall = (
  id: string,
  coordinates: BuildingElementPartyWall['coordinates'],
): BuildingElementPartyWall =>
  ({
    id,
    name: id,
    type: 'BuildingElementPartyWall',
    parent_element: null,
    coordinates,
    width: 10,
    height: 2.4,
    area: 24,
    pitch: 90,
  }) as BuildingElementPartyWall;

describe('computePvRoofClearanceGuidance', () => {
  it('does not infer roof-edge clearance from the host roof polygon', () => {
    const guidance = computePvRoofClearanceGuidance(
      makePanel({ coordinates: square(2, 0.25, 1) }),
      makeRoof({ pitch: 60 }),
    );

    expect(guidance.measurementKind).toBe('roof-surface');
    expect(guidance.items).toHaveLength(0);
    expect(guidance.primary).toBeNull();
  });

  it('includes party-wall centreline clearance when a party wall is associated with the host roof', () => {
    const roof = makeRoof();
    const panel = makePanel({ coordinates: square(5.6, 2, 1) });
    const partyWall = makePartyWall('party-1', [
      { x: 5, y: 0, z: 0 },
      { x: 5, y: 10, z: 0 },
    ]);

    const guidance = computePvRoofClearanceGuidance(panel, roof, [roof, panel, partyWall] as Element[]);

    expect(guidance.primary?.feature).toBe('party-wall');
    expect(guidance.primary?.status).toBe('below-guidance');
    expect(guidance.primary?.distanceM).toBeCloseTo(0.6, 6);
    expect(guidance.primary?.guidanceDistanceM).toBe(PV_PARTY_WALL_CLEARANCE_GUIDANCE_M);
  });

  it('uses roof-surface distance for party-wall clearance on pitched roofs', () => {
    const roof = makeRoof({ pitch: 60 });
    const panel = makePanel({ coordinates: square(2, 0.2, 1), pitch: 60 });
    const partyWall = makePartyWall('party-1', [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ]);

    const guidance = computePvRoofClearanceGuidance(panel, roof, [roof, panel, partyWall] as Element[]);

    expect(guidance.measurementKind).toBe('roof-surface');
    expect(guidance.primary?.feature).toBe('party-wall');
    expect(guidance.primary?.distanceM).toBeCloseTo(0.4, 6);
    expect(guidance.primary?.status).toBe('below-guidance');
  });

  it('ignores party walls that are not associated with the host roof footprint', () => {
    const roof = makeRoof();
    const panel = makePanel({ coordinates: square(2, 2, 1) });
    const distantPartyWall = makePartyWall('party-2', [
      { x: 50, y: 0, z: 0 },
      { x: 50, y: 10, z: 0 },
    ]);

    const guidance = computePvRoofClearanceGuidance(panel, roof, [roof, panel, distantPartyWall] as Element[]);

    expect(guidance.items).toHaveLength(0);
    expect(guidance.primary).toBeNull();
  });
});
