// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR } from '../../../lib/overrideProvenance';
import { parseCSVLine } from '../../../lib/csvPresetUtils';
import { createGeometryStore } from '../../../stores/geometryStore';
import type { BuildingElementGround, Zone } from '../../types';
import { parseCsvToGeometry } from '../parseCsvToGeometry';

const header = 'Name,Zone,Type,area,total_area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,base_height,parent_element,coords,extra_json';

describe('parseCsvToGeometry ground total_area ownership', () => {
  it('exports an empty total_area for automatic rows and a value plus marker for manual rows', () => {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const zone: Zone = { id: 'z1', name: 'Living', volume: 100, floorArea: 40 } as Zone;
    const makeGround = (id: string, name: string, area: number): BuildingElementGround => ({
      id,
      name,
      zoneId: zone.id,
      type: 'BuildingElementGround',
      area,
      total_area: area,
      width: 5,
      height: 4,
      perimeter: 18,
      floor_type: 'Slab_no_edge_insulation',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
        { x: 5, y: 4, z: 0 },
        { x: 0, y: 4, z: 0 },
      ],
    });
    const automatic = makeGround('g1', 'automatic ground', 20);
    const manual = {
      ...makeGround('g2', 'manual ground', 20),
      total_area: 45,
      [GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR.flag]: true,
    };
    store.setState({
      zones: [zone],
      elementsById: { g1: automatic, g2: manual },
      elementIds: ['g1', 'g2'],
    });

    const lines = store.getState().generateCSV().split('\n');
    const headerColumns = parseCSVLine(lines.find((line) => line.startsWith('Name,Zone,Type,area,total_area,'))!);
    const totalAreaIndex = headerColumns.indexOf('total_area');
    const automaticColumns = parseCSVLine(lines.find((line) => line.startsWith('automatic ground,'))!);
    const manualColumns = parseCSVLine(lines.find((line) => line.startsWith('manual ground,'))!);

    expect(automaticColumns[totalAreaIndex]).toBe('');
    expect(manualColumns[totalAreaIndex]).toBe('45');
    expect(manualColumns.at(-1)).toContain(GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR.key);
  });

  it('keeps separate one-zone objects at their own areas', () => {
    const parsed = parseCsvToGeometry(`Metadata,,,,,,,,,,,,,,
ProvenanceMarkers,2,,,,,,,,,,,,,

Zone
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,100,42,2.4,FALSE

Ground Elements
${header}
ground a,Living,BuildingElementGround,20,,5,4,18,Slab_no_edge_insulation,,,,,"0,0,0|5,0,0|5,4,0|0,4,0",{}
ground b,Living,BuildingElementGround,22,,5.5,4,19,Slab_no_edge_insulation,,,,,"6,0,0|11.5,0,0|11.5,4,0|6,4,0",{}
`);

    const grounds = parsed.elements.filter((element) => element.type === 'BuildingElementGround');
    expect(grounds.map((ground) => ground.total_area)).toEqual([20, 22]);
    expect(grounds.every((ground) => ground[GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR.flag] === false)).toBe(true);
  });

  it('aggregates same-storey fragments across zones and preserves a marked manual value', () => {
    const parsed = parseCsvToGeometry(`Metadata,,,,,,,,,,,,,,
ProvenanceMarkers,2,,,,,,,,,,,,,

Zone
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,50,20,2.4,FALSE
Kitchen,Zone,50,22,2.4,FALSE

Ground Elements
${header}
living ground,Living,BuildingElementGround,20,,5,4,18,Slab_no_edge_insulation,,,,,"0,0,0|5,0,0|5,4,0|0,4,0",{}
kitchen ground,Kitchen,BuildingElementGround,22,45,5.5,4,19,Slab_no_edge_insulation,,,,,"5,0,0|10.5,0,0|10.5,4,0|5,4,0","{""_ground_total_area_manual"":true}"
`);

    const grounds = parsed.elements.filter((element) => element.type === 'BuildingElementGround');
    expect(grounds[0]?.total_area).toBe(42);
    expect(grounds[0]?.[GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR.flag]).toBe(false);
    expect(grounds[1]?.total_area).toBe(45);
    expect(grounds[1]?.[GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR.flag]).toBe(true);
  });

  it('migrates legacy multi-zone CSVs without a total_area column to the aggregate', () => {
    const parsed = parseCsvToGeometry(`Zone
Name,Type,volume,floor_area,height,simplified thermal bridging
Living,Zone,50,20,2.4,FALSE
Kitchen,Zone,50,22,2.4,FALSE

Ground Elements
Name,Zone,Type,area,width,height,perimeter,floor_type,depth_basement_floor,thickness_walls,base_height,parent_element,coords,extra_json
living ground,Living,BuildingElementGround,20,5,4,18,Slab_no_edge_insulation,,,,,"0,0,0|5,0,0|5,4,0|0,4,0",{}
kitchen ground,Kitchen,BuildingElementGround,22,5.5,4,19,Slab_no_edge_insulation,,,,,"5,0,0|10.5,0,0|10.5,4,0|5,4,0",{}
`);

    const grounds = parsed.elements.filter((element) => element.type === 'BuildingElementGround');
    expect(grounds.map((ground) => ground.total_area)).toEqual([42, 42]);
    expect(grounds.every((ground) => ground[GROUND_TOTAL_AREA_OVERRIDE_DESCRIPTOR.flag] === false)).toBe(true);
  });
});
