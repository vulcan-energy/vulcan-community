// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * JsonForms does not apply `allOf` / `if` / `then` for editing. We flatten matching branches
 * into `properties` so controls enumerate. Branches must match **instance data** (e.g.
 * `type: "Boiler"`) so we do not merge HeatPump-only fields onto a boiler plant.
 */

import { dereferenceSchemaNodeInRoot } from './subschemaCache';
import { isRecord, readRecord } from './jsonTypes';
import { isForbiddenSchemaNode, unwrapNullableSchema } from './schemaShape';

/** Marks the keys a flatten removed as forbidden, so edits can tell forbidden from not applicable. */
const FORBIDDEN_KEYS = 'x-vulcan-forbidden-keys';

function cloneForFlatten<T>(obj: T): T {
  try {
    if (typeof structuredClone === 'function') return structuredClone(obj);
  } catch {
    /* fall through */
  }
  return JSON.parse(JSON.stringify(obj)) as T;
}

/**
 * Match JSON Schema `if` against instance data, for the subset FHS uses. Every keyword must hold.
 * An absent discriminator means not matched, unlike JSON Schema where `properties` passes vacuously.
 */
export function jsonSchemaIfMatches(ifSchema: unknown, data: unknown, root?: unknown): boolean {
  if (!isRecord(ifSchema)) return true;
  const s = root && typeof ifSchema.$ref === 'string' ? readRecord(dereferenceSchemaNodeInRoot(ifSchema, root)) : ifSchema;
  if (Array.isArray(s.required)
    && !(isRecord(data) && s.required.every((key) => typeof key === 'string' && data[key] != null))) return false;
  if ('not' in s && jsonSchemaIfMatches(s.not, data, root)) return false;
  if (Array.isArray(s.allOf) && !s.allOf.every((x) => jsonSchemaIfMatches(x, data, root))) return false;
  if (Array.isArray(s.anyOf) && !s.anyOf.some((x) => jsonSchemaIfMatches(x, data, root))) return false;
  if (Array.isArray(s.oneOf) && !s.oneOf.some((x) => jsonSchemaIfMatches(x, data, root))) return false;
  if (isRecord(s.contains) && !(Array.isArray(data) && data.some((item) => jsonSchemaIfMatches(s.contains, item, root)))) return false;
  if (isRecord(s.additionalProperties) && isRecord(data)
    && !Object.values(data).every((value) => jsonSchemaIfMatches(s.additionalProperties, value, root))) return false;
  if (isRecord(s.properties) && !dataMatchesPropertiesKeyword(data, s.properties, root)) return false;
  return true;
}

function dataMatchesPropertiesKeyword(data: unknown, props: Record<string, unknown>, root?: unknown): boolean {
  if (!isRecord(data)) return false;
  // An absent boolean is false: a9 `tank_is_integral` defaults that way, and its condition says so.
  return Object.entries(props).every(([key, sub]) => (key in data ? valueMatchesSchemaKeyword(data[key], sub, root) : isRecord(sub) && sub.const === false));
}

function valueMatchesSchemaKeyword(value: unknown, sub: unknown, root?: unknown): boolean {
  if (!isRecord(sub)) return true;
  if ('const' in sub) return value === sub.const;
  if (Array.isArray(sub.enum)) return sub.enum.includes(value);
  if (sub.type === 'boolean') return typeof value === 'boolean';
  if (sub.type === 'number' || sub.type === 'integer') return typeof value === 'number';
  if (sub.type === 'string') return typeof value === 'string';
  return jsonSchemaIfMatches(sub, value, root);
}

/** Keys a branch matching `data` forbids, whether or not the base `properties` declares them. */
export function forbiddenFieldKeys(subschema: unknown, data: unknown, root?: unknown): string[] {
  const forbidden = readRecord(flattenIfThenAllOfProperties(subschema, data, root))[FORBIDDEN_KEYS];
  return Array.isArray(forbidden) ? forbidden as string[] : [];
}

/** Keys this edit forbids that were allowed before it. A value forbidden from the start stays. */
export function newlyForbiddenFieldKeys(subschema: unknown, before: unknown, after: unknown, root?: unknown): string[] {
  const was = new Set(forbiddenFieldKeys(subschema, before, root));
  return forbiddenFieldKeys(subschema, after, root).filter((key) => !was.has(key));
}

