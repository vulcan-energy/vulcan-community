// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  GeometrySchemaMode,
  GeometrySchemaNode,
  GeometrySchemaPort,
} from '../../../geometry-editor-host/src/schemaPort';
import {
  resolveFieldPresentation,
  type FieldUnitCandidate,
  type ResolvedFieldPresentation,
} from './fieldPresentation';
import { isRecord } from './jsonTypes';
import { resolveSchemaPointer } from './schemaRefResolver';
import { TOOLTIP_OVERRIDES } from './schemaDescriptionOverrides';

export interface ModelAuthoringFieldConfiguration {
  mode: GeometrySchemaMode;
  elementType: string;
  subtype?: string;
  opaqueFabricVariant?: string;
}

export interface ModelAuthoringNumericField {
  configuration: ModelAuthoringFieldConfiguration;
  propertyPath: string;
  presentation: ResolvedFieldPresentation;
}

const BOTH_SCHEMA_MODES: readonly GeometrySchemaMode[] = ['core', 'fhs'];

function inBothModes(
  configuration: Omit<ModelAuthoringFieldConfiguration, 'mode'>,
): ModelAuthoringFieldConfiguration[] {
  return BOTH_SCHEMA_MODES.map((mode) => ({ mode, ...configuration }));
}

/**
 * Concrete editor configurations whose fields are schema-derived below. This
 * lists contexts, never field names or units, so schema remains the field
 * registry and tooltip metadata remains the only override registry.
 */
export const MODEL_AUTHORING_FIELD_CONFIGURATIONS: readonly ModelAuthoringFieldConfiguration[] = [
  ...['wall', 'roof', 'external_door'].flatMap((opaqueFabricVariant) =>
    inBothModes({ elementType: 'BuildingElementOpaque', opaqueFabricVariant })),
  ...inBothModes({ elementType: 'BuildingElementTransparent' }),
  ...[
    'Slab_no_edge_insulation',
    'Slab_edge_insulation',
    'Suspended_floor',
    'Heated_basement',
    'Unheated_basement',
  ].flatMap((subtype) => inBothModes({ elementType: 'BuildingElementGround', subtype })),
  ...[
    'BuildingElementAdjacentConditionedSpace',
    'BuildingElementAdjacentUnconditionedSpace_Simple',
    'BuildingElementPartyWall',
    'ThermalBridgeLinear',
    'ThermalBridgePoint',
    'WindowShading',
    'Lighting',
    'MechanicalVentilationDuctwork',
    'MechanicalVentilationTerminal',
    'WaterPipework',
    'ContextShading',
    'Vents',
    'OnSiteGeneration',
    'ElectricBattery',
  ].flatMap((elementType) => inBothModes({ elementType })),
  ...[
    'Intermittent MEV',
    'Centralised continuous MEV',
    'Decentralised continuous MEV',
    'MVHR',
    'MEV',
    'PIV',
  ].flatMap((subtype) => inBothModes({ elementType: 'MechanicalVentilation', subtype })),
  ...['radiator', 'ufh', 'fancoil'].flatMap((subtype) =>
    inBothModes({ elementType: 'WetEmitter', subtype })),
  ...['Bath', 'MixerShower', 'InstantElecShower', 'OtherWaterUseDetails'].flatMap((subtype) =>
    inBothModes({ elementType: 'HotWaterDemand', subtype })),
  ...['HeatSourceWet', 'HotWaterSource', 'SpaceCoolSystem', 'SpaceHeatSystem'].flatMap((subtype) =>
    inBothModes({ elementType: 'System', subtype })),
];

function stringTypes(node: GeometrySchemaNode): string[] {
  const direct = node.type;
  const types = typeof direct === 'string'
    ? [direct]
    : Array.isArray(direct)
      ? direct.filter((value): value is string => typeof value === 'string')
      : [];
  for (const key of ['oneOf', 'anyOf'] as const) {
    const alternatives = node[key];
    if (!Array.isArray(alternatives)) continue;
    for (const alternative of alternatives) {
      if (!isRecord(alternative)) continue;
      types.push(...stringTypes(alternative));
    }
  }
  return Array.from(new Set(types));
}

function isNumericSchema(node: GeometrySchemaNode): boolean {
  if (stringTypes(node).some((type) => type === 'number' || type === 'integer')) return true;
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    return node.enum.every((value) => typeof value === 'number');
  }
  for (const key of ['oneOf', 'anyOf'] as const) {
    const alternatives = node[key];
    if (!Array.isArray(alternatives) || alternatives.length === 0) continue;
    const constValues = alternatives
      .filter(isRecord)
      .map((alternative) => alternative.const);
    if (constValues.length === alternatives.length && constValues.every((value) => typeof value === 'number')) {
      return true;
    }
  }
  return false;
}

