// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * R4.6b-2: the shape questions asked of a RESOLVED schema node — "what type is it?",
 * "is it enum-like?", "is it a nullable wrapper?", "would it render as a scalar row?" —
 * in one lib module, so that the answer is the same wherever it is asked.
 *
 * WHY A MOVE WAS OVERDUE. Before this slice the family was spread across three files in
 * two repos: `schemaTypeList` / `schemaHasEnum` / `schemaHasConstAlternatives` in
 * `components/jsonformsRenderers.tsx` (a 2.5k-line component file, exporting them purely
 * so a sibling component could reach them), `unwrapNullableSchema` in
 * `components/DirectAdvancedFields.tsx` (same), and a third hand-written copy of the
 * scalar-row test in the PARENT repo's `web/src/components/SnippetEditor.tsx`, whose own
 * docstring named this module as where it belonged and declined to add a fourth. Every
 * consumer is a schema question, none of them is a React question; component-space was
 * where they happened to be written, not where they belong.
 *
 * NON-EMPTINESS IS OWNED HERE, ONCE. `schemaHasEnum` and `schemaHasConstAlternatives`
 * used to be VACUOUSLY TRUE on an empty array (`Array.isArray([])`, `[].every(...)`), and
 * every caller that could not afford that re-checked the length itself — which is exactly
 * how a predicate ends up meaning two different things in two places. Both now require a
 * NON-EMPTY array, so `isNonEmptyEnumLike` (which used to carry the re-checks) is a plain
 * disjunction of the three predicates and no future caller has to know the rule existed.
 * See each predicate for what that changed and what it did not.
 */

import { isRecord, readRecord, type JsonRecord } from './jsonTypes';

/** `oneOf`/`anyOf` narrowed to the record branches, or `null` when the keyword is absent. */
export function schemaAlternatives(schema: JsonRecord, key: 'oneOf' | 'anyOf'): JsonRecord[] | null {
  const value = schema[key];
  return Array.isArray(value) ? value.filter(isRecord) : null;
}

/** Declared `type`, normalized to a list: `'number'` -> `['number']`, absent -> `[]`. */
export function schemaTypeList(schema: JsonRecord): string[] {
  const typeValue = schema.type;
  if (Array.isArray(typeValue)) return typeValue.filter((type): type is string => typeof type === 'string');
  return typeof typeValue === 'string' ? [typeValue] : [];
}

/**
 * A NON-EMPTY `enum` array.
 *
 * R4.6b-2 TIGHTENING: this used to be a bare `Array.isArray(schema.enum)`, true for
 * `enum: []`. Its only consumer already re-checked the length (see
 * {@link isNonEmptyEnumLike}), so nothing observable changes — the rule simply now lives
 * with the predicate instead of beside it.
 */
export function schemaHasEnum(schema: unknown): boolean {
  const values = readRecord(schema).enum;
  return Array.isArray(values) && values.length > 0;
}

/**
 * NON-EMPTY `oneOf`/`anyOf` alternatives where EVERY branch carries a `const` — the other
 * way HEM writes an enumeration (each branch a `{const, title, description}` triple, which
 * is what gives `EnumControl` its per-option labels and descriptions).
 *
 * R4.6b-2 TIGHTENING: this used to be `!!alts && alts.every(hasConst)`, vacuously true for
 * `oneOf: []` — the shape `lib/systemHotWaterAdvancedSchema.ts` manufactures for an FHS
 * project with a `hw cylinder` and no wet heat-source plants yet. Its only consumer
 * re-checked the RAW array's length; this checks the RECORD-filtered one, which differs
 * only for an alternatives array whose entries are not objects at all (`oneOf: [true]`,
 * a legal-but-unwritten draft-2020-12 boolean schema). Swept: zero divergences across all
 * 2650 nodes of `data/schemas/core-input.schema.json` and `input_fhs.schema.json`.
 */
