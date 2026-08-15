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
import { ValidationIndicator } from './ValidationIndicator';
import { generateRobustPlaceholder } from '../lib/schemaPlaceholders';
import { getSchemaParamIdForField } from '../lib/fieldTooltipMap';
import {
  fieldUnitForAdornment,
  resolveFieldPresentation,
  type ResolvedFieldPresentation,
} from '../lib/fieldPresentation';
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
import { schemaAlternatives, schemaTypeList } from '../lib/schemaShape';
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
  /**
   * The property's own leaf key — `u_value`, `mid_height_air_flow_path`, a raw System
   * plant key — supplied by the walk that mounted this control.
   *
   * R4.6b-2: REQUIRED, and no longer derived here. Every control used to recover it as
   * `path.split('.').pop()`, which is a guess that happens to be right only while no leaf
   * key contains a '.'; a CSV-derived System plant key may (`"Zone 1.5 circuit"` would
   * have arrived as `"5 circuit"`), which R4.3b recorded as an accepted residual because
   * the walks were segment-safe but the controls still re-parsed a joined string. Both
   * walks in `DirectAdvancedFields.tsx` already hold the decoded leaf segment, so they
   * now pass it and the guess is gone. Required rather than optional-with-fallback
   * because those two walks are the only mounts in either repo — verified by sweep, the
   * parent repo mounts no control directly.
   */
  propKey: string;
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

/**
 * LABEL-ONLY resolution: the caller has a DISPLAY LABEL and nothing else, so the
 * property key is reverse-engineered from it (`getSchemaParamIdForField`) and there is
 * no schema node, subtype or fabric variant to scope the lookup with.
 *
 * That is lossy — a curated `title` that is not a start-case of its key resolves to the
 * wrong parameter, or to none — and it is deliberately NOT what Advanced Fields control
 * rows use. Since R4.6b-1 all five controls (Text/Number/Boolean/Enum/WindowPartList)
 * resolve their presentation from the REAL property key via
 * `resolveAdvancedControlFieldPresentation` and render it through `ResolvedFieldLabel`.
 * This function survives for the hand-rendered field groups that genuinely have only a
 * label — `AdvancedFieldsEditor`'s own group headers, `EdgeInsulationFields`,
 * `FancoilTestDataFields`, `DhwStorageHeatSourcePicker`, `WindowTreatmentFields`. Those
 * five are now its ONLY callers: R4.6b-2 deleted `renderFieldLabelWithIndicator`'s
 * no-presentation fallback arm, which was the last route from a control row into this
 * lossy resolver.
 *
 * R4.6b-1 also deleted the copy of `ResolvedFieldLabel`'s JSX that used to live here.
 * The markup was byte-identical to that component; keeping two copies meant a label or
 * tooltip tweak had to be made twice, with only the lossy resolver telling them apart.
 * The resolver stays here; the rendering is delegated.
 */
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
  return <ResolvedFieldLabel presentation={presentation} useFHSSchema={useFHSSchema} />;
}

/**
 * The informed resolution every Advanced Fields control row uses: real property key,
 * resolved schema node, subtype/fabric variant, and an EFFECTIVE schema port supplied by
 * the caller (`useAdvancedControlPreamble`, the only call site — see the port contract
 * documented there). The port is a parameter rather than something re-derived from
 * `config` here so that "which port does a label read?" has exactly one decision point.
 */
