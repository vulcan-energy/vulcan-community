// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Geometry `System` rows store `extra_json` merge maps, e.g.
 * `{ "HeatSourceWet": { "boiler": { "type": "Boiler", ... } } }`.
 * Published schemas describe those maps via `additionalProperties` or (FHS DHW) named `properties`.
 * JsonForms does not enumerate `additionalProperties`, so Advanced Fields would show a single opaque
 * object. Expand each **key present in data** into an explicit `properties.<name>` entry so controls
 * match other geometry types.
 *
 * **Editability vs schema:** we do not auto-materialise every optional schema leaf into `extra_json`;
 * the preset (or PCDB apply) still supplies the initial object. JsonForms may emit **partial** objects
 * when editing; {@link mergeSystemExtraJsonAfterJsonForms} keeps preset siblings so values stay editable
 * and are not silently discarded. Conditional `allOf` / `if` branches in the published schema can still
 * hide controls until discriminators match — that is schema/JsonForms behaviour, not the merge maps.
 */

/**
 * Annotation this module stamps on an expanded subtype node whose `properties` keys are
 * the USER'S OWN plant names ("hw cylinder", "Kitchen/Diner rads"), rather than schema
 * property names. Read by `buildSystemAdvancedUischema` (`./systemAdvancedUischema`),
 * which must keep those names away from the label content rule, and by nothing else.
 *
 * An `x-` extension key so it cannot collide with a JSON Schema keyword, and one shared
 * constant so the producer and the consumer cannot drift apart on the spelling.
 */
export const PLANT_KEYS_ARE_USER_NAMES = 'x-vulcan-plant-keys-are-user-names' as const;

function cloneSchemaFragment<T>(obj: T): T {
  try {
    if (typeof structuredClone === 'function') return structuredClone(obj);
  } catch {
    /* fall through */
  }
  return JSON.parse(JSON.stringify(obj)) as T;
}

/**
 * @param fullSchema result of `getElementSubschemaForMode` for `elementType === 'System'`
 *        (wrapper with a single key matching `subtype`).
 * @param mapData value at `extra_json[subtype]` (object of plant / circuit names → payloads).
 */
export function expandSystemMergeMapSchemaForJsonForms(
  fullSchema: Record<string, unknown> | null,
  subtype: string | undefined,
  mapDataUnknown: unknown,
): Record<string, unknown> | null {
  if (!fullSchema || !subtype || typeof fullSchema !== 'object') return fullSchema;
  const props = fullSchema.properties as Record<string, unknown> | undefined;
  const inner = props?.[subtype];
  if (!inner || typeof inner !== 'object') return fullSchema;

  const innerObj = inner as Record<string, unknown>;
  const mapData =
    mapDataUnknown && typeof mapDataUnknown === 'object' && !Array.isArray(mapDataUnknown)
      ? (mapDataUnknown as Record<string, unknown>)
      : null;
  const keys = mapData ? Object.keys(mapData) : [];
  if (keys.length === 0) return fullSchema;

  const perKey: Record<string, unknown> = {};
  /**
   * R4.6b-3: did these keys come from a MAP (so they are names the user typed into their
   * CSV), or from the subtype's own declared properties (so they are schema keys)? Both
   * arrive here as `Object.keys(mapData)` and leave as `properties`, indistinguishable
   * afterwards — and the label content rule needs to tell them apart, because it must
   * never re-spell a user's plant name. `System:InfiltrationVentilation` is the case that
   * makes this a real question and not a theoretical one: its data keys ARE schema
   * property names (`ach_max_static_calcs`, `shield_class`), so a data-shaped guess gets
   * it wrong; the SCHEMA shape is what actually decides. See
   * `PLANT_KEYS_ARE_USER_NAMES` and `buildSystemAdvancedUischema`.
   */
  let plantKeysAreUserNames = false;

  if (innerObj.additionalProperties && typeof innerObj.additionalProperties === 'object') {
    const tmpl = innerObj.additionalProperties;
    plantKeysAreUserNames = true;
    for (const k of keys) {
      perKey[k] = cloneSchemaFragment(tmpl);
    }
  } else if (innerObj.properties && typeof innerObj.properties === 'object') {
    const declared = innerObj.properties as Record<string, unknown>;
    for (const k of keys) {
      const slice = declared[k];
      if (slice && typeof slice === 'object') {
        perKey[k] = cloneSchemaFragment(slice);
      } else {
        perKey[k] = { type: 'object', additionalProperties: true };
      }
    }
  } else if (Array.isArray(innerObj.anyOf)) {
    const branch = innerObj.anyOf.find(
      (b) =>
        b &&
        typeof b === 'object' &&
        typeof (b as { additionalProperties?: unknown }).additionalProperties === 'object',
    ) as { additionalProperties?: Record<string, unknown> } | undefined;
    if (!branch?.additionalProperties) return fullSchema;
    const tmpl = branch.additionalProperties;
    plantKeysAreUserNames = true;
    for (const k of keys) {
      perKey[k] = cloneSchemaFragment(tmpl);
    }
  } else {
    return fullSchema;
  }

  if (Object.keys(perKey).length === 0) return fullSchema;

  return {
    ...fullSchema,
    properties: {
      ...props,
      [subtype]: {
        type: 'object',
        title: innerObj.title,
        description: innerObj.description,
        properties: perKey,
        ...(plantKeysAreUserNames ? { [PLANT_KEYS_ARE_USER_NAMES]: true } : {}),
      },
    },
    $defs: (fullSchema as { $defs?: unknown }).$defs ?? {},
  };
}

