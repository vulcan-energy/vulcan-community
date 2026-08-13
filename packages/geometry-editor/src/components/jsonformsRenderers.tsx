// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useState } from 'react';
import { StandardInput } from './StandardInput';
import { ResetFieldButton } from './ResetFieldButton';
import { numericInputAttributesFromSchema, useNumericDraftInput } from './numericDraftInput';
import { StandardDropdown } from './StandardDropdown';
import { StandardControlShell } from './StandardControlShell';
import { StatusPill } from './StatusPill';
import type { StatusPillType } from './StatusPill';
import { Tooltip } from './Tooltip';
import { ValidationIndicator } from './ValidationIndicator';
import { generateRobustPlaceholder } from '../lib/schemaPlaceholders';
import { getSchemaParamIdForField } from '../lib/fieldTooltipMap';
import {
  fieldUnitForAdornment,
  resolveFieldPresentation,
  type ResolvedFieldPresentation,
} from '../lib/fieldPresentation';
import { formatSchemaInfoForTooltip } from '../utils/schemaTooltipHelpers';
import { JUNCTION_TYPE_DESCRIPTIONS } from '../lib/simplifiedFabricMap';
import { WINDOW_SECURITY_RISK_HELPER } from '../lib/schemaDescriptionOverrides';
import { SUSPENDED_GROUND_DEFAULT_HEIGHT_UPPER_SURFACE_M } from '../geometry/constants';
import { useGeometryStore, useGeometryStoreApi } from '../stores/geometryStore';
import { parseWindShieldLocation } from '../lib/groundUValueCalculator';
import type { DefaultsLookup, OpaqueFabricVariant } from '../lib/defaultsCache';
import { classifyOpaqueFabricVariant } from '../lib/opaqueFabricVariant';
import { windowSecurityRiskDefaultForElement } from '../lib/windowSecurityRisk';
import { usesGroundThermalTransmWallsAutofill } from '../lib/groundFloorSubtype';
import { errorMessageFromUnknown, isRecord, readRecord, type JsonRecord } from '../lib/jsonTypes';
import type { Element, Floor } from '../geometry/types';
import type { SchemaNode } from '../lib/schemaTypes';
import { useGeometrySchemaPort } from '../../../geometry-editor-host/src/editorServicePorts';
import {
  unavailableGeometrySchemaPort,
  type GeometrySchemaPort,
} from '../../../geometry-editor-host/src/schemaPort';
import {
  WindowDetailChip,
  WindowDetailCollectionShell,
  WindowDetailMiniButton,
} from './WindowDetailControls';
import { ResolvedFieldLabel } from './ResolvedFieldLabel';

type SuspendedThermalTransmWallSource = {
  elementId: string;
  label: string;
  areaM2: number;
  uValue_W_m2K: number;
  basisLabel: string;
};

type RendererConfig = {
  $defs?: unknown;
  advancedEditor?: boolean;
  assemblySourceValues?: Record<string, unknown>;
  compact?: boolean;
  currentElementData?: unknown;
  elementType?: string;
  evidenceFieldKeys?: Set<string>;
  fieldIndicators?: Readonly<Record<string, readonly string[]>>;
  floors?: unknown;
  focusSourceElement?: (elementId: string) => void;
  groundUComputedWPerM2K?: number | null;
  opaqueFabricVariant?: OpaqueFabricVariant;
  openGroundUCalculator?: () => void;
  openRuCalculator?: () => void;
  resyncSuspendedThermalTransmWalls?: () => void;
  schemaPort?: GeometrySchemaPort;
  subtype?: string;
  suspendedThermalTransmWallsAutoValue?: number | null;
  suspendedThermalTransmWallsAutofillHasSources?: boolean;
  suspendedThermalTransmWallsAutofillSources?: SuspendedThermalTransmWallSource[];
  systemSampleBaselineExtraJson?: unknown;
  systemSampleMode?: boolean;
  useFHSSchemaForValidation?: boolean;
};

/**
 * R4.5: replaces `ControlProps & { config?: RendererConfig }` (`ControlProps` was
 * `@jsonforms/core`'s own control-prop type). This module no longer imports anything
 * from `@jsonforms/*` — the registry that used to feed these five controls props via
 * `withJsonFormsControlProps`/JsonForms' own reducer is gone (see the R4.5 deletion
 * note above `schemaHasIntegerType`), and `DirectAdvancedFields.tsx` /
 * `DirectSpecFields` have supplied every one of these fields by hand since R4.3.
 * A LOCAL structural type covering exactly what the five kept controls destructure
 * (checked against each control body below) — not a guess at `ControlProps`' full
 * shape. `visible`, `required`, `id`, and `rootSchema` are still populated by
 * `renderControlForProperty`'s `baseProps` in `DirectAdvancedFields.tsx` (kept there
 * for parity with the original JsonForms `ControlProps` shape / possible future use)
 * but are read by none of these five controls — deliberately omitted here rather than
 * carried forward as unused surface.
 */
type AdvancedControlProps = {
  data: unknown;
  handleChange: (path: string, value: unknown) => void;
  path: string;
  label: string;
  errors?: string;
  schema?: unknown;
  uischema?: unknown;
  config?: RendererConfig;
  enabled?: boolean;
};

function rendererConfig(config: unknown): RendererConfig {
  return isRecord(config) ? config as RendererConfig : {};
}

function uiOptions(uischema: unknown): JsonRecord {
  return readRecord(readRecord(uischema).options);
}

function schemaWithOverride(uischema: unknown, schema: unknown): JsonRecord {
  return readRecord(uiOptions(uischema).schemaOverride ?? schema);
}

function schemaAlternatives(schema: JsonRecord, key: 'oneOf' | 'anyOf'): JsonRecord[] | null {
  const value = schema[key];
  return Array.isArray(value) ? value.filter(isRecord) : null;
}

// eslint-disable-next-line react-refresh/only-export-components -- schema predicate shared with DirectAdvancedFields' control picker.
export function schemaTypeList(schema: JsonRecord): string[] {
  const typeValue = schema.type;
  if (Array.isArray(typeValue)) return typeValue.filter((type): type is string => typeof type === 'string');
  return typeof typeValue === 'string' ? [typeValue] : [];
}

function schemaDefs(value: unknown): Record<string, SchemaNode> | undefined {
  return isRecord(value) ? (value as Record<string, SchemaNode>) : undefined;
}

function elementStoreyInput(value: unknown): Pick<Element, 'coordinates' | 'floorId'> | undefined {
  const record = readRecord(value);
  return Array.isArray(record.coordinates)
    ? {
        coordinates: record.coordinates as Element['coordinates'],
        floorId: typeof record.floorId === 'string' ? record.floorId : undefined,
      }
    : undefined;
}

function floorStoreyInputs(value: unknown): Pick<Floor, 'id' | 'zIndex'>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((floor): floor is Pick<Floor, 'id' | 'zIndex'> => {
    const record = readRecord(floor);
    return typeof record.id === 'string' && typeof record.zIndex === 'number';
  });
}

function fieldIndicatorsFor(
  config: RendererConfig,
  propKey: string | undefined,
): readonly string[] | undefined {
  return propKey ? config.fieldIndicators?.[propKey] : undefined;
}

function hasEvidenceFor(config: RendererConfig, propKey: string | undefined): boolean {
  return !!(propKey && config.evidenceFieldKeys?.has(propKey));
}

function coerceDropdownValue(
  raw: string,
  coerceType: 'string' | 'number' | 'boolean' | undefined,
): unknown {
  if (coerceType === 'number') return raw === '' ? undefined : Number(raw);
  if (coerceType === 'boolean') return raw === '' ? undefined : raw === 'true';
  return raw;
}

/** Per-field validation aligned with the schema mode used by this JsonForms instance (FHS vs Core). */
// eslint-disable-next-line react-refresh/only-export-components -- data-layer validation helper shared with DirectAdvancedFields.
export function validateAdvancedFieldPrimitive(
  config: RendererConfig | undefined,
  elementType: string | undefined,
  propKey: string | undefined,
  value: unknown,
): { valid: boolean; errors?: readonly string[] } {
  if (!elementType || !propKey) return { valid: true };
  const schemaPort = config?.schemaPort;
  if (!schemaPort || schemaPort.availability !== 'available') return { valid: true };
  const useFhs = config?.useFHSSchemaForValidation === true;
  const subtype = config?.subtype;
  return schemaPort.validateProperty(
    useFhs ? 'fhs' : 'core',
    elementType,
    subtype,
    propKey,
    value,
  );
}

// Hook to get default values from the user's configured defaults file (via store)
function useDefaultValues() {
  return useGeometryStore((state) => state.defaultsJson);
}

function useDefaultsLookup() {
  return useGeometryStore((state) => state.getDefaultsLookup());
}

function renderFieldLabelWithTooltipForMode(
  label: string,
  elementType: string | undefined,
  useFHSSchema: boolean,
  schemaPort: GeometrySchemaPort,
): React.ReactNode {
  const propertyKey = getSchemaParamIdForField(label, elementType) ?? label;
  const presentation = resolveFieldPresentation({
    mode: useFHSSchema ? 'fhs' : 'core',
    propertyKey,
    elementType,
    label,
  }, schemaPort);

  const labelSpan = (
    <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)' }}>{presentation.label}</span>
  );

  if (presentation.tooltipInfo) {
    return (
      <Tooltip
        content={formatSchemaInfoForTooltip(presentation.tooltipInfo)}
        useFHSSchema={useFHSSchema}
        position="right"
        maxWidth={350}
      >
        {labelSpan}
      </Tooltip>
    );
  }
  return labelSpan;
}

function resolveAdvancedControlFieldPresentation(
  label: string,
  propertyKey: string | undefined,
  schema: JsonRecord,
  config: RendererConfig,
): ResolvedFieldPresentation {
  return resolveFieldPresentation({
    mode: config.useFHSSchemaForValidation ? 'fhs' : 'core',
    propertyKey: propertyKey ?? label,
    elementType: config.elementType,
    subtype: config.subtype,
    opaqueFabricVariant: config.opaqueFabricVariant,
    label,
    schemaNode: schema,
  }, config.schemaPort ?? unavailableGeometrySchemaPort);
}