function resolveLocalRef(root: GeometrySchemaNode, ref: unknown): GeometrySchemaNode | null {
  if (typeof ref !== 'string') return null;
  const resolved = resolveSchemaPointer(root, ref);
  return isRecord(resolved) ? (resolved as GeometrySchemaNode) : null;
}

function schemaTitle(node: GeometrySchemaNode, propertyKey: string): string {
  return typeof node.title === 'string' && node.title.trim()
    ? node.title.trim()
    : propertyKey.replace(/_/g, ' ');
}

function childEntries(value: unknown): Array<[string, GeometrySchemaNode]> {
  if (!isRecord(value)) return [];
  return Object.entries(value).filter(
    (entry): entry is [string, GeometrySchemaNode] => isRecord(entry[1]),
  );
}

/**
 * Walks the concrete schema returned to the editor. The configuration list is
 * hand-selected; the field paths are derived here and are never registered a
 * second time in tests or audit scripts.
 */
export function collectModelAuthoringNumericFields(
  schemaPort: GeometrySchemaPort,
  configuration: ModelAuthoringFieldConfiguration,
): ModelAuthoringNumericField[] {
  if (schemaPort.availability !== 'available') return [];
  const schema = schemaPort.getElementSubschema(
    configuration.mode,
    configuration.elementType,
    configuration.subtype,
  );
  const root = schemaPort.getRootSchema(configuration.mode);
  if (!schema || !root) return [];

  const fields = new Map<string, ModelAuthoringNumericField>();

  const visitNode = (
    node: GeometrySchemaNode,
    propertyPath: string,
    stack: ReadonlySet<GeometrySchemaNode>,
    depth: number,
  ): void => {
    if (depth > 32 || stack.has(node)) return;
    const nextStack = new Set(stack).add(node);
    const resolvedRef = resolveLocalRef(root, node.$ref);
    if (resolvedRef) visitNode(resolvedRef, propertyPath, nextStack, depth + 1);

    for (const [propertyKey, propertySchema] of childEntries(node.properties)) {
      const nextPath = propertyPath ? `${propertyPath}.${propertyKey}` : propertyKey;
      const refSchema = resolveLocalRef(root, propertySchema.$ref);
      const effectiveSchema = refSchema
        ? ({ ...refSchema, ...propertySchema } as GeometrySchemaNode)
        : propertySchema;
      if (isNumericSchema(effectiveSchema)) {
        const presentation = resolveFieldPresentation({
          ...configuration,
          propertyKey,
          label: schemaTitle(effectiveSchema, propertyKey),
          schemaNode: effectiveSchema,
        }, schemaPort);
        const key = [configuration.mode, configuration.elementType, configuration.subtype ?? '', nextPath].join('|');
        fields.set(key, { configuration, propertyPath: nextPath, presentation });
      }
      visitNode(effectiveSchema, nextPath, nextStack, depth + 1);
    }

    for (const [pattern, patternSchema] of childEntries(node.patternProperties)) {
      const nextPath = propertyPath ? `${propertyPath}.*` : '*';
      void pattern;
      visitNode(patternSchema, nextPath, nextStack, depth + 1);
    }
    if (isRecord(node.additionalProperties)) {
      visitNode(node.additionalProperties, propertyPath ? `${propertyPath}.*` : '*', nextStack, depth + 1);
    }
    if (isRecord(node.items)) {
      visitNode(node.items, `${propertyPath}[]`, nextStack, depth + 1);
    }
    // Root conditional/allOf branches have already been selected and merged by
    // `getElementSubschema`; AdvancedFieldsEditor removes the residual allOf.
    // oneOf/anyOf remain live renderer choices and must still be inspected.
    for (const key of ['oneOf', 'anyOf'] as const) {
      const alternatives = node[key];
      if (!Array.isArray(alternatives)) continue;
      for (const alternative of alternatives) {
        if (isRecord(alternative)) visitNode(alternative, propertyPath, nextStack, depth + 1);
      }
    }
    // `if`/`then`/`else` are discriminator machinery. The concrete selected
    // properties have already been merged by the canonical schema resolver.
  };

  visitNode(schema, '', new Set(), 0);
  return Array.from(fields.values()).sort((a, b) => a.propertyPath.localeCompare(b.propertyPath));
}

function metadataFieldContext(metadataKey: string): Omit<ModelAuthoringFieldConfiguration, 'mode'> & {
  propertyKey: string;
} {
  const parts = metadataKey.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0] === 'label') {
    throw new Error(
      `Model-authoring metadata key must use ElementType:propertyKey syntax: ${metadataKey}`,
    );
  }
  return { elementType: parts[0], propertyKey: parts[1] };
}

