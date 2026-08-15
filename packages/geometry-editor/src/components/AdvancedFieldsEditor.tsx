// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { memo, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { renderFieldLabelWithTooltip } from './jsonformsRenderers';
import { DirectAdvancedFields } from './DirectAdvancedFields';
import { StandardDropdown } from './StandardDropdown';
import { ensureRootSchema } from '../lib/ajvCache';
import { useGeometrySchemaPort } from '../../../geometry-editor-host/src/editorServicePorts';
import { EXTRA_JSON_UI_KEYS } from '../lib/csvPresetUtils';
import {
  expandSystemMergeMapSchemaForJsonForms,
  mergeSystemExtraJsonAfterJsonForms,
} from '../lib/systemAdvancedSchemaExpand';
import { dereferenceSchemaNodeInRoot } from '../lib/subschemaCache';
import { flattenSystemSubtypePlantSchemas } from '../lib/systemSchemaFlatten';
import { buildSystemAdvancedUischema, type AdvancedFieldsLayoutNode } from '../lib/systemAdvancedUischema';
import {
  collectHeatSourceWetNameLabelsFromProject,
  collectHeatSourceWetNamesFromProject,
} from '../lib/heatSourceWetNamesFromProject';
import {
  pruneHotWaterSourceHwCylinderSchemaForInstance,
  inlineHwCylinderColdWaterSourceEnumOnHotWaterSubschema,
  inlineHotWaterSourceHeatSourceWetEnumOnHotWaterSubschema,
} from '../lib/systemHotWaterAdvancedSchema';
import {
  getPsiForJunctionType,
  JUNCTION_TYPE_DESCRIPTIONS,
  JUNCTION_TYPE_ENUM,
} from '../lib/simplifiedFabricMap';
import { useGeometryStore, useGeometryStoreApi } from '../stores/geometryStore';
import { useShallow } from 'zustand/react/shallow';
import { getEffectiveLinearPsiFromWorkspaceSparseMap } from '../lib/junctionPsiDefaultsCsv';
import { UnheatedSpaceRuCalculatorModal } from './UnheatedSpaceRuCalculatorModal';
import { GroundUValueCalculatorModal } from './GroundUValueCalculatorModal';
import {
  initialRuCalculatorStateV1,
  parseRuCalculatorStateV1,
  RU_CALCULATOR_STATE_KEY,
} from '../lib/unheatedSpaceRu';
import {
  computeGroundUValueFromElementModel,
  parseWindShieldLocation,
  WIND_SHIELD_LOCATION_ENUM,
} from '../lib/groundUValueCalculator';
import { arealHeatCapacityBandFromJPerM2K } from '../lib/assemblyCalculator';
import { EdgeInsulationFields } from './EdgeInsulationFields';
import { WindowTreatmentFields } from './WindowTreatmentFields';
import { FancoilTestDataFields } from './FancoilTestDataFields';
import { TREATMENT_UI_KEY } from '../lib/windowTreatment';
import { WINDOW_SECURITY_RISK_HELPER, WINDOW_SECURITY_RISK_LABEL } from '../lib/schemaDescriptionOverrides';
import {
  computeSuspendedThermalTransmWallsAutofillResultForGroundElement,
  hasSuspendedFloorThermalTransmWallsAutofillSourcesForGroundElement,
} from '../lib/suspendedFloorThermalTransmWallsAutofill';
import { parseVulcanAssemblyV1FromExtraJson } from '../lib/assemblyAppliedUi';
import {
  applySuspendedThermalTransmWallsManualTracking,
  GROUND_U_VALUE_MANUAL_KEY,
  readExtraJsonRecord,
  THERMAL_TRANSM_WALLS_MANUAL_KEY,
  usesGroundThermalTransmWallsAutofill,
} from '../lib/groundSuspendedFabricSync';
import { roundToTwoDecimals } from '../geometry/constants';
import type { BuildingElementTransparent, Element, System, WindowShading } from '../geometry/types';
import { useKeyedState } from '../hooks/useKeyedState';
import { classifyOpaqueFabricVariantFromElement } from '../lib/opaqueFabricVariant';
import { DhwStorageHeatSourcePicker } from './DhwStorageHeatSourcePicker';
import {
  WindowDetailChip,
  WindowDetailCollectionShell,
  WindowDetailSection,
} from './WindowDetailControls';
import {
  MECHANICAL_VENTILATION_FAN_CHOICE_TYPES,
  MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS,
  MECHANICAL_VENTILATION_MEASURED_FIELDS,
  MECHANICAL_VENTILATION_POSITION_OBJECT_FIELDS,
  MECHANICAL_VENTILATION_SFP_FIELDS,
  type MechanicalVentilationFanInputMode,
  type MechanicalVentilationPositionMode,
  deleteProperties,
  inferMechanicalVentilationFanInputMode,
  inferMechanicalVentilationPositionMode,
  isPlainRecord,
  normalizeMechanicalVentilationVentType,
  pruneMechanicalVentilationExtraJson,
  switchMechanicalVentilationPositionModeExtraJson,
} from '../lib/mechanicalVentilationBranches';
import {
  RADIATOR_LUMPED_FIELDS,
  RADIATOR_PER_METRE_FIELDS,
  type RadiatorThermalMode,
  inferRadiatorThermalMode,
  pruneRadiatorEmitterExtraJson,
} from '../lib/radiatorEmitterBranches';
import {
  buildSpaceHeatSystemSampleBaselineExtraJson,
  firstRecordEntry,
  resolveHeatSourceWetReferenceName,
  SYSTEM_SUBCATEGORY_TO_DIR,
} from './systemEditorUtils';
import type { SchemaNode } from '../lib/schemaTypes';
import {
  emptyGeometryInspectorContributions,
  unavailableGeometryWorkspaceResourcePort,
  type GeometryInspectorContributions,
  type GeometryWorkspaceResourcePort,
} from '../../../geometry-editor-host/src';

const EXTRA_JSON_UI_KEY_SET = new Set<string>(EXTRA_JSON_UI_KEYS);

const WINDOW_SHADING_TYPE_LABELS: Record<WindowShading['shading_type'], string> = {
  object: 'Object',
  overhang: 'Overhang',
  sidefinright: 'Right fin',
  sidefinleft: 'Left fin',
  reveal: 'Reveal',
};

const EMPTY_ADVANCED_FIELDS: Record<string, unknown> = Object.freeze({});
const MVHR_FIXED_ENERGY_SUPPLY = 'mains elec' as const;
const PARTY_WALL_HALF_CONSTRUCTION_NOTE =
  'Enter dwelling-side half-construction values: U from the half build-up, half areal heat capacity, and the matching mass class. If using construction R, enter half R. Set cavity treatment separately.';
const INTERNAL_HALF_CONSTRUCTION_NOTE =
  'Enter half-construction values for this side: U from the half build-up, half areal heat capacity, and the matching mass class. If using construction R, enter half R.';

type AdvancedEditorData = Partial<Element> & {
  area?: unknown;
  extra_json?: unknown;
  id?: string;
  linear_thermal_transmittance?: unknown;
  name?: unknown;
  system_preset?: unknown;
  type?: unknown;
  vent_type?: unknown;
  zoneId?: unknown;
};

type AdvancedFieldsChangePayload = {
  data: unknown;
  errors?: unknown[];
};

// R4.5: was `SchemaNode & JsonSchema` (`JsonSchema` from `@jsonforms/core`); `SchemaNode`
// already covers everything this file reads off a subschema (properties, $defs,
// oneOf/anyOf/allOf, required, additionalProperties, …), so the intersection was
// redundant once the `@jsonforms/core` dependency itself was removed.
type AdvancedFieldsSchema = SchemaNode;

function currentDataAsElement(data: AdvancedEditorData): Element | null {
  return typeof data.id === 'string' && typeof data.type === 'string'
    ? (data as unknown as Element)
    : null;
}

export const ECODESIGN_CONTROL_CLASS_OPTIONS = [
  {
    const: 1,
    title: '1 - Class I: on/off room thermostat',
    description: 'On/off room thermostat. HEM treats the wet distribution flow temperature as fixed rather than weather-compensated.',
  },
  {
    const: 2,
    title: '2 - Class II: weather compensator with modulating heaters',
    description: 'Weather compensation with modulating heaters. HEM uses design_flow_temp, min_flow_temp, min_outdoor_temp and max_outdoor_temp as the flow-temperature curve.',
  },
  {
    const: 3,
    title: '3 - Class III: weather compensator with on/off heaters',
    description: 'Weather compensation with on/off heaters. HEM uses design_flow_temp, min_flow_temp, min_outdoor_temp and max_outdoor_temp as the flow-temperature curve.',
  },
  {
    const: 4,
    title: '4 - Class IV: TPI room thermostat with on/off heaters',
    description: 'TPI room thermostat with on/off heaters. HEM treats the wet distribution flow temperature as fixed rather than weather-compensated.',
  },
  {
    const: 5,
    title: '5 - Class V: modulating room thermostat with modulating heaters',
    description: 'Modulating room thermostat with modulating heaters. HEM treats the wet distribution flow temperature as fixed rather than weather-compensated.',
  },
  {
    const: 6,
    title: '6 - Class VI: weather compensator with room sensor for modulating heaters',
    description: 'Weather compensation with room sensor and modulating heaters. HEM uses design_flow_temp, min_flow_temp, min_outdoor_temp and max_outdoor_temp as the flow-temperature curve.',
  },
  {
    const: 7,
    title: '7 - Class VII: weather compensator with room sensor for on/off heaters',
    description: 'Weather compensation with room sensor and on/off heaters. HEM uses design_flow_temp, min_flow_temp, min_outdoor_temp and max_outdoor_temp as the flow-temperature curve.',
  },
  {
    const: 8,
    title: '8 - Class VIII: multi room temperature control with modulating heaters',
    description: 'Multi room temperature control with modulating heaters. HEM treats the wet distribution flow temperature as fixed rather than weather-compensated.',
  },
] as const;

const ECODESIGN_CONTROL_CLASS_DESCRIPTION =
  'Ecodesign controller class. Classes II, III, VI and VII use weather compensation, so the flow-temperature curve comes from design_flow_temp, min_flow_temp, min_outdoor_temp and max_outdoor_temp.';

const NON_WEATHER_COMPENSATED_ECODESIGN_CLASSES = new Set([1, 4, 5, 8]);
const ECODESIGN_WEATHER_COMPENSATION_FIELDS = [
  'min_outdoor_temp',
  'max_outdoor_temp',
  'min_flow_temp',
] as const;

