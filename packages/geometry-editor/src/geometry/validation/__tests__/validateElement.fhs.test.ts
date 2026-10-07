// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { unavailableGeometrySchemaPort } from '../../../../../geometry-editor-host/src/schemaPort';
import type {
  Appliance,
  BuildingElementOpaque,
  BuildingElementTransparent,
  Element,
  Floor,
  MechanicalVentilation,
  MechanicalVentilationTerminal,
} from '../../types';
import {
  collectGeometryValidation,
  validateElementCore,
} from '../validateElement';

function window(baseHeight: number): BuildingElementTransparent {
  return {
    id: 'window-1',
    name: 'Window',
    zoneId: 'zone-1',
    floorId: 'floor-0',
    type: 'BuildingElementTransparent',
    width: 1,
    height: 1,
    area: 1,
    pitch: 90,
    base_height: baseHeight,
    frame_area_fraction: 0.2,
    free_area_height: 0.5,
    mid_height: baseHeight + 0.5,
    max_window_open_area: 0.5,
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    isPlaceholder: false,
  };
}

const floors: Floor[] = [
  { id: 'floor-0', name: 'Ground', zIndex: 0, height: 2.4, isRoofSpace: false },
  { id: 'floor-1', name: 'First', zIndex: 1, height: 2.4, isRoofSpace: false },
];

function baseContext(element: Element) {
  return {
    schemaPort: unavailableGeometrySchemaPort,
    elementsById: { [element.id]: element },
    complianceValidationEnabled: true,
  };
}

function refrigerationAppliance(): Appliance {
  return {
    id: 'fridge',
    name: 'Fridge',
    type: 'Appliance',
    appliancekey: 'Fridge',
    parent_element: null,
    coordinates: [{ x: 0, y: 0, z: 0 }],
    isPlaceholder: false,
  };
}

function mvhrUnit(id = 'mvhr-1', name = 'MVHR 1'): MechanicalVentilation {
  return {
    id,
    name,
    type: 'MechanicalVentilation',
    vent_type: 'MVHR',
    parent_element: null,
    coordinates: [{ x: 0, y: 0, z: 0 }],
    isPlaceholder: false,
  } as MechanicalVentilation;
}

function terminalHost(id: string, name: string, zoneId: string): BuildingElementOpaque {
  return {
    id,
    name,
    zoneId,
    type: 'BuildingElementOpaque',
    is_external_door: false,
    coordinates: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
    parent_element: null,
    isPlaceholder: false,
  } as BuildingElementOpaque;
}

function hostedTerminal(hostName: string, parentName = 'MVHR 1'): MechanicalVentilationTerminal {
  return {
    id: 'terminal-1',
    name: 'Intake terminal',
    type: 'MechanicalVentilationTerminal',
    terminal_type: 'intake',
    parent_element: parentName,
    host_element: hostName,
    coordinates: [{ x: 1, y: 0, z: 1 }],
    isPlaceholder: false,
  } as MechanicalVentilationTerminal;
}

function validationContext(elements: Element[]) {
  return {
    schemaPort: unavailableGeometrySchemaPort,
    elementsById: Object.fromEntries(elements.map((element) => [element.id, element])),
    complianceValidationEnabled: false,
  };
}