export function schemaHasConstAlternatives(schema: unknown, key: 'oneOf' | 'anyOf'): boolean {
  const alts = schemaAlternatives(readRecord(schema), key);
  return !!alts && alts.length > 0 && alts.every((alt) => Object.prototype.hasOwnProperty.call(alt, 'const'));
}

/**
 * Enum-like WITH AT LEAST ONE OPTION: a non-empty `.enum`, or non-empty oneOf/anyOf
 * alternatives that all carry a `const`.
 *
 * WHY "NON-EMPTY" IS LOAD-BEARING (R4.3b, adversarial review round 2, REAL finding —
 * carried forward from this predicate's original home in
 * `components/DirectAdvancedFields.tsx`): `pickDirectControl` asks this question FIRST,
 * ahead of type. An empty-alternatives schema answering "yes" would route to `EnumControl`
 * with ZERO options — permanently uneditable, not merely a cosmetic divergence. That shape
 * is REACHABLE in production, not synthetic: `lib/systemHotWaterAdvancedSchema.ts`'s
 * `inlineHotWaterSourceHeatSourceWetEnumOnHotWaterSubschema` manufactures
 * `HeatSourceWet: {type:'string', oneOf: []}` whenever an FHS project has a
 * CombiBoiler/HIU/HeatBattery `hw cylinder` and ZERO wet heat-source plants defined yet —
 * and its own hint text asks the user to TYPE a name ("No defined heat source (wet) names
 * yet. Add a Heat source (wet) system that defines a plant key, then link here."), which a
 * zero-option dropdown cannot accept. Answering "no" sends it to ordinary type dispatch
 * (string -> `TextControl`, a free-text input), which is what every render path this
 * subsystem has ever had did with it.
 *
 * R4.6b-2: the rule itself moved INTO `schemaHasEnum` / `schemaHasConstAlternatives`
 * (above), so this is now their disjunction rather than three predicate-plus-length pairs.
 * Behaviour is unchanged — see those two for the sweep that says so.
 */
export function isNonEmptyEnumLike(resolved: JsonRecord): boolean {
  return (
    schemaHasEnum(resolved) ||
    schemaHasConstAlternatives(resolved, 'oneOf') ||
    schemaHasConstAlternatives(resolved, 'anyOf')
  );
}

/** A BARE null-typed schema: exactly `{type: 'null'}`, nothing else. */
function isBareNullSchema(value: unknown): boolean {
  return isRecord(value) && value.type === 'null' && Object.keys(value).length === 1;
}

