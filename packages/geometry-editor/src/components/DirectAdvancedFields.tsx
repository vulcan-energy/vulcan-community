// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * R4.3: render the existing custom JsonForms Advanced Fields controls directly off a
 * resolved subschema (or, for System, a layout spec from `../lib/systemAdvancedUischema`),
 * with no <JsonForms> dispatch and no generated uischema. Generalized from the R4.2
 * ElectricBattery-only spike to every element type; default-ON, behind the fallback
 * kill-switch in `../lib/directRenderAdvancedFieldsFlag`. This module must not import
 * anything from `@jsonforms/*` — every prop shape below is inferred structurally from
 * the control components themselves (`React.ComponentProps<typeof TextControl>`,
 * etc.), matching the cast pattern in `__tests__/jsonformsRenderers.units.test.tsx`.
 */

import React from 'react';
import { dereferenceSchemaNodeInRoot } from '../lib/subschemaCache';
import { resolveSchemaPointer } from '../lib/schemaRefResolver';
import { readRecord } from '../lib/jsonTypes';
import type { AdvancedFieldsLayoutNode } from '../lib/systemAdvancedUischema';
import {
  BooleanControl,
  EnumControl,
  NumberControl,
  TextControl,
  WindowPartListControl,
  schemaHasConstAlternatives,
  schemaHasEnum,
  schemaTypeList,
  validateAdvancedFieldPrimitive,
} from './jsonformsRenderers';

export type DirectAdvancedFieldsProps = {
  /** The built subschema (has .properties, maybe .$defs, maybe .required) — same object AdvancedFieldsEditor passes to <JsonForms schema={...}>. */
  schema: Record<string, unknown>;
  /** advancedFieldsData — the flat extra_json record for this element. */
  data: Record<string, unknown>;
  /** The SAME jsonFormsConfig object the JsonForms mount gets. */
  config: Record<string, unknown>;
  /**
   * System only: the manually-built layout spec from `buildSystemAdvancedUischema`.
   * When present, the property walk below is driven by this tree instead of
   * `schema.properties` — System's OFF path mounts this SAME spec as the JsonForms
   * `uischema` prop rather than letting JsonForms auto-generate one, so matching it
   * here (not `schema.properties`) is what parity means for System.
   */
  layout?: AdvancedFieldsLayoutNode;
  onDataChange: (next: Record<string, unknown>) => void;
};

// Prop shape accepted by the five custom controls, inferred (not imported) from the
// control components themselves so this module never touches `@jsonforms/*` types.
type DirectControlProps = React.ComponentProps<typeof TextControl>;