const ProviderFieldLabelWithTooltip: React.FC<{
  label: string;
  elementType?: string;
  useFHSSchema?: boolean;
}> = ({ label, elementType, useFHSSchema }) => {
  const geometryStore = useGeometryStoreApi();
  const schemaPort = useGeometrySchemaPort();
  return renderFieldLabelWithTooltipForMode(
    label,
    elementType,
    useFHSSchema ?? !!geometryStore.getState().complianceSettings.complianceValidationEnabled,
    schemaPort,
  );
};

// Helper to render a field label with tooltip for JsonForms controls. JsonForms
// callers pass their schema mode explicitly; other field groups resolve it from
// the nearest provider-backed store through the component above.
// eslint-disable-next-line react-refresh/only-export-components -- renderer helper reused by field groups.
export function renderFieldLabelWithTooltip(
  label: string,
  elementType?: string,
  useFHSSchema?: boolean,
): React.ReactNode {
  return (
    <ProviderFieldLabelWithTooltip
      label={label}
      elementType={elementType}
      useFHSSchema={useFHSSchema}
    />
  );
}

function renderFieldLabelWithIndicator(
  label: string,
  elementType: string | undefined,
  indicatorMessages?: readonly string[],
  hasEvidence?: boolean,
  useFHSSchema?: boolean,
  presentation?: ResolvedFieldPresentation,
): React.ReactNode {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexWrap: 'wrap',
        minWidth: 0,
        overflowWrap: 'anywhere',
      }}
    >
      {presentation
        ? <ResolvedFieldLabel presentation={presentation} useFHSSchema={useFHSSchema ?? false} />
        : renderFieldLabelWithTooltip(label, elementType, useFHSSchema)}
      {hasEvidence && (
        <span
          style={{
            fontSize: 9,
            padding: '0px 5px',
            borderRadius: 9999,
            background: 'var(--color-success-bg)',
            border: '1px solid var(--color-success-border)',
            color: 'var(--color-success-fg)',
            lineHeight: '16px',
            whiteSpace: 'nowrap',
          }}
          title="Evidence linked to this field"
        >
          Ev
        </span>
      )}
      {indicatorMessages && indicatorMessages.length > 0 && (
        <ValidationIndicator
          hasIssues
          issues={indicatorMessages}
          size="small"
          variant="info"
        />
      )}
    </div>
  );
}

// Helper to get default value for a specific path, preferring the current elementType subtree
function getDefaultValue(
  defaults: unknown,
  defaultsLookup: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
  path: string,
  elementType?: string,
  subtype?: string,
  opaqueFabricVariant?: OpaqueFabricVariant,
): unknown {
  if (!defaults || !path) {
    return undefined;
  }
  const defaultsRecord = readRecord(defaults);

  const maybePropertyName = path.split('.').pop();
  if (!maybePropertyName) {
    return undefined;
  }
  const propertyName: string = maybePropertyName;

  // Special handling for MechanicalVentilation: filter by vent_type (subtype)
  if (elementType === 'MechanicalVentilation' && subtype) {
    try {
      const mvMap = readRecord(readRecord(defaultsRecord.InfiltrationVentilation).MechanicalVentilation);
      if (Object.keys(mvMap).length > 0) {
        // Only check defaults from entries matching the vent_type
        for (const entry of Object.values(mvMap)) {
          const entryRecord = readRecord(entry);
          if (entryRecord.vent_type === subtype) {
            if (Object.prototype.hasOwnProperty.call(entry, propertyName)) {
              return entryRecord[propertyName];
            }
          }
        }
      }
      // No default found for this vent_type
      return undefined;
    } catch {
      // Fall through to generic search on error
    }
  }

  // FHS MVHR ductwork defaults are nested under:
  // InfiltrationVentilation.MechanicalVentilation.*.ductwork[]
  // (not a standalone MechanicalVentilationDuctwork object tree).
  if (elementType === 'MechanicalVentilationDuctwork') {
    try {
      const mvMap = readRecord(readRecord(defaultsRecord.InfiltrationVentilation).MechanicalVentilation);
      if (Object.keys(mvMap).length > 0) {
        for (const entry of Object.values(mvMap)) {
          const entryRecord = readRecord(entry);
          if (entryRecord.vent_type !== 'MVHR') continue;
          const ducts = entryRecord.ductwork;
          if (!Array.isArray(ducts)) continue;
          // If caller provides a duct subtype, prefer that duct; otherwise use first matching key.
          const ductsByType = new Map<unknown, unknown>();
          let byKey: unknown;
          let hasByKey = false;
          for (const duct of ducts) {
            const ductRecord = readRecord(duct);
            if (!ductsByType.has(ductRecord.duct_type)) {
              ductsByType.set(ductRecord.duct_type, duct);
            }
            if (!hasByKey && Object.prototype.hasOwnProperty.call(ductRecord, propertyName)) {
              byKey = duct;
              hasByKey = true;
            }
          }
          const preferred = typeof subtype === 'string' ? ductsByType.get(subtype) : undefined;
          const selected = readRecord(preferred ?? byKey);
          if (Object.prototype.hasOwnProperty.call(selected, propertyName)) {
            return selected[propertyName];
          }
        }
      }

      // Backward compatibility for older defaults layouts.
      const legacyMap = readRecord(defaultsRecord.MechanicalVentilationDuctwork);
      if (Object.keys(legacyMap).length > 0) {
        for (const entry of Object.values(legacyMap)) {
          const entryRecord = readRecord(entry);
          if (Object.prototype.hasOwnProperty.call(entryRecord, propertyName)) {
            return entryRecord[propertyName];
          }
        }
      }
    } catch {
      // Fall through to generic search on error
    }
  }

  // FHS primary pipework defaults live under:
  // HotWaterSource.<source>.primary_pipework[]
  // (not under a standalone WaterPipework node).
  if (elementType === 'WaterPipework') {
    try {
      const hotWaterSources = readRecord(defaultsRecord.HotWaterSource);
      if (Object.keys(hotWaterSources).length > 0) {
        for (const source of Object.values(hotWaterSources)) {
          const primaryPipework = readRecord(source).primary_pipework;
          if (!Array.isArray(primaryPipework)) continue;
          const byKey = primaryPipework.find(
            (pipe) => Object.prototype.hasOwnProperty.call(readRecord(pipe), propertyName),
          );
          const byKeyRecord = readRecord(byKey);
          if (Object.prototype.hasOwnProperty.call(byKeyRecord, propertyName)) {
            return byKeyRecord[propertyName];
          }
        }
      }

      // Backward compatibility for older defaults layouts.
      const legacyMap = readRecord(defaultsRecord.WaterPipework);
      if (Object.keys(legacyMap).length > 0) {
        for (const entry of Object.values(legacyMap)) {
          const entryRecord = readRecord(entry);
          if (Object.prototype.hasOwnProperty.call(entryRecord, propertyName)) {
            return entryRecord[propertyName];
          }
        }
      }
    } catch {
      // Fall through to generic search on error
    }
  }

  // Fast-path for OnSiteGeneration: defaults live under OnSiteGeneration["Default PV"]
  // in defaults_template.json. Use this as the source of PV defaults so that
  // inverter fields (DC/AC, is_inside, type, ventilation_strategy, EnergySupply)
  // surface as placeholders in Advanced Fields.
  if (elementType === 'OnSiteGeneration') {
    try {
      const pvDefaults = readRecord(readRecord(defaultsRecord.OnSiteGeneration)['Default PV']);
      if (Object.prototype.hasOwnProperty.call(pvDefaults, propertyName)) {
        return pvDefaults[propertyName];
      }
    } catch {
      // Fall through to generic search on error
    }
  }

  // Fast-path for ElectricBattery: defaults are stored under
  // EnergySupply.<supply>.ElectricBattery (without a typed `type` node),
  // so the typed DFS below will not find them.
  if (elementType === 'ElectricBattery') {
    try {
      const energySupplyMap = readRecord(defaultsRecord.EnergySupply);
      if (Object.keys(energySupplyMap).length > 0) {
        const mainsElecBattery = readRecord(readRecord(energySupplyMap['mains elec']).ElectricBattery);
        if (Object.prototype.hasOwnProperty.call(mainsElecBattery, propertyName)) {
          return mainsElecBattery[propertyName];
        }
        for (const supply of Object.values(energySupplyMap)) {
          const batteryDefaults = readRecord(readRecord(supply).ElectricBattery);
          if (Object.prototype.hasOwnProperty.call(batteryDefaults, propertyName)) {
            return batteryDefaults[propertyName];
          }
        }
      }
    } catch {
      // Fall through to generic search on error
    }
  }

  // FHS WetEmitter defaults live under:
  // SpaceHeatSystem.<system>.emitters[] (with wet_emitter_type discriminator),
  // not under a standalone WetEmitter node.
  if (elementType === 'WetEmitter') {
    try {
      const systems = readRecord(defaultsRecord.SpaceHeatSystem);
      if (Object.keys(systems).length > 0) {
        const subtypeKey = typeof subtype === 'string' ? subtype : undefined;
        for (const sys of Object.values(systems)) {
          const systemRecord = readRecord(sys);
          if (systemRecord.type !== 'WetDistribution') continue;
          const emitters = systemRecord.emitters;
          if (!Array.isArray(emitters)) continue;

          // Prefer defaults from the matching emitter subtype.
          if (subtypeKey) {
            const typed = emitters.find(
              (em) => readRecord(em).wet_emitter_type === subtypeKey,
            );
            const typedRecord = readRecord(typed);
            if (Object.prototype.hasOwnProperty.call(typedRecord, propertyName)) {
              return typedRecord[propertyName];
            }
          }

          // Fallback to first emitter that defines this property.
          const byProp = emitters.find(
            (em) => Object.prototype.hasOwnProperty.call(readRecord(em), propertyName),
          );
          const byPropRecord = readRecord(byProp);
          if (Object.prototype.hasOwnProperty.call(byPropRecord, propertyName)) {
            return byPropRecord[propertyName];
          }
        }
      }
    } catch {
      // Fall through to generic search on error
    }
  }

  // BuildingElementOpaque: prefer variant-specific defaults (wall / roof / external door)
  // aligned with CSV merge and {@link defaultsCache} indexing.
  if (elementType === 'BuildingElementOpaque' && opaqueFabricVariant) {
    const fromCache = defaultsLookup.getDefaultValueForElementField(
      propertyName,
      elementType,
      opaqueFabricVariant,
    );
    if (fromCache !== undefined) return fromCache;
  }

  // Depth-first search: only return defaults from nodes whose `type` exactly
  // matches the current elementType (with a special-case for OnSiteGeneration →
  // PhotovoltaicSystem).  No cross-type fallback – e.g. a ground floor's
  // u_value must never be shown as the default for a wall.
  const visited = new WeakSet<object>();

  function isRelevantNode(node: unknown): boolean {
    const nodeRecord = readRecord(node);
    const t = nodeRecord.type;
    // For BuildingElement types, look for BuildingElement* nodes (for ordering priority)
    if (elementType && elementType.startsWith('BuildingElement')) {
      return typeof t === 'string' && t.startsWith('BuildingElement');
    }
    // Special-case for OnSiteGeneration: defaults live under PhotovoltaicSystem
    if (elementType === 'OnSiteGeneration') {
      return typeof t === 'string' && t === 'PhotovoltaicSystem';
    }
    // For other types (Appliance, etc.), look for exact type match
    return typeof t === 'string' && t === elementType;
  }

  function dfs(node: unknown): unknown {
    if (!node || typeof node !== 'object') return undefined;
    if (visited.has(node)) return undefined;
    visited.add(node);
    const nodeRecord = readRecord(node);

    // Only return a value from nodes whose type exactly matches elementType
    const t = nodeRecord.type;
    const matchesElementType =
      (elementType && t === elementType) ||
      // Special-case: OnSiteGeneration defaults live under PhotovoltaicSystem
      (elementType === 'OnSiteGeneration' && t === 'PhotovoltaicSystem');
    const matchesOpaqueVariant =
      elementType !== 'BuildingElementOpaque' ||
      !opaqueFabricVariant ||
      classifyOpaqueFabricVariant(node) === opaqueFabricVariant;
    if (
      matchesElementType &&
      matchesOpaqueVariant &&
      Object.prototype.hasOwnProperty.call(node, propertyName)
    ) {
      return nodeRecord[propertyName];
    }
    // When no elementType is provided, accept any typed node that has the property
    if (!elementType && isRelevantNode(node) && Object.prototype.hasOwnProperty.call(node, propertyName)) {
      return nodeRecord[propertyName];
    }

    // Recurse into children, visiting relevant children first for speed
    const entries = Array.isArray(node) ? node : Object.values(node);
    const relevantFirst = entries.filter(isRelevantNode).concat(entries.filter((n) => !isRelevantNode(n)));
    for (const child of relevantFirst) {
      const found = dfs(child);
      if (found !== undefined) return found;
    }

    return undefined;
  }

  const fromDefaultsTree = dfs(defaults);
  if (fromDefaultsTree !== undefined) return fromDefaultsTree;
  if (
    elementType === 'BuildingElementGround' &&
    subtype === 'Suspended_floor' &&
    propertyName === 'height_upper_surface'
  ) {
    return SUSPENDED_GROUND_DEFAULT_HEIGHT_UPPER_SURFACE_M;
  }
  return undefined;
}

