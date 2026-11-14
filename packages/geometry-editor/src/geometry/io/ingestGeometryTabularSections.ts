// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { roundToTwoDecimals } from '../constants';
import { resolveBuildingElementPitch } from '../derivePitchFromGeometry';
import { calculatePolygonArea } from '../../lib/polygonSync';
import { derivePvDimensionsFromCoords } from '../../lib/pvPanelFootprint';
import type {
  Zone,
  SpaceLabel,
  Element,
  ElementType,
  BuildingElementOpaque,
  BuildingElementTransparent,
  BuildingElementGround,
  BuildingElementAdjacentConditionedSpace,
  BuildingElementAdjacentUnconditionedSpace_Simple,
  BuildingElementPartyWall,
  ThermalBridgeLinear,
  ThermalBridgePoint,
  WindowShading,
  Lighting,
  MechanicalVentilationDuctwork,
  MechanicalVentilationTerminal,
  WetEmitter,
  WaterPipework,
  Appliance,
  HotWaterDemand,
  ContextShading,
  Vents,
  MechanicalVentilation,
  CombustionAppliances,
  OnSiteGeneration,
  ElectricBattery,
  System,
  SystemSubcategory,
} from '../types';
import type { CsvRow, CsvSection } from './csvSectionRows';
import { wallFootFromExportedBaseHeight } from '../../lib/profileLineFace';
import {
  decodePromotedExtraJsonFields,
  validateGeometrySectionHeaders,
} from './geometryCsvLayouts';
import {
  applyMechanicalVentilationCsvPositionColumns,
  normalizeMechanicalVentilationExtraJson,
  normalizeMechanicalVentilationVentType,
} from '../../lib/mechanicalVentilationBranches';

const generateId = () => Math.random().toString(36).substr(2, 9);

/** A finite number as the converter parses a cell (Rust f64 syntax); any other text is E055 or a schema type error there. */
export const NUMBER_CELL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function parseOptionalCoordsColumn(raw: string | undefined): Array<{ x: number; y: number; z: number }> {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return [];
  const cleanCoords = trimmed.replace(/"/g, '');
  return cleanCoords
    .split('|')
    .map((point) => {
      const [xRaw, yRaw, zRaw] = point.split(',');
      const x = Number(xRaw);
      const y = Number(yRaw);
      const z = Number(zRaw);
      return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
        ? { x, y, z }
        : null;
    })
    .filter((coord): coord is { x: number; y: number; z: number } => coord !== null);
}

function parseOptionalEnumColumn<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
): T | undefined {
  const trimmed = String(raw ?? '').trim();
  return (allowed as readonly string[]).includes(trimmed) ? trimmed as T : undefined;
}

function csvRequiredValue<T>(value: T | undefined): T {
  // Missing required CSV fields intentionally remain undefined at runtime so validation can report them.
  return value as T;
}

function parseRequiredEnumColumn<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
): T {
  return csvRequiredValue(parseOptionalEnumColumn(raw, allowed));
}

function V(d: Record<string, string>, k: string): string {
  return (d[k] ?? '').trim();
}

/**
 * Numeric cells of the row being read that hold text, by column. The row's element keeps them in
 * `nonNumericCells`: validation blocks them and the save writes them back as typed.
 */
let rowText: Record<string, string> = {};

function num(d: Record<string, string>, column: string, cell = V(d, column)): number | undefined {
  if (cell === '') return undefined;
  if (!NUMBER_CELL.test(cell)) {
    rowText[column] = cell;
    return undefined;
  }
  return roundToTwoDecimals(Number(cell));
}

/**
 * base_height of an opaque or transparent row. For a profiled wall the cell is the lowest edge
 * (see exportedBaseHeightForWallFace); the offset is removed from the exact cell before the
 * usual 2 dp rounding, so the foot comes back as it was saved.
 */
function wallFootCell(d: Record<string, string>, extraJson: unknown): number | undefined {
  const cell = V(d, 'base_height');
  if (cell === '' || !NUMBER_CELL.test(cell)) return num(d, 'base_height');
  return roundToTwoDecimals(wallFootFromExportedBaseHeight(Number(cell), extraJson)!);
}

function reqNum(d: Record<string, string>, column: string, cell?: string): number {
  return csvRequiredValue(num(d, column, cell));
}

function takeRowText(): Record<string, string> | undefined {
  const cells = rowText;
  rowText = {};
  return Object.keys(cells).length > 0 ? cells : undefined;
}

function viewerBaseHeightPatch(d: Record<string, string>): { _base_height?: number } {
  const value = num(d, 'base_height');
  return value === undefined ? {} : { _base_height: value };
}

function groundViewerBaseHeightPatch(d: Record<string, string>): { _base_height?: number } {
  const floorType = V(d, 'floor_type');
  if (floorType === 'Heated_basement' || floorType === 'Unheated_basement') {
    return {};
  }
  return viewerBaseHeightPatch(d);
}

