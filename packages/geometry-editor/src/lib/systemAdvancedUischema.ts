// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { resolveFieldLabelContent, startCaseKey } from './schemaDescriptionOverrides';
import { encodePointerToken } from './schemaRefResolver';
import { PLANT_KEYS_ARE_USER_NAMES } from './systemAdvancedSchemaExpand';

/**
 * Structurally identical to the subset of `@jsonforms/core`'s `UISchemaElement` this
 * module ever produces (VerticalLayout / Control, no Group). Defined locally so this
 * module carries no `@jsonforms/core` dependency — the reason the type is declared here
 * rather than imported, and the only reason it needs to exist at all.
 *
 * The single call site in `AdvancedFieldsEditor.tsx` passes the result to
 * `DirectAdvancedFields`' `layout` prop, which is typed as this same
 * `AdvancedFieldsLayoutNode`, so it goes through as itself — no cast, and no JsonForms
 * mount to accept it (retired in R4.4; R4.5 removed the last `@jsonforms/*` dependency
 * from this package).
 */
export type AdvancedFieldsLayoutNode = {
  type: 'VerticalLayout' | 'Control';
  scope?: string;
  label?: string;
  elements?: AdvancedFieldsLayoutNode[];
};

function shouldRecurseIntoNestedObject(childSchema: unknown): boolean {
  if (!childSchema || typeof childSchema !== 'object' || Array.isArray(childSchema)) return false;
  const c = childSchema as Record<string, unknown>;
  const t = c.type;
  const isObjType = t === 'object' || (Array.isArray(t) && (t as string[]).includes('object'));
  const p = c.properties;
  const hasProps =
    !!(
      p &&
      typeof p === 'object' &&
      !Array.isArray(p) &&
      Object.keys(p as Record<string, unknown>).length > 0
    );
  return hasProps && (isObjType || !c.type);
}

/** Discriminant first, then alphabetical (JsonForms order otherwise sorted keys put `type` last). */
function sortPropertyKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ra = a === 'type' ? 0 : 1;
    const rb = b === 'type' ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

/**
 * R4.6b-1 (step 0): the no-title fallback is START-CASED, not the raw schema key.
 *
 * A real `title` still wins outright — this only changes what a property with no title
 * renders as. It brings the System walk into line with the flat walk, whose
 * `labelForProperty` (`../components/DirectAdvancedFields`) has always fallen back to
 * `startCaseKey`. The divergence was visible: an UNPREFIXED System row already went
 * through `labelForProperty` (because `leafControlLabel` returns `undefined` with no
 * prefix parts, leaving the Control without a `label`) and rendered "Design Flow Temp",
 * while the same schema shape one nesting level down rendered `min_outdoor_temp` raw.
 *
 * R4.6b-3 (steps 1-3): "a real title wins outright" is now "a real title wins if it is
 * ADMISSIBLE" — the shared content rule (`resolveFieldLabelContent`,
 * `./schemaDescriptionOverrides`) decides, and the same call sits behind the flat walk's
 * `labelForProperty`, so the two walks cannot disagree about one field's name. This
 * function still reads the RAW child schema, where the flat walk reads the dereferenced
 * one; a `$ref`'d property therefore reaches the rule here with no title at all and is
 * key-derived on both paths anyway.
 */
function titleOrKeyFromSchema(key: string, childSchema: unknown): string {
  const title =
    childSchema && typeof childSchema === 'object' && !Array.isArray(childSchema)
      ? (childSchema as { title?: unknown }).title
      : undefined;
  return resolveFieldLabelContent(key, title);
}

type PlantControlCtx = {
  plantKey: string;
  multiPlant: boolean;
  /**
   * Is `plantKey` a name the USER typed (a merge-map key expanded from their `extra_json`)
   * or a schema property of this subtype? Stamped on the subtype node by
   * `expandSystemMergeMapSchemaForJsonForms` (`./systemAdvancedSchemaExpand`), which is
   * the only place that still knows, and consumed by `plantBlobControl`. Do not try to
   * re-derive it from the keys themselves: `System:InfiltrationVentilation`'s data keys
   * are schema property names, so every data-shaped heuristic gets that subtype wrong.
   */
  plantKeysAreUserNames: boolean;
  /**
   * Nested object keys from the plant root (not including the leaf property key),
   * already start-cased at append time in `buildControlsForSchema` — see the note on
   * `titleOrKeyFromSchema` above, and the `plantKey` exclusion on `leafControlLabel`.
   *
   * READ THAT NOTE FOR THE CASING RULE ONLY, NOT FOR THE SOURCE. Prefixes do not go
   * through `titleOrKeyFromSchema` at all: `buildControlsForSchema` pushes
   * `startCaseKey(key)` directly and never consults the nested object's own `title`, so a
   * prefix is KEY-derived even when the node is titled. Core's
   * `InfiltrationVentilation.Leaks` is the live case — it resolves to `$defs`
   * `VentilationLeaks`, which carries `title: "VentilationLeaks"`, and the row still
   * renders `Leaks · Env Area`.
   *
   * R4.6b-3 DECIDED that asymmetry rather than removing it: PREFIXES are structural
   * breadcrumbs (key-derived; plant keys raw), LEAVES are field labels (title-first,
   * subject to admissibility). See the rule-set docstring on `resolveFieldLabelContent`
   * (`./schemaDescriptionOverrides`). Note that the two happen to agree here anyway —
   * "VentilationLeaks" is exactly the pydantic type name the leaf rule would reject.
   */
  pathLabels: string[];
};