function resolveAdvancedControlFieldPresentation(
  label: string,
  propertyKey: string | undefined,
  schema: JsonRecord,
  config: RendererConfig,
  schemaPort: GeometrySchemaPort,
): ResolvedFieldPresentation {
  return resolveFieldPresentation({
    mode: config.useFHSSchemaForValidation ? 'fhs' : 'core',
    propertyKey: propertyKey ?? label,
    elementType: config.elementType,
    subtype: config.subtype,
    opaqueFabricVariant: config.opaqueFabricVariant,
    label,
    schemaNode: schema,
  }, schemaPort);
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

/**
 * Label plus its small inline indicators (evidence chip, validation info).
 *
 * R4.6b-2 closes the R4.6b-1 residual this used to carry. `presentation` is REQUIRED and
 * the label-only fallback arm is DELETED — it routed through
 * `renderFieldLabelWithTooltip`, which reverse-engineers a property key from the DISPLAY
 * LABEL (`getSchemaParamIdForField`) and so resolves the wrong parameter, or none, for any
 * curated `title` that is not a start-case of its key. Evidence that it was dead rather
 * than merely unused: this function has exactly ONE caller
 * (`renderAdvancedFieldLabelRow`), that caller has exactly SIX (Text, Number, Boolean,
 * Enum's two arms, WindowPartList), and every one of the six passes the preamble's
 * `fieldPresentation`, which `useAdvancedControlPreamble` computes unconditionally for
 * every control. There is no path through the Advanced Fields grid that arrives here
 * without one.
 *
 * `label` and `elementType` went with the arm: they were its arguments and nothing else's.
 * The label a row shows now comes from the resolved presentation, which is the point of
 * having resolved one. `renderFieldLabelWithTooltip` itself stays, for the five
 * hand-rendered field groups that genuinely have only a label — see its own docstring.
 */
function renderFieldLabelWithIndicator(
  indicatorMessages: readonly string[] | undefined,
  hasEvidence: boolean | undefined,
  useFHSSchema: boolean | undefined,
  presentation: ResolvedFieldPresentation,
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
      <ResolvedFieldLabel presentation={presentation} useFHSSchema={useFHSSchema ?? false} />
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
  propertyName: string,
  elementType?: string,
  subtype?: string,
  opaqueFabricVariant?: OpaqueFabricVariant,
): unknown {
  // R4.6b-2: takes the property name outright. It used to take the control's dot-joined
  // `path` and recover the name as `path.split('.').pop()` — the same guess every control
  // was making separately, and the same one a '.'-bearing leaf key breaks. The caller has
  // the real key now (see `AdvancedControlProps.propKey`).
  if (!defaults || !propertyName) {
    return undefined;
  }
  const defaultsRecord = readRecord(defaults);

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
  elementType: string | undefined,
  subtype: string | undefined,
  opaqueFabricVariant: OpaqueFabricVariant | undefined,
  propKey: string,
  config: RendererConfig | undefined,
): unknown {
  if (propKey === 'security_risk' && elementType === 'BuildingElementTransparent') {
    return windowSecurityRiskDefaultForElement(
      elementStoreyInput(config?.currentElementData),
      floorStoreyInputs(config?.floors),
    );
  }
  // R4.6b-2: `path` is gone from this signature. It carried exactly one thing into
  // `getDefaultValue` — the leaf key — which this function was already being handed
  // separately as `propKey`, spelled two different ways off the same string.
  return getDefaultValue(defaults, defaultsLookup, propKey, elementType, subtype, opaqueFabricVariant);
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

/**
 * Reads the value at a control's dot-joined `path` inside a baseline record, reporting
 * PRESENCE separately from value — `exists` is what lets System Sample mode tell "the
 * preset omits this key" from "the preset sets it to nothing" (see
 * `computeFieldPresentationState`, the only caller).
 *
 * R4.6b-2: the per-segment `decodeURIComponent` this used to carry is GONE. It was a
 * JsonForms-era artifact — that path's own scope handling percent-escaped tokens — and
 * since R4.3b every producer of a control `path` in this codebase joins DECODED
 * segments: `renderControlForProperty` builds it from `segmentsFromLayoutScope`
 * (RFC-6901 tokens, `~1`/`~0`, decoded by `decodePointerToken`), from a literal
 * `schema.properties` key, or from a web builder's dot-joined `pathOverride`. Swept both
 * repos: the only `encodeURIComponent` producers are element-visibility keys, thermal-bridge
 * detail contracts and parent-repo file ids/URLs, none of which reaches a control path.
 * Leaving the decode in was not neutral: a raw data key containing a legal percent
 * sequence (`"a%20b"`) would have been silently rewritten to a different key before the
 * lookup, so this deletes a latent corruption rather than tidying a no-op. Deliberately
 * NOT rebased onto `getAtPath` (`../lib/jsonTypes`): that walker answers "what value",
 * this one answers "was the key there at all", and collapsing the two would lose the
 * distinction System Sample mode is built on.
 */
function readValueAtDataPath(
  root: unknown,
  path: string,
): { exists: boolean; value: unknown } {
  if (!root || typeof root !== 'object' || Array.isArray(root) || !path) {
    return { exists: false, value: undefined };
  }
  const segments = path.split('.').filter(Boolean);
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

/**
 * True when the resolved schema wants an object/array rather than a scalar, i.e. the
 * row is a JSON blob edited as text. Read off the top-level `type` and off any
 * `anyOf`/`oneOf` branch, because HEM writes both shapes.
 */
function schemaIsJsonLike(s: JsonRecord): boolean {
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
  return expectsObject || expectsArray;
}

/** Everything the Advanced Fields controls derive identically from their props. */
type AdvancedControlPreamble = {
  cfg: RendererConfig;
  /** Resolved schema node for this property (uischema `schemaOverride` wins). */
  s: JsonRecord;
  isCompact: boolean;
  elementType: string | undefined;
  subtype: string | undefined;
  opaqueFabricVariant: OpaqueFabricVariant | undefined;
  isJsonLike: boolean;
  valueString: string;
  fieldPresentation: ResolvedFieldPresentation;
  fieldUnit: string | undefined;
  indicatorMessages: readonly string[] | undefined;
  hasEvidence: boolean;
  defaultValue: unknown;
  fieldSource: FieldSourceInfo;
  statusPillType: StatusPillType;
  statusPillLabelOverride: string | undefined;
  isCustom: boolean;
  showReset: boolean;
  isRuField: boolean;
  isGroundUField: boolean;
  groundUComputedWPerM2K: number | null | undefined;
};

/**
 * The ~25 lines every Advanced Fields control opened with, written once.
 *
 * R4.6b-1 (audit finding 2): TextControl, NumberControl, BooleanControl and
 * EnumControl each carried their own copy of this derivation, plus four copies of the
 * `systemSampleMode` "Preset" status-pill ternary. Copies drift, and these had: only
 * Number and Enum resolved their label from the real property key before this slice,
 * Text/Boolean reverse-engineered it from the display label instead; and the status
 * pill was spelled two different ways (`presentation.statusPillType` in Boolean/Enum,
 * an explicit `getStatusPillType` call in Text/Number) that happened to agree.
 *
 * R4.6b-2: `propKey` is now READ FROM PROPS, not derived. This hook opened with
 * `path?.split('.')?.pop()`, which is the whole reason the key could ever be wrong: the
 * walk that mounted the control already held the decoded leaf segment and then threw it
 * away by joining, leaving each control to guess it back. The guess fails for a leaf key
 * containing a '.', which a CSV-derived System plant key can be. The preamble no longer
 * RETURNS `propKey` either — the caller passed it in, so handing it back was surface with
 * two spellings of one value.
 *
 * A HOOK, for exactly one reason: the SCHEMA PORT (see below). Everything else here is
 * pure derivation from props, and the two store reads (`useDefaultValues`,
 * `useDefaultsLookup`) still stay at each control's own top level and are passed in, so
 * each control keeps its own `useState`/`useNumericDraftInput` calls where a reader
 * expects to find them. All five call sites invoke this unconditionally as their first
 * statement, so the rules-of-hooks contract holds.
 *
 * SCHEMA PORT CONTRACT — `cfg.schemaPort ?? useGeometrySchemaPort()`, resolved ONCE here
 * and passed down to `resolveAdvancedControlFieldPresentation`:
 *  - a host that puts a port in `config` wins outright (the community Advanced Fields
 *    grid does this in `AdvancedFieldsEditor.tsx`, with the same port the context
 *    carries, so nothing changes there);
 *  - otherwise the ambient `GeometryEditorServicePortsProvider` port applies (the parent
 *    repo's snippet editors mount `DirectSpecFields` with `config={{}}` INSIDE such a
 *    provider — before this fallback existed those rows silently resolved against
 *    `unavailable`);
 *  - `unavailableGeometrySchemaPort` only when neither exists, which is precisely what
 *    `useGeometrySchemaPort()` returns with no provider above it, so a portless mount is
 *    byte-identical to before.
 * This is also a deliberate UPGRADE for Number/Enum rows in portless-config hosts: they
 * were already on the informed path and therefore already read `unavailable` there, even
 * before R4.6b-1 moved Text/Boolean/WindowPartList onto it. Text/Boolean/WindowPartList
 * previously reached the context port via `ProviderFieldLabelWithTooltip`; without this
 * fallback the R4.6b-1 move would have taken that away from them.
 *
 * THREE PREVIOUSLY-DIVERGENT LINES ARE UNIFIED HERE, all verified inert by the rendered-
 * row sweep in `AdvancedFieldsEditor.directRender.test.tsx`:
 *  - `statusPillType` now always goes through the ground-U-aware `getStatusPillType`
 *    branch (Boolean/Enum used `computeFieldPresentationState`'s own result). Identical
 *    output: `isGroundUField` requires `BuildingElementGround.u_value`, a NUMBER, which
 *    only ever reaches NumberControl, so the extra argument is `undefined` for
 *    Boolean/Enum and the two expressions collapse to the same call.
 *  - `isCustom` now always subtracts `matchesGroundCalc`, for the same reason.
 *  - `isJsonLike` now always comes from `schemaIsJsonLike(s)`. Number, Boolean and Enum
 *    each hard-coded `false` into `computeFieldPresentationState` (only Text and
 *    WindowPartList computed it), which is a claim about the schema, not about the
 *    control. Inert across both published schemas as swept: exactly one node routes to a
 *    non-text control AND is json-like — FHS `Zone.additionalProperties.ThermalBridging`,
 *    `type: ["object","number"]` — and no swept route mounts it. It is reachable in
 *    principle through `SnippetEditor`/`DirectSpecFields`, and the unified semantics are
 *    the INTENDED ones: `isJsonLike` is what makes `valuesEquivalent` compare a value to
 *    its default by `JSON.stringify` rather than `String()`, and what makes
 *    `isMeaningfulExplicitValue` read an empty `{}`/`[]` as unset. Both questions are
 *    answered by the schema, not by which control the picker happened to choose.
 * Unifying beats a `groundAware: boolean` flag that only one caller could ever set.
 */
function useAdvancedControlPreamble(
  props: Pick<AdvancedControlProps, 'data' | 'path' | 'propKey' | 'label' | 'schema' | 'uischema' | 'config'>,
  defaults: unknown,
  defaultsLookup: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
): AdvancedControlPreamble {
  const contextSchemaPort = useGeometrySchemaPort();
  const { data, path, propKey, label, schema, uischema, config } = props;
  const cfg = rendererConfig(config);
  const schemaPort = cfg.schemaPort ?? contextSchemaPort;
  const s = schemaWithOverride(uischema, schema);
  const elementType = cfg.elementType;
  const subtype = cfg.subtype;
  const opaqueFabricVariant = cfg.opaqueFabricVariant;
  const isJsonLike = schemaIsJsonLike(s);
  const groundUComputedWPerM2K = cfg.groundUComputedWPerM2K;
  const isGroundUField = isGroundUValueField(propKey, elementType);

  const fieldPresentation = resolveAdvancedControlFieldPresentation(label, propKey, s, cfg, schemaPort);
  const defaultValue = getAdvancedDefaultValue(
    defaults,
    defaultsLookup,
    elementType,
    subtype,
    opaqueFabricVariant,
    propKey,
    cfg,
  );
  const state = computeFieldPresentationState({
    data,
    isJsonLike,
    fieldSource: resolveFieldSource(propKey, defaultValue, cfg),
    config: cfg,
    path,
  });
  const fieldSource = state.fieldSource;
  const groundPillArg = isGroundUField ? { isGroundUField: true, groundUComputedWPerM2K } : undefined;
  const statusPillType = cfg.systemSampleMode
    ? state.statusPillType
    : getStatusPillType(data, fieldSource.value, fieldSource.kind, isJsonLike, groundPillArg);
  const matchesGroundCalc =
    isGroundUField && groundAdvancedUValueMatchesComputed(data, groundUComputedWPerM2K);

  return {
    cfg,
    s,
    isCompact: Boolean(cfg.compact),
    elementType,
    subtype,
    opaqueFabricVariant,
    isJsonLike,
    valueString: advancedControlValueString(data, isJsonLike),
    fieldPresentation,
    fieldUnit: fieldUnitForAdornment(fieldPresentation),
    indicatorMessages: fieldIndicatorsFor(cfg, propKey),
    hasEvidence: hasEvidenceFor(cfg, propKey),
    defaultValue,
    fieldSource,
    statusPillType,
    statusPillLabelOverride:
      cfg.systemSampleMode && statusPillType === 'default-used' ? 'Preset' : undefined,
    isCustom: state.isCustom && !matchesGroundCalc,
    showReset: state.showReset,
    isRuField: isRuUnheatedSpaceField(propKey),
    isGroundUField,
    groundUComputedWPerM2K,
  };
}

/**
 * Text shown in the input for `data`. A JSON-blob row stringifies its value and treats
 * an empty array/object as "no data" (that is what makes an unset `shading: []` render
 * as a placeholder rather than as `[]`); a scalar row is plain `String(data)`.
 */
function advancedControlValueString(data: unknown, isJsonLike: boolean): string {
  if (data === undefined || data === null) return '';
  if (!isJsonLike) return String(data);
  if (Array.isArray(data)) return data.length === 0 ? '' : safeJsonStringify(data);
  if (typeof data === 'string') return data;
  if (typeof data === 'object') return Object.keys(data).length === 0 ? '' : safeJsonStringify(data);
  return safeJsonStringify(data);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
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
  propKey,
  label,
  schema,
  uischema,
  config,
}) => {
  const defaults = useDefaultValues();
  const defaultsLookup = useDefaultsLookup();
  // Uses only the label/indicator half of the preamble: the row is a repeating editor
  // with no single value, so it has no status pill of its own (`'default-used'` is
  // hard-coded below) and no defaults/reset affordance.
  const {
    cfg,
    isCompact,
    elementType,
    fieldPresentation,
    indicatorMessages,
    hasEvidence,
  } = useAdvancedControlPreamble({ data, path, propKey, label, schema, uischema, config }, defaults, defaultsLookup);
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
      indicatorMessages,
      hasEvidence,
      'default-used',
      undefined,
      cfg.useFHSSchemaForValidation,
      fieldPresentation,
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
  indicatorMessages: readonly string[] | undefined,
  hasEvidence: boolean | undefined,
  statusPillType: StatusPillType,
  statusPillLabelOverride: string | undefined,
  useFHSSchema: boolean | undefined,
  presentation: ResolvedFieldPresentation,
): React.ReactNode {
  return (
    <div style={ADVANCED_CTRL_LABEL_ROW}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {renderFieldLabelWithIndicator(indicatorMessages, hasEvidence, useFHSSchema, presentation)}
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

/**
 * Copies the text an empty JSON-blob row is showing as its placeholder. One component
 * for both wordings — R4.6b-1 folded two byte-identical copies of this markup (the
 * only difference being "Copy default" vs "Copy example") into this parameterised one.
 */
function CopyPlaceholderButton({ kind, text }: { kind: 'default' | 'example'; text: string }) {
  const wording = kind === 'default' ? 'Copy default' : 'Copy example';
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(text)}
      className="btn btn-ghost btn-sm element-editor-input-action element-editor-input-action--icon"
      title={wording}
      aria-label={wording}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" strokeWidth="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2"/>
      </svg>
    </button>
  );
}

export const TextControl: React.FC<AdvancedControlProps> = ({ data, handleChange, path, propKey, label, schema, uischema, config }) => {
  const [localError, setLocalError] = useState<string | null>(null);
  const defaults = useDefaultValues();
  const defaultsLookup = useDefaultsLookup();
  const {
    cfg,
    s,
    isCompact,
    elementType,
    isJsonLike,
    valueString,
    fieldPresentation,
    indicatorMessages,
    hasEvidence,
    defaultValue,
    fieldSource,
    statusPillType,
    statusPillLabelOverride,
    isCustom,
    showReset,
    isRuField,
    isGroundUField,
    groundUComputedWPerM2K,
  } = useAdvancedControlPreamble({ data, path, propKey, label, schema, uischema, config }, defaults, defaultsLookup);
  const openRuCalculator = cfg.openRuCalculator;
  const openGroundUCalculator = cfg.openGroundUCalculator;
  // One derivation feeding both the input placeholder and the copy button beside it.
  // These were two copies of the same priority rule (configured default first, else a
  // schema-generated example), each calling `generateRobustPlaceholder` for itself.
  const defaultPlaceholder =
    defaultValue !== undefined && defaultValue !== null
      ? (typeof defaultValue === 'object' ? JSON.stringify(defaultValue) : String(defaultValue))
      : undefined;
  const examplePlaceholder =
    defaultPlaceholder === undefined
      ? generateRobustPlaceholder(propKey || '', s, schemaDefs(s.$defs) || schemaDefs(cfg.$defs))
      : undefined;
  const isBlank = valueString === '' || valueString === '{}' || valueString === '[]';

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
          // R4.5 FOLLOW-UP (R4.6a): this handler is what turns the typed text of a
          // JSON-blob row back into a real object/array before it is committed. It
          // used to open with `if (!elementType || !propKey) return;` — ABOVE the
          // parse — so a host that supplies neither never got a parse at all, and the
          // only thing that ever reached the data was the raw STRING written by
          // `onChange` above on every keystroke. web's `SnippetEditor` (parent repo)
          // is exactly that host: it mounts with `config={{}}`, so editing a snippet's
          // nested object wrote `{"orientation":"{\"add_degrees\":42}"}` — a
          // JSON-encoded string where an object belongs — instead of
          // `{"orientation":{"add_degrees":42}}`. Nothing about parsing needs
          // `elementType`/`propKey`; only `validateAdvancedFieldPrimitive` does. So
          // the guard moved down to the one thing it guards:
          //  - empty input unsets, host-independent (unchanged for the element editor,
          //    newly reachable for a config-less host) — but only when there is
          //    something to unset, see the next note;
          //  - the parse always runs, and invalid JSON always sets the local error;
          //  - WITH elementType+propKey: validate, commit only if valid — byte-identical
          //    to the previous behaviour on the Advanced Fields path;
          //  - WITHOUT them: commit the parsed value unvalidated, because there is no
          //    element context to validate against. Committing something correctly
          //    typed beats committing a string that is wrong in every host.
          //
          // R4.6a review round 1, SECOND behaviour change, called out rather than left
          // to ride: moving the guard down also exposed the empty-input branch to a
          // BARE FOCUS/BLUR. A JSON-blob row renders '' for absent data AND for an
          // empty `{}`/`[]` (see `valueString` above), so merely TABBING THROUGH such a
          // row reached `handleChange(path, undefined)` -> `setAtPath` -> a fresh
          // object identity -> `onDataChange`, marking the host dirty on a pure focus
          // event. `alreadyEmpty` below stops that. This was NOT introduced here: the
          // element editor, which always supplies `elementType`, has had the same
          // spurious dirty since the handler was written — tabbing through an unset
          // Advanced Fields blob row emitted a delete of a key that was not there. So
          // this fixes an existing bug on that path as well as the newly-exposed one,
          // and is a deliberate behaviour change on both. A genuine CLEAR still
          // unsets: `onChange` above has already written the empty STRING to the host
          // by blur time, and a string is not `alreadyEmpty`.
          onBlur={(e) => {
            if (!isJsonLike) return;
            const raw = e.currentTarget.value.trim();
            if (raw === '') {
              const alreadyEmpty =
                data === undefined ||
                data === null ||
                (Array.isArray(data) && data.length === 0) ||
                (isRecord(data) && Object.keys(data).length === 0);
              setLocalError(null);
              if (!alreadyEmpty) handleChange(path, undefined);
              return;
            }
            try {
              const parsed = JSON.parse(raw);
              if (elementType && propKey) {
                const res = validateAdvancedFieldPrimitive(cfg, elementType, propKey, parsed);
                setLocalError(res.valid ? null : (res.errors?.[0] ?? 'Invalid value'));
                if (res.valid) handleChange(path, parsed);
                return;
              }
              setLocalError(null);
              handleChange(path, parsed);
            } catch (err) {
              setLocalError(`Invalid JSON: ${errorMessageFromUnknown(err)}`);
            }
          }}
          error={undefined}
          size="md"
          helperText={undefined}
          placeholder={isBlank ? (defaultPlaceholder ?? examplePlaceholder) : undefined}
          className={isCustom ? 'custom-value' : ''}
        />
        {localError && (<div style={{ color: 'var(--error)', fontSize: 12, marginTop: 4 }}>{localError}</div>)}
      </>,
      [
        !isRuField && !isGroundUField && isBlank && (
          defaultPlaceholder !== undefined
            ? <CopyPlaceholderButton key="copy-default" kind="default" text={defaultPlaceholder} />
            : examplePlaceholder
              ? <CopyPlaceholderButton key="copy-example" kind="example" text={examplePlaceholder} />
              : null
        ),
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
      indicatorMessages,
      hasEvidence,
      statusPillType,
      statusPillLabelOverride,
      cfg.useFHSSchemaForValidation,
      fieldPresentation,
    ),
    );
};

export const NumberControl: React.FC<AdvancedControlProps> = ({ data, handleChange, path, propKey, label, schema, uischema, config }) => {
  const [localError, setLocalError] = useState<string | null>(null);
  const defaults = useDefaultValues();
  const defaultsLookup = useDefaultsLookup();
  const {
    cfg,
    s,
    isCompact,
    elementType,
    subtype,
    valueString,
    fieldPresentation,
    fieldUnit,
    indicatorMessages,
    hasEvidence,
    defaultValue,
    fieldSource,
    statusPillType,
    statusPillLabelOverride,
    isCustom,
    showReset: showFieldSourceReset,
    isRuField,
    isGroundUField,
    groundUComputedWPerM2K,
  } = useAdvancedControlPreamble({ data, path, propKey, label, schema, uischema, config }, defaults, defaultsLookup);
  const openRuCalculator = cfg.openRuCalculator;
  const openGroundUCalculator = cfg.openGroundUCalculator;
  const resyncSuspendedThermalTransmWalls = cfg.resyncSuspendedThermalTransmWalls;
  const suspendedThermalTransmWallsAutoValue = cfg.suspendedThermalTransmWallsAutoValue;
  const suspendedThermalTransmWallsAutofillSources = cfg.suspendedThermalTransmWallsAutofillSources ?? [];
  const focusSourceElement = cfg.focusSourceElement;
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
      indicatorMessages,
      hasEvidence,
      statusPillType,
      statusPillLabelOverride,
      cfg.useFHSSchemaForValidation,
      fieldPresentation,
    ),
  );
};