/**
 * Non-schema editor fields opt into completeness through the canonical tooltip
 * registry itself. This keeps tests and audit tooling from owning a parallel
 * list of UI-only fields or their units.
 */
export function collectMetadataModelAuthoringNumericFields(
  schemaPort: GeometrySchemaPort,
  modes: readonly GeometrySchemaMode[] = BOTH_SCHEMA_MODES,
): ModelAuthoringNumericField[] {
  const fields: ModelAuthoringNumericField[] = [];
  for (const [metadataKey, info] of Object.entries(TOOLTIP_OVERRIDES)) {
    if (!info.modelAuthoring) continue;
    if (info.type !== 'number' && info.type !== 'integer') {
      throw new Error(`Model-authoring metadata must describe a numeric field: ${metadataKey}`);
    }
    const { elementType, propertyKey } = metadataFieldContext(metadataKey);
    for (const mode of modes) {
      const configuration = { mode, elementType } satisfies ModelAuthoringFieldConfiguration;
      fields.push({
        configuration,
        propertyPath: propertyKey,
        presentation: resolveFieldPresentation({
          ...configuration,
          propertyKey,
          label: propertyKey.replace(/_/g, ' '),
        }, schemaPort),
      });
    }
  }
  return fields.sort((a, b) => [
    a.configuration.mode,
    a.configuration.elementType,
    a.propertyPath,
  ].join('|').localeCompare([
    b.configuration.mode,
    b.configuration.elementType,
    b.propertyPath,
  ].join('|')));
}

/** Schema-backed and explicitly annotated UI-only numeric authoring fields. */
export function collectVisibleModelAuthoringNumericFields(
  schemaPort: GeometrySchemaPort,
  configurations: readonly ModelAuthoringFieldConfiguration[] = MODEL_AUTHORING_FIELD_CONFIGURATIONS,
): ModelAuthoringNumericField[] {
  const fields = configurations.flatMap((configuration) =>
    collectModelAuthoringNumericFields(schemaPort, configuration));
  const modes = Array.from(new Set(configurations.map(({ mode }) => mode)));
  fields.push(...collectMetadataModelAuthoringNumericFields(schemaPort, modes));

  const unique = new Map<string, ModelAuthoringNumericField>();
  for (const field of fields) {
    const { mode, elementType, subtype, opaqueFabricVariant } = field.configuration;
    unique.set([
      mode,
      elementType,
      subtype ?? '',
      opaqueFabricVariant ?? '',
      field.propertyPath,
    ].join('|'), field);
  }
  return Array.from(unique.values()).sort((a, b) => {
    const left = [
      a.configuration.mode,
      a.configuration.elementType,
      a.configuration.subtype ?? '',
      a.configuration.opaqueFabricVariant ?? '',
      a.propertyPath,
    ].join('|');
    const right = [
      b.configuration.mode,
      b.configuration.elementType,
      b.configuration.subtype ?? '',
      b.configuration.opaqueFabricVariant ?? '',
      b.propertyPath,
    ].join('|');
    return left.localeCompare(right);
  });
}

function formatRawCandidate(candidate: FieldUnitCandidate): string {
  return `${candidate.source}:${candidate.raw}=>${candidate.normalized}`;
}

/** Stable, grep-friendly failure output shared by tests and the CLI audit. */
export function fieldPresentationGapDiagnostics(
  fields: readonly ModelAuthoringNumericField[],
): string[] {
  return fields
    .filter(({ presentation }) =>
      presentation.unit.status === 'unresolved' || presentation.unit.status === 'conflict')
    .map(({ configuration, propertyPath, presentation }) => {
      const raw = presentation.rawUnitCandidates.length > 0
        ? presentation.rawUnitCandidates.map(formatRawCandidate).join(',')
        : '-';
      const metadata = Array.from(new Set([
        ...presentation.rawUnitCandidates
          .map((candidate) => candidate.metadataSource)
          .filter((source): source is string => !!source),
        presentation.overrideMetadata?.key,
        presentation.schemaInfo?.source,
      ].filter((source): source is string => !!source))).join(',') || '-';
      return [
        `mode=${configuration.mode}`,
        `type=${configuration.elementType}`,
        `subtype=${configuration.subtype ?? '-'}`,
        `path=${propertyPath}`,
        `status=${presentation.unit.status}`,
        `raw=${raw}`,
        `metadata=${metadata}`,
      ].join(' ');
    })
    .sort((a, b) => a.localeCompare(b));
}
