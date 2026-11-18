// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useState } from 'react';
import { MASS_CLASS_LABELS } from '../lib/assemblyAppliedUi';
import { StandardInput } from './StandardInput';
import { ResetFieldButton } from './ResetFieldButton';
import { numericInputAttributesFromSchema, useNumericDraftInput } from './numericDraftInput';
import { StandardDropdown } from './StandardDropdown';
import { StandardControlShell } from './StandardControlShell';
import { DefaultNote, SourceNote } from './FieldSource';
import { formatSourceValue } from '../lib/fieldSource';
import { ValidationIndicator } from './ValidationIndicator';
import { generateRobustPlaceholder } from '../lib/schemaPlaceholders';
import { getSchemaParamIdForField } from '../lib/fieldTooltipMap';
import {
  fieldUnitForAdornment,
  resolveFieldPresentation,
  sentenceCaseLabel,
  type ResolvedFieldPresentation,
} from '../lib/fieldPresentation';
import { JUNCTION_TYPE_DESCRIPTIONS } from '../lib/simplifiedFabricMap';
import { useGeometryStore } from '../stores/geometryStore';
import type { DefaultsLookup, OpaqueFabricVariant } from '../lib/defaultsCache';
import { usesGroundThermalTransmWallsAutofill } from '../lib/groundFloorSubtype';
import { errorMessageFromUnknown, isRecord, readRecord, type JsonRecord } from '../lib/jsonTypes';
import { schemaAlternatives, schemaTypeList } from '../lib/schemaShape';
import type { Element } from '../geometry/types';
import {
  buildConvertToSingleOpeningPatch,
  isPhysicalPart,
  type WindowOpeningSource,
} from '../lib/windowOpenings';
import type { SchemaNode } from '../lib/schemaTypes';
import { useGeometrySchemaPort } from '../../../geometry-editor-host/src/editorServicePorts';
import { targetSchemaMode, type GeometrySchemaPort } from '../../../geometry-editor-host/src/schemaPort';
import {
  WindowDetailChip,
  WindowDetailCollectionShell,
  WindowDetailMiniButton,
} from './WindowDetailControls';
import { ResolvedFieldLabel } from './ResolvedFieldLabel';
import { getDefaultValue, resolveFieldSource, type FabricPresetSource, type FieldSourceInfo } from '../lib/fieldDefault';
import { resolveVentilationZoneBaseDrawingZ } from '../lib/effectiveDwellingDetails';

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
  /** The fabric preset values this element takes (they read as its default), and its Fabric row's field key. */
  fabricPresetSource?: FabricPresetSource;
  fabricRowField?: string;
  compact?: boolean;
  tableCell?: boolean;
  validateValue?: (value: unknown) => { valid: boolean; errors?: readonly string[] };
  elementType?: string;
  renderEvidence?: (fieldKey: string) => React.ReactNode;
  fieldIndicators?: Readonly<Record<string, readonly string[]>>;
  focusSourceElement?: (elementId: string) => void;
  groundUComputedWPerM2K?: number | null;
  /** The converter works a blank ground U-value out with the floor calculation (no construction bands). */
  groundUFromCalculation?: boolean;
  /** The converter derives this floor's blank U-value, but this host has no calculator to show the number. */
  groundUDerivedWithoutNumber?: boolean;
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
  /** The target's default for a blank field of this element, by field key (EPC conversion). */
  derivedDefaults?: Readonly<Record<string, unknown>>;
  /** Fields with no default here whatever the defaults file says (a products target's tank location). */
  noDefaultFields?: ReadonlySet<string>;
  /** Where a `derivedDefaults` value comes from, by field key ("from the colour"), in place of "default". */
  derivedSourceNotes?: Readonly<Record<string, string>>;
  /** A control shown at the right of one field's label row (the U-value or resistance switch). */
  labelAdornment?: Readonly<{ field: string; node: React.ReactNode }>;
  systemSampleMode?: boolean;
  systemSamplePathSegments?: string[];
  /** Default products the target picks, by the model pointer of the plant's `product_id`. */
  defaultProducts?: Readonly<Record<string, unknown>>;
  useFHSSchemaForValidation?: boolean;
};

