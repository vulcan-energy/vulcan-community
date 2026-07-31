// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { BaseElement, Element, ElementType } from '../types';

/**
 * Canonical column headers for each tabular geometry CSV section.
 * - **Export:** `ioSlice` imports these lists for `generateCSV` (single header row per section).
 * - **Import:** every canonical column must be present; extra columns are allowed (older files).
 */

type ElementByType<T extends ElementType> = Extract<Element, { type: T }>;
type PromotedPayloadFieldsByType = {
  [T in ElementType]?: readonly (Exclude<keyof ElementByType<T>, keyof BaseElement> & string)[];
};

/**
 * Element fields whose canonical editor owner is the top-level element, but
 * whose Geometry CSV transport is the row's `extra_json` payload.
 *
 * Keep this list deliberately small. Fields with dedicated CSV columns do not
 * belong here, and unlisted `extra_json` fields remain advanced-field data.
 */
export const PROMOTED_EXTRA_JSON_FIELDS = {
  ElectricBattery: [
    'capacity',
    'charge_discharge_efficiency_round_trip',
    'battery_location',
  ],
} as const satisfies PromotedPayloadFieldsByType;

function promotedFieldsFor(type: ElementType): readonly string[] {
  return PROMOTED_EXTRA_JSON_FIELDS[type as keyof typeof PROMOTED_EXTRA_JSON_FIELDS] ?? [];
}

export function encodePromotedExtraJsonFields(element: Element): Record<string, unknown> {
  const extraJson = { ...element.extra_json };
  const elementRecord = element as unknown as Record<string, unknown>;

  for (const field of promotedFieldsFor(element.type)) {
    delete extraJson[field];
    if (elementRecord[field] !== undefined) {
      extraJson[field] = elementRecord[field];
    }
  }

  return extraJson;
}

export function decodePromotedExtraJsonFields(
  type: ElementType,
  payload: Record<string, unknown>,
): {
  promotedFields: Record<string, unknown>;
  advancedExtraJson: Record<string, unknown> | undefined;
} {
  const promotedFields: Record<string, unknown> = {};
  const advancedExtraJson = { ...payload };

  for (const field of promotedFieldsFor(type)) {
    if (Object.prototype.hasOwnProperty.call(advancedExtraJson, field)) {
      promotedFields[field] = advancedExtraJson[field];
      delete advancedExtraJson[field];
    }
  }

  return {
    promotedFields,
    advancedExtraJson: Object.keys(advancedExtraJson).length > 0 ? advancedExtraJson : undefined,
  };
}

export const ZONE_HEADERS_BASE = [
  'Name',
  'Type',
  'volume',
  'floor_area',
  'height',
  'simplified thermal bridging',
] as const;

export const ZONE_HEADERS_FHS = [
  ...ZONE_HEADERS_BASE,
  'livingroom_area',
  'restofdwelling_area',
] as const;

/** Zone table headers as emitted by `generateCSV` (FHS area split vs base). */
export function zoneExportHeaders(complianceValidationEnabled: boolean): readonly string[] {
  return complianceValidationEnabled ? ZONE_HEADERS_FHS : ZONE_HEADERS_BASE;
}

export const EXPECTED_SECTION_HEADERS: Record<string, readonly string[]> = {
  'Exposed Elements': [
    'Name',
    'Zone',
    'Type',
    'area',
    'pitch',
    'width',
    'height',
    'orientation360',
    'base_height',
    'is_unheated_pitched_roof',
    'is_external_door',
    'parent_element',
    'coords',
    'extra_json',
  ],
  'Window Elements': [
    'Name',
    'Zone',
    'Type',
    'area',
    'pitch',
    'width',
    'height',
    'orientation360',
    'base_height',
    'linked_wall',
    'frame_area_fraction',
    'free_area_height',
    'mid_height',
    'max_window_open_area',
    'coords',
    'extra_json',
  ],
  'Window Shading': [
    'Name',
    'Zone',
    'Type',
    'linked_window',
    'depth',
    'height',
    'distance',
    'transparency',
    'base_height',
    'coords',
    'extra_json',
  ],
  Lighting: ['Name', 'Zone', 'efficacy', 'count', 'power', 'base_height', 'coords', 'extra_json'],
  'Ground Elements': [
    'Name',
    'Zone',
    'Type',
    'area',
    'width',
    'height',
    'perimeter',
    'floor_type',
    'depth_basement_floor',
    'thickness_walls',
    'base_height',
    'parent_element',
    'coords',
    'extra_json',
  ],
  'Non-Exposed Elements': [
    'Name',
    'Zone',
    'Type',
    'area',
    'pitch',
    'width',
    'height',
    'base_height',
    'parent_element',
    'coords',
    'extra_json',
  ],
  'Thermal Bridging Elements': [
    'Name',
    'Zone',
    'Type',
    'heat_transfer_coeff',
    'length',
    'linear_thermal_transmittance',
    'parent_element',
    'coords',
    'extra_json',
  ],
  'Ventilation Systems': [
    'Name',
    'Type',
    'length',
    'duct_type',
    'terminal_type',
    'parent_element',
    'host_element',
    'mid_height_air_flow_path',
    'area_cm2',
    'orientation360',
    'pitch',
    'vent_type',
    'coords',
    'extra_json',
  ],
  'Combustion Appliances': [
    'Name',
    'Type',
    'appliance_type',
    'exhaust_situation',
    'fuel_type',
    'supply_situation',
    'base_height',
    'coords',
    'extra_json',
  ],
  'Water Pipework': ['Name', 'Type', 'length', 'location', 'pipework_type', 'coords', 'extra_json'],
  'Wet Emitters': [
    'Name',
    'Zone',
    'Type',
    'subcategory',
    'area',
    'unit_number',
    'space_heat_system',
    'base_height',
    'coords',
    'extra_json',
  ],
  Appliances: ['Name', 'Type', 'appliancekey', 'base_height', 'coords'],
  'Hot Water Outlets': [
    'Name',
    'Type',
    'subcategory',
    'flowrate',
    'size',
    'rated_power',
    'allow_low_flowrate',
    'base_height',
    'coords',
  ],
  'Context Shading': [
    'Name',
    'Type',
    'shading_type',
    'start_angle',
    'end_angle',
    'distance',
    'height',
    'parent_element',
    'base_height',
    'coords',
    'extra_json',
  ],
  'On-Site Generation': [
    'Name',
    'Type',
    'generation_type',
    'pitch',
    'orientation360',
    'base_height',
    'peak_power',
    'width',
    'height',
    'coords',
    'extra_json',
  ],
  Systems: ['Name', 'Zone', 'Type', 'subcategory', 'system_preset', 'base_height', 'coords', 'extra_json'],
  'Space Labels': ['Name', 'Zone', 'storey', 'room_type', 'coords', 'height_override', 'extra_json'],
};