function getAdvancedDefaultValue(
  defaults: unknown,
  defaultsLookup: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
  path: string,
  elementType: string | undefined,
  subtype: string | undefined,
  opaqueFabricVariant: OpaqueFabricVariant | undefined,
  propKey: string | undefined,
  config: RendererConfig | undefined,
): unknown {
  if (propKey === 'security_risk' && elementType === 'BuildingElementTransparent') {
    return windowSecurityRiskDefaultForElement(
      elementStoreyInput(config?.currentElementData),
      floorStoreyInputs(config?.floors),
    );
  }
  return getDefaultValue(defaults, defaultsLookup, path, elementType, subtype, opaqueFabricVariant);
}

function readFiniteControlNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function groundAdvancedUValueMatchesComputed(
  data: unknown,
  groundUComputedWPerM2K: number | null | undefined,
): boolean {
  const u = groundUComputedWPerM2K;
  if (typeof u !== 'number' || !Number.isFinite(u) || u <= 0) return false;
  const cur = readFiniteControlNumber(data);
  const uRounded = Number(u.toFixed(4));
  const curRounded = cur != null ? Number(cur.toFixed(4)) : null;
  return curRounded != null && Math.abs(curRounded - uRounded) <= 1e-5;
}

// Helper function to determine status pill type
function getStatusPillType(
  data: unknown,
  sourceValue: unknown,
  sourceKind: 'assembly' | 'default',
  isJsonLike: boolean,
  groundPill?: { isGroundUField: boolean; groundUComputedWPerM2K?: number | null },
): StatusPillType {
  if (
    groundPill?.isGroundUField &&
    groundAdvancedUValueMatchesComputed(data, groundPill.groundUComputedWPerM2K)
  ) {
    return 'calculated';
  }

  if (isMeaningfulExplicitValue(data, isJsonLike) && !valuesEquivalent(data, sourceValue, isJsonLike)) {
    return 'custom';
  }

  if (sourceValue !== undefined && sourceValue !== null) {
    if (Array.isArray(sourceValue) && sourceValue.length === 0) {
      return 'no-default-schema';
    }
    if (typeof sourceValue === 'object' && Object.keys(sourceValue).length === 0) {
      return 'no-default-schema';
    }
    return sourceKind === 'assembly' ? 'calculated' : 'default-used';
  }

  return 'no-default-schema';
}

function isMeaningfulExplicitValue(data: unknown, isJsonLike: boolean): boolean {
  if (data === undefined || data === null || data === '' || data === '{}' || data === '[]') {
    return false;
  }
  if (
    isJsonLike &&
    ((Array.isArray(data) && data.length === 0) ||
      (typeof data === 'object' && data !== null && !Array.isArray(data) && Object.keys(data).length === 0))
  ) {
    return false;
  }
  return true;
}

function valuesEquivalent(a: unknown, b: unknown, isJsonLike: boolean): boolean {
  if (a === undefined || a === null || a === '') {
    return b === undefined || b === null || b === '';
  }
  if (b === undefined || b === null || b === '') return false;
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= 1e-6;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b;
  }
  if (isJsonLike || typeof a === 'object' || typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return String(a) === String(b);
}

function shouldShowResetToSource(data: unknown, sourceValue: unknown, isJsonLike: boolean): boolean {
  if (!isMeaningfulExplicitValue(data, isJsonLike)) return false;
  if (sourceValue === undefined || sourceValue === null || sourceValue === '') return true;
  return !valuesEquivalent(data, sourceValue, isJsonLike);
}

function resolveFieldSource(
  propKey: string | undefined,
  defaultValue: unknown,
  config: RendererConfig | undefined,
): {
  value: unknown;
  kind: 'assembly' | 'default';
  buttonLabel?: string;
  buttonTitle?: string;
  buttonAriaLabel?: string;
} {
  const assemblySourceValues = config?.assemblySourceValues ?? {};
  if (propKey && Object.prototype.hasOwnProperty.call(assemblySourceValues, propKey)) {
    return {
      value: assemblySourceValues[propKey],
      kind: 'assembly',
      buttonLabel: 'Reset to assembly',
      buttonTitle: 'Restore value from applied assembly',
      buttonAriaLabel: 'Reset field to assembly value',
    };
  }
  /** FHS suspended `shield_fact_location`: template often omits it; ISO 13370 path uses {@link parseWindShieldLocation}. */
  const templateDefault =
    propKey === 'shield_fact_location' ? parseWindShieldLocation(defaultValue) : defaultValue;
  return { value: templateDefault, kind: 'default' };
}

type FieldSourceInfo = {
  value: unknown;
  kind: 'assembly' | 'default';
  buttonLabel?: string;
  buttonTitle?: string;
  buttonAriaLabel?: string;
};

type FieldPresentationState = {
  fieldSource: FieldSourceInfo;
  statusPillType: StatusPillType;
  isCustom: boolean;
  showReset: boolean;
};

function readValueAtDataPath(
  root: unknown,
  path: string,
): { exists: boolean; value: unknown } {
  if (!root || typeof root !== 'object' || Array.isArray(root) || !path) {
    return { exists: false, value: undefined };
  }
  const segments = path
    .split('.')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  let cur: unknown = root;
  for (const segment of segments) {
    if (cur == null) return { exists: false, value: undefined };
    if (Array.isArray(cur)) {
      const idx = Number(segment);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
        return { exists: false, value: undefined };
      }
      cur = cur[idx];
      continue;
    }
    if (typeof cur !== 'object') return { exists: false, value: undefined };
    const rec = cur as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(rec, segment)) {
      return { exists: false, value: undefined };
    }
    cur = rec[segment];
  }
  return { exists: true, value: cur };
}

function computeFieldPresentationState(args: {
  data: unknown;
  isJsonLike: boolean;
  fieldSource: FieldSourceInfo;
  config: RendererConfig | undefined;
  path: string;
}): FieldPresentationState {
  const { data, isJsonLike, fieldSource, config, path } = args;

  if (config?.systemSampleMode) {
    const baseline = readValueAtDataPath(config.systemSampleBaselineExtraJson, path);
    if (baseline.exists) {
      const matchesBaseline = valuesEquivalent(data, baseline.value, isJsonLike);
      return {
        fieldSource: {
          value: baseline.value,
          kind: 'assembly',
          buttonLabel: 'Reset to default',
          buttonTitle: 'Restore value from selected sample preset',
          buttonAriaLabel: 'Reset field to sample preset value',
        },
        statusPillType: matchesBaseline ? 'default-used' : 'custom',
        isCustom: !matchesBaseline,
        showReset: !matchesBaseline,
      };
    }
    const hasExplicitValue = isMeaningfulExplicitValue(data, isJsonLike);
    // System Sample mode: if the preset file omits a key and the UI value is still blank/unset,
    // treat that state as Preset (the preset intentionally leaves it unset).
    if (!hasExplicitValue) {
      return {
        fieldSource,
        statusPillType: 'default-used',
        isCustom: false,
        showReset: false,
      };
    }
    // Preset omits this key; user set an explicit value => Custom, with reset back to omitted/blank.
    return {
      fieldSource: {
        value: undefined,
        kind: 'assembly',
        buttonLabel: 'Reset to default',
        buttonTitle: 'Restore field to omitted value in selected sample preset',
        buttonAriaLabel: 'Reset field to omitted sample preset value',
      },
      statusPillType: 'custom',
      isCustom: hasExplicitValue,
      showReset: true,
    };
  }

  const statusPillType = getStatusPillType(data, fieldSource.value, fieldSource.kind, isJsonLike);
  const isCustom = shouldShowResetToSource(data, fieldSource.value, isJsonLike);
  const showReset = shouldShowResetToSource(data, fieldSource.value, isJsonLike);
  return { fieldSource, statusPillType, isCustom, showReset };
}

