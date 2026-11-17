// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';
import { isPointInPolygon2D } from './pointInPolygon';

/**
 * Construction bands: on an existing-building model the converter (vulcan-model-transform
 * `hemie.rs`) takes each element's fabric from the element's own values, else the `HEMIE_` model
 * settings (the age band and a construction per construction type), and fails naming a field
 * neither states. A stated U-value or construction resistance wins over both.
 */
export const HEMIE_AGE_BAND = 'HEMIE_age_band';

// The nation by postcode area (`postcode_region` in `hemie.rs`; keep the two in step): area level,
// because district boundaries cross national borders. Border areas ask the model's stated nation.
const SCOTLAND_AREAS = new Set(['AB', 'DD', 'DG', 'EH', 'FK', 'G', 'HS', 'IV', 'KA', 'KW', 'KY', 'ML', 'PA', 'PH', 'ZE']);
const WALES_AREAS = new Set(['CF', 'SA']);
const BORDER_AREAS = new Set(['CA', 'CH', 'HR', 'LD', 'LL', 'NP', 'SY', 'TD']);
/** The Crown dependencies, outside the UK. HEM:EPC covers the Isle of Man (IM) as its own region, not the Channel Islands. */
const OUTSIDE_AREAS = new Set(['IM', 'GY', 'JE']);
const ENGLAND_AREAS = new Set(('AL B BA BB BD BH BL BN BR BS CB CM CO CR CT CV CW DA DE DH DL DN DT DY E EC EN EX FY GL GU HA '
  + 'HD HG HP HU HX IG IP KT L LA LE LN LS LU M ME MK N NE NG NN NR NW OL OX PE PL PO PR RG RH RM S SE SG SK SL SM SN SO '
  + 'SP SR SS ST SW TA TF TN TQ TR TS TW UB W WA WC WD WF WN WR WS WV YO').split(' '));

/** The nation the model states for a postcode in a border area. */
export const HEMIE_NATION = 'HEMIE_nation';
export const NATIONS = ['England', 'Wales', 'Scotland', 'Northern Ireland'] as const;

/** A well-formed postcode's area, else undefined. */
const postcodeArea = (postcode: string | undefined) =>
  /^([A-Z]{1,2})\d[A-Z\d]?\d[A-Z]{2}$/.exec((postcode ?? '').replace(/\s/g, '').toUpperCase())?.[1];

/** The postcode's area when it spans two nations, so the model states the nation. */
export function postcodeBorderArea(postcode: string | undefined): string | undefined {
  const area = postcodeArea(postcode);
  return area && BORDER_AREAS.has(area) ? area : undefined;
}

/** The postcode's area when it is outside the UK (a Crown dependency). */
export function postcodeOutsideArea(postcode: string | undefined): string | undefined {
  const area = postcodeArea(postcode);
  return area && OUTSIDE_AREAS.has(area) ? area : undefined;
}

/** True for a well-formed postcode whose area is in none of the EPC schemes' nations or outside areas. */
export function postcodeUnrecognised(postcode: string | undefined): boolean {
  const area = postcodeArea(postcode);
  return !!area && !OUTSIDE_AREAS.has(area) && !BORDER_AREAS.has(area) && postcodeRegion(postcode) === undefined;
}

/**
 * The region the converter takes (`region` in `hemie.rs`): derived from the postcode area, or in
 * a border area the stated nation; undefined when neither gives one.
 */
export function postcodeRegion(postcode: string | undefined, statedNation?: string): string | undefined {
  const area = postcodeArea(postcode);
  if (!area) return undefined;
  if (BORDER_AREAS.has(area)) return NATIONS.find((nation) => nation === statedNation);
  if (area === 'BT') return 'Northern Ireland';
  if (area === 'IM') return 'Isle of Man';
  if (SCOTLAND_AREAS.has(area)) return 'Scotland';
  if (WALES_AREAS.has(area)) return 'Wales';
  return ENGLAND_AREAS.has(area) ? 'England' : undefined;
}
/**
 * Under construction bands (`TargetRules.constructionBands`) a fabric preset's U-value would be
 * a documented U-value over the bands, so these types take no preset there.
 */
export const FABRIC_PRESET_TYPES: ReadonlySet<string> = new Set(['BuildingElementOpaque', 'BuildingElementTransparent']);

/**
 * Settings older files carry that the converter no longer reads (`RETIRED_SETTINGS` in `hemie.rs`):
 * a load drops each one and says what to do instead.
 */
