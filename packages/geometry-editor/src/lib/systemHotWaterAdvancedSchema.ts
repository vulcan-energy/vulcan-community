// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/** Combi-only DHW test / loss fields on `HotWaterSource['hw cylinder']` (FHS `input_fhs` / ecaas). */
export const COMBI_BOILER_HW_CYLINDER_EXTRA_KEYS = [
  'rejected_energy_1',
  'rejected_factor_3',
  'separate_DHW_tests',
  'storage_loss_factor_1',
  'storage_loss_factor_2',
] as const;

const HW_CYL = 'hw cylinder' as const;

type UnknownRec = Record<string, unknown>;

function cloneSubschema<T>(obj: T): T {
  try {
    if (typeof structuredClone === 'function') return structuredClone(obj);
  } catch {
    /* fall through */
  }
  return JSON.parse(JSON.stringify(obj)) as T;
}

function isRecord(x: unknown): x is UnknownRec {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

/** Keys of root `ColdWaterSource` in FHS (e.g. `mains water`, `header tank`) — used as `enum` for references. */
export function coldWaterSourceKeysFromFhsRoot(rootFhsSchema: Record<string, unknown> | null | undefined): string[] {
  if (!rootFhsSchema || !isRecord(rootFhsSchema.properties)) return [];
  const cws = (rootFhsSchema.properties as UnknownRec).ColdWaterSource;
  if (!isRecord(cws) || !isRecord(cws.properties)) return [];
  return Object.keys(cws.properties).sort();
}

/**
 * Tank `ColdWaterSource` is a string `reference_to` root keys; published schema has no `enum`, so JsonForms
 * shows a free-text field. Inline the allowed key list from root `ColdWaterSource.properties` for Advanced Fields.
 */
export function inlineHwCylinderColdWaterSourceEnumOnHotWaterSubschema(
  subschema: Record<string, unknown>,
  rootFhsSchema: Record<string, unknown> | null | undefined,
): void {
  const keys = coldWaterSourceKeysFromFhsRoot(rootFhsSchema);
  if (keys.length === 0) return;
  if (!isRecord(subschema.properties)) return;
  const hw = (subschema.properties as UnknownRec).HotWaterSource;
  if (!isRecord(hw) || !isRecord(hw.properties)) return;
  const cyl = hw.properties[HW_CYL];
  if (!isRecord(cyl) || !isRecord(cyl.properties)) return;
  const cws = cyl.properties.ColdWaterSource;
  if (!isRecord(cws) || cws.type !== 'string') return;
  if (Array.isArray(cws.enum) && cws.enum.length > 0) return;
  cyl.properties.ColdWaterSource = { ...cws, enum: keys };
}

/**
 * JsonForms/flattening can leave properties from multiple `allOf` branches in one object.
 * Remove keys that are only valid for `CombiBoiler` when the instance is another `hw cylinder` `type`
 * (e.g. `StorageTank`), and drop a stray top-level `HeatSourceWet` string for `StorageTank` (cylinder
 * links wet plants via `HeatSource`, not a top-level string on the tank object).
 */
export function pruneHotWaterSourceHwCylinderSchemaForInstance(
  subschema: Record<string, unknown> | null | undefined,
  extraJson: unknown,
): Record<string, unknown> | null | undefined {
  if (!subschema || !isRecord(subschema)) return subschema;

  const hwRaw = isRecord(extraJson) ? extraJson.HotWaterSource : undefined;
  const hw = isRecord(hwRaw) ? hwRaw : null;
  const cylRaw = hw != null ? hw[HW_CYL] : undefined;
  const inst = isRecord(cylRaw) ? cylRaw : null;
  const hwType = typeof inst?.type === 'string' ? inst.type : undefined;
  if (!hwType) return subschema;

  const out = cloneSubschema(subschema);
  if (!isRecord(out.properties)) return out;

  const pRoot = out.properties;
  if (!isRecord(pRoot.HotWaterSource) || !isRecord((pRoot.HotWaterSource as UnknownRec).properties)) {
    return out;
  }
  const pHw = pRoot.HotWaterSource as UnknownRec;
  const pInner = pHw.properties as UnknownRec;
  if (!isRecord(pInner[HW_CYL]) || !isRecord((pInner[HW_CYL] as UnknownRec).properties)) {
    return out;
  }

  const node = pInner[HW_CYL] as UnknownRec;
  const props = node.properties as UnknownRec;
  // Authored via geometry `WaterPipework` (and merge), not in this Advanced view.
  if ('primary_pipework' in props) {
    delete props.primary_pipework;
    if (Array.isArray(node.required)) {
      node.required = (node.required as string[]).filter((r) => r !== 'primary_pipework');
    }
  }
  if (hwType === 'CombiBoiler') {
    return out;
  }

  for (const k of COMBI_BOILER_HW_CYLINDER_EXTRA_KEYS) {
    delete props[k];
  }
  if (Array.isArray(node.required)) {
    node.required = (node.required as string[]).filter(
      (r) => !COMBI_BOILER_HW_CYLINDER_EXTRA_KEYS.includes(r as (typeof COMBI_BOILER_HW_CYLINDER_EXTRA_KEYS)[number]),
    );
  }
  if (hwType === 'StorageTank' && 'HeatSourceWet' in props) {
    delete props.HeatSourceWet;
    if (Array.isArray(node.required)) {
      node.required = (node.required as string[]).filter((r) => r !== 'HeatSourceWet');
    }
  }

  return out;
}

/**
 * FHS: `CombiBoiler` / `HIU` / `HeatBattery` use `HotWaterSource[hw cylinder].HeatSourceWet` as a
 * `referenceTo` a dwelling `HeatSourceWet` key — restrict the Advanced field to names that exist.
 */
export function inlineHotWaterSourceHeatSourceWetEnumOnHotWaterSubschema(
  subschema: Record<string, unknown>,
  options: {
    definedNames: string[];
    currentCombiLink?: string | null;
    labels?: Record<string, string>;
  },
): void {
  const { definedNames, currentCombiLink, labels = {} } = options;
  if (!isRecord(subschema.properties)) return;
  const hw = (subschema.properties as UnknownRec).HotWaterSource;
  if (!isRecord(hw) || !isRecord(hw.properties)) return;
  const cyl = hw.properties[HW_CYL];
  if (!isRecord(cyl) || !isRecord(cyl.properties)) return;
  const hswField = cyl.properties.HeatSourceWet;
  if (!isRecord(hswField) || hswField.type !== 'string') return;
  if (hswField.const) return;
  const names = new Set(definedNames.map((s) => s.trim()).filter(Boolean));
  const cur = typeof currentCombiLink === 'string' ? currentCombiLink.trim() : '';
  const currentIsDefined = cur ? names.has(cur) : false;
  if (cur) {
    names.add(cur);
  }
  const enumList = Array.from(names).sort();
  const baseDesc = typeof hswField.description === 'string' ? hswField.description.trim() : '';
  const hint
    = enumList.length === 0
      ? 'No defined heat source (wet) names yet. Add a Heat source (wet) system that defines a plant key, then link here.'
      : 'Only names that already exist on a heat source (wet) system in this project are allowed (plus the current value, if any). This link does not copy combi DHW test values; use the PCDB DHW action when linking to a PCDB combi boiler.';
  const description = [baseDesc, hint].filter(Boolean).join(' ');

  cyl.properties.HeatSourceWet = {
    ...hswField,
    oneOf: enumList.map((name) => ({
      const: name,
      title: labels[name] ?? (name === cur && !currentIsDefined ? `${name} (current, unresolved)` : name),
    })),
    description,
  };
}