function normalizeContextShadingShadingType(raw: string | undefined): 'obstacle' | 'overhang' | undefined {
  // The converter reads these two exact values; anything else stays blank and blocks.
  const value = String(raw ?? '').trim();
  return value === 'overhang' || value === 'obstacle' ? value : undefined;
}

const BUILDING_ROW_KEYS = ['Zone', 'Type'] as const;
/**
 * Row cells without which the load stops, naming the section and row, so no row is dropped unseen.
 * Every row needs a Name: the editor cannot hold a row without one, and the converter stops on most
 * sections without one. These sections also need the cells listed, without which the converter
 * stops the whole conversion (E008-E029). The converter does not read Space Labels, so every label
 * row loads and saves as it is.
 */
const REQUIRED_ROW_KEYS: Readonly<Record<string, readonly ('Zone' | 'Type')[]>> = {
  'Exposed Elements': BUILDING_ROW_KEYS,
  'Window Elements': BUILDING_ROW_KEYS,
  'Ground Elements': BUILDING_ROW_KEYS,
  'Non-Exposed Elements': BUILDING_ROW_KEYS,
  'Thermal Bridging Elements': BUILDING_ROW_KEYS,
  'Window Shading': ['Zone'],
  Lighting: ['Zone'],
  'Wet Emitters': ['Zone'],
  'Hot Water Outlets': ['Type'],
  'Ventilation Systems': ['Type'],
};

/**
 * The row Types the editor loads, by section. The Rust test editor_row_types_match_the_converter
 * (crates/vulcan-model-transform/src/builder.rs) reads the JSON between the markers and runs every
 * Type through the converter, so this table cannot drift from the Types the converter accepts.
 * Aliases load as their type, which gives the converter the same model. Unkept Types are ones the
 * converter accepts that no editor element reproduces; the load stops with the message given.
 */
// csv-row-types:begin
const CSV_ROW_TYPES = {
  "buildingTypes": [
    "BuildingElementOpaque",
    "BuildingElementTransparent",
    "BuildingElementGround",
    "BuildingElementAdjacentConditionedSpace",
    "BuildingElementAdjacentUnconditionedSpace_Simple",
    "BuildingElementPartyWall"
  ],
  "buildingAliases": {
    "Wall": "BuildingElementOpaque",
    "Roof": "BuildingElementOpaque",
    "Door": "BuildingElementOpaque",
    "Window": "BuildingElementTransparent",
    "Floor": "BuildingElementGround",
    "Internal": "BuildingElementAdjacentConditionedSpace",
    "Basement": "BuildingElementGround"
  },
  "rowTypes": {
    "Thermal Bridging Elements": ["ThermalBridgeLinear", "ThermalBridgePoint"],
    "Systems": ["System", "ElectricBattery", "SpaceHeatSystem"],
    "Ventilation Systems": ["MechanicalVentilation", "Vents", "MechanicalVentilationDuctwork", "MechanicalVentilationTerminal"]
  },
  "unkeptTypes": {
    "Building": {
      "Party":
        "which the converter reads as a party element of any pitch; the editor marks only a party floor that way. Enter BuildingElementAdjacentConditionedSpace or BuildingElementPartyWall"
    },
    "Systems": {
      "WetDistribution":
        "which the converter builds from the defaults' wet distribution template; the editor has no such row. Enter Type System with subcategory SpaceHeatSystem and the system in extra_json under SpaceHeatSystem"
    }
  }
};
// csv-row-types:end
const BUILDING_SECTIONS = new Set(['Exposed Elements', 'Window Elements', 'Ground Elements', 'Non-Exposed Elements']);
export const BUILDING_ALIASES: Readonly<Record<string, string>> = CSV_ROW_TYPES.buildingAliases;
const UNKEPT_TYPES: Readonly<Record<string, Readonly<Record<string, string>>>> = CSV_ROW_TYPES.unkeptTypes;
/**
 * The row types the editor reads (CSV_ROW_TYPES), where the converter routes the row by its Type
 * and rejects or leaves out any other (E056, E028, E065). The load stops on another Type, naming the
 * row, so no row is dropped unseen. Sections not listed (Wet Emitters, Water Pipework, Combustion
 * Appliances, Hot Water Outlets) are read whatever their Type says, as the converter reads them.
 */
const ROW_TYPES: Readonly<Record<string, readonly string[]>> = {
  ...Object.fromEntries([...BUILDING_SECTIONS].map((name) => [name, [...CSV_ROW_TYPES.buildingTypes, ...Object.keys(BUILDING_ALIASES)]])),
  ...CSV_ROW_TYPES.rowTypes,
};

/** Whether a SpaceHeatSystem row's extra_json has the key that makes the converter read it as a System row does. */
function extraJsonHasSpaceHeatSystem(cell: string): boolean {
  try {
    return 'SpaceHeatSystem' in JSON.parse(cell);
  } catch {
    return false;
  }
}