const SKIP_VALIDATION = new Set(['Test Section']);

/**
 * Canonical columns added after the section first shipped. Treated as optional by the
 * import validator so older CSVs (saved before the column existed) still load. The writer
 * always emits them; ingest falls back to derivation when they're absent.
 */
const ADDITIVE_OPTIONAL_COLUMNS: Record<string, ReadonlySet<string>> = {
  'Non-Exposed Elements': new Set(['base_height', 'coords']),
  'On-Site Generation': new Set(['width', 'height']),
  'Window Shading': new Set(['base_height']),
  Lighting: new Set(['base_height']),
  'Ground Elements': new Set(['base_height']),
  'Ventilation Systems': new Set(['terminal_type', 'host_element', 'coords']),
  'Combustion Appliances': new Set(['base_height']),
  'Wet Emitters': new Set(['space_heat_system', 'base_height']),
  Appliances: new Set(['base_height', 'coords']),
  'Hot Water Outlets': new Set(['allow_low_flowrate', 'base_height', 'coords']),
  'Context Shading': new Set(['shading_type', 'start_angle', 'end_angle', 'parent_element', 'base_height', 'coords', 'extra_json']),
  'Water Pipework': new Set(['pipework_type']),
  Systems: new Set(['Zone', 'Type', 'subcategory', 'system_preset', 'base_height', 'coords', 'extra_json']),
};

const HEADER_ALIASES: Record<string, Record<string, readonly string[]>> = {
  'Context Shading': {
    start_angle: ['start angle'],
    end_angle: ['end angle'],
  },
  Systems: {
    Type: ['system_type'],
  },
};

/** Trimmed header names for lookup (extras allowed vs canonical export). */
function headerNameSet(columnHeaders: string[]): Set<string> {
  return new Set(columnHeaders.map((h) => h.trim()).filter((h) => h.length > 0));
}

/**
 * Import validation: every **canonical** column for the section must appear in the file
 * (order-independent). Extra columns (e.g. older exports) are ignored — ingest reads by name.
 * Current exports stay the single canonical header row from `EXPECTED_SECTION_HEADERS` / Zone helpers.
 */
export function validateGeometrySectionHeaders(sectionName: string, columnHeaders: string[]): void {
  if (SKIP_VALIDATION.has(sectionName)) return;

  const names = headerNameSet(columnHeaders);
  const hasColumnOrAlias = (section: string, canonicalName: string): boolean => {
    if (names.has(canonicalName)) return true;
    const aliases = HEADER_ALIASES[section]?.[canonicalName] ?? [];
    return aliases.some((alias) => names.has(alias));
  };

  if (sectionName === 'Zone') {
    const missingBase = ZONE_HEADERS_BASE.filter((h) => !names.has(h));
    if (missingBase.length > 0) {
      throw new Error(`Zone: missing required columns: ${missingBase.join(', ')}`);
    }
    const hasLiving = names.has('livingroom_area');
    const hasRest = names.has('restofdwelling_area');
    if (hasLiving !== hasRest) {
      throw new Error(
        'Zone: livingroom_area and restofdwelling_area must both be present or both absent',
      );
    }
    return;
  }

  const canonical = EXPECTED_SECTION_HEADERS[sectionName];
  if (!canonical) {
    throw new Error(`Unknown or unsupported tabular section "${sectionName}"`);
  }
  const optional = ADDITIVE_OPTIONAL_COLUMNS[sectionName];
  const missing = canonical.filter((h) => !hasColumnOrAlias(sectionName, h) && !optional?.has(h));
  if (sectionName === 'Systems') {
    const hasDispatch = ['Type', 'system_type', 'subcategory'].some((h) => names.has(h));
    if (!hasDispatch) {
      missing.push('Type/system_type/subcategory');
    }
  }
  if (missing.length > 0) {
    throw new Error(`${sectionName}: missing required columns: ${missing.join(', ')}`);
  }
}
