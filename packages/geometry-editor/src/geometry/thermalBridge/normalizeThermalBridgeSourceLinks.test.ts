// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementOpaque, BuildingElementPartyWall, Element, ThermalBridgeLinear } from '../types';
import { createElementNameLookup } from '../../lib/elementNameRemap';
import { normalizeThermalBridgeSourceLinks, thermalBridgeExtraJsonForCsv } from './normalizeThermalBridgeSourceLinks';

const externalWall: BuildingElementOpaque = {
  type: 'BuildingElementOpaque',
  id: 'wall-current-id',
  name: 'External wall',
  zoneId: 'z1',
  parent_element: null,
  coordinates: [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 4, z: 0 },
  ],
  width: 4,
  height: 2.4,
  area: 9.6,
  pitch: 90,
  isPlaceholder: false,
};

const partyWall: BuildingElementPartyWall = {
  type: 'BuildingElementPartyWall',
  id: 'party-current-id',
  name: 'Party wall',
  zoneId: 'z1',
  parent_element: null,
  coordinates: [
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 3, z: 0 },
  ],
  width: 2,
  height: 2.4,
  area: 4.8,
  pitch: 90,
  isPlaceholder: false,
};

describe('normalizeThermalBridgeSourceLinks', () => {
  it('rebinds stale non-corner source ids from TB geometry without parent_element', () => {
    const staleBridge: ThermalBridgeLinear = {
      type: 'ThermalBridgeLinear',
      id: 'tb-current-id',
      name: 'TB E18',
      zoneId: 'z1',
      parent_element: null,
      coordinates: [
        { x: 0, y: 2, z: 0 },
        { x: 0, y: 2, z: 2.4 },
      ],
      length: 2.4,
      linear_thermal_transmittance: 0.06,
      extra_json: {
        junction_type: 'E18',
        thermal_bridge_source: {
          host_wall_id: 'old-wall-id',
          host_wall_b_id: 'old-party-id',
          note: 'keep',
        },
      },
    };

    const normalized = normalizeThermalBridgeSourceLinks([
      externalWall,
      partyWall,
      staleBridge,
    ] as Element[]);
    const bridge = normalized.find((element): element is ThermalBridgeLinear => element.id === staleBridge.id)!;
    const source = bridge.extra_json?.thermal_bridge_source as Record<string, unknown>;

    expect(source.host_wall_id).toBe(externalWall.id);
    expect(source.host_wall_b_id).toBe(partyWall.id);
    expect(source.note).toBe('keep');
  });

  it('rebinds a stale eaves source on an Orientation-state roof using the global offset', () => {
    const roof = {
      type: 'BuildingElementOpaque',
      id: 'orientation-roof-id',
      name: 'Orientation roof',
      zoneId: 'z1',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 2 },
        { x: 4, y: 0, z: 2 },
        { x: 4, y: 3, z: 2 },
        { x: 0, y: 3, z: 2 },
      ],
      width: 4,
      height: 3,
      area: 12,
      pitch: 30,
      orientation360: 135,
      base_height: 2,
      isPlaceholder: false,
      extra_json: { _slope_pitch_axis: 'orientation' },
    } as BuildingElementOpaque;
    const bridge = {
      type: 'ThermalBridgeLinear',
      id: 'orientation-eaves-tb',
      name: 'Orientation eaves',
      zoneId: 'z1',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 2 },
        { x: 4, y: 0, z: 2 },
      ],
      length: 4,
      linear_thermal_transmittance: 0.04,
      extra_json: {
        junction_type: 'E11',
        thermal_bridge_source: { host_wall_id: 'stale-roof-id' },
      },
      isPlaceholder: false,
    } as ThermalBridgeLinear;

    const normalized = normalizeThermalBridgeSourceLinks([roof, bridge], 45);
    const source = (normalized[1] as ThermalBridgeLinear).extra_json?.thermal_bridge_source as Record<string, unknown>;
    expect(source.host_wall_id).toBe(roof.id);
  });

  it('writes hosts by name for the CSV and resolves the names back to runtime ids on load', () => {
    const bridge = {
      type: 'ThermalBridgeLinear',
      id: 'tb-current-id',
      name: 'TB E18',
      zoneId: 'z1',
      parent_element: null,
      coordinates: [{ x: 0, y: 2, z: 0 }, { x: 9, y: 9, z: 9 }],
      length: 2.4,
      linear_thermal_transmittance: 0.06,
      extra_json: {
        junction_type: 'E18',
        thermal_bridge_source: { host_wall_id: 'wall-current-id', host_wall_b_id: 'party-current-id', note: 'keep' },
        _vulcan_ui_tb_adjacent_element_id: 'party-current-id',
      },
    } as ThermalBridgeLinear;
    const elements = [externalWall, partyWall, bridge] as Element[];
    const byId = Object.fromEntries(elements.map((element) => [element.id, element]));
    const written = thermalBridgeExtraJsonForCsv(bridge.extra_json, 'z1', byId, createElementNameLookup(elements));
    expect(written).toEqual({
      junction_type: 'E18',
      thermal_bridge_source: { host_wall_name: 'External wall', host_wall_b_name: 'Party wall', note: 'keep' },
      _vulcan_ui_tb_adjacent_element_name: 'Party wall',
    });

    const reloaded = normalizeThermalBridgeSourceLinks([
      { ...externalWall, id: 'wall-new-id' },
      { ...partyWall, id: 'party-new-id' },
      { ...bridge, extra_json: written },
    ] as Element[]);
    expect((reloaded[2] as ThermalBridgeLinear).extra_json).toEqual({
      junction_type: 'E18',
      thermal_bridge_source: { host_wall_id: 'wall-new-id', host_wall_b_id: 'party-new-id', note: 'keep' },
      _vulcan_ui_tb_adjacent_element_id: 'party-new-id',
    });
  });

  it('writes the id as before when the host name is ambiguous or the host is missing', () => {
    const twin = { ...externalWall, id: 'twin-id' };
    const elements = [externalWall, twin] as Element[];
    const byId = Object.fromEntries(elements.map((element) => [element.id, element]));
    const written = thermalBridgeExtraJsonForCsv(
      { thermal_bridge_source: { host_wall_name: 'stale', host_wall_id: 'wall-current-id', host_wall_b_id: 'gone-id' } },
      'z1',
      byId,
      createElementNameLookup(elements),
    );
    expect(written?.thermal_bridge_source).toEqual({ host_wall_id: 'wall-current-id', host_wall_b_id: 'gone-id' });
  });

  it('keeps the resolved id when a record carries both a name and a stale id', () => {
    const bridge = {
      type: 'ThermalBridgeLinear',
      id: 'tb-id',
      name: 'TB',
      zoneId: 'z1',
      parent_element: null,
      coordinates: [{ x: 0, y: 2, z: 0 }, { x: 9, y: 9, z: 9 }],
      length: 2.4,
      linear_thermal_transmittance: 0.06,
      extra_json: { junction_type: 'E18', thermal_bridge_source: { host_wall_name: 'External wall', host_wall_id: 'stale-id' } },
    } as ThermalBridgeLinear;
    const [, normalized] = normalizeThermalBridgeSourceLinks([externalWall, bridge] as Element[]);
    expect((normalized as ThermalBridgeLinear).extra_json?.thermal_bridge_source).toEqual({ host_wall_id: 'wall-current-id' });
  });
});
