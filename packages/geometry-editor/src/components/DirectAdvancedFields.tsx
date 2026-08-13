// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * R4.3: render the existing custom JsonForms Advanced Fields controls directly off a
 * resolved subschema (or, for System, a layout spec from `../lib/systemAdvancedUischema`),
 * with no <JsonForms> dispatch and no generated uischema. Generalized from the R4.2
 * ElectricBattery-only spike to every element type. R4.4 retired the legacy JsonForms
 * mount and its fallback kill-switch (formerly `../lib/directRenderAdvancedFieldsFlag`),
 * so this is now the only Advanced Fields render path. This module must not import
 * anything from `@jsonforms/*` — every prop shape below is inferred structurally from
 * the control components themselves (`React.ComponentProps<typeof TextControl>`,
 * etc.), matching the cast pattern in `__tests__/jsonformsRenderers.units.test.tsx`.
 *
 * R4.3b: the System layout-spec walk below is SEGMENT-safe, not dot-string-safe — see
 * `segmentsFromLayoutScope` and `../lib/systemAdvancedUischema`'s own docstring. Raw
 * user plant-key names (CSV-derived) may contain '/' or '.', either of which used to
 * corrupt the walk (a '/' broke `resolveSchemaPointer`'s pointer split; a '.' broke
 * this file's own dot-path round-trip).
 */

import React from 'react';
import { dereferenceSchemaNodeInRoot } from '../lib/subschemaCache';
import { decodePointerToken, resolveSchemaPointer } from '../lib/schemaRefResolver';
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
   * `schema.properties` — System's retired JsonForms path mounted this SAME spec as
   * the JsonForms `uischema` prop rather than letting JsonForms auto-generate one, so
   * matching it here (not `schema.properties`) is what parity meant for System.
   */
  layout?: AdvancedFieldsLayoutNode;
  onDataChange: (next: Record<string, unknown>) => void;
};

// Prop shape accepted by the five custom controls, inferred (not imported) from the
// control components themselves so this module never touches `@jsonforms/*` types.
type DirectControlProps = React.ComponentProps<typeof TextControl>;