/**
 * Control picker for the direct-render path. R4.3 amendment (post-review design
 * change, Baz-approved): Advanced Fields UI must not change AT ALL for this slice —
 * zero intentional divergences, not even ones that look like corrections. This is
 * therefore an EXECUTED-table port, not a written-table one: it reproduces exactly
 * what the `standardRenderers` tester table (bottom of `components/jsonformsRenderers.tsx`)
 * actually dispatches to under the FLAT generated-uischema (verified empirically on
 * @jsonforms 3.6.0, adversarial-review finding kept from the R4.2 spike): JsonForms
 * hands every TESTER the unresolved PARENT object schema, not the scoped property, so
 * only testers that resolve the scope THEMSELVES (`@jsonforms/core`'s own
 * `isBooleanControl` / `isNumberControl` / `isIntegerControl` / `isStringControl`,
 * each built on `schemaMatches` -> `resolveSchema`) can ever see the real per-property
 * type; our OWN rank-1000/1100 enum testers and the rank-5 GenericControl fallback
 * either read the wrong (parent) schema or are only reached once every built-in typed
 * tester has already failed to match.
 *
 * Net dispatch order, evaluated against the RESOLVED property schema:
 *  (a) leaf key `window_part_list` -> WindowPartListControl (handled by the caller,
 *      before this function runs — see `renderControlForProperty`).
 *  (b) type list includes 'boolean' -> BooleanControl, EVEN IF an enum/oneOf-const is
 *      also present (rank-90 `isBooleanControl` wins outright; the rank-1000/1100 enum
 *      testers never fire here since they read the parent schema's `.enum`, not the
 *      resolved property's). This is what keeps `security_risk` (FHS: `{type:
 *      'boolean', enum:[true,false]}`) a plain checkbox on BOTH paths — verified by
 *      mounting OFF directly: BooleanControl's checkbox renders, not EnumControl's
 *      dropdown, despite the schema literally carrying `.enum`.
 *  (c) type list includes 'string' -> TextControl, EVEN IF an enum is present (rank-80
 *      `isStringControl` wins; TextControl's OWN `extractOptions` fallback renders the
 *      identical StandardDropdown component an inline/$ref'd string enum needs — see
 *      the `battery_location` $ref probe test, now updated to assert this).
 *  (d) type list includes 'number' -> NumberControl (ranks 280/90; `isNumberControl`
 *      matches the EXACT type 'number' only — `integer` does NOT match it, see (f)).
 *  (e) anyOf number|null -> falls to (f) -> TextControl, NOT NumberControl. None of
 *      the built-in typed testers match an anyOf-only schema (their `hasType` ->
 *      `deriveTypes` does not derive a type from a bare `anyOf` — only from `type` /
 *      `properties` / `additionalProperties` / `items` / `enum` / `allOf`), and
 *      GenericControl's dispatch sees no enum/boolean/number/integer either. (No live
 *      HEM property currently has this exact shape — `area_per_perimeter_vent`, the
 *      R4.2 spike's cited example, is actually a plain `{type:'number'}` in both Core
 *      and FHS, verified by mounting both paths directly: BOTH already render
 *      NumberControl with identical `min`/`data-exclusive-minimum` attributes, so
 *      that was a stale docstring claim, never an actual divergence.)
 *  (f) everything else — integer, object, array, type-less, bare combinators — reaches
 *      rank-5 GenericControl, whose resolved-schema dispatch checks ENUM-LIKE FIRST
 *      (`.enum`, or oneOf/anyOf where every branch is a bare `const`) -> EnumControl —
 *      this is how `{type:'integer', oneOf:[{const,title},…]}`
 *      (`ecodesign_control_class`) gets EnumControl on the OFF path (adversarial-review
 *      REAL finding; an earlier draft of this picker ordered integer first and
 *      diverged visibly in the unset state) — then boolean (dead here, claimed by (b)),
 *      then number/INTEGER -> NumberControl, else TextControl.
 *
 * DEFERRED to a follow-up slice (R4.3b, tracked in the parent repo's
 * docs/development/Community_Repo_Refactor_Plan.md): the WRITTEN-table corrections
 * this file's R4.2/early-R4.3 draft made — routing boolean+enum and string+enum to
 * EnumControl ahead of type, and anyOf-nullable-number to NumberControl. Those are
 * real UI improvements (EnumControl forwards validation error text; Text/NumberControl's
 * duplicate enum fallback does not) but are OUT OF SCOPE for a slice whose only job is
 * flipping the default with an UNCHANGED UI. Do not reintroduce them here.
 *
 * A nested object-typed property (e.g. MechanicalVentilation FHS's `position_exhaust`
 * in its non-flat mode) needs NO special case: the generator does not recurse past the
 * schema root (verified against `generateUISchema` in node_modules/@jsonforms/core —
 * the `currentRef === '#' && types[0] === 'object'` recursion guard only ever fires
 * for the very first call), so a nested object property gets ONE flat Control bound to
 * the whole object, which falls through every typed tester (rule (b)-(e) all miss:
 * type is 'object') to rule (f) -> not enum-like -> 'text' -> TextControl's own
 * `isJsonLike` branch JSON.stringifies the object. Mounting both paths against the
 * same MechanicalVentilation FHS position_exhaust fixture confirms OFF and ON render
 * the identical single blob row, byte-for-byte, with zero code here dedicated to it
 * (see `AdvancedFieldsEditor.directParity.test.tsx`, "MechanicalVentilation, non-MVHR:
 * position_exhaust nested-object blob" — config 5 in the matrix is MVHR specifically,
 * per the brief, which never reaches position-object mode; this is exercised in a
 * dedicated adjacent test instead).
 *
 * Remaining KNOWN divergence, judged unreachable rather than fixed (kept from the
 * R4.2 spike, still applies): degenerate empty `oneOf: []` (invalid JSON Schema) — the
 * commit-1 local port fell through to 'text'; the shared `schemaHasConstAlternatives`
 * (`[].every` is vacuously true) returns 'enum'. No live HEM schema has this shape.
 *
 * The `Group` accordion renderer (rank 100) is deliberately NOT ported: no Advanced
 * Fields uischema (generated OR manually-built System layout spec) ever emits one.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure picker helper, not a React component.
export function pickDirectControl(resolved: Record<string, unknown>): 'enum' | 'number' | 'boolean' | 'text' {
  const types = schemaTypeList(resolved);
  if (types.includes('boolean')) return 'boolean';
  if (types.includes('string')) return 'text';
  if (types.includes('number')) return 'number';

  // Everything else — integer, object, array, type-less, bare anyOf/oneOf — fell
  // through every built-in typed tester on the OFF path (isNumberControl matches the
  // exact type 'number' only; deriveTypes derives nothing from a bare anyOf) and
  // reached rank-5 GenericControl, whose own dispatch checks enum-like BEFORE type.
  // Adversarial-review REAL finding (R4.3): `ecodesign_control_class`
  // ({type:'integer', oneOf:[{const,title},…]} via applyEcodesignControlClassEnum)
  // therefore renders EnumControl on the OFF path — an integer-before-enum order here
  // rendered NumberControl's dropdown fallback instead, visibly diverging in the
  // unset state (placeholder text, the "Copy example" action, and the forwarded
  // required-error). Enum-before-integer below is load-bearing.
  if (
    schemaHasEnum(resolved) ||
    schemaHasConstAlternatives(resolved, 'oneOf') ||
    schemaHasConstAlternatives(resolved, 'anyOf')
  ) {
    return 'enum';
  }
  if (types.includes('integer')) return 'number';
  return 'text';
}

/**
 * R4.3 (Stage 2.5): mirrors `@jsonforms/core`'s `generateUISchema` type-derivation
 * gate for whether the FLAT (non-System) generator emits a control for a property AT
 * ALL. Verified against node_modules/@jsonforms/core: combinators (non-empty
 * oneOf/anyOf/allOf) always get a control (`isCombinator` short-circuits before
 * `deriveTypes` runs); otherwise a property needs some derivable type — an
 * explicit/array `type`, non-empty `properties`/`additionalProperties` (implies
 * object), non-empty `items` (implies array), or a non-empty `enum` — approximating
 * `deriveTypes`. A schema with none of these (const-only, or genuinely type-less)
 * derives no type; the generator's `types.length === 0` branch returns null without
 * pushing anything to `schemaElements`, so the property never gets a control at all.
 * KNOWN over-approximation (adversarial review, unreachable in both live schemas):
 * `deriveTypes` derives enum types from the enum VALUES via lodash `isEmpty`, so an
 * all-numeric/boolean enum ({enum:[1,2]}), `additionalProperties: true`, or empty
 * `items` derive NOTHING there (generator drops the property) while this gate emits a
 * control. Every live type-less enum is all-string; tighten alongside R4.3b if a
 * schema update ever adds such a shape.
 *
 * System's layout-spec mode does NOT use this gate: its Control nodes come from
 * `buildSystemAdvancedUischema` (unchanged, no type gate of its own — every property
 * present in the plant schema gets a Control), which is exactly the uischema the
 * JsonForms OFF mount for System renders verbatim (it is passed as the `uischema`
 * prop, bypassing JsonForms' own generator entirely). Matching that spec exactly,
 * gate-free, is what parity means for System.
 */
