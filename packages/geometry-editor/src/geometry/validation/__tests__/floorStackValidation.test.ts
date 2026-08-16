// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { unavailableGeometrySchemaPort } from '../../../../../geometry-editor-host/src/schemaPort';
import type { BuildingElementOpaque, Element, Floor } from '../../types';
import { collectGeometryValidation, validateElementCore } from '../validateElement';

const floors: Floor[] = [
  { id: 'floor-0', name: 'Ground', zIndex: 0, height: 4, heightUserOverride: true, isRoofSpace: false },
  { id: 'floor-1', name: 'First', zIndex: 1, height: 2, isRoofSpace: false },
];

function wall(
  id: string,
  floorId: string,
  z: number,
  height: number,
  base_height?: number,
): BuildingElementOpaque {
  return {
    id,
    name: id,
    zoneId: 'zone-1',
    floorId,
    type: 'BuildingElementOpaque',
    width: 4,
    height,
    area: 4 * height,
    pitch: 90,
    ...(base_height === undefined ? {} : { base_height }),
    parent_element: null,
    coordinates: [
      { x: 0, y: 0, z },
      { x: 4, y: 0, z },
    ],
  };
}

function validationContext(elements: Element[], modelFloors: Floor[] = floors) {
  return {
    schemaPort: unavailableGeometrySchemaPort,
    elementsById: Object.fromEntries(elements.map((element) => [element.id, element])),
    floors: modelFloors,
    complianceValidationEnabled: true,
  };
}

describe('canonical floor-stack validation', () => {
  it('warns on the affected walls when adjacent storeys separate', () => {
    const elements = [
      wall('lower-wall', 'floor-0', 0, 2),
      wall('upper-wall', 'floor-1', 1, 2, 4),
    ];

    const result = validateElementCore(elements[0], validationContext(elements));

    expect(result.warnings).toContainEqual(expect.objectContaining({
      source: 'geometry',
      fieldKey: 'floor_stack',
      message: expect.stringContaining('Floor geometry may overlap or separate.'),
    }));
  });

  it('warns on the affected walls when adjacent storeys overlap', () => {
    const elements = [
      wall('lower-wall', 'floor-0', 0, 5),
      wall('upper-wall', 'floor-1', 1, 2, 4),
    ];

    const result = validateElementCore(elements[0], validationContext(elements));

    expect(result.warnings).toContainEqual(expect.objectContaining({
      fieldKey: 'floor_stack',
      message: expect.stringContaining('Floor geometry may overlap or separate.'),
    }));
  });

  it('threads the canonical warning through the geometry summary used by calculate', () => {
    const elements = [
      wall('lower-wall', 'floor-0', 0, 2),
      wall('upper-wall', 'floor-1', 1, 2, 4),
    ];

    const result = collectGeometryValidation([], elements, {
      schemaPort: unavailableGeometrySchemaPort,
      floors,
      complianceValidationEnabled: true,
    });

    expect(result.warnings).toContainEqual(
      expect.stringContaining('Floor geometry may overlap or separate.'),
    );
  });

  it('does not warn for an override alone or for excluded non-vertical geometry', () => {
    const lowerWall = wall('lower-wall', 'floor-0', 0, 2);
    const pitchedWall = { ...wall('pitched-wall', 'floor-1', 1, 8, 0), pitch: 30 };
    const windowLike = { ...wall('window-like', 'floor-1', 1, 8, 0), type: 'BuildingElementOpaque' as const, is_external_door: true };

    const result = validateElementCore(
      lowerWall,
      validationContext([lowerWall, pitchedWall, windowLike]),
    );

    expect(result.warnings.some((warning) => warning.fieldKey === 'floor_stack')).toBe(false);

    const alignedUpperWall = wall('aligned-upper-wall', 'floor-1', 1, 2, 4);
    const alignedResult = validateElementCore(
      alignedUpperWall,
      validationContext([alignedUpperWall]),
    );
    expect(alignedResult.warnings.some((warning) => warning.fieldKey === 'floor_stack')).toBe(false);
  });

  it.each([1.5, 2.5])('warns when a qualifying wall is %s m away from its floor slab', (baseHeight) => {
    const modelFloors: Floor[] = [
      { id: 'floor-0', name: 'Ground', zIndex: 0, height: 2, heightUserOverride: true, isRoofSpace: false },
      { id: 'floor-1', name: 'First', zIndex: 1, height: 1.5, heightUserOverride: true, isRoofSpace: false },
    ];
    const upperWall = wall('upper-wall', 'floor-1', 1, 1.5, baseHeight);

    const result = validateElementCore(upperWall, validationContext([upperWall], modelFloors));

    expect(result.warnings).toContainEqual(expect.objectContaining({
      fieldKey: 'floor_stack',
      message: expect.stringContaining('Floor geometry may overlap or separate.'),
    }));
  });
});