/**
 * Props consumed by the direct controls. `DirectAdvancedFields` and `DirectSpecFields`
 * supply these values; metadata unused by controls is omitted from this local type.
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

function fieldIndicatorsFor(
  config: RendererConfig,
  propKey: string | undefined,
): readonly string[] | undefined {
  return propKey ? config.fieldIndicators?.[propKey] : undefined;
}

function evidenceLineFor(config: RendererConfig, propKey: string | undefined): React.ReactNode {
  return propKey ? config.renderEvidence?.(propKey) : null;
}

function coerceDropdownValue(
  raw: string,
  coerceType: 'string' | 'number' | 'boolean' | undefined,
): unknown {
  if (coerceType === 'number') return raw === '' ? undefined : Number(raw);
  if (coerceType === 'boolean') return raw === '' ? undefined : raw === 'true';
  return raw;
}

/** Per-field validation through the effective Core or FHS geometry schema port. */
// eslint-disable-next-line react-refresh/only-export-components -- data-layer validation helper shared with DirectAdvancedFields.
export function validateAdvancedFieldPrimitive(
  config: RendererConfig | undefined,
  elementType: string | undefined,
  propKey: string | undefined,
  value: unknown,
): { valid: boolean; errors?: readonly string[] } {
  if (config?.validateValue) return config.validateValue(value);
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
  // A hand-written label: shown in sentence case, looked up as written.
  return <ResolvedFieldLabel presentation={{ ...presentation, label: sentenceCaseLabel(presentation.label) }} useFHSSchema={useFHSSchema} />;
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
  const schemaPort = useGeometrySchemaPort();
  return renderFieldLabelWithTooltipForMode(
    label,
    elementType,
    useFHSSchema ?? targetSchemaMode(schemaPort) === 'fhs',
    schemaPort,
  );
};

// Label helper for hand-rendered field groups; the schema mode is explicit when supplied
// and otherwise comes from the nearest provider-backed store.
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
  evidenceLine: React.ReactNode,
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
      {evidenceLine}
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

function getAdvancedDefaultValue(
  defaults: unknown,
  defaultsLookup: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
  elementType: string | undefined,
  subtype: string | undefined,
  opaqueFabricVariant: OpaqueFabricVariant | undefined,
  propKey: string,
  config: RendererConfig | undefined,
): unknown {
  if (config?.defaultProducts && config.systemSamplePathSegments) {
    const own = config.defaultProducts[`/${config.systemSamplePathSegments.map((part) => part.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`];
    if (own !== undefined) return own;
  }
  if (config?.noDefaultFields?.has(propKey)) return undefined;
  if (config?.derivedDefaults && config.derivedDefaults[propKey] !== undefined) return config.derivedDefaults[propKey];
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
  // Compared at the precision "Use calculation: X" shows (formatSourceValue), so 0.13 matches 0.1296.
  return cur != null && formatSourceValue(cur) === formatSourceValue(u);
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


type FieldPresentationState = {
  fieldSource: FieldSourceInfo;
  /** System Sample mode: the source is the chosen preset, which reads as the default. */
  isSamplePreset: boolean;
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
  pathSegments?: string[],
): { exists: boolean; value: unknown } {
  if (!root || typeof root !== 'object' || Array.isArray(root) || !path) {
    return { exists: false, value: undefined };
  }
  const segments = pathSegments ?? path.split('.').filter(Boolean);
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
    const baseline = readValueAtDataPath(config.systemSampleBaselineExtraJson, path, config.systemSamplePathSegments);
    if (baseline.exists) return { fieldSource: { value: baseline.value, kind: 'assembly' }, isSamplePreset: true };
    // The preset omits this key: blank follows it, a stated value can go back to blank.
    return {
      fieldSource: isMeaningfulExplicitValue(data, isJsonLike) ? { value: undefined, kind: 'assembly' } : fieldSource,
      isSamplePreset: true,
    };
  }
  return { fieldSource, isSamplePreset: false };
}

/**
 * Where an Advanced Fields value comes from, as the one source treatment (`FieldSource.tsx`):
 * a quiet note while it follows its source, one "↺ Use …" control once it differs, and
 * nothing for an entered value with no source to go back to. There is no "Custom" chip:
 * entered is the normal state. A stated value equal to its default reads as the default
 * (grey, "default"): no authored marker exists for HEM inputs, so equal means default.
 */
