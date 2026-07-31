// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element, Floor, Zone } from '../../geometry/types';
import { collectGlobalSettingsWarnings } from '../globalSettingsValidation';

const groundFloorElement = {
  id: 'ground',
  name: 'Ground floor',
  type: 'BuildingElementGround',
  zoneId: 'z',
  parent_element: null,
  coordinates: [
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 4, y: 4, z: 0 },
    { x: 0, y: 4, z: 0 },
  ],
} as Element;

const upperFloorElement = {
  id: 'upper',
  name: 'Upper floor',
  type: 'BuildingElementAdjacentConditionedSpace',
  zoneId: 'z',
  parent_element: null,
  pitch: 180,
  coordinates: [
    { x: 0, y: 0, z: 1 },
    { x: 4, y: 0, z: 1 },
    { x: 4, y: 4, z: 1 },
    { x: 0, y: 4, z: 1 },
  ],
} as Element;

const floors: Floor[] = [
  { id: 'f0', name: '0', zIndex: 0, height: 2.4, isRoofSpace: false },
  { id: 'f1', name: '1', zIndex: 1, height: 2.4, isRoofSpace: false },
];

const basementFloors: Floor[] = [
  { id: 'fb', name: '-1', zIndex: -1, height: 2.4, isRoofSpace: false },
  ...floors,
];

const basementFloorElement = {
  ...groundFloorElement,
  id: 'basement',
  name: 'Basement floor',
  coordinates: groundFloorElement.coordinates?.map((coord) => ({ ...coord, z: -1 })),
} as Element;

const heatedBasementGroundFloorElement = {
  ...groundFloorElement,
  id: 'heated-basement-ground',
  name: 'Heated basement ground',
  floor_type: 'Heated_basement',
  depth_basement_floor: 2.8,
} as Element;

const unheatedBasementGroundFloorElement = {
  ...groundFloorElement,
  id: 'unheated-basement-ground',
  name: 'Unheated basement ground',
  floor_type: 'Unheated_basement',
  depth_basement_floor: 2.8,
  extra_json: {
    height_basement_walls: 0.6,
  },
} as Element;

const fhsZone: Zone = {
  id: 'z',
  name: 'Dwelling',
  floorArea: 100,
  height: 2.4,
  isPlaceholder: false,
};

function verticalWindow(width: number): Element {
  return {
    id: `window-${width}`,
    name: 'Window',
    type: 'BuildingElementTransparent',
    zoneId: fhsZone.id,
    width,
    height: 1,
    area: width,
    pitch: 90,
    parent_element: null,
    coordinates: [],
    isPlaceholder: false,
  } as Element;
}