/** A Systems row's type, as the converter reads it: the first of these cells that is not blank. */
const systemsRowType = (d: Record<string, string>) => V(d, 'Type') || V(d, 'system_type') || V(d, 'subcategory');

function assertRowKeys(section: CsvSection, d: CsvRow['data'], zoneNames: Readonly<Record<string, string>>): void {
  // A row of empty cells is a spacer, not a row.
  if (Object.values(d).every((cell) => !cell?.trim())) return;
  const name = V(d, 'Name');
  const row = name ? `${section.name} row '${name}'` : `${/^[AEIOU]/.test(section.name) ? 'An' : 'A'} ${section.name} row`;
  for (const key of ['Name', ...(REQUIRED_ROW_KEYS[section.name] ?? [])]) {
    if (!V(d, key)) throw new Error(`${row} has no ${key}. Enter the ${key} in the file and open it again.`);
  }
  const types = ROW_TYPES[section.name];
  const type = section.name === 'Systems' ? systemsRowType(d) : V(d, 'Type');
  const unkept = UNKEPT_TYPES[BUILDING_SECTIONS.has(section.name) ? 'Building' : section.name]?.[type];
  if (unkept) throw new Error(`${row} has Type '${type}', ${unkept} in the file and open it again.`);
  // Only with its system in extra_json does the converter read a SpaceHeatSystem row as a System row.
  if (section.name === 'Systems' && type === 'SpaceHeatSystem' && !extraJsonHasSpaceHeatSystem(V(d, 'extra_json'))) {
    throw new Error(`${row} has Type 'SpaceHeatSystem' with no SpaceHeatSystem key in extra_json, which the converter builds from the defaults' wet distribution template; the editor has no such row. Enter the system in extra_json under SpaceHeatSystem in the file and open it again.`);
  }
  if (types && !types.includes(type)) {
    throw new Error(`${row} ${type ? `has Type '${type}', which is not a ${section.name} type` : 'has no Type'}. Enter one of ${types.join(', ')} in the file and open it again.`);
  }
  const zone = V(d, 'Zone');
  if (zone && section.columnHeaders.includes('Zone') && !(zone in zoneNames)) {
    throw new Error(`${row} names zone '${zone}', which is not in the Zone section. Correct the zone in the file and open it again.`);
  }
}

function findOverflowCoordsCell(
  section: CsvSection,
  row: CsvRow,
): string {
  const coordsIndex = section.columnHeaders.findIndex((header) => header === 'coords');
  if (coordsIndex < 0) return '';
  for (const field of row.fields.slice(coordsIndex + 1)) {
    const candidate = field.trim();
    if (parseOptionalCoordsColumn(candidate).length > 0) return candidate;
  }
  return '';
}

