// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  GeometrySchemaMode,
  GeometrySchemaNode,
  GeometrySchemaParameterInfo,
  GeometrySchemaPort,
} from '../../../geometry-editor-host/src/schemaPort';
import { unavailableGeometrySchemaPort } from '../../../geometry-editor-host/src/schemaPort';
import { getContextPathForElementType } from './fieldTooltipMap';
import {
  getFieldMetadata,
  type FieldMetadataMatch,
} from './schemaDescriptionOverrides';

export type FieldUnitCandidateSource =
  | 'schema_structured'
  | 'schema_description'
  | 'override'
  | 'semantic_fraction'
  | 'semantic_unitless';

export interface FieldUnitCandidate {
  source: FieldUnitCandidateSource;
  raw: string;
  normalized: string;
  metadataSource?: string;
}

export type FieldUnitResolution =
  | {
      status: 'resolved';
      display: string;
      source: Exclude<FieldUnitCandidateSource, 'semantic_unitless'>;
    }
  | { status: 'unitless'; source: 'semantic_unitless' }
  | { status: 'unresolved'; reason: 'no_unit_metadata' }
  | {
      status: 'conflict';
      normalizedCandidates: string[];
      candidates: FieldUnitCandidate[];
    };

export interface FieldPresentationContext {
  mode: GeometrySchemaMode;
  propertyKey: string;
  elementType?: string;
  subtype?: string;
  opaqueFabricVariant?: string;
  label?: string;
  contextPath?: readonly string[];
  /** Exact conditional/expanded schema node when the caller already has it. */
  schemaNode?: GeometrySchemaNode | null;
}

export interface ResolvedFieldPresentation {
  context: FieldPresentationContext;
  paramId: string;
  contextPath: readonly string[] | undefined;
  label: string;
  description?: string;
  descriptionSource?: 'schema' | 'hem_guidance';
  unit: FieldUnitResolution;
  rawUnitCandidates: FieldUnitCandidate[];
  schemaInfo: GeometrySchemaParameterInfo | null;
  overrideMetadata: FieldMetadataMatch | null;
  /** Single tooltip object consumed by the tooltip formatter and adornment callers. */
  tooltipInfo: GeometrySchemaParameterInfo | null;
}

/** Unit text suitable for a display-only control adornment. */
export function fieldUnitForAdornment(
  presentation: ResolvedFieldPresentation,
): string | undefined {
  return presentation.unit.status === 'resolved' ? presentation.unit.display : undefined;
}

const UNIT_ALIASES = new Map<string, string>([
  ['˚', '°'],
  ['degree', '°'],
  ['degrees', '°'],
  ['deg', '°'],
  ['deg c', '°C'],
  ['celsius', '°C'],
  ['˚c', '°C'],
  ['degree c', '°C'],
  ['degrees c', '°C'],
  ['degrees celsius', '°C'],
  ['° c', '°C'],
  ['°c', '°C'],
  ['l/s', 'L/s'],
  ['w/l/s', 'W/(L/s)'],
  ['litre/second', 'L/s'],
  ['litres/second', 'L/s'],
  ['litre per second', 'L/s'],
  ['litres per second', 'L/s'],
  ['litre', 'L'],
  ['litres', 'L'],
  ['litre/minute', 'L/min'],
  ['litres/minute', 'L/min'],
  ['litre per minute', 'L/min'],
  ['litres per minute', 'L/min'],
  ['m3/h', 'm³/h'],
  ['m3/hour', 'm³/h'],
  ['m³/hour', 'm³/h'],
  ['m³/h', 'm³/h'],
  ['cubic metre/hour', 'm³/h'],
  ['cubic metres/hour', 'm³/h'],
  ['cubic metre per hour', 'm³/h'],
  ['cubic metres per hour', 'm³/h'],
  ['w/m2k', 'W/m²·K'],
  ['w/m2.k', 'W/m²·K'],
  ['w/m²k', 'W/m²·K'],
  ['w/m².k', 'W/m²·K'],
  ['w/m2·k', 'W/m²·K'],
  ['w/m²·k', 'W/m²·K'],
  ['w/mk', 'W/m·K'],
  ['w/m.k', 'W/m·K'],
  ['w / m k', 'W/m·K'],
  ['w/m·k', 'W/m·K'],
  ['m².k/w', 'm²·K/W'],
  ['m²k/w', 'm²·K/W'],
  ['m2k/w', 'm²·K/W'],
  ['j/m².k', 'J/m²·K'],
  ['j/m²k', 'J/m²·K'],
  ['kj/m².k', 'kJ/m²·K'],
  ['kj/m²k', 'kJ/m²·K'],
  ['kelvin', 'K'],
]);