export const BooleanControl: React.FC<AdvancedControlProps> = ({ data, handleChange, path, propKey, label, schema, uischema, config }) => {
  const defaults = useDefaultValues();
  const defaultsLookup = useDefaultsLookup();
  // No `elementType`: R4.6b-2's label-row change took its last reader in this control
  // (the deleted label-only fallback arm). A checkbox validates nothing per-element.
  const {
    cfg,
    isCompact,
    fieldPresentation,
    indicatorMessages,
    hasEvidence,
    defaultValue,
    fieldSource,
    statusPillType,
    statusPillLabelOverride,
    isCustom,
    showReset,
  } = useAdvancedControlPreamble({ data, path, propKey, label, schema, uischema, config }, defaults, defaultsLookup);

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
      indicatorMessages,
      hasEvidence,
      statusPillType,
      statusPillLabelOverride,
      cfg.useFHSSchemaForValidation,
      fieldPresentation,
    ),
  );
};

export const EnumControl: React.FC<AdvancedControlProps> = ({ data, handleChange, path, propKey, label, errors, schema, uischema, config, enabled }) => {
  const defaults = useDefaultValues();
  const defaultsLookup = useDefaultsLookup();
  const {
    cfg,
    s,
    isCompact,
    elementType,
    valueString,
    fieldPresentation,
    fieldUnit: resolvedFieldUnit,
    indicatorMessages,
    hasEvidence,
    defaultValue,
    fieldSource,
    statusPillType,
    statusPillLabelOverride,
    isCustom,
    showReset,
  } = useAdvancedControlPreamble({ data, path, propKey, label, schema, uischema, config }, defaults, defaultsLookup);
  const fromEnum = Array.isArray(s.enum) ? s.enum : null;
  const fromOneOf = schemaAlternatives(s, 'oneOf');
  const fromAnyOf = schemaAlternatives(s, 'anyOf');

  let options: { value: string; label: string }[] = [];
  const optionDescriptions = new Map<string, string>();
  let coerceType: 'string' | 'number' | 'boolean' | undefined;

  // Check if this is junction_type for ThermalBridgeLinear - use descriptions in labels.
  //
  // R4.6b-2: the leaf test reads `propKey` instead of re-splitting `path` on `/#.` and
  // taking the last piece — the fourth and last of this file's path-parsing derivations.
  // Provably identical here, not merely usually so: the only inputs where the split's last
  // piece is 'junction_type' while `propKey` is not are keys that CONTAIN 'junction_type'
  // after a '.', '/' or '#', and every one of those already satisfies the `includes` arm
  // this line has always carried for a full-path scope.
  const isJunctionTypeField = propKey === 'junction_type' || path.includes('junction_type');
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
  const fieldUnit = coerceType === 'number' ? resolvedFieldUnit : undefined;

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
 *
 * R4.6b-2 MOVE NOTE: `schemaTypeList`, `schemaHasEnum`, `schemaHasConstAlternatives` and
 * their shared `schemaAlternatives` helper used to live in this file too, exported for a
 * SIBLING COMPONENT (`DirectAdvancedFields.tsx`'s control picker) to import — the only
 * reason they were exported at all. They are now `../lib/schemaShape`, which also owns the
 * non-emptiness rule the picker used to re-apply on top of them; this file imports the two
 * it still uses (`schemaAlternatives` for `schemaIsJsonLike` and `EnumControl`'s option
 * list, `schemaTypeList` for the integer check below) and exports neither.
 */
function schemaHasIntegerType(schema: unknown): boolean {
  return schemaTypeList(readRecord(schema)).includes('integer');
}
