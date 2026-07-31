// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { unavailableGeometrySchemaPort } from '../../../../../geometry-editor-host/src/schemaPort';
import type { Appliance, BuildingElementTransparent, Element, Floor } from '../../types';
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