function renderResetToSourceButton(
  handleChange: (path: string, value: unknown) => void,
  path: string,
  source: {
    value: unknown;
    kind: 'assembly' | 'default';
    buttonLabel?: string;
    buttonTitle?: string;
    buttonAriaLabel?: string;
  },
) {
  return source.kind === 'assembly' ? (
    <ResetFieldButton
      align="inline"
      onClick={() => handleChange(path, source.value)}
      label={source.buttonLabel}
      title={source.buttonTitle}
      ariaLabel={source.buttonAriaLabel}
    />
  ) : (
    <ResetFieldButton align="inline" onClick={() => handleChange(path, undefined)} />
  );
}

function renderAdvancedFieldResetToSourceButton(
  handleChange: (path: string, value: unknown) => void,
  path: string,
  fieldSource: ReturnType<typeof resolveFieldSource>,
  opts: {
    show: boolean;
    isGroundUField: boolean;
    groundUComputedWPerM2K?: number | null;
    /** Current control value (e.g. JsonForms `data` for `u_value`). */
    groundUControlData?: unknown;
  },
) {
  if (opts.isGroundUField && fieldSource.kind === 'default') {
    const u = opts.groundUComputedWPerM2K;
    const canApply = typeof u === 'number' && Number.isFinite(u) && u > 0;
    const matchesCalc = groundAdvancedUValueMatchesComputed(opts.groundUControlData, u);
    if (!canApply || matchesCalc) return null;

    const uRounded = Number(u.toFixed(4));

    return (
      <ResetFieldButton
        align="inline"
        onClick={(e) => {
          e.preventDefault();
          handleChange(path, uRounded);
        }}
        label="Use Calc"
        title="Set U-value to the ISO 13370 result from current floor geometry and advanced inputs (same as calculator)"
        ariaLabel="Use calculator result for ground U-value"
      />
    );
  }
  if (!opts.show) return null;
  return renderResetToSourceButton(handleChange, path, fieldSource);
}

function renderAdvancedFieldRow(
  propKey: string | undefined,
  isCompact: boolean,
  main: React.ReactNode,
  actions: React.ReactNode[],
  alignItems: React.CSSProperties['alignItems'] = 'flex-end',
  actionsOffsetTop = 0,
  fullWidthHeader?: React.ReactNode,
) {
  const visibleActions = actions.filter(Boolean);
  const inputActionsRow = (
    <div
      style={{
        display: 'flex',
        alignItems,
        gap: '8px',
        width: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>{main}</div>
      {visibleActions.length > 0 ? (
        <div
          style={{
            display: 'flex',
            alignItems,
            gap: '8px',
            flexShrink: 0,
            minWidth: 0,
            paddingTop: actionsOffsetTop,
          }}
        >
          {visibleActions.map((action, index) => (
            <React.Fragment key={index}>{action}</React.Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      data-field-key={propKey}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        width: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        margin: isCompact ? '6px 0' : '10px 0',
        gap: fullWidthHeader ? (isCompact ? 4 : 6) : 0,
      }}
    >
      {fullWidthHeader ? (
        <div style={{ width: '100%', minWidth: 0, flexShrink: 0 }}>{fullWidthHeader}</div>
      ) : null}
      {inputActionsRow}
    </div>
  );
}

type WindowPartListItem = { mid_height_air_flow_path: number };

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampMinZero(value: number): number {
  return value < 0 ? 0 : value;
}

function readWindowPartRows(data: unknown): WindowPartListItem[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const n = toFiniteNumber((entry as Record<string, unknown>).mid_height_air_flow_path);
      if (n == null) return null;
      return { mid_height_air_flow_path: n };
    })
    .filter((x): x is WindowPartListItem => x !== null);
}

function buildWindowPartRowsFromRel(baseHeightM: number, relMidHeightsM: number[]): WindowPartListItem[] {
  return relMidHeightsM.map((relM) => ({
    mid_height_air_flow_path: round2(baseHeightM + clampMinZero(relM)),
  }));
}

function windowPartRowsEqual(a: WindowPartListItem[], b: WindowPartListItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, index) => Math.abs(row.mid_height_air_flow_path - b[index].mid_height_air_flow_path) <= 1e-6);
}

export const WindowPartListControl: React.FC<AdvancedControlProps> = ({
  data,
  handleChange,
  path,
  label,
  config,
}) => {
  const cfg = rendererConfig(config);
  const isCompact = Boolean(cfg.compact);
  const elementType = cfg.elementType;
  const propKey = path?.split('.')?.pop();
  const indicatorMessages = fieldIndicatorsFor(cfg, propKey);
  const hasEvidence = hasEvidenceFor(cfg, propKey);
  const midpointPresentation = resolveFieldPresentation({
    mode: cfg.useFHSSchemaForValidation ? 'fhs' : 'core',
    propertyKey: 'mid_height_air_flow_path',
    elementType: elementType ?? 'BuildingElementTransparent',
    label: 'Window part midpoint (m)',
  }, cfg.schemaPort ?? unavailableGeometrySchemaPort);

  const selection = useGeometryStore((state) => state.selection);
  const getElementById = useGeometryStore((state) => state.getElementById);
  const currentElement =
    selection?.type === 'element' ? getElementById(selection.id) : null;

  const currentElementRecord = readRecord(currentElement);
  const baseHeightM = toFiniteNumber(currentElementRecord.base_height) ?? 0;
  const windowHeightM = toFiniteNumber(currentElementRecord.height) ?? 0;

  const rows = readWindowPartRows(data);
  const relRows = rows.map((r) => round2(r.mid_height_air_flow_path - baseHeightM));
  const relRowsKey = relRows.map((relM) => String(relM)).join('|');
  const sourceRelRowDrafts = relRows.map((relM) => String(relM));
  const [relRowDraftState, setRelRowDraftState] = React.useState(() => ({
    sourceKey: relRowsKey,
    drafts: sourceRelRowDrafts,
  }));
  const [editingRelRowIndex, setEditingRelRowIndex] = React.useState<number | null>(null);
  const prevBaseHeightRef = React.useRef(baseHeightM);
  const prevElementIdRef = React.useRef<string | null>(selection?.type === 'element' ? selection.id : null);

  const setRelativeRows = (nextRelRows: number[]) => {
    handleChange(path, buildWindowPartRowsFromRel(baseHeightM, nextRelRows));
  };

  if (editingRelRowIndex === null && relRowDraftState.sourceKey !== relRowsKey) {
    setRelRowDraftState({ sourceKey: relRowsKey, drafts: sourceRelRowDrafts });
  }
  const relRowDrafts = editingRelRowIndex === null && relRowDraftState.sourceKey !== relRowsKey
    ? sourceRelRowDrafts
    : relRowDraftState.drafts;
  const setRelRowDrafts: React.Dispatch<React.SetStateAction<string[]>> = (action) => {
    setRelRowDraftState((current) => {
      const currentDrafts = current.sourceKey === relRowsKey ? current.drafts : sourceRelRowDrafts;
      return {
        sourceKey: relRowsKey,
        drafts: typeof action === 'function' ? action(currentDrafts) : action,
      };
    });
  };

  React.useEffect(() => {
    const currentElementId = selection?.type === 'element' ? selection.id : null;
    if (prevElementIdRef.current !== currentElementId) {
      prevElementIdRef.current = currentElementId;
      prevBaseHeightRef.current = baseHeightM;
      return;
    }

    const prevBaseHeightM = prevBaseHeightRef.current;
    if (Math.abs(prevBaseHeightM - baseHeightM) <= 1e-6) return;

    const preservedRelRows = rows.map((row) => round2(row.mid_height_air_flow_path - prevBaseHeightM));
    const nextRows = buildWindowPartRowsFromRel(baseHeightM, preservedRelRows);
    prevBaseHeightRef.current = baseHeightM;

    if (!windowPartRowsEqual(rows, nextRows)) {
      handleChange(path, nextRows);
    }
  }, [baseHeightM, handleChange, path, rows, selection]);

  const [showPresets, setShowPresets] = React.useState(false);

  const applyPreset = (preset: 'single' | 'two_low_high' | 'three_even' | 'four_even') => {
    setEditingRelRowIndex(null);
    if (windowHeightM <= 0) {
      const fallback =
        preset === 'single'
          ? [1]
          : preset === 'two_low_high'
            ? [0.5, 1.5]
            : preset === 'three_even'
              ? [0.4, 1.0, 1.6]
              : [0.3, 0.8, 1.3, 1.8];
      setRelativeRows(fallback);
      return;
    }
    if (preset === 'single') {
      setRelativeRows([round2(windowHeightM / 2)]);
      return;
    }
    if (preset === 'two_low_high') {
      setRelativeRows([round2(windowHeightM * 0.25), round2(windowHeightM * 0.75)]);
      return;
    }
    if (preset === 'three_even') {
      setRelativeRows([
        round2(windowHeightM * 0.17),
        round2(windowHeightM * 0.5),
        round2(windowHeightM * 0.83),
      ]);
      return;
    }
    setRelativeRows([
      round2(windowHeightM * 0.125),
      round2(windowHeightM * 0.375),
      round2(windowHeightM * 0.625),
      round2(windowHeightM * 0.875),
    ]);
  };

  const addRow = () => {
    setEditingRelRowIndex(null);
    const defaultRel =
      windowHeightM > 0 ? round2(windowHeightM / 2) : 1;
    setRelativeRows([...relRows, defaultRel]);
  };

  const removeRow = (idx: number) => {
    setEditingRelRowIndex(null);
    setRelativeRows(relRows.filter((_, i) => i !== idx));
  };

  const updateRelativeRow = (idx: number, raw: string) => {
    setEditingRelRowIndex(idx);
    setRelRowDrafts((prev) => {
      const next = prev.slice();
      next[idx] = raw;
      return next;
    });

    const parsed = toFiniteNumber(raw);
    if (parsed === null) return;

    const next = [...relRows];
    next[idx] = clampMinZero(parsed);
    setRelativeRows(next);
  };

  const finishRelativeRowEdit = (idx: number) => {
    setEditingRelRowIndex((current) => (current === idx ? null : current));
    setRelRowDrafts((prev) => {
      const next = prev.slice();
      const parsed = toFiniteNumber(next[idx] ?? '');
      next[idx] = parsed === null ? String(relRows[idx] ?? 0) : String(clampMinZero(parsed));
      return next;
    });
  };

  const presetOptions: Array<{ key: 'single' | 'two_low_high' | 'three_even' | 'four_even'; label: string }> = [
    { key: 'single', label: 'Single' },
    { key: 'two_low_high', label: 'Two (low + high)' },
    { key: 'three_even', label: 'Three (even)' },
    { key: 'four_even', label: 'Four (even)' },
  ];

  const outOfRangeRows = relRows
    .map((relM, idx) => ({ relM, idx }))
    .filter(({ relM }) => windowHeightM > 0 && relM > windowHeightM + 1e-6);

  return renderAdvancedFieldRow(
    propKey,
    isCompact,
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
        <WindowDetailMiniButton onClick={() => setShowPresets((prev) => !prev)} ariaExpanded={showPresets}>
          Presets
        </WindowDetailMiniButton>
        {showPresets ? (
          <div
            style={{
              display: 'flex',
              gap: 4,
              overflowX: 'auto',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {presetOptions.map((preset) => (
              <WindowDetailMiniButton key={preset.key} onClick={() => applyPreset(preset.key)}>
                {preset.label}
              </WindowDetailMiniButton>
            ))}
          </div>
        ) : null}
      </div>
      <WindowDetailCollectionShell empty="None" addLabel="Add window part" onAdd={addRow}>
        {relRows.map((relM, idx) => {
          const absM = round2(baseHeightM + relM);
          return (
            <WindowDetailChip key={idx} minWidth={196} maxWidth={230}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Part {idx + 1} midpoint
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  aria-label={`Remove window part ${idx + 1}`}
                  title={`Remove window part ${idx + 1}`}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    lineHeight: 1,
                    padding: '1px 2px',
                  }}
                >
                  x
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                <StandardInput
                  aria-label={`Window part ${idx + 1} midpoint in metres above window base`}
                  type="text"
                  inputMode="decimal"
                  value={relRowDrafts[idx] ?? String(relM)}
                  unit={fieldUnitForAdornment(midpointPresentation)}
                  onChange={(e) => updateRelativeRow(idx, e.currentTarget.value)}
                  onBlur={() => finishRelativeRowEdit(idx)}
                  variant="ghost"
                  size="sm"
                  style={{
                    width: '96px',
                    minWidth: 0,
                    fontSize: '12px',
                  }}
                />
                <span style={{ color: 'var(--text-secondary)', fontSize: '11px', whiteSpace: 'nowrap' }}>
                  above window base
                </span>
              </div>
              <div
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: '11px',
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                Mid-height from ground: {absM} m
              </div>
            </WindowDetailChip>
          );
        })}
      </WindowDetailCollectionShell>
      {outOfRangeRows.length > 0 ? (
        <div style={{ color: 'var(--error)', fontSize: 12 }}>
          Part midpoint cannot exceed window height ({windowHeightM.toFixed(2)} m).
        </div>
      ) : null}
    </div>,
    [],
    'flex-start',
    0,
    renderAdvancedFieldLabelRow(
      label,
      elementType,
      indicatorMessages,
      hasEvidence,
      'default-used',
      undefined,
      cfg.useFHSSchemaForValidation,
    ),
  );
};

/** Full-width label row: label + small indicators left, status pill flush right (narrow panels). */
const ADVANCED_CTRL_LABEL_ROW: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
  minWidth: 0,
  columnGap: 10,
  marginBottom: '4px',
};