export const HEMIE_RETIRED_ROWS: Readonly<Record<string, string>> = {
  HEMIE_region: 'The region setting was removed: it now comes from the postcode. For a postcode area that spans two nations, choose the Nation next to the Postcode in Global Settings.',
  HEMIE_front_door: 'The front door setting was removed: mark the front door on the door itself.',
  HEMIE_infiltration_properties: 'The infiltration setting was removed. With no air test, enter the open fireplaces and glazing date in Global Settings > Air tightness.',
};

const HEAT_CAPACITY_BANDS = ['Very light', 'Light', 'Medium', 'Heavy', 'Very heavy'] as const;
const BANDED = new Set(['external_wall', 'sheltered_wall', 'party_wall', 'suspended_floor', 'not_edge_insulated_ground_attached_floor',
  'edge_insulated_ground_attached_floor', 'unheated_basement_floor', 'above_external_area_floor']);
const NUMBER_ONLY = new Set(['heated_basement_floor', 'heated_pitched_roof', 'window', 'external_door', 'party_or_sheltered_door',
  'park_home_wall', 'park_home_floor', 'park_home_flat_roof', 'park_home_pitched_roof']);
/**
 * What an existing building's element may state as its areal heat capacity, by its construction
 * type (`heat_capacity_rule` in `hemie.rs`; keep the two in step): the bands (or a number), [] for
 * a number only, undefined when it takes none (the converter sets it from the type, or a party
 * floor or ceiling).
 */
export function hemieHeatCapacityBands(constructionType: string | undefined): readonly string[] | undefined {
  if (!constructionType) return undefined;
  return BANDED.has(constructionType) ? HEAT_CAPACITY_BANDS : NUMBER_ONLY.has(constructionType) ? [] : undefined;
}

// DESNZ-defined: what HEMIE takes for a blank insulation thickness, by age band A to M (mm).
const ROOF_THICKNESS = {
  cold: [100, 100, 100, 100, 100, 100, 100, 150, 170, 270, 270, 270, 300],
  warm: [0, 0, 0, 0, 19, 74, 146, 164, 164, 285, 285, 317, 375],
  // A heated pitched roof takes the flat roof's.
  flat: [0, 0, 0, 0, 12, 50, 100, 125, 125, 175, 175, 238, 285],
} as const;
const FLOOR_THICKNESS = [0, 0, 0, 0, 0, 0, 0, 0, 25, 75, 100, 100, 140] as const;
/** DESNZ-defined: a blank joist or rafter depth, by age band (mm). */
const beamDepth = (band: number) => (band < 7 ? 100 : 150);
/** The roof insulation locations HEMIE reads as a cold roof (at the joists); the others make it warm. */
const COLD_LOCATIONS = new Set(['at_joists', 'at_joists_and_rafters', 'unknown']);
const NO_INSULATION = new Set(['mini_flat_roof', 'mini_pitched_roof', 'thatched_roof']);

/**
 * What HEMIE or the converter takes for a construction field left blank, as a placeholder, where
 * the schema states no default (`ConstructionFieldInput` shows the schema's); undefined otherwise.
 * The age band and insulation location give the numbers the band's tables hold; without them the
 * placeholder names the rule. The heat capacities are the converter's (`require` in `hemie.rs`).
 */
export function hemieDefaultPlaceholder(constructionType: string, field: string, at: { band?: unknown; location?: unknown } = {}): string | undefined {
  const band = 'ABCDEFGHIJKLM'.indexOf(typeof at.band === 'string' && at.band.length === 1 ? at.band : '-');
  const byBand = (values: (band: number) => number) => (band < 0 ? 'By age band (default)' : `${values(band)} (default)`);
  // A flat or unheated pitched roof with no insulation location has no insulation.
  const located = !['flat_roof', 'unheated_pitched_roof'].includes(constructionType) || (typeof at.location === 'string' && at.location !== '');
  switch (field) {
    case 'areal_heat_capacity':
      if (constructionType.endsWith('_door')) return '50,000 (default)';
      return constructionType === 'window' ? '20,000 (default)' : undefined;
    case 'insulation_thickness':
      if (NO_INSULATION.has(constructionType) || !located) return 'None (default)';
      if (constructionType.endsWith('_floor')) return byBand((b) => FLOOR_THICKNESS[b]);
      if (constructionType === 'unheated_pitched_roof') {
        return byBand((b) => ROOF_THICKNESS[COLD_LOCATIONS.has(String(at.location)) ? 'cold' : 'warm'][b]);
      }
      return constructionType.endsWith('_roof') ? byBand((b) => ROOF_THICKNESS.flat[b]) : undefined;
    case 'joist_depth':
    case 'rafter_depth':
      return byBand(beamDepth);
    case 'ceiling_thermal_conductivity':
    case 'internal_finish_thermal_conductivity':
      return 'Plasterboard (default)';
    case 'percentage_area_of_timber_joists':
    case 'percentage_area_of_timber_rafters':
      return '13 (default)';
    case 'air_gap_thermal_resistance':
      return 'By roof characteristics (default)';
    case 'insulation_type':
      return 'As built (default)';
    default:
      return undefined;
  }
}