function resolveAdvancedFieldSource(args: {
  data: unknown;
  isJsonLike: boolean;
  fieldSource: FieldSourceInfo;
  isSamplePreset: boolean;
  path: string;
  handleChange: (path: string, value: unknown) => void;
  fieldLabel: string;
  unit: string | undefined;
  isGroundUField: boolean;
  groundUComputedWPerM2K: number | null | undefined;
  groundUFromCalculation: boolean;
  groundUDerivedWithoutNumber: boolean;
  openGroundUCalculator: (() => void) | undefined;
  fabricRowField: string | undefined;
  derivedNote?: string;
}): { source: React.ReactNode; followsSource: boolean } {
  const { data, isJsonLike, fieldSource, isSamplePreset, path, handleChange, fieldLabel, unit } = args;
  const hasExplicit = isMeaningfulExplicitValue(data, isJsonLike);
  const withUnit = (value: number) => `${formatSourceValue(value)}${unit ? ` ${unit}` : ''}`;
  const sourceButton = (label: string, value: unknown, shownValue?: string, quiet?: boolean) => (
    <ResetFieldButton
      align="note"
      quiet={quiet}
      label={shownValue ? `${label}: ${shownValue}` : label}
      title={shownValue ? `${label}: ${shownValue}` : label}
      ariaLabel={`${fieldLabel}: ${label.toLowerCase()}${shownValue ? `, ${shownValue}` : ''}`}
      onClick={(e) => {
        e.preventDefault();
        handleChange(path, value);
      }}
    />
  );

  if (args.isGroundUField && fieldSource.kind === 'default') {
    const u = args.groundUComputedWPerM2K;
    if (typeof u === 'number' && Number.isFinite(u) && u > 0) {
      const note = <SourceNote link="from the floor calculation" onGo={args.openGroundUCalculator} title="Open the floor calculation" />;
      if (args.groundUFromCalculation && !hasExplicit) return { source: note, followsSource: false };
      if (groundAdvancedUValueMatchesComputed(data, u)) return { source: note, followsSource: true };
      const uRounded = Number(u.toFixed(4));
      // A blank U-value takes the calculation; under construction bands it is stated, over the age band.
      return {
        source: sourceButton('Use calculation', args.groundUFromCalculation ? undefined : uRounded, withUnit(uRounded)),
        followsSource: false,
      };
    }
    if (args.groundUDerivedWithoutNumber) {
      return hasExplicit
        ? { source: sourceButton('Use calculation', undefined), followsSource: false }
        : { source: <SourceNote>from the floor calculation</SourceNote>, followsSource: false };
    }
  }

  const sourceValue = fieldSource.value;
  const hasSource = isMeaningfulExplicitValue(sourceValue, isJsonLike);
  const isAssembly = fieldSource.kind === 'assembly' && !isSamplePreset;
  if (!hasSource) {
    if (!hasExplicit) return { source: null, followsSource: false };
    // Sample preset that omits the key: a stated value can go back to the preset's blank.
    // No default at all: blank is still a choice HEM takes (not stated), so it stays reachable.
    return isSamplePreset
      ? { source: sourceButton('Use default', undefined), followsSource: false }
      : { source: sourceButton('Clear', undefined, undefined, true), followsSource: false };
  }
  const blankFollowsSource = fieldSource.kind === 'default';
  const matches = hasExplicit ? valuesEquivalent(data, sourceValue, isJsonLike) : blankFollowsSource;
  if (matches) {
    return {
      source: isAssembly ? <SourceNote>from the assembly</SourceNote> : args.derivedNote ? <SourceNote>{args.derivedNote}</SourceNote> : <DefaultNote field={args.fabricRowField} preset={fieldSource.preset} />,
      followsSource: hasExplicit,
    };
  }
  const shown = typeof sourceValue === 'number' ? withUnit(sourceValue) : undefined;
  return isAssembly || isSamplePreset
    ? { source: sourceButton(isAssembly ? 'Use assembly' : 'Use default', sourceValue, shown), followsSource: false }
    : { source: sourceButton('Use default', undefined, shown), followsSource: false };
}

/**
 * True when the resolved schema wants an object/array rather than a scalar, i.e. the
 * row is a JSON blob edited as text. Read off the top-level `type` and off any
 * `anyOf`/`oneOf` branch, because HEM writes both shapes.
 */
