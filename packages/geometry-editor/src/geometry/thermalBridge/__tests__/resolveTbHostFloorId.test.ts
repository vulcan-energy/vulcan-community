// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  findHostElementForAutoTbProposal,
  knownHostElementIdsForAutoTbProposal,
  resolveFloorStoreyIndexForAutoTbFromHostZ,
  resolveHostFloorIdForTbProposal,
  storeyZIndexFromHostElementFirstZ,
  thermalBridgeSourceExtraJsonForAutoProposal,
} from '../resolveTbHostFloorId';
import type { Element } from '../../types';

describe('resolveHostFloorIdForTbProposal', () => {
  it('returns opening element floorId for real opening ids', () => {
    const elementsById: Record<string, Element> = {
      win1: {
        id: 'win1',
        type: 'BuildingElementTransparent',
        floorId: 'fl-a',
      } as Element,
    };
    expect(
      resolveHostFloorIdForTbProposal({ openingId: 'win1', zoneId: 'z1' }, elementsById),
    ).toBe('fl-a');
  });

  it('parses wgcont / wicont synthetic ids to the host wall', () => {
    const elementsById: Record<string, Element> = {
      wall99: {
        id: 'wall99',
        type: 'BuildingElementOpaque',
        floorId: 'ground-floor-id',
      } as Element,
    };
    expect(
      resolveHostFloorIdForTbProposal({ openingId: 'wgcont:wall99:0', zoneId: 'z' }, elementsById),
    ).toBe('ground-floor-id');
    expect(
      resolveHostFloorIdForTbProposal({ openingId: 'wicont:wall99:1', zoneId: 'z' }, elementsById),
    ).toBe('ground-floor-id');
  });

  it('resolves corner proposals via parent wall name in zone', () => {
    const elementsById: Record<string, Element> = {
      w1: {
        id: 'w1',
        type: 'BuildingElementOpaque',
        name: 'North wall',
        zoneId: 'zone-a',
        floorId: 'f-upper',
      } as Element,
    };
    expect(
      resolveHostFloorIdForTbProposal(
        {
          openingId: 'corner:vertex-key',
          zoneId: 'zone-a',
          parentElementForTb: 'North wall',
        },
        elementsById,
      ),
    ).toBe('f-upper');
  });
});

describe('storeyZIndexFromHostElementFirstZ (tb_test_2 style)', () => {
  it('0.000 m → 0, 1.000 m → 1, 2.000 m → 2', () => {
    const w = {
      coordinates: [{ x: 0, y: 0, z: 0 }],
    } as Element;
    const lowRoof = {
      coordinates: [{ x: 0, y: 0, z: 1.0 }],
    } as Element;
    const upRoof = {
      coordinates: [{ x: 0, y: 0, z: 2.0 }],
    } as Element;
    expect(storeyZIndexFromHostElementFirstZ(w)).toBe(0);
    expect(storeyZIndexFromHostElementFirstZ(lowRoof)).toBe(1);
    expect(storeyZIndexFromHostElementFirstZ(upRoof)).toBe(2);
  });
});

describe('resolveFloorStoreyIndexForAutoTbFromHostZ', () => {
  it('uses host first z (storey index), not the κ line height', () => {
    const floors = [
      { id: 'g', zIndex: 0 },
      { id: 'first', zIndex: 1 },
    ];
    const row = {
      openingId: 'roofLo',
      zoneId: 'z1',
      parentElementForTb: 'Pitched Roof (S)',
    };
    const elementsById: Record<string, Element> = {
      roofLo: {
        id: 'roofLo',
        name: 'Pitched Roof (S)',
        type: 'BuildingElementOpaque',
        zoneId: 'z1',
        floorId: 'g',
        coordinates: [
          { x: 0, y: 0, z: 1.0 },
          { x: 1, y: 0, z: 1.0 },
        ],
      } as Element,
    };
    expect(resolveFloorStoreyIndexForAutoTbFromHostZ(row, elementsById, floors)).toBe(1);
  });

  it('maps legacy host floorId string to storey via floors list when host has no coords', () => {
    const floors = [{ id: 'host-only', zIndex: 1 }];
    const elementsById: Record<string, Element> = {
      w1: { id: 'w1', type: 'BuildingElementOpaque', floorId: 'host-only' } as Element,
    };
    expect(resolveFloorStoreyIndexForAutoTbFromHostZ({ openingId: 'w1' }, elementsById, floors)).toBe(1);
  });

  it('resolves by parent name in zone (tb_test_2 unheated walls: first z = 1)', () => {
    const floors = [
      { id: 'g', zIndex: 0 },
      { id: 'f1', zIndex: 1 },
    ];
    const unheated: Element = {
      id: 'u1',
      type: 'BuildingElementAdjacentUnconditionedSpace_Simple',
      name: 'Unheated Wall (S)',
      zoneId: 'Z',
      coordinates: [
        { x: 0, y: 0, z: 1.0 },
        { x: 1, y: 0, z: 1.0 },
      ],
    } as Element;
    const elementsById: Record<string, Element> = { u1: unheated };
    expect(
      resolveFloorStoreyIndexForAutoTbFromHostZ(
        { openingId: 'x', zoneId: 'Z', parentElementForTb: 'Unheated Wall (S)' },
        elementsById,
        floors,
      ),
    ).toBe(1);
  });
});

describe('findHostElementForAutoTbProposal', () => {
  it('returns opening element when no parent name', () => {
    const o = { id: 'o1', name: 'Pitched Roof (S)', zoneId: 'Z' } as Element;
    expect(findHostElementForAutoTbProposal({ openingId: 'o1' }, { o1: o })).toBe(o);
  });
});

describe('auto-TB source host identity', () => {
  it('persists generic host ids in the legacy thermal_bridge_source keys', () => {
    const source = thermalBridgeSourceExtraJsonForAutoProposal(
      {
        openingId: 'p4:roof-party',
        hostElementIds: ['roof-1', 'party-wall-1'],
      },
      {},
    );
    expect(source).toEqual({ host_wall_id: 'roof-1', host_wall_b_id: 'party-wall-1' });
  });

  it('extracts known proposal host ids from all source fields', () => {
    const ids = knownHostElementIdsForAutoTbProposal(
      {
        openingId: 'window-1',
        hostElementIds: ['roof-1', 'party-wall-1'],
        roofAdjacentPairIds: ['roof-2', 'adjacent-1'],
        cornerHostWallIds: ['wall-a', 'wall-b'],
      },
      { 'window-1': { id: 'window-1', type: 'BuildingElementTransparent' } as Element },
    );
    expect([...ids].sort()).toEqual([
      'adjacent-1',
      'party-wall-1',
      'roof-1',
      'roof-2',
      'wall-a',
      'wall-b',
      'window-1',
    ]);
  });
});