export function ingestGeometryTabularSections(
  sections: CsvSection[],
  parseExtraJson: (jsonString: string, elementName?: string) => Record<string, unknown> | undefined,
): { zones: Zone[]; elements: Element[]; spaceLabels: SpaceLabel[] } {
  const newZones: Zone[] = [];
  const zoneNameToId: Record<string, string> = {};
  const newElements: Element[] = [];
  const newSpaceLabels: SpaceLabel[] = [];

  const resolveZones = () => {
    for (const section of sections) {
      if (section.name !== 'Zone') continue;
      validateGeometrySectionHeaders(section.name, section.columnHeaders);
      for (const row of section.rows) {
        const d = row.data;
        const zoneName = V(d, 'Name');
        if (zoneName === 'Name') continue;
        assertRowKeys(section, d, zoneNameToId);
        if (!zoneName) continue;
        rowText = {};
        const floorArea = num(d, 'floor_area');
        const volume = num(d, 'volume');
        const height = num(d, 'height');
        const simplifiedThermalBridging = V(d, 'simplified thermal bridging') === 'TRUE';
        const livingroomArea =
          V(d, 'livingroom_area') !== '' ? num(d, 'livingroom_area') : undefined;
        const restOfDwellingArea =
          V(d, 'restofdwelling_area') !== ''
            ? num(d, 'restofdwelling_area')
            : undefined;

        const zoneId = generateId();
        zoneNameToId[zoneName] = zoneId;
        newZones.push({
          id: zoneId,
          name: zoneName,
          floorArea: csvRequiredValue(floorArea),
          height: csvRequiredValue(height),
          volume,
          simplifiedThermalBridging,
          livingroom_area: livingroomArea,
          restofdwelling_area: restOfDwellingArea,
          nonNumericCells: takeRowText(),
        });
      }
    }
  };

  resolveZones();

  for (const section of sections) {
    if (section.name === 'Zone') continue;
    if (section.name === 'Test Section') continue;

    if (section.name === 'Space Labels') {
      validateGeometrySectionHeaders(section.name, section.columnHeaders);
      for (const row of section.rows) {
        const d = row.data;
        const slName = V(d, 'Name');
        if (slName === 'Name' || Object.values(d).every((cell) => !cell?.trim())) continue;
        const zoneName = V(d, 'Zone');
        const zoneId = zoneNameToId[zoneName] ?? '';
        const parsedStorey = num(d, 'storey');
        const storey = parsedStorey === undefined ? undefined : Math.max(0, Math.floor(parsedStorey));
        const room_type = V(d, 'room_type').trim();
        const coords = parseOptionalCoordsColumn(V(d, 'coords'));
        const hoRaw = V(d, 'height_override');
        const hoParsed = hoRaw !== '' ? parseFloat(hoRaw) : NaN;
        const height_override =
          hoRaw !== '' && Number.isFinite(hoParsed) ? roundToTwoDecimals(hoParsed) : undefined;
        const extra = parseExtraJson(V(d, 'extra_json'), V(d, 'Name'));
        const rawSource = typeof extra?.space_label_source === 'string' ? extra.space_label_source : '';
        const source =
          rawSource === 'inferred' || rawSource === 'manual' || rawSource === 'edited_inferred'
            ? rawSource
            : undefined;
        newSpaceLabels.push({
          id: generateId(),
          name: slName,
          zoneId,
          ...(zoneId ? {} : { zoneName }),
          storey: csvRequiredValue(storey),
          room_type,
          coordinates: coords,
          ...(source ? { source } : {}),
          ...(height_override !== undefined ? { height_override } : {}),
          ...(extra && Object.keys(extra).length > 0 ? { extra_json: extra } : {}),
        });
      }
      continue;
    }

    validateGeometrySectionHeaders(section.name, section.columnHeaders);

    for (const row of section.rows) {
      const d = row.data;
      const name = V(d, 'Name');
      if (name === 'Name') continue;
      assertRowKeys(section, d, zoneNameToId);
      if (!name) continue;
      rowText = {};
      const elementCount = newElements.length;

      switch (section.name) {
        case 'Exposed Elements':
        case 'Window Elements':
        case 'Ground Elements':
        case 'Non-Exposed Elements':
        case 'Thermal Bridging Elements': {
          const zoneName = V(d, 'Zone');
          // The converter's older aliases (Wall, Roof and so on) give it the same model as their type.
          const elementType = (BUILDING_ALIASES[V(d, 'Type')] ?? V(d, 'Type')) as ElementType;
          const zoneId = zoneNameToId[zoneName];
          if (!zoneId) continue;

          const baseElement = {
            id: generateId(),
            name,
            zoneId,
            type: elementType,
            isPlaceholder: !name.trim(),
          };

          switch (elementType) {
            case 'BuildingElementOpaque': {
              const pitchOpt = num(d, 'pitch');
              const opaqueCoords = parseOptionalCoordsColumn(V(d, 'coords'));
              const opaquePitch = resolveBuildingElementPitch({
                type: 'BuildingElementOpaque',
                pitch: pitchOpt ?? null,
                coordinates: opaqueCoords,
              });
              const opaqueExtraJson = parseExtraJson(V(d, 'extra_json'), V(d, 'Name'));
              const opaqueElement: BuildingElementOpaque = {
                ...baseElement,
                type: 'BuildingElementOpaque',
                width: reqNum(d, 'width'),
                height: reqNum(d, 'height'),
                area: reqNum(d, 'area'),
                ...(opaquePitch !== undefined ? { pitch: opaquePitch } : {}),
                orientation360: num(d, 'orientation360'),
                base_height: wallFootCell(d, opaqueExtraJson),
                // A blank cell stays unset: the target schema requires a choice for a roof, with no default.
                is_unheated_pitched_roof: V(d, 'is_unheated_pitched_roof') ? V(d, 'is_unheated_pitched_roof') === 'TRUE' : undefined,
                is_external_door: V(d, 'is_external_door') === 'TRUE',
                parent_element: V(d, 'parent_element') ? V(d, 'parent_element') : null,
                coordinates: opaqueCoords,
                extra_json: opaqueExtraJson,
              };
              newElements.push(opaqueElement);
              break;
            }
            case 'BuildingElementTransparent': {
              const pitchOptT = num(d, 'pitch');
              const transparentCoords = parseOptionalCoordsColumn(V(d, 'coords'));
              const transparentPitch = resolveBuildingElementPitch({
                type: 'BuildingElementTransparent',
                pitch: pitchOptT ?? null,
                coordinates: transparentCoords,
              });
              const transparentExtraJson = parseExtraJson(V(d, 'extra_json'), V(d, 'Name'));
              const transparentElement: BuildingElementTransparent = {
                ...baseElement,
                type: 'BuildingElementTransparent',
                width: reqNum(d, 'width'),
                height: reqNum(d, 'height'),
                area: reqNum(d, 'area'),
                ...(transparentPitch !== undefined ? { pitch: transparentPitch } : {}),
                orientation360: num(d, 'orientation360'),
                base_height: wallFootCell(d, transparentExtraJson),
                parent_element: V(d, 'linked_wall') ? V(d, 'linked_wall') : null,
                frame_area_fraction: num(d, 'frame_area_fraction'),
                free_area_height: num(d, 'free_area_height'),
                mid_height: num(d, 'mid_height'),
                max_window_open_area: num(d, 'max_window_open_area'),
                coordinates: transparentCoords,
                extra_json: transparentExtraJson,
              };
              newElements.push(transparentElement);
              break;
            }
            case 'BuildingElementGround': {
              const floorType = parseRequiredEnumColumn(V(d, 'floor_type'), [
                'Heated_basement',
                'Slab_no_edge_insulation',
                'Slab_edge_insulation',
                'Suspended_floor',
                'Unheated_basement',
              ]);
              const totalArea = num(d, 'total_area');
              const groundElement: BuildingElementGround = {
                ...baseElement,
                type: 'BuildingElementGround',
                area: reqNum(d, 'area'),
                total_area: totalArea ?? reqNum(d, 'area'),
                width: reqNum(d, 'width'),
                height: reqNum(d, 'height'),
                perimeter: reqNum(d, 'perimeter'),
                floor_type: floorType,
                depth_basement_floor: num(d, 'depth_basement_floor'),
                thickness_walls: num(d, 'thickness_walls'),
                parent_element: V(d, 'parent_element') ? V(d, 'parent_element') : null,
                coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
                ...groundViewerBaseHeightPatch(d),
                extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
              };
              newElements.push(groundElement);
              break;
            }
            case 'BuildingElementAdjacentConditionedSpace':
            case 'BuildingElementAdjacentUnconditionedSpace_Simple':
            case 'BuildingElementPartyWall': {
              const pitchAdj = num(d, 'pitch');
              const viewerBaseHeight = num(d, 'base_height');
              const adjacentCoords = parseOptionalCoordsColumn(V(d, 'coords'));
              const pitchForStore = resolveBuildingElementPitch({
                type: elementType,
                pitch: pitchAdj ?? null,
                coordinates: adjacentCoords,
              });
              const adjacentElement = {
                ...baseElement,
                type: elementType,
                width: reqNum(d, 'width'),
                height: reqNum(d, 'height'),
                area: reqNum(d, 'area'),
                ...(pitchForStore !== undefined ? { pitch: pitchForStore } : {}),
                parent_element: V(d, 'parent_element') ? V(d, 'parent_element') : null,
                coordinates: adjacentCoords,
                ...(viewerBaseHeight !== undefined ? { _base_height: viewerBaseHeight } : {}),
                extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
              };
              newElements.push(
                adjacentElement as
                  | BuildingElementAdjacentConditionedSpace
                  | BuildingElementAdjacentUnconditionedSpace_Simple
                  | BuildingElementPartyWall,
              );
              break;
            }
            case 'ThermalBridgeLinear': {
              const linearBridge: ThermalBridgeLinear = {
                ...baseElement,
                type: 'ThermalBridgeLinear',
                length: reqNum(d, 'length'),
                linear_thermal_transmittance: reqNum(d, 'linear_thermal_transmittance'),
                parent_element: V(d, 'parent_element') ? V(d, 'parent_element') : null,
                coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
                extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
              };
              newElements.push(linearBridge);
              break;
            }
            case 'ThermalBridgePoint': {
              const pointBridge: ThermalBridgePoint = {
                ...baseElement,
                type: 'ThermalBridgePoint',
                heat_transfer_coeff: reqNum(d, 'heat_transfer_coeff'),
                parent_element: V(d, 'parent_element') ? V(d, 'parent_element') : null,
                coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
                extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
              };
              newElements.push(pointBridge);
              break;
            }
            default:
              break;
          }
          break;
        }
        case 'Window Shading': {
          const zoneName = V(d, 'Zone');
          const zoneId = zoneNameToId[zoneName];
          if (!zoneId) continue;
          const shadingType = parseOptionalEnumColumn(V(d, 'Type'), [
            'object',
            'overhang',
            'sidefinright',
            'sidefinleft',
            'reveal',
          ]);
          const linkedWindow = V(d, 'linked_window');
          const windowShadingElement: WindowShading = {
            id: generateId(),
            name,
            zoneId,
            type: 'WindowShading',
            shading_type: csvRequiredValue(shadingType),
            depth: num(d, 'depth'),
            height: num(d, 'height'),
            distance: num(d, 'distance'),
            transparency: num(d, 'transparency'),
            parent_element: linkedWindow || null,
            coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
            ...viewerBaseHeightPatch(d),
            extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
          };
          newElements.push(windowShadingElement);
          break;
        }
        case 'Lighting': {
          const zoneName = V(d, 'Zone');
          const zoneId = zoneNameToId[zoneName];
          if (!zoneId) continue;
          const lightingElement: Lighting = {
            id: generateId(),
            name,
            zoneId,
            type: 'Lighting',
            simplified_lighting: false,
            efficacy: reqNum(d, 'efficacy'),
            count: num(d, 'count'),
            power: num(d, 'power'),
            parent_element: null,
            coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
            ...viewerBaseHeightPatch(d),
            extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
          };
          newElements.push(lightingElement);
          break;
        }
        case 'Context Shading': {
          // As the converter: Type gives the shading kind only in a file with no shading_type column
          // (older files stored obstacle or overhang there). A blank stays blank and blocks.
          const shadingTypeRaw = 'shading_type' in d ? V(d, 'shading_type') : V(d, 'Type');
          const shading_type = normalizeContextShadingShadingType(shadingTypeRaw) as ContextShading['shading_type'];
          const startAngleCell = V(d, 'start_angle') || V(d, 'start angle');
          const endAngleCell = V(d, 'end_angle') || V(d, 'end angle');
          const coordsCell = V(d, 'coords') || findOverflowCoordsCell(section, row);
          const rawCoords = parseOptionalCoordsColumn(coordsCell);
          const coords = rawCoords;

          const contextShadingElement: ContextShading = {
            id: generateId(),
            name,
            type: 'ContextShading',
            shading_type,
            start_angle: reqNum(d, 'start_angle', startAngleCell),
            end_angle: reqNum(d, 'end_angle', endAngleCell),
            distance: reqNum(d, 'distance'),
            height: reqNum(d, 'height'),
            parent_element: V(d, 'parent_element') || null,
            coordinates: coords,
            ...viewerBaseHeightPatch(d),
            extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
          };
          newElements.push(contextShadingElement);
          break;
        }
        case 'On-Site Generation': {
          const explicitWidth = num(d, 'width') ?? NaN;
          const explicitHeight = num(d, 'height') ?? NaN;
          const onSiteElement: OnSiteGeneration = {
            id: generateId(),
            name,
            type: 'OnSiteGeneration',
            generation_type: parseRequiredEnumColumn(V(d, 'generation_type'), ['PhotovoltaicSystem']),
            pitch: num(d, 'pitch'),
            orientation360: num(d, 'orientation360'),
            base_height: num(d, 'base_height'),
            peak_power: num(d, 'peak_power'),
            coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
            extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
            parent_element: null,
          };
          if (explicitWidth > 0) onSiteElement.width = explicitWidth;
          if (explicitHeight > 0) onSiteElement.height = explicitHeight;
          if (onSiteElement.coordinates && onSiteElement.coordinates.length >= 3) {
            try {
              onSiteElement.area = roundToTwoDecimals(calculatePolygonArea(onSiteElement.coordinates));
            } catch {
              /* ignore */
            }
            // Backward-compat: if CSV pre-dates the width/height columns, derive
            // slope-corrected dimensions from coords + pitch (mirrored in Rust merger).
            // Without a pitch the slope length is unknown: a host roof may supply the pitch later.
            if ((onSiteElement.width === undefined || onSiteElement.height === undefined) && onSiteElement.pitch !== undefined) {
              const derived = derivePvDimensionsFromCoords(
                onSiteElement.coordinates,
                onSiteElement.pitch,
              );
              if (derived) {
                if (onSiteElement.width === undefined) {
                  onSiteElement.width = roundToTwoDecimals(derived.width);
                }
                if (onSiteElement.height === undefined) {
                  onSiteElement.height = roundToTwoDecimals(derived.height);
                }
              }
            }
          }
          newElements.push(onSiteElement);
          break;
        }
        case 'Systems': {
          const zoneName = V(d, 'Zone');
          const rowType = systemsRowType(d);
          if (rowType === 'System' || rowType === 'SpaceHeatSystem') {
            const subcategory = rowType === 'SpaceHeatSystem' ? 'SpaceHeatSystem' : parseOptionalEnumColumn<SystemSubcategory>(V(d, 'subcategory'), [
              'HeatSourceWet',
              'HotWaterSource',
              'HotWaterDemand',
              'InfiltrationVentilation',
              'SpaceCoolSystem',
              'SpaceHeatSystem',
              'WWHRS',
            ]);
            const systemPreset = V(d, 'system_preset');
            const extraJson = parseExtraJson(V(d, 'extra_json'), V(d, 'Name')) || {};
            // Systems are point-only editor elements. Older CSVs can contain a
            // second coordinate, which otherwise makes them render as lines and
            // prevents the point drag interaction from being available.
            const coordinates = parseOptionalCoordsColumn(V(d, 'coords')).slice(0, 1);
            const systemElement: System = {
              id: generateId(),
              name,
              type: 'System',
              subcategory: csvRequiredValue(subcategory),
              system_preset: systemPreset || undefined,
              coordinates,
              ...viewerBaseHeightPatch(d),
              extra_json: Object.keys(extraJson).length > 0 ? extraJson : undefined,
              parent_element: null,
            };
            if (zoneName) {
              const zone = newZones.find((z) => z.name === zoneName);
              if (zone) systemElement.zoneId = zone.id;
            }
            newElements.push(systemElement);
          } else if (rowType === 'ElectricBattery') {
            const parsedExtraJson = parseExtraJson(V(d, 'extra_json'), V(d, 'Name')) || {};
            const extraJson = { ...(parsedExtraJson as Record<string, unknown>) };
            // grid_charging_possible stays as typed: the converter drops it for a target without it.
            delete extraJson.threshold_charges;
            delete extraJson.threshold_prices;
            delete extraJson.tariff;
            const { promotedFields, advancedExtraJson } = decodePromotedExtraJsonFields(
              'ElectricBattery',
              extraJson,
            );
            const locRaw = promotedFields.battery_location;
            const battery_location: ElectricBattery['battery_location'] | undefined =
              locRaw === 'outside' || locRaw === 'inside' ? locRaw : undefined;
            const batteryElement: ElectricBattery = {
              id: generateId(),
              name,
              type: 'ElectricBattery',
              capacity: promotedFields.capacity as number | undefined,
              charge_discharge_efficiency_round_trip: promotedFields.charge_discharge_efficiency_round_trip as number | undefined,
              battery_location,
              coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
              ...viewerBaseHeightPatch(d),
              extra_json: advancedExtraJson,
              parent_element: null,
            };
            if (zoneName) {
              const zone = newZones.find((z) => z.name === zoneName);
              if (zone) batteryElement.zoneId = zone.id;
            }
            newElements.push(batteryElement);
          }
          break;
        }
        case 'Ventilation Systems': {
          const elementType = V(d, 'Type') as ElementType;
          if (elementType === 'MechanicalVentilation') {
            const parsedExtra = parseExtraJson(V(d, 'extra_json'), V(d, 'Name')) || {};
            const csvVentType = parseOptionalEnumColumn(V(d, 'vent_type'), [
              'Intermittent MEV',
              'Centralised continuous MEV',
              'Decentralised continuous MEV',
              'MVHR',
              // HEM:EPC only; the converter rejects it for other targets.
              'Positive input ventilation',
            ]);
            const ventType =
              csvVentType ??
              normalizeMechanicalVentilationVentType((parsedExtra as Record<string, unknown>).vent_type);
            const positionColumns: Partial<Record<'mid_height_air_flow_path' | 'orientation360' | 'pitch', unknown>> = {};
            for (const column of ['mid_height_air_flow_path', 'orientation360', 'pitch'] as const) {
              const parsed = num(d, column);
              if (parsed !== undefined) positionColumns[column] = parsed;
            }
            const mergedExtra = Object.keys(positionColumns).length > 0
              ? applyMechanicalVentilationCsvPositionColumns(parsedExtra, ventType, positionColumns)
              : normalizeMechanicalVentilationExtraJson(parsedExtra, { ventType });
            newElements.push({
              id: generateId(),
              name,
              type: 'MechanicalVentilation',
              vent_type: csvRequiredValue(ventType as MechanicalVentilation['vent_type'] | undefined),
              parent_element: V(d, 'parent_element') || null,
              coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
              extra_json: Object.keys(mergedExtra).length > 0 ? mergedExtra : undefined,
            });
          } else if (elementType === 'Vents') {
            const midHeightAirFlowPath = num(d, 'mid_height_air_flow_path');
            newElements.push({
              id: generateId(),
              name,
              type: 'Vents',
              mid_height_air_flow_path: csvRequiredValue<Vents['mid_height_air_flow_path']>(midHeightAirFlowPath),
              area_cm2: reqNum(d, 'area_cm2'),
              orientation360: num(d, 'orientation360'),
              pitch: num(d, 'pitch'),
              parent_element: V(d, 'parent_element') || null,
              coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
              extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
            });
          } else if (elementType === 'MechanicalVentilationDuctwork') {
            const parentElementName = V(d, 'parent_element');
            let zoneId: string | undefined;
            if (parentElementName) {
              const zone = newZones.find((z) => z.name === parentElementName);
              if (zone) zoneId = zone.id;
            }
            const ductworkElement: MechanicalVentilationDuctwork = {
              id: generateId(),
              name,
              type: 'MechanicalVentilationDuctwork',
              duct_type: parseRequiredEnumColumn(V(d, 'duct_type'), ['supply', 'extract', 'intake', 'exhaust']),
              length: reqNum(d, 'length'),
              parent_element: parentElementName || null,
              coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
              extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
            };
            if (zoneId) ductworkElement.zoneId = zoneId;
            newElements.push(ductworkElement);
          } else if (elementType === 'MechanicalVentilationTerminal') {
            const terminalCoords = parseOptionalCoordsColumn(V(d, 'coords'));
            const csvMidHeight = num(d, 'mid_height_air_flow_path');
            const coordMidHeight = Number.isFinite(terminalCoords[0]?.z)
              ? roundToTwoDecimals(terminalCoords[0].z)
              : undefined;
            const terminalElement: MechanicalVentilationTerminal = {
              id: generateId(),
              name,
              type: 'MechanicalVentilationTerminal',
              terminal_type: parseRequiredEnumColumn(V(d, 'terminal_type'), ['intake', 'exhaust']),
              parent_element: V(d, 'parent_element') || null,
              host_element: V(d, 'host_element') || null,
              mid_height_air_flow_path: csvMidHeight ?? coordMidHeight,
              orientation360: num(d, 'orientation360'),
              pitch: num(d, 'pitch'),
              coordinates: terminalCoords,
              extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
            };
            newElements.push(terminalElement);
          }
          break;
        }
        case 'Combustion Appliances': {
          newElements.push({
            id: generateId(),
            name,
            type: 'CombustionAppliances',
            appliance_type: parseRequiredEnumColumn<CombustionAppliances['appliance_type']>(V(d, 'appliance_type'), [
              'open_fireplace',
              'closed_with_fan',
              'open_gas_flue_balancer',
              'open_gas_kitchen_stove',
              'open_gas_fire',
              'closed_fire',
            ]),
            exhaust_situation: parseRequiredEnumColumn<CombustionAppliances['exhaust_situation']>(V(d, 'exhaust_situation'), [
              'into_room',
              'into_separate_duct',
              'into_mech_vent',
            ]),
            fuel_type: parseRequiredEnumColumn<CombustionAppliances['fuel_type']>(V(d, 'fuel_type'), ['wood', 'gas', 'oil', 'coal']),
            supply_situation: parseRequiredEnumColumn<CombustionAppliances['supply_situation']>(V(d, 'supply_situation'), ['room_air', 'outside']),
            parent_element: null,
            coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
            ...viewerBaseHeightPatch(d),
            extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
          });
          break;
        }
        case 'Water Pipework': {
          // The converter reads every row of this section as pipework, whatever its Type says.
          newElements.push({
            id: generateId(),
            name,
            type: 'WaterPipework',
            simplified_pipework: false,
            length: reqNum(d, 'length'),
            location: parseRequiredEnumColumn<WaterPipework['location']>(V(d, 'location'), ['internal', 'external']),
            pipework_type: parseRequiredEnumColumn<WaterPipework['pipework_type']>(V(d, 'pipework_type'), ['primary', 'distribution']),
            parent_element: null,
            coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
            extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
          });
          break;
        }
        case 'Appliances': {
          newElements.push({
            id: generateId(),
            name,
            type: 'Appliance',
            appliancekey: V(d, 'appliancekey') as Appliance['appliancekey'],
            parent_element: null,
            coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
            ...viewerBaseHeightPatch(d),
            extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
          });
          break;
        }
        case 'Hot Water Outlets': {
          const subcategory = parseOptionalEnumColumn(V(d, 'subcategory'), [
            'OtherWaterUseDetails',
            'MixerShower',
            'InstantElecShower',
            'Bath',
          ]);
          const boolColumn = V(d, 'allow_low_flowrate').toUpperCase();
          const hasAllowLowFlowrateValue = boolColumn === 'TRUE' || boolColumn === 'FALSE';
          const hotWaterDemandElement: HotWaterDemand = {
            id: generateId(),
            name,
            type: 'HotWaterDemand',
            subcategory: csvRequiredValue(subcategory),
            allow_low_flowrate:
              hasAllowLowFlowrateValue && subcategory === 'MixerShower' ? boolColumn === 'TRUE' : undefined,
            size: num(d, 'size'),
            flowrate: num(d, 'flowrate'),
            rated_power: num(d, 'rated_power'),
            parent_element: null,
            coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
            ...viewerBaseHeightPatch(d),
            extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
          };
          newElements.push(hotWaterDemandElement);
          break;
        }
        case 'Wet Emitters': {
          const zoneName = V(d, 'Zone');
          // assertRowKeys has checked the zone. The converter reads every row of this section as an
          // emitter, whatever its Type says.
          const zoneId = zoneNameToId[zoneName];
          newElements.push({
            id: generateId(),
            name,
            zoneId,
            type: 'WetEmitter',
            subcategory: parseRequiredEnumColumn<WetEmitter['subcategory']>(V(d, 'subcategory'), ['radiator', 'ufh', 'fancoil']),
            area: num(d, 'area'),
            // Not rounded: the converter stops on a unit count that is not a whole number.
            unit_number: num(d, 'unit_number') === undefined ? undefined : Number(V(d, 'unit_number')),
            // '' when the table has the column blank (linked to nothing); undefined when it has no such column.
            space_heat_system: 'space_heat_system' in d ? V(d, 'space_heat_system') : undefined,
            parent_element: null,
            coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
            ...viewerBaseHeightPatch(d),
            extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
          });
          break;
        }
        default:
          break;
      }
      const nonNumericCells = takeRowText();
      if (nonNumericCells && newElements.length > elementCount) newElements[newElements.length - 1].nonNumericCells = nonNumericCells;
    }
  }

  return { zones: newZones, elements: newElements, spaceLabels: newSpaceLabels };
}