function schemaEmitsControl(resolved: Record<string, unknown>): boolean {
  if (Object.keys(resolved).length === 0) return false;
  if (Array.isArray(resolved.oneOf) && resolved.oneOf.length > 0) return true;
  if (Array.isArray(resolved.anyOf) && resolved.anyOf.length > 0) return true;
  if (Array.isArray(resolved.allOf) && resolved.allOf.length > 0) return true;

  if (schemaTypeList(resolved).length > 0) return true;

  const properties = resolved.properties;
  const hasProperties =
    !!properties &&
    typeof properties === 'object' &&
    !Array.isArray(properties) &&
    Object.keys(properties as Record<string, unknown>).length > 0;
  if (hasProperties || !!resolved.additionalProperties) return true;

  if (resolved.items !== undefined && resolved.items !== null) return true;

  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) return true;

  return false;
}

/**
 * Local start-case helper for schema keys with no `title`, e.g. `battery_age` ->
 * `Battery Age`, `EnergySupply` -> `Energy Supply`.
 *
 * R4.3 FINDING (generalizing past ElectricBattery surfaced this): the R4.2 spike's
 * original version only split on `_`, since every ElectricBattery key was snake_case.
 * OnSiteGeneration FHS's `EnergySupply` (a PascalCase key with no schema `title`)
 * broke that: OFF -- JsonForms' own `addLabel`/label-derivation for a Control with no
 * explicit uischema `label` falls back to `title` if present, else lodash
 * `startCase(scopeSegment)` (see node_modules/@jsonforms/core), which DOES split
 * camelCase/PascalCase boundaries -- rendered "Energy Supply"; the R4.2-era version
 * here rendered "EnergySupply" verbatim. This is now fixed by splitting at
 * lowercase->uppercase and acronym-run->titlecase boundaries too, matching lodash
 * `startCase`'s `words()` closely enough for the ASCII identifier-style keys HEM
 * schemas use (ordinary snake_case, PascalCase, camelCase, and digit runs) --
 * `words()`'s full Unicode-script handling is out of scope, nothing in these schemas
 * needs it.
 */
function startCaseKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .split(/[_\-\s]+/)
    .filter((word) => word.length > 0);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * Label for one property: `resolved.title` if present, else start-cased key.
 *
 * SPIKE FINDING (still holds under R4.3): no `*` is appended for required fields,
 * even though JsonForms core's own `computeLabel(label, required, hideRequiredAsterisk)`
 * would append one. None of TextControl / NumberControl / BooleanControl / EnumControl
 * in jsonformsRenderers.tsx read the `required` prop or call `computeLabel` — the OFF
 * path never renders a required-asterisk today (verified in
 * `AdvancedFieldsEditor.electricBattery.test.tsx`, "OFF-path characterization"). The
 * R4.2 brief's original spec ("append '*' … mirrors JsonForms' computeLabel") does not
 * hold for this renderer stack; matching the OFF path (not the brief) is what parity
 * means.
 */
function labelForProperty(key: string, resolved: Record<string, unknown>): string {
  const title = resolved.title;
  return typeof title === 'string' && title.trim() ? title : startCaseKey(key);
}

/** `#/properties/a/properties/b/properties/c` -> `a.b.c` (System layout-spec scopes). */
function pathFromLayoutScope(scope: string): string {
  const stripped = scope.startsWith('#/properties/') ? scope.slice('#/properties/'.length) : scope;
  return stripped.split('/properties/').join('.');
}

function leafKeyFromPath(path: string): string {
  const segments = path.split('.');
  return segments[segments.length - 1] ?? path;
}