/** The door element flag that marks the front door; one door only. */
export const HEMIE_FRONT_DOOR = 'is_front_door';
export const hemieConstructionSetting = (constructionType: string): string => `HEMIE_construction_${constructionType}`;

/**
 * The construction fields offered per construction type: those the converter needs a value for,
 * and the simpler insulation inputs (retrofit insulation, insulation thickness, the roof's
 * insulation location). The details (`HEMIE_DETAIL_FIELDS`) and the outside surface
 * (`hemieOutsideSurface`) go under More. An element may override them (see
 * `element_override_keys` in `hemie.rs`).
 */
export const HEMIE_CONSTRUCTION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  external_wall: ['wall_construction_type', 'retrofit_insulation'],
  sheltered_wall: ['wall_construction_type', 'retrofit_insulation'],
  window: ['glazing_type', 'frame_material', 'glazing_gap', 'areal_heat_capacity'],
  external_door: ['areal_heat_capacity'],
  party_or_sheltered_door: ['areal_heat_capacity'],
  flat_roof: ['insulation_location', 'insulation_thickness'],
  unheated_pitched_roof: ['insulation_location', 'insulation_thickness'],
  heated_pitched_roof: ['insulation_thickness'],
  mini_flat_roof: ['insulation_location', 'insulation_thickness'],
  mini_pitched_roof: ['insulation_location', 'insulation_thickness'],
  suspended_floor: ['insulation_thickness'],
  not_edge_insulated_ground_attached_floor: ['insulation_thickness'],
  edge_insulated_ground_attached_floor: ['insulation_thickness'],
  heated_basement_floor: ['insulation_thickness'],
  unheated_basement_floor: ['insulation_thickness'],
  above_external_area_floor: ['insulation_thickness'],
  above_internal_unconditioned_area_floor: ['insulation_thickness'],
  party_floor: ['construction_weight'],
  party_ceiling: ['construction_weight'],
  park_home_wall: [],
  park_home_floor: [],
  park_home_flat_roof: [],
  park_home_pitched_roof: [],
  thatched_roof: ['insulation_thickness'],
};

// The details HEMIE takes (`element_override_keys` in `hemie.rs`; keep the two in step).
const ROOF_DETAILS = ['ceiling_thickness', 'ceiling_thermal_conductivity', 'joist_depth', 'percentage_area_of_timber_joists', 'insulation_thermal_conductivity'];
const LOFT_DETAILS = [...ROOF_DETAILS, 'rafter_depth', 'percentage_area_of_timber_rafters', 'roof_characteristics', 'air_gap_thermal_resistance'];
const FLOOR_DETAILS = ['insulation_type', 'insulation_thermal_conductivity'];
/**
 * The construction details that only refine the U-value worked out from the age band, by
 * construction type (DESNZ-defined): each has a default, so they go under More.
 */
export const HEMIE_DETAIL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  flat_roof: ROOF_DETAILS,
  mini_flat_roof: ROOF_DETAILS,
  unheated_pitched_roof: LOFT_DETAILS,
  mini_pitched_roof: LOFT_DETAILS,
  heated_pitched_roof: ['internal_finish_thickness', 'internal_finish_thermal_conductivity', 'rafter_depth', 'percentage_area_of_timber_rafters', 'insulation_thermal_conductivity'],
  suspended_floor: FLOOR_DETAILS,
  not_edge_insulated_ground_attached_floor: FLOOR_DETAILS,
  edge_insulated_ground_attached_floor: FLOOR_DETAILS,
  heated_basement_floor: FLOOR_DETAILS,
  unheated_basement_floor: FLOOR_DETAILS,
  above_external_area_floor: FLOOR_DETAILS,
  above_internal_unconditioned_area_floor: FLOOR_DETAILS,
  // An unheated pitched roof that is thatched (`ThatchedRoofConstruction`): its insulation is the thatch plus any retrofit.
  thatched_roof: ['insulation_thermal_conductivity'],
};

/**
 * How an outside surface is described (DESNZ-defined): by its colour (the simple
 * default), its material and finish, or a documented solar absorption coefficient. HEMIE ranks
 * the coefficient first, then the material and finish, then the colour.
 */
