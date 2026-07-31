// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Which JSON keys under fabric merge-template nodes are editable in the Fabric Defaults UI.
 * Aligns with Advanced Fields (schema minus base fields) and the same UI exclusions as {@link AdvancedFieldsEditor}.
 */

import type {
  GeometrySchemaMode,
  GeometrySchemaPort,
} from '../../../geometry-editor-host/src/schemaPort';
import { getContextPathForElementType } from './fieldTooltipMap';
import { dereferenceSchemaNodeInRoot } from './subschemaCache';
import type { FabricMergeRole, FabricTemplatePointer } from './fabricDefaultsTemplates';
import { elementTypeForFabricRole, FABRIC_MERGE_ROLES, subtypeForFabricRole } from './fabricDefaultsTemplates';

export type FabricPropDescriptor = {
  key: string;
  schema: Record<string, unknown>;
  enumValues?: string[];
  kind: 'enum' | 'number' | 'integer' | 'boolean' | 'string';
};

function prettifySnakeCaseKey(fieldKey: string): string {
  return fieldKey
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/** Single-token PascalCase titles are usually enum typedef names (e.g. PartyWallCavityType), not human labels. */
function isTypedefStyleTitle(title: string): boolean {
  const t = title.trim();
  return /^[A-Z][a-zA-Z0-9]*$/.test(t) && !t.includes('_') && !t.includes(' ');
}

/**
 * Human-readable label aligned with schema tooltips / Advanced Fields: prefers {@link findParameterInSchema}
 * title, then property `title`, then Title Case from the JSON key.
 */
export function getFabricPropertyDisplayTitle(
  fieldKey: string,
  elementType: string,
  useFHSSchema: boolean,
  dereferencedPropertySchema: Record<string, unknown>,
  schemaPort: GeometrySchemaPort,
): string {
  const ctx = getContextPathForElementType(elementType);
  let infoTitle: string | undefined;
  try {
    infoTitle = schemaPort.findParameter(
      fieldKey,
      ctx,
      elementType,
      useFHSSchema ? 'fhs' : 'core',
    )?.title?.trim();
  } catch {
    infoTitle = undefined;
  }
  const propTitle =
    typeof dereferencedPropertySchema.title === 'string' ? dereferencedPropertySchema.title.trim() : undefined;

  const normalizedEq =
    (t: string | undefined) =>
      !!t && t.replace(/\s+/g, '_').toLowerCase() === fieldKey.toLowerCase();

  if (infoTitle && !normalizedEq(infoTitle) && !isTypedefStyleTitle(infoTitle)) {
    return infoTitle;
  }
  if (propTitle && !normalizedEq(propTitle) && !isTypedefStyleTitle(propTitle)) {
    return propTitle;
  }
  return prettifySnakeCaseKey(fieldKey);
}

function extractStringEnum(propertySchema: unknown): string[] | undefined {
  if (!propertySchema || typeof propertySchema !== 'object') return undefined;
  const s = propertySchema as Record<string, unknown>;
  const en = s.enum;
  if (Array.isArray(en) && en.length > 0 && en.every((x) => typeof x === 'string')) {
    return en as string[];
  }
  const oneOf = s.oneOf;
  if (Array.isArray(oneOf)) {
    const out: string[] = [];
    for (const branch of oneOf) {
      if (branch && typeof branch === 'object' && typeof (branch as { const?: unknown }).const === 'string') {
        out.push((branch as { const: string }).const);
      }
    }
    if (out.length > 0) return [...new Set(out)];
  }
  return undefined;
}

function primitiveKind(propertySchema: unknown): 'number' | 'integer' | 'boolean' | 'string' | null {
  if (!propertySchema || typeof propertySchema !== 'object') return null;
  const t = (propertySchema as { type?: unknown }).type;
  if (typeof t === 'string') {
    if (t === 'integer') return 'integer';
    if (t === 'number' || t === 'boolean' || t === 'string') return t;
  }
  if (Array.isArray(t)) {
    if (t.includes('integer')) return 'integer';
    if (t.includes('number')) return 'number';
    if (t.includes('boolean')) return 'boolean';
    if (t.includes('string')) return 'string';
  }
  return null;
}

/**
 * Keys that are omitted from {@link getAdvancedFieldKeysForMode} as “base” on the canvas but still belong on
 * defaults merge templates (e.g. party wall cavity modelling).
 */
function extraFabricTemplateKeys(elementType: string): string[] {
  switch (elementType) {
    case 'BuildingElementPartyWall':
      return ['party_wall_cavity_type', 'party_wall_lining_type', 'thermal_resistance_cavity'];
    default:
      return [];
  }
}

/** Mirror AdvancedFieldsEditor removals so fabric defaults stay consistent with per-element advanced UI. */
function applyFabricUiKeyExclusions(
  elementType: string,
  subtype: string | undefined,
  keys: string[],
): string[] {
  const set = new Set(keys);
  if (elementType === 'BuildingElementGround') {
    set.delete('thermal_resistance_construction');
    set.delete('edge_insulation');
    if (subtype !== 'Suspended_floor') {
      set.delete('height_upper_surface');
      set.delete('area_per_perimeter_vent');
      set.delete('thermal_resist_insul');
      set.delete('shield_fact_location');
    }
    if (subtype !== 'Suspended_floor' && subtype !== 'Unheated_basement') {
      set.delete('thermal_transm_walls');
    }
  }
  if (elementType === 'BuildingElementTransparent') {
    set.delete('thermal_resistance_construction');
    set.delete('treatment');
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function listFabricDefaultPropDescriptors(
  useFHSSchema: boolean,
  role: FabricMergeRole,
  template: Record<string, unknown>,
  schemaPort: GeometrySchemaPort,
): FabricPropDescriptor[] {
  const elementType = elementTypeForFabricRole(role);
  const subtype = subtypeForFabricRole(role, template);
  const mode: GeometrySchemaMode = useFHSSchema ? 'fhs' : 'core';
  const sub = schemaPort.getElementSubschema(mode, elementType, subtype);
  const base = new Set(schemaPort.getBaseFieldsForElementType(elementType));
  const advancedKeys = Object.keys(
    (sub?.properties ?? {}) as Record<string, unknown>,
  ).filter((key) => !base.has(key));
  const mergedKeys = [...new Set([...advancedKeys, ...extraFabricTemplateKeys(elementType)])].sort((a, b) =>
    a.localeCompare(b),
  );
  const props = (sub?.properties ?? {}) as Record<string, unknown>;
  const schemaRoot = schemaPort.getRootSchema(mode);

  let filteredKeys = applyFabricUiKeyExclusions(elementType, subtype, mergedKeys);
  // Merge defaults use u-value style inputs; construction R is not surfaced for fabric templates here.
  filteredKeys = filteredKeys.filter((k) => k !== 'thermal_resistance_construction');

  const out: FabricPropDescriptor[] = [];
  for (const key of filteredKeys) {
    const rawPs = props[key];
    if (!rawPs || typeof rawPs !== 'object') continue;
    let ps: Record<string, unknown> = rawPs as Record<string, unknown>;
    if (schemaRoot) {
      try {
        ps = dereferenceSchemaNodeInRoot(rawPs, schemaRoot) as Record<string, unknown>;
      } catch {
        ps = rawPs as Record<string, unknown>;
      }
    }
    const en = extractStringEnum(ps);
    if (en && en.length > 0) {
      out.push({ key, schema: ps as Record<string, unknown>, enumValues: en, kind: 'enum' });
      continue;
    }
    const pk = primitiveKind(ps);
    if (pk === 'number' || pk === 'integer') {
      out.push({ key, schema: ps as Record<string, unknown>, kind: pk });
      continue;
    }
    if (pk === 'boolean') {
      out.push({ key, schema: ps as Record<string, unknown>, kind: 'boolean' });
      continue;
    }
    if (pk === 'string') {
      out.push({ key, schema: ps as Record<string, unknown>, kind: 'string' });
    }
  }
  return out;
}

/**
 * Coerce draft slices to persisted JSON types (numbers from numeric strings). Used when saving and when
 * comparing dirty state so `0.18` (number) and `"0.18"` (while editing) compare equal.
 */
export function normalizeFabricDraftForPersist(
  draft: Partial<Record<FabricMergeRole, Record<string, unknown>>>,
  resolved: Map<FabricMergeRole, FabricTemplatePointer | null>,
  useFHSSchema: boolean,
  schemaPort: GeometrySchemaPort,
): Partial<Record<FabricMergeRole, Record<string, unknown>>> {
  const out: Partial<Record<FabricMergeRole, Record<string, unknown>>> = {};
  for (const role of FABRIC_MERGE_ROLES) {
    const loc = resolved.get(role);
    const slice = draft[role];
    if (!loc || !slice) continue;
    const descriptors = listFabricDefaultPropDescriptors(
      useFHSSchema,
      role,
      loc.template,
      schemaPort,
    );
    const norm: Record<string, unknown> = {};
    for (const d of descriptors) {
      if (!Object.prototype.hasOwnProperty.call(slice, d.key)) continue;
      const v = slice[d.key];
      if (v === undefined) {
        norm[d.key] = undefined;
        continue;
      }
      if (d.kind === 'number' || d.kind === 'integer') {
        if (typeof v === 'string') {
          const t = v.trim();
          if (t === '') norm[d.key] = undefined;
          else {
            const n = Number(t);
            norm[d.key] = !Number.isFinite(n) ? v : d.kind === 'integer' ? Math.trunc(n) : n;
          }
        } else {
          norm[d.key] = v;
        }
      } else {
        norm[d.key] = v;
      }
    }
    out[role] = norm;
  }
  return out;
}

/** Coerce string form controls back to JSON types expected by HEM. */
export function coerceFabricDraftValue(desc: FabricPropDescriptor, raw: unknown): unknown {
  if (raw === '' || raw === undefined) return raw === '' ? '' : raw;
  if (desc.kind === 'boolean') {
    if (raw === true || raw === false) return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return raw;
  }
  if (desc.kind === 'number' || desc.kind === 'integer') {
    if (typeof raw === 'number' && Number.isFinite(raw)) return desc.kind === 'integer' ? Math.trunc(raw) : raw;
    if (typeof raw === 'string') {
      const t = raw.trim();
      if (t === '') return '';
      const n = Number(t);
      if (!Number.isFinite(n)) return raw;
      return desc.kind === 'integer' ? Math.trunc(n) : n;
    }
    return raw;
  }
  return raw;
}