function renderAdvancedFieldLabelRow(
  label: string,
  elementType: string | undefined,
  indicatorMessages: readonly string[] | undefined,
  hasEvidence: boolean | undefined,
  statusPillType: StatusPillType,
  statusPillLabelOverride?: string,
  useFHSSchema?: boolean,
  presentation?: ResolvedFieldPresentation,
): React.ReactNode {
  return (
    <div style={ADVANCED_CTRL_LABEL_ROW}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {renderFieldLabelWithIndicator(
          label,
          elementType,
          indicatorMessages,
          hasEvidence,
          useFHSSchema,
          presentation,
        )}
      </div>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <StatusPill type={statusPillType} labelOverride={statusPillLabelOverride} />
      </div>
    </div>
  );
}

function groupSuspendedThermalSourcesByUValue(
  sources: Array<{
    elementId: string;
    label: string;
    areaM2: number;
    uValue_W_m2K: number;
    basisLabel: string;
  }>,
): Array<
  [
    string,
    Array<{
      elementId: string;
      label: string;
      areaM2: number;
      uValue_W_m2K: number;
      basisLabel: string;
    }>,
  ]
> {
  return Array.from(
    sources.reduce((groups, source) => {
      const key = source.uValue_W_m2K.toFixed(2);
      const existing = groups.get(key);
      if (existing) existing.push(source);
      else groups.set(key, [source]);
      return groups;
    }, new Map<string, typeof sources>()),
  );
}

// R4.5 DELETION NOTE: `extractOptions` used to live here — the shared helper behind
// TextControl's and NumberControl's own `options.length > 0` dropdown-fallback
// branches (both deleted, see the R4.5 deletion notes at their call sites). Deleted
// once both consumers were gone; `EnumControl` builds its own options inline and
// never called this. `coerceDropdownValue` (above, near the top of this file) is
// unrelated and stays — EnumControl still uses it to coerce a selected dropdown
// VALUE, not to derive the option list.

export { ResetFieldButton };

const RU_UNHEATED_SPACE_FIELD = 'thermal_resistance_unconditioned_space';
const GROUND_U_VALUE_FIELD = 'u_value';
const GROUND_THERMAL_TRANSM_WALLS_FIELD = 'thermal_transm_walls';

function isRuUnheatedSpaceField(propKey?: string): boolean {
  return propKey === RU_UNHEATED_SPACE_FIELD;
}

function isGroundUValueField(propKey?: string, elementType?: string): boolean {
  return elementType === 'BuildingElementGround' && propKey === GROUND_U_VALUE_FIELD;
}

function isSuspendedGroundThermalTransmWallsField(
  propKey?: string,
  elementType?: string,
  subtype?: string,
): boolean {
  return (
    elementType === 'BuildingElementGround' &&
    usesGroundThermalTransmWallsAutofill(subtype) &&
    propKey === GROUND_THERMAL_TRANSM_WALLS_FIELD
  );
}

function RuCalculatorButton({
  onClick,
  hasValue,
}: {
  onClick: () => void;
  hasValue: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn btn-ghost btn-sm element-editor-input-action"
      title={hasValue ? 'Edit calculated R_u' : 'Calculate R_u'}
    >
      {hasValue ? 'Edit R_u' : 'Calculate R_u'}
    </button>
  );
}

function GroundUCalculatorButton({
  onClick,
  hasValue,
}: {
  onClick: () => void;
  hasValue: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn btn-ghost btn-sm element-editor-input-action"
      title={hasValue ? 'Edit calculator inputs for ground U-value' : 'Open ground U-value calculator'}
    >
      {hasValue ? 'Calc Inputs' : 'Calc U'}
    </button>
  );
}

