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
 *
 * R4.5: this file also exports `DirectSpecFields`, a second direct renderer, sibling
 * to `DirectAdvancedFields` above and living here for the same reason — it shares
 * `renderControlForProperty`, `getAtPath`, `setAtPath`, `labelForProperty`, and
 * `segmentsFromLayoutScope` rather than duplicating them. Where `DirectAdvancedFields`
 * interprets a resolved SUBSCHEMA, `DirectSpecFields` interprets an EXPLICIT
 * uischema-spec tree — the shape web's SnippetEditor and SimplifiedFabricEditor
 * (parent repo) build by hand and used to mount as a raw JsonForms `uischema` prop
 * through the now-deleted `standardRenderers` registry (see `jsonformsRenderers.tsx`'s
 * own R4.5 deletion note). See `DirectSpecFields`'s own docstring below for the walk
 * semantics.
 *
 * R4.6a: the first slice to CORRECT this renderer rather than port or extend it. With
 * JsonForms gone there is no longer a second implementation to hold parity with, so
 * "what the old path did" stopped being an argument and the behaviour had to stand on
 * its own. Two things did not: HEM's nullable-wrapped properties
 * (`anyOf:[X,{type:'null'}]`) were dispatching to TextControl as a whole class — 26
 * property routes across BOTH profiles, 23 of them numbers rendering without their
 * schema minima — and the two review-driven, one-field-at-a-time patches that had
 * papered over the enum corner of it were still accumulating. `unwrapNullableSchema`
 * (below) replaces both with one normalization applied at all three resolution sites;
 * one of the two inline overrides is deleted as redundant, the other kept with a
 * corrected rationale. Two smaller R4.5 review notes are closed in the same slice:
 * `setAtPathNode`'s array-index unset now splices instead of leaving a JSON `null`
 * hole (below), and TextControl's JSON-blob commit no longer skips PARSING when the
 * host supplies no `elementType` (`jsonformsRenderers.tsx`).
 */

import React from 'react';
import { dereferenceSchemaNodeInRoot } from '../lib/subschemaCache';
import { decodePointerToken, resolveSchemaPointer } from '../lib/schemaRefResolver';
import { isRecord, readRecord } from '../lib/jsonTypes';
import { isNonEmptyEnumLike, schemaTypeList, unwrapNullableSchema } from '../lib/schemaShape';
import type { AdvancedFieldsLayoutNode } from '../lib/systemAdvancedUischema';
import {
  BooleanControl,
  EnumControl,
  GroupAccordion,
  NumberControl,
  TextControl,
  WindowPartListControl,
  validateAdvancedFieldPrimitive,
} from './jsonformsRenderers';

