// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * JsonForms does not apply `allOf` / `if` / `then` for editing. We flatten matching branches
 * into `properties` so controls enumerate. Branches must match **instance data** (e.g.
 * `type: "Boiler"`) so we do not merge HeatPump-only fields onto a boiler plant.
 */

import { dereferenceSchemaNodeInRoot } from './subschemaCache';
import { isRecord, readRecord } from './jsonTypes';
import { unwrapNullableSchema } from './schemaShape';

function cloneForFlatten<T>(obj: T): T {
  try {
    if (typeof structuredClone === 'function') return structuredClone(obj);
  } catch {
    /* fall through */
  }
  return JSON.parse(JSON.stringify(obj)) as T;
}

/** Match JSON Schema `if` (draft 2019-09 / 2020-12 style) against instance data — subset used in FHS. */
export function jsonSchemaIfMatches(ifSchema: unknown, data: unknown): boolean {
  if (ifSchema == null || typeof ifSchema !== 'object' || Array.isArray(ifSchema)) return true;
  const s = ifSchema as Record<string, unknown>;
  if ('not' in s) return !jsonSchemaIfMatches(s.not, data);
  if (Array.isArray(s.allOf)) return s.allOf.every((x) => jsonSchemaIfMatches(x, data));
  if (Array.isArray(s.anyOf)) return s.anyOf.some((x) => jsonSchemaIfMatches(x, data));
  if (Array.isArray(s.oneOf)) return s.oneOf.some((x) => jsonSchemaIfMatches(x, data));
  if (s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties)) {
    return dataMatchesPropertiesKeyword(data, s.properties as Record<string, unknown>);
  }
  return true;
}

function dataMatchesPropertiesKeyword(data: unknown, props: Record<string, unknown>): boolean {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  for (const [key, sub] of Object.entries(props)) {
    if (!(key in d)) return false;
    if (!valueMatchesSchemaKeyword(d[key], sub)) return false;
  }
  return true;
}

function valueMatchesSchemaKeyword(value: unknown, sub: unknown): boolean {
  if (sub == null || typeof sub !== 'object' || Array.isArray(sub)) return true;
  const s = sub as Record<string, unknown>;
  if ('const' in s) return value === s.const;
  if (Array.isArray(s.enum)) return s.enum.includes(value);
  if (s.type === 'boolean') return typeof value === 'boolean';
  if (s.type === 'number' || s.type === 'integer') return typeof value === 'number';
  if (s.type === 'string') return typeof value === 'string';
  if (s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties)) {
    return dataMatchesPropertiesKeyword(value, s.properties as Record<string, unknown>);
  }
  return true;
}

function isOptionalNestedObjectSchema(sch: unknown): boolean {
  if (!sch || typeof sch !== 'object' || Array.isArray(sch)) return false;
  const s = sch as Record<string, unknown>;
  const t = s.type;
  const isObj = t === 'object' || (Array.isArray(t) && (t as string[]).includes('object'));
  if (!isObj) return false;
  if (!s.properties || typeof s.properties !== 'object' || Array.isArray(s.properties)) return false;
  return true;
}

/**
 * Drop object-typed properties that are absent from `instance` and not listed in the node's `required`
 * (e.g. FHS HeatPump `BufferTank` when the plant JSON omits it). Required keys stay so editors still show them.
 */