export const TextControl: React.FC<AdvancedControlProps> = ({ data, handleChange, path, label, schema, uischema, config }) => {
  const [localError, setLocalError] = useState<string | null>(null);
  const cfg = rendererConfig(config);
  const s = schemaWithOverride(uischema, schema);
  const isCompact = Boolean(cfg.compact);

  // (Debug logs removed; re-add targeted diagnostics when needed.)
  const types = schemaTypeList(s);
  const anyOf = schemaAlternatives(s, 'anyOf') ?? [];
  const oneOf = schemaAlternatives(s, 'oneOf') ?? [];
  const expectsObject =
    types.includes('object') ||
    anyOf.some((a) => a.type === 'object' || a.properties !== undefined) ||
    oneOf.some((a) => a.type === 'object' || a.properties !== undefined);
  const expectsArray =
    types.includes('array') ||
    anyOf.some((a) => a.type === 'array' || a.items !== undefined) ||
    oneOf.some((a) => a.type === 'array' || a.items !== undefined);
  const isJsonLike = expectsObject || expectsArray;

  const valueString = isJsonLike
    ? (data === undefined || data === null
      ? ''
      : // Treat empty arrays/objects (e.g. default shading: []) as "no data" in the editor
        (Array.isArray(data) && data.length === 0)
        ? ''
        : (typeof data === 'object' && !Array.isArray(data) && Object.keys(data || {}).length === 0)
        ? ''
        : (typeof data === 'string'
          ? data
          : (() => {
              try {
                return JSON.stringify(data);
              } catch {
                return '';
              }
            })()))
    : (data === undefined || data === null ? '' : String(data));
  const elementType = cfg.elementType;
  const subtype = cfg.subtype;
  const opaqueFabricVariant = cfg.opaqueFabricVariant;
  const propKey = path?.split('.')?.pop();
  const indicatorMessages = fieldIndicatorsFor(cfg, propKey);
  const hasEvidence = hasEvidenceFor(cfg, propKey);
  const openRuCalculator = cfg.openRuCalculator;
  const openGroundUCalculator = cfg.openGroundUCalculator;
  const groundUComputedWPerM2K = cfg.groundUComputedWPerM2K;
  const isRuField = isRuUnheatedSpaceField(propKey);
  const isGroundUField = isGroundUValueField(propKey, elementType);
  const defaults = useDefaultValues();
  const defaultsLookup = useDefaultsLookup();
  const defaultValue = getAdvancedDefaultValue(defaults, defaultsLookup, path, elementType, subtype, opaqueFabricVariant, propKey, cfg);
  const defaultFieldSource = resolveFieldSource(propKey, defaultValue, cfg);

  // (Debug logs removed; re-add targeted diagnostics when needed.)
  const presentation = computeFieldPresentationState({
    data,
    isJsonLike,
    fieldSource: defaultFieldSource,
    config: cfg,
    path,
  });
  const fieldSource = presentation.fieldSource;
  const groundPillArg = isGroundUField ? { isGroundUField: true, groundUComputedWPerM2K } : undefined;
  const statusPillType =
    cfg.systemSampleMode
      ? presentation.statusPillType
      : getStatusPillType(data, fieldSource.value, fieldSource.kind, isJsonLike, groundPillArg);
  const statusPillLabelOverride =
    cfg.systemSampleMode && statusPillType === 'default-used' ? 'Preset' : undefined;
  const matchesGroundCalc =
    isGroundUField && groundAdvancedUValueMatchesComputed(data, groundUComputedWPerM2K);
  const isCustom = presentation.isCustom && !matchesGroundCalc;
  const showReset = presentation.showReset;

  // R4.5 DELETION NOTE: TextControl used to have its own `options.length > 0` ->
  // StandardDropdown escape hatch here (`extractOptions(s)`, deleted alongside this
  // branch — see `pickDirectControl`'s docstring in DirectAdvancedFields.tsx for the
  // full history of why it ever mattered). Post-R4.3b, `pickDirectControl` routes
  // every NON-EMPTY enum-like resolved schema to EnumControl before TextControl is
  // ever reached, so this branch was reachable ONLY through the registry's rank-80
  // TextControl-wins dispatch quirk (deleted with `standardRenderers` itself) — dead
  // on the only render path left. Its inline value-coercion duplicated
  // `coerceDropdownValue` (still used by EnumControl, kept).
  return renderAdvancedFieldRow(
    propKey,
    isCompact,
    <>
        <StandardInput
          label={undefined}
          value={valueString}
          variant="ghost"
          onChange={(e) => {
            const next = e.currentTarget.value;
            if (!isJsonLike && elementType && propKey) {
              const res = validateAdvancedFieldPrimitive(cfg, elementType, propKey, next);
              setLocalError(res.valid ? null : (res.errors?.[0] ?? 'Invalid value'));
            } else if (isJsonLike) {
              setLocalError(null);
            }
            handleChange(path, next);
          }}
          onBlur={(e) => {
            if (!isJsonLike) return;
            const raw = e.currentTarget.value.trim();
            if (!elementType || !propKey) return;
            if (raw === '') {
              setLocalError(null);
              handleChange(path, undefined);
              return;
            }
            try {
              const parsed = JSON.parse(raw);
              const res = validateAdvancedFieldPrimitive(cfg, elementType, propKey, parsed);
              setLocalError(res.valid ? null : (res.errors?.[0] ?? 'Invalid value'));
              if (res.valid) handleChange(path, parsed);
            } catch (err) {
              setLocalError(`Invalid JSON: ${errorMessageFromUnknown(err)}`);
            }
          }}
          error={undefined}
          size="md"
          helperText={undefined}
          placeholder={(() => {
            // Don't show placeholder if field has content
            if (valueString !== '' && valueString !== '{}' && valueString !== '[]') {
              return undefined;
            }

            // PRIORITY 1: Use default value if available
            if (defaultValue !== undefined && defaultValue !== null) {
              return typeof defaultValue === 'object' ? JSON.stringify(defaultValue) : String(defaultValue);
            }

            // PRIORITY 2: Generate schema-driven placeholder
            const defs =
              schemaDefs(s.$defs) ||
              schemaDefs(cfg.$defs);
            const placeholder = generateRobustPlaceholder(propKey || '', s, defs);

            return placeholder;
          })()}
          className={isCustom ? 'custom-value' : ''}
        />
        {localError && (<div style={{ color: 'var(--error)', fontSize: 12, marginTop: 4 }}>{localError}</div>)}
      </>,
      [
        !isRuField && !isGroundUField && (valueString === '' || valueString === '{}' || valueString === '[]') && (() => {
        // PRIORITY 1: Use default value if available
        if (defaultValue !== undefined && defaultValue !== null) {
          const defaultPlaceholder = typeof defaultValue === 'object' ? JSON.stringify(defaultValue) : String(defaultValue);
          return (
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(defaultPlaceholder)}
              className="btn btn-ghost btn-sm element-editor-input-action element-editor-input-action--icon"
              title="Copy default"
              aria-label="Copy default"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" strokeWidth="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2"/>
              </svg>
            </button>
          );
        }

        // PRIORITY 2: Use schema-generated placeholder
        const defs =
          schemaDefs(s.$defs) ||
          schemaDefs(cfg.$defs);
        const placeholder = generateRobustPlaceholder(propKey || '', s, defs);
        return placeholder ? (
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(placeholder)}
            className="btn btn-ghost btn-sm element-editor-input-action element-editor-input-action--icon"
            title="Copy example"
            aria-label="Copy example"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" strokeWidth="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </button>
        ) : null;
      })(),
        isRuField && openRuCalculator ? (
          <RuCalculatorButton key="ru-calculator" onClick={openRuCalculator} hasValue={valueString !== ''} />
        ) : null,
        isGroundUField && openGroundUCalculator ? (
          <GroundUCalculatorButton key="ground-u-calculator" onClick={openGroundUCalculator} hasValue={valueString !== ''} />
        ) : null,
        renderAdvancedFieldResetToSourceButton(handleChange, path, fieldSource, {
          show: showReset,
          isGroundUField,
          groundUComputedWPerM2K,
          groundUControlData: data,
        }),
      ],
    'flex-end',
    0,
    renderAdvancedFieldLabelRow(
      label,
      elementType,
      indicatorMessages,
      hasEvidence,
      statusPillType,
      statusPillLabelOverride,
      cfg.useFHSSchemaForValidation,
    ),
    );
};