// eslint-disable-next-line react-refresh/only-export-components -- schema predicate shared with DirectAdvancedFields.
export function schemaIsJsonLike(s: JsonRecord): boolean {
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
  /**
   * The EFFECTIVE port this row's presentation was resolved against — `cfg.schemaPort`
   * if the host supplied one, otherwise the ambient provider's, otherwise unavailable
   * (see the SCHEMA PORT CONTRACT below). Returned so that a control needing a SECOND
   * resolution reads the same port as its own label instead of re-deciding.
   */
  schemaPort: GeometrySchemaPort;
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
  evidenceLine: React.ReactNode;
  defaultValue: unknown;
  fieldSource: FieldSourceInfo;
  /** The row's source note or "↺ Use …" control, for the label row. */
  source: React.ReactNode;
  /** A stated value equal to its source: it reads grey, like the placeholder. */
  followsSource: boolean;
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
 * R4.6b-2 returns that resolved port (see `AdvancedControlPreamble.schemaPort`) so the one
 * decision point actually covers every label in the row. `WindowPartListControl` resolves a
 * SECOND presentation for its per-part unit and was still reading
 * `cfg.schemaPort ?? unavailable` on its own — the one place where "which port does a
 * label read?" still had two answers.
 *
 * This is also a deliberate UPGRADE for Number/Enum rows in portless-config hosts: they
 * were already on the informed path and therefore already read `unavailable` there, even
 * before R4.6b-1 moved Text/Boolean/WindowPartList onto it. Text/Boolean/WindowPartList
 * previously reached the context port via `ProviderFieldLabelWithTooltip`; without this
 * fallback the R4.6b-1 move would have taken that away from them.
 *
 * The row's source (note or "↺ Use …") is resolved here too, once for every control, by
 * `resolveAdvancedFieldSource`; it replaced the per-control Custom/Calculated pill and reset.
 *
 * UNIFIED HERE, verified inert by the rendered-row sweep in
 * `AdvancedFieldsEditor.directRender.test.tsx`:
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
 */
function useAdvancedControlPreamble(
  props: Pick<AdvancedControlProps, 'data' | 'handleChange' | 'path' | 'propKey' | 'label' | 'schema' | 'uischema' | 'config'>,
  defaults: unknown,
  defaultsLookup: Pick<DefaultsLookup, 'getDefaultValueForElementField'>,
): AdvancedControlPreamble {
  const contextSchemaPort = useGeometrySchemaPort();
  const { data, handleChange, path, propKey, label, schema, uischema, config } = props;
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
    fieldSource: resolveFieldSource(propKey, defaultValue, cfg.assemblySourceValues, cfg.fabricPresetSource),
    config: cfg,
    path,
  });
  const fieldSource = state.fieldSource;
  const fieldUnit = fieldUnitForAdornment(fieldPresentation);
  const { source, followsSource } = resolveAdvancedFieldSource({
    data,
    isJsonLike,
    fieldSource,
    isSamplePreset: state.isSamplePreset,
    path,
    handleChange,
    fieldLabel: fieldPresentation.label ?? label,
    unit: fieldUnit,
    isGroundUField,
    groundUComputedWPerM2K,
    groundUFromCalculation: cfg.groundUFromCalculation === true,
    groundUDerivedWithoutNumber: cfg.groundUDerivedWithoutNumber === true,
    openGroundUCalculator: cfg.openGroundUCalculator,
    fabricRowField: cfg.fabricRowField,
    derivedNote: propKey ? cfg.derivedSourceNotes?.[propKey] : undefined,
  });
  const adornment = cfg.labelAdornment && cfg.labelAdornment.field === propKey ? cfg.labelAdornment.node : null;

  return {
    cfg,
    schemaPort,
    s,
    isCompact: Boolean(cfg.compact),
    elementType,
    subtype,
    opaqueFabricVariant,
    isJsonLike,
    valueString: advancedControlValueString(data, isJsonLike),
    fieldPresentation,
    fieldUnit,
    indicatorMessages: fieldIndicatorsFor(cfg, propKey),
    evidenceLine: evidenceLineFor(cfg, propKey),
    // A fabric preset value is the field's default: the converter gives it a blank field.
    defaultValue: fieldSource.preset ? fieldSource.value : defaultValue,
    fieldSource,
    source: adornment ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{source}{adornment}</span> : source,
    followsSource,
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

/**
 * `alignItems` is never `'flex-end'`: `StandardInput`/`StandardDropdown` render helper and
 * error text inside `main`, under the control, so bottom-aligning the actions drops them
 * below the control by that text's height. `'flex-start'` puts the actions (which are
 * `--form-input-height` tall, like the control) level with the control whatever renders
 * under it; `'center'` is for a `main` that is a single line, such as a checkbox label.
 */
function renderAdvancedFieldRow(
  propKey: string | undefined,
  isCompact: boolean,
  main: React.ReactNode,
  actions: React.ReactNode[],
  alignItems: 'flex-start' | 'center' = 'flex-start',
  actionsOffsetTop = 0,
  fullWidthHeader?: React.ReactNode,
) {
  const visibleActions = actions.filter(Boolean);
  // The control class options are long: give the select the full row and wrap the actions below it.
  const fullRowMain = propKey === 'ecodesign_control_class';
  const inputActionsRow = (
    <div
      style={{
        display: 'flex',
        flexWrap: fullRowMain ? 'wrap' : 'nowrap',
        alignItems,
        gap: '8px',
        width: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ flex: fullRowMain ? '1 1 100%' : 1, minWidth: 0 }}>{main}</div>
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

/**
 * The repeating window-part editor: one row per air-flow-path midpoint, edited RELATIVE to
 * the window base and stored in Vulcan's ground-relative editor coordinates. CSV export
 * converts it to the ventilation-zone-relative value required by HEM.
 *
 * Uses only the label/indicator half of the preamble — the row is a repeating editor with
 * no single value, so it has no status pill of its own (`'default-used'` is hard-coded
 * below) and no defaults/reset affordance.
 *
 * TWO PRESENTATIONS, ONE PORT (R4.6b-2). The per-part unit adornment comes from a SECOND
 * `resolveFieldPresentation` call, because the rows edit `mid_height_air_flow_path` while
 * this control is bound to `window_part_list`, an array whose own presentation says nothing
 * about its items' unit. That second call used to read
 * `cfg.schemaPort ?? unavailableGeometrySchemaPort` while the label above it followed
 * R4.6b-1's contract (config port -> ambient provider port -> unavailable), so in a host
 * that mounts with `config={{}}` inside a `GeometryEditorServicePortsProvider` — the parent
 * repo's snippet-editor shape — the two halves of one row read DIFFERENT ports, and this
 * half resolved against `unavailable`, which by its own availability gate asks the schema
 * nothing. Both now use the effective port the preamble resolved once, which is the whole
 * point of resolving it there.
 *
 * WHAT CHANGES ON SCREEN, MEASURED: nothing, on today's schemas. That presentation's only
 * consumer is `fieldUnitForAdornment`, and `mid_height_air_flow_path` carries a hardcoded
 * `units: 'm'` in `lib/schemaDescriptionOverrides.ts` that resolves with no port at all;
 * against the canonical port the same 'm' arrives from the schema description instead, so
 * the resolution SOURCE moves and the display does not. The change is still real and still
 * pinned (`__tests__/jsonformsRenderers.units.test.tsx`, "R4.6b-2"): the provider is now
 * ASKED about the item field, and a port whose schema-derived unit ever disagreed with the
 * override would produce a conflict here, which the old code could not have seen.
 */
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
  const {
    cfg,
    schemaPort,
    isCompact,
    elementType,
    fieldPresentation,
    indicatorMessages,
    evidenceLine,
  } = useAdvancedControlPreamble({ data, handleChange, path, propKey, label, schema, uischema, config }, defaults, defaultsLookup);
  // Second presentation, same port — see this component's docstring.
  const midpointPresentation = resolveFieldPresentation({
    mode: cfg.useFHSSchemaForValidation ? 'fhs' : 'core',
    propertyKey: 'mid_height_air_flow_path',
    elementType: elementType ?? 'BuildingElementTransparent',
    label: 'Window part midpoint (m)',
  }, schemaPort);

  const selection = useGeometryStore((state) => state.selection);
  const getElementById = useGeometryStore((state) => state.getElementById);
  const updateElement = useGeometryStore((state) => state.updateElement);
  const ventilationZoneBaseHeightM = useGeometryStore((state) =>
    resolveVentilationZoneBaseDrawingZ({
      zones: state.zones,
      elementsById: state.elementsById,
      elementIds: state.elementIds,
      spaceLabelsById: state.spaceLabelsById,
      spaceLabelIds: state.spaceLabelIds,
      complianceSettings: state.complianceSettings,
      floors: state.floors,
    }),
  );
  const currentElement =
    selection?.type === 'element' ? getElementById(selection.id) : null;

  const currentElementRecord = readRecord(currentElement);
  const baseHeightM = toFiniteNumber(currentElementRecord.base_height) ?? 0;
  const windowHeightM = toFiniteNumber(currentElementRecord.height) ?? 0;

  const physicalParts = Array.isArray(data) ? data.filter(isPhysicalPart) as Record<string, unknown>[] : [];
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

    const previousBaseHeightM = prevBaseHeightRef.current;
    if (Math.abs(previousBaseHeightM - baseHeightM) <= 1e-6) return;
    // Rebuilding from legacy rows would drop the physical parts.
    if (physicalParts.length > 0) {
      prevBaseHeightRef.current = baseHeightM;
      return;
    }

    const preservedRelRows = rows.map((row) => round2(
      row.mid_height_air_flow_path - previousBaseHeightM,
    ));
    const nextRows = buildWindowPartRowsFromRel(baseHeightM, preservedRelRows);
    prevBaseHeightRef.current = baseHeightM;

    if (!windowPartRowsEqual(rows, nextRows)) {
      handleChange(path, nextRows);
    }
  }, [baseHeightM, handleChange, path, physicalParts.length, rows, selection]);

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

  if (physicalParts.length > 0) {
    const physicalPartCount = Array.isArray(data) ? data.length : physicalParts.length;
    return renderAdvancedFieldRow(
      propKey,
      isCompact,
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, fontSize: 12 }}>
        <div style={{ whiteSpace: 'pre-line' }}>
          {physicalParts.map((part, idx) => (
            `Part ${idx + 1}: free height ${String(part.free_area_height ?? 'blank')} m, mid height ${String(part.mid_height ?? 'blank')} m, open area ${String(part.max_window_open_area ?? 'blank')} m²`
          )).join('\n')}
        </div>
        <div role="alert">This HEM version cannot use window parts with their own free height and open area.</div>
        {selection?.type === 'element' && currentElement ? (
          <div>
            <button
              type="button"
              className="btn btn-nav btn-small"
              onClick={() => updateElement(
                selection.id,
                buildConvertToSingleOpeningPatch(currentElement as unknown as WindowOpeningSource) as Partial<Element>,
              )}
            >
              Convert to a single opening
            </button>
            <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
              Part 1 becomes the whole window opening.{physicalPartCount > 1 ? ` ${physicalPartCount - 1} other ${physicalPartCount === 2 ? 'part is' : 'parts are'} removed.` : ''}
            </div>
          </div>
        ) : null}
      </div>,
      [],
      'flex-start',
      0,
      renderAdvancedFieldLabelRow(
        indicatorMessages,
        evidenceLine,
        null,
        cfg.useFHSSchemaForValidation,
        fieldPresentation,
      ),
    );
  }

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
          const zoneRelativeMidHeightM = round2(baseHeightM + relM - ventilationZoneBaseHeightM);
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
                Mid-height relative to ventilation zone base: {zoneRelativeMidHeightM} m
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
      evidenceLine,
      null,
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
  evidenceLine: React.ReactNode,
  source: React.ReactNode,
  useFHSSchema: boolean | undefined,
  presentation: ResolvedFieldPresentation,
): React.ReactNode {
  return (
    <div style={ADVANCED_CTRL_LABEL_ROW}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {renderFieldLabelWithIndicator(indicatorMessages, evidenceLine, useFHSSchema, presentation)}
      </div>
      {source ? <div style={{ flexShrink: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end', textAlign: 'right' }}>{source}</div> : null}
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
      {hasValue ? 'Edit calculation' : 'Calculate U-value'}
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
    evidenceLine,
    defaultValue,
    source,
    followsSource,
    isRuField,
    isGroundUField,
  } = useAdvancedControlPreamble({ data, handleChange, path, propKey, label, schema, uischema, config }, defaults, defaultsLookup);
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
            // Text never replaces an object: it would turn a structured input into a string.
            if (!isJsonLike && data !== null && typeof data === 'object') return;
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
          error={cfg.validateValue ? (localError ?? cfg.validateValue(data).errors?.[0]) : undefined}
          size="md"
          helperText={undefined}
          placeholder={isBlank ? (defaultPlaceholder ?? examplePlaceholderText(examplePlaceholder)) : undefined}
          className={followsSource ? 'field-value--source' : ''}
        />
        {!cfg.validateValue && localError && (<div style={{ color: 'var(--error)', fontSize: 12, marginTop: 4 }}>{localError}</div>)}
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
      ],
    'flex-start',
    0,
    renderAdvancedFieldLabelRow(
      indicatorMessages,
      evidenceLine,
      source,
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
    evidenceLine,
    defaultValue,
    source,
    followsSource,
    isRuField,
    isGroundUField,
  } = useAdvancedControlPreamble({ data, handleChange, path, propKey, label, schema, uischema, config }, defaults, defaultsLookup);
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
        <div className="field-source-note" style={{ marginTop: 6 }}>
          No adjacent wall U value available on this storey.
        </div>
      ) : null
    ) : null;

  // thermal_transm_walls follows the adjacent walls' area-weighted U unless stated otherwise.
  const thermalTransmWallSource =
    showSuspendedThermalTransmSyncReset && resyncSuspendedThermalTransmWalls ? (
      <ResetFieldButton
        align="note"
        title="Apply the area-weighted U of the adjacent walls listed below"
        ariaLabel={`${fieldPresentation.label ?? label}: use the walls, ${suspendedThermalTransmWallsAutoValue}`}
        label={`Use the walls: ${suspendedThermalTransmWallsAutoValue}${fieldUnit ? ` ${fieldUnit}` : ''}`}
        onClick={() => resyncSuspendedThermalTransmWalls()}
      />
    ) : suspendedThermalTransmWallsAutoValue != null ? (
      <SourceNote>from the walls</SourceNote>
    ) : (
      source
    );

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
  const fieldError = cfg.validateValue ? cfg.validateValue(numberDraftInput.inputValue.trim() === '' ? '' : Number(numberDraftInput.inputValue)).errors?.[0] : localError;
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
                aria-label={cfg.tableCell ? label : undefined}
                type="text"
                {...numberInputAttributes}
                value={numberDraftInput.inputValue}
                onChange={numberDraftInput.handleInputChange}
                onBlur={numberDraftInput.handleBlur}
                error={cfg.validateValue ? fieldError ?? undefined : undefined}
                size={cfg.tableCell ? "sm" : "md"}
                variant="ghost"
                unit={fieldUnit}
                helperText={undefined}
                placeholder={defaultValue !== undefined ? String(defaultValue) : undefined}
                className={followsSource ? 'field-value--source' : ''}
              />
              {!cfg.validateValue && fieldError && (
                <div style={{ color: 'var(--error)', fontSize: 12, marginTop: 4 }}>{fieldError}</div>
              )}
            </div>
          </div>
          {suspendedThermalTransmSourcesInfo}
        </>
      ) : (
        <>
          <StandardInput
            label={undefined}
                aria-label={cfg.tableCell ? label : undefined}
            type="text"
            {...numberInputAttributes}
            value={numberDraftInput.inputValue}
            onChange={numberDraftInput.handleInputChange}
            onBlur={numberDraftInput.handleBlur}
            error={cfg.validateValue ? fieldError ?? undefined : undefined}
            size={cfg.tableCell ? "sm" : "md"}
            variant="ghost"
            unit={fieldUnit}
            helperText={undefined}
            placeholder={defaultValue !== undefined ? String(defaultValue) : undefined}
            className={followsSource ? 'field-value--source' : ''}
          />
          {!cfg.validateValue && fieldError && (<div style={{ color: 'var(--error)', fontSize: 12, marginTop: 4 }}>{fieldError}</div>)}
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
    ],
    'flex-start',
    0,
    cfg.tableCell ? null : renderAdvancedFieldLabelRow(
      indicatorMessages,
      evidenceLine,
      isSuspendedGroundThermalTransmWallsFieldActive ? thermalTransmWallSource : source,
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
    evidenceLine,
    defaultValue,
    source,
  } = useAdvancedControlPreamble({ data, handleChange, path, propKey, label, schema, uischema, config }, defaults, defaultsLookup);

  return renderAdvancedFieldRow(
    propKey,
    isCompact,
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {/* Blank shows the default it takes; the label row says "default". */}
      <input
        type="checkbox"
        aria-label={fieldPresentation.label ?? label}
        checked={data === undefined || data === null || data === '' ? Boolean(defaultValue) : !!data}
        onChange={(e) => handleChange(path, e.currentTarget.checked)}
      />
    </label>,
    [],
    'center',
    0,
    renderAdvancedFieldLabelRow(
      indicatorMessages,
      evidenceLine,
      source,
      cfg.useFHSSchemaForValidation,
      fieldPresentation,
    ),
  );
};

