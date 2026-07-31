// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { validateSpaceLabels } from '../validateSpaceLabels';
import type { SpaceLabel, Zone } from '../../types';

describe('validateSpaceLabels', () => {
  const zones: Zone[] = [
    {
      id: 'z1',
      name: 'Main',
      floorArea: 50,
      height: 2.4,
      volume: 120,
      simplifiedThermalBridging: false,
    },
  ];

  it('warns when room_type is empty', () => {
    const sl: SpaceLabel = {
      id: 's1',
      name: 'Unassigned',
      zoneId: 'z1',
      storey: 0,
      room_type: '',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
    };
    const r = validateSpaceLabels({ s1: sl }, ['s1'], { zones });
    expect(r.hasWarnings).toBe(true);
    expect(r.warnings.some((w) => w.message.includes('room type'))).toBe(true);
  });

  it('warns on unknown room_type slug', () => {
    const sl: SpaceLabel = {
      id: 's1',
      name: 'Odd',
      zoneId: 'z1',
      storey: 0,
      room_type: 'custom_xyz_unknown',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 2, z: 0 },
      ],
    };
    const r = validateSpaceLabels({ s1: sl }, ['s1'], { zones });
    expect(r.warnings.some((w) => w.message.includes('unknown room_type'))).toBe(true);
  });

  it('warns when an open-to-living space is not adjacent to a living room', () => {
    const living: SpaceLabel = {
      id: 'living',
      name: 'Living',
      zoneId: 'z1',
      storey: 0,
      room_type: 'living_room',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 4, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
    };
    const kitchen: SpaceLabel = {
      id: 'kitchen',
      name: 'Kitchen',
      zoneId: 'z1',
      storey: 0,
      room_type: 'kitchen',
      coordinates: [
        { x: 8, y: 0, z: 0 },
        { x: 12, y: 0, z: 0 },
        { x: 12, y: 4, z: 0 },
        { x: 8, y: 4, z: 0 },
      ],
      extra_json: { open_to_living_room: true },
    };

    const r = validateSpaceLabels({ living, kitchen }, ['living', 'kitchen'], { zones });
    const warning = r.warnings.find((w) => w.message.includes('not adjacent to a living room'));

    expect(warning).toBeDefined();
    expect(warning?.spaceLabelId).toBe('kitchen');
  });

  it('warns when an open-to-living space shares an edge with a living room on another storey', () => {
    const living: SpaceLabel = {
      id: 'living',
      name: 'Living',
      zoneId: 'z1',
      storey: 0,
      room_type: 'living_room',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 4, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
    };
    const kitchen: SpaceLabel = {
      id: 'kitchen',
      name: 'Kitchen',
      zoneId: 'z1',
      storey: 1,
      room_type: 'kitchen',
      coordinates: [
        { x: 0, y: 0, z: 1 },
        { x: 4, y: 0, z: 1 },
        { x: 4, y: 4, z: 1 },
        { x: 0, y: 4, z: 1 },
      ],
      extra_json: { open_to_living_room: true },
    };

    const r = validateSpaceLabels({ living, kitchen }, ['living', 'kitchen'], { zones });

    expect(r.warnings.some((w) => w.message.includes('not adjacent to a living room'))).toBe(true);
  });

  it('does not warn when an open-to-living space shares an edge with a living room', () => {
    const living: SpaceLabel = {
      id: 'living',
      name: 'Living',
      zoneId: 'z1',
      storey: 0,
      room_type: 'living_room',
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 4, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
    };
    const kitchen: SpaceLabel = {
      id: 'kitchen',
      name: 'Kitchen',
      zoneId: 'z1',
      storey: 0,
      room_type: 'kitchen',
      coordinates: [
        { x: 4, y: 0, z: 0 },
        { x: 8, y: 0, z: 0 },
        { x: 8, y: 4, z: 0 },
        { x: 4, y: 4, z: 0 },
      ],
      extra_json: { open_to_living_room: true },
    };

    const r = validateSpaceLabels({ living, kitchen }, ['living', 'kitchen'], { zones });

    expect(r.warnings.some((w) => w.message.includes('not adjacent to a living room'))).toBe(false);
  });
});