function parseEcodesignControlClass(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

function isKnownNonWeatherCompensatedEcodesignClass(value: unknown): boolean {
  const controllerClass = parseEcodesignControlClass(value);
  return controllerClass !== null && NON_WEATHER_COMPENSATED_ECODESIGN_CLASSES.has(controllerClass);
}

function spaceHeatSystemEntryForName(
  extraJson: unknown,
  systemName: string,
): Record<string, unknown> | null {
  const systems = readExtraJsonRecord(readExtraJsonRecord(extraJson).SpaceHeatSystem);
  const exact = systems[systemName];
  if (exact && typeof exact === 'object' && !Array.isArray(exact)) {
    return exact as Record<string, unknown>;
  }
  const entries = Object.entries(systems).filter(([, value]) =>
    value && typeof value === 'object' && !Array.isArray(value),
  );
  return entries.length === 1 ? (entries[0][1] as Record<string, unknown>) : null;
}

// eslint-disable-next-line react-refresh/only-export-components -- schema helper shared with tests.
export function pruneSpaceHeatSystemWeatherCompensationSchema(
  schema: Record<string, unknown>,
  extraJson: unknown,
): Record<string, unknown> {
  const rootProps = schema.properties;
  if (!rootProps || typeof rootProps !== 'object' || Array.isArray(rootProps)) return schema;
  const spaceHeatSystem = (rootProps as Record<string, unknown>).SpaceHeatSystem;
  if (!spaceHeatSystem || typeof spaceHeatSystem !== 'object' || Array.isArray(spaceHeatSystem)) return schema;
  const systemMapProps = (spaceHeatSystem as Record<string, unknown>).properties;
  if (!systemMapProps || typeof systemMapProps !== 'object' || Array.isArray(systemMapProps)) return schema;

  const nextSystemMapProps: Record<string, unknown> = {};
  let changed = false;
  for (const [systemName, systemSchema] of Object.entries(systemMapProps as Record<string, unknown>)) {
    if (!systemSchema || typeof systemSchema !== 'object' || Array.isArray(systemSchema)) {
      nextSystemMapProps[systemName] = systemSchema;
      continue;
    }
    const systemData = spaceHeatSystemEntryForName(extraJson, systemName);
    const ecodesignData = readExtraJsonRecord(systemData?.ecodesign_controller);
    if (!isKnownNonWeatherCompensatedEcodesignClass(ecodesignData.ecodesign_control_class)) {
      nextSystemMapProps[systemName] = systemSchema;
      continue;
    }

    const systemSchemaRecord = systemSchema as Record<string, unknown>;
    const systemProps = systemSchemaRecord.properties;
    if (!systemProps || typeof systemProps !== 'object' || Array.isArray(systemProps)) {
      nextSystemMapProps[systemName] = systemSchema;
      continue;
    }
    const ecodesignSchema = (systemProps as Record<string, unknown>).ecodesign_controller;
    if (!ecodesignSchema || typeof ecodesignSchema !== 'object' || Array.isArray(ecodesignSchema)) {
      nextSystemMapProps[systemName] = systemSchema;
      continue;
    }
    const ecodesignSchemaRecord = ecodesignSchema as Record<string, unknown>;
    const ecodesignProps = ecodesignSchemaRecord.properties;
    if (!ecodesignProps || typeof ecodesignProps !== 'object' || Array.isArray(ecodesignProps)) {
      nextSystemMapProps[systemName] = systemSchema;
      continue;
    }

    const nextEcodesignProps = { ...(ecodesignProps as Record<string, unknown>) };
    let removedWeatherField = false;
    for (const field of ECODESIGN_WEATHER_COMPENSATION_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(nextEcodesignProps, field)) {
        delete nextEcodesignProps[field];
        removedWeatherField = true;
      }
    }
    if (!removedWeatherField) {
      nextSystemMapProps[systemName] = systemSchema;
      continue;
    }

    const nextEcodesignRequired = Array.isArray(ecodesignSchemaRecord.required)
      ? (ecodesignSchemaRecord.required as unknown[]).filter((field) =>
          !ECODESIGN_WEATHER_COMPENSATION_FIELDS.includes(field as typeof ECODESIGN_WEATHER_COMPENSATION_FIELDS[number]),
        )
      : ecodesignSchemaRecord.required;
    const nextSystemProps = {
      ...(systemProps as Record<string, unknown>),
      ecodesign_controller: {
        ...ecodesignSchemaRecord,
        properties: nextEcodesignProps,
        ...(Array.isArray(nextEcodesignRequired) ? { required: nextEcodesignRequired } : {}),
      },
    };
    nextSystemMapProps[systemName] = {
      ...systemSchemaRecord,
      properties: nextSystemProps,
    };
    changed = true;
  }

  if (!changed) return schema;
  return {
    ...schema,
    properties: {
      ...(rootProps as Record<string, unknown>),
      SpaceHeatSystem: {
        ...(spaceHeatSystem as Record<string, unknown>),
        properties: nextSystemMapProps,
      },
    },
  };
}

// eslint-disable-next-line react-refresh/only-export-components -- schema helper shared with tests.
export function pruneSpaceHeatSystemUnusedWeatherCompensationValues(
  extraJson: Record<string, unknown>,
): Record<string, unknown> {
  const systems = readExtraJsonRecord(extraJson.SpaceHeatSystem);
  if (Object.keys(systems).length === 0) return extraJson;

  let changed = false;
  const nextSystems: Record<string, unknown> = {};
  for (const [systemName, systemUnknown] of Object.entries(systems)) {
    if (!systemUnknown || typeof systemUnknown !== 'object' || Array.isArray(systemUnknown)) {
      nextSystems[systemName] = systemUnknown;
      continue;
    }
    const system = systemUnknown as Record<string, unknown>;
    const ecodesignController = readExtraJsonRecord(system.ecodesign_controller);
    if (!isKnownNonWeatherCompensatedEcodesignClass(ecodesignController.ecodesign_control_class)) {
      nextSystems[systemName] = systemUnknown;
      continue;
    }

    const nextEcodesignController = { ...ecodesignController };
    let removedWeatherField = false;
    for (const field of ECODESIGN_WEATHER_COMPENSATION_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(nextEcodesignController, field)) {
        delete nextEcodesignController[field];
        removedWeatherField = true;
      }
    }
    if (!removedWeatherField) {
      nextSystems[systemName] = systemUnknown;
      continue;
    }

    nextSystems[systemName] = {
      ...system,
      ecodesign_controller: nextEcodesignController,
    };
    changed = true;
  }

  if (!changed) return extraJson;
  return {
    ...extraJson,
    SpaceHeatSystem: nextSystems,
  };
}

// eslint-disable-next-line react-refresh/only-export-components -- schema helper shared with tests.
export function applyEcodesignControlClassEnum(schema: Record<string, unknown>): Record<string, unknown> {
  function visit(node: unknown): unknown {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    const record = node as Record<string, unknown>;
    let changed = false;
    const next: Record<string, unknown> = { ...record };

    const properties = record.properties;
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      const nextProperties: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(properties as Record<string, unknown>)) {
        if (key === 'ecodesign_control_class' && child && typeof child === 'object' && !Array.isArray(child)) {
          const childRecord = child as Record<string, unknown>;
          const childWithoutEnum = { ...childRecord };
          delete childWithoutEnum.enum;
          nextProperties[key] = {
            ...childWithoutEnum,
            type: 'integer',
            description: typeof childRecord.description === 'string'
              ? `${childRecord.description} ${ECODESIGN_CONTROL_CLASS_DESCRIPTION}`
              : ECODESIGN_CONTROL_CLASS_DESCRIPTION,
            oneOf: ECODESIGN_CONTROL_CLASS_OPTIONS.map((option) => ({ ...option })),
          };
          changed = true;
          continue;
        }
        const visited = visit(child);
        nextProperties[key] = visited;
        if (visited !== child) changed = true;
      }
      if (changed) next.properties = nextProperties;
    }

    for (const key of ['items', 'additionalProperties', 'contains', 'not'] as const) {
      if (record[key] === undefined) continue;
      const visited = visit(record[key]);
      if (visited !== record[key]) {
        next[key] = visited;
        changed = true;
      }
    }

    for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
      const value = record[key];
      if (!Array.isArray(value)) continue;
      const visited = value.map(visit);
      if (visited.some((item, index) => item !== value[index])) {
        next[key] = visited;
        changed = true;
      }
    }

    return changed ? next : node;
  }

  return visit(schema) as Record<string, unknown>;
}

function buildMechanicalVentilationPositionObjectSchema(
  properties: Record<string, SchemaNode>,
): SchemaNode {
  const nestedProperties: Record<string, SchemaNode> = {};
  for (const key of MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS) {
    if (properties[key] !== undefined) {
      nestedProperties[key] = properties[key];
    }
  }
  return {
    type: 'object',
    properties: nestedProperties,
  };
}

// eslint-disable-next-line react-refresh/only-export-components -- schema helper shared with tests.
export function pruneSpaceHeatSystemLinkedFields(
  schema: Record<string, unknown>,
  plantDataMap?: Record<string, unknown> | null,
): Record<string, unknown> {
  const rootProps = schema.properties;
  if (!rootProps || typeof rootProps !== 'object' || Array.isArray(rootProps)) return schema;
  const spaceHeatSystem = (rootProps as Record<string, unknown>).SpaceHeatSystem;
  if (!spaceHeatSystem || typeof spaceHeatSystem !== 'object' || Array.isArray(spaceHeatSystem)) return schema;
  const systemMapProps = (spaceHeatSystem as Record<string, unknown>).properties;
  if (!systemMapProps || typeof systemMapProps !== 'object' || Array.isArray(systemMapProps)) return schema;

  const nextSystemMapProps: Record<string, unknown> = {};
  let changed = false;
  for (const [systemKey, systemSchema] of Object.entries(systemMapProps as Record<string, unknown>)) {
    if (!systemSchema || typeof systemSchema !== 'object' || Array.isArray(systemSchema)) {
      nextSystemMapProps[systemKey] = systemSchema;
      continue;
    }
    const systemSchemaRecord = systemSchema as Record<string, unknown>;
    const props = systemSchemaRecord.properties;
    if (!props || typeof props !== 'object' || Array.isArray(props)) {
      nextSystemMapProps[systemKey] = systemSchema;
      continue;
    }

    const nextProps = { ...(props as Record<string, unknown>) };
    const plantData =
      plantDataMap &&
      typeof plantDataMap === 'object' &&
      !Array.isArray(plantDataMap) &&
      plantDataMap[systemKey] &&
      typeof plantDataMap[systemKey] === 'object' &&
      !Array.isArray(plantDataMap[systemKey])
        ? (plantDataMap[systemKey] as Record<string, unknown>)
        : null;
    const isWetDistribution =
      plantData?.type === 'WetDistribution' ||
      ('HeatSource' in nextProps && 'ecodesign_controller' in nextProps && 'emitters' in nextProps);
    if ('Zone' in nextProps) {
      delete nextProps.Zone;
      changed = true;
    }
    if (isWetDistribution && 'emitters' in nextProps) {
      delete nextProps.emitters;
      changed = true;
    }
    if (isWetDistribution && 'EnergySupply' in nextProps) {
      delete nextProps.EnergySupply;
      changed = true;
    }

    const heatSource = nextProps.HeatSource;
    if (heatSource && typeof heatSource === 'object' && !Array.isArray(heatSource)) {
      const heatSourceRecord = heatSource as Record<string, unknown>;
      const heatSourceProps = heatSourceRecord.properties;
      if (heatSourceProps && typeof heatSourceProps === 'object' && !Array.isArray(heatSourceProps)) {
        const nextHeatSourceProps = { ...(heatSourceProps as Record<string, unknown>) };
        let heatSourceChanged = false;
        if ('name' in nextHeatSourceProps) {
          delete nextHeatSourceProps.name;
          heatSourceChanged = true;
        }
        if ('EnergySupply' in nextHeatSourceProps) {
          delete nextHeatSourceProps.EnergySupply;
          heatSourceChanged = true;
        }
        if (heatSourceChanged) {
          const nextHeatSourceRequired = Array.isArray(heatSourceRecord.required)
            ? (heatSourceRecord.required as unknown[]).filter((key) => key !== 'name' && key !== 'EnergySupply')
            : heatSourceRecord.required;
          nextProps.HeatSource = {
            ...heatSourceRecord,
            properties: nextHeatSourceProps,
            ...(Array.isArray(nextHeatSourceRequired) ? { required: nextHeatSourceRequired } : {}),
          };
          changed = true;
        }
      }
    }

    const nextRequired = Array.isArray(systemSchemaRecord.required)
      ? (systemSchemaRecord.required as unknown[]).filter((key) => (
          key !== 'Zone' &&
          (
            !isWetDistribution ||
            (
              key !== 'emitters' &&
              key !== 'EnergySupply'
            )
          )
        ))
      : systemSchemaRecord.required;

    nextSystemMapProps[systemKey] = {
      ...systemSchemaRecord,
      properties: nextProps,
      ...(Array.isArray(nextRequired) ? { required: nextRequired } : {}),
    };
  }

  if (!changed) return schema;
  return {
    ...schema,
    properties: {
      ...(rootProps as Record<string, unknown>),
      SpaceHeatSystem: {
        ...(spaceHeatSystem as Record<string, unknown>),
        properties: nextSystemMapProps,
      },
    },
  };
}

const MechanicalVentilationModeSegment: React.FC<{
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}> = ({ label, value, options, onChange }) => (
  <div className="element-editor-segment" style={{ marginBottom: 'var(--spacing-md)' }}>
    <div className="element-editor-segment__label">{label}</div>
    <div className="element-editor-segment__control" role="group" aria-label={label}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={`element-editor-segment__button${active ? ' element-editor-segment__button--active' : ''}`}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  </div>
);

function groundAdvancedUValueFingerprint(v: unknown): string {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return `n:${v}`;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return '';
    const n = Number(t);
    return Number.isFinite(n) ? `n:${n}` : `s:${t}`;
  }
  return `o:${String(v)}`;
}

function jsonFormsDataEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
  } catch {
    return a === b;
  }
}

function makeUniqueLocalName(baseName: string, existingNames: Iterable<string>): string {
  const used = new Set(existingNames);
  let name = baseName;
  let counter = 1;
  while (used.has(name)) {
    name = `${baseName} ${counter}`;
    counter += 1;
  }
  return name;
}

function getWindowShadingSeedPoint(windowElement: BuildingElementTransparent): { x: number; y: number; z: number } {
  const coords = windowElement.coordinates || [];
  if (coords.length >= 2 && coords[0] && coords[1]) {
    return {
      x: (coords[0].x + coords[1].x) / 2,
      y: (coords[0].y + coords[1].y) / 2,
      z: coords[0].z ?? 0,
    };
  }
  const first = coords[0];
  return {
    x: first?.x ?? 0,
    y: first?.y ?? 0,
    z: first?.z ?? 0,
  };
}