/** Format a unit spelling for display. This never converts the associated value. */
export function normalizeFieldUnit(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  const lookup = trimmed.toLocaleLowerCase('en-GB');
  if (/^degrees?\s*,\s*range\s*:/i.test(trimmed)) return '°';
  return UNIT_ALIASES.get(lookup) ?? trimmed;
}

function extractDescriptionUnit(description: string | undefined): string | null {
  if (!description) return null;
  const explicit = description.match(/\(\s*units?\s*:\s*([^)]+)\)/i);
  return explicit?.[1]?.trim() || null;
}

const STRUCTURED_UNIT_KEYS = [
  'units',
  'unit',
  'x-units',
  'x-unit',
  'x_units',
  'x_unit',
] as const;

function structuredUnitFromNode(node: GeometrySchemaNode | null | undefined): string | null {
  if (!node) return null;
  for (const key of STRUCTURED_UNIT_KEYS) {
    const value = node[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const metadata = node.metadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    for (const key of STRUCTURED_UNIT_KEYS) {
      const value = (metadata as Readonly<Record<string, unknown>>)[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return null;
}

function schemaDescriptionFor(
  context: FieldPresentationContext,
  info: GeometrySchemaParameterInfo | null,
): string | undefined {
  const local = context.schemaNode?.description;
  if (typeof local === 'string' && local.trim()) return local.trim();
  if (info?.source === 'hem_guidance') return undefined;
  return info?.description?.trim() || undefined;
}

function pushCandidate(
  candidates: FieldUnitCandidate[],
  source: FieldUnitCandidateSource,
  raw: string | null | undefined,
  metadataSource?: string,
): void {
  if (!raw?.trim()) return;
  const normalized = normalizeFieldUnit(raw);
  if (!normalized) return;
  if (candidates.some((candidate) => candidate.source === source && candidate.normalized === normalized)) return;
  candidates.push({ source, raw: raw.trim(), normalized, metadataSource });
}

function stripResolvedUnitFromLabel(label: string, resolvedUnit: string | undefined): string {
  const trimmed = label.trim().replace(/:\s*$/, '');
  if (!resolvedUnit) return trimmed;
  const match = trimmed.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (!match) return trimmed;
  const candidate = match[2]?.replace(/^units?\s*:\s*/i, '') ?? '';
  return normalizeFieldUnit(candidate) === resolvedUnit
    ? (match[1]?.trim() || trimmed)
    : trimmed;
}

function resolveUnit(candidates: FieldUnitCandidate[]): FieldUnitResolution {
  const physical = candidates.filter((candidate) =>
    candidate.source !== 'semantic_fraction' && candidate.source !== 'semantic_unitless');
  const fraction = candidates.find((candidate) => candidate.source === 'semantic_fraction');
  const unitless = candidates.find((candidate) => candidate.source === 'semantic_unitless');
  const normalizedCandidates = Array.from(new Set([
    ...physical.map((candidate) => candidate.normalized),
    ...(fraction ? ['fraction'] : []),
  ])).sort();

  if (unitless && (physical.length > 0 || fraction)) {
    return {
      status: 'conflict',
      normalizedCandidates: Array.from(new Set([...normalizedCandidates, 'unitless'])).sort(),
      candidates,
    };
  }
  if (normalizedCandidates.length > 1) {
    return { status: 'conflict', normalizedCandidates, candidates };
  }
  if (physical.length > 0) {
    const precedence: FieldUnitCandidateSource[] = [
      'schema_structured',
      'schema_description',
      'override',
    ];
    const selected = precedence
      .map((source) => physical.find((candidate) => candidate.source === source))
      .find(Boolean);
    if (selected) {
      return { status: 'resolved', display: selected.normalized, source: selected.source as Exclude<FieldUnitCandidateSource, 'semantic_unitless'> };
    }
  }
  if (fraction) return { status: 'resolved', display: 'fraction', source: 'semantic_fraction' };
  if (unitless) return { status: 'unitless', source: 'semantic_unitless' };
  return { status: 'unresolved', reason: 'no_unit_metadata' };
}

/**
 * Canonical field metadata resolver for labels, tooltips, unit adornments and
 * completeness diagnostics. Every lookup is scoped by the concrete context.
 */
export function resolveFieldPresentation(
  context: FieldPresentationContext,
  schemaPort: GeometrySchemaPort = unavailableGeometrySchemaPort,
): ResolvedFieldPresentation {
  // `propertyKey` is an identifier, not display copy. Mapping it as though it
  // were a label corrupts case-sensitive root keys such as BuildingLength.
  const paramId = context.propertyKey;
  const contextPath = context.contextPath
    ?? (context.elementType ? getContextPathForElementType(context.elementType) : undefined);
  let schemaInfo: GeometrySchemaParameterInfo | null = null;
  if (schemaPort.availability === 'available') {
    schemaInfo = schemaPort.findParameter(
      paramId,
      contextPath,
      context.elementType,
      context.mode,
    );
  }

  const overrideMetadata = getFieldMetadata({
    mode: context.mode,
    propertyKey: paramId,
    elementType: context.elementType,
    subtype: context.subtype,
    opaqueFabricVariant: context.opaqueFabricVariant,
    label: context.label,
  });
  const schemaDescription = schemaDescriptionFor(context, schemaInfo);
  const overrideDescription = overrideMetadata?.info.description?.trim() || undefined;
  const description = schemaDescription ?? overrideDescription;
  const descriptionSource = schemaDescription
    ? 'schema' as const
    : overrideDescription
      ? 'hem_guidance' as const
      : undefined;

  const candidates: FieldUnitCandidate[] = [];
  const exactNode = context.schemaNode ?? schemaInfo?.param;
  const schemaMetadataSource = schemaInfo?.jsonPath
    ?? (context.schemaNode ? 'schemaNode' : undefined);
  const parsedDescriptionUnit = extractDescriptionUnit(schemaDescription);
  let structuredUnit = structuredUnitFromNode(exactNode);
  if (!structuredUnit && schemaInfo?.units && !parsedDescriptionUnit) {
    structuredUnit = schemaInfo.units;
  }
  pushCandidate(candidates, 'schema_structured', structuredUnit, schemaMetadataSource);
  pushCandidate(candidates, 'schema_description', parsedDescriptionUnit, schemaMetadataSource);
  pushCandidate(candidates, 'override', overrideMetadata?.info.units, overrideMetadata?.key);
  if (overrideMetadata?.info.unitSemantic === 'fraction') {
    pushCandidate(candidates, 'semantic_fraction', 'fraction', overrideMetadata.key);
  } else if (overrideMetadata?.info.unitSemantic === 'unitless') {
    pushCandidate(candidates, 'semantic_unitless', 'unitless', overrideMetadata.key);
  }

  const unit = resolveUnit(candidates);
  const displayUnit = unit.status === 'resolved' ? unit.display : undefined;
  const label = stripResolvedUnitFromLabel(context.label ?? schemaInfo?.title ?? paramId, displayUnit);

  const tooltipInfo = schemaInfo || description || overrideMetadata
    ? {
        name: paramId,
        title: schemaInfo?.title ?? label,
        description,
        type: schemaInfo?.type ?? overrideMetadata?.info.type ?? 'unknown',
        units: displayUnit,
        constraints: schemaInfo?.constraints,
        jsonPath: schemaInfo?.jsonPath ?? `#/hardcoded/${overrideMetadata?.key ?? paramId}`,
        parentKeys: schemaInfo?.parentKeys ?? [],
        param: schemaInfo?.param ?? {
          description,
          type: overrideMetadata?.info.type ?? 'unknown',
        },
        variants: schemaInfo?.variants,
        source: descriptionSource,
      } satisfies GeometrySchemaParameterInfo
    : null;

  return {
    context,
    paramId,
    contextPath,
    label,
    description,
    descriptionSource,
    unit,
    rawUnitCandidates: candidates,
    schemaInfo,
    overrideMetadata,
    tooltipInfo,
  };
}