export type OutsideSurfaceMethod = 'colour' | 'material' | 'coefficient';
export const OUTSIDE_SURFACE_METHOD_LABELS: Readonly<Record<OutsideSurfaceMethod, string>> = {
  colour: 'Colour', material: 'Material and finish', coefficient: 'Coefficient',
};
const WALL_FINISHES = {
  Brick: 'BrickFinish', Render: 'RenderFinish', Timber: 'TimberFinish', 'Metal (uncoated)': 'MetalUncoatedFinish',
  'Metal (coated)': 'MetalCoatedFinish', 'Fibre-cement': 'FibreCementWallFinish', 'Composite panels (metal skins)': 'CompositePanelsFinish',
};
const ROOF_FINISHES = {
  'Concrete roof tile': 'ConcreteRoofTileFinish', 'Clay tile': 'ClayTileFinish', Slate: 'SlateFinish', Asphalt: 'AsphaltFinish',
  Timber: 'TimberFinish', 'Metal (uncoated)': 'MetalUncoatedFinish', 'Metal (coated)': 'MetalCoatedFinish',
  'Fibre-cement': 'FibreCementRoofFinish', 'Composite panels (metal skins)': 'CompositePanelsFinish',
};
const DOOR_FINISHES = {
  Timber: 'TimberFinish', 'Metal (uncoated)': 'MetalUncoatedFinish', 'Metal (coated)': 'MetalCoatedFinish',
  'Composite panels (metal skins)': 'CompositePanelsFinish',
};
const PARK_HOME_WALL_FINISHES = {
  'uPVC vinyl / Plastic': 'ParkHomePlasticFinish', 'Stucco / Aggregate paint': 'ParkHomePaintFinish',
  'Timber / Wood cladding': 'ParkHomeTimberFinish', 'CanExel / Engineered HDF': 'ParkHomeHDFFinish',
};
/**
 * The schema enum of each surface material's finishes, by construction type: HEMIE's
 * `*_SURFACE_MATERIAL_TO_FINISH` (`hemie/models/constructions`), which checks a finish against its
 * material (DESNZ-defined). The schema states the pairing only in HEMIE's code.
 */
const SURFACE_FINISHES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  external_wall: WALL_FINISHES, external_door: DOOR_FINISHES, park_home_wall: PARK_HOME_WALL_FINISHES,
  flat_roof: ROOF_FINISHES, unheated_pitched_roof: ROOF_FINISHES, heated_pitched_roof: ROOF_FINISHES,
  mini_flat_roof: ROOF_FINISHES, mini_pitched_roof: ROOF_FINISHES, park_home_flat_roof: ROOF_FINISHES, park_home_pitched_roof: ROOF_FINISHES,
};
/** Construction types with an outside surface (`outside_surface` in `hemie.rs`), as the editor offers them. */
const OUTSIDE_SURFACE_TYPES = new Set([...Object.keys(SURFACE_FINISHES), 'above_external_area_floor', 'park_home_floor', 'thatched_roof']);

/** The ways a construction type's outside surface can be described; undefined when it has none. */
export function hemieOutsideSurface(constructionType: string | undefined): readonly OutsideSurfaceMethod[] | undefined {
  if (!constructionType || !OUTSIDE_SURFACE_TYPES.has(constructionType)) return undefined;
  return SURFACE_FINISHES[constructionType] ? ['colour', 'material', 'coefficient'] : ['colour', 'coefficient'];
}

/** The schema enum that lists a surface material's finishes, on its construction type. */
export function hemieFinishEnum(constructionType: string, material: unknown): string | undefined {
  return typeof material === 'string' ? SURFACE_FINISHES[constructionType]?.[material] : undefined;
}

/**
 * The fields of each outside surface method. The coefficient is `solar_absorption_coefficient` in
 * a construction setting and `solar_absorption_coeff` on an element.
 */
export function outsideSurfaceKeys(coefficientKey: string): Readonly<Record<OutsideSurfaceMethod, readonly string[]>> {
  return { colour: ['colour'], material: ['surface_material', 'finish'], coefficient: [coefficientKey] };
}

/** The method the stated values use, HEMIE's ranking first; undefined when none is stated. */
export function statedOutsideSurfaceMethod(values: Readonly<Record<string, unknown>>, coefficientKey: string): OutsideSurfaceMethod | undefined {
  const keys = outsideSurfaceKeys(coefficientKey);
  return (['coefficient', 'material', 'colour'] as const).find((method) => keys[method].some((key) => values[key] !== undefined && values[key] !== null && values[key] !== ''));
}

