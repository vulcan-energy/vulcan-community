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

function parseOptionalPitchColumn(raw: string | undefined): number | undefined {
  if (raw === undefined || String(raw).trim() === '') return undefined;
  const p = parseFloat(String(raw).trim());
  if (!Number.isFinite(p)) return undefined;
  return roundToTwoDecimals(p);
}

function parseOptionalNumberColumn(raw: string | undefined): number | undefined {
  if (raw === undefined || String(raw).trim() === '') return undefined;
  const n = parseFloat(String(raw).trim());
  if (!Number.isFinite(n)) return undefined;
  return roundToTwoDecimals(n);
}

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

function parseRequiredNumberColumn(raw: string | undefined): number {
  return csvRequiredValue(parseOptionalNumberColumn(raw));
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

function viewerBaseHeightPatch(d: Record<string, string>): { _base_height?: number } {
  const value = parseOptionalNumberColumn(V(d, 'base_height'));
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
  const normalized = String(raw ?? '').trim().toLowerCase();
  if (normalized === 'overhang' || normalized === 'obstacle') return normalized;
  if (normalized === 'contextshading' || normalized === 'context shading') return 'obstacle';
  return undefined;
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
        if (!zoneName || zoneName === 'Name') continue;
        const floorArea = parseOptionalNumberColumn(V(d, 'floor_area'));
        const volume = parseOptionalNumberColumn(V(d, 'volume'));
        const height = parseOptionalNumberColumn(V(d, 'height'));
        const simplifiedThermalBridging = V(d, 'simplified thermal bridging') === 'TRUE';
        const livingroomArea =
          V(d, 'livingroom_area') !== '' ? parseOptionalNumberColumn(V(d, 'livingroom_area')) : undefined;
        const restOfDwellingArea =
          V(d, 'restofdwelling_area') !== ''
            ? parseOptionalNumberColumn(V(d, 'restofdwelling_area'))
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
        if (!slName || slName === 'Name') continue;
        const zoneName = V(d, 'Zone');
        const zoneId = zoneNameToId[zoneName];
        if (!zoneId) continue;
        const parsedStorey = parseOptionalNumberColumn(V(d, 'storey'));
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
      if (!name || name === 'Name') continue;

      switch (section.name) {
        case 'Exposed Elements':
        case 'Window Elements':
        case 'Ground Elements':
        case 'Non-Exposed Elements':
        case 'Thermal Bridging Elements': {
          const zoneName = V(d, 'Zone');
          const elementType = V(d, 'Type') as ElementType;
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
              const pitchOpt = parseOptionalPitchColumn(V(d, 'pitch'));
              const opaqueCoords = parseOptionalCoordsColumn(V(d, 'coords'));
              const opaquePitch = resolveBuildingElementPitch({
                type: 'BuildingElementOpaque',
                pitch: pitchOpt ?? null,
                coordinates: opaqueCoords,
              });
              const opaqueElement: BuildingElementOpaque = {
                ...baseElement,
                type: 'BuildingElementOpaque',
                width: parseRequiredNumberColumn(V(d, 'width')),
                height: parseRequiredNumberColumn(V(d, 'height')),
                area: parseRequiredNumberColumn(V(d, 'area')),
                ...(opaquePitch !== undefined ? { pitch: opaquePitch } : {}),
                orientation360: parseOptionalNumberColumn(V(d, 'orientation360')),
                base_height: parseOptionalNumberColumn(V(d, 'base_height')),
                is_unheated_pitched_roof: V(d, 'is_unheated_pitched_roof') === 'TRUE',
                is_external_door: V(d, 'is_external_door') === 'TRUE',
                parent_element: V(d, 'parent_element') ? V(d, 'parent_element') : null,
                coordinates: opaqueCoords,
                extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
              };
              newElements.push(opaqueElement);
              break;
            }
            case 'BuildingElementTransparent': {
              const pitchOptT = parseOptionalPitchColumn(V(d, 'pitch'));
              const transparentCoords = parseOptionalCoordsColumn(V(d, 'coords'));
              const transparentPitch = resolveBuildingElementPitch({
                type: 'BuildingElementTransparent',
                pitch: pitchOptT ?? null,
                coordinates: transparentCoords,
              });
              const transparentElement: BuildingElementTransparent = {
                ...baseElement,
                type: 'BuildingElementTransparent',
                width: parseRequiredNumberColumn(V(d, 'width')),
                height: parseRequiredNumberColumn(V(d, 'height')),
                area: parseRequiredNumberColumn(V(d, 'area')),
                ...(transparentPitch !== undefined ? { pitch: transparentPitch } : {}),
                orientation360: parseOptionalNumberColumn(V(d, 'orientation360')),
                base_height: parseOptionalNumberColumn(V(d, 'base_height')),
                parent_element: V(d, 'linked_wall') ? V(d, 'linked_wall') : null,
                frame_area_fraction: parseOptionalNumberColumn(V(d, 'frame_area_fraction')),
                free_area_height: parseOptionalNumberColumn(V(d, 'free_area_height')),
                mid_height: parseOptionalNumberColumn(V(d, 'mid_height')),
                max_window_open_area: parseOptionalNumberColumn(V(d, 'max_window_open_area')),
                coordinates: transparentCoords,
                extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
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
              const totalArea = parseOptionalNumberColumn(V(d, 'total_area'));
              const groundElement: BuildingElementGround = {
                ...baseElement,
                type: 'BuildingElementGround',
                area: parseRequiredNumberColumn(V(d, 'area')),
                total_area: totalArea ?? parseRequiredNumberColumn(V(d, 'area')),
                width: parseRequiredNumberColumn(V(d, 'width')),
                height: parseRequiredNumberColumn(V(d, 'height')),
                perimeter: parseRequiredNumberColumn(V(d, 'perimeter')),
                floor_type: floorType,
                depth_basement_floor: parseOptionalNumberColumn(V(d, 'depth_basement_floor')),
                thickness_walls: parseOptionalNumberColumn(V(d, 'thickness_walls')),
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
              const pitchAdj = parseOptionalPitchColumn(V(d, 'pitch'));
              const viewerBaseHeight = parseOptionalNumberColumn(V(d, 'base_height'));
              const adjacentCoords = parseOptionalCoordsColumn(V(d, 'coords'));
              const pitchForStore = resolveBuildingElementPitch({
                type: elementType,
                pitch: pitchAdj ?? null,
                coordinates: adjacentCoords,
              });
              const adjacentElement = {
                ...baseElement,
                type: elementType,
                width: parseRequiredNumberColumn(V(d, 'width')),
                height: parseRequiredNumberColumn(V(d, 'height')),
                area: parseRequiredNumberColumn(V(d, 'area')),
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
                length: parseRequiredNumberColumn(V(d, 'length')),
                linear_thermal_transmittance: parseRequiredNumberColumn(V(d, 'linear_thermal_transmittance')),
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
                heat_transfer_coeff: parseRequiredNumberColumn(V(d, 'heat_transfer_coeff')),
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
            depth: parseOptionalNumberColumn(V(d, 'depth')),
            height: parseOptionalNumberColumn(V(d, 'height')),
            distance: parseOptionalNumberColumn(V(d, 'distance')),
            transparency: parseOptionalNumberColumn(V(d, 'transparency')),
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
            efficacy: parseRequiredNumberColumn(V(d, 'efficacy')),
            count: parseOptionalNumberColumn(V(d, 'count')),
            power: parseOptionalNumberColumn(V(d, 'power')),
            parent_element: null,
            coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
            ...viewerBaseHeightPatch(d),
            extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
          };
          newElements.push(lightingElement);
          break;
        }
        case 'Context Shading': {
          const shadingTypeRaw = V(d, 'shading_type') || V(d, 'Type');
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
            start_angle: parseRequiredNumberColumn(startAngleCell),
            end_angle: parseRequiredNumberColumn(endAngleCell),
            distance: parseRequiredNumberColumn(V(d, 'distance')),
            height: parseRequiredNumberColumn(V(d, 'height')),
            parent_element: V(d, 'parent_element') || null,
            coordinates: coords,
            ...viewerBaseHeightPatch(d),
            extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
          };
          newElements.push(contextShadingElement);
          break;
        }
        case 'On-Site Generation': {
          const csvWidth = V(d, 'width');
          const csvHeight = V(d, 'height');
          const explicitWidth = csvWidth !== '' ? parseFloat(csvWidth) : NaN;
          const explicitHeight = csvHeight !== '' ? parseFloat(csvHeight) : NaN;
          const onSiteElement: OnSiteGeneration = {
            id: generateId(),
            name,
            type: 'OnSiteGeneration',
            generation_type: parseRequiredEnumColumn(V(d, 'generation_type'), ['PhotovoltaicSystem']),
            pitch: parseOptionalNumberColumn(V(d, 'pitch')),
            orientation360: parseOptionalNumberColumn(V(d, 'orientation360')),
            base_height: parseOptionalNumberColumn(V(d, 'base_height')),
            peak_power: parseOptionalNumberColumn(V(d, 'peak_power')),
            coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
            extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
            parent_element: null,
          };
          if (Number.isFinite(explicitWidth) && explicitWidth > 0) {
            onSiteElement.width = roundToTwoDecimals(explicitWidth);
          }
          if (Number.isFinite(explicitHeight) && explicitHeight > 0) {
            onSiteElement.height = roundToTwoDecimals(explicitHeight);
          }
          if (onSiteElement.coordinates && onSiteElement.coordinates.length >= 3) {
            try {
              onSiteElement.area = roundToTwoDecimals(calculatePolygonArea(onSiteElement.coordinates));
            } catch {
              /* ignore */
            }
            // Backward-compat: if CSV pre-dates the width/height columns, derive
            // slope-corrected dimensions from coords + pitch (mirrored in Rust merger).
            if (onSiteElement.width === undefined || onSiteElement.height === undefined) {
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
          const rowType = V(d, 'Type') || V(d, 'system_type') || V(d, 'subcategory');
          if (rowType === 'System') {
            const subcategory = parseOptionalEnumColumn<SystemSubcategory>(V(d, 'subcategory'), [
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
            delete extraJson.grid_charging_possible;
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
            ]);
            const ventType =
              csvVentType ??
              normalizeMechanicalVentilationVentType((parsedExtra as Record<string, unknown>).vent_type);
            const mhCell = V(d, 'mid_height_air_flow_path');
            const oriCell = V(d, 'orientation360');
            const pitCell = V(d, 'pitch');
            const positionColumns: Partial<Record<'mid_height_air_flow_path' | 'orientation360' | 'pitch', unknown>> = {};
            if (mhCell !== '') {
              const parsed = parseOptionalNumberColumn(mhCell);
              if (parsed !== undefined) positionColumns.mid_height_air_flow_path = parsed;
            }
            if (oriCell !== '') {
              const parsed = parseOptionalNumberColumn(oriCell);
              if (parsed !== undefined) positionColumns.orientation360 = parsed;
            }
            if (pitCell !== '') {
              const parsed = parseOptionalNumberColumn(pitCell);
              if (parsed !== undefined) positionColumns.pitch = parsed;
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
            const midHeightAirFlowPath = parseOptionalNumberColumn(V(d, 'mid_height_air_flow_path'));
            newElements.push({
              id: generateId(),
              name,
              type: 'Vents',
              mid_height_air_flow_path: csvRequiredValue<Vents['mid_height_air_flow_path']>(midHeightAirFlowPath),
              area_cm2: parseRequiredNumberColumn(V(d, 'area_cm2')),
              orientation360: parseOptionalNumberColumn(V(d, 'orientation360')),
              pitch: parseOptionalNumberColumn(V(d, 'pitch')),
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
              length: parseRequiredNumberColumn(V(d, 'length')),
              parent_element: parentElementName || null,
              coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
              extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
            };
            if (zoneId) ductworkElement.zoneId = zoneId;
            newElements.push(ductworkElement);
          } else if (elementType === 'MechanicalVentilationTerminal') {
            const terminalCoords = parseOptionalCoordsColumn(V(d, 'coords'));
            const csvMidHeight = parseOptionalNumberColumn(V(d, 'mid_height_air_flow_path'));
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
              orientation360: parseOptionalNumberColumn(V(d, 'orientation360')),
              pitch: parseOptionalNumberColumn(V(d, 'pitch')),
              coordinates: terminalCoords,
              extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
            };
            newElements.push(terminalElement);
          }
          break;
        }
        case 'Combustion Appliances': {
          if (V(d, 'Type') === 'CombustionAppliances') {
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
          }
          break;
        }
        case 'Water Pipework': {
          if (V(d, 'Type') === 'WaterPipework') {
            newElements.push({
              id: generateId(),
              name,
              type: 'WaterPipework',
              simplified_pipework: false,
              length: parseRequiredNumberColumn(V(d, 'length')),
              location: parseRequiredEnumColumn<WaterPipework['location']>(V(d, 'location'), ['internal', 'external']),
              pipework_type: parseOptionalEnumColumn<WaterPipework['pipework_type']>(V(d, 'pipework_type'), ['primary', 'distribution']) ?? 'primary',
              parent_element: null,
              coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
              extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
            });
          }
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
            size: parseOptionalNumberColumn(V(d, 'size')),
            flowrate: parseOptionalNumberColumn(V(d, 'flowrate')),
            rated_power: parseOptionalNumberColumn(V(d, 'rated_power')),
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
          const elementType = V(d, 'Type') as ElementType;
          const zoneId = zoneNameToId[zoneName];
          if (elementType === 'WetEmitter' && zoneId) {
            newElements.push({
              id: generateId(),
              name,
              zoneId,
              type: 'WetEmitter',
              subcategory: parseRequiredEnumColumn<WetEmitter['subcategory']>(V(d, 'subcategory'), ['radiator', 'ufh', 'fancoil']),
              area: parseOptionalNumberColumn(V(d, 'area')),
              unit_number: parseOptionalNumberColumn(V(d, 'unit_number')),
              space_heat_system: V(d, 'space_heat_system') || undefined,
              parent_element: null,
              coordinates: parseOptionalCoordsColumn(V(d, 'coords')),
              ...viewerBaseHeightPatch(d),
              extra_json: parseExtraJson(V(d, 'extra_json'), V(d, 'Name')),
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  return { zones: newZones, elements: newElements, spaceLabels: newSpaceLabels };
}