/** Walk `data` along a dot-separated path; undefined at any missing/non-object hop. */
function getAtPath(data: Record<string, unknown>, path: string): unknown {
  let current: unknown = data;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Immutable nested set/delete along a dot-separated path (Stage 2.1): clones each
 * object hop with `{...}`, and either sets or deletes the leaf. `value === undefined`
 * deletes the leaf key outright (matches the top-level spike behaviour, extended to
 * every hop). Intermediate objects are left in place even if the delete empties them
 * — this is NOT a stylistic choice, it matches what the OFF path's own JsonForms core
 * reducer does: `UPDATE_DATA`'s unset branch is `lodash/fp/unset(path, data)`
 * (verified in node_modules/@jsonforms/core), which only removes the leaf and never
 * prunes now-empty ancestors. A missing intermediate hop is created as `{}` on set,
 * matching `lodash/fp/set`'s own auto-vivification. One divergence, currently
 * unreachable (reset buttons only render when a value exists): DELETE along a missing
 * intermediate hop vivifies `{}` ancestors here where `lodash/fp/unset` is a no-op.
 */
function setAtPath(obj: Record<string, unknown>, segments: string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = segments;
  const next = { ...obj };
  if (rest.length === 0) {
    if (value === undefined) {
      delete next[head];
    } else {
      next[head] = value;
    }
    return next;
  }
  const childRaw = next[head];
  const child =
    childRaw && typeof childRaw === 'object' && !Array.isArray(childRaw) ? (childRaw as Record<string, unknown>) : {};
  next[head] = setAtPath(child, rest, value);
  return next;
}

/**
 * Renders one property's control, shared by the flat walk and the layout-spec walk.
 * A plain function (not a JSX component) deliberately: it is reconstructed on every
 * `DirectAdvancedFields` render (closures aside, it takes everything as arguments), so
 * using it as a component TYPE (`<renderControlForProperty/>`) would give React a
 * fresh identity every render and force-remount every control underneath. Calling it
 * as a function and returning the real control elements (EnumControl, NumberControl,
 * …) keeps their identity stable across renders instead.
 */
function renderControlForProperty(args: {
  path: string;
  leafKey: string;
  resolved: Record<string, unknown>;
  value: unknown;
  label: string;
  scope: string;
  schema: Record<string, unknown>;
  config: Record<string, unknown>;
  elementType: string | undefined;
  required: boolean;
  /**
   * Layout-spec (System) mode only. Empirical asymmetry (adversarial probes, both
   * verified live): the OFF path's Ajv errors DO reach EnumControl for
   * required-and-unset fields in System's layout-spec mount
   * (`ecodesign_control_class` shows "is a required property"), but do NOT in flat
   * generated-uischema mounts (OnSiteGeneration FHS's `ventilation_strategy` IS
   * required in the schema, was probed unset, and renders error-free on both paths).
   * Replicating the message in flat mode would therefore CREATE a divergence, not fix
   * one.
   */
  replicateRequiredError: boolean;
  handleChange: (path: string, value: unknown) => void;
}): React.ReactElement {
  const { path, leafKey, resolved, value, label, scope, schema, config, elementType, required, replicateRequiredError, handleChange } = args;

  const baseProps = {
    data: value,
    path,
    label,
    schema: resolved,
    uischema: { type: 'Control', scope },
    config,
    enabled: true,
    visible: true,
    required,
    id: `direct-${path}`,
    handleChange,
    rootSchema: schema,
  };

  // Stage 2.2: window_part_list routes to WindowPartListControl BEFORE the type-based
  // picker, mirroring GenericControl's own special case (jsonformsRenderers.tsx:2384)
  // — it is an array-typed property that would otherwise never reach a sane control
  // via pickDirectControl (no enum/number/boolean match, falls to 'text', which would
  // JSON-blob the row instead of the real multi-row editor).
  if (leafKey === 'window_part_list') {
    return (
      <WindowPartListControl key={path} {...({ ...baseProps, errors: '' } as unknown as DirectControlProps)} />
    );
  }

  const control = pickDirectControl(resolved);
  const validation = validateAdvancedFieldPrimitive(
    config as Parameters<typeof validateAdvancedFieldPrimitive>[0],
    elementType,
    leafKey,
    value,
  );
  // Of the five controls, only EnumControl forwards this string to its input
  // (StandardDropdown `error`); Number/Boolean/Text/WindowPartListControl ignore the
  // prop and self-validate. Control IDENTITY parity (this slice's whole point) does
  // not depend on this string's exact contents; whatever nuance remains between this
  // field-scoped validation and the OFF path's own Ajv-driven `errors` plumbing is
  // deferred alongside the written-table corrections noted in the module docstring.
  let errors = (validation.errors ?? []).join('\n');
  if (replicateRequiredError && control === 'enum' && required && value === undefined && !errors) {
    // OFF-path parity (adversarial probe, System/ecodesign_control_class): for a
    // required-and-unset field, EnumControl on the JsonForms path forwards
    // @jsonforms/core's defaultErrorTranslator required message verbatim.
    // validateAdvancedFieldPrimitive deliberately never emits required errors
    // (Advanced Fields are mostly-empty-by-design), so replicate the exact message
    // for this one state. Set-but-invalid values could differ in message TEXT between
    // the two validators, but no live shape reaches that state through the dropdown
    // UI (options are schema-sourced). Goes away with the flags in R4.4.
    errors = 'is a required property';
  }
  const controlProps = { ...baseProps, errors } as unknown as DirectControlProps;

  switch (control) {
    case 'enum':
      return <EnumControl key={path} {...controlProps} />;
    case 'number':
      return <NumberControl key={path} {...controlProps} />;
    case 'boolean':
      return <BooleanControl key={path} {...controlProps} />;
    default:
      return <TextControl key={path} {...controlProps} />;
  }
}

export function DirectAdvancedFields({
  schema,
  data,
  config,
  layout,
  onDataChange,
}: DirectAdvancedFieldsProps): React.ReactElement {
  const properties = readRecord(schema.properties);
  const requiredList = Array.isArray(schema.required)
    ? (schema.required as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const elementType = typeof config.elementType === 'string' ? config.elementType : undefined;

  // Resolution root for $ref lookups, built once per render (cheap: just wraps the
  // $defs the property schemas point into). Falls back to config.$defs the same way
  // AdvancedFieldsEditor's jsonFormsConfig does ("Pass $defs through config so
  // TextControl can resolve references") for callers that hand DirectAdvancedFields an
  // unfiltered subschema without its own $defs (see the EnumControl $ref probe test).
  const defs = (schema as { $defs?: unknown }).$defs ?? (config as { $defs?: unknown }).$defs;
  const resolutionRoot = { $defs: defs };

  const handleChange = React.useCallback(
    (path: string, value: unknown) => {
      onDataChange(setAtPath(data, path.split('.'), value));
    },
    [data, onDataChange],
  );

  function renderLayoutNode(node: AdvancedFieldsLayoutNode, key: React.Key): React.ReactElement | null {
    if (node.type === 'VerticalLayout') {
      // Stage 2.3: nesting is visual-only today (no Group/accordion chrome in Advanced
      // Fields uischemas) — a plain div reproduces that with no extra styling.
      return <div key={key}>{(node.elements ?? []).map((child, i) => renderLayoutNode(child, i))}</div>;
    }
    if (!node.scope) return null;
    const path = pathFromLayoutScope(node.scope);
    const leafKey = leafKeyFromPath(path);
    // Stage 2.3: resolve the property schema by walking the SAME pointer (the node's
    // `scope`) through `schema` that buildSystemAdvancedUischema used to build the
    // scope in the first place, then $ref-resolve exactly like the flat walk does.
    const propertySchemaNode = resolveSchemaPointer(schema, node.scope);
    const resolved = readRecord(dereferenceSchemaNodeInRoot(propertySchemaNode, resolutionRoot));
    const label = node.label ?? labelForProperty(leafKey, resolved);
    const value = getAtPath(data, path);
    // Required from the PARENT schema's `required` list, mirroring how the OFF path's
    // Ajv required-missing errors attach to this control (adversarial-review finding:
    // the required-error replication in renderControlForProperty needs this to fire
    // for nested System fields like ecodesign_control_class; the `required` PROP
    // itself is still unused by every control).
    const parentScopeEnd = node.scope.lastIndexOf('/properties/');
    const parentSchema =
      parentScopeEnd > 0
        ? readRecord(
            dereferenceSchemaNodeInRoot(resolveSchemaPointer(schema, node.scope.slice(0, parentScopeEnd)), resolutionRoot),
          )
        : schema;
    const parentRequired = Array.isArray(parentSchema.required)
      ? (parentSchema.required as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    return renderControlForProperty({
      path,
      leafKey,
      resolved,
      value,
      label,
      scope: node.scope,
      schema,
      config,
      elementType,
      required: parentRequired.includes(leafKey),
      replicateRequiredError: true,
      handleChange,
    });
  }

  // Property walk deliberately mirrors JsonForms' generated-uischema enumeration:
  // `Object.keys(schema.properties)` insertion order. Iteration order is load-bearing
  // — review history: ordering drift is the one bug class that has survived review in
  // this file. Do not "helpfully" sort these keys.
  const flatEntries: { key: string; resolved: Record<string, unknown> }[] = [];
  if (!layout) {
    for (const key of Object.keys(properties)) {
      const resolved = readRecord(dereferenceSchemaNodeInRoot(properties[key], resolutionRoot));
      if (schemaEmitsControl(resolved)) {
        flatEntries.push({ key, resolved });
      }
    }
  }

  return (
    <div data-testid="direct-advanced-fields">
      {layout
        ? renderLayoutNode(layout, 'root')
        : flatEntries.map(({ key, resolved }) =>
            renderControlForProperty({
              path: key,
              leafKey: key,
              resolved,
              value: data[key],
              label: labelForProperty(key, resolved),
              scope: `#/properties/${key}`,
              schema,
              config,
              elementType,
              required: requiredList.includes(key),
              replicateRequiredError: false,
              handleChange,
            }),
          )}
    </div>
  );
}