const JOISTS = ['joist_depth', 'percentage_area_of_timber_joists'];
const RAFTERS = ['rafter_depth', 'percentage_area_of_timber_rafters'];
/**
 * The details a roof or floor shows for its insulation location, as HEMIE reads them (`roof.py`):
 * a cold roof (at the joists, or unknown) its joists, a warm pitched roof its rafters, a warm flat
 * roof neither; a roof with no location has no insulation, so no beams.
 */
export function hemieDetailFields(constructionType: string, location: unknown): readonly string[] {
  const details = HEMIE_DETAIL_FIELDS[constructionType] ?? [];
  const flat = constructionType === 'flat_roof' || constructionType === 'mini_flat_roof';
  if (!flat && constructionType !== 'unheated_pitched_roof' && constructionType !== 'mini_pitched_roof') return details;
  const where = typeof location === 'string' && location !== '' ? location : undefined;
  const beams = !where ? [] : COLD_LOCATIONS.has(where) ? JOISTS : flat ? [] : RAFTERS;
  return details.filter((key) => ![...JOISTS, ...RAFTERS].includes(key) || beams.includes(key));
}

/** The details a location hides that are stated in `values`, to clear when the location changes. */
export function hemieHiddenDetails(constructionType: string, location: unknown, values: Readonly<Record<string, unknown>>): string[] {
  const shown = hemieDetailFields(constructionType, location);
  return (HEMIE_DETAIL_FIELDS[constructionType] ?? []).filter((key) => !shown.includes(key) && values[key] !== undefined);
}

/** "ceiling thickness", "outside surface": what an element's More holds, for the group's hint. */
export function hemieMoreLabels(constructionType: string, details: boolean, location: unknown): string[] {
  const label = (field: string) => { const text = hemieFieldLabel(field).replace(/ \(.*\)$/, ''); return text.charAt(0).toLowerCase() + text.slice(1); };
  return [...(details ? hemieDetailFields(constructionType, location) : []).map(label), ...(hemieOutsideSurface(constructionType) ? ['outside surface'] : [])];
}

/** The element fields under its editor's More: the details and the outside surface. */
export function hemieMoreKeys(constructionType: string): string[] {
  return [...(HEMIE_DETAIL_FIELDS[constructionType] ?? []), ...(hemieOutsideSurface(constructionType) ? ['colour', 'surface_material', 'finish', 'solar_absorption_coeff'] : [])];
}

/**
 * Every construction field an element or setting may state for its type: the main fields, the
 * details and the outside surface.
 */
export function hemieConstructionKeys(constructionType: string): string[] {
  return [...(HEMIE_CONSTRUCTION_FIELDS[constructionType] ?? []), ...(HEMIE_DETAIL_FIELDS[constructionType] ?? []),
    ...(hemieOutsideSurface(constructionType) ? ['colour'] : []), ...(SURFACE_FINISHES[constructionType] ? ['surface_material', 'finish'] : [])];
}

/**
 * Element fields only the existing-building converter reads (`ELEMENT_ONLY_KEYS` in `hemie.rs`);
 * no other input takes them, so another target leaves them out.
 */
export const HEMIE_ELEMENT_KEYS = [
  'age_band', HEMIE_FRONT_DOOR, 'wall_construction_type', 'glazing_type', 'frame_material', 'glazing_gap',
  'insulation_location', 'construction_weight', 'retrofit_insulation', 'insulation_thickness', 'adjacent_space_type',
  'basement_depth_descriptor', 'basement_air_volume', 'thatched', 'insulation_type', 'insulation_thermal_conductivity',
  'ceiling_thickness', 'ceiling_thermal_conductivity', 'joist_depth', 'percentage_area_of_timber_joists', 'roof_characteristics',
  'rafter_depth', 'percentage_area_of_timber_rafters', 'air_gap_thermal_resistance', 'internal_finish_thickness',
  'internal_finish_thermal_conductivity', 'surface_material', 'finish',
] as const;

/** The existing-building fields an element holds in its extra_json. */
export function hemieLeftoverKeys(element: Element): string[] {
  const extra = (element.extra_json ?? {}) as Record<string, unknown>;
  return HEMIE_ELEMENT_KEYS.filter((key) => extra[key] !== undefined && extra[key] !== null && extra[key] !== '');
}