export const NumberControl: React.FC<AdvancedControlProps> = ({ data, handleChange, path, label, schema, uischema, config }) => {
  const [localError, setLocalError] = useState<string | null>(null);
  const cfg = rendererConfig(config);
  const s = schemaWithOverride(uischema, schema);
  const isCompact = Boolean(cfg.compact);
  const valueString = data === undefined || data === null ? '' : String(data);
  const elementType = cfg.elementType;
  const subtype = cfg.subtype;
  const opaqueFabricVariant = cfg.opaqueFabricVariant;
  const propKey = path?.split('.')?.pop();
  const fieldPresentation = resolveAdvancedControlFieldPresentation(label, propKey, s, cfg);
  const fieldUnit = fieldUnitForAdornment(fieldPresentation);
  const indicatorMessages = fieldIndicatorsFor(cfg, propKey);
  const hasEvidence = hasEvidenceFor(cfg, propKey);
  const openRuCalculator = cfg.openRuCalculator;
  const openGroundUCalculator = cfg.openGroundUCalculator;
  const groundUComputedWPerM2K = cfg.groundUComputedWPerM2K;
  const resyncSuspendedThermalTransmWalls = cfg.resyncSuspendedThermalTransmWalls;
  const suspendedThermalTransmWallsAutoValue = cfg.suspendedThermalTransmWallsAutoValue;
  const suspendedThermalTransmWallsAutofillSources = cfg.suspendedThermalTransmWallsAutofillSources ?? [];
  const focusSourceElement = cfg.focusSourceElement;
  const isRuField = isRuUnheatedSpaceField(propKey);
  const isGroundUField = isGroundUValueField(propKey, elementType);
  const isSuspendedGroundThermalTransmWallsFieldActive = isSuspendedGroundThermalTransmWallsField(
    propKey,
    elementType,
    subtype,
  );
  const isAdvancedEditor = Boolean(uiOptions(uischema).advancedEditor) || Boolean(cfg.advancedEditor);
  const suspendedThermalTransmWallsAutofillHasSources = cfg.suspendedThermalTransmWallsAutofillHasSources;
  const showSuspendedThermalTransmNoWallUHint =
    isAdvancedEditor &&
    isSuspendedGroundThermalTransmWallsFieldActive &&
    suspendedThermalTransmWallsAutofillHasSources === false;
  const defaults = useDefaultValues();
  const defaultsLookup = useDefaultsLookup();
  const defaultValue = getAdvancedDefaultValue(defaults, defaultsLookup, path, elementType, subtype, opaqueFabricVariant, propKey, cfg);
  const defaultFieldSource = resolveFieldSource(propKey, defaultValue, cfg);
  const presentation = computeFieldPresentationState({
    data,
    isJsonLike: false,
    fieldSource: defaultFieldSource,
    config: cfg,
    path,
  });
  const fieldSource = presentation.fieldSource;
  const groundPillArg = isGroundUField ? { isGroundUField: true, groundUComputedWPerM2K } : undefined;
  const statusPillType =
    cfg.systemSampleMode
      ? presentation.statusPillType
      : getStatusPillType(data, fieldSource.value, fieldSource.kind, false, groundPillArg);
  const statusPillLabelOverride =
    cfg.systemSampleMode && statusPillType === 'default-used' ? 'Preset' : undefined;
  const isIntegerSchema = schemaHasIntegerType(s);
  const numberInputAttributes = numericInputAttributesFromSchema(s, { integer: isIntegerSchema });
  const numberDraftInput = useNumericDraftInput(
    valueString,
    (next) => {
      if (next === '') {
        if (elementType && propKey) setLocalError(null);
        handleChange(path, '');
        return;
      }
      if (elementType && propKey) {
        const res = validateAdvancedFieldPrimitive(cfg, elementType, propKey, next);
        setLocalError(res.valid ? null : (res.errors?.[0] ?? 'Invalid value'));
      }
      handleChange(path, next);
    },
    {
      commitOnChange: true,
      formatOnBlur: 'preserve',
      integer: isIntegerSchema,
      syncExternal: true,
    },
  );

  if (
    elementType === 'OnSiteGeneration' &&
    (path === 'inverter_peak_power_dc' || path === 'inverter_peak_power_ac')
  ) {
    // (Debug logs removed)
  }

  const matchesGroundCalc =
    isGroundUField && groundAdvancedUValueMatchesComputed(data, groundUComputedWPerM2K);
  const isCustom = presentation.isCustom && !matchesGroundCalc;
  const showFieldSourceReset = presentation.showReset;
  const showSuspendedThermalTransmSyncReset =
    isSuspendedGroundThermalTransmWallsFieldActive &&
    suspendedThermalTransmWallsAutoValue != null &&
    shouldShowResetToSource(data, suspendedThermalTransmWallsAutoValue, false) &&
    !!resyncSuspendedThermalTransmWalls;
  const suspendedThermalTransmSourcesInfo =
    isAdvancedEditor && isSuspendedGroundThermalTransmWallsFieldActive ? (
      suspendedThermalTransmWallsAutofillSources.length > 0 ? (
        <div
          style={{
            color: 'var(--text-secondary)',
            fontSize: 12,
            marginTop: 6,
            lineHeight: 1.45,
            minWidth: 0,
            maxWidth: '100%',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
          }}
        >
          Area-weighted from{' '}
          {groupSuspendedThermalSourcesByUValue(suspendedThermalTransmWallsAutofillSources).map(
            ([uKey, group], groupIndex) => (
              <React.Fragment key={uKey}>
                {groupIndex > 0 ? ' | ' : null}
                {uKey} W/m²K:{' '}
                {group.map((source, index) => (
                  <React.Fragment key={source.elementId}>
                    {index > 0 ? ', ' : null}
                    <button
                      type="button"
                      onClick={() => focusSourceElement?.(source.elementId)}
                      style={{
                        border: 'none',
                        background: 'none',
                        padding: 0,
                        color: 'var(--accent-blue)',
                        cursor: focusSourceElement ? 'pointer' : 'default',
                        font: 'inherit',
                        textDecoration: focusSourceElement ? 'underline' : 'none',
                        textAlign: 'left',
                        overflowWrap: 'anywhere',
                      }}
                      title={`${source.label}: ${source.areaM2.toFixed(2)} m² at U ${source.uValue_W_m2K.toFixed(2)} from ${source.basisLabel}`}
                      disabled={!focusSourceElement}
                    >
                      {source.label}
                    </button>
                  </React.Fragment>
                ))}
              </React.Fragment>
            ),
          )}
          .
        </div>
      ) : showSuspendedThermalTransmNoWallUHint ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 6, lineHeight: 1.35 }}>
          No adjacent wall U value available on this storey.
        </div>
      ) : null
    ) : null;

  const thermalTransmWallSyncButton =
    showSuspendedThermalTransmSyncReset && resyncSuspendedThermalTransmWalls ? (
      <ResetFieldButton
        align="inline"
        title="Apply area-weighted U from the adjacent opaque walls listed below."
        ariaLabel="Use wall value — apply area-weighted U from adjacent walls"
        label="Use wall value"
        onClick={() => resyncSuspendedThermalTransmWalls()}
      />
    ) : null;

  // R4.5 DELETION NOTE: NumberControl used to have its own `options.length > 0` ->
  // StandardDropdown escape hatch here (`extractOptions(s)`, deleted alongside this
  // branch — see `pickDirectControl`'s docstring in DirectAdvancedFields.tsx). Its
  // inline value-coercion DIVERGED from `coerceDropdownValue` (still used by
  // EnumControl, kept): an unparseable numeric string coerced to `null` here, where
  // `coerceDropdownValue` yields `NaN` — that divergence dies with this branch, not
  // just the branch itself. Post-R4.3b, `pickDirectControl` routes every NON-EMPTY
  // enum-like resolved schema to EnumControl before NumberControl is ever reached, so
  // this branch was reachable ONLY through the registry's rank-80 TextControl-wins /
  // rank-90 NumberControl dispatch quirks (deleted with `standardRenderers` itself) —
  // dead on the only render path left.
  return renderAdvancedFieldRow(
    propKey,
    isCompact,
    <>
      {isSuspendedGroundThermalTransmWallsFieldActive ? (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              width: '100%',
              minWidth: 0,
              boxSizing: 'border-box',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <StandardInput
                label={undefined}
                type="text"
                {...numberInputAttributes}
                value={numberDraftInput.inputValue}
                onChange={numberDraftInput.handleInputChange}
                onBlur={numberDraftInput.handleBlur}
                error={undefined}
                size="md"
                variant="ghost"
                unit={fieldUnit}
                helperText={undefined}
                placeholder={defaultValue !== undefined ? String(defaultValue) : undefined}
                className={isCustom ? 'custom-value' : ''}
              />
              {localError && (
                <div style={{ color: 'var(--error)', fontSize: 12, marginTop: 4 }}>{localError}</div>
              )}
            </div>
            {thermalTransmWallSyncButton}
          </div>
          {suspendedThermalTransmSourcesInfo}
        </>
      ) : (
        <>
          <StandardInput
            label={undefined}
            type="text"
            {...numberInputAttributes}
            value={numberDraftInput.inputValue}
            onChange={numberDraftInput.handleInputChange}
            onBlur={numberDraftInput.handleBlur}
            error={undefined}
            size="md"
            variant="ghost"
            unit={fieldUnit}
            helperText={undefined}
            placeholder={defaultValue !== undefined ? String(defaultValue) : undefined}
            className={isCustom ? 'custom-value' : ''}
          />
          {localError && (<div style={{ color: 'var(--error)', fontSize: 12, marginTop: 4 }}>{localError}</div>)}
          {suspendedThermalTransmSourcesInfo}
        </>
      )}
    </>,
    [
      isRuField && openRuCalculator ? (
        <RuCalculatorButton key="ru-calculator" onClick={openRuCalculator} hasValue={valueString !== ''} />
      ) : null,
      isGroundUField && openGroundUCalculator ? (
        <GroundUCalculatorButton key="ground-u-calculator" onClick={openGroundUCalculator} hasValue={valueString !== ''} />
      ) : null,
      renderAdvancedFieldResetToSourceButton(handleChange, path, fieldSource, {
        show: !isSuspendedGroundThermalTransmWallsFieldActive && showFieldSourceReset,
        isGroundUField,
        groundUComputedWPerM2K,
        groundUControlData: data,
      }),
    ],
    'flex-end',
    0,
    renderAdvancedFieldLabelRow(
      label,
      elementType,
      indicatorMessages,
      hasEvidence,
      statusPillType,
      statusPillLabelOverride,
      cfg.useFHSSchemaForValidation,
      fieldPresentation,
    ),
  );
};

export const BooleanControl: React.FC<AdvancedControlProps> = ({ data, handleChange, path, label, config }) => {
  const defaults = useDefaultValues();
  const defaultsLookup = useDefaultsLookup();
  const cfg = rendererConfig(config);
  const elementType = cfg.elementType;
  const subtype = cfg.subtype;
  const opaqueFabricVariant = cfg.opaqueFabricVariant;
  const isCompact = Boolean(cfg.compact);
  const propKey = path?.split('.')?.pop();
  const indicatorMessages = fieldIndicatorsFor(cfg, propKey);
  const hasEvidence = hasEvidenceFor(cfg, propKey);
  const defaultValue = getAdvancedDefaultValue(defaults, defaultsLookup, path, elementType, subtype, opaqueFabricVariant, propKey, cfg);
  const defaultFieldSource = resolveFieldSource(propKey, defaultValue, cfg);
  const presentation = computeFieldPresentationState({
    data,
    isJsonLike: false,
    fieldSource: defaultFieldSource,
    config: cfg,
    path,
  });
  const fieldSource = presentation.fieldSource;

  // Determine status pill type (booleans are not JSON-like)
  const statusPillType = presentation.statusPillType;
  const statusPillLabelOverride =
    cfg.systemSampleMode && statusPillType === 'default-used' ? 'Preset' : undefined;

  const isCustom = presentation.isCustom;
  const showReset = presentation.showReset;

  return renderAdvancedFieldRow(
    propKey,
    isCompact,
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <input
        type="checkbox"
        checked={!!data}
        onChange={(e) => handleChange(path, e.currentTarget.checked)}
        style={{ accentColor: isCustom ? 'var(--status-info-text)' : undefined }}
      />
      {defaultValue !== undefined && (
        <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: 12 }}>
          Default: {String(defaultValue)}
        </span>
      )}
    </label>,
    showReset ? [renderResetToSourceButton(handleChange, path, fieldSource)] : [],
    'center',
    0,
    renderAdvancedFieldLabelRow(
      label,
      elementType,
      indicatorMessages,
      hasEvidence,
      statusPillType,
      statusPillLabelOverride,
      cfg.useFHSSchemaForValidation,
    ),
  );
};