/**
 * R4.6b-2: `unwrapNullableSchema` MOVED to `../lib/schemaShape` (component-space to
 * lib-space; see that module's docstring). Re-exported here for the PARENT repo's two
 * consumers only — `web/src/components/SimplifiedFabricEditor.tsx` and
 * `web/src/components/SnippetEditor.tsx` both import it from this path today, and
 * retargeting them at the lib module is the paired parent PR's job, not this slice's.
 * Community code must import it from `../lib/schemaShape` directly; this line goes when
 * the parent's imports move.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure schema helper re-export, not a React component.
export { unwrapNullableSchema };

export type DirectAdvancedFieldsProps = {
  /** The built subschema (has .properties, maybe .$defs, maybe .required) — same object AdvancedFieldsEditor's retired <JsonForms> mount used to receive as its `schema` prop. */
  schema: Record<string, unknown>;
  /** advancedFieldsData — the flat extra_json record for this element. */
  data: Record<string, unknown>;
  /** The SAME `advancedFieldsConfig` object AdvancedFieldsEditor builds (elementType, schemaPort, …). */
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
 * Net dispatch order, evaluated against the RESOLVED, NULLABLE-UNWRAPPED property
 * schema (R4.6a: every caller passes the node through `unwrapNullableSchema` first, so
 * no rule below has to know that HEM writes optional scalars as
 * `anyOf:[X,{type:'null'}]` — see that function and the CLOSED IN R4.6a section):
 *  (a) leaf key `window_part_list` -> WindowPartListControl (handled by the caller,
 *      before this function runs — see `renderControlForProperty`).
 *  (b) NON-EMPTY enum-like (`.enum` with >=1 member, or a non-empty oneOf/anyOf where
 *      every branch is a bare `const`) -> EnumControl. R4.3b's new leading rule — see
 *      above and `isNonEmptyEnumLike`'s own docstring (`../lib/schemaShape`) for why
 *      "non-empty" is load-bearing here, not a stylistic nicety.
 *  (c) type list includes 'boolean' -> BooleanControl.
 *  (d) type list includes 'string' -> TextControl.
 *  (e) type list includes 'number' OR 'integer' -> NumberControl. (On the retired
 *      JsonForms mount, `isNumberControl` matched the EXACT type 'number' only —
 *      `integer` needed the old fallback rule's own separate check to reach
 *      NumberControl. Folding integer in here changes nothing observable: same
 *      destination control, just one rule instead of two.)
 *  (f) everything else — object, array, type-less, combinators not caught by (b) or
 *      collapsed by `unwrapNullableSchema` (3+ branches, no null branch, …) —
 *      TextControl.
 *      R4.6a CORRECTION: this rule used to claim "anyOf number|null falls here too:
 *      no live HEM property has that exact shape", citing `area_per_perimeter_vent`
 *      (a plain `{type:'number'}` in both profiles, correctly) as evidence that the
 *      R4.2 spike's example had been a stale docstring claim. The example was stale;
 *      the generalization from it was wrong. TWENTY-THREE live number routes carry
 *      `anyOf:[{type:'number',…},{type:'null'}]` across both profiles — including
 *      every `u_value` — and each of them landed here, on a text box with no
 *      `min`/`max`. The single field checked happened to be one HEM does NOT wrap.
 *      Nullable wrappers no longer reach this rule at all; they are collapsed before
 *      dispatch.
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
 * `schemaHasConstAlternatives` predicates WERE vacuously true on an empty array
 * (`[].every(...)` is true) until R4.6b-2 moved them to `../lib/schemaShape` and made
 * non-emptiness part of what they mean — harmless under the OLD type-first order (a
 * type-bearing schema matched rule (c)/(d) first regardless), but under R4.3b's enum-first
 * promotion that vacuous truth would fire FIRST, routing an empty-alternatives field
 * to EnumControl with ZERO options — permanently uneditable, not merely different.
 * This IS reachable: `lib/systemHotWaterAdvancedSchema.ts`'s
 * `inlineHotWaterSourceHeatSourceWetEnumOnHotWaterSubschema` manufactures
 * `HeatSourceWet: {type:'string', oneOf: []}` whenever an FHS project has a
 * CombiBoiler/HIU/HeatBattery `hw cylinder` and ZERO wet heat-source plants defined
 * yet (its own hint text literally asks the user to type a name: "No defined heat
 * source (wet) names yet. Add a Heat source (wet) system that defines a plant key,
 * then link here." — EnumControl with no options cannot accept that input). `pickDirectControl`
 * therefore requires NON-EMPTY alternatives (`isNonEmptyEnumLike`, mirroring the
 * retired JsonForms registry's own GenericControl fallback's inline guards — see the
 * R4.5 deletion note above `schemaHasIntegerType` in `jsonformsRenderers.tsx`), so
 * this shape falls through to type dispatch exactly as both the old type-first port
 * and the retired JsonForms path always did: string -> TextControl, a free-text input
 * the user can still type a link name into.
 *
 * CLOSED IN R4.6a — the whole nullable-wrapper class, not one field at a time. The
 * paragraphs this replaces described a "KNOWN GAP" with "TWO LIVE INSTANCES, BOTH
 * INLINED UPSTREAM": neither `isNonEmptyEnumLike` NOR type dispatch routes
 * `anyOf: [X, {type:'null'}]` anywhere sensible, because the WRAPPER carries no
 * top-level `type`/`enum` of its own — `isNonEmptyEnumLike` only recognizes a bare
 * `.enum` or oneOf/anyOf where EVERY branch carries `const`, and rule (c)-(e) have no
 * type to read, so every such property fell to rule (f) -> TextControl. That framing
 * was too narrow twice over, as R4.6a's dispatch sweep showed
 * (`AdvancedFieldsEditor.directRender.test.tsx`, "R4.6a standing invariant" — see
 * there for exactly what is and is not swept).
 *
 * COUNTS, AND WHAT THEY ARE COUNTS OF (review round 1 asked for this precision, and
 * getting it wrong is what produced the retracted claim below): the unit is a ROUTE —
 * one (profile, element type or System subtype, property) triple — because the same
 * property can be reached by more than one walk, and a property that is unreachable is
 * not a bug. Sweeping the flat walk (every element type × every subtype, both
 * profiles) and the System layout walk finds 43 routes carrying a nullable wrapper, of
 * which 26 dispatched to the wrong control. It is not an ENUM problem: 23 of the 26
 * are NUMBERS (`u_value`, `thermal_resistance_construction`, `mvhr_eff`,
 * `orientation360`, `pitch`, the duct dimensions, the `ach_*` limits, the CombiBoiler
 * loss factors, …), where TextControl silently drops `min`/`max`/the numeric draft
 * buffer/the unit adornment. Two are enums and one is a boolean. Chasing that one
 * $ref-to-enum field at a time — `shield_fact_location`, then `mvhr_location` a slice
 * later — was never going to converge.
 *
 * RETRACTED (review round 1, REAL WRONG CLAIM — this docstring asserted it on R4.6a's
 * first commit): "FHS carries none — HEM's FHS wrapper flattens nullables away". There
 * is no such flattening mechanism. `input_fhs.schema.json` carries FIVE property-level
 * nullable wrappers, byte-identical in shape to Core's; four of them are LIVE and are
 * among the 26 moved (`HotWaterSource` / `hw cylinder` / `allOf[4].then`, the
 * `{type:'CombiBoiler'}` branch: `rejected_energy_1`, `rejected_factor_3`,
 * `storage_loss_factor_1`, `storage_loss_factor_2`; the fifth,
 * `HeatSourceWet`/`boiler`/`cost_schedule_hybrid`, wraps an OBJECT and so is a JSON
 * blob before and after). What is true is narrower and is the actual reason FHS-only
 * verification kept missing this shape: FHS puts its wrappers inside `allOf`/`then`
 * CONDITIONAL branches, which a scan of top-level `properties` — the natural way to
 * "check the schema" — never reaches. The lesson is about how the schema was looked
 * at, not about what the profile contains.
 *
 * `unwrapNullableSchema` (below) now collapses the wrapper to its non-null branch at
 * the three points where a property schema is RESOLVED, so `pickDirectControl` and
 * every control downstream see the real node. No rule in this picker knows about
 * nullability at all; see that function's docstring for the exact pattern it matches
 * and for why unwrapping the resolved NODE (rather than special-casing dispatch) is
 * the load-bearing half of the fix.
 *
 * PRE-EXISTING, NOT INTRODUCED BY THE R4.3 PORT (checked against the deleted registry
 * itself, `git show ba61e8c^:…/jsonformsRenderers.tsx`, not from memory): the retired
 * rank-280 `advancedFieldsNumericTester` DID carry a `schemaIsNullableNumberAnyOf`
 * arm for exactly this shape, but it read the schema argument JsonForms hands
 * TESTERS — the unresolved PARENT object schema (the flat-dispatch quirk this
 * docstring opens with) — which has no top-level `anyOf`, so the arm never fired for
 * any per-property nullable wrapper. Dispatch then fell through rank 1000/1100
 * (parent again, no `enum`/const-alternatives), rank 90/80 (`isNumberControl` /
 * `isStringControl` / `isBooleanControl` DO resolve the scope, and a wrapper with no
 * top-level `type` matches none of them) to the rank-5 `GenericControl` fallback,
 * whose own enum/boolean/number checks read the RESOLVED wrapper and all missed it
 * too -> TextControl. Same wrong control, same missing `min`/`max`, on both paths.
 * The A/B parity matrix DID cover core-mode `BuildingElementOpaque` (config 2) and
 * captured `row('u_value', 'U-Value', TEXT(null))` from a GREEN run with the
 * JsonForms mount still live — a literal recording of the JsonForms path rendering
 * this field as a bare, constraint-free text box. R4.3's executed-table port
 * reproduced the bug faithfully, which is what it was asked to do; what nobody did
 * until R4.6a was ask whether the behaviour being preserved was correct.
 *
 * STILL INLINED UPSTREAM, DELIBERATELY: `shield_fact_location`'s flat-enum override in
 * `AdvancedFieldsEditor.tsx`'s subschema memo survives R4.6a and is NOT redundant —
 * it is not a nullable wrapper on either profile (FHS: a bare `{enum:[…]}`; Core: a
 * bare `$ref` with a sibling `description`), so `unwrapNullableSchema` never touches
 * it, and what it actually pins is the LABEL. See the corrected comment at that site.
 * `mvhr_location`'s override, added in R4.5 review round 1 for the Core-only
 * `anyOf:[{$ref:'#/$defs/MVHRLocation'},{type:'null'}]` shape, WAS redundant once the
 * generic unwrap landed and is gone.
 *
 * VERIFIED NOT LIVE, three other `$defs` properties carry the
 * anyOf-wraps-a-$ref-to-an-enum shape in `core-input.schema.json` but are unreachable
 * through EITHER walk, so they never reach this picker at all (not accepted divergences
 * — genuinely dead paths, checked directly). A route spans both walks, as this docstring
 * insists 60 lines above, so element-subschema reachability alone is only half an
 * argument; each entry below therefore has to fail the System layout walk too, and the
 * reason it does is NOT structural in two of the three cases:
 *  - `ControlChargeTarget.logic_type` — `ControlChargeTarget` is a nested `$def`, so no
 *    element-subschema route reaches it. It is not reachable through the System walk
 *    either, but only because `Control` is not one of the seven `SystemSubcategory`
 *    values this editor mounts; nothing about the shape prevents it.
 *  - `ShowerMixer.WWHRS_configuration` — `ShowerMixer` has no element-subschema route of
 *    its own, and the System walk stops one level short: `buildControlsForSchema` only
 *    recurses into a child with non-empty `properties`, so it emits ONE Control for
 *    `Shower` itself and never descends to the item schema this property lives on. On
 *    CORE — the profile this list is scoped to — the node that walk sees is the nullable
 *    WRAPPER `anyOf:[dict,{type:'null'}]`, because the layout is built before
 *    `unwrapNullableSchema` runs; it has no `properties` either, so the conclusion holds
 *    on both profiles, but by way of the wrapper on Core and the bare dictionary on FHS.
 *  - `Zone.temp_setpnt_basis` — `Zone` is neither an HEM element type this editor mounts
 *    Advanced Fields for nor a `SystemSubcategory`. This one IS structural.
 * (`BuildingElementPartyWall.party_wall_lining_type`, listed here through R4.5, is
 * reachable via `getElementSubschema('core','BuildingElementPartyWall')` but is a
 * PartyWall BASE field — `getBaseFieldsForElementType`, `lib/schemaCache.ts` — so
 * `advancedProperties` filters it out one layer ABOVE this picker rather than the
 * schema never offering it. Same net effect, different reason; R4.6a's standing
 * invariant asserts its dispatch anyway, since the base-field list is not this
 * module's to depend on.)
 * RE-CHECK THAT LIST if Core's System flattening is ever completed. Today
 * `flattenIfThenAllOfProperties` resolves FHS's `allOf`/`if`/`then` but never selects a
 * branch of Core's discriminated `oneOf`, so Core's System walk contributes almost
 * nothing beyond `InfiltrationVentilation` and `HotWaterDemand` — measured, 2, 1, 1 and 1
 * combinator routes for `HeatSourceWet`, `HotWaterSource`, `SpaceCoolSystem` and
 * `SpaceHeatSystem` respectively, none of them wrappers. Open those branches and plant
 * subschemas expand into real property trees, at which point the first two entries above
 * need re-deriving rather than trusting.
 *
 * The `Group` accordion renderer (rank 100) WAS ported, in R4.5: it survives as
 * `GroupAccordion` (`components/jsonformsRenderers.tsx`), imported at the top of this
 * file and rendered by `DirectSpecFields`' own `Group` branch for web's fabric and
 * snippet specs. What remains true is the second half, which is why no Group appears in
 * THIS picker's world: no Advanced Fields uischema — generated flat walk or
 * manually-built System layout spec — ever emits a `Group` node, so
 * `AdvancedFieldsLayoutNode` does not name one and `renderLayoutNode` has no branch for
 * one. See `lib/systemAdvancedUischema.ts` for why the System builder deliberately
 * emits none.
 */

/**
 * R4.6b-2 MOVE NOTE: `unwrapNullableSchema` (with its `isBareNullSchema` /
 * `unwrapNullableSchemaLayer` internals) and `isNonEmptyEnumLike` used to be written out
 * here. Both are `../lib/schemaShape` now — see the imports at the top of this file and
 * that module's docstring for why a schema-shape question stopped living in a component.
 * `isNonEmptyEnumLike` also SHRANK in the move: it used to re-check non-emptiness on top
 * of `jsonformsRenderers.tsx`'s vacuously-true `schemaHasEnum` /
 * `schemaHasConstAlternatives`, and those two now own the rule, so it is a plain
 * disjunction of them. The reachability argument the guard exists FOR (an FHS
 * `hw cylinder` with no wet heat-source plants yet manufactures
 * `{type:'string', oneOf: []}`, which must reach TextControl and not a zero-option
 * dropdown) moved with it, to `isNonEmptyEnumLike`'s own docstring.
 */

// eslint-disable-next-line react-refresh/only-export-components -- pure picker helper, not a React component.
export function pickDirectControl(resolved: Record<string, unknown>): 'enum' | 'number' | 'boolean' | 'text' {
  // R4.3b: NON-EMPTY enum-like wins outright, ahead of type — see the module
  // docstring above and `isNonEmptyEnumLike`'s own docstring (`../lib/schemaShape`)
  // for the full
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
// R4.5: exported so web's `SimplifiedFabricEditor` can drop its local `labelize` and
// share this one. NOT a zero-delta swap, and saying otherwise here is what let the claim
// stand unchallenged: `labelize` split only on `_` and lowercase->uppercase, never on
// digit runs, so the one live schema key affected — `orientation360`, on
// BuildingElementTransparent/Opaque and reachable through a simplified_fabric snippet —
// went from "Orientation360" to "Orientation 360". User-authored snippet DATA keys are
// labelled by the same function and can diverge further (`area_cm2` -> "Area Cm 2" where
// `labelize` gave "Area Cm2"). The change is deliberate and better: it matches lodash
// `startCase`, which is what @jsonforms/core's own label derivation used on the retired
// path, so it REMOVES an inconsistency between the two editors. The merged parent commit
// says the same and pins `orientation360` in its own characterization test.
// eslint-disable-next-line react-refresh/only-export-components -- pure string helper, not a React component.
export function startCaseKey(key: string): string {
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

/**
 * A path segment is a valid ARRAY index (not an object key) only when canonical:
 * '0', '1', '2', … — never '01' (leading zero), '-1', or a non-numeric string like a
 * plant key that just happens to read as a number in some other base. Shared by
 * `getAtPath` and `setAtPath`'s array-hop support (R4.5 review round 1 fix) so both
 * sides agree on exactly the same set of segments that mean "array index."
 */
function isCanonicalArrayIndexSegment(segment: string): boolean {
  return /^(0|[1-9]\d*)$/.test(segment);
}

/**
 * Walk `data` along path segments; undefined at any missing hop.
 *
 * R4.5 review round 1 fix: array hops are now supported, matching `setAtPath`'s own
 * contract below (both must agree, or a value written via one would read back as
 * undefined via the other). When the CURRENT node at a hop is an array, a canonical
 * non-negative-integer segment (see `isCanonicalArrayIndexSegment`) indexes into it;
 * a non-canonical segment against an array (should not happen — every array-hop
 * segment in this file comes from a decoded plant/instance-path token that is
 * genuinely a numeric array index, e.g. a per-item Group's `pathOverride`) returns
 * undefined rather than guessing. A non-array, non-null object hop still uses
 * ordinary record property lookup as before.
 */
function getAtPath(data: Record<string, unknown>, segments: string[]): unknown {
  let current: unknown = data;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!isCanonicalArrayIndexSegment(segment)) return undefined;
      current = current[Number(segment)];
      continue;
    }
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Immutable nested set/delete along path segments (Stage 2.1): clones each hop, and
 * either sets or deletes the leaf. `value === undefined` deletes the leaf key
 * outright (matches the top-level spike behaviour, extended to every hop).
 * Intermediate containers are left in place even if the delete empties them — this is
 * NOT a stylistic choice, it matches what the retired JsonForms path's own JsonForms
 * core reducer did: `UPDATE_DATA`'s unset branch is `lodash/fp/unset(path, data)`
 * (verified in node_modules/@jsonforms/core), which only removes the leaf and never
 * prunes now-empty ancestors. A missing intermediate hop is created as `{}` on set.
 * That matches `lodash/fp/set`'s auto-vivification for an ORDINARY key only: lodash
 * vivifies an ARRAY when the next segment is a canonical integer index — the same
 * integer-key rule the R4.5 note below cites as the reason an existing array must be
 * preserved — and `setAtPathNode` still vivifies `{}` there. Deliberate, not an
 * oversight; see the first divergence below.
 *
 * Two standing divergences from `lodash/fp`, both currently unreachable, both left
 * as-is:
 *  - SET through a MISSING hop whose next segment is an integer builds `{'0': …}`
 *    where lodash would build `[…]`. Nothing can reach it: the only builder that emits
 *    integer path segments (web's `SimplifiedFabricEditor`, per-item Groups) derives
 *    those indices by iterating an array that is already present in the data, so the
 *    array hop is never missing at the moment it is walked.
 *  - DELETE along a missing intermediate hop vivifies `{}` ancestors here where
 *    `lodash/fp/unset` is a no-op — reset buttons only render when a value exists, so
 *    the path is always present.
 *
 * R4.5 review round 1 fix (REAL finding, adversarial review round 1): array hops are
 * now preserved instead of destroyed. `lodash/fp`'s own `set`/`unset` — the contract
 * this function has always cited above — PRESERVES an array for an integer key (it
 * only auto-vivifies a plain object for a NON-numeric key), but this function used to
 * treat every array child as "not a valid container" and silently replace the WHOLE
 * array with `{}` on any nested write under it. A per-item Group's `pathOverride`
 * (e.g. `'window.window_part_list.0'`, from `DirectSpecFields`' self-rooted array
 * shape) would therefore have destroyed every sibling item on the very first edit to
 * item 0. Fixed via `setAtPathNode`: when the EXISTING child at a hop is an array and
 * the next segment is a canonical index (`isCanonicalArrayIndexSegment`), clone the
 * array (`.slice()`) and recurse into that index instead of falling through to record
 * semantics. A data/plant key that happens to be the literal string `'0'` over an
 * OBJECT (not an array) is UNAFFECTED — this only activates when the value ALREADY
 * THERE is an array; a key still only means an array index when the parent it hangs
 * off actually is one.
 *
 * R4.6a (R4.5 review note, closed): unsetting a leaf that IS an array index now
 * SPLICES the element out. R4.5 landed it as `delete arr[i]` — a hole — on the stated
 * grounds that this "mirrors `lodash/fp/unset` exactly". It did, and that was the
 * right call while JsonForms' `UPDATE_DATA` reducer (built on `lodash/fp/unset`) was
 * the reference implementation this whole module was being held against. R4.4/R4.5
 * deleted that reducer along with the rest of JsonForms; parity with it is no longer a
 * contract, and what is left is just the behaviour on its own merits — where a hole is
 * indefensible. `JSON.stringify` serialises a hole as `null`, and `null` is never
 * valid HEM input for any of the arrays this walker can reach: `window_part_list`,
 * `edge_insulation` and `treatment` are all variable-length lists OF OBJECTS, so the
 * export would carry a `null` entry straight into the engine. Splicing keeps the array
 * a list of the things it is a list of; later items shifting down is the correct
 * consequence of removing one, not a side effect to be avoided.
 *
 * UNREACHABLE FROM TODAY'S UI, deliberately fixed anyway (correctness by construction,
 * not a live bug) — though not for the reason this note originally gave. Reaching the
 * leaf-unset above needs a control bound DIRECTLY to an array index, and a production
 * builder does emit exactly that shape: web's `SimplifiedFabricEditor` (`buildControls`,
 * parent repo) puts a `Control` scoped `#/properties/<i>` inside a Group whose
 * `pathOverride` ends at the array, chosen PER ITEM for items that are not objects. So
 * the binding exists in the code; what makes it dead is the data it is chosen against.
 * Every array those fabric sections can reach in today's schemas holds OBJECTS
 * (`BuildingElementTransparent.treatment` / `.shading` / `.window_part_list`,
 * `edge_insulation` on the slab-with-edge-insulation ground variant), so the per-item
 * GROUP branch is taken instead and every live array-hop path ends at a leaf inside an
 * item OBJECT (`sec.list.0.value`), which unsets through the record branch below and
 * never touches the array. The other `DirectSpecFields` host, `SnippetEditor`, emits a
 * flat list of top-level Controls with no array hops at all, and `DirectAdvancedFields`'
 * own two walks never descend into an array — an array-typed property renders as a
 * single JSON-blob `TextControl`.
 *
 * So a primitive-item array is the ONE missing precondition, and the load-bearing thing
 * to watch: the affordance that produces `value === undefined` is already live. It is
 * NOT the reset button that holds this back — that renders for any non-blank value even
 * under the fabric editor's `config={{}}` mount, because with no `elementType` there is
 * no template default and `shouldShowResetToSource` reduces to
 * `isMeaningfulExplicitValue`; clicking it commits `undefined`. The two OTHER routes to
 * `undefined` are the ones that happen not to apply: `NumberControl` commits `''`, not
 * `undefined`, when its input is cleared, and `TextControl`'s unset-on-blur only fires
 * for JSON-like (object/array-typed) rows. So this is about what the next array shape
 * inherits, not about anything a user can do today — which is exactly why it is worth
 * getting right while the reasoning is still written down.
 */
function setAtPathNode(node: unknown, segments: string[], value: unknown): unknown {
  const [head, ...rest] = segments;
  if (Array.isArray(node) && isCanonicalArrayIndexSegment(head)) {
    const index = Number(head);
    const nextArray = node.slice();
    if (rest.length === 0) {
      if (value === undefined) {
        // R4.6a: splice, not `delete` — see the docstring's own paragraph on why the
        // lodash-parity hole died with the reducer it mirrored.
        nextArray.splice(index, 1);
      } else {
        nextArray[index] = value;
      }
      return nextArray;
    }
    nextArray[index] = setAtPathNode(nextArray[index], rest, value);
    return nextArray;
  }
  const record =
    node && typeof node === 'object' && !Array.isArray(node) ? (node as Record<string, unknown>) : {};
  const nextRecord: Record<string, unknown> = { ...record };
  if (rest.length === 0) {
    if (value === undefined) {
      delete nextRecord[head];
    } else {
      nextRecord[head] = value;
    }
    return nextRecord;
  }
  nextRecord[head] = setAtPathNode(nextRecord[head], rest, value);
  return nextRecord;
}

function setAtPath(obj: Record<string, unknown>, segments: string[], value: unknown): Record<string, unknown> {
  return setAtPathNode(obj, segments, value) as Record<string, unknown>;
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
  // picker — it is an array-typed property that would otherwise never reach a sane
  // control via pickDirectControl (no enum/number/boolean match, falls to 'text',
  // which would JSON-blob the row instead of the real multi-row editor). HISTORY: this
  // special case originally mirrored one the retired JsonForms registry's own
  // GenericControl fallback carried (`jsonformsRenderers.tsx`, deleted in R4.5 — see
  // the R4.5 deletion note above `schemaHasIntegerType` there); this file has owned
  // the check outright since R4.3, and GenericControl no longer exists to mirror.
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
  // AdvancedFieldsEditor's advancedFieldsConfig does ("Pass $defs through config so
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
    // R4.6a: unwrap AFTER dereferencing, never before. `dereferenceSchemaNodeInRoot`
    // recurses through every key and array element (`derefSchema`, lib/subschemaCache.ts),
    // so a `$ref` sitting INSIDE an `anyOf` branch — which is how HEM writes every
    // nullable enum, e.g. `anyOf:[{$ref:'#/$defs/MVHRLocation'},{type:'null'}]` — is
    // already inlined by this point and the surviving branch is a real schema, not a
    // pointer. Unwrapping first would hand back a bare `{$ref}` node with nothing for
    // `pickDirectControl` to dispatch on.
    const resolved = unwrapNullableSchema(readRecord(dereferenceSchemaNodeInRoot(propertySchemaNode, resolutionRoot)));
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
      // R4.6a: unwrap AFTER dereferencing — see the same note in `renderLayoutNode`
      // above for why the order matters. `schemaEmitsControl`'s verdict is unchanged
      // by unwrapping every live wrapper: it short-circuited TRUE on the non-empty
      // combinator before, and now finds a derivable `type` on the surviving branch.
      const resolved = unwrapNullableSchema(readRecord(dereferenceSchemaNodeInRoot(properties[key], resolutionRoot)));
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

/**
 * The explicit uischema-spec tree `DirectSpecFields` interprets, structurally
 * matching what `web/src/components/SimplifiedFabricEditor.tsx`'s `ui` memo and
 * `web/src/lib/jsonFormsPresentUi.ts` (parent repo, read-only) build by hand and used
 * to mount as a raw JsonForms `uischema` prop. Unknown `options` keys are ignored —
 * see `DirectSpecFields`'s own docstring for the one that matters (`helperText`).
 */
export type DirectSpecNode =
  | { type: 'VerticalLayout'; elements: DirectSpecNode[] }
  | {
      type: 'Group';
      label?: string;
      elements: DirectSpecNode[];
      options?: { schemaOverride?: object; pathOverride?: string; openInitially?: boolean };
    }
  | {
      type: 'Control';
      scope: string;
      label?: string;
      options?: { schemaOverride?: object };
    };

export type DirectSpecFieldsProps = {
  /** Resolution root for `Control` nodes with no `options.schemaOverride` of their
   * own — walked-through-tokens schemas $ref-resolve against this (see
   * `walkSchemaPropertiesByTokens` below), the same pattern `DirectAdvancedFields`'
   * System layout walk uses against this same prop. */
  schema: Record<string, unknown>;
  /** The full flat data record the spec edits (e.g. web's own extra_json / snippet payload). */
  data: Record<string, unknown>;
  /** The SAME config object DirectAdvancedFields' controls read (elementType, schemaPort, …). */
  config: Record<string, unknown>;
  /** The explicit uischema-spec tree — see the module docstring and this component's own. */
  spec: DirectSpecNode;
  onDataChange: (next: Record<string, unknown>) => void;
};

/**
 * `options.schemaOverride`, narrowed to a record. `options` is typed with the
 * deliberately loose `object` for `schemaOverride` (see `DirectSpecNode`), so this is
 * a defensive narrow, not just a cast.
 */
function directSpecSchemaOverride(
  options: { schemaOverride?: object } | undefined,
): Record<string, unknown> | undefined {
  const override = options?.schemaOverride;
  return isRecord(override) ? override : undefined;
}

/**
 * Walks `schema` through `tokens` one `.properties` hop at a time — deliberately NOT
 * a pointer-resolve against a fixed root (unlike `resolveSchemaPointer`), because
 * `schema` here may already be a NARROWED `contextSchema` (a `Group`'s
 * `options.schemaOverride`) with no reachable pointer back to the outer
 * `DirectSpecFieldsProps.schema` root at all. $ref-resolution happens once, on the
 * final walked node — see the caller.
 */
function walkSchemaPropertiesByTokens(schema: Record<string, unknown>, tokens: string[]): Record<string, unknown> {
  let node: Record<string, unknown> = schema;
  for (const token of tokens) {
    node = readRecord(readRecord(node.properties)[token]);
  }
  return node;
}

/**
 * R4.5: the second direct renderer — see the module docstring above for how this
 * relates to `DirectAdvancedFields`. Interprets the EXPLICIT uischema-spec trees
 * web's SnippetEditor (`lib/jsonFormsPresentUi.ts`) and SimplifiedFabricEditor
 * (`components/SimplifiedFabricEditor.tsx`'s `ui` memo, parent repo, read-only) build
 * by hand, the way `DirectAdvancedFields.layout` above interprets
 * `buildSystemAdvancedUischema`'s System layout spec.
 *
 * WALK CONTEXT: `contextSchema` (starts at `schema`) and `contextSegments: string[]`
 * (starts `[]`) thread through the recursion below.
 *  - `VerticalLayout`: plain `<div>` wrapper, context passed through unchanged.
 *  - `Group`: renders `GroupAccordion` (label = `node.label ?? ''`, count =
 *    `node.elements.length`, `openInitially` from `options`); its children see a
 *    NARROWED context — `contextSchema = options.schemaOverride ?? contextSchema`,
 *    `contextSegments = options.pathOverride != null ? options.pathOverride.split('.')
 *    : contextSegments`. `pathOverride` is a dot-joined ABSOLUTE instance path built
 *    by web from object keys (REPLACE, not append) — a '.' inside a raw data key is a
 *    pre-existing limitation of the WEB BUILDERS' own dot-joined `pathOverride`, not
 *    of this walker; noted here, not fixed here (out of scope — this module does not
 *    own that encoding).
 *  - `Control`: `scope` is decoded into segments by the SAME `segmentsFromLayoutScope`
 *    the System layout walk above uses. Every scope either builder emits is prefixed
 *    `'#/properties/'` (the prefix itself never varies — both builders always start
 *    from `'#'` and append `/properties/<key>` repeatedly), so
 *    `segmentsFromLayoutScope`'s existing `'#/properties/'`-prefix assumption did not
 *    need loosening here — see the FIDELITY NOTE below for the DEPTH/NESTING
 *    corrections to this claim from review round 1 (the prefix always holds; how many
 *    hops and what they contain does not). Resolved property schema =
 *    `options.schemaOverride` if present, else `contextSchema` walked through those
 *    same tokens' `.properties` hops and then $ref-resolved via
 *    `dereferenceSchemaNodeInRoot` against `schema` (the same pattern
 *    `renderLayoutNode` above uses for System). Full data-path segments =
 *    `contextSegments.concat(tokens)` — reuses `renderControlForProperty` verbatim
 *    (same five controls, same enum-first `pickDirectControl` dispatch as every other
 *    walk in this file).
 *
 * FIDELITY NOTE (CORRECTED, R4.5 review round 1 — the original version of this note
 * both undersold the scope shapes AND overstated what was verified; both builders
 * were re-read line-by-line for this correction, not just the bundled flat fixtures):
 * concatenating `contextSegments` with a `Control`'s FULL token list — not just its
 * last hop — genuinely reproduces `@jsonforms/core`'s own path composition
 * (`Paths.compose`/`toDataPathSegments` concatenates every scope segment onto the
 * parent path unconditionally, with no de-duplication against what the parent already
 * carries). This is BYTE-IDENTICAL to the old `composeWithUi` behaviour on BOTH the
 * retired JsonForms path and this one — broken (or at least redundant) on both sides
 * alike, not a regression this walker introduces. Two shapes this note previously
 * claimed did not occur, DO occur in `SimplifiedFabricEditor.tsx`'s `ui` memo (parent
 * repo) as currently written:
 *  - its OBJECT branch (nested-object properties) DOES emit a `Group` nested two
 *    levels deep, with the inner Controls' scopes accumulated through the OUTER
 *    `basePtr` (not reset at the inner `Group`) — exactly the double-walk this note
 *    describes above, genuinely reachable, not hypothetical.
 *  - its ARRAY branch nests a `Group`-of-`Group`s THREE deep and uses the JSON-schema
 *    keyword `items` INSIDE the scope pointer itself (e.g.
 *    `'#/properties/layers/items/properties/thickness'`) — `segmentsFromLayoutScope`'s
 *    literal `'/properties/'`-split glues `'layers/items'` into one bogus segment
 *    there (no real data key is named that), a DIFFERENT kind of garbage than the
 *    object branch's double-walk, but garbage on the RETIRED JsonForms path too (its
 *    own `Paths.compose` would have composed the identical nonsense segment) — not a
 *    new divergence.
 * Both are moot for what ships: the PAIRED web PR changes BOTH the object and array
 * branches to self-root each nested/per-item `Group` (fresh `schemaOverride` +
 * absolute `pathOverride`, single-hop child `Control` scopes) before the migration to
 * `DirectSpecFields` lands, so neither the double-walk nor the `items`-laden pointer
 * ever reaches this file in the migrated specs — see
 * `AdvancedFieldsEditor.directRender.test.tsx`'s array-shaped-fabric-spec test for the
 * shape that DOES ship. That self-rooted array shape only writes correctly because of
 * this SAME review round's `setAtPath`/`getAtPath` array-hop fix (see their
 * docstrings below) — without it, a self-rooted per-item `Group`'s first edit would
 * have silently replaced the whole array with `{}`.
 *
 * DEAD OPTION, DELIBERATELY UNHANDLED: web's fabric builder also passes an
 * `options.helperText` React node on `Control` nodes. It was ALREADY DEAD on the
 * retired JsonForms path — no control in `jsonformsRenderers.tsx` ever reads
 * `options.helperText` off its `uischema`; `TextControl`/`NumberControl` both
 * hardcode `helperText={undefined}` on their own StandardInput element regardless of
 * what the uischema carries. This component does not read it either. Reviving
 * `helperText` support is a product decision for a future slice, not a migration
 * default this walker should invent.
 *
 * HOST-VISIBLE SIMPLIFICATION: the retired JsonForms mount echoed an initial
 * `onChange` call on mount (its own internal Ajv-validated data round-trip), which is
 * why both `SnippetEditor` and `SimplifiedFabricEditor` carried suppress-first-change
 * guards around their `onChange` handlers. `DirectSpecFields` emits NOTHING until a
 * real user edit — `applyChange` only ever fires from a control's own `handleChange` —
 * so web's migration can drop those guards; that is this component's business, not a
 * regression to replicate.
 */
export function DirectSpecFields({
  schema,
  data,
  config,
  spec,
  onDataChange,
}: DirectSpecFieldsProps): React.ReactElement {
  const elementType = typeof config.elementType === 'string' ? config.elementType : undefined;

  // Same resolution-root pattern as DirectAdvancedFields above.
  const defs = (schema as { $defs?: unknown }).$defs ?? (config as { $defs?: unknown }).$defs;
  const resolutionRoot = { $defs: defs };

  const applyChange = React.useCallback(
    (segments: string[], value: unknown) => {
      onDataChange(setAtPath(data, segments, value));
    },
    [data, onDataChange],
  );

  function renderNode(
    node: DirectSpecNode,
    key: React.Key,
    contextSchema: Record<string, unknown>,
    contextSegments: string[],
  ): React.ReactElement {
    if (node.type === 'VerticalLayout') {
      return (
        <div key={key}>
          {node.elements.map((child, i) => renderNode(child, i, contextSchema, contextSegments))}
        </div>
      );
    }
    if (node.type === 'Group') {
      const nextSchema = directSpecSchemaOverride(node.options) ?? contextSchema;
      const nextSegments =
        node.options?.pathOverride != null ? node.options.pathOverride.split('.') : contextSegments;
      return (
        <GroupAccordion
          key={key}
          label={node.label ?? ''}
          count={node.elements.length}
          openInitially={node.options?.openInitially}
        >
          {node.elements.map((child, i) => renderNode(child, i, nextSchema, nextSegments))}
        </GroupAccordion>
      );
    }

    // Control.
    const tokens = segmentsFromLayoutScope(node.scope);
    const leafKey = tokens[tokens.length - 1] ?? node.scope;
    const schemaOverride = directSpecSchemaOverride(node.options);
    // R4.6a: unwrap here too, and around BOTH arms — see `renderLayoutNode`'s note
    // above for the deref-then-unwrap ordering. The `schemaOverride` arm is included
    // deliberately even though it never passes through `dereferenceSchemaNodeInRoot`:
    // web's builders lift each override straight off a resolved HEM property schema
    // (`SimplifiedFabricEditor`'s `ui` memo, parent repo), so an override IS a live
    // HEM node and can be a nullable wrapper just like a walked one. Unwrapping only
    // the walked arm would have left the two hosts disagreeing about the same field.
    const resolved = unwrapNullableSchema(
      schemaOverride ??
        readRecord(dereferenceSchemaNodeInRoot(walkSchemaPropertiesByTokens(contextSchema, tokens), resolutionRoot)),
    );
    const fullSegments = [...contextSegments, ...tokens];
    const label = node.label ?? labelForProperty(leafKey, resolved);
    const value = getAtPath(data, fullSegments);
    return renderControlForProperty({
      segments: fullSegments,
      resolved,
      value,
      label,
      scope: node.scope,
      schema,
      config,
      elementType,
      required: false,
      replicateRequiredError: false,
      applyChange,
    });
  }

  return renderNode(spec, 'root', schema, []);
}