const UNITS: Readonly<Record<string, string>> = {
  glazing_gap: 'mm', insulation_thickness: 'mm', areal_heat_capacity: 'J/m²·K', basement_air_volume: 'm³',
  power_limit_battery_import: 'kW',
  ceiling_thickness: 'mm', internal_finish_thickness: 'mm', joist_depth: 'mm', rafter_depth: 'mm',
  percentage_area_of_timber_joists: '%', percentage_area_of_timber_rafters: '%', air_gap_thermal_resistance: 'm²·K/W',
  insulation_thermal_conductivity: 'W/m·K', ceiling_thermal_conductivity: 'W/m·K', internal_finish_thermal_conductivity: 'W/m·K',
};
/** A flat roof's insulation location, as the converter takes it: at the joists is a cold roof, above them a warm roof. */
const FLAT_ROOF_LOCATIONS: Readonly<Record<string, string>> = { at_joists: 'At joists (cold roof)', above_joists: 'Above joists (warm roof)' };
/** The wording of a field whose key does not read plainly. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  areal_heat_capacity: 'Heat capacity per area',
  power_limit_battery_import: 'Grid import limit for charging',
  percentage_area_of_timber_joists: 'Timber joist area',
  percentage_area_of_timber_rafters: 'Timber rafter area',
  insulation_thermal_conductivity: 'Insulation conductivity',
  ceiling_thermal_conductivity: 'Ceiling conductivity',
  internal_finish_thermal_conductivity: 'Internal finish conductivity',
  air_gap_thermal_resistance: 'Air gap resistance',
  roof_characteristics: 'Cold roof characteristics',
  solar_absorption_coefficient: 'Solar absorption coefficient',
  solar_absorption_coeff: 'Solar absorption coefficient',
};
const words = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ');

/** "External wall": a construction type as people read it. */
const CONSTRUCTION_TYPE_LABELS: Readonly<Record<string, string>> = {
  not_edge_insulated_ground_attached_floor: 'Ground floor, no edge insulation',
  edge_insulated_ground_attached_floor: 'Ground floor, edge insulated',
};
export const hemieConstructionTypeLabel = (type: string): string => CONSTRUCTION_TYPE_LABELS[type] ?? words(type);

/** "Glazing gap (mm)": a construction field with its unit. */
export function hemieFieldLabel(field: string): string {
  const label = FIELD_LABELS[field] ?? words(field);
  return UNITS[field] ? `${label} (${UNITS[field]})` : label;
}