/**
 * A schema example as the input shows it: a text example without JSON quotes, and no made-up
 * "example" for free text. The copy button keeps the JSON form.
 */
const examplePlaceholderText = (example: string | undefined): string | undefined => {
  if (!example?.startsWith('"')) return example;
  const text = JSON.parse(example) as string;
  return text === 'example' ? undefined : text;
};

/** Schema enum values that are engine codes, as an assessor reads them. */
const ENUM_VALUE_LABELS: Readonly<Record<string, string>> = {
  OutsideAir: 'Outside air',
  ExhaustAirMEV: 'Exhaust air (extract ventilation)',
  ExhaustAirMVHR: 'Exhaust air (MVHR)',
  ExhaustAirMixed: 'Exhaust air (mixed)',
  WaterGround: 'Ground water',
  WaterSurface: 'Surface water',
  HeatNetwork: 'Heat network',
  glycol25: 'Glycol, 25%',
  unknown: 'Not known',
  ...MASS_CLASS_LABELS,
};
/** MVHR and similar units are inside or outside the thermal envelope: say so. */
const ENVELOPE_LOCATION_KEYS: ReadonlySet<string> = new Set(['mvhr_location', 'location_mvhr']);
const enumOptionLabel = (propKey: string, value: string, fallback: string): string =>
  ENVELOPE_LOCATION_KEYS.has(propKey) && (value === 'inside' || value === 'outside')
    ? `${value === 'inside' ? 'Inside' : 'Outside'} the thermal envelope`
    : ENUM_VALUE_LABELS[value] ?? fallback;

