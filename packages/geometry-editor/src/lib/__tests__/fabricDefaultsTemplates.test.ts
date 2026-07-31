// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { applyFabricMergeTemplateUpdates, resolveFabricMergeTemplates } from '../fabricDefaultsTemplates';

const minimalDefaults = {
  Zone: {
    Main: {
      BuildingElement: {
        wall_a: {
          type: 'BuildingElementOpaque',
          pitch: 90,
          u_value: 0.18,
        },
        roof_a: {
          type: 'BuildingElementOpaque',
          pitch: 35,
          thermal_resistance_construction: 5,
        },
        door_a: {
          type: 'BuildingElementOpaque',
          is_external_door: true,
          u_value: 1.4,
        },
        floor_a: {
          type: 'BuildingElementGround',
          floor_type: 'Solid_floor',
          u_value: 0.12,
        },
        adj_c: {
          type: 'BuildingElementAdjacentConditionedSpace',
          u_value: 0.5,
        },
        adj_u: {
          type: 'BuildingElementAdjacentUnconditionedSpace_Simple',
          area: 10,
          heat_transfer_coeff: 2,
        },
        party: {
          type: 'BuildingElementPartyWall',
          thermal_resistance_construction: 3,
        },
        win: {
          type: 'BuildingElementTransparent',
          u_value: 1.2,
        },
      },
    },
  },
};

describe('fabricDefaultsTemplates', () => {
  it('resolveFabricMergeTemplates maps opaque buckets and singleton types', () => {
    const m = resolveFabricMergeTemplates(minimalDefaults);
    expect(m.get('opaque_wall')?.jsonKey).toBe('wall_a');
    expect(m.get('opaque_roof')?.jsonKey).toBe('roof_a');
    expect(m.get('opaque_external_door')?.jsonKey).toBe('door_a');
    expect(m.get('ground')?.jsonKey).toBe('floor_a');
    expect(m.get('adjacent_conditioned')?.jsonKey).toBe('adj_c');
    expect(m.get('adjacent_unconditioned')?.jsonKey).toBe('adj_u');
    expect(m.get('party_wall')?.jsonKey).toBe('party');
    expect(m.get('transparent')?.jsonKey).toBe('win');
  });

  it('applyFabricMergeTemplateUpdates merges patches and deletes undefined keys', () => {
    const resolved = resolveFabricMergeTemplates(minimalDefaults);
    const updates: Partial<Record<FabricMergeRole, Record<string, unknown>>> = {
      opaque_wall: { u_value: 0.22, pitch: undefined },
      ground: { u_value: 0.09 },
    };
    const out = applyFabricMergeTemplateUpdates(minimalDefaults, resolved, updates) as typeof minimalDefaults;
    const wall = out.Zone.Main.BuildingElement.wall_a;
    expect(wall.u_value).toBe(0.22);
    expect('pitch' in wall).toBe(false);
    expect(out.Zone.Main.BuildingElement.floor_a.u_value).toBe(0.09);
  });

  it('last duplicate type wins for singleton roles', () => {
    const dup = {
      Zone: {
        Z1: {
          BuildingElement: {
            g1: { type: 'BuildingElementGround', floor_type: 'Solid_floor', u_value: 0.1 },
          },
        },
        Z2: {
          BuildingElement: {
            g2: { type: 'BuildingElementGround', floor_type: 'Suspended_floor', u_value: 0.2 },
          },
        },
      },
    };
    const m = resolveFabricMergeTemplates(dup);
    expect(m.get('ground')?.jsonKey).toBe('g2');
    expect(m.get('ground')?.template.u_value).toBe(0.2);
  });
});
