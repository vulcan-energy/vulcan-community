// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, expect, it } from 'vitest';
import epcSchema from '../../../../../../data/schemas/hem_epc_orchestrator_input.schema.json';
import { canonicalGeometrySchemaPort } from '../../../lib/geometrySchemaPort';
import { __setSchemaObjectForTests } from '../../../lib/schemaCache';
import type { GeometrySchemaPort, TargetRules } from '../../../../../geometry-editor-host/src/schemaPort';
import type { Element } from '../../types';
import { validateElementCore } from '../validateElement';

afterEach(() => __setSchemaObjectForTests(null as never));

// The HEM:EPC schema requires inputs the converter builds from others; no panel asks for them.
function fieldsAskedFor(element: Partial<Element>, rules: Partial<TargetRules> = {}): string[] {
  __setSchemaObjectForTests(epcSchema as never);
  const port: GeometrySchemaPort = { ...canonicalGeometrySchemaPort, targetSchemaMode: () => 'core', targetRules: () => rules };
  const el = { id: 'x', name: 'x', zoneId: 'z', ...element } as Element;
  return validateElementCore(el, { schemaPort: port, elementsById: { x: el } }).issues.map((issue) => issue.fieldKey ?? '');
}

it('asks a window for no shading or part list: drawn shading, categories and its openings give them', () => {
  const fields = fieldsAskedFor({
    type: 'BuildingElementTransparent', width: 1, height: 1, base_height: 1, pitch: 90, orientation360: 0, frame_area_fraction: 0.1,
    free_area_height: 0.9, mid_height: 1.5, max_window_open_area: 0.8, coordinates: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    extra_json: { g_value: 0.7, u_value: 1.2, security_risk: false },
  } as Partial<Element>);
  expect(fields).not.toContain('shading');
  expect(fields).not.toContain('window_part_list');
});

it('asks a hot water outlet for none of the outlet sections', () => {
  expect(fieldsAskedFor({ type: 'HotWaterDemand', subcategory: 'OtherWaterUseDetails', flowrate: 6 } as Partial<Element>)).toEqual([]);
});

it('asks a light for its count, power and efficacy, not the bulbs list they make', () => {
  expect(fieldsAskedFor({ type: 'Lighting', efficacy: 80, count: 1, power: 10 } as Partial<Element>)).not.toContain('bulbs');
});

it('leaves PV peak power to a target that works it out, and asks for it otherwise', () => {
  const pv = { type: 'OnSiteGeneration', generation_type: 'PhotovoltaicSystem', pitch: 35, orientation360: 180, base_height: 5, width: 4, height: 2 } as Partial<Element>;
  expect(fieldsAskedFor(pv, { optionalFields: { OnSiteGeneration: ['peak_power'] } })).not.toContain('peak_power');
  expect(fieldsAskedFor(pv)).toContain('peak_power');
});