/**
 * R4.6a: collapse a NULLABLE WRAPPER — `anyOf`/`oneOf` of exactly `[X, {type:'null'}]`
 * — down to its non-null branch `X`. Idempotent and shape-preserving for everything
 * else: any node that is not exactly that pattern is returned UNCHANGED, by identity.
 *
 * WHY THE RESOLVED NODE, NOT JUST DISPATCH (this is the load-bearing half): teaching
 * `pickDirectControl` to peek inside the wrapper would fix WHICH control renders and
 * nothing else. `numericInputAttributesFromSchema` (`components/numericDraftInput.ts`)
 * reads `minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum` / `multipleOf`
 * off the TOP LEVEL of whatever schema node NumberControl is handed, and on a wrapper
 * those keywords sit one level down, on the inner branch. A dispatch-only fix would
 * therefore have produced a NumberControl with no `min`, no `max`, no `step` — the
 * numeric draft buffer and unit adornment back, the schema constraints still silently
 * dropped. Unwrapping the node itself fixes dispatch and rendering in one move, and
 * leaves every consumer downstream (controls, validators, placeholder generation) free
 * to keep reading keywords off the top level the way they always have.
 *
 * PATTERN, DELIBERATELY STRICT — this is a targeted normalization of one HEM/pydantic
 * emission habit (`Optional[float]` -> `anyOf:[{type:'number'},{type:'null'}]`), not a
 * general combinator resolver. A layer is collapsed ONLY when the keyword's value is an
 * array of exactly 2 entries, exactly one of which is a BARE `{type:'null'}` (see
 * `isBareNullSchema` — a null branch carrying anything else is not this pattern), and
 * the other is a record. Three branches, no null branch, a null branch with siblings:
 * all left alone, returned by identity. Collapsing those would mean CHOOSING a branch,
 * which is a semantic decision no renderer should make silently; they keep falling
 * through `pickDirectControl` rule (f) to TextControl's JSON blob exactly as before.
 *
 * A COMBINATOR INSIDE THE SURVIVING BRANCH IS CARRIED THROUGH, NOT ERASED (review
 * round 1, REAL BUG — this function shipped in R4.6a's first commit doing the
 * opposite). `{...inner, ...node}` lets the WRAPPER win every keyword it declares,
 * which is right for annotations and wrong for exactly one keyword: the combinator
 * being collapsed. When the surviving branch carried the SAME keyword as the wrapper,
 * the wrapper's array overwrote the inner's and the very next line deleted it, leaving
 * a node with no type, no enum and no combinator at all — which is worse than a wrong
 * control, because `schemaEmitsControl` then returns false and the flat walk drops the
 * property, so THE ROW DISAPPEARS from the grid. Core has exactly one such node,
 * `$defs/ControlChargeTarget.charge_level` (`anyOf:[{$ref ChargeLevel},{type:'null'}]`
 * where `ChargeLevel` is itself `anyOf:[number, array-of-number, ScheduleForDouble]`),
 * and no element subschema routes to it — but `DirectSpecFields` passes host-supplied
 * `options.schemaOverride` nodes through this same function, and those are arbitrary
 * web-builder output, so "not reachable from a published schema today" was never the
 * whole reachability question. The inner's own combinator is now restored after the
 * merge; that node collapses to `{anyOf:[number, array, ScheduleForDouble], …}` and
 * renders the JSON blob this docstring always claimed it would.
 *
 * IDEMPOTENT BY CONSTRUCTION, via a fixpoint rather than a promise: each pass consumes
 * exactly one wrapper layer, and passes repeat until nothing changes, so the result is
 * always a node this function would leave alone. That also makes `Optional[Optional[X]]`
 * (`{oneOf:[{anyOf:[X,{null}]},{null}]}`) collapse all the way to `X` instead of one
 * layer short — a single pass would have left a second wrapper standing and dispatched
 * it to TextControl, and calling the function twice would have returned something
 * different from calling it once. Termination does not rest on the bound: every pass
 * strictly removes one combinator array from a finite structure. The bound is there
 * because a `$ref` cycle that `dereferenceSchemaNodeInRoot`'s own `seen` guard left
 * partially inlined could in principle feed this a self-referential node, and a
 * renderer must not hang on a malformed schema. No live schema needs a second pass.
 *
 * ANNOTATIONS COME FROM THE OUTER NODE ONLY — this function moves TYPE and
 * CONSTRAINTS, never presentation. `title` and `description` survive exactly as the
 * wrapper declared them, and if the wrapper declared none, the result carries none
 * either (so `labelForProperty` start-cases the key, as it does for any other
 * titleless property). The inner branch's own `title`/`description` are DROPPED. That
 * asymmetry is deliberate and is the difference between fixing a dispatch bug and
 * quietly renaming fields:
 *  - The wrapper IS the property; the inner branch is the TYPE the property was
 *    declared as. HEM's schemas are pydantic-emitted, so an inner `title` is a model
 *    or enum CLASS NAME ("MVHRLocation", "MechanicalVentilationPosition",
 *    "WindShieldLocation", "PartyWallLiningType"), not a field label — and every
 *    nullable-wrapped property that has any label at all today gets it from the
 *    wrapper ("MVHR Efficiency", "U-Value", "Duct Perimeter").
 *  - Letting the inner title through would rename Core `position_intake` AND
 *    `position_exhaust` to the SAME string, "MechanicalVentilationPosition" — two
 *    distinct rows in one grid, indistinguishable. Verified by running it that way
 *    first; that is what sent this rule the other direction.
 *  - It also keeps `description` byte-identical wherever inner and outer BOTH carry one,
 *    and the property-site text is always the specific one ("Orientation for non-MVHR
 *    systems…" against the generic `$def` sentence). FIVE live routes are in that
 *    position, not the two this line used to name: Core `MechanicalVentilation`'s
 *    `orientation360`, `pitch`, `position_intake` and `position_exhaust` — the last two
 *    being the very pair the bullet above uses as its example — plus
 *    `BuildingElementPartyWall.party_wall_lining_type`. (Across the published files as a
 *    whole, ignoring reachability, Core has 22 such wrappers and FHS none; the other 17
 *    sit inside dictionary ITEM schemas or behind unopened System branches, one level
 *    below anything a Control scope reaches.) Node-level `description` is not rendered
 *    by any control today — only per-OPTION descriptions inside enum alternatives are,
 *    by EnumControl — so this costs nothing and pre-empts the question if that ever
 *    changes.
 * Net effect on labels across every live wrapper: ZERO changes, with one intended
 * exception noted at the `mvhr_location` deletion site in `AdvancedFieldsEditor.tsx`.
 *
 * TWO MORE KEYWORDS ARE DROPPED:
 *  - the WRAPPER's own `anyOf`/`oneOf`, obviously — it is what is being collapsed.
 *    Leaving it on would re-trigger `schemaEmitsControl`'s combinator short-circuit
 *    and, worse, hand `isNonEmptyEnumLike` a non-const alternatives array to reason
 *    about. (The SURVIVING BRANCH's own combinator, if it has one, is a different
 *    keyword instance and is kept — see above.)
 *  - a `default` of exactly `null`. Every nullable wrapper on a LIVE ROUTE — the 43 the
 *    standing invariant sweeps — carries `default: null`, and that default describes the
 *    NULL branch that was just dropped: it is the schema saying "this optional field is
 *    absent", not "this number defaults to nothing". Carrying it onto a NumberControl
 *    would misrepresent the field. A non-null `default` describes the surviving branch
 *    and IS carried.
 *
 *    SCOPED TO ROUTES DELIBERATELY, because it is NOT true of the schemas as a whole and
 *    an earlier version of this line said it was. Sweeping every `anyOf`/`oneOf` node in
 *    both published files finds 160 nullable wrappers in Core and 6 in FHS, of which
 *    EIGHT lack a `default: null`: Core's `/properties/Control`,
 *    `$defs/HeatPumpHotWaterOnly.heat_exchanger_surface_area_declared`,
 *    `$defs/HotWaterSourcePointOfUse.efficiency` and the three
 *    `$defs/ScheduleRepeaterEntryFor{Boolean,DegreesCelsius,Double}` defs (no `default`
 *    at all), Core's `$defs/WetEmitterFanCoil.n_units` (`default: 1`), and FHS's own
 *    `$defs/ScheduleRepeaterEntryForDouble`. None is on a live route today — several sit
 *    behind Core System discriminator branches the flattener does not open (see the
 *    VERIFIED NOT LIVE note in `pickDirectControl`'s docstring) — but "not reachable
 *    today" is a fact about routes, not about the schema, and the day one becomes
 *    reachable the CODE is already right: it drops only an exactly-`null` default and
 *    carries `n_units`' `1` through. The alternative — dropping every `default`
 *    unconditionally — would lose that.
 *
 * R4.6b-2: moved here from `components/DirectAdvancedFields.tsx`, unchanged. It was
 * exported from component-space for the parent repo's `SimplifiedFabricEditor` and
 * `SnippetEditor`, which make the same dispatch decision against the same published
 * schemas; lib-space is where a pure schema normalization belongs, and is what lets
 * `isPrimitiveOrEnumSchemaNode` (below) compose with it without importing a component.
 */