describe('FHS window base-height validation', () => {
  it('emits a critical FHS issue when a window is below an explicit ventilation zone base', () => {
    const element = window(0.5);

    const result = validateElementCore(element, {
      ...baseContext(element),
      complianceSettings: {
        Ventilation_ventilation_zone_base_height: 1,
      },
    });

    expect(result.issues).toContainEqual(expect.objectContaining({
      source: 'fhs',
      fieldKey: 'base_height',
      message: expect.stringContaining(
        'Window base height (0.50 m) is below the ventilation zone base height (1 m).',
      ),
    }));
  });

  it.each([1, 1.2])('does not emit the issue when the window is at or above %s m', (baseHeight) => {
    const element = window(baseHeight);

    const result = validateElementCore(element, {
      ...baseContext(element),
      complianceSettings: {
        Ventilation_ventilation_zone_base_height: 1,
      },
    });

    expect(
      result.issues.some((issue) => issue.message.includes('ventilation zone base height')),
    ).toBe(false);
  });

  it('uses the derived ventilation zone base height when no override is authored', () => {
    const element = window(2.3);

    const result = validateElementCore(element, {
      ...baseContext(element),
      floors,
      complianceSettings: {
        build_type: 'flat',
        storeys_in_dwelling: 1,
        storey_of_dwelling: 2,
      },
    });

    expect(result.issues).toContainEqual(expect.objectContaining({
      source: 'fhs',
      message: expect.stringContaining(
        'Window base height (2.30 m) is below the ventilation zone base height (2.40 m).',
      ),
    }));
  });

  it('does not guess when the derived ventilation zone base height is unresolvable', () => {
    const element = window(0);

    const result = validateElementCore(element, {
      ...baseContext(element),
      complianceSettings: {
        build_type: 'flat',
        storeys_in_dwelling: 1,
        storey_of_dwelling: 2,
      },
    });

    expect(
      result.issues.some((issue) => issue.message.includes('ventilation zone base height')),
    ).toBe(false);
  });
});

describe('name-scoped hosted validation', () => {
  it('resolves a unique MVHR unit and wall when an unrelated global name collides', () => {
    const terminal = hostedTerminal('Wall A', 'Shared name');
    const wall = terminalHost('wall-a', 'Wall A', 'zone-a');
    const sameNamedWall = terminalHost('shared-wall', 'Shared name', 'zone-a');
    const unrelatedGlobal = {
      id: 'global-wall-a',
      name: 'Wall A',
      type: 'System',
      parent_element: null,
      coordinates: [{ x: 0, y: 0, z: 0 }],
    } as unknown as Element;
    const result = validateElementCore(terminal, validationContext([
      terminal,
      mvhrUnit('mvhr-1', 'Shared name'),
      wall,
      sameNamedWall,
      unrelatedGlobal,
    ]));

    expect(result.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'MVHR unit reference is ambiguous' }),
      expect.objectContaining({ message: 'Mounted host reference is ambiguous' }),
      expect.objectContaining({ message: 'Mounted host not found' }),
    ]));
    expect(result.issues.some((issue) => issue.message.includes('must resolve from the mounted host'))).toBe(false);
  });

  it('reports an ambiguous host when two eligible walls share the referenced name', () => {
    const terminal = hostedTerminal('Wall A');
    const result = validateElementCore(terminal, validationContext([
      terminal,
      mvhrUnit(),
      terminalHost('wall-a', 'Wall A', 'zone-a'),
      terminalHost('wall-b', 'Wall A', 'zone-b'),
    ]));

    expect(result.issues).toContainEqual(expect.objectContaining({
      message: expect.stringContaining('Mounted host reference is ambiguous'),
      fieldKey: 'host_element',
    }));
  });
});

describe('collectGeometryValidation Part F coverage', () => {
  it('reports that Part F sufficiency was not checked when room counts are unavailable', () => {
    const result = collectGeometryValidation([], [refrigerationAppliance()], {
      schemaPort: unavailableGeometrySchemaPort,
      complianceValidationEnabled: true,
    });

    expect(result.warnings).toContain(
      'Part F ventilation sufficiency was not checked (dwelling room counts missing).',
    );
  });

  it('does not report a skipped check when a complete Part F context is supplied', () => {
    const result = collectGeometryValidation([], [refrigerationAppliance()], {
      schemaPort: unavailableGeometrySchemaPort,
      complianceValidationEnabled: true,
      partFContext: {
        spaceLabels: [],
        totalFloorAreaM2: 100,
        bedrooms: 2,
        habitableRooms: 3,
        wetRooms: 1,
        bathrooms: 1,
        utilityRooms: 0,
        sanitaryAccommodations: 0,
        storeys: 1,
        isKitchenVentExternal: true,
      },
    });

    expect(result.warnings).not.toContain(
      'Part F ventilation sufficiency was not checked (dwelling room counts missing).',
    );
  });
});