export function omitAbsentOptionalObjectPropertiesFromSchema(node: unknown, instance: unknown): unknown {
  if (node == null || typeof node !== 'object' || Array.isArray(node)) return node;
  const n = node as Record<string, unknown>;
  const req = new Set(
    Array.isArray(n.required) ? (n.required as unknown[]).filter((x): x is string => typeof x === 'string') : [],
  );
  if (!n.properties || typeof n.properties !== 'object' || Array.isArray(n.properties)) return node;
  if (!instance || typeof instance !== 'object' || Array.isArray(instance)) return node;
  const inst = instance as Record<string, unknown>;
  const props = { ...(n.properties as Record<string, unknown>) };

  for (const [key, sch] of Object.entries(props)) {
    if (!(key in inst)) {
      if (!req.has(key) && isOptionalNestedObjectSchema(sch)) {
        delete props[key];
      }
      continue;
    }
    const childInst = inst[key];
    if (
      sch &&
      typeof sch === 'object' &&
      !Array.isArray(sch) &&
      childInst &&
      typeof childInst === 'object' &&
      !Array.isArray(childInst)
    ) {
      props[key] = omitAbsentOptionalObjectPropertiesFromSchema(sch, childInst);
    }
  }
  return { ...n, properties: props };
}

function mergeAllOfListIntoMerged(
  merged: Record<string, unknown>,
  allOf: unknown[],
  instanceData: unknown,
  fullRoot?: unknown,
  required: Set<string> = new Set(),
): void {
  for (const branch of allOf) {
    if (!branch || typeof branch !== 'object' || Array.isArray(branch)) continue;
    const b = branch as Record<string, unknown>;
    if (b.if && (b.then || b.else)) {
      if (instanceData === undefined) continue;
      const match = jsonSchemaIfMatches(b.if, instanceData);
      if (match && b.then && typeof b.then === 'object' && !Array.isArray(b.then)) {
        mergeThenSchemaInto(merged, b.then as Record<string, unknown>, instanceData, fullRoot, required);
      } else if (!match && b.else && typeof b.else === 'object' && !Array.isArray(b.else)) {
        mergeThenSchemaInto(merged, b.else as Record<string, unknown>, instanceData, fullRoot, required);
      }
    } else if (!b.if && b.properties && typeof b.properties === 'object' && !Array.isArray(b.properties)) {
      mergeThenSchemaInto(merged, b, instanceData, fullRoot, required);
    }
  }
}

function mergeThenSchemaInto(
  merged: Record<string, unknown>,
  thenBranch: Record<string, unknown>,
  instanceData: unknown,
  fullRoot?: unknown,
  required: Set<string> = new Set(),
): void {
  let th = thenBranch;
  if (fullRoot && th && typeof th === 'object') {
    th = dereferenceSchemaNodeInRoot(
      { ...th, $defs: (fullRoot as { $defs?: unknown }).$defs ?? {} },
      fullRoot,
    ) as Record<string, unknown>;
  }
  // FHS `StorageTank` is `{ $ref: Tank, properties: { HeatSource } }`; shallow sibling merge in deref can drop
  // `Tank.properties` (volume, daily_losses, …). Restore Tank fields when the instance is a storage tank.
  if (
    fullRoot &&
    instanceData &&
    typeof instanceData === 'object' &&
    !Array.isArray(instanceData) &&
    (instanceData as { type?: string }).type === 'StorageTank'
  ) {
    const defs = (fullRoot as { $defs?: Record<string, unknown> }).$defs;
    const tank = defs?.Tank as { properties?: Record<string, unknown> } | undefined;
    const thProps = th.properties as Record<string, unknown> | undefined;
    if (tank?.properties && thProps && typeof thProps === 'object') {
      const tankProperties = cloneForFlatten(tank.properties);
      const baseHeaters = readRecord(tankProperties.HeatSource);
      const overrideHeaters = readRecord(thProps.HeatSource);
      th = {
        ...th,
        properties: {
          ...tankProperties,
          ...thProps,
          HeatSource: {
            ...baseHeaters, ...overrideHeaters,
            additionalProperties: { ...readRecord(baseHeaters.additionalProperties), ...readRecord(overrideHeaters.additionalProperties) },
          },
        },
      };
    }
  }
  if (Array.isArray(th.required)) th.required.forEach((key) => { if (typeof key === 'string') required.add(key); });
  if (th.properties && typeof th.properties === 'object' && !Array.isArray(th.properties)) {
    const props = th.properties as Record<string, unknown>;
    for (const [k, subSchema] of Object.entries(props)) {
      merged[k] = cloneForFlatten(subSchema);
    }
    if (Array.isArray(th.allOf)) {
      mergeAllOfListIntoMerged(merged, th.allOf as unknown[], instanceData, fullRoot, required);
    }
    return;
  }
  const nested = flattenIfThenAllOfProperties(cloneForFlatten(th), instanceData, fullRoot) as Record<string, unknown>;
  if (nested.properties && typeof nested.properties === 'object' && !Array.isArray(nested.properties)) {
    Object.assign(merged, nested.properties as Record<string, unknown>);
  }
}