/**
 * `ctx.plantKey` is deliberately NOT start-cased: it is the user's own CSV plant name
 * ("hw cylinder", "Kitchen/Diner rads"), not schema text, and a user reading this grid
 * should see the name they typed. Only the schema-derived parts — the nested-object
 * prefix parts and the leaf tail — are start-cased.
 */
function leafControlLabel(key: string, childSchema: unknown, ctx: PlantControlCtx): string | undefined {
  const tail = titleOrKeyFromSchema(key, childSchema);
  const prefixParts: string[] = [];
  if (ctx.multiPlant) prefixParts.push(ctx.plantKey);
  prefixParts.push(...ctx.pathLabels);
  if (prefixParts.length === 0) return undefined;
  return [...prefixParts, tail].join(' · ');
}

/**
 * The ONE control a plant with no expandable properties renders: the whole thing as a
 * JSON blob.
 *
 * When the key is a USER PLANT NAME, R4.6b-3 states the label EXPLICITLY where it used to
 * be left undefined for `DirectAdvancedFields` to fill in from
 * `labelForProperty(plantKey, …)`. Byte-identical output — Core's five plant routes still
 * read "Hp", "Boiler", "Cooler", "Hw Cylinder", "Zone 1 Circuit" — and that is the point:
 * `labelForProperty` now runs the label CONTENT rule, which is a rule about SCHEMA TEXT.
 * A plant key is not schema text; it is a name the user typed into a CSV, and putting it
 * through the rule spells `hp` as "HP" off the acronym dictionary. Start-cased, not raw,
 * because that is what these five rows have always rendered; the RAW plant key is used
 * for the multi-plant PREFIX (`leafControlLabel`), a different decision documented there.
 *
 * When the key is a SCHEMA property — every key of `System:InfiltrationVentilation`, and
 * FHS `HotWaterDemand`'s `Bath`/`Shower`/`Other` — the label is left undefined on purpose
 * and the content rule runs, which is what turns "Mechanicalventilation" into "Mechanical
 * Ventilation" and keeps Core's curated "ACH Maximum Static Calcs". Getting this arm
 * wrong is not subtle: labelling those blindly with the key froze eight
 * InfiltrationVentilation rows at their start-cased key, including the two `ach_*` rows
 * that FHS needs the acronym dictionary for.
 */
function plantBlobControl(scopePrefix: string, ctx: PlantControlCtx): AdvancedFieldsLayoutNode {
  return {
    type: 'Control',
    scope: scopePrefix,
    ...(ctx.plantKeysAreUserNames ? { label: startCaseKey(ctx.plantKey) } : {}),
  };
}

/**
 * VerticalLayout + Control only, deliberately no `Group`: a `Group` means collapsible
 * accordion chrome, which reads Scenario-style rather than like normal Advanced Fields,
 * where every plant's rows are visible at once. Groups are still rendered elsewhere —
 * `DirectSpecFields`' `Group` branch (`components/DirectAdvancedFields.tsx`) mounts
 * `GroupAccordion` (`components/jsonformsRenderers.tsx`) for web's fabric/snippet specs
 * — but the System layout walk this module feeds (`renderLayoutNode`, same file) has no
 * `Group` branch at all, which is why `AdvancedFieldsLayoutNode` above does not name
 * one either.
 */