export const EnumControl: React.FC<AdvancedControlProps> = ({ data, handleChange, path, label, errors, schema, uischema, config, enabled }) => {
  const cfg = rendererConfig(config);
  const s = schemaWithOverride(uischema, schema);
  const isCompact = Boolean(cfg.compact);
  const elementType = cfg.elementType;
  const propKey = path?.split('.')?.pop();
  const fieldPresentation = resolveAdvancedControlFieldPresentation(label, propKey, s, cfg);
  const indicatorMessages = fieldIndicatorsFor(cfg, propKey);
  const hasEvidence = hasEvidenceFor(cfg, propKey);
  const fromEnum = Array.isArray(s.enum) ? s.enum : null;
  const fromOneOf = schemaAlternatives(s, 'oneOf');
  const fromAnyOf = schemaAlternatives(s, 'anyOf');

  let options: { value: string; label: string }[] = [];
  const optionDescriptions = new Map<string, string>();
  let coerceType: 'string' | 'number' | 'boolean' | undefined;

  // Check if this is junction_type for ThermalBridgeLinear - use descriptions in labels
  // Path might be just 'junction_type' or a full path ending with 'junction_type'
  // JsonForms paths can be in various formats, so check multiple patterns
  const pathSegments = path.split(/[/#.]/);
  const lastSegment = pathSegments[pathSegments.length - 1];
  const isJunctionTypeField = lastSegment === 'junction_type' || path.includes('junction_type');
  const isJunctionType = isJunctionTypeField && elementType === 'ThermalBridgeLinear';

  // (Debug logs removed; re-add targeted diagnostics when needed.)

  if (fromEnum) {
    const enumIsNumber = fromEnum.length > 0 && fromEnum.every((v) => typeof v === 'number');
    const enumIsBoolean = fromEnum.length > 0 && fromEnum.every((v) => typeof v === 'boolean');
    options = fromEnum.map((v) => {
      const value = String(v);
      // Use description for junction types, otherwise use value as label
      let label = value;
      if (isJunctionType) {
        const description = JUNCTION_TYPE_DESCRIPTIONS[value];
        if (description) {
          label = `${value}: ${description}`;
        }
      }
      return { value, label };
    });
    coerceType = enumIsNumber ? 'number' : enumIsBoolean ? 'boolean' : 'string';
  } else if (fromOneOf || fromAnyOf) {
    const alts = fromOneOf || fromAnyOf || [];
    const hasConst = alts.every((a) => Object.prototype.hasOwnProperty.call(a, 'const'));
    if (hasConst) {
      options = alts.map((a) => {
        const value = String(a.const);
        if (typeof a.description === 'string' && a.description.trim()) {
          optionDescriptions.set(value, a.description.trim());
        }
        // Use description for junction types, otherwise use title or const
        const label = isJunctionType && JUNCTION_TYPE_DESCRIPTIONS[value]
          ? `${value}: ${JUNCTION_TYPE_DESCRIPTIONS[value]}`
          : String(a.title ?? a.const);
        return { value, label };
      });
      const first = alts[0]?.const;
      coerceType = typeof first === 'number' ? 'number' : typeof first === 'boolean' ? 'boolean' : 'string';
    }
  }

  if (propKey === 'security_risk' && coerceType === 'boolean' && options.length > 0) {
    options = options.map((o) => ({
      ...o,
      label: o.value === 'true' ? 'Yes' : o.value === 'false' ? 'No' : o.label,
    }));
  }

  const defaults = useDefaultValues();
  const defaultsLookup = useDefaultsLookup();
  const subtype = cfg.subtype;
  const opaqueFabricVariant = cfg.opaqueFabricVariant;
  const defaultValue = getAdvancedDefaultValue(defaults, defaultsLookup, path, elementType, subtype, opaqueFabricVariant, propKey, cfg);
  const defaultFieldSource = resolveFieldSource(propKey, defaultValue, cfg);
  const presentation = computeFieldPresentationState({
    data,
    isJsonLike: false,
    fieldSource: defaultFieldSource,
    config: cfg,
    path,
  });
  const fieldSource = presentation.fieldSource;

  // Determine status pill type (enums are not JSON-like)
  const statusPillType = presentation.statusPillType;
  const statusPillLabelOverride =
    cfg.systemSampleMode && statusPillType === 'default-used' ? 'Preset' : undefined;

  const valueString = data === undefined || data === null ? '' : String(data);
  const isCustom = presentation.isCustom;
  const showReset = presentation.showReset;
  const isReadOnly = uiOptions(uischema).readOnly === true || enabled === false;
  const selectedLabel = options.find((o) => o.value === valueString)?.label ?? valueString;
  const selectedOptionDescription = optionDescriptions.get(valueString);
  // The value actually shown as "the default" -- prefers a resolved `fieldSource`
  // (kind 'default', a defined/non-empty value) and otherwise falls back to the raw
  // `defaultValue`. Factored out so the "Default: X" helper line below and the
  // R4.3b placeholder just below it read the exact same source; this is a pure
  // refactor of the ternary that used to be inlined into `sourceHelperText` alone --
  // behaviourally identical for every existing case.
  const effectiveDefaultForDisplay =
    fieldSource.kind === 'default' &&
    fieldSource.value !== undefined &&
    fieldSource.value !== null &&
    String(fieldSource.value) !== ''
      ? fieldSource.value
      : defaultValue;
  const sourceHelperText =
    effectiveDefaultForDisplay !== undefined
      ? `${cfg.systemSampleMode ? 'Preset' : 'Default'}: ${String(effectiveDefaultForDisplay)}`
      : undefined;
  // R4.3b (Baz-requested presentation amendment, post-screenshot-review): an unset
  // enum field with a resolvable default shows that default INLINE in the closed
  // select, label-mapped through `options` (e.g. mass_distribution_class's raw
  // default code 'D' displays as "D: Mass equally distributed", not the bare code) --
  // matching the look the retired TextControl-fallback dropdown had (its own
  // `extractOptions` placeholder resolved the same way, see TextControl below). The
  // "Default: X" helper line stays as well; showing both was already the old path's
  // behaviour for fields that had one, and dropping either is out of scope here. Uses
  // the SAME `effectiveDefaultForDisplay` source as the helper line above -- no
  // second default lookup.
  const placeholder =
    valueString === '' && effectiveDefaultForDisplay !== undefined
      ? (options.find((o) => o.value === String(effectiveDefaultForDisplay))?.label ??
          String(effectiveDefaultForDisplay))
      : undefined;
  const shouldShowOptionDescription = propKey !== 'ecodesign_control_class';
  const helperText = propKey === 'security_risk'
    ? WINDOW_SECURITY_RISK_HELPER
    : shouldShowOptionDescription && selectedOptionDescription && sourceHelperText
      ? (
          <>
            {selectedOptionDescription}
            <br />
            {sourceHelperText}
          </>
        )
      : (shouldShowOptionDescription ? selectedOptionDescription : undefined) ?? sourceHelperText;
  const fieldUnit = coerceType === 'number'
    ? fieldUnitForAdornment(fieldPresentation)
    : undefined;

  if (isReadOnly) {
    return renderAdvancedFieldRow(
      propKey,
      isCompact,
      <StandardControlShell
        unit={fieldUnit}
        size="md"
        variant="ghost"
        readOnly
      >
        {(describedBy) => (
          <div
            style={{
              minHeight: 'var(--form-input-height)',
              display: 'flex',
              alignItems: 'center',
              padding: '0 12px',
              borderRadius: 'inherit',
              border: 0,
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 13,
              flex: 1,
              minWidth: 0,
            }}
            aria-readonly="true"
            aria-describedby={describedBy}
          >
            {selectedLabel || '—'}
          </div>
        )}
      </StandardControlShell>,
      [],
      'flex-start',
      0,
      renderAdvancedFieldLabelRow(
        label,
        elementType,
        indicatorMessages,
        hasEvidence,
        statusPillType,
        statusPillLabelOverride,
        cfg.useFHSSchemaForValidation,
        fieldPresentation,
      ),
    );
  }

  return renderAdvancedFieldRow(
    propKey,
    isCompact,
    <StandardDropdown
      label={undefined}
      value={valueString}
      onChange={(v) => handleChange(path, coerceDropdownValue(v, coerceType))}
      options={options}
      error={errors || undefined}
      size="md"
      variant="ghost"
      unit={fieldUnit}
      helperText={helperText}
      placeholder={placeholder}
      className={isCustom ? 'custom-value' : ''}
    />,
    showReset ? [renderResetToSourceButton(handleChange, path, fieldSource)] : [],
    'flex-end',
    0,
    renderAdvancedFieldLabelRow(
      label,
      elementType,
      indicatorMessages,
      hasEvidence,
      statusPillType,
      statusPillLabelOverride,
      cfg.useFHSSchemaForValidation,
      fieldPresentation,
    ),
  );
};

/**
 * Plain collapsible-section chrome, extracted (R4.5) from the retired `rankWith(100,
 * uiTypeIs('Group'))` registry renderer — the entire `standardRenderers` registry this
 * lived in was deleted in the same slice (see the R4.5 deletion note above
 * `schemaHasIntegerType`) — so `DirectAdvancedFields.tsx`'s new `DirectSpecFields`
 * (the direct-render replacement for web's Group-carrying fabric uischema spec) gets
 * the identical details/summary look without a `<JsonForms>` dispatch underneath it.
 * Children are supplied as plain `ReactNode` by the caller — the retired registry
 * renderer's own `JsonFormsDispatch` child-rendering has no equivalent here, since
 * there is no schema/uischema pair left to dispatch.
 *
 * DELETED, NOT PORTED (verified dead at extraction time): the `missingOptional` /
 * `addField` / "+ Add field" palette and its `CustomEvent('jsonforms-add-field')`
 * dispatch — nothing in either repo ever populates a `missingOptional` uischema
 * option, so the palette could never render a field to add.
 */
export const GroupAccordion: React.FC<{
  label: string;
  count?: number;
  openInitially?: boolean;
  children: React.ReactNode;
}> = ({ label, count, openInitially, children }) => {
  const [open, setOpen] = useState<boolean>(!!openInitially);
  return (
    <details
      style={{ margin: '0.75rem 0', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary
        style={{
          position: 'relative',
          top: 'auto',
          zIndex: 1,
          background: 'var(--bg-secondary)',
          cursor: 'pointer',
          listStyle: 'none',
          padding: '0.7rem 0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          borderBottom: '2px solid var(--border-medium)',
          fontWeight: 700,
        }}
      >
        <span style={{ fontWeight: 600 }}>{label}</span>
        {count !== undefined && count > 0 ? (
          <span className="badge" style={{ marginLeft: 'auto' }}>{count}</span>
        ) : null}
      </summary>
      <div style={{ padding: '1rem 0.85rem', background: 'var(--bg-secondary)' }}>
        {open ? children : null}
      </div>
    </details>
  );
};

/**
 * R4.5 DELETION NOTE: this is where `GenericControl` (the registry's rank-5 fallback
 * Control), `advancedFieldsNumericTester`, and the entire `standardRenderers`
 * `JsonFormsRendererRegistryEntry[]` array (Group accordion renderer included — see
 * `GroupAccordion` above for its surviving replacement) used to live. Nothing in
 * COMMUNITY mounts `<JsonForms>` with this registry any more, as of this PR. Web's two
 * mounts (SnippetEditor, SimplifiedFabricEditor) and its own
 * `jsonformsRenderers.test.tsx` registry-comparison test are deleted in the PAIRED
 * parent-repo PR, which migrates both editors to `DirectSpecFields` and lands together
 * with the pointer bump onto this commit (ordering: this community PR merges FIRST,
 * so `standardRenderers` is not actually gone from every consumer until the paired PR
 * merges right after) — every `@jsonforms/react` / `@jsonforms/core` import this file
 * used to carry died with THIS deletion regardless, since community's own only
 * consumer (the registry itself) is gone. Two schema predicates that existed only to
 * feed the deleted registry (`schemaIsNullableNumberAnyOf`, `advancedFieldsNumericTester`'s
 * own `anyOf`-nullable-number check; `schemaIsPlainString`, the deleted rank-90
 * plain-string tester's own guard) had no other caller and were deleted alongside it,
 * not carried forward as unused surface.
 */
function schemaHasIntegerType(schema: unknown): boolean {
  return schemaTypeList(readRecord(schema)).includes('integer');
}

// eslint-disable-next-line react-refresh/only-export-components -- schema predicate shared with DirectAdvancedFields' control picker.
export function schemaHasEnum(schema: unknown): boolean {
  return Array.isArray(readRecord(schema).enum);
}

// eslint-disable-next-line react-refresh/only-export-components -- schema predicate shared with DirectAdvancedFields' control picker.
export function schemaHasConstAlternatives(schema: unknown, key: 'oneOf' | 'anyOf'): boolean {
  const alts = schemaAlternatives(readRecord(schema), key);
  return !!alts && alts.every((a) => Object.prototype.hasOwnProperty.call(a, 'const'));
}
