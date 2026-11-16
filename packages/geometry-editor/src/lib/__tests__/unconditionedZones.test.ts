// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, expect, it } from 'vitest';
import epcSchema from '../../../../../data/schemas/hem_epc_orchestrator_input.schema.json';
import { canonicalGeometrySchemaPort } from '../geometrySchemaPort';
import { __setSchemaObjectForTests, resolveElementSubschemaForProfile } from '../schemaCache';
import type { GeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import type { Element } from '../../geometry/types';
import { validateElementCore } from '../../geometry/validation/validateElement';
import { createGeometryStore } from '../../stores/geometryStore';

afterEach(() => __setSchemaObjectForTests(null as never));

const garage = (zone: Record<string, unknown>) => ({
  id: 'garage', name: 'Garage', type: 'System', subcategory: 'ZoneUnconditioned', zoneId: 'z',
  coordinates: [{ x: 0, y: 0, z: 0 }], extra_json: { ZoneUnconditioned: { Garage: zone } },
}) as unknown as Element;
const wall = (extra: Record<string, unknown>) => ({
  id: 'wall', name: 'Garage wall', type: 'BuildingElementAdjacentUnconditionedSpace_Simple', zoneId: 'z',
  width: 4, height: 2.4, area: 9.6, pitch: 90, parent_element: null, coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
  extra_json: { u_value: 0.3, areal_heat_capacity: 'Medium', mass_distribution_class: 'I: Mass concentrated at internal side', ...extra },
}) as unknown as Element;

function issues(element: Element, others: Element[] = []): string[] {
  __setSchemaObjectForTests(epcSchema as never);
  const port: GeometrySchemaPort = { ...canonicalGeometrySchemaPort, targetSchemaMode: () => 'core' };
  const elementsById = Object.fromEntries([element, ...others].map((e) => [e.id, e]));
  return validateElementCore(element, { schemaPort: port, elementsById }).issues.map((issue) => `${issue.fieldKey}: ${issue.message}`);
}

it('takes the zone element form for an element next to a zone: the zone it names, no resistance', () => {
  const schema = resolveElementSubschemaForProfile(epcSchema, 'core', 'BuildingElementAdjacentUnconditionedSpace_Simple', 'ZoneUnconditioned')!;
  expect(schema.required).toContain('ZoneUnconditioned');
  expect(schema.properties).not.toHaveProperty('thermal_resistance_unconditioned_space');
});

it('asks an element next to a zone for no resistance, and names a zone the model lacks', () => {
  const calculated = garage({ method: 'Calculated', building_element: { Door: { type: 'BuildingElementZoneUnconditionedOpaque', area: 5, u_value: 2 } } });
  expect(issues(wall({ ZoneUnconditioned: 'Garage' }), [calculated])).toEqual([]);
  expect(issues(wall({ ZoneUnconditioned: 'Porch' }), [calculated])).toEqual([
    "ZoneUnconditioned: Garage wall (BuildingElementAdjacentUnconditionedSpace_Simple): Next to unconditioned zone 'Porch', which the model does not have. Choose a zone or add one.",
  ]);
  expect(issues(wall({}))).toEqual([expect.stringMatching(/^thermal_resistance_unconditioned_space: /)]);
});

it('names the zone and the fix for a Direct zone, an empty envelope and a missing envelope input', () => {
  expect(issues(garage({ method: 'Direct', factor_adjustment_unconditioned_zone: 0.5 }))).toEqual([
    "extra_json: Garage (System): HEM:EPC rejects the Direct method at present. Choose Calculated and add the zone's envelope.",
  ]);
  expect(issues(garage({ method: 'Calculated' }))).toEqual([
    "extra_json: Garage (System): Add the zone's outside walls, roof and windows.",
  ]);
  expect(issues(garage({ method: 'Calculated', building_element: {
    Door: { type: 'BuildingElementZoneUnconditionedOpaque', area: 5 },
    Window: { type: 'BuildingElementZoneUnconditionedTransparent', area: 1, u_value: 1.4, pitch: 90, orientation360: 180, base_height: 1, height: 1, g_value: 0.6, frame_area_fraction: 0.2 },
  } }))).toEqual([
    "extra_json: Garage (System): Enter the U-Value of 'Door'. Enter the Width of 'Window'.",
  ]);
});

it('keeps an element next to a zone, and the zone, through save and load', () => {
  const csv = `
Metadata,,,,,,,,,,
VulcanCsvVersion,3,,,,,,,,,

Zone,,,,,,,,,,
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,60,25,2.4,FALSE

Non-Exposed Elements
Name,Zone,Type,area,pitch,width,height,parent_element,extra_json
Garage wall,Living,BuildingElementAdjacentUnconditionedZone,9.6,90,4,2.4,,"{""ZoneUnconditioned"":""Garage"",""u_value"":0.3}"

Systems
Name,Zone,Type,subcategory,system_preset,base_height,coords,extra_json
Garage,Living,System,ZoneUnconditioned,,,"1,1,0","{""ZoneUnconditioned"":{""Garage"":{""method"":""Calculated""}}}"
`.trim();
  const store = createGeometryStore();
  store.getState().loadFromCSV(csv);
  const loaded = Object.values(store.getState().elementsById).find((e) => e.name === 'Garage wall')!;
  expect(loaded).toMatchObject({ type: 'BuildingElementAdjacentUnconditionedSpace_Simple', extra_json: { ZoneUnconditioned: 'Garage' } });
  const saved = store.getState().generateCSV();
  expect(saved).toMatch(/Garage wall,Living,BuildingElementAdjacentUnconditionedZone,/);
  expect(saved).toMatch(/Garage,Living,System,ZoneUnconditioned,/);
});

it('names a missing shading input, and a window area width and height cannot give', () => {
  const window = { type: 'BuildingElementZoneUnconditionedTransparent', u_value: 1.4, pitch: 90, orientation360: 180, base_height: 1, height: 1, g_value: 0.6, frame_area_fraction: 0.2 };
  expect(issues(garage({ method: 'Calculated', building_element: { Window: window } }))).toEqual([
    "extra_json: Garage (System): Enter the Area of 'Window'. Enter the Width of 'Window'.",
  ]);
  expect(issues(garage({ method: 'Calculated', building_element: {
    Window: { ...window, width: 1, area: 1, shading: [{ type: 'overhang', depth: 0.5 }, { type: 'obstacle', distance: 3, height: 2 }] },
  } }))).toEqual([
    "extra_json: Garage (System): Enter the Distance of shading 1 on 'Window'. Enter the Transparency of shading 2 on 'Window'.",
  ]);
});

it('keys the zone by its row name: an auto-name, a rename and the linked walls follow', () => {
  const store = createGeometryStore();
  const row = { id: 'sys', name: 'System 1', type: 'System', zoneId: 'z', coordinates: [{ x: 0, y: 0, z: 0 }], _nameAutoSync: true } as unknown as Element;
  const linked = wall({ ZoneUnconditioned: 'Unconditioned zone' });
  store.setState({ elementsById: { sys: row, wall: linked }, elementIds: ['sys', 'wall'] } as never);
  store.getState().updateElement('sys', { subcategory: 'ZoneUnconditioned', extra_json: { ZoneUnconditioned: { 'System 1': { method: 'Calculated' } } } } as Partial<Element>);
  expect(store.getState().elementsById.sys).toMatchObject({ name: 'Unconditioned zone', extra_json: { ZoneUnconditioned: { 'Unconditioned zone': { method: 'Calculated' } } } });
  store.getState().updateElement('sys', { name: 'Garage' });
  expect(store.getState().elementsById.sys.extra_json).toEqual({ ZoneUnconditioned: { Garage: { method: 'Calculated' } } });
  expect(store.getState().elementsById.wall.extra_json).toMatchObject({ ZoneUnconditioned: 'Garage' });
});