/**
 * Merge conditional branches that match `instanceData` into `properties`, drop satisfied `allOf` / top-level `if`.
 * When `instanceData` is undefined, only unconditional `allOf` entries (no `if`) contribute.
 */
export function flattenIfThenAllOfProperties(
  node: unknown,
  instanceData?: unknown,
  fullRoot?: unknown,
): unknown {
  if (node == null || typeof node !== 'object' || Array.isArray(node)) return node;
  const n = node as Record<string, unknown>;
  const out: Record<string, unknown> = { ...n };

  const hadPropertiesKey = Object.prototype.hasOwnProperty.call(n, 'properties');
  const hadAllOf = Array.isArray(n.allOf);
  const hadTopConditional = !!(n.if && (n.then || n.else));
  if (!hadPropertiesKey && !hadAllOf && !hadTopConditional) {
    return out;
  }

  const baseProps =
    out.properties && typeof out.properties === 'object' && !Array.isArray(out.properties)
      ? ({ ...(out.properties as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const merged: Record<string, unknown> = {};
  const required = new Set(Array.isArray(n.required) ? n.required.filter((key): key is string => typeof key === 'string') : []);

  const topIf = out.if as Record<string, unknown> | undefined;
  const topThen = out.then as Record<string, unknown> | undefined;
  const topElse = out.else as Record<string, unknown> | undefined;
  if (topIf && (topThen || topElse)) {
    const useThen =
      instanceData !== undefined && jsonSchemaIfMatches(topIf, instanceData) ? true : false;
    const branch = useThen ? topThen : topElse;
    if (branch) mergeThenSchemaInto(merged, branch as Record<string, unknown>, instanceData, fullRoot, required);
    delete out.if;
    delete out.then;
    delete out.else;
  }

  const allOf = Array.isArray(out.allOf) ? (out.allOf as unknown[]) : null;
  if (allOf) {
    mergeAllOfListIntoMerged(merged, allOf, instanceData, fullRoot, required);
    delete out.allOf;
  }

  // Conditional `allOf` / `then` keys must win over any overlapping base `properties` from expansion.
  out.properties = { ...baseProps, ...merged };
  if (required.size) out.required = [...required];
  delete out.unevaluatedProperties;

  if (out.properties && typeof out.properties === 'object' && !Array.isArray(out.properties)) {
    const pr = out.properties as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(pr)) {
      const childInstance =
        instanceData && typeof instanceData === 'object' && !Array.isArray(instanceData)
          ? (instanceData as Record<string, unknown>)[k]
          : undefined;
      if (k === 'test_data' && isRecord(v)) {
        const profile = readRecord(v.patternProperties)['M|L'];
        const profiles = isRecord(profile) ? { M: profile, L: profile } : readRecord(v.properties);
        next[k] = flattenIfThenAllOfProperties({ ...v, required: ['M'], properties: Object.fromEntries(Object.entries(profiles).map(([name, schema]) => [name, unwrapNullableSchema(readRecord(schema))])) }, childInstance, fullRoot);
      } else if (k === 'HeatSource' && isRecord(v) && isRecord(v.additionalProperties) && isRecord(childInstance)) {
        next[k] = {
          ...v,
          'x-vulcan-heater-map': true,
          properties: Object.fromEntries(Object.entries(childInstance).map(([name, heater]) => [
            name, { ...readRecord(flattenIfThenAllOfProperties(selectPlantVariant(v.additionalProperties, heater), heater, fullRoot)), 'x-vulcan-cylinder-heater': true },
          ])),
        };
      } else {
        next[k] = flattenIfThenAllOfProperties(v, childInstance, fullRoot);
      }
    }
    out.properties = next;
  }

  if (Array.isArray(out.anyOf)) {
    out.anyOf = out.anyOf.map((x) => flattenIfThenAllOfProperties(x, instanceData, fullRoot));
  }
  if (Array.isArray(out.oneOf)) {
    out.oneOf = out.oneOf.map((x) => flattenIfThenAllOfProperties(x, instanceData, fullRoot));
  }

  return out;
}

/** FHS `HeatSourceWet` top-level `if` keys off `is_heat_network`; presets often omit it (non-network). */
function normalizeHeatSourceWetPlantInstanceForFlatten(plant: unknown): unknown {
  if (!plant || typeof plant !== 'object' || Array.isArray(plant)) return plant;
  const p = plant as Record<string, unknown>;
  if (p.is_heat_network !== undefined) return plant;
  return { ...p, is_heat_network: false };
}

function selectPlantVariant(node: unknown, instanceData: unknown): unknown {
  if (!isRecord(node)) return node;
  let n = node as Record<string, unknown>;
  // Core schemas use discriminated unions where FHS uses if/then branches.
  const variants = n.oneOf ?? n.anyOf;
  if (Array.isArray(variants) && isRecord(instanceData)) {
    const match = variants.find((variant) => {
      const type = readRecord(readRecord(readRecord(variant).properties).type);
      return type.const === instanceData.type && type.const !== undefined;
    });
    if (isRecord(match)) n = { ...n, ...match, oneOf: undefined, anyOf: undefined };
  }
  return n;
}

/** Deep-flatten each plant schema under `properties[subtype].properties` using live plant JSON. */
export function flattenSystemSubtypePlantSchemas(
  subschema: Record<string, unknown>,
  subtype: string,
  plantDataMap?: Record<string, unknown> | null,
  fullRoot?: unknown,
): Record<string, unknown> {
  const rootProps = subschema.properties as Record<string, unknown> | undefined;
  const inner = rootProps?.[subtype] as Record<string, unknown> | undefined;
  const plantProps = inner?.properties as Record<string, unknown> | undefined;
  if (!inner || !plantProps) return subschema;

  const nextPlants: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(plantProps)) {
    const raw =
      plantDataMap && typeof plantDataMap === 'object' && !Array.isArray(plantDataMap)
        ? plantDataMap[k]
        : undefined;
    const plantInstance =
      subtype === 'HeatSourceWet' ? normalizeHeatSourceWetPlantInstanceForFlatten(raw) : raw;
    const plantType = readRecord(raw).type;
    const selected = plantType === 'StorageTank' || plantType === 'HeatPump' ? selectPlantVariant(v, plantInstance) : v;
    let flat = flattenIfThenAllOfProperties(cloneForFlatten(selected), plantInstance, fullRoot) as Record<string, unknown>;
    if (plantInstance && typeof plantInstance === 'object' && !Array.isArray(plantInstance)) {
      flat = omitAbsentOptionalObjectPropertiesFromSchema(flat, plantInstance) as Record<string, unknown>;
    }
    if (readRecord(raw).type === 'HeatPump' && isRecord(flat.properties)) {
      // Engines derive exhaust airflow from ventilation; this optional Core reference is unused.
      delete flat.properties.MechanicalVentilation;
    }
    nextPlants[k] = flat;
  }
  return {
    ...subschema,
    properties: {
      ...(subschema.properties as Record<string, unknown>),
      [subtype]: {
        ...inner,
        properties: nextPlants,
      },
    },
  };
}