/**
 * Control picker for the direct-render path.
 *
 * HISTORY (R4.3, Baz-approved post-review design change): Advanced Fields UI was
 * required not to change AT ALL for that slice — zero intentional divergences, not
 * even ones that look like corrections. This function was therefore an EXECUTED-table
 * port, not a written-table one: it reproduced exactly what the `standardRenderers`
 * tester table (bottom of `components/jsonformsRenderers.tsx`) actually dispatched to
 * under the FLAT generated-uischema on the (now-deleted) JsonForms mount, bugs
 * included (verified empirically on @jsonforms 3.6.0, adversarial-review finding kept
 * from the R4.2 spike): JsonForms hands every TESTER the unresolved PARENT object
 * schema, not the scoped property, so only testers that resolve the scope THEMSELVES
 * (`@jsonforms/core`'s own `isBooleanControl` / `isNumberControl` / `isIntegerControl`
 * / `isStringControl`, each built on `schemaMatches` -> `resolveSchema`) could ever
 * see the real per-property type; our OWN rank-1000/1100 enum testers and the rank-5
 * GenericControl fallback either read the wrong (parent) schema or were only reached
 * once every built-in typed tester had already failed to match. Net effect: BOOLEAN
 * and STRING type outranked ENUM-ness outright — a boolean-with-enum
 * (`security_risk`) rendered a plain checkbox, and a string-with-enum
 * (`areal_heat_capacity`, `mass_distribution_class`, `shield_fact_location`,
 * `ColdWaterSource`, the `battery_location` $ref probe, …) rendered TextControl's own
 * `extractOptions` dropdown fallback instead of EnumControl — the identical
 * StandardDropdown component either way, but with validation-error forwarding and
 * helper text dropped, since only EnumControl forwards those.
 *
 * R4.3b (this slice, tracked in the parent repo's
 * docs/development/Community_Repo_Refactor_Plan.md, R4 section; Baz-approved, every
 * visual delta screenshot-reviewed before merge): the strict-preservation constraint
 * above is DELIBERATELY LIFTED for exactly this function. Enum-like now wins outright,
 * ahead of type — this is the "written-table correction" the R4.3 docstring used to
 * defer to a follow-up slice; that follow-up is this one. Net effect: every
 * enum-carrying field (boolean-with-enum or string-with-enum) now routes to
 * EnumControl, gaining forwarded validation-error text (visible ON MOUNT for invalid
 * persisted values, where TextControl's fallback hardcoded `error={undefined}` and
 * only ever showed a LOCAL error after an interaction), option-description /
 * "Default: X" helper text, and — for number-coerced enums — a unit adornment.
 * `ecodesign_control_class` ({type:'integer', oneOf:[{const,title},…]}) is unaffected
 * either way: it already reached EnumControl under the OLD order too, via the
 * enum-before-integer check the old fallback rule buried at the bottom
 * (adversarial-review REAL finding, R4.3 — an integer-before-enum order there
 * rendered NumberControl's dropdown fallback instead, visibly diverging in the unset
 * state). Promoting that check to the top of the function (see the function body)
 * changes nothing for that field; it only changes the boolean/string-typed enum
 * fields the old type-first order used to shadow.
 *
 * Net dispatch order, evaluated against the RESOLVED property schema:
 *  (a) leaf key `window_part_list` -> WindowPartListControl (handled by the caller,
 *      before this function runs — see `renderControlForProperty`).
 *  (b) NON-EMPTY enum-like (`.enum` with >=1 member, or a non-empty oneOf/anyOf where
 *      every branch is a bare `const`) -> EnumControl. R4.3b's new leading rule — see
 *      above and `isNonEmptyEnumLike`'s own docstring below for why "non-empty" is
 *      load-bearing here, not a stylistic nicety.
 *  (c) type list includes 'boolean' -> BooleanControl.
 *  (d) type list includes 'string' -> TextControl.
 *  (e) type list includes 'number' OR 'integer' -> NumberControl. (On the retired
 *      JsonForms mount, `isNumberControl` matched the EXACT type 'number' only —
 *      `integer` needed the old fallback rule's own separate check to reach
 *      NumberControl. Folding integer in here changes nothing observable: same
 *      destination control, just one rule instead of two.)
 *  (f) everything else — object, array, type-less, bare anyOf/oneOf not caught by
 *      (b) — TextControl. anyOf number|null falls here too: no live HEM property has
 *      that exact shape — `area_per_perimeter_vent`, the R4.2 spike's cited example,
 *      is actually a plain `{type:'number'}` in both Core and FHS, verified by
 *      mounting both paths directly (back when the JsonForms mount still existed):
 *      BOTH already rendered NumberControl with identical `min`/
 *      `data-exclusive-minimum` attributes, so that was a stale docstring claim,
 *      never an actual divergence.
 *
 * A nested object-typed property (e.g. MechanicalVentilation FHS's `position_exhaust`
 * in its non-flat mode) needs NO special case: the generator does not recurse past the
 * schema root (verified against `generateUISchema` in node_modules/@jsonforms/core —
 * the `currentRef === '#' && types[0] === 'object'` recursion guard only ever fires
 * for the very first call), so a nested object property gets ONE flat Control bound to
 * the whole object. An object schema carries no `.enum`/oneOf-const of its own, so
 * rule (b) still misses it and it still falls through to (f) -> TextControl's own
 * `isJsonLike` branch JSON.stringifies the object — unaffected by R4.3b's reordering,
 * since enum-like-ness was never true for it under either order. Mounting both paths
 * against the same MechanicalVentilation FHS position_exhaust fixture confirmed the
 * retired JsonForms path and the direct path rendered the identical single blob row,
 * byte-for-byte, with zero code here dedicated to it (see
 * `AdvancedFieldsEditor.directRender.test.tsx`, "MechanicalVentilation, non-MVHR:
 * position_exhaust nested-object blob" — config 5 in the matrix is MVHR specifically,
 * per the brief, which never reaches position-object mode; this is exercised in a
 * dedicated adjacent test instead).
 *
 * FIXED (R4.3b adversarial review round 2, REAL finding — this used to be documented
 * here as an unreachable divergence; it was neither): empty `.enum: []` / `oneOf: []`
 * / `anyOf: []` are NOT enum-like for this picker. The shared `schemaHasEnum` /
 * `schemaHasConstAlternatives` exports are vacuously true on an empty array
 * (`[].every(...)` is true) — harmless under the OLD type-first order (a type-bearing
 * schema matched rule (c)/(d) first regardless), but under R4.3b's enum-first
 * promotion that vacuous truth would fire FIRST, routing an empty-alternatives field
 * to EnumControl with ZERO options — permanently uneditable, not merely different.
 * This IS reachable: `lib/systemHotWaterAdvancedSchema.ts`'s
 * `inlineHotWaterSourceHeatSourceWetEnumOnHotWaterSubschema` manufactures
 * `HeatSourceWet: {type:'string', oneOf: []}` whenever an FHS project has a
 * CombiBoiler/HIU/HeatBattery `hw cylinder` and ZERO wet heat-source plants defined
 * yet (its own hint text literally asks the user to type a name: "No defined heat
 * source (wet) names yet. Add a Heat source (wet) system that defines a plant key,
 * then link here." — EnumControl with no options cannot accept that input). `pickDirectControl`
 * therefore requires NON-EMPTY alternatives (`isNonEmptyEnumLike`, mirroring
 * GenericControl's own inline guards on the retired JsonForms path — see its
 * docstring below), so this shape falls through to type dispatch exactly as both the
 * old type-first port and the retired JsonForms path always did: string ->
 * TextControl, a free-text input the user can still type a link name into.
 *
 * The `Group` accordion renderer (rank 100) is deliberately NOT ported: no Advanced
 * Fields uischema (generated OR manually-built System layout spec) ever emits one.
 */

