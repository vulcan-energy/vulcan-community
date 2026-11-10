// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element, Floor, SpaceLabel, Zone } from '../geometry/types';
import type { GeometryState } from '../stores/geometryStore';
import { calculateGroundFloorArea, calculateSuggestedVentilationHeight } from './zoneDerivation';
import { resolveEffectiveDwellingDetails, resolveEffectiveVentilationBaseHeight } from './effectiveDwellingDetails';
import { targetFieldAvailability } from './schemaCache';

/**
 * Metadata rows that set a model input, with the label the Global Settings form shows. These are
 * the rows the converter reports as E066 when present with no value (`METADATA_INPUT_FIELD_NAMES`
 * in crates/vulcan-model-transform/src/builder.rs); an absent row takes the defaults template's
 * value there, so the editor never leaves one unset or blank.
 */
export const METADATA_INPUT_LABELS: Readonly<Record<string, string>> = {
  NumberOfBedrooms: 'Number of Bedrooms',
  NumberOfWetRooms: 'Number of Wet Rooms',
  GroundFloorArea: 'Ground Floor Area (m²)',
  HeatingControlType: 'Heating Control Type',
  PartGcompliance: 'Part G Compliance',
  PartO_active_cooling_required: 'Part O Active Cooling Required',
  AirPermeability_test_pressure: 'Test Pressure',
  AirPermeability_test_result: 'Test Result',
  AirPermeability_ventilation_zone_height: 'Ventilation Zone Height (m)',
  Ventilation_shield_class: 'Shield Class',
  Ventilation_terrain_class: 'Terrain Class',
  Ventilation_altitude: 'Altitude (m)',
  Ventilation_ventilation_zone_base_height: 'Ventilation Zone Base Height (m)',
  Ventilation_noise_nuisance: 'Noise nuisance',
  BuildingLength: 'Building length (m)',
  BuildingWidth: 'Building width (m)',
  NumberOfHotTappedRooms: 'Number of hot-tapped rooms',
  NumberOfUtilityRooms: 'Number of utility rooms',
  NumberOfBathrooms: 'Number of bathrooms',
  NumberOfSanitaryAccommodations: 'Number of sanitary accommodations',
  NumberOfHabitableRooms: 'Number of habitable rooms',
  KitchenExtractorHoodExternal: 'Kitchen cooker hood extracts to outside',
  General_build_type: 'Build type',
  General_built_form: 'SAP built form',
  General_storeys_in_dwelling: 'Storeys in dwelling',
  General_storey_of_dwelling: 'Storey of dwelling',
  General_storeys_in_building: 'Storeys in building',
};

/** Where the converter writes a metadata input row in the model. */
const metadataSchemaPath = (key: string): string[] => {
  if (key.startsWith('General_')) return ['General', key.slice('General_'.length)];
  if (key.startsWith('Ventilation_')) return ['InfiltrationVentilation', key.slice('Ventilation_'.length)];
  if (key.startsWith('AirPermeability_')) return ['InfiltrationVentilation', 'Leaks', key.slice('AirPermeability_'.length)];
  return [key];
};

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const bool = (value: boolean | undefined) => (value === undefined ? undefined : value ? 'TRUE' : 'FALSE');
const count = (value: number | undefined) => (finite(value) === undefined ? undefined : String(Math.round(value!)));
const num = (value: number | undefined) => (finite(value) === undefined ? undefined : String(value));
const text = (value: string | undefined) => (value ? value : undefined);

export type MetadataRowInputs = Pick<GeometryState, 'zones' | 'elementsById' | 'spaceLabelsById' | 'spaceLabelIds' | 'complianceSettings'> & {
  floors: Floor[];
  elements: Element[];
};

/**
 * The value each compliance metadata row is saved with, in file order: the user's value, or the
 * value the geometry or space labels determine. `undefined` means the row is not written. Rows that
 * do not apply (flat-only rows on a house) are left out.
 */