/** A lower-case enum value as words with a capital (`other wet rooms`: "Other wet rooms"); any other value as written. */
const enumValueWords = (value: string): string =>
  /^[a-z][a-z0-9]*([_ -][a-z0-9]+)*$/.test(value) ? `${value[0].toUpperCase()}${value.slice(1).replace(/_/g, ' ')}` : value;

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
    evidenceLine,
    defaultValue,
    fieldSource,
    source,
    followsSource,
  } = useAdvancedControlPreamble({ data, handleChange, path, propKey, label, schema, uischema, config }, defaults, defaultsLookup);
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
      // Use description for junction types, otherwise the value in words (`optimised_inverter`: "Optimised inverter")
      let label = enumOptionLabel(propKey, value, enumValueWords(value));
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
          : enumOptionLabel(propKey, value, String(a.title ?? a.const));
        return { value, label };
      });
      const first = alts[0]?.const;
      coerceType = typeof first === 'number' ? 'number' : typeof first === 'boolean' ? 'boolean' : 'string';
    }
  }

  // A saved value the options do not list (a numeric a8/a9 areal capacity) stays visible.
  if (valueString !== '' && options.length > 0 && !options.some((o) => o.value === valueString)) {
    options = [...options, { value: valueString, label: valueString }];
  }

  const isReadOnly = uiOptions(uischema).readOnly === true || enabled === false;
  // Two values that read the same (a null and 'unknown' both "Not known") are one choice.
  options = options.filter((o, i) => options.findIndex((x) => x.label === o.label) === i || o.value === valueString);
  const selectedLabel = options.find((o) => o.value === valueString)?.label ?? valueString;
  const selectedOptionDescription = optionDescriptions.get(valueString);
  // The value shown as the default: a resolved `fieldSource` default, else the raw `defaultValue`.
  const effectiveDefaultForDisplay =
    fieldSource.kind === 'default' &&
    fieldSource.value !== undefined &&
    fieldSource.value !== null &&
    String(fieldSource.value) !== ''
      ? fieldSource.value
      : defaultValue;
  // An unset enum with a default shows that default, label-mapped, in the closed select
  // (mass class 'D' reads "D: Mass equally distributed"); the label row says "default".
  const placeholder =
    valueString === '' && effectiveDefaultForDisplay !== undefined
      ? (options.find((o) => o.value === String(effectiveDefaultForDisplay))?.label ??
          String(effectiveDefaultForDisplay))
      : undefined;
  const shouldShowOptionDescription = propKey !== 'ecodesign_control_class';
  // The default shows as the placeholder and the label row says "default", so no "Default: X" line.
  const helperText = shouldShowOptionDescription ? selectedOptionDescription : undefined;
  const fieldUnit = coerceType === 'number' ? resolvedFieldUnit : undefined;

  if (isReadOnly) {
    return renderAdvancedFieldRow(
      propKey,
      isCompact,
      <StandardControlShell
        unit={fieldUnit}
        size={cfg.tableCell ? "sm" : "md"}
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
      cfg.tableCell ? null : renderAdvancedFieldLabelRow(
        indicatorMessages,
        evidenceLine,
        source,
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
      aria-label={cfg.tableCell ? label : undefined}
      value={valueString}
      onChange={(v) => handleChange(path, coerceDropdownValue(v, coerceType))}
      options={options}
      error={errors || undefined}
      size={cfg.tableCell ? "sm" : "md"}
      variant="ghost"
      unit={fieldUnit}
      helperText={helperText}
      placeholder={placeholder}
      className={followsSource ? 'field-value--source' : ''}
    />,
    [],
    'flex-start',
    0,
    cfg.tableCell ? null : renderAdvancedFieldLabelRow(
      indicatorMessages,
      evidenceLine,
      source,
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
  /** What the group holds, in a few words, shown beside the label. */
  hint?: string;
  /** Each new non-empty value opens the group: a field inside it was asked for or needs a value. */
  reveal?: string;
  children: React.ReactNode;
}> = ({ label, count, openInitially, hint, reveal = '', children }) => {
  const [toggledOpen, setToggledOpen] = useState<boolean>(!!openInitially);
  // A reveal opens the group until the user closes it; the next reveal opens it again. Working in
  // the group keeps it open once the reveal ends (a field being filled stays in view).
  const [dismissedReveal, setDismissedReveal] = useState('');
  const open = toggledOpen || (!!reveal && reveal !== dismissedReveal);
  return (
    <details
      style={{ margin: '0.75rem 0', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}
      open={open}
      onFocus={() => { if (!toggledOpen) setToggledOpen(true); }}
      onToggle={(e) => {
        const nextOpen = (e.target as HTMLDetailsElement).open;
        if (nextOpen === open) return;
        setToggledOpen(nextOpen);
        if (!nextOpen) setDismissedReveal(reveal);
      }}
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
        <span aria-hidden style={{ width: 14, flexShrink: 0, opacity: 0.85 }}>
          {open ? '▼' : '▶'}
        </span>
        <span style={{ fontWeight: 600 }}>{label}</span>
        {hint ? <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>{hint}</span> : null}
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