/** "12 mm", "Wood or PVC", "Yes": a construction field's value with its unit, for the construction type when given. */
export function hemieValueLabel(field: string, value: unknown, constructionType?: string): string {
  if (field === 'glazing_gap' && value === 16) return '16 mm or more';
  if (field === 'insulation_location' && (constructionType === 'flat_roof' || constructionType === 'mini_flat_roof')) {
    const label = FLAT_ROOF_LOCATIONS[String(value)];
    if (label) return label;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return typeof value === 'number' ? `${value}${UNITS[field] ? ` ${UNITS[field]}` : ''}` : words(String(value));
}

const GROUND_FLOOR_CONSTRUCTIONS: Readonly<Record<string, string>> = {
  Slab_no_edge_insulation: 'not_edge_insulated_ground_attached_floor',
  Slab_edge_insulation: 'edge_insulated_ground_attached_floor',
  Suspended_floor: 'suspended_floor',
  Heated_basement: 'heated_basement_floor',
  Unheated_basement: 'unheated_basement_floor',
};

/** A field as the converter reads it: the element's own, else its extra_json. */
export function hemieElementValue(element: Element, key: string): unknown {
  const own = (element as unknown as Record<string, unknown>)[key];
  if (own !== undefined && own !== null && own !== '') return own;
  const extra = element.extra_json as Record<string, unknown> | undefined;
  const value = extra?.[key];
  return value === null || value === '' ? undefined : value;
}

/** The wall an opening is in, by its parent element's name. */
function hostWall(element: Element, elements: readonly Element[]): Element | undefined {
  const host = hemieElementValue(element, 'parent_element');
  return host === undefined ? undefined : elements.find((other) => other.name === host);
}

const level = (element: Element) => Math.round(element.coordinates?.[0]?.z ?? 0);
const planePitch = (element: Element) => {
  const pitch = hemieElementValue(element, 'pitch');
  return element.type === 'BuildingElementOpaque' && (element.coordinates?.length ?? 0) >= 3 && !element.extra_json?.dormer_bundle
    && typeof pitch === 'number' && pitch < 90 ? pitch : undefined;
};
const hasProfile = (element: Element) => Boolean((hemieElementValue(element, 'geometry_face') as { top_profile?: unknown } | undefined)?.top_profile);

/** A bay bundle's roof plane: the converter gives it a bay roof construction. */
function isBayRoof(element: Element): boolean {
  const tag = element.extra_json?.hemie_bundle as { kind?: string; role?: string } | undefined;
  return tag?.kind === 'bay' && tag.role === 'roof';
}

/**
 * The top storey's level when it is a room in the roof, as `hemie.rs` decides it: heated slopes
 * over it, a gable among its walls, and its plain external walls under the common wall height for
 * at least half their length.
 */
function roomInRoofLevel(elements: readonly Element[]): number | undefined {
  const walls = elements.filter((element) => (element.coordinates?.length ?? 0) === 2 && hemieElementValue(element, 'is_external_door') !== true
    && !element.extra_json?.dormer_bundle
    && ['BuildingElementOpaque', 'BuildingElementPartyWall', 'BuildingElementAdjacentUnconditionedSpace_Simple'].includes(element.type));
  if (!walls.length) return undefined;
  const top = Math.max(...walls.map(level));
  const heatedAbove = top > 0 && elements.some((plane) => (planePitch(plane) ?? 0) > 0
    && hemieElementValue(plane, 'is_unheated_pitched_roof') !== true && (level(plane) === top || level(plane) === top + 1));
  const topWalls = walls.filter((wall) => level(wall) === top);
  let common = 0;
  let low = 0;
  for (const wall of topWalls) {
    if (wall.type !== 'BuildingElementOpaque' || hasProfile(wall)) continue;
    const [a, b] = wall.coordinates;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    common += length;
    if (Number(hemieElementValue(wall, 'height')) < COMMON_WALL_HEIGHT) low += length;
  }
  return heatedAbove && topWalls.some(hasProfile) && low >= common / 2 ? top : undefined;
}
const COMMON_WALL_HEIGHT = 1.8;

/**
 * A flat plane over a room in the roof: the ceiling under the ridge, which takes the unheated
 * pitched roof construction.
 */
function isRoomInRoofCeiling(element: Element, elements: readonly Element[]): boolean {
  const room = roomInRoofLevel(elements);
  // ponytail: by level, where the converter takes the planes over the room's building part; a flat roof
  // at that level over another part counts too. Match the converter's plan test if models need it.
  return planePitch(element) !== undefined && room !== undefined && (level(element) === room || level(element) === room + 1);
}

/** Roof constructions the converter builds once per building part, from all of the part's planes. */
const SHARED_ROOF_TYPES: ReadonlySet<string> = new Set(['flat_roof', 'unheated_pitched_roof', 'thatched_roof', 'heated_pitched_roof',
  'mini_flat_roof', 'mini_pitched_roof', 'park_home_flat_roof', 'park_home_pitched_roof']);

const planCentroid = (element: Element) => {
  const points = element.coordinates ?? [];
  return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
};

/**
 * The other roof planes that share this plane's construction: the converter gives one set of
 * values to a building part's planes of one roof construction, and fails when their stated
 * values differ (`Ctx::agreed` in `hemie.rs`). Empty for any other element.
 */
export function sharedRoofPlanes(element: Element, elements: readonly Element[], buildType?: string): Element[] {
  // A thatched plane is a loft plane that states it is thatched: the planes must agree.
  const roofType = (plane: Element) => hemieConstructionType(plane, elements, buildType)?.replace('thatched_roof', 'unheated_pitched_roof');
  const type = planePitch(element) === undefined ? undefined : roofType(element);
  if (!type || !SHARED_ROOF_TYPES.has(type)) return [];
  // ponytail: the building part is the ground floor under the plane's centre, where the converter
  // uses the storey outlines; a plane over no ground floor matches others over none. Match the
  // converter's part test if extensions without their own ground floor need it.
  const grounds = elements.filter((other) => other.type === 'BuildingElementGround' && (other.coordinates?.length ?? 0) >= 3);
  const part = (plane: Element) => {
    const centre = planCentroid(plane);
    return grounds.findIndex((ground) => isPointInPolygon2D(centre, ground.coordinates));
  };
  const own = part(element);
  // Over no ground floor the part is not known here: claim no sharing rather than a false one.
  if (own < 0) return [];
  return elements.filter((other) => other.id !== element.id && !other.isPlaceholder && planePitch(other) !== undefined
    && roofType(other) === type && part(other) === own);
}

/** The build type that gives the main walls, ground floor and roof the park home constructions. */
export const PARK_HOME = 'park home';

/** The build type the model states: the one chosen in Global Settings, else the file's. */
export function statedBuildType(settings: { build_type?: string; unreadMetadataRows?: Record<string, string> } | undefined): string | undefined {
  return settings?.build_type ?? settings?.unreadMetadataRows?.General_build_type;
}

/**
 * The construction type the converter gives an element, as `hemie.rs` maps it (wall lines by
 * element type, roof planes by pitch, a bay's roof, a room in the roof's flat ceiling, ground
 * floors by floor type, floors over an unheated space, party floors and ceilings, windows, doors
 * by their wall, a thatched loft's planes; on a park home, its main walls, ground floor and roof); undefined for an element
 * it takes no construction from.
 */
export function hemieConstructionType(element: Element, elements: readonly Element[] = [], buildType?: string): string | undefined {
  const type = hemieBaseConstructionType(element, elements);
  // A bay's or dormer's elements keep their own constructions.
  if (buildType !== PARK_HOME || element.extra_json?.dormer_bundle || element.extra_json?.hemie_bundle) return type;
  switch (type) {
    case 'external_wall':
      return level(element) === roomInRoofLevel(elements) ? type : 'park_home_wall';
    case 'flat_roof':
      return 'park_home_flat_roof';
    case 'unheated_pitched_roof':
    case 'thatched_roof':
      return isRoomInRoofCeiling(element, elements) ? type : 'park_home_pitched_roof';
    default:
      return element.type === 'BuildingElementGround' ? 'park_home_floor' : type;
  }
}

function hemieBaseConstructionType(element: Element, elements: readonly Element[]): string | undefined {
  const pitch = hemieElementValue(element, 'pitch');
  const line = (element.coordinates?.length ?? 0) === 2;
  switch (element.type) {
    case 'BuildingElementTransparent':
      return 'window';
    case 'BuildingElementPartyWall':
      return line ? 'party_wall' : undefined;
    case 'BuildingElementAdjacentUnconditionedSpace_Simple':
      if (line) return 'sheltered_wall';
      return typeof pitch === 'number' && pitch > 90 ? 'above_internal_unconditioned_area_floor' : undefined;
    case 'BuildingElementGround':
      return GROUND_FLOOR_CONSTRUCTIONS[String(hemieElementValue(element, 'floor_type'))];
    case 'BuildingElementAdjacentConditionedSpace':
      if (line || hemieElementValue(element, '_vulcan_ui_party_element') !== true || typeof pitch !== 'number') return undefined;
      return pitch > 90 ? 'party_floor' : 'party_ceiling';
    case 'BuildingElementOpaque':
      if (hemieElementValue(element, 'is_external_door') === true) {
        const wall = hostWall(element, elements)?.type;
        return wall === 'BuildingElementPartyWall' || wall === 'BuildingElementAdjacentUnconditionedSpace_Simple'
          ? 'party_or_sheltered_door' : 'external_door';
      }
      if (line) return 'external_wall';
      if (typeof pitch !== 'number') return undefined;
      if (isBayRoof(element)) return pitch === 0 ? 'mini_flat_roof' : 'mini_pitched_roof';
      if (pitch === 0) return isRoomInRoofCeiling(element, elements) ? 'unheated_pitched_roof' : 'flat_roof';
      if (pitch > 90) return 'above_external_area_floor';
      if (pitch < 90 && hemieElementValue(element, 'is_unheated_pitched_roof') !== true) return 'heated_pitched_roof';
      if (pitch < 90) return hemieElementValue(element, 'thatched') === true ? 'thatched_roof' : 'unheated_pitched_roof';
      return undefined;
    default:
      return undefined;
  }
}

/** A construction setting's fields, or undefined when the setting is absent or not a JSON object. */
export function parseHemieConstruction(cell: string | undefined): Record<string, unknown> | undefined {
  if (!cell) return undefined;
  try {
    const value: unknown = JSON.parse(cell);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

export type HemieFabric = Readonly<{
  constructionType: string;
  /** The element's age band: its own, its host wall's (an opening), else the Defaults'. */
  band?: string;
  /** An opening's host wall's own age band, which HEMIE gives the opening over the Defaults'. */
  hostBand?: string;
}>;

/** An element's construction type and age band under construction bands; undefined when the converter takes none. */
export function hemieFabric(
  element: Element,
  settings: Readonly<Record<string, string>> | undefined,
  elements: readonly Element[] = [],
  buildType?: string,
): HemieFabric | undefined {
  const constructionType = hemieConstructionType(element, elements, buildType);
  if (!constructionType) return undefined;
  const opening = element.type === 'BuildingElementTransparent' || constructionType.endsWith('_door');
  const host = opening ? hostWall(element, elements) : undefined;
  const hostBand = host ? hemieElementValue(host, 'age_band') : undefined;
  const band = hemieElementValue(element, 'age_band') ?? hostBand ?? settings?.[HEMIE_AGE_BAND];
  return {
    constructionType,
    ...(band ? { band: String(band) } : {}),
    hostBand: hostBand === undefined ? undefined : String(hostBand),
  };
}