/** {@link forbiddenFieldKeys} for one plant of an expanded System subtype map. */
export function forbiddenPlantKeys(subschema: unknown, subtype: string, plantName: string, plant: unknown, root?: unknown, existingBuilding = false): string[] {
  const node = readRecord(readRecord(readRecord(readRecord(subschema).properties)[subtype]).properties)[plantName];
  const instance = plantInstanceForFlatten(subtype, plant);
  return forbiddenFieldKeys(plantVariantForFlatten(node, plant, instance, root, existingBuilding), instance, root);
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
      const match = jsonSchemaIfMatches(b.if, instanceData, fullRoot);
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
      instanceData !== undefined && jsonSchemaIfMatches(topIf, instanceData, fullRoot) ? true : false;
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
  // A branch forbids a key with `false` or `{not: {}}`: it is absent for this instance, not a control.
  const properties = out.properties as Record<string, unknown>;
  const forbidden = Object.keys(properties).filter((key) => isForbiddenSchemaNode(properties[key]));
  for (const key of forbidden) {
    delete properties[key];
    required.delete(key);
  }
  if (forbidden.length) out[FORBIDDEN_KEYS] = forbidden;
  if (required.size || Array.isArray(n.required)) out.required = [...required];
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
        // An optional object (`anyOf [object, null]`) gets its fields, not one JSON box.
        const unwrapped = isRecord(v) ? unwrapNullableSchema(v) : v;
        next[k] = flattenIfThenAllOfProperties(isRecord(unwrapped) && isRecord(unwrapped.properties) ? unwrapped : v, childInstance, fullRoot);
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

function plantInstanceForFlatten(subtype: string, plant: unknown): unknown {
  return subtype === 'HeatSourceWet' ? normalizeHeatSourceWetPlantInstanceForFlatten(plant) : plant;
}

function plantVariantForFlatten(node: unknown, plant: unknown, instance: unknown, root?: unknown, existingBuilding = false): unknown {
  return readRecord(plant).type ? selectPlantVariant(node, instance, root, existingBuilding) : node;
}

/** The typed variants under a plant schema, however deep the unions nest (EPC: pathway union, then type union). */
function typedPlantVariants(node: unknown, root: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (candidate: unknown) => {
    const resolved = isRecord(candidate) && typeof candidate.$ref === 'string' && root ? readRecord(dereferenceSchemaNodeInRoot(candidate, root)) : candidate;
    if (!isRecord(resolved)) return;
    if (isRecord(readRecord(resolved.properties).type)) { found.push(resolved); return; }
    for (const alternative of [...(Array.isArray(resolved.oneOf) ? resolved.oneOf : []), ...(Array.isArray(resolved.anyOf) ? resolved.anyOf : [])]) walk(alternative);
  };
  const n = readRecord(node);
  for (const alternative of [...(Array.isArray(n.oneOf) ? n.oneOf : []), ...(Array.isArray(n.anyOf) ? n.anyOf : [])]) walk(alternative);
  return found;
}

/**
 * The plant types a System section takes, from the target schema's own variants (the converter marker
 * `meta` is not a system). The existing-building forms are a subset of these, so one list serves both.
 */
export function systemPlantTypes(root: unknown, section: string): string[] {
  const map = readRecord(readRecord(readRecord(root).properties)[section]);
  const entries = isRecord(map.additionalProperties) ? map.additionalProperties : (Array.isArray(map.anyOf) ? map.anyOf.map((a) => readRecord(a).additionalProperties).find(isRecord) : undefined);
  const types = typedPlantVariants(entries, root).map((variant) => readRecord(readRecord(variant.properties).type).const);
  return [...new Set(types.filter((type): type is string => typeof type === 'string' && type !== 'meta'))];
}

/** An existing-building (HEMIE) form is the one that carries `model_type`. */
function isHemiePlantVariant(variant: Record<string, unknown>): boolean {
  return 'model_type' in readRecord(variant.properties);
}

/**
 * Core schemas use discriminated unions where FHS uses if/then branches. The variant is the one whose
 * `type` (and any other `const` the plant states, such as a heat battery's `battery_type`) matches the
 * plant. Both pathways can carry a type; an existing building takes its own form, a new build the full one.
 * `model_type` is the converter's marker, never a field the user fills.
 */
function selectPlantVariant(node: unknown, instanceData: unknown, root?: unknown, existingBuilding = false): unknown {
  if (!isRecord(node) || !isRecord(instanceData)) return node;
  const sameType = typedPlantVariants(node, root).filter((variant) => readRecord(readRecord(variant.properties).type).const === instanceData.type);
  const agreeing = sameType.filter((variant) => Object.entries(readRecord(variant.properties)).every(([key, schema]) => (
    key === 'type' || key === 'model_type' || !isRecord(schema) || !('const' in schema) || instanceData[key] === undefined || instanceData[key] === schema.const
  )));
  const pool = agreeing.length ? agreeing : sameType;
  const match = pool.find((variant) => isHemiePlantVariant(variant) === existingBuilding) ?? pool[0];
  if (!match) return node;
  const properties = { ...readRecord(match.properties) };
  delete properties.model_type;
  return {
    ...node, ...match, oneOf: undefined, anyOf: undefined, properties,
    ...(Array.isArray(match.required) ? { required: match.required.filter((key) => key !== 'model_type') } : {}),
  };
}

/** Deep-flatten each plant schema under `properties[subtype].properties` using live plant JSON. */
export function flattenSystemSubtypePlantSchemas(
  subschema: Record<string, unknown>,
  subtype: string,
  plantDataMap?: Record<string, unknown> | null,
  fullRoot?: unknown,
  existingBuilding = false,
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
    const plantInstance = plantInstanceForFlatten(subtype, raw);
    const selected = plantVariantForFlatten(v, raw, plantInstance, fullRoot, existingBuilding);
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