/**
 * NON-EMPTY enum-like, deliberately stricter than the shared `schemaHasEnum` /
 * `schemaHasConstAlternatives` exports from `./jsonformsRenderers`, which are
 * vacuously true on an empty array (`[].every(...)` is true) — exactly matching
 * GenericControl's OWN inline guards instead (`s.enum.length > 0`,
 * `oneOfAnyOfConsts.length > 0`, jsonformsRenderers.tsx ~2386-2389), the control this
 * picker's enum-first rule is standing in for.
 *
 * R4.3b BUGFIX (adversarial review round 2, REAL finding): the shared predicates'
 * vacuous truth is harmless where they're actually used elsewhere (the rank-1000/1100
 * EnumControl registry testers web/ still mounts through `standardRenderers` until
 * R4.5 — pre-existing registry behaviour, deliberately NOT touched by this fix) and
 * was ALSO harmless in this file through R4.3's type-first order (a type-bearing
 * schema matched boolean/string/number before enum-ness was ever consulted). R4.3b's
 * enum-first promotion changed that: without this non-emptiness guard, an
 * empty-alternatives schema would route to EnumControl with ZERO options —
 * permanently uneditable, not merely a cosmetic divergence. This shape is REACHABLE
 * in production, not synthetic: `lib/systemHotWaterAdvancedSchema.ts`'s
 * `inlineHotWaterSourceHeatSourceWetEnumOnHotWaterSubschema` manufactures
 * `HeatSourceWet: {type:'string', oneOf: []}` whenever an FHS project has a
 * CombiBoiler/HIU/HeatBattery `hw cylinder` and ZERO wet heat-source plants defined
 * yet — its own hint text asks the user to type a name ("No defined heat source (wet)
 * names yet. Add a Heat source (wet) system that defines a plant key, then link
 * here."), which a zero-option dropdown cannot accept. With this guard, that shape
 * falls through to ordinary type dispatch (string -> TextControl, a free-text input),
 * matching both the old type-first port and the retired JsonForms path (GenericControl
 * was never vacuous here, so it never diverged either).
 */
function isNonEmptyEnumLike(resolved: Record<string, unknown>): boolean {
  const enumValues = resolved.enum;
  if (schemaHasEnum(resolved) && Array.isArray(enumValues) && enumValues.length > 0) return true;
  const oneOf = resolved.oneOf;
  if (schemaHasConstAlternatives(resolved, 'oneOf') && Array.isArray(oneOf) && oneOf.length > 0) return true;
  const anyOf = resolved.anyOf;
  if (schemaHasConstAlternatives(resolved, 'anyOf') && Array.isArray(anyOf) && anyOf.length > 0) return true;
  return false;
}