export function unwrapNullableSchema(node: JsonRecord): JsonRecord {
  let current = node;
  // Bounded only against a malformed self-referential node; see the docstring's
  // idempotence paragraph. No published schema needs more than one pass.
  for (let pass = 0; pass < 8; pass += 1) {
    const next = unwrapNullableSchemaLayer(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

/** One layer of {@link unwrapNullableSchema}; returns `node` itself when nothing matches. */
function unwrapNullableSchemaLayer(node: JsonRecord): JsonRecord {
  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const branches = node[keyword];
    if (!Array.isArray(branches) || branches.length !== 2) continue;
    if (branches.filter(isBareNullSchema).length !== 1) continue;
    const inner = branches.find((branch) => !isBareNullSchema(branch));
    if (!isRecord(inner)) continue;

    // Inner first, wrapper laid over the top: the wrapper wins every keyword it
    // actually declares, the inner branch supplies the rest (type, constraints, enum,
    // properties, items, …).
    const merged: JsonRecord = { ...inner, ...node };
    // …except this one. `...node` just overwrote any same-named combinator the
    // surviving branch declared, and the wrapper's copy is the one being consumed, so
    // hand the inner's back rather than deleting both. See the docstring's
    // COMBINATOR INSIDE THE SURVIVING BRANCH paragraph — deleting both is the review
    // round 1 bug that made whole rows vanish.
    if (keyword in inner) merged[keyword] = inner[keyword];
    else delete merged[keyword];
    if (merged.default === null) delete merged.default;
    for (const annotation of ['title', 'description'] as const) {
      if (!(annotation in node)) delete merged[annotation];
    }
    return merged;
  }
  return node;
}

const PRIMITIVE_SCHEMA_TYPES: ReadonlySet<string> = new Set(['string', 'number', 'integer', 'boolean']);

/**
 * Does this schema node describe a SCALAR ROW — i.e. would a direct renderer give it a
 * single input or dropdown, rather than a JSON blob?
 *
 * `unwrapNullableSchema` first, because HEM Core wraps every optional scalar as
 * `anyOf:[<real schema>, {type:null}]` and reading `type` off that wrapper is the
 * recurring bug class in this subsystem (it has bitten `numericInputAttributesFromSchema`,
 * `generateCompletePlaceholder` and `SimplifiedFabricEditor`'s `buildControls`).
 *
 * R4.6b-2: PORTED from the parent repo's `web/src/components/SnippetEditor.tsx`, whose own
 * copy was written as a deliberate third instance of this rule with a docstring saying it
 * was waiting for this module. Its callers ask the offer-side question — which of a
 * schema's properties are worth OFFERING as a row when the data does not have them yet
 * (`SnippetEditor`'s `compliance_settings` union, `SimplifiedFabricEditor`'s fabric union),
 * where an object- or array-typed property needs real data before a row means anything.
 *
 * COMPOSED, not copied: the hand-inlined enum/const/type tests in the original are the
 * predicates above, with two differences that are behaviour, not style, and were measured
 * rather than assumed —
 *  - `Array.isArray(s.enum)` becomes {@link isNonEmptyEnumLike}, so a bare `{enum: []}`
 *    with no `type` is no longer OFFERED as a row. It never renders as an enum anyway
 *    (`pickDirectControl` sends it to `TextControl`), and offering a property whose schema
 *    advertises zero legal values is not an offer worth making.
 *  - the original read `oneOf` OR ELSE `anyOf` (never both), and did not filter
 *    non-record branches; the shared predicates check each keyword independently and
 *    filter first.
 * Both differences were swept against every node of `data/schemas/core-input.schema.json`
 * and `input_fhs.schema.json` — 2650 nodes, ZERO acceptance divergences, and the FHS root
 * offer is still exactly the 14-of-31 primitive/enum properties the original's caller
 * documents.
 */
export function isPrimitiveOrEnumSchemaNode(node: unknown): boolean {
  if (!isRecord(node)) return false;
  const resolved = unwrapNullableSchema(node);
  if (isNonEmptyEnumLike(resolved)) return true;
  return schemaTypeList(resolved).some((type) => PRIMITIVE_SCHEMA_TYPES.has(type));
}