describe('exhaust-air heat pump ventilation compatibility', () => {
  const heatPump = (sourceType = 'ExhaustAirMEV'): Element => ({
    id: 'eahp', name: 'Exhaust-air heat pump', type: 'System', subcategory: 'HeatSourceWet',
    parent_element: null, coordinates: [{ x: 0, y: 0, z: 0 }], isPlaceholder: false,
    extra_json: { HeatSourceWet: { eahp: { type: 'HeatPump', source_type: sourceType } } },
  });
  const ventilation = (ventType: string, wrapped: boolean): Element => wrapped ? {
    id: `vent-${ventType}`, name: 'Ventilation', type: 'System', subcategory: 'InfiltrationVentilation',
    parent_element: null, coordinates: [{ x: 0, y: 0, z: 0 }], isPlaceholder: false,
    extra_json: { InfiltrationVentilation: { MechanicalVentilation: { mev: { vent_type: ventType } } } },
  } : { ...mvhrUnit(`vent-${ventType}`), vent_type: ventType } as MechanicalVentilation;
  const exhaustIssues = (plant: Element, vents: Element[], fhs = false) => validateElementCore(plant, {
    ...validationContext([plant, ...vents]), complianceValidationEnabled: fhs,
  }).issues.filter((issue) => issue.message.includes('Exhaust-air heat pumps'));

  it.each(['ExhaustAirMEV', 'ExhaustAirMVHR', 'ExhaustAirMixed'])('%s requires ventilation in core and FHS', (sourceType) => {
    for (const fhs of [false, true]) {
      expect(exhaustIssues(heatPump(sourceType), [], fhs)).toEqual([expect.objectContaining({
        message: expect.stringContaining('Exhaust-air heat pumps require Centralised continuous MEV or MVHR ventilation'), fieldKey: 'extra_json',
      })]);
    }
  });

  it.each([false, true])('accepts compatible ventilation (wrapped=%s)', (wrapped) => {
    for (const ventType of ['Centralised continuous MEV', 'MVHR']) {
      expect(exhaustIssues(heatPump(), [ventilation(ventType, wrapped)])).toEqual([]);
    }
  });

  it.each([false, true])('rejects incompatible units even alongside compatible ventilation (wrapped=%s)', (wrapped) => {
    for (const ventType of ['Intermittent MEV', 'Decentralised continuous MEV']) {
      expect(exhaustIssues(heatPump(), [ventilation('Centralised continuous MEV', !wrapped), ventilation(ventType, wrapped)]))
        .toEqual([expect.objectContaining({
          message: expect.stringContaining('Exhaust-air heat pumps cannot be combined with Intermittent MEV or Decentralised continuous MEV'),
        })]);
    }
  });

  it('ignores placeholder ventilation and reads standalone extra_json vent_type', () => {
    const vent = ventilation('Centralised continuous MEV', false) as MechanicalVentilation;
    expect(exhaustIssues(heatPump(), [{ ...vent, isPlaceholder: true }])).toHaveLength(1);
    expect(exhaustIssues(heatPump(), [{ ...vent, vent_type: undefined, extra_json: { vent_type: 'Centralised continuous MEV' } } as unknown as MechanicalVentilation])).toEqual([]);
  });

  it('does not require exhaust ventilation for outdoor-air heat pumps or wet plant for HWOHP cylinders', () => {
    expect(exhaustIssues(heatPump('OutsideAir'), [])).toEqual([]);
    const cylinder: Element = {
      ...heatPump(), subcategory: 'HotWaterSource',
      extra_json: { HotWaterSource: { 'hw cylinder': { type: 'StorageTank', HeatSource: { hwo_hp: { type: 'HeatPump_HWOnly' } } } } },
    } as Element;
    expect(validateElementCore(cylinder, { ...validationContext([cylinder]), complianceValidationEnabled: true }).issues).toEqual([]);
  });
});