function buildControlsForSchema(schema: unknown, scopePrefix: string, ctx: PlantControlCtx): AdvancedFieldsLayoutNode[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return [plantBlobControl(scopePrefix, ctx)];
  }
  const s = schema as Record<string, unknown>;
  const props = s.properties;
  if (props && typeof props === 'object' && !Array.isArray(props) && Object.keys(props).length > 0) {
    const keys = sortPropertyKeys(Object.keys(props as Record<string, unknown>));
    const out: AdvancedFieldsLayoutNode[] = [];
    for (const key of keys) {
      const childSchema = (props as Record<string, unknown>)[key];
      // R4.3b: escape the raw schema/plant key into an RFC-6901 pointer token before
      // interpolating it into the scope. A no-op for well-behaved schema keys (never
      // contain '/' or '~'); load-bearing for plant keys, which are raw user CSV
      // names and may contain either. Labels (below) are never pointer-escaped —
      // escaping applies to scopes only. (R4.6b-1 start-cases the schema-derived label
      // parts; that is display formatting, not escaping, and the plant key stays raw.)
      const childScope = `${scopePrefix}/properties/${encodePointerToken(key)}`;
      if (shouldRecurseIntoNestedObject(childSchema)) {
        const nextPathLabels = key === 'HeatSource'
          ? ctx.pathLabels
          : [...ctx.pathLabels, startCaseKey(key)];
        const childElements = buildControlsForSchema(childSchema, childScope, {
          ...ctx,
          pathLabels: nextPathLabels,
        });
        // Hot water `HeatSource` is a map of named heaters; the Heat Source control above covers the
        // main choice. Hoist inner controls so we do not add a redundant HeatSource
        // section wrapper (scopes stay under .../HeatSource/...).
        if (key === 'HeatSource') {
          out.push(...childElements);
        } else {
          out.push({
            type: 'VerticalLayout',
            elements: childElements,
          });
        }
      } else {
        const isPlantRootType = ctx.pathLabels.length === 0 && key === 'type';
        if (isPlantRootType) {
          continue;
        }
        // `HeatSource` is a map: JsonForms only recurses when keys are materialised as `properties`.
        // Otherwise a single Control binds to an object and renders as "[object Object]". The Heat Source
        // picker + hoisted per-heater controls cover editing; skip the broken blob control.
        if (key === 'HeatSource' && !shouldRecurseIntoNestedObject(childSchema)) {
          continue;
        }
        const label = leafControlLabel(key, childSchema, ctx);
        const control: AdvancedFieldsLayoutNode = {
          type: 'Control',
          scope: childScope,
          ...(label ? { label } : {}),
        };
        out.push(control);
      }
    }
    return out;
  }
  return [plantBlobControl(scopePrefix, ctx)];
}

/**
 * Flat list of controls (same JsonForms path as other geometry Advanced Fields): no accordion
 * `Group` per plant. When several plants exist under one subtype, labels are prefixed with the
 * plant key so identical schema keys (e.g. `type`) stay distinguishable.
 *
 * R4.3b FIX: `subtype` and every `plantKey` are raw user CSV names (e.g. "Kitchen/Diner
 * rads", "Zone 1.5 circuit") interpolated directly into JSON-Pointer scopes below. A
 * raw '/' broke `resolveSchemaPointer` (it splits the ref on '/'); a raw '.' broke
 * `DirectAdvancedFields.tsx`'s direct-path dot-path round-trip (the layout-spec walk
 * used to join/split scopes on '.'). Both interpolation sites now run every key
 * through `encodePointerToken` (RFC 6901: '~' -> '~0', '/' -> '~1') before building the
 * scope string, and `DirectAdvancedFields.tsx` decodes each pointer segment instead of
 * treating the scope as a dot-joinable string — see `segmentsFromLayoutScope` there.
 * This is a no-op for ordinary schema keys (snake_case/PascalCase HEM property names
 * never contain '/' or '~'), so it makes the builder correct by construction rather
 * than trading one bug for another. LABELS keep the raw, unescaped PLANT key (below,
 * unchanged by this fix and by R4.6b-1's start-casing, which touches schema-derived
 * label parts only) — a user reading "Kitchen/Diner rads · …" should see their own
 * plant name, neither pointer-escaped nor re-cased.
 */
export function buildSystemAdvancedUischema(
  subtype: string,
  subschema: Record<string, unknown>,
): AdvancedFieldsLayoutNode {
  const rootProps = subschema.properties as Record<string, unknown> | undefined;
  const inner = rootProps?.[subtype] as Record<string, unknown> | undefined;
  const plantProps = inner?.properties as Record<string, unknown> | undefined;
  if (!plantProps || Object.keys(plantProps).length === 0) {
    return { type: 'VerticalLayout', elements: [] };
  }

  const plantKeys = sortPropertyKeys(Object.keys(plantProps));
  const multiPlant = plantKeys.length > 1;
  // R4.6b-3: see `PlantControlCtx.plantKeysAreUserNames`. Absent (every subtype whose
  // plants were never expanded from a merge map) means these keys are schema properties,
  // which is the safe default — it puts them through the label content rule.
  const plantKeysAreUserNames = inner?.[PLANT_KEYS_ARE_USER_NAMES] === true;
  const elements: AdvancedFieldsLayoutNode[] = [];

  for (const plantKey of plantKeys) {
    const plantSchema = plantProps[plantKey];
    // R4.3b: escape both interpolated keys (see the docstring above) -- plantKey is a
    // raw user CSV name, subtype is schema-fixed today but escaped uniformly for the
    // same reason every other interpolation site here is: a no-op for well-behaved
    // keys, correct by construction for ones that are not.
    const baseScope = `#/properties/${encodePointerToken(subtype)}/properties/${encodePointerToken(plantKey)}`;
    elements.push(
      ...buildControlsForSchema(plantSchema, baseScope, {
        plantKey,
        multiPlant,
        plantKeysAreUserNames,
        pathLabels: [],
      }),
    );
  }

  return { type: 'VerticalLayout', elements };
}
