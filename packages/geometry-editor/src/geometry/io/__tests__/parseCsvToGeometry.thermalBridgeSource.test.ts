// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementOpaque, ThermalBridgeLinear } from '../../types';
import { findLinearThermalBridgeIssues } from '../../thermalBridge/findLinearThermalBridgeIssues';
import { parseCsvToGeometry } from '../parseCsvToGeometry';

describe('parseCsvToGeometry thermal bridge source links', () => {
  it('rebinds stale E16 wall-link ids from corner geometry without parent_element', () => {
    const csv = `
Metadata,,,,,,,,,,,,,
GlobalOrientationOffset,0.0,,,,,,,,,,,,,

Zone,,,,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Exposed Elements,,,,,,,,,,,,,,
Name,Zone,Type,area,pitch,width,height,orientation360,base_height,is_unheated_pitched_roof,is_external_door,parent_element,coords,extra_json
South Wall,Living,BuildingElementOpaque,9.6,90,4,2.4,180,0,FALSE,FALSE,,"0,0,0|4,0,0","{}"
East Wall,Living,BuildingElementOpaque,9.6,90,4,2.4,90,0,FALSE,FALSE,,"4,0,0|4,4,0","{}"
North Wall,Living,BuildingElementOpaque,9.6,90,4,2.4,0,0,FALSE,FALSE,,"4,4,0|0,4,0","{}"
West Wall,Living,BuildingElementOpaque,9.6,90,4,2.4,270,0,FALSE,FALSE,,"0,4,0|0,0,0","{}"

Thermal Bridging Elements,,,,,,,,,
Name,Zone,Type,heat_transfer_coeff,length,linear_thermal_transmittance,parent_element,coords,extra_json
Corner,Living,ThermalBridgeLinear,,2.4,0.05,,"0,0,0|0,0,2.4","{""junction_type"":""E16"",""thermal_bridge_source"":{""host_wall_id"":""old-wall-a"",""host_wall_b_id"":""old-wall-b"",""note"":""keep""}}"
`.trim();

    const { elements } = parseCsvToGeometry(csv);
    const south = elements.find((e) => e.name === 'South Wall') as BuildingElementOpaque;
    const west = elements.find((e) => e.name === 'West Wall') as BuildingElementOpaque;
    const corner = elements.find((e) => e.name === 'Corner') as ThermalBridgeLinear;

    const source = corner.extra_json?.thermal_bridge_source as Record<string, unknown>;
    expect(new Set([source.host_wall_id, source.host_wall_b_id])).toEqual(new Set([south.id, west.id]));
    expect(source.note).toBe('keep');
    expect(
      findLinearThermalBridgeIssues(elements).some((issue) => issue.kind === 'orphan_e16e17_incomplete_walls'),
    ).toBe(false);
  });
});