describe('collectGlobalSettingsWarnings', () => {
  it('does not warn when total glazing is just below the FHS notional limit', () => {
    const warnings = collectGlobalSettingsWarnings({
      elements: [verticalWindow(24.99)],
      zones: [fhsZone],
      complianceValidationEnabled: true,
      complianceSettings: {},
    });

    expect(warnings.some((warning) => warning.startsWith('Total glazing'))).toBe(false);
  });

  it('warns when total glazing is just above the FHS notional limit', () => {
    const warnings = collectGlobalSettingsWarnings({
      elements: [verticalWindow(25.01)],
      zones: [fhsZone],
      complianceValidationEnabled: true,
      complianceSettings: {},
    });

    expect(warnings).toContain(
      'Total glazing (25.01 m²) exceeds the FHS notional glazing limit (25 m²). FHS preprocessing is known to fail on such models.',
    );
  });

  it('warns when manual building dimensions differ from geometry-derived values', () => {
    const warnings = collectGlobalSettingsWarnings({
      elements: [groundFloorElement],
      floors,
      complianceSettings: {
        BuildingLength: 5,
        BuildingWidth: 3.5,
      },
    });

    expect(warnings).toContain(
      'Building length is manually set to 5 m, but geometry calculates 4 m.',
    );
    expect(warnings).toContain(
      'Building width is manually set to 3.5 m, but geometry calculates 4 m.',
    );
  });

  it('does not warn when explicit building dimensions match the calculated values', () => {
    const warnings = collectGlobalSettingsWarnings({
      elements: [groundFloorElement],
      floors,
      complianceSettings: {
        BuildingLength: 4,
        BuildingWidth: 4,
      },
    });

    expect(warnings.some((warning) => warning.startsWith('Building length is manually'))).toBe(false);
    expect(warnings.some((warning) => warning.startsWith('Building width is manually'))).toBe(false);
  });

  it('warns when storeys in dwelling does not match local floor geometry', () => {
    const warnings = collectGlobalSettingsWarnings({
      elements: [groundFloorElement, upperFloorElement],
      floors,
      complianceSettings: {
        build_type: 'house',
        storeys_in_dwelling: 1,
      },
    });

    expect(warnings).toContain('Storeys in dwelling is 1, but floor geometry suggests 2.');
  });

  it('warns that storey 0 is a basement in one-based FHS semantics', () => {
    const warnings = collectGlobalSettingsWarnings({
      elements: [],
      floors,
      complianceSettings: {
        build_type: 'flat',
        storeys_in_dwelling: 1,
        storey_of_dwelling: 0,
      },
    });

    expect(warnings).toContain('Storey of dwelling 0 means one basement level below ground. Use 1 for a ground-floor flat.');
  });

  it('warns when flat storey range exceeds the building storey count', () => {
    const warnings = collectGlobalSettingsWarnings({
      elements: [],
      floors,
      complianceSettings: {
        build_type: 'flat',
        storeys_in_dwelling: 2,
        storey_of_dwelling: 2,
        storeys_in_building: 2,
      },
    });

    expect(warnings).toContain('Storey of dwelling (2) plus storeys in dwelling (2) exceeds storeys in building (2).');
  });

  it('treats an apartment one floor above ground with matching base height as valid', () => {
    const warnings = collectGlobalSettingsWarnings({
      elements: [],
      floors,
      complianceSettings: {
        build_type: 'flat',
        storeys_in_dwelling: 1,
        storey_of_dwelling: 2,
        AirPermeability_ventilation_zone_height: 2.4,
        Ventilation_ventilation_zone_base_height: 2.4,
      },
    });

    expect(warnings).toEqual([]);
  });

  it('warns when explicit ventilation zone base height disagrees with the storey-derived default', () => {
    const warnings = collectGlobalSettingsWarnings({
      elements: [],
      floors,
      complianceSettings: {
        build_type: 'flat',
        storeys_in_dwelling: 1,
        storey_of_dwelling: 2,
        AirPermeability_ventilation_zone_height: 2.4,
        Ventilation_ventilation_zone_base_height: 0,
      },
    });

    expect(warnings).toContain('Ventilation zone base height is 0 m, but storey of dwelling suggests 2.4 m.');
  });

  it('warns when upper flat ventilation zone base height cannot be checked', () => {
    const warnings = collectGlobalSettingsWarnings({
      elements: [],
      complianceSettings: {
        build_type: 'flat',
        storeys_in_dwelling: 1,
        storey_of_dwelling: 2,
        Ventilation_ventilation_zone_base_height: 0,
      },
    });

    expect(warnings).toContain(
      'Ventilation zone base height cannot be checked because no storey height or ventilation zone height is available.',
    );
  });

  it('warns when a house carries an explicit non-zero ventilation zone base height', () => {
    const warnings = collectGlobalSettingsWarnings({
      elements: [groundFloorElement],
      floors,
      complianceSettings: {
        build_type: 'house',
        Ventilation_ventilation_zone_base_height: 2.4,
      },
    });

    expect(warnings).toContain('Ventilation zone base height is 2.4 m, but build type suggests 0 m.');
  });

  it('allows a house ventilation base height below zero when the dwelling has a basement', () => {
    const warnings = collectGlobalSettingsWarnings({
      elements: [basementFloorElement, groundFloorElement],
      floors: basementFloors,
      complianceSettings: {
        build_type: 'house',
        Ventilation_ventilation_zone_base_height: -2.4,
      },
    });

    expect(warnings).not.toContain('Ventilation zone base height is -2.4 m, but build type suggests 0 m.');
  });

  it('allows a house ventilation base height from heated basement ground floor depth', () => {
    const warnings = collectGlobalSettingsWarnings({
      elements: [heatedBasementGroundFloorElement],
      floors,
      complianceSettings: {
        build_type: 'house',
        Ventilation_ventilation_zone_base_height: -2.8,
      },
    });

    expect(warnings).not.toContain('Ventilation zone base height is -2.8 m, but build type suggests 0 m.');
    expect(warnings).not.toContain(
      'Ventilation zone base height cannot be checked because basement ground-floor depth/height is missing.',
    );
  });

  it('allows a ground flat ventilation base height from heated basement ground floor depth', () => {
    const warnings = collectGlobalSettingsWarnings({
      elements: [heatedBasementGroundFloorElement],
      floors,
      complianceSettings: {
        build_type: 'flat',
        storeys_in_dwelling: 1,
        storey_of_dwelling: 1,
        Ventilation_ventilation_zone_base_height: -2.8,
      },
    });

    expect(warnings).toEqual([]);
  });

  it('allows an unheated basement ground floor ventilation base height from wall height above ground', () => {
    const warnings = collectGlobalSettingsWarnings({
      elements: [unheatedBasementGroundFloorElement],
      floors,
      complianceSettings: {
        build_type: 'house',
        Ventilation_ventilation_zone_base_height: 0.6,
      },
    });

    expect(warnings).toEqual([]);
  });

  it('warns when a heated basement ground floor lacks depth for ventilation base height checking', () => {
    const incompleteBasement = {
      ...groundFloorElement,
      id: 'incomplete-heated-basement',
      floor_type: 'Heated_basement',
    } as Element;
    const warnings = collectGlobalSettingsWarnings({
      elements: [incompleteBasement],
      floors,
      complianceSettings: {
        build_type: 'house',
        Ventilation_ventilation_zone_base_height: 0,
      },
    });

    expect(warnings).toContain(
      'Ventilation zone base height cannot be checked because basement ground-floor depth/height is missing.',
    );
    expect(warnings).not.toContain('Ventilation zone base height is 0 m, but build type suggests 0 m.');
  });

  it('warns when an unheated basement ground floor lacks wall height above ground for checking', () => {
    const incompleteBasement = {
      ...groundFloorElement,
      id: 'incomplete-unheated-basement',
      floor_type: 'Unheated_basement',
      depth_basement_floor: 2.8,
    } as Element;
    const warnings = collectGlobalSettingsWarnings({
      elements: [incompleteBasement],
      floors,
      complianceSettings: {
        build_type: 'flat',
        storeys_in_dwelling: 1,
        storey_of_dwelling: 1,
        Ventilation_ventilation_zone_base_height: 0,
      },
    });

    expect(warnings).toContain(
      'Ventilation zone base height cannot be checked because basement ground-floor depth/height is missing.',
    );
  });
});