export function metadataRowValues(state: MetadataRowInputs): Array<[string, string | undefined]> {
  const compliance = state.complianceSettings;
  const dd = resolveEffectiveDwellingDetails({
    zones: state.zones as Zone[],
    elementsById: state.elementsById,
    spaceLabelsById: state.spaceLabelsById as Record<string, SpaceLabel>,
    spaceLabelIds: state.spaceLabelIds,
    complianceSettings: compliance,
  });
  const derivedGFA = calculateGroundFloorArea(state.elements);
  const derivedVentHeight = calculateSuggestedVentilationHeight(state.elements, state.floors);
  const rows: Array<[string, string | undefined]> = [
    ['PartO_active_cooling_required', bool(compliance.PartO_active_cooling_required)],
    ['NumberOfBedrooms', count(dd.bedrooms)],
    ['NumberOfWetRooms', count(dd.wetRooms)],
    ['GroundFloorArea', num(finite(compliance.GroundFloorArea) ?? (derivedGFA > 0 ? derivedGFA : undefined))],
    ['HeatingControlType', text(compliance.HeatingControlType)],
    ['PartGcompliance', bool(compliance.PartGcompliance)],
    ['ColdWaterSource', text(compliance.ColdWaterSource)],
    ['ComplianceValidationEnabled', bool(compliance.complianceValidationEnabled)],
    ['ScenariosBaseModelEnabled', bool(compliance.scenariosBaseModelEnabled)],
    ['AirPermeability_test_pressure', text(compliance.AirPermeability_test_pressure)],
    ['AirPermeability_test_result', num(compliance.AirPermeability_test_result)],
    ['AirPermeability_ventilation_zone_height',
      num(finite(compliance.AirPermeability_ventilation_zone_height) ?? (derivedVentHeight > 0 ? derivedVentHeight : undefined))],
    ['Ventilation_shield_class', text(compliance.Ventilation_shield_class)],
    ['Ventilation_terrain_class', text(compliance.Ventilation_terrain_class)],
    ['Ventilation_altitude', num(compliance.Ventilation_altitude)],
    ['Ventilation_ventilation_zone_base_height', num(resolveEffectiveVentilationBaseHeight({
      zones: state.zones as Zone[],
      elementsById: state.elementsById,
      spaceLabelsById: state.spaceLabelsById as Record<string, SpaceLabel>,
      spaceLabelIds: state.spaceLabelIds,
      complianceSettings: compliance,
      floors: state.floors,
    }))],
    ['Ventilation_noise_nuisance', bool(compliance.Ventilation_noise_nuisance)],
    ['BuildingLength', num(dd.buildingLengthM)],
    ['BuildingWidth', num(dd.buildingWidthM)],
    ['NumberOfHabitableRooms', count(dd.habitableRooms)],
    ['NumberOfHotTappedRooms', count(dd.hotTappedRooms)],
    ['NumberOfUtilityRooms', count(dd.utilityRooms)],
    ['NumberOfBathrooms', count(dd.bathrooms)],
    ['NumberOfSanitaryAccommodations', count(dd.sanitaryAccommodations)],
    ['KitchenExtractorHoodExternal', bool(compliance.KitchenExtractorHoodExternal)],
    ['General_build_type', text(dd.buildType)],
    ['General_built_form', num(compliance.built_form)],
    ['General_storeys_in_dwelling', count(dd.storeysInDwelling)],
  ];
  if (dd.buildType === 'flat') {
    rows.push(['General_storey_of_dwelling', count(dd.storeyOfDwelling)], ['General_storeys_in_building', num(compliance.storeys_in_building)]);
  }
  return rows;
}

/**
 * One issue per model-input metadata row the save would leave out although the target's schema
 * takes the value (or no schema says otherwise), so the converter would use the defaults
 * template's value instead.
 */
export function unsetMetadataInputIssues(rows: Array<[string, string | undefined]>, targetRoot: unknown): string[] {
  return rows
    .filter(([key, value]) => value === undefined && key in METADATA_INPUT_LABELS
      && targetFieldAvailability(targetRoot, metadataSchemaPath(key)) !== 'absent')
    .map(([key]) => `Global Settings: ${METADATA_INPUT_LABELS[key]} is not set. Enter it in Global Settings.`);
}