function formatAttachedShadingDetail(shading: WindowShading): string {
  if (shading.shading_type === 'object') {
    const parts = [
      typeof shading.height === 'number' ? `h ${shading.height}m` : null,
      typeof shading.distance === 'number' ? `d ${shading.distance}m` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' / ') : 'Object shading';
  }
  const parts = [
    typeof shading.depth === 'number' ? `depth ${shading.depth}m` : null,
    typeof shading.distance === 'number' ? `dist ${shading.distance}m` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' / ') : 'Attached to window';
}

const AttachedWindowShadingStrip: React.FC<{
  windowElement: BuildingElementTransparent;
  elementsById: Record<string, Element>;
  elementIds: string[];
  addElement: (element: Omit<Element, 'id'>) => void;
  setSelection: (selection: { type: 'element'; id: string } | null) => void;
  setSelectedElementIds: (ids: string[]) => void;
  useFHSSchema: boolean;
}> = ({
  windowElement,
  elementsById,
  elementIds,
  addElement,
  setSelection,
  setSelectedElementIds,
  useFHSSchema,
}) => {
  const geometryStore = useGeometryStoreApi();
  const attachedShading = useMemo(
    () =>
      elementIds
        .map((id) => elementsById[id])
        .filter(
          (element): element is WindowShading =>
            element?.type === 'WindowShading' &&
            element.zoneId === windowElement.zoneId &&
            element.parent_element === windowElement.name,
        ),
    [elementIds, elementsById, windowElement.name, windowElement.zoneId],
  );

  const rawShadingCount = Array.isArray(windowElement.extra_json?.shading)
    ? windowElement.extra_json.shading.length
    : 0;
  const canAdd = Boolean(windowElement.name && windowElement.zoneId);

  const selectShading = useCallback((id: string) => {
    setSelection({ type: 'element', id });
    setSelectedElementIds([id]);
  }, [setSelectedElementIds, setSelection]);

  const addAttachedShading = useCallback(() => {
    if (!canAdd) return;
    const currentState = geometryStore.getState();
    const existingNames = Object.values(currentState.elementsById).map((element) => element.name);
    const baseName = `${windowElement.name} shading`;
    const name = makeUniqueLocalName(baseName, existingNames);
    const seedPoint = getWindowShadingSeedPoint(windowElement);

    addElement({
      name,
      zoneId: windowElement.zoneId,
      type: 'WindowShading',
      shading_type: 'overhang',
      parent_element: windowElement.name,
      depth: 0.3,
      distance: 0.1,
      coordinates: [seedPoint],
    } as Omit<Element, 'id'>);

    const nextState = geometryStore.getState();
    const created = [...nextState.elementIds]
      .reverse()
      .map((id) => nextState.elementsById[id])
      .find((element) => element?.type === 'WindowShading' && element.name === name);
    if (created) {
      setSelection({ type: 'element', id: created.id });
      setSelectedElementIds([created.id]);
    }
  }, [addElement, canAdd, geometryStore, setSelectedElementIds, setSelection, windowElement]);

  return (
    <WindowDetailSection
      compact
      fieldKey="shading"
      label={renderFieldLabelWithTooltip(
        'Attached shading',
        'BuildingElementTransparent',
        useFHSSchema,
      )}
    >
      <WindowDetailCollectionShell
        empty="None"
        addLabel={canAdd ? 'Add attached window shading' : 'Name the window before adding shading'}
        onAdd={addAttachedShading}
        canAdd={canAdd}
      >
        {attachedShading.map((shading) => (
          <WindowDetailChip
            key={shading.id}
            onClick={() => selectShading(shading.id)}
            title={`Edit ${shading.name}`}
            minWidth={108}
            maxWidth={176}
          >
            <div
              style={{
                fontSize: '12px',
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {WINDOW_SHADING_TYPE_LABELS[shading.shading_type] ?? shading.shading_type}
            </div>
            <div
              style={{
                fontSize: '11px',
                color: 'var(--text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {formatAttachedShadingDetail(shading)}
            </div>
          </WindowDetailChip>
        ))}
      </WindowDetailCollectionShell>
      {rawShadingCount > 0 && (
        <div
          style={{
            marginTop: '6px',
            fontSize: '11px',
            color: 'var(--warning-text, var(--text-secondary))',
            lineHeight: 1.35,
          }}
        >
          This window also has {rawShadingCount} raw extra_json shading object{rawShadingCount === 1 ? '' : 's'}.
          These are preserved but not edited here.
        </div>
      )}
    </WindowDetailSection>
  );
};

interface AdvancedFieldsEditorProps {
  elementType: string;
  subtype?: string;
  currentData: AdvancedEditorData;
  onChange: (data: AdvancedEditorData) => void;
  className?: string;
  flat?: boolean; // when true, remove borders/backgrounds
  collapsible?: boolean; // when false, keep advanced fields always visible
  useFHSSchema?: boolean; // when true, use FHS schema for Advanced Fields (still curated Standard fields)
  fieldIndicators?: Readonly<Record<string, readonly string[]>>;
  evidenceFieldKeys?: ReadonlySet<string>;
  focusFieldKey?: string | null;
  focusFieldVersion?: number;
  inspectorContributions?: GeometryInspectorContributions;
  workspaceResourcePort?: GeometryWorkspaceResourcePort;
}

const AdvancedFieldsEditorComponent: React.FC<AdvancedFieldsEditorProps> = ({
  elementType,
  subtype,
  currentData,
  onChange,
  className = '',
  flat = false,
  collapsible = true,
  useFHSSchema = false,
  fieldIndicators,
  evidenceFieldKeys,
  focusFieldKey,
  focusFieldVersion,
  inspectorContributions = emptyGeometryInspectorContributions,
  workspaceResourcePort = unavailableGeometryWorkspaceResourcePort,
}) => {
  const schemaPort = useGeometrySchemaPort();
  const schemaMode = useFHSSchema ? 'fhs' : 'core';
  const getActiveElementSubschema = useCallback(
    (type: string, activeSubtype?: string): AdvancedFieldsSchema | null =>
      schemaPort.availability === 'available'
        ? schemaPort.getElementSubschema(schemaMode, type, activeSubtype) as AdvancedFieldsSchema | null
        : null,
    [schemaMode, schemaPort],
  );
  const getBaseFields = useCallback(
    (type: string): readonly string[] =>
      schemaPort.availability === 'available'
        ? schemaPort.getBaseFieldsForElementType(type)
        : [],
    [schemaPort],
  );
  const getActiveRootSchema = useCallback(
    (): SchemaNode | null =>
      schemaPort.availability === 'available'
        ? schemaPort.getRootSchema(schemaMode) as SchemaNode | null
        : null,
    [schemaMode, schemaPort],
  );
  const [isExpanded, setIsExpanded] = useState(!collapsible);
  const [ruCalculatorOpen, setRuCalculatorOpen] = useState(false);
  const [ruCalcMountKey, setRuCalcMountKey] = useState(0);
  const [groundUCalculatorOpen, setGroundUCalculatorOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const {
    junctionPsiDefaultsPath,
    junctionPsiDefaultsMap,
    junctionPsiDefaultsLoading,
    detailedBridgePsiProfile,
    elementsById,
    elementIds,
    floors,
    zones,
    setSelection,
    setSelectedElementIds,
    addElement,
    defaultsLookup,
  } = useGeometryStore(
    useShallow((s) => ({
      junctionPsiDefaultsPath: s.junctionPsiDefaultsPath,
      junctionPsiDefaultsMap: s.junctionPsiDefaultsMap,
      junctionPsiDefaultsLoading: s.junctionPsiDefaultsLoading,
      detailedBridgePsiProfile: s.detailedBridgePsiProfile,
      elementsById: s.elementsById as Record<string, Element>,
      elementIds: s.elementIds,
      floors: s.floors,
      zones: s.zones,
      setSelection: s.setSelection,
      setSelectedElementIds: s.setSelectedElementIds,
      addElement: s.addElement,
      defaultsLookup: s.getDefaultsLookup(),
    })),
  );

  // Extract advanced fields from currentData. Keep the empty value referentially stable —
  // this object feeds numerous useMemo/useCallback dependency arrays below (and is
  // handed straight through to DirectAdvancedFields as `data`), so a fresh `{}` on
  // every render would defeat that memoization and force needless recomputation.
  const advancedFieldsDataRaw = currentData.extra_json ?? EMPTY_ADVANCED_FIELDS;
  const advancedFieldsData = isPlainRecord(advancedFieldsDataRaw)
    ? advancedFieldsDataRaw
    : EMPTY_ADVANCED_FIELDS;
  const advancedFieldsRecord = advancedFieldsData;
  const currentDataElementType =
    typeof currentData?.type === 'string' ? currentData.type : elementType;
  const mechanicalVentilationVentType = useMemo(
    () =>
      normalizeMechanicalVentilationVentType(currentData?.vent_type) ??
      normalizeMechanicalVentilationVentType((advancedFieldsRecord as Record<string, unknown>).vent_type) ??
      normalizeMechanicalVentilationVentType(subtype),
    [advancedFieldsRecord, currentData.vent_type, subtype],
  );
  const shouldRenderMechanicalVentilationFanMode =
    useFHSSchema &&
    elementType === 'MechanicalVentilation' &&
    !!mechanicalVentilationVentType &&
    MECHANICAL_VENTILATION_FAN_CHOICE_TYPES.has(mechanicalVentilationVentType);
  const shouldRenderMechanicalVentilationPositionMode =
    useFHSSchema &&
    elementType === 'MechanicalVentilation' &&
    !!mechanicalVentilationVentType &&
    mechanicalVentilationVentType !== 'MVHR';
  const shouldRenderMechanicalVentilationFixedEnergySupply =
    currentDataElementType === 'MechanicalVentilation' &&
    mechanicalVentilationVentType === 'MVHR';
  const inferredMechanicalVentilationFanInputMode = useMemo<MechanicalVentilationFanInputMode>(
    () => inferMechanicalVentilationFanInputMode(advancedFieldsRecord as Record<string, unknown>),
    [advancedFieldsRecord],
  );
  const [
    mechanicalVentilationFanInputModeOverride,
    setMechanicalVentilationFanInputModeOverride,
  ] = useKeyedState<MechanicalVentilationFanInputMode | null>(
    [
      currentData?.id ?? '',
      currentData?.name ?? '',
      elementType,
      mechanicalVentilationVentType ?? '',
    ].join('\0'),
    null,
  );
  const mechanicalVentilationFanInputMode =
    mechanicalVentilationFanInputModeOverride ?? inferredMechanicalVentilationFanInputMode;
  const mechanicalVentilationPositionMode = useMemo<MechanicalVentilationPositionMode>(
    () => inferMechanicalVentilationPositionMode(advancedFieldsRecord as Record<string, unknown>),
    [advancedFieldsRecord],
  );
  // Radiator emitters expose a per-metre vs lumped mode (mirrors the MEV fan-input
  // toggle). Only the active branch is serialised; the inactive branch is pruned.
  const shouldRenderRadiatorThermalMode = elementType === 'WetEmitter' && subtype === 'radiator';
  const inferredRadiatorThermalMode = useMemo<RadiatorThermalMode>(
    () => inferRadiatorThermalMode(advancedFieldsRecord as Record<string, unknown>),
    [advancedFieldsRecord],
  );
  const [radiatorThermalModeOverride, setRadiatorThermalModeOverride] =
    useKeyedState<RadiatorThermalMode | null>(
      [currentData?.id ?? '', currentData?.name ?? '', elementType, subtype ?? ''].join('\0'),
      null,
    );
  const radiatorThermalMode = radiatorThermalModeOverride ?? inferredRadiatorThermalMode;
  const constructionDetails = inspectorContributions.constructionDetails;
  const externalDetailProfilesEnabled = constructionDetails?.isEnabled() ?? false;
  const currentElementData = useMemo(() => currentDataAsElement(currentData), [currentData]);
  const currentJunctionType = typeof advancedFieldsData.junction_type === 'string'
    ? advancedFieldsData.junction_type.trim()
    : '';
  const externalDetailCandidates = useMemo(
    () =>
      externalDetailProfilesEnabled && elementType === 'ThermalBridgeLinear' && currentJunctionType
        ? constructionDetails?.listCandidates(
            detailedBridgePsiProfile,
            currentJunctionType,
          ) ?? []
        : [],
    [
      constructionDetails,
      currentJunctionType,
      detailedBridgePsiProfile,
      elementType,
      externalDetailProfilesEnabled,
    ],
  );
  const selectedExternalDetailKey =
    constructionDetails?.selectedCandidateKey(advancedFieldsData) ?? '';

  useEffect(() => {
    if (!shouldRenderMechanicalVentilationFixedEnergySupply) return;
    if ((advancedFieldsRecord as Record<string, unknown>).EnergySupply === MVHR_FIXED_ENERGY_SUPPLY) return;
    onChange({
      ...currentData,
      extra_json: {
        ...(advancedFieldsRecord as Record<string, unknown>),
        EnergySupply: MVHR_FIXED_ENERGY_SUPPLY,
      },
    });
  }, [
    advancedFieldsRecord,
    currentData,
    onChange,
    shouldRenderMechanicalVentilationFixedEnergySupply,
  ]);

  const projectHeatSourceWetNames = useMemo(
    () => collectHeatSourceWetNamesFromProject(elementsById),
    [elementsById],
  );
  const projectHeatSourceWetLabels = useMemo(
    () => collectHeatSourceWetNameLabelsFromProject(elementsById),
    [elementsById],
  );
  /** `HotWaterSource[hw cylinder].HeatSourceWet` string (Combi/HIU/HeatBattery) for enum re-computation. */
  const currentHotWaterCombiHeatSourceWetLink = useMemo(() => {
    if (elementType !== 'System' || subtype !== 'HotWaterSource') return '';
    const h = (advancedFieldsData as Record<string, unknown>)?.HotWaterSource;
    const c = h && typeof h === 'object' && !Array.isArray(h) ? (h as Record<string, unknown>)['hw cylinder'] : undefined;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return '';
    const t = (c as { type?: string }).type;
    if (t !== 'CombiBoiler' && t !== 'HIU' && t !== 'HeatBattery') return '';
    const link = (c as Record<string, unknown>).HeatSourceWet;
    return typeof link === 'string' ? link : '';
  }, [elementType, subtype, advancedFieldsData]);

  const ruCalculatorInitialState = useMemo(
    () =>
      initialRuCalculatorStateV1(
        parseRuCalculatorStateV1(
          (advancedFieldsData as Record<string, unknown>)[RU_CALCULATOR_STATE_KEY],
        ),
        typeof currentData?.area === 'number' && Number.isFinite(currentData.area) && currentData.area > 0
          ? currentData.area
          : undefined,
      ),
    [advancedFieldsData, currentData.area],
  );

  const openRuCalculator = useCallback(() => {
    setRuCalcMountKey((k) => k + 1);
    setRuCalculatorOpen(true);
  }, []);

  const openGroundUCalculator = useCallback(() => {
    setGroundUCalculatorOpen(true);
  }, []);

  // Get subschema for the element type and filter out base fields
  const subschema = useMemo<AdvancedFieldsSchema | null>(() => {
    let fullSchema = getActiveElementSubschema(elementType, subtype);
    if (!fullSchema) return null;

    const systemSubtypePlantMapSlice =
      elementType === 'System' &&
      subtype &&
      advancedFieldsData &&
      typeof advancedFieldsData === 'object' &&
      !Array.isArray(advancedFieldsData)
        ? (advancedFieldsData as Record<string, unknown>)[subtype]
        : undefined;

    // System: merge maps (HeatSourceWet / …) use `additionalProperties` in schema —
    // DirectAdvancedFields' flat walk only iterates explicit `.properties`, so an
    // unexpanded merge map would show as one opaque JSON blob. Hoist each key present
    // in `extra_json[subtype]` to explicit `properties` so fields enumerate.
    if (elementType === 'System' && subtype) {
      const expanded = expandSystemMergeMapSchemaForJsonForms(
        fullSchema as Record<string, unknown>,
        subtype,
        systemSubtypePlantMapSlice,
      );
      fullSchema = expanded as typeof fullSchema;
    }

    // Define base fields that should NOT appear in advanced fields
    const baseFields = getBaseFields(elementType);

    // Filter out base fields from the schema
    const advancedProperties: Record<string, SchemaNode> = { ...(fullSchema.properties ?? {}) };
    baseFields.forEach(field => {
      delete advancedProperties[field];
    });

    // For ThermalBridgeLinear, remove junction_type from schema so we can render it manually
    if (elementType === 'ThermalBridgeLinear' && advancedProperties.junction_type) {
      // Remove it from properties so DirectAdvancedFields' flat walk doesn't render it
      delete advancedProperties.junction_type;
    }

    if (shouldRenderMechanicalVentilationFixedEnergySupply) {
      delete advancedProperties.EnergySupply;
    }

    // WetEmitter: main form owns UFH area and fancoil unit count; fancoil test data uses a dedicated editor below.
    if (elementType === 'WetEmitter' && subtype === 'ufh') {
      delete advancedProperties.emitter_floor_area;
    }
    if (elementType === 'WetEmitter' && subtype === 'fancoil') {
      delete advancedProperties.n_units;
      delete advancedProperties.fancoil_test_data;
    }

    // Radiator: show only the active per-metre / lumped branch so the user can't
    // mix representations the engine would silently ignore (see radiatorEmitterBranches).
    if (shouldRenderRadiatorThermalMode) {
      const inactiveFields =
        radiatorThermalMode === 'per_metre' ? RADIATOR_LUMPED_FIELDS : RADIATOR_PER_METRE_FIELDS;
      deleteProperties(advancedProperties as Record<string, unknown>, inactiveFields);
    }

    // Ground UI clarity: show subtype-specific inputs only where they are meaningful.
    if (elementType === 'BuildingElementGround') {
      delete advancedProperties.thermal_resistance_construction;
    }
    if (elementType === 'BuildingElementGround' && subtype !== 'Suspended_floor') {
      delete advancedProperties.height_upper_surface;
      delete advancedProperties.area_per_perimeter_vent;
      delete advancedProperties.thermal_resist_insul;
      delete advancedProperties.shield_fact_location;
    }
    if (
      elementType === 'BuildingElementGround' &&
      subtype !== 'Suspended_floor' &&
      subtype !== 'Unheated_basement'
    ) {
      delete advancedProperties.thermal_transm_walls;
    }

    // Ground `edge_insulation`: Core schema lists it on several floor_type variants; we only surface it here for
    // Slab_edge_insulation (custom control below). Never use a raw JSON text field for this key.
    if (elementType === 'BuildingElementGround' && advancedProperties.edge_insulation) {
      delete advancedProperties.edge_insulation;
    }

    let mechanicalVentilationRequiredFields: string[] | null = null;
    if (useFHSSchema && elementType === 'MechanicalVentilation') {
      const requiredFields = new Set(
        Array.isArray(fullSchema.required)
          ? fullSchema.required.filter((field): field is string => typeof field === 'string')
          : [],
      );

      if (shouldRenderMechanicalVentilationFanMode) {
        if (mechanicalVentilationFanInputMode === 'sfp') {
          deleteProperties(advancedProperties as Record<string, unknown>, MECHANICAL_VENTILATION_MEASURED_FIELDS);
          MECHANICAL_VENTILATION_MEASURED_FIELDS.forEach((field) => requiredFields.delete(field));
          MECHANICAL_VENTILATION_SFP_FIELDS.forEach((field) => requiredFields.add(field));
        } else {
          deleteProperties(advancedProperties as Record<string, unknown>, MECHANICAL_VENTILATION_SFP_FIELDS);
          MECHANICAL_VENTILATION_SFP_FIELDS.forEach((field) => requiredFields.delete(field));
          MECHANICAL_VENTILATION_MEASURED_FIELDS.forEach((field) => requiredFields.add(field));
        }
      }

      if (shouldRenderMechanicalVentilationPositionMode) {
        const positionExhaustSchema =
          (advancedProperties as Record<string, unknown>).position_exhaust ??
          buildMechanicalVentilationPositionObjectSchema(advancedProperties);
        if (mechanicalVentilationPositionMode === 'flat') {
          deleteProperties(
            advancedProperties as Record<string, unknown>,
            MECHANICAL_VENTILATION_POSITION_OBJECT_FIELDS,
          );
          requiredFields.delete('position_exhaust');
          MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS.forEach((field) => requiredFields.add(field));
        } else {
          deleteProperties(
            advancedProperties as Record<string, unknown>,
            MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS,
          );
          delete (advancedProperties as Record<string, unknown>).position_intake;
          (advancedProperties as Record<string, unknown>).position_exhaust = positionExhaustSchema;
          MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS.forEach((field) => requiredFields.delete(field));
          requiredFields.add('position_exhaust');
        }
      } else if (mechanicalVentilationVentType === 'MVHR') {
        deleteProperties(
          advancedProperties as Record<string, unknown>,
          MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS,
        );
        deleteProperties(
          advancedProperties as Record<string, unknown>,
          MECHANICAL_VENTILATION_POSITION_OBJECT_FIELDS,
        );
        delete (advancedProperties as Record<string, unknown>).ductwork;
        requiredFields.delete('EnergySupply');
        requiredFields.delete('ductwork');
        requiredFields.delete('position_intake');
        requiredFields.delete('position_exhaust');
      }

      mechanicalVentilationRequiredFields = Array.from(requiredFields).filter((field) =>
        Object.prototype.hasOwnProperty.call(advancedProperties, field),
      );
    }

    // Window `treatment`: use simplified control below (Table 3.6.b + schema fields).
    if (elementType === 'BuildingElementTransparent' && advancedProperties.treatment) {
      delete advancedProperties.treatment;
    }

    // Window shading is represented canonically as child WindowShading elements in the editor.
    // Do not expose the raw HEM `shading` array here, or users can double-define shading.
    if (elementType === 'BuildingElementTransparent' && advancedProperties.shading) {
      delete advancedProperties.shading;
    }

    // Transparent elements should use `u_value`; do not surface opaque-only R-construction input here.
    if (elementType === 'BuildingElementTransparent' && advancedProperties.thermal_resistance_construction) {
      delete advancedProperties.thermal_resistance_construction;
    }

    // Optional HEM field — not required; omit from Advanced Fields / extra_json (defaults apply).
    if (elementType === 'BuildingElementTransparent' && advancedProperties.Control_WindowOpenable) {
      delete advancedProperties.Control_WindowOpenable;
    }

    // `security_risk`: FHS boolean — show Yes/No dropdown + official guidance (EnumControl).
    // R4.3b: this intent is finally REALIZED, not just aspirational. Through R4.3,
    // DirectAdvancedFields' executed-table `pickDirectControl` routed boolean type
    // ahead of enum, so this inlined `.enum` was inert here -- BooleanControl's plain
    // checkbox won regardless. R4.3b's enum-first dispatch order means this field now
    // actually reaches EnumControl, whose propKey-gated Yes/No label mapping
    // (jsonformsRenderers.tsx) was itself dead code until this slice made it reachable.
    if (elementType === 'BuildingElementTransparent' && advancedProperties.security_risk) {
      advancedProperties.security_risk = {
        type: 'boolean',
        enum: [true, false],
        title: WINDOW_SECURITY_RISK_LABEL,
        description: WINDOW_SECURITY_RISK_HELPER,
      };
    }

    // shield_fact_location renders as a dropdown either way (SELECT, both pre- and
    // post-R4.3b), but the CONTROL behind it changed: through R4.3, DirectAdvancedFields'
    // executed-table `pickDirectControl` routed 'string' type ahead of enum, so this
    // field reached TextControl's own `extractOptions` dropdown fallback -- validation
    // errors and helper text dropped, since only EnumControl forwards those. R4.3b's
    // enum-first dispatch now routes it to EnumControl proper instead.
    //
    // R4.6a CORRECTION, and the reason this override SURVIVES the generic
    // nullable-wrapper unwrap that retired its `mvhr_location` twin: the claim this
    // comment used to make -- "a bare `anyOf` (HEM's shield_fact_location is `$ref`'d
    // inside one) derives no `.enum`/type for `pickDirectControl` to see at all" -- is
    // simply not true of this field on EITHER profile, checked directly against both
    // published schemas. FHS emits `{enum:['Sheltered','Average','Exposed']}` inline
    // (no wrapper, no `$ref`); Core emits `{$ref:'#/$defs/WindShieldLocation',
    // description:'Wind shielding factor'}` -- a bare `$ref` with a sibling, which
    // `dereferenceSchemaNodeInRoot` inlines into a flat `{enum, title, type}` before
    // `pickDirectControl` ever runs. Both already route to EnumControl unaided, and
    // `unwrapNullableSchema` (DirectAdvancedFields.tsx) never touches either shape.
    //
    // R4.6a noted that what this override still did, beyond the flat enum, was PIN THE
    // LABEL: Core's `$defs/WindShieldLocation` carries `title: 'WindShieldLocation'` and
    // the property site carries none of its own, so `labelForProperty` would have
    // rendered the raw `$def` name. That was left "for whoever owns the '$def titles as
    // field labels' question", and R4.6b-3 is that owner: the label content rule rejects
    // a pydantic type name outright, so Core derives "Shield Fact Location" from the key
    // on its own and the hand-pinned `title` is GONE from the block below. The field is
    // now labelled by the same rule as every other row rather than by a special case,
    // and its neighbour `mvhr_location` -- the field this comment used to contrast it
    // with -- is derived by that same rule too.
    //
    // The flat enum stays: it is a claim about the CONTROL, not the label. Both profiles
    // route to EnumControl unaided today (FHS emits `{enum:[...]}` inline; Core's bare
    // `$ref` with a sibling description is inlined by `dereferenceSchemaNodeInRoot`
    // before `pickDirectControl` runs), so it is belt-and-braces, but it is also what
    // fixes the enum VALUES to `WIND_SHIELD_LOCATION_ENUM` and that is not this slice's
    // question to reopen.
    if (elementType === 'BuildingElementGround' && subtype === 'Suspended_floor' && advancedProperties.shield_fact_location) {
      const sh = advancedProperties.shield_fact_location as Record<string, unknown>;
      advancedProperties.shield_fact_location = {
        type: 'string',
        enum: [...WIND_SHIELD_LOCATION_ENUM],
        ...(typeof sh.description === 'string' ? { description: sh.description } : {}),
      };
    }

    // R4.6a DELETION NOTE: `mvhr_location` used to get its own inline flat-enum
    // override here, added in R4.5 review round 1 because HEM's
    // `$defs/MechanicalVentilation.properties.mvhr_location` is
    // `{anyOf:[{$ref:'#/$defs/MVHRLocation'},{type:'null'}]}` on Core and that wrapper
    // reached `pickDirectControl` with no top-level type or enum to dispatch on, so
    // the field rendered as a free-text box. `unwrapNullableSchema`
    // (DirectAdvancedFields.tsx) now collapses that wrapper generically, at every
    // resolution site, for all 26 misrouted property routes at once -- so this
    // one-field patch became dead weight and is gone. Verified by re-running the Core
    // MechanicalVentilation characterization across the deletion, not assumed: same
    // EnumControl, same inside/outside options, same forwarded description. ONE
    // intended difference -- the LABEL goes from "MVHRLocation" to "Mvhr Location".
    // The override reached into `$defs/MVHRLocation.title` and used the pydantic enum
    // CLASS NAME as the field label; `unwrapNullableSchema` deliberately carries no
    // inner annotations (see its docstring), so this titleless property now
    // start-cases its own key like every other titleless row in the same grid. That
    // is a correction, not a casualty. See
    // `AdvancedFieldsEditor.directRender.test.tsx`'s Core MechanicalVentilation
    // characterization, unchanged across this deletion apart from that label and the
    // four NUMBER rows that gained their schema minima. Its `shield_fact_location`
    // neighbour above is NOT redundant and stays; see the correction there for why.

    let result: SchemaNode = {
      ...fullSchema,
      properties: advancedProperties
    };
    if (mechanicalVentilationRequiredFields) {
      result.required = mechanicalVentilationRequiredFields;
    }

    if (elementType === 'System' && subtype) {
      const rootFull = getActiveRootSchema();
      if (rootFull && result) {
        const derefed = dereferenceSchemaNodeInRoot(result, rootFull) as typeof result;
        result = flattenSystemSubtypePlantSchemas(
          derefed as Record<string, unknown>,
          subtype,
          systemSubtypePlantMapSlice &&
            typeof systemSubtypePlantMapSlice === 'object' &&
            !Array.isArray(systemSubtypePlantMapSlice)
            ? (systemSubtypePlantMapSlice as Record<string, unknown>)
            : null,
          rootFull,
        ) as typeof result;
      }
    }
    if (elementType === 'System' && subtype === 'SpaceHeatSystem' && result) {
      result = pruneSpaceHeatSystemLinkedFields(
        result as Record<string, unknown>,
        systemSubtypePlantMapSlice &&
          typeof systemSubtypePlantMapSlice === 'object' &&
          !Array.isArray(systemSubtypePlantMapSlice)
          ? (systemSubtypePlantMapSlice as Record<string, unknown>)
          : null,
      ) as typeof result;
      result = applyEcodesignControlClassEnum(result as Record<string, unknown>) as typeof result;
      result = pruneSpaceHeatSystemWeatherCompensationSchema(
        result as Record<string, unknown>,
        advancedFieldsData,
      ) as typeof result;
    }

    if (elementType === 'System' && subtype === 'HotWaterSource' && result) {
      const pr = pruneHotWaterSourceHwCylinderSchemaForInstance(
        result as Record<string, unknown>,
        advancedFieldsData,
      );
      if (pr) {
        result = pr as typeof result;
      }
      if (useFHSSchema) {
        const rootFhs = schemaPort.availability === 'available'
          ? schemaPort.getRootSchema('fhs') as Record<string, unknown> | null
          : null;
        if (rootFhs) {
          inlineHwCylinderColdWaterSourceEnumOnHotWaterSubschema(result as Record<string, unknown>, rootFhs);
        }
        inlineHotWaterSourceHeatSourceWetEnumOnHotWaterSubschema(result as Record<string, unknown>, {
          definedNames: projectHeatSourceWetNames,
          currentCombiLink: currentHotWaterCombiHeatSourceWetLink || null,
          labels: projectHeatSourceWetLabels,
        });
      }
    }

    return result as AdvancedFieldsSchema;
  }, [
    elementType,
    subtype,
    useFHSSchema,
    getActiveElementSubschema,
    getActiveRootSchema,
    getBaseFields,
    schemaPort,
    mechanicalVentilationVentType,
    shouldRenderMechanicalVentilationFixedEnergySupply,
    shouldRenderMechanicalVentilationFanMode,
    shouldRenderMechanicalVentilationPositionMode,
    mechanicalVentilationFanInputMode,
    mechanicalVentilationPositionMode,
    shouldRenderRadiatorThermalMode,
    radiatorThermalMode,
    advancedFieldsData,
    currentHotWaterCombiHeatSourceWetLink,
    projectHeatSourceWetLabels,
    projectHeatSourceWetNames,
  ]);

  const systemAdvancedUischema = useMemo<AdvancedFieldsLayoutNode | undefined>(() => {
    if (elementType !== 'System' || !subtype || !subschema) return undefined;
    return buildSystemAdvancedUischema(subtype, subschema as Record<string, unknown>);
  }, [elementType, subtype, subschema]);

  const isSystemPcdbMode = useMemo(() => {
    if (elementType !== 'System') return false;
    return inspectorContributions.productCatalogue?.hasAppliedSystemData(
      currentData?.extra_json,
    ) ?? false;
  }, [
    elementType,
    currentData.extra_json,
    inspectorContributions.productCatalogue,
  ]);

  const isSystemSampleMode = useMemo(() => {
    if (elementType !== 'System') return false;
    if (isSystemPcdbMode) return false;
    const preset = currentData?.system_preset;
    return typeof preset === 'string' && preset.trim().length > 0;
  }, [elementType, isSystemPcdbMode, currentData.system_preset]);

  const currentSpaceHeatSystemHeatSourceNameForBaseline = useMemo(() => {
    if (elementType !== 'System' || subtype !== 'SpaceHeatSystem') return '';
    const currentSystemEntry = firstRecordEntry(readExtraJsonRecord(currentData?.extra_json).SpaceHeatSystem);
    const currentHeatSource = readExtraJsonRecord(currentSystemEntry?.[1]?.HeatSource);
    return typeof currentHeatSource.name === 'string' ? currentHeatSource.name.trim() : '';
  }, [elementType, subtype, currentData.extra_json]);

  const heatSourceWetNamesForBaseline = useMemo(() => {
    if (elementType !== 'System' || subtype !== 'SpaceHeatSystem') return [];
    return Object.values(elementsById)
      .map(resolveHeatSourceWetReferenceName)
      .filter((name): name is string => !!name)
      .sort();
  }, [elementType, subtype, elementsById]);
  const heatSourceWetNamesForBaselineSig = heatSourceWetNamesForBaseline.join('|');

  const systemSamplePreset = typeof currentData?.system_preset === 'string'
    ? currentData.system_preset.trim()
    : '';
  const systemSampleDirectory = elementType === 'System' && isSystemSampleMode && subtype
    ? SYSTEM_SUBCATEGORY_TO_DIR[subtype]
    : undefined;
  const systemSampleZoneId = typeof currentData?.zoneId === 'string' ? currentData.zoneId : '';
  const systemSampleZoneName = zones.find((zone) => zone.id === systemSampleZoneId)?.name?.trim() || null;
  const systemSampleBaselineKey = systemSampleDirectory && systemSamplePreset
    ? [
        currentData?.id ?? '',
        systemSampleDirectory,
        systemSamplePreset,
        currentData?.name ?? '',
        systemSampleZoneId,
        systemSampleZoneName ?? '',
        currentSpaceHeatSystemHeatSourceNameForBaseline,
        heatSourceWetNamesForBaselineSig,
        JSON.stringify(currentData?.extra_json ?? null),
      ].join('\0')
    : 'inactive';
  const [systemSampleBaselineExtraJson, setSystemSampleBaselineExtraJson] =
    useKeyedState<Record<string, unknown> | null>(systemSampleBaselineKey, null);

  useEffect(() => {
    if (!systemSampleDirectory || !systemSamplePreset || !subtype) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await workspaceResourcePort.readText(
          `input/batch_parameters/${systemSampleDirectory}/${systemSamplePreset}.json`,
        );
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const heatSourceWetNames = heatSourceWetNamesForBaselineSig
          ? heatSourceWetNamesForBaselineSig.split('|')
          : [];
        const systemName = typeof currentData?.name === 'string' && currentData.name.trim()
          ? currentData.name.trim()
          : 'Space heating';
        const heatSourceName =
          currentSpaceHeatSystemHeatSourceNameForBaseline ||
          (heatSourceWetNames.length === 1 ? heatSourceWetNames[0] : null);
        const baseline = subtype === 'SpaceHeatSystem'
          ? buildSpaceHeatSystemSampleBaselineExtraJson(
              parsed,
              currentData?.extra_json,
              systemName,
              systemSampleZoneName,
              heatSourceName,
            )
          : parsed;
        if (!cancelled) setSystemSampleBaselineExtraJson(baseline);
      } catch {
        if (!cancelled) setSystemSampleBaselineExtraJson(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    currentData?.name,
    currentData?.extra_json,
    currentSpaceHeatSystemHeatSourceNameForBaseline,
    heatSourceWetNamesForBaselineSig,
    setSystemSampleBaselineExtraJson,
    subtype,
    systemSampleDirectory,
    systemSamplePreset,
    systemSampleZoneName,
    workspaceResourcePort,
  ]);

  const systemSampleBaselineAvailable = isSystemSampleMode && !!systemSampleBaselineExtraJson;

  const systemPlantTypes = useMemo(() => {
    if (elementType !== 'System' || !subtype) return [] as Array<{ plantKey: string; typeLabel: string }>;
    const subtypeSlice = (advancedFieldsData as Record<string, unknown>)?.[subtype];
    if (!subtypeSlice || typeof subtypeSlice !== 'object' || Array.isArray(subtypeSlice)) {
      return [] as Array<{ plantKey: string; typeLabel: string }>;
    }
    const rows: Array<{ plantKey: string; typeLabel: string }> = [];
    for (const [plantKey, plantPayload] of Object.entries(subtypeSlice as Record<string, unknown>)) {
      if (!plantPayload || typeof plantPayload !== 'object' || Array.isArray(plantPayload)) continue;
      const rawType = (plantPayload as Record<string, unknown>).type;
      if (rawType === undefined || rawType === null || rawType === '') continue;
      rows.push({ plantKey, typeLabel: String(rawType) });
    }
    return rows;
  }, [elementType, subtype, advancedFieldsData]);

  const shouldUseGroundThermalTransmWallsAutofill =
    elementType === 'BuildingElementGround' && usesGroundThermalTransmWallsAutofill(subtype);

  const suspendedThermalTransmWallsAutofillHasSources =
    shouldUseGroundThermalTransmWallsAutofill
      ? hasSuspendedFloorThermalTransmWallsAutofillSourcesForGroundElement(
          elementsById,
          currentElementData ?? undefined,
          defaultsLookup,
        )
      : undefined;

  const suspendedThermalTransmWallsAutofill = useMemo(
    () =>
      shouldUseGroundThermalTransmWallsAutofill
        ? computeSuspendedThermalTransmWallsAutofillResultForGroundElement(
            elementsById,
            currentElementData ?? undefined,
            defaultsLookup,
          )
        : { value_W_m2K: null, areaTotalM2: 0, sources: [] },
    [shouldUseGroundThermalTransmWallsAutofill, elementsById, currentElementData, defaultsLookup],
  );

  const assemblySourceValues = useMemo(() => {
    const envelope = parseVulcanAssemblyV1FromExtraJson(currentData?.extra_json);
    if (!envelope) return {};
    const out: Record<string, unknown> = {};
    if (typeof envelope.uValueWrittenToElement_W_m2K === 'number') {
      out.u_value = envelope.uValueWrittenToElement_W_m2K;
    }
    if (typeof envelope.thermalResistanceConstruction_m2K_W === 'number') {
      out[
        elementType === 'BuildingElementGround'
          ? 'thermal_resistance_floor_construction'
          : 'thermal_resistance_construction'
      ] = envelope.thermalResistanceConstruction_m2K_W;
    }
    if (typeof envelope.thermalResistanceGroundInsulation_m2K_W === 'number') {
      out.thermal_resist_insul = envelope.thermalResistanceGroundInsulation_m2K_W;
    }
    if (typeof envelope.arealHeatCapacityWrittenToElement_J_m2K === 'number') {
      const jWritten = envelope.arealHeatCapacityWrittenToElement_J_m2K;
      // FHS advanced schema stores enum labels (e.g. "Very light"); assembly envelope keeps snapped J/(m²·K).
      out.areal_heat_capacity = useFHSSchema
        ? arealHeatCapacityBandFromJPerM2K(jWritten) ?? jWritten
        : jWritten;
    }
    if (typeof envelope.massDistributionClass === 'string') {
      out.mass_distribution_class = envelope.massDistributionClass;
    }
    if (
      elementType === 'BuildingElementGround' &&
      subtype === 'Suspended_floor' &&
      typeof envelope.suspendedHeightUpperSurfaceM === 'number' &&
      Number.isFinite(envelope.suspendedHeightUpperSurfaceM)
    ) {
      out.height_upper_surface = roundToTwoDecimals(envelope.suspendedHeightUpperSurfaceM);
    }
    return out;
  }, [currentData.extra_json, elementType, subtype, useFHSSchema]);

  const groundUComputedWPerM2K = useMemo(
    () =>
      elementType === 'BuildingElementGround'
        ? computeGroundUValueFromElementModel(
            currentData as Record<string, unknown>,
            advancedFieldsData as Record<string, unknown>,
            subtype,
          )
        : null,
    [elementType, currentData, advancedFieldsData, subtype],
  );
  const resyncSuspendedThermalTransmWalls = useCallback(() => {
    if (
      elementType !== 'BuildingElementGround' ||
      !usesGroundThermalTransmWallsAutofill(subtype)
    ) return;
    const id = currentElementData?.id;
    if (!id) return;
    const el = (elementsById[id] as Element | undefined) ?? currentElementData;
    if (!el || el.type !== 'BuildingElementGround') return;
    const u = suspendedThermalTransmWallsAutofill.value_W_m2K;
    if (u == null) return;
    const ex = readExtraJsonRecord(el.extra_json);
    const rest = { ...ex };
    delete rest[THERMAL_TRANSM_WALLS_MANUAL_KEY];
    onChange({
      ...currentData,
      extra_json: {
        ...rest,
        thermal_transm_walls: roundToTwoDecimals(u),
      },
    });
  }, [elementType, subtype, currentData, currentElementData, elementsById, onChange, suspendedThermalTransmWallsAutofill.value_W_m2K]);

  const opaqueFabricVariant = useMemo(() => {
    if (elementType !== 'BuildingElementOpaque') return undefined;
    return classifyOpaqueFabricVariantFromElement((currentData ?? {}) as Record<string, unknown>);
  }, [elementType, currentData]);

  const advancedFieldsConfig = useMemo<Record<string, unknown>>(
    () =>
      ({
        advancedEditor: true,
        compact: flat ? true : undefined,
        elementType,
        subtype,
        opaqueFabricVariant,
        fieldIndicators,
        evidenceFieldKeys,
        openRuCalculator:
          elementType === 'BuildingElementAdjacentUnconditionedSpace_Simple'
            ? openRuCalculator
            : undefined,
        openGroundUCalculator:
          elementType === 'BuildingElementGround'
            ? openGroundUCalculator
            : undefined,
        groundUComputedWPerM2K:
          elementType === 'BuildingElementGround' ? groundUComputedWPerM2K : undefined,
        resyncSuspendedThermalTransmWalls:
          shouldUseGroundThermalTransmWallsAutofill
            ? resyncSuspendedThermalTransmWalls
            : undefined,
        suspendedThermalTransmWallsAutofillHasSources,
        suspendedThermalTransmWallsAutoValue:
          shouldUseGroundThermalTransmWallsAutofill
            ? suspendedThermalTransmWallsAutofill.value_W_m2K
            : undefined,
        suspendedThermalTransmWallsAutofillSources:
          shouldUseGroundThermalTransmWallsAutofill
            ? suspendedThermalTransmWallsAutofill.sources
            : undefined,
        focusSourceElement:
          shouldUseGroundThermalTransmWallsAutofill
            ? (elementId: string) => setSelection({ type: 'element', id: elementId })
            : undefined,
        assemblySourceValues,
        useFHSSchemaForValidation: useFHSSchema,
        currentElementData: currentData,
        schemaPort,
        floors,
        // Pass $defs through config so TextControl can resolve references
        $defs: subschema?.$defs || getActiveRootSchema()?.$defs,
        systemSampleMode: systemSampleBaselineAvailable,
        systemSampleBaselineExtraJson: systemSampleBaselineExtraJson ?? undefined,
      }),
    [
      flat,
      elementType,
      subtype,
      opaqueFabricVariant,
      fieldIndicators,
      evidenceFieldKeys,
      currentData,
      schemaPort,
      floors,
      openRuCalculator,
      openGroundUCalculator,
      groundUComputedWPerM2K,
      resyncSuspendedThermalTransmWalls,
      suspendedThermalTransmWallsAutofillHasSources,
      suspendedThermalTransmWallsAutofill.value_W_m2K,
      suspendedThermalTransmWallsAutofill.sources,
      shouldUseGroundThermalTransmWallsAutofill,
      setSelection,
      assemblySourceValues,
      useFHSSchema,
      subschema,
      systemSampleBaselineAvailable,
      systemSampleBaselineExtraJson,
      getActiveRootSchema,
    ],
  );

  // ThermalBridgeLinear `junction_type` is rendered manually (with richer labels + ψ autofill).
  // In FHS schemas this field may be declared conditionally under `allOf/then` rather than
  // flattened into top-level `properties`, so do not gate rendering on subschema.properties.
  const shouldRenderJunctionTypeManually = elementType === 'ThermalBridgeLinear';

  const shouldRenderEdgeInsulationManually =
    elementType === 'BuildingElementGround' && subtype === 'Slab_edge_insulation';

  const shouldRenderWindowTreatmentManually = elementType === 'BuildingElementTransparent';

  const shouldRenderFancoilTestDataManually =
    elementType === 'WetEmitter' &&
    subtype === 'fancoil' &&
    !!getActiveElementSubschema(elementType, subtype)?.properties?.fancoil_test_data;

  // Count custom (explicit) fields for CURRENT element type only:
  // - defined and not empty
  // - key exists in current subschema properties (ignore stale keys from other types)
  // - Include junction_type for ThermalBridgeLinear even though it's rendered manually
  const customCount = useMemo(() => {
    if (!advancedFieldsData || typeof advancedFieldsData !== 'object') return 0;
    const fullSchema = getActiveElementSubschema(elementType, subtype);

    // Start from the subschema properties (already filtered for the element type)
    const allProps = new Set(Object.keys(fullSchema?.properties || {}));

    // Exclude base fields so we only count *advanced* fields (those that
    // can actually appear in the Advanced Fields UI)
    const baseFields = new Set(getBaseFields(elementType));
    const props = new Set(
      Array.from(allProps).filter((k) => !baseFields.has(k))
    );

    // For ThermalBridgeLinear, include junction_type in the count
    if (elementType === 'ThermalBridgeLinear') {
      props.add('junction_type');
    }
    if (elementType === 'BuildingElementGround' && subtype === 'Slab_edge_insulation') {
      props.add('edge_insulation');
    }
    if (elementType === 'BuildingElementTransparent') {
      props.add('treatment');
      props.delete('shading');
      props.delete('Control_WindowOpenable');
      props.delete('thermal_resistance_construction');
    }
    if (elementType === 'WetEmitter' && subtype === 'fancoil') {
      props.add('fancoil_test_data');
    }
    if (shouldRenderRadiatorThermalMode) {
      const inactiveFields =
        radiatorThermalMode === 'per_metre' ? RADIATOR_LUMPED_FIELDS : RADIATOR_PER_METRE_FIELDS;
      inactiveFields.forEach((field) => props.delete(field));
    }
    if (useFHSSchema && elementType === 'MechanicalVentilation') {
      if (shouldRenderMechanicalVentilationFanMode) {
        if (mechanicalVentilationFanInputMode === 'sfp') {
          MECHANICAL_VENTILATION_MEASURED_FIELDS.forEach((field) => props.delete(field));
          MECHANICAL_VENTILATION_SFP_FIELDS.forEach((field) => props.add(field));
        } else {
          MECHANICAL_VENTILATION_SFP_FIELDS.forEach((field) => props.delete(field));
          MECHANICAL_VENTILATION_MEASURED_FIELDS.forEach((field) => props.add(field));
        }
      }
      if (shouldRenderMechanicalVentilationPositionMode) {
        if (mechanicalVentilationPositionMode === 'flat') {
          MECHANICAL_VENTILATION_POSITION_OBJECT_FIELDS.forEach((field) => props.delete(field));
          MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS.forEach((field) => props.add(field));
        } else {
          MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS.forEach((field) => props.delete(field));
          props.delete('position_intake');
          props.add('position_exhaust');
        }
      } else if (mechanicalVentilationVentType === 'MVHR') {
        MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS.forEach((field) => props.delete(field));
        MECHANICAL_VENTILATION_POSITION_OBJECT_FIELDS.forEach((field) => props.delete(field));
        props.delete('EnergySupply');
        props.delete('ductwork');
      }
    }
    return Object.entries(advancedFieldsData)
      .filter(([k, v]) => {
        if (!props.has(k)) return false;
        if (elementType === 'WetEmitter' && subtype === 'fancoil' && k === 'n_units') return false;
        if (v === undefined || v === null || v === '') return false;
        // Treat empty arrays/objects as "no data" (e.g. shading: [])
        if (Array.isArray(v) && v.length === 0) return false;
        if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return false;
        return true;
      })
      .length;
  }, [
    advancedFieldsData,
    elementType,
    subtype,
    useFHSSchema,
    mechanicalVentilationVentType,
    shouldRenderMechanicalVentilationFanMode,
    shouldRenderMechanicalVentilationPositionMode,
    mechanicalVentilationFanInputMode,
    mechanicalVentilationPositionMode,
    shouldRenderRadiatorThermalMode,
    radiatorThermalMode,
    getActiveElementSubschema,
    getBaseFields,
  ]);

  // Removed missingRequiredFields logic - validation is now purely schema-driven

  // Preload schema and defaults on mount
  useEffect(() => {
    if (schemaPort.availability !== 'available') return;
    // Always preload both schemas - Core for Advanced Fields, FHS for conditional property merging
    const preload = async () => {
      await Promise.all([schemaPort.preload('core'), schemaPort.preload('fhs')]);
    };
    preload().then(() => {
      // Best-effort: ensure root schema is loaded in AJV for reference resolution.
      // Note: AJVCache currently only supports a single "root" schema; in practice most
      // advanced-field subschemas include $defs inline, so this is mainly for Core mode.
      const schema = schemaPort.getRootSchema(schemaMode);
      if (schema) {
        ensureRootSchema(schema);
      }
    });
    // Defaults are loaded from the user's defaultsPath via the store/ioSlice.
  }, [schemaMode, schemaPort]);

  useEffect(() => {
    if (!focusFieldKey || !focusFieldVersion) return;
    // This effect consumes an explicit cross-panel focus command and must reveal its target.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsExpanded(true);
    const timer = window.setTimeout(() => {
      const target = containerRef.current?.querySelector(`[data-field-key="${focusFieldKey}"]`);
      if (target && typeof (target as HTMLElement).scrollIntoView === 'function') {
        (target as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusFieldKey, focusFieldVersion]);

  // Handle Advanced Fields data changes (from DirectAdvancedFields and the several
  // manually-rendered fields below that share this same commit path).
  const handleAdvancedFieldsChange = ({ data }: AdvancedFieldsChangePayload) => {
    const dataRecord: Record<string, unknown> = isPlainRecord(data) ? { ...data } : {};
    // Preserve UI-only metadata keys that aren't part of the element schema (for
    // example _element_preset and psi_source), in case the incoming `data` omits
    // them — defensive against any caller that rebuilds `data` without carrying them
    // forward, rather than relying on every call site's own spread of the prior value.
    const existingExtra = currentData.extra_json;
    if (isPlainRecord(existingExtra)) {
      for (const [k, v] of Object.entries(existingExtra)) {
        if ((k.startsWith('_') || EXTRA_JSON_UI_KEY_SET.has(k)) && !(k in dataRecord)) {
          dataRecord[k] = v;
        }
      }
    }
    let nextExtra: Record<string, unknown> = dataRecord;
    if (
      useFHSSchema &&
      elementType === 'MechanicalVentilation' &&
      nextExtra &&
      typeof nextExtra === 'object' &&
      !Array.isArray(nextExtra)
    ) {
      nextExtra = pruneMechanicalVentilationExtraJson(nextExtra as Record<string, unknown>, {
        fanInputMode: shouldRenderMechanicalVentilationFanMode ? mechanicalVentilationFanInputMode : null,
        positionMode: shouldRenderMechanicalVentilationPositionMode ? mechanicalVentilationPositionMode : null,
      });
      if (mechanicalVentilationVentType === 'MVHR') {
        const nextRecord = { ...(nextExtra as Record<string, unknown>) };
        deleteProperties(nextRecord, MECHANICAL_VENTILATION_FLAT_POSITION_FIELDS);
        nextRecord.EnergySupply = MVHR_FIXED_ENERGY_SUPPLY;
        nextExtra = nextRecord;
      }
    }
    if (
      shouldRenderRadiatorThermalMode &&
      nextExtra &&
      typeof nextExtra === 'object' &&
      !Array.isArray(nextExtra)
    ) {
      nextExtra = pruneRadiatorEmitterExtraJson(nextExtra as Record<string, unknown>, radiatorThermalMode);
    }
    if (
      elementType === 'BuildingElementGround' &&
      (subtype === 'Suspended_floor' || subtype === 'Unheated_basement') &&
      nextExtra &&
      typeof nextExtra === 'object' &&
      'shield_fact_location' in nextExtra
    ) {
      const parsed = parseWindShieldLocation((nextExtra as Record<string, unknown>).shield_fact_location);
      if ((nextExtra as Record<string, unknown>).shield_fact_location !== parsed) {
        nextExtra = { ...(nextExtra as Record<string, unknown>), shield_fact_location: parsed };
      }
    }
    // edge_insulation is deleted from advancedProperties above, so DirectAdvancedFields'
    // flat walk never emits a control for it (and never carries it through an edit) —
    // restore it here so the manually-rendered EdgeInsulationFields control's own value
    // for this key survives an unrelated Advanced Fields edit.
    if (
      elementType === 'BuildingElementGround' &&
      subtype === 'Slab_edge_insulation' &&
      nextExtra &&
      typeof nextExtra === 'object' &&
      !Array.isArray(nextExtra) &&
      !Object.prototype.hasOwnProperty.call(nextExtra, 'edge_insulation')
    ) {
      nextExtra = {
        ...(nextExtra as Record<string, unknown>),
        edge_insulation: (advancedFieldsData as Record<string, unknown>).edge_insulation,
      };
    }
    if (
      elementType === 'BuildingElementTransparent' &&
      nextExtra &&
      typeof nextExtra === 'object' &&
      !Array.isArray(nextExtra) &&
      !Object.prototype.hasOwnProperty.call(nextExtra, 'treatment')
    ) {
      nextExtra = {
        ...(nextExtra as Record<string, unknown>),
        treatment: (advancedFieldsData as Record<string, unknown>).treatment,
        [TREATMENT_UI_KEY]: (advancedFieldsData as Record<string, unknown>)[TREATMENT_UI_KEY],
      };
    }
    if (
      elementType === 'WetEmitter' &&
      subtype === 'fancoil' &&
      nextExtra &&
      typeof nextExtra === 'object' &&
      !Array.isArray(nextExtra) &&
      !Object.prototype.hasOwnProperty.call(nextExtra, 'fancoil_test_data')
    ) {
      const prev = advancedFieldsData as Record<string, unknown>;
      if (prev.fancoil_test_data !== undefined) {
        nextExtra = { ...(nextExtra as Record<string, unknown>), fancoil_test_data: prev.fancoil_test_data };
      }
    }
    if (
      elementType === 'BuildingElementTransparent' &&
      nextExtra &&
      typeof nextExtra === 'object' &&
      !Array.isArray(nextExtra) &&
      'Control_WindowOpenable' in (nextExtra as Record<string, unknown>)
    ) {
      nextExtra = { ...(nextExtra as Record<string, unknown>) };
      delete (nextExtra as Record<string, unknown>).Control_WindowOpenable;
    }
    if (
      elementType === 'BuildingElementGround' &&
      usesGroundThermalTransmWallsAutofill(subtype) &&
      nextExtra &&
      typeof nextExtra === 'object' &&
      !Array.isArray(nextExtra)
    ) {
      nextExtra = applySuspendedThermalTransmWallsManualTracking(
        advancedFieldsData as Record<string, unknown>,
        nextExtra as Record<string, unknown>,
        suspendedThermalTransmWallsAutofill.value_W_m2K,
      );
    }
    if (
      elementType === 'System' &&
      subtype &&
      nextExtra &&
      typeof nextExtra === 'object' &&
      !Array.isArray(nextExtra)
    ) {
      nextExtra = mergeSystemExtraJsonAfterJsonForms(
        advancedFieldsData as Record<string, unknown>,
        nextExtra as Record<string, unknown>,
        subtype,
      );
      if (subtype === 'SpaceHeatSystem') {
        nextExtra = pruneSpaceHeatSystemUnusedWeatherCompensationValues(
          nextExtra as Record<string, unknown>,
        );
      }
    }
    if (
      elementType === 'BuildingElementGround' &&
      nextExtra &&
      typeof nextExtra === 'object' &&
      !Array.isArray(nextExtra)
    ) {
      const prevEx = advancedFieldsData as Record<string, unknown>;
      const prevFp = groundAdvancedUValueFingerprint(prevEx.u_value);
      const nextFp = groundAdvancedUValueFingerprint((nextExtra as Record<string, unknown>).u_value);
      if (prevFp !== nextFp) {
        const ex = { ...(nextExtra as Record<string, unknown>) };
        const computed = computeGroundUValueFromElementModel(
          currentData as Record<string, unknown>,
          ex,
          subtype,
        );
        const nextNum =
          typeof ex.u_value === 'number' && Number.isFinite(ex.u_value)
            ? ex.u_value
            : typeof ex.u_value === 'string'
              ? Number(String(ex.u_value).trim())
              : NaN;
        const nextRounded = Number.isFinite(nextNum) ? Number(nextNum.toFixed(4)) : null;
        const compRounded =
          computed != null && Number.isFinite(computed) && computed > 0 ? Number(computed.toFixed(4)) : null;
        if (compRounded != null && nextRounded != null && Math.abs(compRounded - nextRounded) <= 1e-5) {
          delete ex[GROUND_U_VALUE_MANUAL_KEY];
        } else if (nextRounded != null) {
          ex[GROUND_U_VALUE_MANUAL_KEY] = true;
        } else {
          delete ex[GROUND_U_VALUE_MANUAL_KEY];
        }
        nextExtra = ex;
      }
    }
    // Update the parent data with new extra_json
    if (jsonFormsDataEqual(nextExtra, advancedFieldsData)) {
      return;
    }
    onChange({
      ...currentData,
      extra_json: nextExtra,
    });
  };

  const setMechanicalVentilationFanInputMode = useCallback((mode: MechanicalVentilationFanInputMode) => {
    setMechanicalVentilationFanInputModeOverride(mode);
    const nextExtra = pruneMechanicalVentilationExtraJson(advancedFieldsRecord as Record<string, unknown>, {
      fanInputMode: mode,
      positionMode: shouldRenderMechanicalVentilationPositionMode ? mechanicalVentilationPositionMode : null,
    });
    if (jsonFormsDataEqual(nextExtra, advancedFieldsData)) return;
    onChange({
      ...currentData,
      extra_json: nextExtra,
    });
  }, [
    advancedFieldsData,
    advancedFieldsRecord,
    currentData,
    mechanicalVentilationPositionMode,
    onChange,
    setMechanicalVentilationFanInputModeOverride,
    shouldRenderMechanicalVentilationPositionMode,
  ]);

  const setRadiatorThermalMode = useCallback((mode: RadiatorThermalMode) => {
    setRadiatorThermalModeOverride(mode);
    const nextExtra = pruneRadiatorEmitterExtraJson(advancedFieldsRecord as Record<string, unknown>, mode);
    if (jsonFormsDataEqual(nextExtra, advancedFieldsData)) return;
    onChange({
      ...currentData,
      extra_json: nextExtra,
    });
  }, [
    advancedFieldsData,
    advancedFieldsRecord,
    currentData,
    onChange,
    setRadiatorThermalModeOverride,
  ]);

  const setMechanicalVentilationPositionMode = useCallback((mode: MechanicalVentilationPositionMode) => {
    let nextExtra = switchMechanicalVentilationPositionModeExtraJson(
      advancedFieldsRecord as Record<string, unknown>,
      mode,
    );
    nextExtra = pruneMechanicalVentilationExtraJson(nextExtra, {
      fanInputMode: shouldRenderMechanicalVentilationFanMode ? mechanicalVentilationFanInputMode : null,
      positionMode: mode,
    });
    if (jsonFormsDataEqual(nextExtra, advancedFieldsData)) return;
    onChange({
      ...currentData,
      extra_json: nextExtra,
    });
  }, [
    advancedFieldsData,
    advancedFieldsRecord,
    currentData,
    mechanicalVentilationFanInputMode,
    onChange,
    shouldRenderMechanicalVentilationFanMode,
  ]);

  if (!subschema) return null;

  // Check if there are any advanced fields to show
  // Include manually rendered fields (like junction_type for ThermalBridgeLinear)
  const propertyCount = subschema.properties ? Object.keys(subschema.properties).length : 0;
  const hasAdvancedFields =
    propertyCount > 0 ||
    shouldRenderMechanicalVentilationFixedEnergySupply ||
    shouldRenderJunctionTypeManually ||
    shouldRenderEdgeInsulationManually ||
    shouldRenderWindowTreatmentManually ||
    shouldRenderFancoilTestDataManually;

  if (!hasAdvancedFields) {
    return null;
  }

  const isPartyWallAdvancedFields = elementType === 'BuildingElementPartyWall';
  const isInternalHeatedAdjacentAdvancedFields = elementType === 'BuildingElementAdjacentConditionedSpace';
  const showHalfConstructionManualWarning =
    isPartyWallAdvancedFields || isInternalHeatedAdjacentAdvancedFields;

  // Removed required fields badge logic - validation is now purely schema-driven

  const content = (
    <div
      className="advanced-fields-content"
      style={{
        padding: flat ? 0 : 'var(--spacing-lg)',
        background: flat ? 'transparent' : 'var(--bg-secondary)',
        border: flat ? 'none' : 'var(--border-width-thin) solid var(--border-subtle)',
        borderTop: flat ? 'none' : collapsible ? 'none' : undefined,
        borderRadius: flat ? 0 : collapsible ? '0 0 var(--radius-md) var(--radius-md)' : 'var(--radius-md)',
        marginTop: flat ? 0 : collapsible ? '-1px' : 'var(--spacing-md)',
        width: '100%',
        boxSizing: 'border-box',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', minWidth: 0 }}>
        {showHalfConstructionManualWarning && (
          <div
            style={{
              marginBottom: 'var(--spacing-md)',
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--validation-warning-badge-border)',
              background: 'var(--validation-warning-badge-bg)',
              color: 'var(--validation-warning-text)',
              fontSize: 12,
              lineHeight: 1.4,
            }}
          >
            {isPartyWallAdvancedFields
              ? PARTY_WALL_HALF_CONSTRUCTION_NOTE
              : INTERNAL_HALF_CONSTRUCTION_NOTE}
          </div>
        )}
      {shouldRenderMechanicalVentilationFanMode && (
        <MechanicalVentilationModeSegment
          label="Fan input"
          value={mechanicalVentilationFanInputMode}
          options={[
            { value: 'measured', label: 'Measured fan' },
            { value: 'sfp', label: 'SFP' },
          ]}
          onChange={(value) => setMechanicalVentilationFanInputMode(value as MechanicalVentilationFanInputMode)}
        />
      )}

      {shouldRenderRadiatorThermalMode && (
        <MechanicalVentilationModeSegment
          label="Sizing input"
          value={radiatorThermalMode}
          options={[
            { value: 'per_metre', label: 'Per metre' },
            { value: 'lumped', label: 'Lumped' },
          ]}
          onChange={(value) => setRadiatorThermalMode(value as RadiatorThermalMode)}
        />
      )}

      {shouldRenderMechanicalVentilationPositionMode && (
        <MechanicalVentilationModeSegment
          label="Exhaust position"
          value={mechanicalVentilationPositionMode}
          options={[
            { value: 'flat', label: 'Flat fields' },
            { value: 'position_exhaust', label: 'Position object' },
          ]}
          onChange={(value) => setMechanicalVentilationPositionMode(value as MechanicalVentilationPositionMode)}
        />
      )}
      {shouldRenderMechanicalVentilationFixedEnergySupply && (
        <div style={{ marginBottom: flat ? '10px' : 'var(--spacing-md)' }}>
          <div style={{ marginBottom: '4px' }}>
            {renderFieldLabelWithTooltip('Energy Supply', elementType, useFHSSchema)}
          </div>
          <div
            aria-readonly="true"
            style={{
              minHeight: '34px',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              padding: '0 10px',
              fontSize: '14px',
            }}
          >
            {MVHR_FIXED_ENERGY_SUPPLY}
          </div>
        </div>
      )}
      {/* Manually render junction_type for ThermalBridgeLinear with descriptions */}
      {shouldRenderEdgeInsulationManually && (
        <EdgeInsulationFields
          value={advancedFieldsData.edge_insulation}
          onChange={(next) => {
            handleAdvancedFieldsChange({
              data: { ...advancedFieldsData, edge_insulation: next },
              errors: [],
            });
          }}
          elementType={elementType}
          flat={flat}
        />
      )}

      {shouldRenderWindowTreatmentManually && (
        <WindowTreatmentFields
          treatment={advancedFieldsData.treatment}
          treatmentUi={advancedFieldsData[TREATMENT_UI_KEY]}
          onPatch={(patch) => {
            handleAdvancedFieldsChange({
              data: { ...advancedFieldsData, ...patch },
              errors: [],
            });
          }}
          elementType={elementType}
          flat={flat}
        />
      )}

      {elementType === 'BuildingElementTransparent' &&
        currentElementData?.type === 'BuildingElementTransparent' && (
          <AttachedWindowShadingStrip
            windowElement={currentElementData as BuildingElementTransparent}
            elementsById={elementsById}
            elementIds={elementIds}
            addElement={addElement}
            setSelection={setSelection}
            setSelectedElementIds={setSelectedElementIds}
            useFHSSchema={useFHSSchema}
          />
        )}

      {shouldRenderFancoilTestDataManually && (
        <FancoilTestDataFields
          value={(advancedFieldsData as Record<string, unknown>).fancoil_test_data}
          onChange={(next) => {
            handleAdvancedFieldsChange({
              data: { ...advancedFieldsData, fancoil_test_data: next },
              errors: [],
            });
          }}
          elementType={elementType}
          flat={flat}
        />
      )}

      {shouldRenderJunctionTypeManually && (
        <div style={{ marginBottom: flat ? '10px' : 'var(--spacing-md)' }}>
          <div style={{ marginBottom: '4px' }}>
            {renderFieldLabelWithTooltip('Junction Type', elementType, useFHSSchema)}
          </div>
          <StandardDropdown
            value={typeof advancedFieldsData.junction_type === 'string' ? advancedFieldsData.junction_type : ''}
            onChange={(value) => {
              const junctionType = value || undefined;
              const updatedExtraJson = {
                ...advancedFieldsData,
                junction_type: junctionType,
              };

              if (junctionType) {
                const externalCandidates =
                  externalDetailProfilesEnabled && elementType === 'ThermalBridgeLinear'
                    ? constructionDetails?.listCandidates(
                        detailedBridgePsiProfile,
                        junctionType,
                      ) ?? []
                    : [];
                if (externalCandidates.length === 1) {
                  const selected = externalCandidates[0]!;
                  onChange({
                    ...currentData,
                    linear_thermal_transmittance: selected.psiWPerMK,
                    extra_json: constructionDetails?.mergeCandidate(
                      updatedExtraJson,
                      selected,
                    ) ?? updatedExtraJson,
                  });
                  return;
                }
                // While a workspace CSV is reloading, avoid applying a stale map — use built-in Table 3.7.
                const defaultPsi =
                  (junctionPsiDefaultsPath || '').trim() && junctionPsiDefaultsLoading
                    ? getPsiForJunctionType(junctionType)
                    : getEffectiveLinearPsiFromWorkspaceSparseMap(junctionType, junctionPsiDefaultsMap);
                if (defaultPsi !== undefined) {
                  onChange({
                    ...currentData,
                    linear_thermal_transmittance: defaultPsi,
                    extra_json: constructionDetails?.mergeCandidate(
                      updatedExtraJson,
                      undefined,
                    ) ?? updatedExtraJson,
                  });
                  return;
                }
              }

              handleAdvancedFieldsChange({
                data: constructionDetails?.mergeCandidate(
                  updatedExtraJson,
                  undefined,
                ) ?? updatedExtraJson,
                errors: [],
              });
            }}
            options={JUNCTION_TYPE_ENUM.map(code => ({
              value: code,
              label: JUNCTION_TYPE_DESCRIPTIONS[code]
                ? `${code}: ${JUNCTION_TYPE_DESCRIPTIONS[code]}`
                : code,
            }))}
            placeholder="Select junction type..."
            size="md"
            variant="ghost"
          />
          {externalDetailCandidates.length > 1 && (
            <div style={{ marginTop: 8 }}>
              <StandardDropdown
                value={selectedExternalDetailKey}
                onChange={(value) => {
                  const selected = externalDetailCandidates.find(
                    (candidate) => candidate.key === value,
                  );
                  const nextBase = {
                    ...advancedFieldsData,
                    junction_type: currentJunctionType || undefined,
                  };
                  const nextExtra = constructionDetails?.mergeCandidate(
                    nextBase,
                    selected,
                  ) ?? nextBase;
                  const fallbackPsi = currentJunctionType
                    ? ((junctionPsiDefaultsPath || '').trim() && junctionPsiDefaultsLoading
                      ? getPsiForJunctionType(currentJunctionType)
                      : getEffectiveLinearPsiFromWorkspaceSparseMap(currentJunctionType, junctionPsiDefaultsMap))
                    : undefined;
                  onChange({
                    ...currentData,
                    ...(selected
                      ? { linear_thermal_transmittance: selected.psiWPerMK }
                      : fallbackPsi !== undefined
                        ? { linear_thermal_transmittance: fallbackPsi }
                        : {}),
                    extra_json: nextExtra,
                  });
                }}
                options={[
                  { value: '', label: 'Project CSV / Table 3.7' },
                  ...externalDetailCandidates.map((candidate) => ({
                    value: candidate.key,
                    label: candidate.label,
                  })),
                ]}
                placeholder="Select detail..."
                size="md"
                variant="ghost"
              />
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                Multiple source details match this junction. Pick one to use its ψ and provenance.
              </div>
            </div>
          )}
        </div>
      )}

      {elementType === 'System' && systemPlantTypes.length > 0 && (
        <div style={{ marginBottom: flat ? '10px' : 'var(--spacing-md)' }}>
          {systemPlantTypes.map(({ plantKey, typeLabel }) => (
            <div key={plantKey} style={{ marginBottom: '8px' }}>
              <div style={{ marginBottom: '4px' }}>
                {renderFieldLabelWithTooltip(
                  systemPlantTypes.length > 1 ? `${plantKey} · Type` : 'Type',
                  elementType,
                  useFHSSchema,
                )}
              </div>
              <div
                style={{
                  minHeight: '34px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 10px',
                  fontSize: '14px',
                }}
              >
                {typeLabel}
              </div>
            </div>
          ))}
        </div>
      )}

      {elementType === 'System' &&
        subtype === 'HotWaterSource' &&
        !isSystemPcdbMode &&
        currentElementData?.type === 'System' && (
          <>
            <DhwStorageHeatSourcePicker
              elementsById={elementsById}
              systemElement={currentElementData as System}
              flat={flat}
              onPatchExtraJson={(fn) => {
                const base = readExtraJsonRecord(currentData.extra_json);
                onChange({ ...currentData, extra_json: fn(base) });
              }}
            />
            {inspectorContributions.productCatalogue?.renderAdvancedHotWaterAction({
              elementsById,
              element: currentElementData,
              flat,
              onPatchExtraJson: (fn) => {
                const base = readExtraJsonRecord(currentData.extra_json);
                onChange({ ...currentData, extra_json: fn(base) });
              },
            })}
          </>
        )}

      {/* R4.3/R4.4: direct-render off the resolved subschema (or, for System, the layout
          spec from systemAdvancedUischema.ts), no <JsonForms> dispatch. R4.4 retired the
          legacy JsonForms mount and its fallback kill-switch; this is now the only path.
          R4.5 finished the retirement community-wide: the `standardRenderers` registry
          those two slices left behind for web's SnippetEditor/SimplifiedFabricEditor is
          deleted from jsonformsRenderers.tsx, and this package carries no `@jsonforms/*`
          dependency at all any more. */}
      <DirectAdvancedFields
        schema={subschema as Record<string, unknown>}
        data={advancedFieldsData as Record<string, unknown>}
        config={advancedFieldsConfig}
        layout={systemAdvancedUischema}
        onDataChange={(data) => handleAdvancedFieldsChange({ data, errors: [] })}
      />
      {elementType === 'BuildingElementAdjacentUnconditionedSpace_Simple' && (
        <UnheatedSpaceRuCalculatorModal
          workspaceResourcePort={workspaceResourcePort}
          isOpen={ruCalculatorOpen}
          onClose={() => setRuCalculatorOpen(false)}
          calculatorMountKey={ruCalcMountKey}
          initialCalculatorState={ruCalculatorInitialState}
          currentRu={
            typeof advancedFieldsData.thermal_resistance_unconditioned_space === 'number'
              ? advancedFieldsData.thermal_resistance_unconditioned_space
              : undefined
          }
          onApply={(ru, patch) => {
            const data: Record<string, unknown> = {
              ...advancedFieldsData,
              thermal_resistance_unconditioned_space: ru,
            };
            for (const [k, v] of Object.entries(patch)) {
              if (v === undefined) delete data[k];
              else data[k] = v;
            }
            handleAdvancedFieldsChange({
              data,
              errors: [],
            });
          }}
        />
      )}
      {elementType === 'BuildingElementGround' && (
        <GroundUValueCalculatorModal
          isOpen={groundUCalculatorOpen}
          onClose={() => setGroundUCalculatorOpen(false)}
          currentData={currentData}
          advancedFieldsData={advancedFieldsData}
          subtype={subtype}
          onApply={(patch) => {
            const next: Record<string, unknown> = { ...advancedFieldsData, u_value: patch.u_value };
            if (patch.wind_speed_mps !== undefined) next.wind_speed_mps = patch.wind_speed_mps;
            if (patch.thermal_resist_insul !== undefined) next.thermal_resist_insul = patch.thermal_resist_insul;
            handleAdvancedFieldsChange({
              data: next,
              errors: [],
            });
          }}
        />
      )}
      </div>
    </div>
  );

  return (
    <div className={`advanced-fields-editor ${className}`} style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {collapsible && (
        <div
          className="advanced-fields-header"
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--spacing-md)',
            background: flat ? 'transparent' : 'var(--bg-secondary)',
            border: flat ? 'none' : 'var(--border-width-thin) solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            marginTop: 'var(--spacing-md)',
            transition: 'var(--transition-colors)',
            width: '100%',
            boxSizing: 'border-box',
            minWidth: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', flex: 1 }}>
            <span style={{ fontWeight: 'var(--font-weight-semibold)', fontSize: 'var(--font-size-lg)' }}>Advanced Fields</span>
            <span className="badge" style={{ marginLeft: '8px', fontSize: '10px', padding: '2px 6px' }}>{customCount}</span>
          </div>

          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            style={{
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform var(--transition-normal) ease'
            }}
          >
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )}

      {(!collapsible || isExpanded) && content}
    </div>
  );
};

export const AdvancedFieldsEditor = memo(AdvancedFieldsEditorComponent);