/**
 * Deep-merge helper: `fromForm` wins on keys it defines; any object path missing in `fromForm`
 * is filled from `base` (typically the last persisted preset / model). Prevents JsonForms from
 * dropping sibling preset fields when it emits a partial object after a single-field edit.
 */
export function mergePresetWithJsonFormsOutput(base: unknown, fromForm: unknown): unknown {
  if (fromForm === undefined) return base;
  if (fromForm === null) return null;
  if (typeof fromForm !== 'object' || Array.isArray(fromForm)) return fromForm;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return fromForm;
  const b = base as Record<string, unknown>;
  const f = fromForm as Record<string, unknown>;
  const out: Record<string, unknown> = { ...f };
  for (const [k, bv] of Object.entries(b)) {
    if (!(k in out)) {
      out[k] = bv;
    } else if (
      bv !== null
      && typeof bv === 'object'
      && !Array.isArray(bv)
      && out[k] !== null
      && typeof out[k] === 'object'
      && !Array.isArray(out[k])
    ) {
      out[k] = mergePresetWithJsonFormsOutput(bv, out[k]);
    }
  }
  return out;
}

/** Merge `extra_json[subtype]` plant maps so each plant object keeps preset keys under JsonForms edits. */
export function mergeSystemExtraJsonAfterJsonForms(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  subtype: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...incoming };
  const prevMap = existing[subtype];
  const nextMap = incoming[subtype];
  if (
    prevMap
    && typeof prevMap === 'object'
    && !Array.isArray(prevMap)
    && nextMap
    && typeof nextMap === 'object'
    && !Array.isArray(nextMap)
  ) {
    const pk = prevMap as Record<string, unknown>;
    const nk = nextMap as Record<string, unknown>;
    const mergedPlants: Record<string, unknown> = {};
    for (const name of new Set([...Object.keys(pk), ...Object.keys(nk)])) {
      const b = pk[name];
      const f = nk[name];
      if (f === undefined) {
        mergedPlants[name] = b;
      } else if (b === undefined) {
        mergedPlants[name] = f;
      } else {
        mergedPlants[name] = mergePresetWithJsonFormsOutput(b, f);
      }
    }
    out[subtype] = mergedPlants;
  }
  return out;
}