// eslint-disable-next-line react-refresh/only-export-components -- pure picker helper, not a React component.
export function pickDirectControl(resolved: Record<string, unknown>): 'enum' | 'number' | 'boolean' | 'text' {
  // R4.3b: NON-EMPTY enum-like wins outright, ahead of type — see the module
  // docstring above and `isNonEmptyEnumLike`'s own docstring for the full
  // before/after rationale (including why "non-empty" is load-bearing, not
  // stylistic). This is also where `ecodesign_control_class`
  // ({type:'integer', oneOf:[{const,title},…]} via applyEcodesignControlClassEnum)
  // has always landed (adversarial-review REAL finding, R4.3: an integer-before-enum
  // order rendered NumberControl's dropdown fallback instead, visibly diverging in
  // the unset state) — promoting the check to the top of the function changes
  // nothing for that field, only for the boolean/string-typed enum fields the old
  // type-first order used to shadow.
  if (isNonEmptyEnumLike(resolved)) {
    return 'enum';
  }
  const types = schemaTypeList(resolved);
  if (types.includes('boolean')) return 'boolean';
  if (types.includes('string')) return 'text';
  if (types.includes('number') || types.includes('integer')) return 'number';
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
 * retired JsonForms mount rendered verbatim for System (it was passed as the
 * `uischema` prop, bypassing JsonForms' own generator entirely). Matching that spec
 * exactly, gate-free, is what parity meant for System.
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
 * broke that: on the retired JsonForms path, JsonForms' own `addLabel`/label-derivation
 * for a Control with no explicit uischema `label` fell back to `title` if present, else
 * lodash `startCase(scopeSegment)` (see node_modules/@jsonforms/core), which DOES split
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
 * SPIKE FINDING (still holds under R4.3/R4.4): no `*` is appended for required fields,
 * even though JsonForms core's own `computeLabel(label, required, hideRequiredAsterisk)`
 * would append one. None of TextControl / NumberControl / BooleanControl / EnumControl
 * in jsonformsRenderers.tsx read the `required` prop or call `computeLabel` — the
 * retired JsonForms path never rendered a required-asterisk either (verified in
 * `AdvancedFieldsEditor.electricBattery.test.tsx`'s direct-render characterization
 * test, back when it still compared against the JsonForms mount). The R4.2 brief's
 * original spec ("append '*' … mirrors JsonForms' computeLabel") did not hold for this
 * renderer stack; matching what the JsonForms path actually did (not the brief) was
 * what parity meant, and the direct path still renders no asterisk today.
 */
function labelForProperty(key: string, resolved: Record<string, unknown>): string {
  const title = resolved.title;
  return typeof title === 'string' && title.trim() ? title : startCaseKey(key);
}

/**
 * Splits a System layout-spec scope (`#/properties/a/properties/b/properties/c`,
 * every token RFC-6901-escaped by `buildSystemAdvancedUischema`) into raw path
 * segments (`['a', 'b', 'c']`). Splitting on the literal '/properties/' delimiter is
 * safe here because escaping turned every raw '/' into '~1' first — no token can
 * contain an unescaped '/' by construction (see
 * `../lib/systemAdvancedUischema`'s docstring). Each segment is then RFC-6901-decoded
 * back to the raw key ('~1' -> '/', '~0' -> '~') the schema/data actually use. Keeps
 * the defensive shape of the function this replaces for a scope that does not start
 * with '#/properties/' (should not happen; every scope here is built by
 * `buildSystemAdvancedUischema` or the flat walk's own literal `#/properties/${key}`)
 * — such a scope is split as-is rather than having a leading segment dropped.
 *
 * R4.3b: replaces the old `pathFromLayoutScope`/`leafKeyFromPath` pair, which joined
 * segments into a single dot-separated string and split it back apart downstream —
 * exactly the scheme a '.' in a raw plant key (e.g. "Zone 1.5 circuit") would corrupt.
 * Everything downstream of this function now carries `segments: string[]` instead of
 * a joined path, until the point (`path = segments.join('.')`, in
 * `renderControlForProperty`) where a dot-joined string is still handed to the control
 * components themselves for their OWN id/propKey derivation — see the residual note
 * there.
 */
function segmentsFromLayoutScope(scope: string): string[] {
  const tokens = scope.split('/properties/');
  const segments = scope.startsWith('#/properties/') ? tokens.slice(1) : tokens;
  return segments.map(decodePointerToken);
}

/** Walk `data` along path segments; undefined at any missing/non-object hop. */
function getAtPath(data: Record<string, unknown>, segments: string[]): unknown {
  let current: unknown = data;
  for (const segment of segments) {
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
 * — this is NOT a stylistic choice, it matches what the retired JsonForms path's own
 * JsonForms core reducer did: `UPDATE_DATA`'s unset branch is `lodash/fp/unset(path,
 * data)` (verified in node_modules/@jsonforms/core), which only removes the leaf and
 * never prunes now-empty ancestors. A missing intermediate hop is created as `{}` on set,
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
  segments: string[];
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
   * verified live before the JsonForms mount was retired): the JsonForms path's Ajv
   * errors DID reach EnumControl for required-and-unset fields in System's
   * layout-spec mount (`ecodesign_control_class` showed "is a required property"),
   * but did NOT in flat generated-uischema mounts (OnSiteGeneration FHS's
   * `ventilation_strategy` IS required in the schema, was probed unset, and rendered
   * error-free on both paths). Replicating the message in flat mode would therefore
   * CREATE a divergence, not fix one.
   *
   * R4.3b: NOT superseded by the enum-first `pickDirectControl` reorder —
   * `validateAdvancedFieldPrimitive` deliberately never emits required errors
   * (Advanced Fields are mostly-empty-by-design), so the System layout-spec path
   * still needs this replicated message. It now ALSO fires for System fields that
   * only became enum-routed because of R4.3b's reordering (any required-and-unset
   * boolean/string-typed enum field in a System plant, not just
   * `ecodesign_control_class`'s pre-existing integer+oneOf shape): on the retired
   * JsonForms path those fields rendered via BooleanControl/TextControl, which
   * ignored the `errors` prop outright, so no required-error ever showed for them.
   * Showing one now is a deliberate R4.3b improvement, not a parity gap.
   */
  replicateRequiredError: boolean;
  applyChange: (segments: string[], value: unknown) => void;
}): React.ReactElement {
  const { segments, resolved, value, label, scope, schema, config, elementType, required, replicateRequiredError, applyChange } = args;

  const path = segments.join('.');
  const leafKey = segments[segments.length - 1] ?? path;

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
    // R4.3b: ignore the string `path` argument a control hands back to its own
    // `handleChange(path, value)` call — that string is the SAME dot-joined `path`
    // above, re-derived by the control itself, and carries the residual '.'-in-a-
    // leaf-segment risk noted below. `segments` is this function's own closed-over,
    // pre-decoded source of truth for where to write, so route every control's
    // change straight through it instead of trusting the string it echoes back.
    handleChange: (_path: string, v: unknown) => applyChange(segments, v),
    rootSchema: schema,
  };
  // R4.3b residual (accepted, out of scope): `path = segments.join('.')` above is
  // still safe for the control components' OWN id/propKey derivation
  // (`jsonformsRenderers.tsx`'s controls each do `path.split('.').pop()`) only
  // because leaf keys are HEM schema property keys, never user names — with one
  // pre-existing exception: the degenerate no-properties-plant Control
  // (`systemAdvancedUischema.ts`'s `buildControlsForSchema` returns
  // `[{ type: 'Control', scope: scopePrefix }]` when a plant schema itself has no
  // `.properties`), where the scope's final segment IS the raw plant key. A plant
  // key containing '.' would still corrupt that downstream split. This is
  // pre-existing and out of scope until the controls stop parsing path strings of
  // their own (R4.5+) — this slice's segment-safety work protects THIS module's own
  // walk/apply, not every control's internal path parsing.

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
  // prop and self-validate. Through R4.3, that forwarding only ever reached a
  // handful of fields (rules (b)-(e) in `pickDirectControl` sent most enum-carrying
  // fields to Boolean/TextControl instead). R4.3b's enum-first `pickDirectControl`
  // means EnumControl now wins for EVERY enum-carrying field, not just the ones
  // type-dispatch used to miss — so this forwarding, previously the exception, is now
  // the common case. That is the headline of this slice: validation errors for an
  // invalid persisted enum value become visible ON MOUNT instead of silently hidden
  // behind TextControl's own hardcoded `error={undefined}`.
  let errors = (validation.errors ?? []).join('\n');
  if (replicateRequiredError && control === 'enum' && required && value === undefined && !errors) {
    // Retired-JsonForms-path parity (adversarial probe, System/ecodesign_control_class):
    // for a required-and-unset field, EnumControl on the (now-deleted) JsonForms mount
    // forwarded @jsonforms/core's defaultErrorTranslator required message verbatim.
    // validateAdvancedFieldPrimitive deliberately never emits required errors
    // (Advanced Fields are mostly-empty-by-design), so replicate the exact message
    // for this one state. Set-but-invalid values could differ in message TEXT between
    // the two validators, but no live shape reaches that state through the dropdown
    // UI (options are schema-sourced). R4.4 retired the JsonForms mount and its
    // fallback flags, so this replication is permanent behaviour of the layout-spec
    // path, not a transitional parity shim. R4.3b's enum-first `pickDirectControl`
    // widens which fields reach this branch (`control === 'enum'` now also holds for
    // required-and-unset boolean/string-typed enum System fields, not just
    // integer+oneOf ones like `ecodesign_control_class`) — a deliberate R4.3b
    // improvement, since those fields rendered via BooleanControl/TextControl on the
    // retired JsonForms path and neither ever surfaced a required error.
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

  const applyChange = React.useCallback(
    (segments: string[], value: unknown) => {
      onDataChange(setAtPath(data, segments, value));
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
    // R4.3b: decoded SEGMENTS, not a dot-joined path — see `segmentsFromLayoutScope`.
    // node.scope's tokens are RFC-6901-escaped by `buildSystemAdvancedUischema`, so a
    // raw '/' or '.' in a user plant-key name round-trips correctly here.
    const segments = segmentsFromLayoutScope(node.scope);
    const leafKey = segments[segments.length - 1] ?? '';
    // Stage 2.3: resolve the property schema by walking the SAME pointer (the node's
    // `scope`) through `schema` that buildSystemAdvancedUischema used to build the
    // scope in the first place, then $ref-resolve exactly like the flat walk does.
    const propertySchemaNode = resolveSchemaPointer(schema, node.scope);
    const resolved = readRecord(dereferenceSchemaNodeInRoot(propertySchemaNode, resolutionRoot));
    const label = node.label ?? labelForProperty(leafKey, resolved);
    const value = getAtPath(data, segments);
    // Required from the PARENT schema's `required` list, mirroring how the retired
    // JsonForms path's Ajv required-missing errors used to attach to this control
    // (adversarial-review finding: the required-error replication in
    // renderControlForProperty needs this to fire for nested System fields like
    // ecodesign_control_class; the `required` PROP itself is still unused by every
    // control).
    //
    // R4.3b: this lookup still works unchanged on an escaped `node.scope` — every
    // escaped token has had its own raw '/' turned into '~1', so no token can contain
    // an unescaped '/' by construction, meaning `lastIndexOf('/properties/')` still
    // finds the true last hop rather than a false match inside a raw plant-key name.
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
      segments,
      resolved,
      value,
      label,
      scope: node.scope,
      schema,
      config,
      elementType,
      required: parentRequired.includes(leafKey),
      replicateRequiredError: true,
      applyChange,
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
              // R4.3b: flat mode's segments are always a single-element array — this
              // is what keeps the whole component dot-safe uniformly across both
              // modes, even though a flat-schema property key is never a raw user
              // name in practice.
              segments: [key],
              resolved,
              value: data[key],
              label: labelForProperty(key, resolved),
              scope: `#/properties/${key}`,
              schema,
              config,
              elementType,
              required: requiredList.includes(key),
              replicateRequiredError: false,
              applyChange,
            }),
          )}
    </div>
  );
}
