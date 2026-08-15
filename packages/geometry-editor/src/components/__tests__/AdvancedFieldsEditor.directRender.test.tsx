// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * R4.4: direct-render characterization matrix for Advanced Fields, across every
 * element type family, not just ElectricBattery (see
 * `AdvancedFieldsEditor.electricBattery.test.tsx` for the detailed single-type
 * characterization this generalizes from).
 *
 * HISTORY: through R4.3 this file was an A/B parity matrix (DirectAdvancedFields vs.
 * the legacy JsonForms mount, toggled by a fallback flag), asserting the two paths
 * produced byte-identical output. R4.4 retired the JsonForms mount and its fallback
 * flag entirely (see `components/AdvancedFieldsEditor.tsx` and the deleted
 * `lib/directRenderAdvancedFieldsFlag.ts`), so there is no second path left to compare
 * against. Every expectation below was captured verbatim from the last GREEN run of
 * the A/B version (the direct-render/"ON" side, which is now simply the only side) —
 * not hand-derived — so this file still proves the direct renderer produces exactly
 * what it always did, just without the deleted comparator.
 *
 * Every configuration below asserts, in order:
 *  (a) the ordered `data-field-key` list (`fieldKeys`) — ordering is load-bearing (see
 *      the project convention noted throughout this file and `DirectAdvancedFields.tsx`).
 *  (b) per-field label text (`fieldLabelText`).
 *  (c) per-field input-signature (`inputSignatureForRow`: select / checkbox /
 *      textbox+min/data-exclusive-minimum).
 * Row-level DOM equality (`normalizedRowHtml`) is gone with the deleted comparator —
 * there is nothing left to normalize id/for/aria-describedby churn against.
 */

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import coreSchema from '../../../../../data/schemas/core-input.schema.json';
import fhsSchema from '../../../../../data/schemas/input_fhs.schema.json';
import {
  canonicalGeometrySchemaPort,
  configureGeometrySchemaAssetSource,
  resetGeometrySchemaAssetsForTests,
} from '../../lib/geometrySchemaPort';
import { GeometryEditorServicePortsProvider } from '../../../../geometry-editor-host/src/editorServicePorts';
import { unavailableGeometryWorkspaceResourcePort } from '../../../../geometry-editor-host/src/workspaceResourcePort';
import { createGeometryStore, GeometryStoreProvider } from '../../stores/geometryStore';
import type { Element, SystemSubcategory } from '../../geometry/types';
import { AdvancedFieldsEditor } from '../AdvancedFieldsEditor';
import {
  DirectAdvancedFields,
  DirectSpecFields,
  pickDirectControl,
  type DirectSpecNode,
} from '../DirectAdvancedFields';
import { unwrapNullableSchema } from '../../lib/schemaShape';
import { ELEMENT_TYPE_ORDER } from '../../lib/elementTypeMetadata';
import { dereferenceSchemaNodeInRoot } from '../../lib/subschemaCache';
import { resolveSchemaPointer } from '../../lib/schemaRefResolver';
import { expandSystemMergeMapSchemaForJsonForms } from '../../lib/systemAdvancedSchemaExpand';
import { flattenSystemSubtypePlantSchemas } from '../../lib/systemSchemaFlatten';
import {
  buildSystemAdvancedUischema,
  type AdvancedFieldsLayoutNode,
} from '../../lib/systemAdvancedUischema';
import { GroupAccordion, validateAdvancedFieldPrimitive, WindowPartListControl } from '../jsonformsRenderers';
import { getElementSubschemaForMode, validatePropertyValueForMode } from '../../lib/schemaCache';

beforeAll(async () => {
  configureGeometrySchemaAssetSource({
    loadText: async (mode) => JSON.stringify(mode === 'fhs' ? fhsSchema : coreSchema),
  });
  await Promise.all([
    canonicalGeometrySchemaPort.preload('core'),
    canonicalGeometrySchemaPort.preload('fhs'),
  ]);
});

afterAll(() => resetGeometrySchemaAssetsForTests());

afterEach(() => {
  cleanup();
});

function ControlledHarness({
  elementType,
  subtype,
  useFHSSchema,
  initialCurrentData,
  onChange,
}: {
  elementType: string;
  subtype?: string;
  useFHSSchema: boolean;
  initialCurrentData: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}) {
  const [currentData, setCurrentData] = React.useState<Record<string, unknown>>(initialCurrentData);
  return (
    <AdvancedFieldsEditor
      elementType={elementType}
      subtype={subtype}
      currentData={currentData as never}
      onChange={(next) => {
        const record = next as unknown as Record<string, unknown>;
        onChange(record);
        setCurrentData(record);
      }}
      collapsible={false}
      useFHSSchema={useFHSSchema}
    />
  );
}

type MountArgs = {
  elementType: string;
  subtype?: string;
  useFHSSchema: boolean;
  extraJson: Record<string, unknown>;
  currentDataExtra?: Record<string, unknown>;
  onChange?: ReturnType<typeof vi.fn>;
};

function renderEditor({
  elementType,
  subtype,
  useFHSSchema,
  extraJson,
  currentDataExtra = {},
  onChange = vi.fn(),
}: MountArgs) {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const utils = render(
    <GeometryEditorServicePortsProvider
      schemaPort={canonicalGeometrySchemaPort}
      workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
    >
      <GeometryStoreProvider store={store}>
        <ControlledHarness
          elementType={elementType}
          subtype={subtype}
          useFHSSchema={useFHSSchema}
          initialCurrentData={{ type: elementType, ...currentDataExtra, extra_json: extraJson }}
          onChange={onChange}
        />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  return { onChange, ...utils };
}

function fieldKeys(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-field-key]')).map(
    (el) => el.getAttribute('data-field-key') as string,
  );
}

function fieldRow(container: HTMLElement, key: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-field-key="${key}"]`);
  if (!row) throw new Error(`field row not found for key: ${key}`);
  return row;
}

/**
 * Same leaf `key` can legitimately repeat across plants in multi-plant System mode
 * (each plant gets its own control set) -- `fieldRow` above picks the first DOM match
 * only, so a multi-plant test that edits a specific plant's field needs to disambiguate
 * by the plant-key label prefix instead.
 */
function fieldRowByLabel(container: HTMLElement, key: string, labelSubstring: string): HTMLElement {
  const rows = Array.from(container.querySelectorAll<HTMLElement>(`[data-field-key="${key}"]`));
  const match = rows.find((r) => fieldLabelText(r).includes(labelSubstring));
  if (!match) {
    throw new Error(`no row for key="${key}" with label containing "${labelSubstring}"`);
  }
  return match;
}

/** See `AdvancedFieldsEditor.electricBattery.test.tsx` for the DOM-shape rationale. */
function fieldLabelText(row: HTMLElement): string {
  return row.children[0]?.children[0]?.children[0]?.textContent?.trim() ?? '';
}

type InputSignature =
  | { kind: 'select' }
  | { kind: 'checkbox' }
  | { kind: 'textbox'; min: string | null; exclusiveMinimum: string | null }
  | { kind: 'other'; tag: string };

function inputSignatureForRow(row: HTMLElement): InputSignature {
  const select = row.querySelector('select');
  if (select) return { kind: 'select' };
  const checkbox = row.querySelector('input[type="checkbox"]');
  if (checkbox) return { kind: 'checkbox' };
  const textbox = row.querySelector('input');
  if (textbox) {
    return {
      kind: 'textbox',
      min: textbox.getAttribute('min'),
      exclusiveMinimum: textbox.getAttribute('data-exclusive-minimum'),
    };
  }
  // WindowPartListControl and similar composite rows have no single <input>/<select>
  // at the top level; identify them structurally rather than crash.
  return { kind: 'other', tag: row.firstElementChild?.tagName ?? 'unknown' };
}

type ExpectedRow = { key: string; label: string; sig: InputSignature };

function row(key: string, label: string, sig: InputSignature): ExpectedRow {
  return { key, label, sig };
}

const SELECT: InputSignature = { kind: 'select' };
const CHECKBOX: InputSignature = { kind: 'checkbox' };
function TEXT(min: string | null, exclusiveMinimum: string | null = null): InputSignature {
  return { kind: 'textbox', min, exclusiveMinimum };
}
function OTHER(tag: string): InputSignature {
  return { kind: 'other', tag };
}

/**
 * Mounts once (no flag mechanics -- there is only one path since R4.4) and asserts the
 * rendered `[data-field-key]` rows, in DOM order, against literal `expectedRows`
 * captured from the last A/B GREEN run's direct-render side. Returns the still-mounted
 * container so callers can layer config-specific assertions (interaction payloads,
 * label-prefix content, …) on top without a second mount.
 */
function assertDirectCharacterization(args: MountArgs, expectedRows: ExpectedRow[]): { container: HTMLElement } {
  const { container } = renderEditor(args);
  if (expectedRows.length > 0) {
    expect(container.querySelector('[data-testid="direct-advanced-fields"]')).not.toBeNull();
  }
  const rowEls = Array.from(container.querySelectorAll<HTMLElement>('[data-field-key]'));
  expect(rowEls.map((el) => el.getAttribute('data-field-key'))).toEqual(expectedRows.map((r) => r.key));
  rowEls.forEach((el, i) => {
    expect(fieldLabelText(el)).toEqual(expectedRows[i].label);
    expect(inputSignatureForRow(el)).toEqual(expectedRows[i].sig);
  });
  return { container };
}

/**
 * R4.6a STANDING INVARIANT — the highest-value part of that slice, and the reason it
 * lives here rather than beside a single fixture.
 *
 * The bug it guards was never about one field. HEM wraps optional scalars as
 * `anyOf:[X, {type:'null'}]` (pydantic `Optional[T]`), and a wrapper carries no
 * top-level `type`/`enum` of its own, so `pickDirectControl` had nothing to dispatch on
 * and sent the whole class to TextControl — 26 property routes, 23 of them NUMBERS
 * silently rendering as constraint-free text boxes. It was found and patched TWICE, one
 * field at a time (`shield_fact_location`, then `mvhr_location` a slice later), because
 * each patch was written against the field in front of the reviewer rather than against
 * the shape. `unwrapNullableSchema` fixes the shape; this test is what stops the class
 * from re-opening one property at a time when HEM publishes its next schema.
 *
 * WHAT IS SWEPT, AND WHAT A "ROUTE" IS (review round 1 corrected both — the first
 * version of this sweep covered one of the three walks and concluded, wrongly, that FHS
 * carried no wrappers at all). The unit is a ROUTE: one (profile, walk-and-container,
 * property) triple, because the same `$def` property can be reached by more than one
 * walk and an unreachable property is not a bug. Both walks that resolve schemas off
 * the published roots are driven for real, through the real port:
 *  - the FLAT walk (`DirectAdvancedFields`' `schema.properties` loop) — every element
 *    type in `ELEMENT_TYPE_ORDER` × every subtype in `SWEPT_SUBTYPES`, both profiles.
 *  - the SYSTEM LAYOUT walk (`renderLayoutNode`) — every `SystemSubcategory`, both
 *    profiles, built through the SAME pipeline `AdvancedFieldsEditor`'s subschema memo
 *    uses (`expandSystemMergeMapSchemaForJsonForms` -> deref ->
 *    `flattenSystemSubtypePlantSchemas` -> `buildSystemAdvancedUischema`), then each
 *    emitted `Control` scope resolved with `resolveSchemaPointer` + deref exactly as
 *    that walk does. This is the half the first version missed entirely: for `System`
 *    the flat sweep sees one object-typed property and contributes nothing, which hid
 *    Core's three `InfiltrationVentilation` limits and all four live FHS wrappers.
 * The third resolution site, `DirectSpecFields`' `Control` branch, takes host-supplied
 * `options.schemaOverride` nodes rather than published-schema nodes, so there is no
 * population to sweep — it is covered by the unit-level contract tests below and by the
 * `DirectSpecFields` characterizations further down this file.
 *
 * WHY THE SYSTEM SWEEP NEEDS PLANT FIXTURES: FHS hides four of its five wrappers inside
 * `allOf`/`then` conditional branches keyed on a plant's `type` discriminator
 * (`hw cylinder` must be `{type:'CombiBoiler'}` to open `allOf[4]`). Those branches are
 * flattened by `flattenSystemSubtypePlantSchemas` against LIVE plant JSON, so the sweep
 * supplies the minimal discriminator stubs in `SYSTEM_PLANT_FIXTURES` — nothing else,
 * so it stays obvious that they exist to open branches rather than to shape results.
 *
 * WHAT THAT MAKES THE SYSTEM HALF: FIXTURE-BOUNDED, not exhaustive. Read the counts
 * below as "every route these fixtures open", never as "every route the schemas hold".
 * `SYSTEM_PLANT_FIXTURES` opens ONE discriminator branch per subcategory on Core —
 * `HotWaterSource` -> `CombiBoiler` of 6, `SpaceHeatSystem` -> `WetDistribution` of 4,
 * `SpaceCoolSystem` -> `AirConditioning` of 1 (complete, by luck of there being one) —
 * and two of `HeatSourceWet`'s 4 (`Boiler`, `HeatPump`). `WWHRS` has no fixture and
 * contributes zero routes on both profiles; `HotWaterDemand` has none either but needs
 * none, being a plain object rather than a discriminated map, and does contribute (4
 * routes, 3 wrappers, on Core). And on CORE the System walk is nearly empty regardless
 * of fixtures: `flattenIfThenAllOfProperties` resolves FHS's `allOf`/`if`/`then` but
 * never selects a branch of Core's discriminated `oneOf`, so a Core plant schema stays a
 * bare combinator node with no `properties` for `buildSystemAdvancedUischema` to walk —
 * measured, `System:HeatSourceWet` contributes 2 routes and `HotWaterSource`,
 * `SpaceCoolSystem`, `SpaceHeatSystem` one each, none of them wrappers. The invariant is
 * still worth what it costs, but expanding the fixtures (or fixing Core's flattening) is
 * what would widen it, and the `moved` list below would grow when either happens.
 *
 * TWO ORACLES, ONE OF WHICH IS GENUINELY INDEPENDENT — stated plainly because it bounds
 * what this test can catch:
 *  - `controlExpectedFromInnerBranchType` IS independent: it reads `inner.type` /
 *    `inner.enum` directly and never calls a production helper, so it cannot agree with
 *    `pickDirectControl` by sharing its bug.
 *  - `nullableInnerBranch` is NOT: it restates `unwrapNullableSchema`'s matching rule.
 *    A test cannot both use the contract to classify and check the contract from
 *    scratch. What guards the matcher instead is (a) the pinned `moved` list below — if
 *    the matcher narrowed, routes drop out of it and the literal comparison fails — and
 *    (b) the two-armed assertion in the first `it`, which sweeps EVERY combinator-
 *    bearing node, not just matching ones, and requires non-matching ones to come back
 *    by identity. Over-matching and under-matching therefore both fail something.
 */
const ADVANCED_FIELD_ELEMENT_TYPES = ELEMENT_TYPE_ORDER;

/**
 * Subtypes are swept because `getElementSubschema` resolves a DIFFERENT subschema per
 * subtype (floor-type variants, emitter families, …). `undefined` is included: it is
 * what most element types are mounted with.
 */
const SWEPT_SUBTYPES: (string | undefined)[] = [
  undefined,
  'wall', 'roof', 'floor', 'door', 'ceiling',
  'Slab_no_edge_insulation', 'Slab_edge_insulation', 'Suspended_floor',
  'Heated_basement', 'Unheated_basement', 'Exposed_floor',
  'radiator', 'ufh', 'fancoil',
];

const SWEPT_SYSTEM_SUBTYPES = [
  'HeatSourceWet',
  'HotWaterSource',
  'HotWaterDemand',
  'InfiltrationVentilation',
  'SpaceCoolSystem',
  'SpaceHeatSystem',
  'WWHRS',
] as const satisfies readonly SystemSubcategory[];

/**
 * Minimal `extra_json[subtype]` slices: plant keys plus the `type` discriminator each
 * conditional branch keys on, and nothing else. `hw cylinder: {type:'CombiBoiler'}` is
 * the one that matters — it opens FHS `HotWaterSource`'s `allOf[4].then`, where the
 * four live FHS nullable wrappers live.
 */
const SYSTEM_PLANT_FIXTURES: Record<string, Record<string, unknown>> = {
  HeatSourceWet: { boiler: { type: 'Boiler' }, hp: { type: 'HeatPump' } },
  HotWaterSource: { 'hw cylinder': { type: 'CombiBoiler' } },
  SpaceHeatSystem: { 'Zone 1 circuit': { type: 'WetDistribution' } },
  SpaceCoolSystem: { cooler: { type: 'AirConditioning' } },
};

type CombinatorRoute = {
  mode: 'core' | 'fhs';
  /** Where the node was reached: an element type, or `System:<subcategory>` for the layout walk. */
  container: string;
  property: string;
  resolved: Record<string, unknown>;
  /** The non-null branch when this is a nullable wrapper; `null` for any other combinator shape. */
  inner: Record<string, unknown> | null;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Deliberately duplicated from `isBareNullSchema`: the sweep must not import the thing it audits. */
function isNullBranch(value: unknown): boolean {
  return isPlainRecord(value) && value.type === 'null' && Object.keys(value).length === 1;
}

/** See the two-oracles note above: this restates the contract, it does not independently verify it. */
function nullableInnerBranch(node: Record<string, unknown>): Record<string, unknown> | null {
  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const branches = node[keyword];
    if (!Array.isArray(branches) || branches.length !== 2) continue;
    if (branches.filter(isNullBranch).length !== 1) continue;
    const inner = branches.find((branch) => !isNullBranch(branch));
    if (isPlainRecord(inner)) return inner;
  }
  return null;
}

/** The weak, obviously-independent membership test the sweep collects on. */
function hasCombinator(node: Record<string, unknown>): boolean {
  return ['anyOf', 'oneOf', 'allOf'].some((keyword) => Array.isArray(node[keyword]));
}

/**
 * Independent oracle: what control the INNER branch alone implies, read straight off
 * its `type`/`enum` with no reference to `pickDirectControl`'s rule table. Anything
 * that is not a scalar or an enum (object, array) is a JSON blob -> 'text', which is
 * where TextControl legitimately belongs.
 */
function controlExpectedFromInnerBranchType(inner: Record<string, unknown>): string {
  if (Array.isArray(inner.enum) && inner.enum.length > 0) return 'enum';
  const type = inner.type;
  if (type === 'boolean') return 'boolean';
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'string') return 'text';
  return 'text';
}

function layoutControlScopes(node: AdvancedFieldsLayoutNode, out: string[] = []): string[] {
  if (node.type === 'VerticalLayout') {
    for (const child of node.elements ?? []) layoutControlScopes(child, out);
    return out;
  }
  if (node.scope) out.push(node.scope);
  return out;
}

/** Every combinator-bearing property node reachable through either published-schema walk. */
function sweepCombinatorRoutes(): CombinatorRoute[] {
  const found: CombinatorRoute[] = [];
  const seen = new Set<string>();

  const record = (mode: 'core' | 'fhs', container: string, property: string, resolved: unknown) => {
    if (!isPlainRecord(resolved) || !hasCombinator(resolved)) return;
    const key = `${mode}/${container}.${property}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ mode, container, property, resolved, inner: nullableInnerBranch(resolved) });
  };

  for (const mode of ['core', 'fhs'] as const) {
    const root = canonicalGeometrySchemaPort.getRootSchema(mode) as Record<string, unknown> | null;

    // Walk 1: the flat walk.
    for (const elementType of ADVANCED_FIELD_ELEMENT_TYPES) {
      for (const subtype of SWEPT_SUBTYPES) {
        const subschema = canonicalGeometrySchemaPort.getElementSubschema(mode, elementType, subtype) as
          | Record<string, unknown>
          | null;
        if (!subschema || !isPlainRecord(subschema.properties)) continue;
        const defs = (subschema as { $defs?: unknown }).$defs ?? (root as { $defs?: unknown } | null)?.$defs;
        const properties = subschema.properties as Record<string, unknown>;
        for (const property of Object.keys(properties)) {
          record(mode, elementType, property, dereferenceSchemaNodeInRoot(properties[property], { $defs: defs }));
        }
      }
    }

    // Walk 2: the System layout walk, through the real builder pipeline.
    for (const subtype of SWEPT_SYSTEM_SUBTYPES) {
      const raw = canonicalGeometrySchemaPort.getElementSubschema(mode, 'System', subtype) as
        | Record<string, unknown>
        | null;
      if (!raw || !root) continue;
      const plants = SYSTEM_PLANT_FIXTURES[subtype] ?? {};
      const expanded = expandSystemMergeMapSchemaForJsonForms(raw, subtype, plants) ?? raw;
      const derefed = dereferenceSchemaNodeInRoot(expanded, root) as Record<string, unknown>;
      const subschema = flattenSystemSubtypePlantSchemas(derefed, subtype, plants, root);
      const defs = (subschema as { $defs?: unknown }).$defs ?? (root as { $defs?: unknown } | null)?.$defs;
      for (const scope of layoutControlScopes(buildSystemAdvancedUischema(subtype, subschema))) {
        const property = scope.split('/').pop() ?? scope;
        record(
          mode,
          `System:${subtype}`,
          property,
          dereferenceSchemaNodeInRoot(resolveSchemaPointer(subschema, scope), { $defs: defs }),
        );
      }
    }
  }
  return found;
}

describe('R4.6a standing invariant: nullable-wrapped schemas dispatch on their inner branch', () => {
  it('every nullable wrapper reaches the control its inner branch implies, and every other combinator shape is left alone', () => {
    const routes = sweepCombinatorRoutes();
    const wrappers = routes.filter((route) => route.inner);

    // Guard against the sweep silently finding nothing (a renamed port method, an empty
    // subschema map, a builder signature change) and the invariant passing vacuously
    // forever after. Floors, not equalities -- the pinned list below is where exact
    // population drift is meant to surface.
    expect(routes.length).toBeGreaterThanOrEqual(50);
    expect(wrappers.length).toBeGreaterThanOrEqual(43);
    // Arm 2 below needs a non-wrapper population to be worth anything; without this
    // floor it could quietly become vacuous if the sweep stopped reaching them.
    expect(routes.length - wrappers.length).toBeGreaterThanOrEqual(7);

    // Arm 1: a matching wrapper dispatches on its inner branch.
    const mismatches = wrappers
      .map((route) => ({
        field: `${route.mode}/${route.container}.${route.property}`,
        actual: pickDirectControl(unwrapNullableSchema(route.resolved)),
        expected: controlExpectedFromInnerBranchType(route.inner as Record<string, unknown>),
      }))
      .filter((result) => result.actual !== result.expected);
    expect(mismatches).toEqual([]);

    // Arm 2: a combinator that is NOT the nullable pattern comes back by identity --
    // the unwrap must not start collapsing branches it has no business choosing
    // between. Together with arm 1 this fails on both over- and under-matching.
    const wronglyTouched = routes
      .filter((route) => !route.inner && unwrapNullableSchema(route.resolved) !== route.resolved)
      .map((route) => `${route.mode}/${route.container}.${route.property}`);
    expect(wronglyTouched).toEqual([]);
  });

  it('pins the population: every wrapper was TextControl before, and these are the routes the unwrap moves', () => {
    const wrappers = sweepCombinatorRoutes().filter((route) => route.inner);

    // Every wrapper resolved WITHOUT unwrapping lands on TextControl -- that is the
    // single failure mode this whole class had, stated once rather than per row.
    for (const wrapper of wrappers) {
      expect(pickDirectControl(wrapper.resolved)).toBe('text');
    }

    const moved = wrappers
      .map((route) => ({ route, control: pickDirectControl(unwrapNullableSchema(route.resolved)) }))
      .filter(({ control }) => control !== 'text')
      .map(({ route, control }) => `${route.mode}/${route.container}.${route.property} -> ${control}`)
      .sort();

    // Pinned literally so a schema update that adds or drops a misrouted route shows up
    // as a diff to read, not as a silently different pass.
    //
    // Two things worth reading off this list rather than re-deriving them:
    //  - FHS IS IN IT. R4.6a's first commit asserted `fhs` contributed nothing, on an
    //    invented "HEM flattens nullables in FHS" mechanism. It does not: FHS carries
    //    five property-level wrappers and four are live here, gated behind
    //    `hw cylinder: {type:'CombiBoiler'}` (the fifth,
    //    HeatSourceWet/boiler/cost_schedule_hybrid, wraps an OBJECT, so it is a JSON
    //    blob before and after and correctly absent).
    //  - `is_unheated_pitched_roof` and the two PartyWall entries are BASE fields
    //    (`getBaseFieldsForElementType`) that never reach the Advanced Fields grid.
    //    Asserted anyway: that filter lives one layer above `pickDirectControl` and is
    //    not this invariant's to assume.
    expect(moved).toEqual([
      'core/BuildingElementAdjacentConditionedSpace.thermal_resistance_construction -> number',
      'core/BuildingElementAdjacentConditionedSpace.u_value -> number',
      'core/BuildingElementOpaque.is_unheated_pitched_roof -> boolean',
      'core/BuildingElementOpaque.thermal_resistance_construction -> number',
      'core/BuildingElementOpaque.u_value -> number',
      'core/BuildingElementPartyWall.party_wall_lining_type -> enum',
      'core/BuildingElementPartyWall.thermal_resistance_cavity -> number',
      'core/BuildingElementPartyWall.thermal_resistance_construction -> number',
      'core/BuildingElementPartyWall.u_value -> number',
      'core/BuildingElementTransparent.thermal_resistance_construction -> number',
      'core/BuildingElementTransparent.u_value -> number',
      'core/MechanicalVentilation.mid_height_air_flow_path -> number',
      'core/MechanicalVentilation.mvhr_eff -> number',
      'core/MechanicalVentilation.mvhr_location -> enum',
      'core/MechanicalVentilation.orientation360 -> number',
      'core/MechanicalVentilation.pitch -> number',
      'core/MechanicalVentilationDuctwork.duct_perimeter_mm -> number',
      'core/MechanicalVentilationDuctwork.external_diameter_mm -> number',
      'core/MechanicalVentilationDuctwork.internal_diameter_mm -> number',
      'core/System:InfiltrationVentilation.ach_max_static_calcs -> number',
      'core/System:InfiltrationVentilation.ach_min_static_calcs -> number',
      'core/System:InfiltrationVentilation.vent_opening_ratio_init -> number',
      'fhs/System:HotWaterSource.rejected_energy_1 -> number',
      'fhs/System:HotWaterSource.rejected_factor_3 -> number',
      'fhs/System:HotWaterSource.storage_loss_factor_1 -> number',
      'fhs/System:HotWaterSource.storage_loss_factor_2 -> number',
    ]);
  });

  it('leaves every other combinator shape alone', () => {
    // The unwrap is a targeted normalization of one pydantic emission habit, not a
    // general combinator resolver -- collapsing any of these would mean CHOOSING a
    // branch, a semantic decision no renderer should make silently.
    const untouched: Record<string, unknown>[] = [
      // Three branches, one of them null.
      { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }] },
      // Two branches, neither null.
      { anyOf: [{ type: 'number' }, { type: 'string' }] },
      // Null branch carrying siblings -- not a bare `{type:'null'}`.
      { anyOf: [{ type: 'number' }, { type: 'null', title: 'Nothing' }] },
      // Single branch.
      { anyOf: [{ type: 'number' }] },
      // allOf is not a nullable-wrapper keyword at all.
      { allOf: [{ type: 'number' }, { type: 'null' }] },
    ];
    for (const node of untouched) {
      expect(unwrapNullableSchema(node)).toBe(node);
    }

    // Idempotent on an already-flat node, and on its own output.
    const flat = { type: 'number', minimum: 0 };
    expect(unwrapNullableSchema(flat)).toBe(flat);
    const once = unwrapNullableSchema({ anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }], default: null });
    expect(once).toEqual({ type: 'number', minimum: 0 });
    expect(unwrapNullableSchema(once)).toBe(once);

    // Annotations: the WRAPPER's win, and the inner branch's never leak in (that rule
    // is what keeps `position_intake`/`position_exhaust` from both rendering as
    // "MechanicalVentilationPosition"). A non-null `default` survives; a `null` one
    // describes the branch that was just dropped and does not.
    expect(
      unwrapNullableSchema({
        anyOf: [{ type: 'string', enum: ['a'], title: 'InnerTypeName', description: 'inner' }, { type: 'null' }],
        title: 'Field Label',
      }),
    ).toEqual({ type: 'string', enum: ['a'], title: 'Field Label' });
    expect(
      unwrapNullableSchema({
        anyOf: [{ type: 'string', title: 'InnerTypeName' }, { type: 'null' }],
      }),
    ).toEqual({ type: 'string' });
    expect(
      unwrapNullableSchema({ anyOf: [{ type: 'number' }, { type: 'null' }], default: 3 }),
    ).toEqual({ type: 'number', default: 3 });
  });

  it('R4.6a review round 1: a combinator INSIDE the surviving branch survives the unwrap, and the row does not vanish', () => {
    // REAL BUG in R4.6a's first commit. The merge was `{...inner, ...node}` followed by
    // an unconditional `delete merged[keyword]` -- so when the surviving branch carried
    // the SAME keyword as the wrapper, `...node` overwrote the inner's array and the
    // delete removed the wrapper's, leaving a node with no type, no enum and no
    // combinator. That is worse than a wrong control: `schemaEmitsControl` returns false
    // for it, so `DirectAdvancedFields`' flat walk never pushes the property and the ROW
    // DISAPPEARS.
    //
    // The real Core node with this shape (`$defs/ControlChargeTarget.charge_level`,
    // read from the port rather than hand-copied so it cannot drift): a nullable wrapper
    // around a `$ref` to `ChargeLevel`, which is itself a three-branch `anyOf`. No
    // element subschema routes to `ControlChargeTarget` -- but `DirectSpecFields` passes
    // host-supplied `options.schemaOverride` nodes through the same function, and those
    // are arbitrary web-builder output, so unreachability in the published schemas was
    // never the whole reachability question.
    const coreRoot = canonicalGeometrySchemaPort.getRootSchema('core') as {
      $defs?: Record<string, { properties?: Record<string, unknown> }>;
    } | null;
    const chargeLevel = coreRoot?.$defs?.ControlChargeTarget?.properties?.charge_level as Record<string, unknown>;
    expect(chargeLevel).toMatchObject({ anyOf: [{ $ref: '#/$defs/ChargeLevel' }, { type: 'null' }] });

    const resolved = dereferenceSchemaNodeInRoot(chargeLevel, coreRoot) as Record<string, unknown>;
    const unwrapped = unwrapNullableSchema(resolved);
    // The inner three-branch combinator is still there, so the node still describes
    // something and still emits a control.
    expect(Array.isArray(unwrapped.anyOf)).toBe(true);
    expect((unwrapped.anyOf as unknown[]).length).toBe(3);
    expect(pickDirectControl(unwrapped)).toBe('text');

    // DOM-level: the row renders. Under the bug this mounted with `plain` only.
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const { container } = render(
      <GeometryEditorServicePortsProvider
        schemaPort={canonicalGeometrySchemaPort}
        workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
      >
        <GeometryStoreProvider store={store}>
          <DirectAdvancedFields
            schema={{ type: 'object', properties: { charge_level: chargeLevel, plain: { type: 'number' } }, $defs: coreRoot?.$defs }}
            data={{ plain: 1 }}
            config={{ advancedEditor: true, elementType: 'System' }}
            onDataChange={vi.fn()}
          />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>,
    );
    expect(fieldKeys(container)).toEqual(['charge_level', 'plain']);

    // Synthetic siblings of the same class: same-keyword and cross-keyword nesting, and
    // `Optional[Optional[X]]`, which the fixpoint collapses all the way rather than one
    // layer short.
    expect(
      unwrapNullableSchema({ anyOf: [{ anyOf: [{ type: 'number' }, { type: 'string' }] }, { type: 'null' }] }),
    ).toEqual({ anyOf: [{ type: 'number' }, { type: 'string' }] });
    expect(
      unwrapNullableSchema({ anyOf: [{ oneOf: [{ const: 'a' }, { const: 'b' }] }, { type: 'null' }] }),
    ).toEqual({ oneOf: [{ const: 'a' }, { const: 'b' }] });
    const doubled = unwrapNullableSchema({
      oneOf: [{ anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] }, { type: 'null' }],
    });
    expect(doubled).toEqual({ type: 'number', minimum: 0 });
    expect(unwrapNullableSchema(doubled)).toBe(doubled);
  });
});

/**
 * R4.6b-1 STANDING INVARIANT — the RENDERED ROW, not the picked control.
 *
 * WHY A SECOND SWEEP EXISTS BESIDE THE R4.6a ONE ABOVE. That sweep stops at
 * `pickDirectControl`: it proves the right CONTROL is chosen for a schema shape. Three
 * of R4.6b's defects walked straight through it, because every one of them was
 * downstream of the choice — TextControl/BooleanControl/WindowPartListControl resolved
 * their label and tooltip by reverse-engineering a property key out of the DISPLAY
 * LABEL (`getSchemaParamIdForField`), which silently mismatched or missed whenever the
 * label was not a start-case of its key; and the System walk rendered raw snake_case
 * keys for any property with no schema `title`. Neither is visible in a
 * `pickDirectControl` outcome. The row is the contract, so the row is what is pinned.
 *
 * WHAT IS RECORDED per rendered row, in DOM order, for every route: property key
 * (`data-field-key`), the control kind ACTUALLY rendered, the `min`/`max` and
 * `placeholder` attributes of its first input, the LABEL TEXT a user reads, and whether
 * a tooltip trigger is attached to that label. Tooltip CONTENT is deliberately not
 * pinned here: it renders lazily into a portal on hover, so capturing it means driving
 * ~1800 hover interactions, and the affordance's presence is what this invariant is
 * about. (Content was measured out-of-band for R4.6b-1's before/after diff.)
 *
 * `no-tip` therefore means one of two things, and the inventory does not distinguish
 * them: no parameter resolved at all, or one resolved with nothing worth saying. Since
 * R4.6b-1's fix round, `resolveFieldPresentation` drops a tooltip whose whole payload
 * would be the `Source:`/`Type:` metadata lines (see `tooltipHasSubstantiveContent`,
 * `lib/fieldPresentation.ts`), so 21 rows below read `no-tip` where they used to offer a
 * hover target that said nothing.
 *
 * WHAT IS SWEPT: the R4.6a population above MINUS its `System`-as-a-flat-element-type
 * routes — every element type in `ELEMENT_TYPE_ORDER` EXCEPT `'System'` × every subtype
 * in `SWEPT_SUBTYPES` × both profiles for the flat walk, and every
 * `SWEPT_SYSTEM_SUBTYPES` entry × both profiles for the System layout walk, with the same
 * `SYSTEM_PLANT_FIXTURES` discriminator stubs — but MOUNTED for real through
 * `AdvancedFieldsEditor` rather than resolved at the schema level. The exclusion is the
 * 30 routes (2 profiles × 15 subtypes) the R4.6a sweep reaches by treating `System` as an
 * ordinary flat element type, and it costs this sweep nothing: `AdvancedFieldsEditor`
 * mounts System through `buildSystemAdvancedUischema`, keyed on a SUBCATEGORY subtype, so
 * every one of those 30 routes hands the builder a fabric subtype it has no plants for
 * and renders zero rows. Measured, not assumed — dropping the `continue` moves
 * `routesSwept` 674 -> 704 and leaves `routesWithRows` and the inventory below untouched.
 * Every other route is shared with the sweep above.
 *
 * FIXTURE-BOUNDED, exactly as the sweep above is, and for the same reason: the System
 * half only sees the branches `SYSTEM_PLANT_FIXTURES` opens. Read every count below as
 * "what these fixtures render", never "what the schemas hold". Two specifics worth
 * knowing rather than re-deriving:
 *  - `WWHRS` has no fixture and renders ZERO rows on both profiles, so it appears
 *    nowhere in the inventory.
 *  - `HotWaterDemand` needs no fixture (it is a plain object, not a discriminated
 *    map) and DOES render: 4 rows on Core, 3 on FHS. R4.6b-1's brief expected to have
 *    to add a fixture for it; measurement said otherwise, so none was added.
 *
 * DEDUPLICATION IS MEASURED, NOT ASSUMED. Most subtypes resolve the same subschema for
 * a given element type, so routes are grouped by their rendered row-set and the group's
 * SUBTYPE LIST is part of the pinned key. A subtype that starts or stops diverging
 * therefore moves between keys and fails the comparison; it cannot hide inside a group.
 * The two counts asserted alongside close the remaining gap in both directions: a route
 * that goes empty drops out of its group, a route that gains rows joins or forms one,
 * and a route added to or removed from the sweep itself moves `routesSwept`.
 */
type RenderedRowInventory = Record<string, string[]>;

/** `key | label | control | min | max | placeholder | tooltip`, one line per row. */
function renderedRowLine(row: HTMLElement): string {
  const input = row.querySelector('input');
  return [
    row.getAttribute('data-field-key') ?? '',
    fieldLabelText(row),
    renderedControlKind(row),
    input?.getAttribute('min') ?? '-',
    input?.getAttribute('max') ?? '-',
    input?.getAttribute('placeholder') ?? '-',
    row.children[0]?.children[0]?.children[0]?.querySelector('.tooltip-container') ? 'tip' : 'no-tip',
  ].join(' | ');
}

/**
 * What the row actually rendered, read off the DOM rather than re-derived from schema.
 * `other:` covers the composite rows (WindowPartListControl, WindowTreatmentFields)
 * that have no single top-level input of their own.
 */
function renderedControlKind(row: HTMLElement): string {
  if (row.querySelector('select')) return 'select';
  if (row.querySelector('input[type="checkbox"]')) return 'checkbox';
  if (row.querySelector('input')) return 'textbox';
  return `other:${row.firstElementChild?.tagName ?? 'unknown'}`;
}

function sweepRenderedRows(): {
  inventory: RenderedRowInventory;
  routesSwept: number;
  routesWithRows: number;
} {
  /** container -> row-set signature -> the subtypes that produced it ('' for System). */
  const containers = new Map<string, Map<string, string[]>>();
  let routesSwept = 0;
  let routesWithRows = 0;

  const record = (container: string, subtype: string, container_el: HTMLElement) => {
    routesSwept += 1;
    const rows = Array.from(container_el.querySelectorAll<HTMLElement>('[data-field-key]'));
    if (rows.length === 0) return;
    routesWithRows += 1;
    const signature = rows.map(renderedRowLine).join('\n');
    const variants = containers.get(container) ?? new Map<string, string[]>();
    containers.set(container, variants);
    variants.set(signature, [...(variants.get(signature) ?? []), subtype]);
  };

  for (const mode of ['core', 'fhs'] as const) {
    const useFHSSchema = mode === 'fhs';
    for (const elementType of ADVANCED_FIELD_ELEMENT_TYPES) {
      if (elementType === 'System') continue;
      for (const subtype of SWEPT_SUBTYPES) {
        const { container } = renderEditor({ elementType, subtype, useFHSSchema, extraJson: {} });
        record(`${mode}/${elementType}`, subtype ?? '-', container);
        cleanup();
      }
    }
    for (const subtype of SWEPT_SYSTEM_SUBTYPES) {
      const { container } = renderEditor({
        elementType: 'System',
        subtype,
        useFHSSchema,
        extraJson: { [subtype]: SYSTEM_PLANT_FIXTURES[subtype] ?? {} },
      });
      record(`${mode}/System:${subtype}`, '', container);
      cleanup();
    }
  }

  const inventory: RenderedRowInventory = {};
  for (const [container, variants] of containers) {
    for (const [signature, subtypes] of variants) {
      const key = subtypes[0] === ''
        ? container
        : `${container} [${subtypes.length === SWEPT_SUBTYPES.length ? 'every subtype' : [...subtypes].sort().join(' ')}]`;
      inventory[key] = signature.split('\n');
    }
  }
  return { inventory, routesSwept, routesWithRows };
}

/**
 * Captured from a real mount, then read line by line before being pinned. The four
 * `Leaks · …` rows and every `boiler · …`/`hp · …` tail below are R4.6b-1's start-casing
 * (they were raw snake_case); the plant keys in front of them stay exactly as a user
 * would have typed them in their CSV, which is the point of that exclusion.
 */
const EXPECTED_RENDERED_ROWS: RenderedRowInventory = {
  'core/BuildingElementAdjacentConditionedSpace [every subtype]': [
    'areal_heat_capacity | Areal Heat Capacity | textbox | 0 | - | - | tip',
    'mass_distribution_class | MassDistributionClass | select | - | - | - | tip',
    'u_value | U-Value | textbox | 0 | - | - | tip',
    'thermal_resistance_construction | Thermal Resistance Construction | textbox | 0 | - | - | tip',
  ],
  'core/BuildingElementGround [- Exposed_floor Heated_basement ceiling door fancoil floor radiator roof ufh wall]': [
    'areal_heat_capacity | Areal Heat Capacity | textbox | 0 | - | - | tip',
    'mass_distribution_class | MassDistributionClass | select | - | - | - | tip',
    'u_value | U-Value | textbox | 0 | - | - | tip',
    'thermal_resistance_floor_construction | Thermal Resistance Floor Construction | textbox | 0 | - | - | tip',
    'psi_wall_floor_junc | Psi Wall Floor Junc | textbox | - | - | - | tip',
    'thermal_resist_walls_base | Thermal Resist Walls Base | textbox | 0 | - | - | tip',
  ],
  'core/BuildingElementGround [Slab_no_edge_insulation]': [
    'areal_heat_capacity | Areal Heat Capacity | textbox | 0 | - | - | tip',
    'mass_distribution_class | MassDistributionClass | select | - | - | - | tip',
    'u_value | U-Value | textbox | 0 | - | - | tip',
    'thermal_resistance_floor_construction | Thermal Resistance Floor Construction | textbox | 0 | - | - | tip',
    'psi_wall_floor_junc | Psi Wall Floor Junc | textbox | - | - | - | tip',
  ],
  'core/BuildingElementGround [Slab_edge_insulation]': [
    'edge_insulation | Edge Insulation | select | - | - | - | no-tip',
    'areal_heat_capacity | Areal Heat Capacity | textbox | 0 | - | - | tip',
    'mass_distribution_class | MassDistributionClass | select | - | - | - | tip',
    'u_value | U-Value | textbox | 0 | - | - | tip',
    'thermal_resistance_floor_construction | Thermal Resistance Floor Construction | textbox | 0 | - | - | tip',
    'psi_wall_floor_junc | Psi Wall Floor Junc | textbox | - | - | - | tip',
  ],
  'core/BuildingElementGround [Suspended_floor]': [
    'areal_heat_capacity | Areal Heat Capacity | textbox | 0 | - | - | tip',
    'mass_distribution_class | MassDistributionClass | select | - | - | - | tip',
    'u_value | U-Value | textbox | 0 | - | - | tip',
    'thermal_resistance_floor_construction | Thermal Resistance Floor Construction | textbox | 0 | - | - | tip',
    'psi_wall_floor_junc | Psi Wall Floor Junc | textbox | - | - | - | tip',
    'area_per_perimeter_vent | Area Per Perimeter Vent | textbox | 0 | - | - | tip',
    'thermal_resist_insul | Thermal Resist Insul | textbox | 0 | - | - | tip',
    'thermal_transm_walls | Thermal Transm Walls | textbox | 0 | - | - | tip',
    'height_upper_surface | Height Upper Surface | textbox | 0 | - | - | tip',
    'shield_fact_location | Shield Fact Location | select | - | - | - | tip',
  ],
  'core/BuildingElementGround [Unheated_basement]': [
    'areal_heat_capacity | Areal Heat Capacity | textbox | 0 | - | - | tip',
    'mass_distribution_class | MassDistributionClass | select | - | - | - | tip',
    'u_value | U-Value | textbox | 0 | - | - | tip',
    'thermal_resistance_floor_construction | Thermal Resistance Floor Construction | textbox | 0 | - | - | tip',
    'psi_wall_floor_junc | Psi Wall Floor Junc | textbox | - | - | - | tip',
    'height_basement_walls | Height Basement Walls | textbox | 0 | - | - | tip',
    'thermal_resist_walls_base | Thermal Resist Walls Base | textbox | 0 | - | - | tip',
    'thermal_transm_envi_base | Thermal Transm Envi Base | textbox | 0 | - | - | tip',
    'thermal_transm_walls | Thermal Transm Walls | textbox | 0 | - | - | tip',
  ],
  'core/BuildingElementOpaque [every subtype]': [
    'areal_heat_capacity | Areal Heat Capacity | textbox | 0 | - | - | tip',
    'mass_distribution_class | MassDistributionClass | select | - | - | - | tip',
    'u_value | U-Value | textbox | 0 | - | - | tip',
    'thermal_resistance_construction | Thermal Resistance Construction | textbox | 0 | - | - | tip',
    'solar_absorption_coeff | Solar Absorption Coeff | textbox | 0 | 1 | - | tip',
  ],
  'core/BuildingElementPartyWall [every subtype]': [
    'areal_heat_capacity | Areal Heat Capacity | textbox | 0 | - | - | tip',
    'mass_distribution_class | MassDistributionClass | select | - | - | - | tip',
    'u_value | U-Value | textbox | 0 | - | - | tip',
    'thermal_resistance_construction | Thermal Resistance Construction | textbox | 0 | - | - | tip',
  ],
  'core/BuildingElementTransparent [every subtype]': [
    'treatment | Blinds / curtains | other:DIV | - | - | - | no-tip',
    'u_value | U-Value | textbox | 0 | - | - | tip',
    'g_value | G-Value | textbox | 0 | 1 | - | tip',
    'window_part_list | Window Part List | other:DIV | - | - | - | no-tip',
  ],
  'core/ElectricBattery [every subtype]': [
    'battery_age | Battery Age | textbox | 0 | - | - | tip',
    'grid_charging_possible | Grid Charging Possible | checkbox | - | - | - | tip',
    'maximum_charge_rate_one_way_trip | Maximum Charge Rate One Way Trip | textbox | 0 | - | - | tip',
    'maximum_discharge_rate_one_way_trip | Maximum Discharge Rate One Way Trip | textbox | 0 | - | - | tip',
    'minimum_charge_rate_one_way_trip | Minimum Charge Rate One Way Trip | textbox | 0 | - | - | tip',
  ],
  'core/MechanicalVentilation [every subtype]': [
    'Control | Control | textbox | - | - | "example" | tip',
    'EnergySupply | Energysupply | textbox | - | - | "example" | tip',
    'SFP | SFP | textbox | 0 | - | - | tip',
    'SFP_in_use_factor | SFP In Use Factor | textbox | 1 | - | - | tip',
    'design_outdoor_air_flow_rate | Design Outdoor Air Flow Rate | textbox | 0 | - | - | tip',
    'ductwork | Ductwork | textbox | - | - | [{"cross_section_shape":"circular","duct_type":"intake","insulation_thermal_conductivity":1,"insulation_thickness_mm":0,"length":1,"reflective":false,"duct_perimeter_mm":1,"external_diameter_mm":1,"internal_diameter_mm":1}] | tip',
    'mvhr_eff | MVHR Efficiency | textbox | 0 | 1 | - | tip',
    'mvhr_location | Mvhr Location | select | - | - | - | tip',
    'sup_air_flw_ctrl | SupplyAirFlowRateControlType | select | - | - | - | tip',
    'sup_air_temp_ctrl | SupplyAirTemperatureControlType | select | - | - | - | tip',
    'position_intake | Position Intake | textbox | - | - | {"orientation360":0,"pitch":0,"mid_height_air_flow_path":1} | tip',
    'position_exhaust | Position Exhaust | textbox | - | - | {"orientation360":0,"pitch":0,"mid_height_air_flow_path":1} | tip',
    'mid_height_air_flow_path | Mid Height Air Flow Path | textbox | 0 | - | - | tip',
    'orientation360 | Orientation360 | textbox | 0 | 360 | - | tip',
    'pitch | Pitch | textbox | 0 | 180 | - | tip',
  ],
  'core/MechanicalVentilationDuctwork [every subtype]': [
    'cross_section_shape | DuctShape | select | - | - | - | tip',
    'duct_perimeter_mm | Duct Perimeter | textbox | 0 | - | - | tip',
    'external_diameter_mm | External Diameter | textbox | 0 | - | - | tip',
    'insulation_thermal_conductivity | Insulation Thermal Conductivity | textbox | 0 | - | - | tip',
    'insulation_thickness_mm | Insulation Thickness | textbox | 0 | - | - | tip',
    'internal_diameter_mm | Internal Diameter | textbox | 0 | - | - | tip',
    'reflective | Reflective | checkbox | - | - | - | tip',
  ],
  'core/System:HeatSourceWet': [
    'boiler | Boiler | textbox | - | - | - | tip',
    'hp | Hp | textbox | - | - | - | tip',
  ],
  'core/System:HotWaterDemand': [
    'Bath | Bath | textbox | - | - | {} | tip',
    'Distribution | Distribution | textbox | - | - | {} | no-tip',
    'Other | Other | textbox | - | - | {} | tip',
    'Shower | Shower | textbox | - | - | {} | tip',
  ],
  'core/System:HotWaterSource': [
    'hw cylinder | Hw Cylinder | textbox | - | - | - | no-tip',
  ],
  'core/System:InfiltrationVentilation': [
    'ach_max_static_calcs | ACH Maximum Static Calcs | textbox | 0 | - | - | tip',
    'ach_min_static_calcs | ACH Minimum Static Calcs | textbox | 0 | - | - | tip',
    'altitude | Altitude | textbox | - | - | - | tip',
    'Control_VentAdjustMax | Control Ventadjustmax | textbox | - | - | "example" | no-tip',
    'Control_VentAdjustMin | Control Ventadjustmin | textbox | - | - | "example" | no-tip',
    'Control_WindowAdjust | Control Windowadjust | textbox | - | - | "example" | no-tip',
    'cross_vent_possible | Cross Vent Possible | checkbox | - | - | - | no-tip',
    'env_area | Leaks · Env Area | textbox | 0 | - | - | tip',
    'test_pressure | Leaks · Test Pressure | textbox | 0 | - | - | tip',
    'test_result | Leaks · Test Result | textbox | 0 | - | - | tip',
    'ventilation_zone_height | Leaks · Ventilation Zone Height | textbox | 0 | - | - | tip',
    'MechanicalVentilation | Mechanicalventilation | textbox | - | - | {} | tip',
    'shield_class | VentilationShieldClass | select | - | - | - | tip',
    'terrain_class | TerrainClass | select | - | - | - | tip',
    'vent_opening_ratio_init | Vent Opening Ratio Init | textbox | 0 | 1 | - | tip',
    'ventilation_zone_base_height | Ventilation Zone Base Height | textbox | - | - | - | tip',
    'Vents | Vents | textbox | - | - | {} | tip',
  ],
  'core/System:SpaceCoolSystem': [
    'cooler | Cooler | textbox | - | - | - | no-tip',
  ],
  'core/System:SpaceHeatSystem': [
    'Zone 1 circuit | Zone 1 Circuit | textbox | - | - | - | no-tip',
  ],
  'core/WaterPipework [every subtype]': [
    'external_diameter_mm | External Diameter | textbox | 0 | - | - | tip',
    'insulation_thermal_conductivity | Insulation Thermal Conductivity | textbox | 0 | - | - | tip',
    'insulation_thickness_mm | Insulation Thickness | textbox | 0 | - | - | tip',
    'internal_diameter_mm | Internal Diameter | textbox | 0 | - | - | tip',
    'pipe_contents | PipeworkContents | select | - | - | - | tip',
    'surface_reflectivity | Surface Reflectivity | checkbox | - | - | - | tip',
  ],
  'fhs/BuildingElementAdjacentConditionedSpace [every subtype]': [
    'thermal_resistance_construction | Thermal Resistance Construction | textbox | 0.01 | 50 | - | tip',
    'u_value | U Value | textbox | 0.01 | 10 | - | tip',
    'areal_heat_capacity | Areal Heat Capacity | select | - | - | - | tip',
    'mass_distribution_class | MassDistributionClass | select | - | - | - | tip',
  ],
  'fhs/BuildingElementAdjacentUnconditionedSpace_Simple [every subtype]': [
    'thermal_resistance_construction | Thermal Resistance Construction | textbox | 0.01 | 50 | - | tip',
    'u_value | U Value | textbox | 0.01 | 10 | - | tip',
    'areal_heat_capacity | Areal Heat Capacity | select | - | - | - | tip',
    'mass_distribution_class | MassDistributionClass | select | - | - | - | tip',
    'thermal_resistance_unconditioned_space | Thermal Resistance Unconditioned Space | textbox | 0 | 3 | - | tip',
  ],
  'fhs/BuildingElementGround [- Exposed_floor Slab_no_edge_insulation ceiling door fancoil floor radiator roof ufh wall]': [
    'u_value | U Value | textbox | 0.01 | 10 | - | tip',
    'psi_wall_floor_junc | Psi Wall Floor Junc | textbox | 0 | 2 | - | tip',
    'thermal_resistance_floor_construction | Thermal Resistance Floor Construction | textbox | 0.000001 | 50 | - | tip',
    'areal_heat_capacity | Areal Heat Capacity | select | - | - | - | tip',
    'mass_distribution_class | MassDistributionClass | select | - | - | - | tip',
  ],
  'fhs/BuildingElementGround [Slab_edge_insulation]': [
    'edge_insulation | Edge Insulation | select | - | - | - | no-tip',
    'u_value | U Value | textbox | 0.01 | 10 | - | tip',
    'psi_wall_floor_junc | Psi Wall Floor Junc | textbox | 0 | 2 | - | tip',
    'thermal_resistance_floor_construction | Thermal Resistance Floor Construction | textbox | 0.000001 | 50 | - | tip',
    'areal_heat_capacity | Areal Heat Capacity | select | - | - | - | tip',
    'mass_distribution_class | MassDistributionClass | select | - | - | - | tip',
  ],
  'fhs/BuildingElementGround [Suspended_floor]': [
    'u_value | U Value | textbox | 0.01 | 10 | - | tip',
    'psi_wall_floor_junc | Psi Wall Floor Junc | textbox | 0 | 2 | - | tip',
    'thermal_resistance_floor_construction | Thermal Resistance Floor Construction | textbox | 0.000001 | 50 | - | tip',
    'areal_heat_capacity | Areal Heat Capacity | select | - | - | - | tip',
    'mass_distribution_class | MassDistributionClass | select | - | - | - | tip',
    'height_upper_surface | Height Upper Surface | textbox | 0 | 100 | - | tip',
    'thermal_transm_walls | Thermal Transm Walls | textbox | 0 | 100 | - | tip',
    'area_per_perimeter_vent | Area Per Perimeter Vent | textbox | - | - | - | tip',
    'shield_fact_location | Shield Fact Location | select | - | - | - | tip',
    'thermal_resist_insul | Thermal Resist Insul | textbox | 0 | 100 | - | tip',
  ],
  'fhs/BuildingElementGround [Heated_basement]': [
    'u_value | U Value | textbox | 0.01 | 10 | - | tip',
    'psi_wall_floor_junc | Psi Wall Floor Junc | textbox | 0 | 2 | - | tip',
    'thermal_resistance_floor_construction | Thermal Resistance Floor Construction | textbox | 0.000001 | 50 | - | tip',
    'areal_heat_capacity | Areal Heat Capacity | select | - | - | - | tip',
    'mass_distribution_class | MassDistributionClass | select | - | - | - | tip',
    'thermal_resist_walls_base | Thermal Resist Walls Base | textbox | - | - | - | tip',
  ],
  'fhs/BuildingElementGround [Unheated_basement]': [
    'u_value | U Value | textbox | 0.01 | 10 | - | tip',
    'psi_wall_floor_junc | Psi Wall Floor Junc | textbox | 0 | 2 | - | tip',
    'thermal_resistance_floor_construction | Thermal Resistance Floor Construction | textbox | 0.000001 | 50 | - | tip',
    'areal_heat_capacity | Areal Heat Capacity | select | - | - | - | tip',
    'mass_distribution_class | MassDistributionClass | select | - | - | - | tip',
    'thermal_resist_walls_base | Thermal Resist Walls Base | textbox | - | - | - | tip',
    'thermal_transm_envi_base | Thermal Transm Envi Base | textbox | - | - | - | tip',
    'thermal_transm_walls | Thermal Transm Walls | textbox | - | - | - | tip',
    'height_basement_walls | Height Basement Walls | textbox | - | - | - | tip',
  ],
  'fhs/BuildingElementOpaque [every subtype]': [
    'thermal_resistance_construction | Thermal Resistance Construction | textbox | 0.01 | 50 | - | tip',
    'u_value | U Value | textbox | 0.01 | 10 | - | tip',
    'colour | Colour | select | - | - | - | tip',
    'areal_heat_capacity | Areal Heat Capacity | select | - | - | - | tip',
    'mass_distribution_class | MassDistributionClass | select | - | - | - | tip',
  ],
  'fhs/BuildingElementPartyWall [every subtype]': [
    'thermal_resistance_construction | Thermal Resistance Construction | textbox | 0.01 | 50 | - | tip',
    'u_value | U Value | textbox | 0.01 | 10 | - | tip',
    'areal_heat_capacity | Areal Heat Capacity | select | - | - | - | tip',
    'mass_distribution_class | MassDistributionClass | select | - | - | - | tip',
  ],
  'fhs/BuildingElementTransparent [every subtype]': [
    'treatment | Blinds / curtains | other:DIV | - | - | - | no-tip',
    'u_value | U Value | textbox | 0.01 | 10 | - | tip',
    'g_value | G Value | textbox | 0 | 1 | - | tip',
    'security_risk | Security Risk? | select | - | - | - | tip',
    'window_part_list | Window Part List | other:DIV | - | - | - | no-tip',
  ],
  'fhs/ElectricBattery [every subtype]': [
    'minimum_charge_rate_one_way_trip | Minimum Charge Rate One Way Trip | textbox | 0 | - | - | tip',
    'maximum_charge_rate_one_way_trip | Maximum Charge Rate One Way Trip | textbox | 0 | - | - | tip',
    'maximum_discharge_rate_one_way_trip | Maximum Discharge Rate One Way Trip | textbox | 0 | - | - | tip',
  ],
  'fhs/MechanicalVentilation [-]': [
    'design_zone_cooling_covered_by_mech_vent | Design Zone Cooling Covered By Mech Vent | textbox | - | - | - | tip',
    'design_zone_heating_covered_by_mech_vent | Design Zone Heating Covered By Mech Vent | textbox | - | - | - | tip',
    'EnergySupply | Energy Supply | textbox | - | - | "example" | tip',
    'design_outdoor_air_flow_rate | Design Outdoor Air Flow Rate | textbox | 0 | - | - | tip',
    'SFP_in_use_factor | Sfp In Use Factor | textbox | 1 | - | - | tip',
  ],
  'fhs/MechanicalVentilation [Exposed_floor Heated_basement Slab_edge_insulation Slab_no_edge_insulation Suspended_floor Unheated_basement ceiling door fancoil floor radiator roof ufh wall]': [
    'design_zone_cooling_covered_by_mech_vent | Design Zone Cooling Covered By Mech Vent | textbox | - | - | - | tip',
    'design_zone_heating_covered_by_mech_vent | Design Zone Heating Covered By Mech Vent | textbox | - | - | - | tip',
    'EnergySupply | Energy Supply | textbox | - | - | "example" | tip',
    'design_outdoor_air_flow_rate | Design Outdoor Air Flow Rate | textbox | 0 | - | - | tip',
    'SFP_in_use_factor | Sfp In Use Factor | textbox | 1 | - | - | tip',
    'mid_height_air_flow_path | Mid Height Air Flow Path | textbox | 1 | 60 | - | tip',
    'orientation360 | Orientation 360 | textbox | 0 | 360 | - | tip',
    'pitch | Pitch | textbox | 0 | 180 | - | tip',
  ],
  'fhs/MechanicalVentilationDuctwork [every subtype]': [
    'cross_section_shape | Cross Section Shape | select | - | - | - | tip',
    'internal_diameter_mm | Internal Diameter Mm | textbox | 0 | 1000 | - | tip',
    'external_diameter_mm | External Diameter Mm | textbox | 0 | 1000 | - | tip',
    'insulation_thermal_conductivity | Insulation Thermal Conductivity | textbox | 0 | - | - | tip',
    'insulation_thickness_mm | Insulation Thickness Mm | textbox | 0 | 100 | - | tip',
    'reflective | Reflective | checkbox | - | - | - | tip',
  ],
  'fhs/OnSiteGeneration [every subtype]': [
    'ventilation_strategy | Ventilation Strategy | select | - | - | - | tip',
    'EnergySupply | Energy Supply | textbox | - | - | "example" | tip',
    'shading | Shading | textbox | - | - | [{"type":null,"distance":0}] | tip',
    'inverter_peak_power_dc | Inverter Peak Power Dc | textbox | 0 | - | - | tip',
    'inverter_peak_power_ac | Inverter Peak Power Ac | textbox | 0 | - | - | tip',
    'inverter_is_inside | Inverter Is Inside | checkbox | - | - | - | tip',
    'inverter_type | Inverter Type | select | - | - | - | tip',
  ],
  'fhs/System:HeatSourceWet': [
    'boiler_location | boiler · Boiler Location | select | - | - | - | tip',
    'efficiency_full_load | boiler · Efficiency Full Load | textbox | 0.1 | 1 | - | tip',
    'efficiency_part_load | boiler · Efficiency Part Load | textbox | 0.1 | 1.12 | - | tip',
    'electricity_circ_pump | boiler · Electricity Circ Pump | textbox | 0.001 | 1 | - | tip',
    'electricity_full_load | boiler · Electricity Full Load | textbox | 0 | 1 | - | tip',
    'electricity_part_load | boiler · Electricity Part Load | textbox | 0 | 1 | - | tip',
    'electricity_standby | boiler · Electricity Standby | textbox | 0 | 0.1 | - | tip',
    'EnergySupply | boiler · Energy Supply | textbox | - | - | "example" | tip',
    'EnergySupply_aux | boiler · Energy Supply Aux | textbox | - | - | "example" | no-tip',
    'is_heat_network | boiler · Is Heat Network | checkbox | - | - | - | tip',
    'modulation_load | boiler · Modulation Load | textbox | 0.1 | 1 | - | tip',
    'rated_power | boiler · Rated Power | textbox | 0 | - | - | tip',
    'backup_ctrl_type | hp · Backup Ctrl Type | select | - | - | - | tip',
    'EnergySupply | hp · Energy Supply | textbox | - | - | "example" | tip',
    'is_heat_network | hp · Is Heat Network | checkbox | - | - | - | tip',
    'min_modulation_rate_20 | hp · Min Modulation Rate 20 | textbox | 0 | 1 | - | tip',
    'min_modulation_rate_35 | hp · Min Modulation Rate 35 | textbox | 0 | 1 | - | tip',
    'min_modulation_rate_55 | hp · Min Modulation Rate 55 | textbox | 0 | 1 | - | tip',
    'min_temp_diff_flow_return_for_hp_to_operate | hp · Min Temp Diff Flow Return For Hp To Operate | textbox | 0 | 50 | - | tip',
    'modulating_control | hp · Modulating Control | checkbox | - | - | - | no-tip',
    'power_crankcase_heater | hp · Power Crankcase Heater | textbox | 0 | - | - | tip',
    'power_heating_circ_pump | hp · Power Heating Circ Pump | textbox | 0 | 1 | - | tip',
    'power_heating_warm_air_fan | hp · Power Heating Warm Air Fan | textbox | 0 | - | - | tip',
    'power_max_backup | hp · Power Max Backup | textbox | 0 | - | - | no-tip',
    'power_off | hp · Power Off | textbox | 0 | - | - | tip',
    'power_source_circ_pump | hp · Power Source Circ Pump | textbox | 0 | 1 | - | tip',
    'power_standby | hp · Power Standby | textbox | 0 | - | - | tip',
    'sink_type | hp · Sink Type | select | - | - | - | tip',
    'source_type | hp · Source Type | select | - | - | - | tip',
    'temp_lower_operating_limit | hp · Temp Lower Operating Limit | textbox | -30 | 0 | - | tip',
    'temp_return_feed_max | hp · Temp Return Feed Max | textbox | 4 | 80 | - | tip',
    'test_data_EN14825 | hp · Test Data EN 14825 | textbox | - | - | [{"test_letter":null,"capacity":1,"cop":1,"design_flow_temp":1,"temp_outlet":1,"temp_source":-273.15,"temp_test":-273.15,"air_flow_rate":1}] | no-tip',
    'time_constant_onoff_operation | hp · Time Constant Onoff Operation | textbox | 0 | - | - | no-tip',
    'var_flow_temp_ctrl_during_test | hp · Var Flow Temp Ctrl During Test | checkbox | - | - | - | no-tip',
  ],
  'fhs/System:HotWaterDemand': [
    'Bath | Bath | textbox | - | - | {} | no-tip',
    'Other | Other | textbox | - | - | {} | no-tip',
    'Shower | Shower | textbox | - | - | {} | no-tip',
  ],
  'fhs/System:HotWaterSource': [
    'ColdWaterSource | Cold Water Source | select | - | - | - | no-tip',
    'HeatSourceWet | Heatsourcewet | textbox | - | - | null | tip',
    'rejected_energy_1 | Rejected Energy 1 | textbox | 0 | - | - | tip',
    'rejected_factor_3 | Rejected Factor 3 | textbox | 0 | - | - | tip',
    'separate_DHW_tests | Separate DHW Tests | select | - | - | - | tip',
    'storage_loss_factor_1 | Storage Loss Factor 1 | textbox | 0 | - | - | tip',
    'storage_loss_factor_2 | Storage Loss Factor 2 | textbox | 0 | - | - | tip',
  ],
  'fhs/System:InfiltrationVentilation': [
    'ach_max_static_calcs | Ach Max Static Calcs | textbox | 0 | - | - | tip',
    'ach_min_static_calcs | Ach Min Static Calcs | textbox | 0 | - | - | tip',
    'altitude | Altitude | textbox | -150 | 7200 | - | tip',
    'env_area | Leaks · Env Area | textbox | 5 | 72000 | - | tip',
    'test_pressure | Leaks · Test Pressure | select | - | - | - | tip',
    'test_result | Leaks · Test Result | textbox | 0 | - | - | no-tip',
    'ventilation_zone_height | Leaks · Ventilation Zone Height | textbox | 1 | 120 | - | tip',
    'MechanicalVentilation | Mechanical Ventilation | textbox | - | - | {} | no-tip',
    'noise_nuisance | Noise Nuisance | checkbox | - | - | - | no-tip',
    'shield_class | Shield Class | select | - | - | - | tip',
    'terrain_class | Terrain Class | select | - | - | - | tip',
    'ventilation_zone_base_height | Ventilation Zone Base Height | textbox | -150 | 750 | - | tip',
    'Vents | Vents | textbox | - | - | {} | no-tip',
  ],
  'fhs/System:SpaceCoolSystem': [
    'advanced_start | Advanced Start | textbox | - | - | - | tip',
    'cooling_capacity | Cooling Capacity | textbox | 0 | - | - | tip',
    'efficiency | Efficiency | textbox | 0 | 25 | - | tip',
    'EnergySupply | Energy Supply | textbox | - | - | "example" | tip',
    'frac_convective | Frac Convective | textbox | 0 | 1 | - | tip',
    'temp_setback | Temp Setback | textbox | - | - | - | tip',
  ],
  'fhs/System:SpaceHeatSystem': [
    'bypass_fraction_recirculated | Bypass Fraction Recirculated | textbox | 0 | 1 | - | tip',
    'design_flow_rate | Design Flow Rate | textbox | 0 | - | - | no-tip',
    'design_flow_temp | Design Flow Temp | textbox | 20 | 120 | - | tip',
    'temp_diff_emit_dsgn | Temp Diff Emit Dsgn | textbox | 0 | 70 | - | tip',
    'variable_flow | Variable Flow | checkbox | - | - | - | no-tip',
  ],
  'fhs/WaterPipework [every subtype]': [
    'internal_diameter_mm | Internal Diameter Mm | textbox | 5 | 50 | - | tip',
    'external_diameter_mm | External Diameter Mm | textbox | 5 | 50 | - | tip',
    'insulation_thermal_conductivity | Insulation Thermal Conductivity | textbox | 0 | - | - | tip',
    'insulation_thickness_mm | Insulation Thickness Mm | textbox | 0 | - | - | tip',
    'surface_reflectivity | Surface Reflectivity | checkbox | - | - | - | tip',
    'pipe_contents | Pipe Contents | select | - | - | - | tip',
  ],
  'fhs/WetEmitter [- Exposed_floor Heated_basement Slab_edge_insulation Slab_no_edge_insulation Suspended_floor Unheated_basement ceiling door floor roof wall]': [
    'frac_convective | Frac Convective | textbox | - | - | - | tip',
  ],
  'fhs/WetEmitter [radiator]': [
    'frac_convective | Frac Convective | textbox | - | - | - | tip',
    'n | N | textbox | 0 | 2 | - | tip',
    'c | C | textbox | 0 | 2 | - | tip',
    'thermal_mass | Thermal Mass | textbox | 0 | - | - | tip',
  ],
  'fhs/WetEmitter [ufh]': [
    'frac_convective | Frac Convective | textbox | - | - | - | tip',
    'equivalent_specific_thermal_mass | Equivalent Specific Thermal Mass | textbox | 0 | - | - | tip',
    'system_performance_factor | System Performance Factor | textbox | 0 | - | - | tip',
  ],
  'fhs/WetEmitter [fancoil]': [
    'fancoil_test_data | Fancoil test data | textbox | 0.01 | - | - | no-tip',
    'frac_convective | Frac Convective | textbox | - | - | - | tip',
  ],
};

describe('R4.6b-1 standing invariant: what every Advanced Fields row actually renders', () => {
  it('pins property key, control kind, min/max, placeholder, label text and tooltip presence for every swept route', () => {
    const { inventory, routesSwept, routesWithRows } = sweepRenderedRows();

    // Floors would let this pass vacuously; these are the exact populations the pinned
    // inventory below was captured from, so they are equalities.
    expect(routesSwept).toBe(674);
    expect(routesWithRows).toBe(327);

    expect(inventory).toEqual(EXPECTED_RENDERED_ROWS);
  });
});

describe('AdvancedFieldsEditor: direct-render characterization (R4.4)', () => {
  it('config 1 -- ElectricBattery, Core and FHS (regression anchor)', () => {
    assertDirectCharacterization(
      {
        elementType: 'ElectricBattery',
        useFHSSchema: false,
        extraJson: {
          battery_age: 5,
          grid_charging_possible: true,
          maximum_charge_rate_one_way_trip: 2,
          maximum_discharge_rate_one_way_trip: 2,
          minimum_charge_rate_one_way_trip: 1,
        },
      },
      [
        row('battery_age', 'Battery Age', TEXT('0')),
        row('grid_charging_possible', 'Grid Charging Possible', CHECKBOX),
        row('maximum_charge_rate_one_way_trip', 'Maximum Charge Rate One Way Trip', TEXT('0', '0')),
        row('maximum_discharge_rate_one_way_trip', 'Maximum Discharge Rate One Way Trip', TEXT('0', '0')),
        row('minimum_charge_rate_one_way_trip', 'Minimum Charge Rate One Way Trip', TEXT('0')),
      ],
    );
    cleanup();
    assertDirectCharacterization(
      {
        elementType: 'ElectricBattery',
        useFHSSchema: true,
        extraJson: {
          maximum_charge_rate_one_way_trip: 2,
          maximum_discharge_rate_one_way_trip: 2,
          minimum_charge_rate_one_way_trip: 1,
        },
      },
      [
        row('minimum_charge_rate_one_way_trip', 'Minimum Charge Rate One Way Trip', TEXT('0')),
        row('maximum_charge_rate_one_way_trip', 'Maximum Charge Rate One Way Trip', TEXT('0', '0')),
        row('maximum_discharge_rate_one_way_trip', 'Maximum Discharge Rate One Way Trip', TEXT('0', '0')),
      ],
    );
  });

  it('config 2 -- BuildingElementOpaque, wall, Core and FHS + interaction characterization (number-entry / unset)', async () => {
    const coreExtraJson = {
      u_value: 1.2,
      areal_heat_capacity: 100000,
      mass_distribution_class: 'I',
      solar_absorption_coeff: 0.6,
      is_unheated_pitched_roof: false,
    };
    const onChange = vi.fn();
    const { container } = assertDirectCharacterization(
      {
        elementType: 'BuildingElementOpaque',
        subtype: 'wall',
        useFHSSchema: false,
        extraJson: coreExtraJson,
        onChange,
      },
      [
        row('areal_heat_capacity', 'Areal Heat Capacity', TEXT('0', '0')),
        row('mass_distribution_class', 'MassDistributionClass', SELECT),
        // R4.6a CHARACTERIZATION CHANGE (both rows): was TEXT(null) -- a bare
        // TextControl with no numeric attributes at all. Core declares both of these
        // as `anyOf:[{type:'number', exclusiveMinimum:0},{type:'null'}]`, a nullable
        // wrapper that carried no top-level type for `pickDirectControl` to dispatch
        // on, so both fell to rule (f) -> TextControl. That TEXT(null) literal is
        // itself the evidence the misroute PRE-DATES the direct renderer: it was
        // captured verbatim from the last GREEN A/B run, i.e. recorded off the
        // JsonForms mount rendering the identical constraint-free text box (see
        // `pickDirectControl`'s docstring in DirectAdvancedFields.tsx for the tester-
        // level reason). `unwrapNullableSchema` collapses the wrapper, so both now
        // route to NumberControl and surface the inner branch's `exclusiveMinimum: 0`
        // as `min="0"` + `data-exclusive-minimum="0"` -- byte-identical to how FHS,
        // which declares the same fields as plain `{type:'number'}`, has always
        // rendered them (see this test's own FHS half below, TEXT('0.01')).
        row('u_value', 'U-Value', TEXT('0', '0')),
        row('thermal_resistance_construction', 'Thermal Resistance Construction', TEXT('0', '0')),
        row('solar_absorption_coeff', 'Solar Absorption Coeff', TEXT('0')),
      ],
    );

    // R4.6a HEADLINE, asserted on the DOM rather than only through the row literal
    // above: Core `u_value` is now a real number input carrying the schema's own
    // constraint, not a bare text box. `min`/`data-exclusive-minimum` come from
    // `numericInputAttributesFromSchema`, which reads those keywords off the TOP LEVEL
    // of the node it is handed -- on the wrapper they sat one level down on the anyOf
    // branch, which is why the fix had to unwrap the resolved NODE and not merely
    // re-point dispatch (a dispatch-only fix would render this same NumberControl with
    // no min, no max, no step). `inputmode` is the other half of what the user
    // actually gets back: the numeric draft buffer and mobile keypad TextControl never
    // provided.
    const uValueInput = within(fieldRow(container, 'u_value')).getByRole('textbox');
    expect(uValueInput).toHaveAttribute('min', '0');
    expect(uValueInput).toHaveAttribute('data-exclusive-minimum', '0');
    expect(uValueInput).toHaveAttribute('inputmode', 'decimal');
    expect(fieldRow(container, 'u_value').querySelector('select')).toBeNull();

    // Interaction (brief: "one number-entry + one unset each on configs 2 and 5").
    // solar_absorption_coeff is a plain `{type:'number'}` field in Core -- a genuine
    // NumberControl (not one of the anyOf-nullable/$ref-enum fields already exercised
    // by the generic row check above). onChange payload shapes are already absolute
    // (both were, even in the A/B version), so these literals are unchanged by R4.4.
    const input = within(fieldRow(container, 'solar_absorption_coeff')).getByRole('textbox');
    fireEvent.change(input, { target: { value: '0.4' } });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        type: 'BuildingElementOpaque',
        extra_json: {
          u_value: 1.2,
          areal_heat_capacity: 100000,
          mass_distribution_class: 'I',
          solar_absorption_coeff: 0.4,
          is_unheated_pitched_roof: false,
        },
      }),
    );

    const resetButton = within(fieldRow(container, 'solar_absorption_coeff')).getByRole('button', {
      name: 'Reset to default',
    });
    fireEvent.click(resetButton);
    await waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(2));
    const unsetCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as {
      extra_json: Record<string, unknown>;
    };
    expect(unsetCall).toEqual({
      type: 'BuildingElementOpaque',
      extra_json: { u_value: 1.2, areal_heat_capacity: 100000, mass_distribution_class: 'I', is_unheated_pitched_roof: false },
    });
    expect(Object.prototype.hasOwnProperty.call(unsetCall.extra_json, 'solar_absorption_coeff')).toBe(false);
    cleanup();

    assertDirectCharacterization(
      {
        elementType: 'BuildingElementOpaque',
        subtype: 'wall',
        useFHSSchema: true,
        extraJson: {
          u_value: 1.2,
          thermal_resistance_construction: 0.8,
          pitch: 90,
          is_unheated_pitched_roof: false,
          is_external_door: false,
          colour: 'Light',
          areal_heat_capacity: 'Medium',
          mass_distribution_class: 'I',
        },
      },
      [
        row('thermal_resistance_construction', 'Thermal Resistance Construction', TEXT('0.01')),
        row('u_value', 'U Value', TEXT('0.01')),
        row('colour', 'Colour', SELECT),
        row('areal_heat_capacity', 'Areal Heat Capacity', SELECT),
        row('mass_distribution_class', 'MassDistributionClass', SELECT),
      ],
    );
  });

  it('config 3 -- BuildingElementTransparent, FHS: window_part_list + security_risk direct-render characterization', async () => {
    const baseExtraJson = {
      frame_area_fraction: 0.3,
      g_value: 0.5,
      free_area_height: 0.5,
      mid_height: 1.2,
      max_window_open_area: 0.5,
      security_risk: false,
      window_part_list: [{ mid_height_air_flow_path: 1.5 }],
    };
    const onChange = vi.fn();
    const { container } = assertDirectCharacterization(
      {
        elementType: 'BuildingElementTransparent',
        useFHSSchema: true,
        extraJson: baseExtraJson,
        onChange,
      },
      [
        row('treatment', 'Blinds / curtains', OTHER('DIV')),
        row('u_value', 'U Value', TEXT('0.01')),
        row('g_value', 'G Value', TEXT('0')),
        // R4.3b CHARACTERIZATION CHANGE: was CHECKBOX under R4.3's executed-table
        // pickDirectControl (BooleanControl won on type before enum was ever
        // consulted). R4.3b's enum-first dispatch routes this FHS boolean-with-enum
        // (`{type:'boolean', enum:[true,false]}`, inlined by AdvancedFieldsEditor's
        // subschema memo -- see the inline comment there) to EnumControl instead --
        // an expected delta, not a surprise (see the R4.3b brief's "Known effects").
        row('security_risk', 'Security Risk?', SELECT),
        row('window_part_list', 'Window Part List', TEXT(null)),
      ],
    );

    // window_part_list: an explicit, readable marker that the control which rendered
    // is WindowPartListControl (a composite row, not a select/checkbox/plain textbox).
    const windowPartRow = fieldRow(container, 'window_part_list');
    expect(windowPartRow.querySelector('select')).toBeNull();
    expect(windowPartRow.querySelector('input[type="checkbox"]')).toBeNull();

    // security_risk: R4.3b routes this to EnumControl -- a real <select>, not a
    // checkbox. EnumControl's propKey-gated Yes/No label mapping
    // (jsonformsRenderers.tsx) was dead code until this slice made this field
    // reachable through it; the underlying option VALUES stay 'true'/'false'
    // (String(v) off the schema's `enum: [true, false]`).
    const securityRow = fieldRow(container, 'security_risk');
    expect(securityRow.querySelector('input[type="checkbox"]')).toBeNull();
    const select = within(securityRow).getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option')) as HTMLOptionElement[];
    expect(options.map((o) => ({ value: o.value, label: o.textContent }))).toEqual(
      expect.arrayContaining([
        { value: 'true', label: 'Yes' },
        { value: 'false', label: 'No' },
      ]),
    );

    // Interaction: selecting "Yes" coerces the dropdown's string value back to a real
    // boolean (EnumControl's `coerceDropdownValue`, coerceType derived from the enum
    // being all-boolean) -- the onChange payload carries `security_risk: true`, not
    // the string 'true'.
    fireEvent.change(select, { target: { value: 'true' } });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        type: 'BuildingElementTransparent',
        extra_json: { ...baseExtraJson, security_risk: true },
      }),
    );
    cleanup();

    // R4.3b presentation amendment (Baz-requested, post-screenshot-review): an unset
    // enum field with a RESOLVABLE default should show that default INLINE in the
    // closed select (label-mapped), matching the look the retired TextControl-fallback
    // dropdown had -- not just the "Default: X" helper line underneath. security_risk
    // is the one enum field this test harness (`createGeometryStore({
    // defaultDefaultsPath: null })`, no defaults file loaded) can actually resolve a
    // default for: `getAdvancedDefaultValue` special-cases it
    // (`windowSecurityRiskDefaultForElement`, storey-derived) independent of the
    // defaults store, and ALWAYS returns a boolean. This fixture has no
    // coordinates/floorId, so the resolved storey is undefined ->
    // `windowSecurityRiskDefaultForStorey(undefined)` === false -- the placeholder
    // option should therefore read "No" (the Yes/No-mapped label for `false`), not the
    // raw "false".
    const { security_risk: _unsetSecurityRisk, ...extraJsonWithoutSecurityRisk } = baseExtraJson;
    void _unsetSecurityRisk;
    const { container: unsetContainer } = renderEditor({
      elementType: 'BuildingElementTransparent',
      useFHSSchema: true,
      extraJson: extraJsonWithoutSecurityRisk,
    });
    const unsetSecurityRow = fieldRow(unsetContainer, 'security_risk');
    const unsetSelect = within(unsetSecurityRow).getByRole('combobox') as HTMLSelectElement;
    expect(unsetSelect.value).toBe('');
    const placeholderOption = unsetSelect.querySelector('option[value=""]');
    expect(placeholderOption).not.toBeNull();
    expect(placeholderOption?.textContent).toBe('No');
    expect(placeholderOption).toHaveAttribute('disabled');
  });

  it('config 4 -- BuildingElementGround, Suspended_floor, FHS: shield_fact_location dropdown + area_per_perimeter_vent direct-render characterization', () => {
    const baseExtraJson = {
      u_value: 0.2,
      total_area: 80,
      floor_type: 'Suspended_floor',
      thickness_walls: 0.3,
      perimeter: 40,
      psi_wall_floor_junc: 0.1,
      thermal_resistance_floor_construction: 0.5,
      areal_heat_capacity: 'Medium',
      mass_distribution_class: 'I',
      height_upper_surface: 0.5,
      thermal_transm_walls: 0.3,
      area_per_perimeter_vent: 0.003,
      shield_fact_location: 'Average',
      thermal_resist_insul: 1,
    };
    const expectedRows = [
      row('u_value', 'U Value', TEXT('0.01')),
      row('psi_wall_floor_junc', 'Psi Wall Floor Junc', TEXT('0')),
      row('thermal_resistance_floor_construction', 'Thermal Resistance Floor Construction', TEXT('0.000001')),
      row('areal_heat_capacity', 'Areal Heat Capacity', SELECT),
      row('mass_distribution_class', 'MassDistributionClass', SELECT),
      row('height_upper_surface', 'Height Upper Surface', TEXT('0')),
      row('thermal_transm_walls', 'Thermal Transm Walls', TEXT('0')),
      row('area_per_perimeter_vent', 'Area Per Perimeter Vent', TEXT(null)),
      row('shield_fact_location', 'Shield Fact Location', SELECT),
      row('thermal_resist_insul', 'Thermal Resist Insul', TEXT('0')),
    ];
    const { container } = assertDirectCharacterization(
      {
        elementType: 'BuildingElementGround',
        subtype: 'Suspended_floor',
        useFHSSchema: true,
        extraJson: baseExtraJson,
      },
      expectedRows,
    );

    // shield_fact_location: inlined as a plain string enum with WIND_SHIELD_LOCATION_ENUM
    // by AdvancedFieldsEditor's own subschema memo -- still a dropdown (SELECT), but
    // R4.3b changed WHICH control renders it: through R4.3, the resolved
    // `{type:'string', enum:[...]}` schema reached TextControl's own `extractOptions`
    // dropdown fallback (rule (d) won on type before enum was consulted); R4.3b's
    // enum-first `pickDirectControl` now routes it to EnumControl proper instead (see
    // the reworded comment at the inline site in AdvancedFieldsEditor.tsx). Same
    // underlying `<StandardDropdown>` component either way -- the row check above
    // already confirms SELECT; this assertion is just an explicit marker.
    const shieldRow = fieldRow(container, 'shield_fact_location');
    expect(shieldRow.querySelector('select')).not.toBeNull();

    // area_per_perimeter_vent: plain `{type:'number'}` in FHS -- NumberControl,
    // confirmed by the generic row check above.
    const ventRow = fieldRow(container, 'area_per_perimeter_vent');
    expect(ventRow.querySelector('select')).toBeNull();
    expect(ventRow.querySelector('input[type="checkbox"]')).toBeNull();
    cleanup();

    // R4.3b HEADLINE RESTORATION: with an INVALID persisted string-enum value,
    // EnumControl forwards `validateAdvancedFieldPrimitive`'s error text to its
    // `<StandardDropdown error=...>` prop and it is visible ON MOUNT -- no interaction
    // needed. Through R4.3, this same field reached TextControl's fallback dropdown
    // instead, which hardcodes `error={undefined}` on its <StandardDropdown> and only
    // ever surfaces a LOCAL error after an onChange/onBlur interaction (see
    // `TextControl` in jsonformsRenderers.tsx) -- an invalid persisted value was
    // therefore invisible until the user touched the field. Row shape (labels,
    // control kinds) is identical to the valid-value fixture above; only this one
    // field's runtime value/error differs, so this mount is NOT re-run through
    // `assertDirectCharacterization`'s full-row comparison.
    const { container: invalidContainer } = renderEditor({
      elementType: 'BuildingElementGround',
      subtype: 'Suspended_floor',
      useFHSSchema: true,
      extraJson: { ...baseExtraJson, areal_heat_capacity: 'Bogus' },
    });
    const invalidRow = fieldRow(invalidContainer, 'areal_heat_capacity');
    expect(invalidRow.textContent).toContain('must be equal to one of the allowed values');
  });

  it('config 5 -- MechanicalVentilation, MVHR, FHS: measured + sfp fan modes, + interaction characterization (number-entry / unset)', async () => {
    const measuredExtraJson = {
      EnergySupply: 'mains elec',
      design_outdoor_air_flow_rate: 120,
      mvhr_eff: 0.91,
      mvhr_location: 'inside',
      measured_fan_power: 44.16,
      measured_air_flow_rate: 120,
    };
    const mvhrRows = [
      row('design_zone_cooling_covered_by_mech_vent', 'Design Zone Cooling Covered By Mech Vent', TEXT(null)),
      row('design_zone_heating_covered_by_mech_vent', 'Design Zone Heating Covered By Mech Vent', TEXT(null)),
      row('design_outdoor_air_flow_rate', 'Design Outdoor Air Flow Rate', TEXT('0', '0')),
      row('SFP_in_use_factor', 'Sfp In Use Factor', TEXT('1')),
    ];

    const onChange = vi.fn();
    const { container } = assertDirectCharacterization(
      {
        elementType: 'MechanicalVentilation',
        useFHSSchema: true,
        currentDataExtra: { vent_type: 'MVHR' },
        extraJson: { vent_type: 'MVHR', ...measuredExtraJson },
        onChange,
      },
      mvhrRows,
    );

    // Interaction: design_outdoor_air_flow_rate is present regardless of fan mode (a
    // plain exclusiveMinimum-0 NumberControl) -- number-entry + unset there.
    const input = within(fieldRow(container, 'design_outdoor_air_flow_rate')).getByRole('textbox');
    fireEvent.change(input, { target: { value: '150' } });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        type: 'MechanicalVentilation',
        vent_type: 'MVHR',
        extra_json: {
          vent_type: 'MVHR',
          EnergySupply: 'mains elec',
          design_outdoor_air_flow_rate: 150,
          mvhr_eff: 0.91,
          mvhr_location: 'inside',
          measured_fan_power: 44.16,
          measured_air_flow_rate: 120,
        },
      }),
    );

    const resetButton = within(fieldRow(container, 'design_outdoor_air_flow_rate')).getByRole('button', {
      name: 'Reset to default',
    });
    fireEvent.click(resetButton);
    await waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0]).toEqual({
      type: 'MechanicalVentilation',
      vent_type: 'MVHR',
      extra_json: {
        vent_type: 'MVHR',
        EnergySupply: 'mains elec',
        mvhr_eff: 0.91,
        mvhr_location: 'inside',
        measured_fan_power: 44.16,
        measured_air_flow_rate: 120,
      },
    });
    cleanup();

    const sfpExtraJson = {
      EnergySupply: 'mains elec',
      design_outdoor_air_flow_rate: 120,
      mvhr_eff: 0.91,
      mvhr_location: 'inside',
      SFP: 0.8,
      SFP_in_use_factor: 1.2,
    };
    assertDirectCharacterization(
      {
        elementType: 'MechanicalVentilation',
        useFHSSchema: true,
        currentDataExtra: { vent_type: 'MVHR' },
        extraJson: { vent_type: 'MVHR', ...sfpExtraJson },
      },
      mvhrRows,
    );
  });

  it('MechanicalVentilation, non-MVHR: position_exhaust nested-object blob (Stage 2.4 characterization, adjacent to config 5)', () => {
    // Stage 2.4 CHARACTERIZATION (see DirectAdvancedFields.tsx module docstring): a
    // nested object-typed property gets ONE flat Control bound to the whole object
    // (the generator does not recurse past the schema root), which falls through
    // every typed tester to GenericControl's TextControl default -> JSON.stringify
    // blob. DirectAdvancedFields needs NO special-case code for this -- pickDirectControl
    // already defaults to 'text' for an object-typed resolved schema. config 5's matrix
    // entry is MVHR specifically (per the brief), which EXCLUDES position-object mode
    // entirely (`shouldRenderMechanicalVentilationPositionMode` is false whenever
    // vent_type === 'MVHR') -- 'Intermittent MEV' is required to reach it.
    const { container } = assertDirectCharacterization(
      {
        elementType: 'MechanicalVentilation',
        useFHSSchema: true,
        currentDataExtra: { vent_type: 'Intermittent MEV' },
        extraJson: {
          vent_type: 'Intermittent MEV',
          EnergySupply: 'mains elec',
          design_outdoor_air_flow_rate: 30,
          position_exhaust: { mid_height_air_flow_path: 2.4, orientation360: 270, pitch: 90 },
        },
      },
      [
        row('design_zone_cooling_covered_by_mech_vent', 'Design Zone Cooling Covered By Mech Vent', TEXT(null)),
        row('design_zone_heating_covered_by_mech_vent', 'Design Zone Heating Covered By Mech Vent', TEXT(null)),
        row('EnergySupply', 'Energy Supply', TEXT(null)),
        row('design_outdoor_air_flow_rate', 'Design Outdoor Air Flow Rate', TEXT('0', '0')),
        row('SFP_in_use_factor', 'Sfp In Use Factor', TEXT('1')),
        row('position_exhaust', 'Position Exhaust', TEXT(null)),
      ],
    );
    const positionRow = fieldRow(container, 'position_exhaust');
    const input = within(positionRow).getByRole('textbox');
    expect((input as HTMLInputElement).value).toBe(
      JSON.stringify({ mid_height_air_flow_path: 2.4, orientation360: 270, pitch: 90 }),
    );
  });

  it('R4.5 review round 1 fix / R4.6a: MechanicalVentilation, Core: every nullable-wrapped property routes to a real control (mvhr_location EnumControl, the four numeric fields NumberControl with their schema minima)', () => {
    // REGRESSION, caught in adversarial review round 1: HEM's
    // `$defs/MechanicalVentilation.properties.mvhr_location` is
    // `{anyOf:[{$ref:'#/$defs/MVHRLocation'},{type:'null'}]}` on the CORE profile --
    // the exact anyOf-wraps-a-$ref-to-an-enum shape `pickDirectControl`'s own
    // docstring already documents as reachable neither by `isNonEmptyEnumLike` nor by
    // type dispatch (no top-level `.type`/`.enum` on the anyOf wrapper itself). R4.5's
    // commit-3 deleted the `extractOptions` "Case 2" fallback that used to paper over
    // this on TextControl, and the shape's live-instance audit at the time only
    // checked FHS (where `mvhr_location` happens to already be a bare
    // `{enum:['inside','outside']}` with no anyOf wrapper) -- Core was never actually
    // exercised for this field, so the regression shipped. R4.5 fixed it by inlining a
    // flat `{type:'string', enum:[...]}` override in AdvancedFieldsEditor.tsx's
    // subschema memo, one field at a time.
    //
    // R4.6a REPLACED that override with `unwrapNullableSchema` (DirectAdvancedFields.tsx),
    // which collapses the wrapper generically at every resolution site -- and this
    // fixture is where the one-field-at-a-time approach is shown to have been the
    // wrong shape of fix. mvhr_location's row below is UNCHANGED across that swap
    // (same SELECT, same "MVHRLocation" label, same options -- the deletion is a
    // no-op for it, which is exactly why the override was safe to remove), while FOUR
    // sibling rows in the same grid, all carrying the same nullable wrapper around a
    // NUMBER, were quietly broken the whole time and are corrected below. Those four
    // are annotated individually.
    //
    // No subtype passed, matching config 5's own mounting pattern immediately above
    // (and MechanicalVentilation's base-field exclusion, `['vent_type']`, is the same
    // on both profiles) -- Core does none of FHS's fan/position-mode property pruning,
    // so every property in the undiscriminated union schema renders. Row set/labels
    // captured verbatim from a real render (this is a NEW characterization, not a
    // parity check against a deleted comparator).
    const { container } = assertDirectCharacterization(
      {
        elementType: 'MechanicalVentilation',
        useFHSSchema: false,
        currentDataExtra: { vent_type: 'MVHR' },
        extraJson: { vent_type: 'MVHR', mvhr_location: 'inside' },
      },
      [
        row('Control', 'Control', TEXT(null)),
        row('SFP', 'SFP', TEXT('0', '0')),
        row('SFP_in_use_factor', 'SFP In Use Factor', TEXT('1')),
        row('design_outdoor_air_flow_rate', 'Design Outdoor Air Flow Rate', TEXT('0', '0')),
        // `ductwork` is a nullable wrapper too -- around an ARRAY. It stays TEXT(null):
        // unwrapping changes the resolved node but not the destination control (rule
        // (f) -> TextControl's JSON blob either way), which is the point of asserting
        // it here rather than only asserting the rows that moved.
        row('ductwork', 'Ductwork', TEXT(null)),
        // R4.6a CHARACTERIZATION CHANGE: was TEXT(null).
        // `anyOf:[{type:'number', minimum:0, maximum:1},{type:'null'}]` -> NumberControl,
        // surfacing min="0" (max="1" is set too; `inputSignatureForRow` only samples
        // min/data-exclusive-minimum).
        row('mvhr_eff', 'MVHR Efficiency', TEXT('0')),
        // R4.6a CHARACTERIZATION CHANGE, LABEL ONLY: was 'MVHRLocation'. The control
        // is unchanged (SELECT, same options -- see the assertions below). That label
        // was an artifact of the deleted R4.5 inline override, which hoisted the
        // pydantic ENUM CLASS NAME out of `$defs/MVHRLocation.title` and used it as
        // the field label. `unwrapNullableSchema` deliberately does not carry inner
        // annotations (see its docstring), so this titleless property now start-cases
        // its own key like every other titleless row in this grid -- the same rule
        // that gives 'Position Intake' / 'Mid Height Air Flow Path' their labels
        // instead of 'MechanicalVentilationPosition' / nothing. Losing 'MVHRLocation'
        // is the point, not a casualty.
        row('mvhr_location', 'Mvhr Location', SELECT),
        row('sup_air_flw_ctrl', 'SupplyAirFlowRateControlType', SELECT),
        row('sup_air_temp_ctrl', 'SupplyAirTemperatureControlType', SELECT),
        // Nullable wrappers around OBJECTS (`$defs/MechanicalVentilationPosition`).
        // Like `ductwork` above, unwrapping does not move them: an object-typed node
        // still falls to TextControl's JSON blob.
        row('position_intake', 'Position Intake', TEXT(null)),
        row('position_exhaust', 'Position Exhaust', TEXT(null)),
        // R4.6a CHARACTERIZATION CHANGE: was TEXT(null).
        // `anyOf:[{type:'number', exclusiveMinimum:0},{type:'null'}]` -> NumberControl.
        row('mid_height_air_flow_path', 'Mid Height Air Flow Path', TEXT('0', '0')),
        // R4.6a CHARACTERIZATION CHANGE (both rows): was TEXT(null).
        // `anyOf:[{type:'number', minimum:0, maximum:360|180},{type:'null'}]` ->
        // NumberControl. These two are the compass/tilt fields the main element form
        // renders as proper bounded numbers elsewhere in the editor; only the Core
        // MechanicalVentilation Advanced Fields copies were free-text.
        row('orientation360', 'Orientation360', TEXT('0')),
        row('pitch', 'Pitch', TEXT('0')),
      ],
    );

    // The headline assertion: a real <select> with the schema's own enum values, not
    // a JSON.stringify'd free-text blob. R4.6a: this now holds with NO field-specific
    // code anywhere -- `unwrapNullableSchema` is generic, and AdvancedFieldsEditor's
    // `mvhr_location` inline override is deleted.
    const mvhrRow = fieldRow(container, 'mvhr_location');
    const select = within(mvhrRow).getByRole('combobox') as HTMLSelectElement;
    const optionValues = Array.from(select.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
    expect(optionValues).toEqual(expect.arrayContaining(['inside', 'outside']));

    fireEvent.change(select, { target: { value: 'outside' } });
    expect(select.value).toBe('outside');

    // R4.6a: `mvhr_eff` is the numeric half of the same fix -- assert the constraint
    // that `inputSignatureForRow` does not sample (`max`), so the row literal above is
    // not the only thing standing between a regression and a green suite. A
    // TextControl-rendered row carries none of these attributes at all.
    const mvhrEffInput = within(fieldRow(container, 'mvhr_eff')).getByRole('textbox');
    expect(mvhrEffInput).toHaveAttribute('min', '0');
    expect(mvhrEffInput).toHaveAttribute('max', '1');
    expect(mvhrEffInput).toHaveAttribute('inputmode', 'decimal');
  });

  it('R4.6a: the boolean arm of the nullable unwrap renders a real CHECKBOX (BuildingElementOpaque.is_unheated_pitched_roof, Core)', () => {
    // The one BOOLEAN nullable wrapper in either published schema. It is asserted
    // through a direct `DirectAdvancedFields` mount rather than through
    // `AdvancedFieldsEditor`, because it is a BASE field for BuildingElementOpaque
    // (`getBaseFieldsForElementType`, lib/schemaCache.ts) and so is filtered out of
    // `advancedProperties` before the grid ever sees it -- config 2 above deliberately
    // shows no row for it. That makes the boolean arm unreachable through the element
    // editor today; it is exercised here anyway, on the REAL schema node pulled from
    // the port (not a hand-copied literal, which would only prove the test author's
    // idea of the shape), the same way the Stage 2.5 gate tests mount
    // `DirectAdvancedFields` directly for shapes no element type routes to.
    const coreOpaque = canonicalGeometrySchemaPort.getElementSubschema('core', 'BuildingElementOpaque') as
      | { properties?: Record<string, unknown> }
      | null;
    const wrapped = coreOpaque?.properties?.is_unheated_pitched_roof as Record<string, unknown>;
    // Guard the fixture itself: if HEM ever flattens this field, the assertion below
    // would pass for the wrong reason.
    expect(wrapped).toMatchObject({ anyOf: [{ type: 'boolean' }, { type: 'null' }] });

    const store = createGeometryStore({ defaultDefaultsPath: null });
    const { container } = render(
      <GeometryEditorServicePortsProvider
        schemaPort={canonicalGeometrySchemaPort}
        workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
      >
        <GeometryStoreProvider store={store}>
          <DirectAdvancedFields
            schema={{ type: 'object', properties: { is_unheated_pitched_roof: wrapped } }}
            data={{ is_unheated_pitched_roof: true }}
            config={{ advancedEditor: true, elementType: 'BuildingElementOpaque' }}
            onDataChange={vi.fn()}
          />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>,
    );

    const roofRow = fieldRow(container, 'is_unheated_pitched_roof');
    expect(inputSignatureForRow(roofRow)).toEqual(CHECKBOX);
    expect((within(roofRow).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    // The label still comes from the WRAPPER's own title, not from anything the inner
    // branch contributes -- see `unwrapNullableSchema`'s annotation rule.
    expect(fieldLabelText(roofRow)).toBe('Is Unheated Pitched Roof');
  });

  it('config 6 -- WetEmitter, radiator, FHS: per_metre and lumped thermal-mode pruning direct-render characterization', () => {
    assertDirectCharacterization(
      {
        elementType: 'WetEmitter',
        subtype: 'radiator',
        useFHSSchema: true,
        extraJson: { frac_convective: 0.4, n: 1.2, c_per_m: 0.0112, length: 1.44, thermal_mass_per_m: 0.019 },
      },
      [
        row('frac_convective', 'Frac Convective', TEXT(null)),
        row('length', 'Length', TEXT('0', '0')),
        row('n', 'N', TEXT('0', '0')),
        row('c_per_m', 'C Per M', TEXT('0', '0')),
        row('thermal_mass_per_m', 'Thermal Mass Per M', TEXT('0', '0')),
      ],
    );
    cleanup();

    assertDirectCharacterization(
      {
        elementType: 'WetEmitter',
        subtype: 'radiator',
        useFHSSchema: true,
        extraJson: { frac_convective: 0.4, n: 1.2, c: 0.08, thermal_mass: 5 },
      },
      [
        row('frac_convective', 'Frac Convective', TEXT(null)),
        row('n', 'N', TEXT('0', '0')),
        row('c', 'C', TEXT('0', '0')),
        row('thermal_mass', 'Thermal Mass', TEXT('0', '0')),
      ],
    );
  });

  it('config 7 -- Lighting (simple flat) -- CHARACTERIZATION: no Advanced Fields UI exists in either schema mode', () => {
    // CHARACTERIZATION FINDING, not the brief's original expectation: Lighting has NO
    // Advanced Fields UI at all, in EITHER mode. Core has no dedicated Lighting
    // subschema (`getElementSubschema('core','Lighting')` returns null, verified
    // directly). FHS DOES have a Lighting subschema (`bulbs`, a required array), but
    // `bulbs` is itself listed in `getBaseFieldsForElementType('Lighting')` for BOTH
    // modes (verified directly) -- so it is filtered OUT of advancedProperties before
    // the direct-render path ever sees it, leaving zero properties.
    // AdvancedFieldsEditor's own `if (!hasAdvancedFields) return null` then makes the
    // WHOLE component (container included) render nothing, in both modes. config 8
    // below carries the real positive flat-field coverage this config was meant to
    // provide.
    for (const useFHSSchema of [false, true]) {
      const { keys } = (() => {
        const { container } = renderEditor({
          elementType: 'Lighting',
          useFHSSchema,
          extraJson: useFHSSchema ? { bulbs: [{ count: 4, power: 8, efficacy: 90 }] } : {},
        });
        return { keys: fieldKeys(container) };
      })();
      expect(keys).toEqual([]);
      cleanup();
    }
  });

  it('config 8 -- OnSiteGeneration, Core (base-field filtering, zero fields) and FHS (real flat fields)', () => {
    // Core: subschema.properties is EMPTY after base-field filtering (every property
    // is a base field -- verified directly). Zero rows; confirms the degenerate case
    // holds (no stray control, no crash).
    assertDirectCharacterization(
      { elementType: 'OnSiteGeneration', useFHSSchema: false, extraJson: {} },
      [],
    );
    cleanup();

    // FHS: real advanced fields survive filtering (ventilation_strategy enum,
    // EnergySupply string, shading $ref-object blob, inverter_* fields) -- the
    // "simple flat, positive fields" case config 7 (Lighting) turned out not to have.
    assertDirectCharacterization(
      {
        elementType: 'OnSiteGeneration',
        useFHSSchema: true,
        extraJson: {
          ventilation_strategy: 'unventilated',
          EnergySupply: 'mains elec',
          inverter_peak_power_dc: 4,
          inverter_peak_power_ac: 3.6,
          inverter_is_inside: true,
          inverter_type: 'string_inverter',
        },
      },
      [
        row('ventilation_strategy', 'Ventilation Strategy', SELECT),
        row('EnergySupply', 'Energy Supply', TEXT(null)),
        row('shading', 'Shading', TEXT(null)),
        row('inverter_peak_power_dc', 'Inverter Peak Power Dc', TEXT('0', '0')),
        row('inverter_peak_power_ac', 'Inverter Peak Power Ac', TEXT('0', '0')),
        row('inverter_is_inside', 'Inverter Is Inside', CHECKBOX),
        row('inverter_type', 'Inverter Type', SELECT),
      ],
    );
  });

  it('config 9 -- ThermalBridgeLinear (junction_type stays manual/absent from the Advanced Fields grid)', () => {
    // CHARACTERIZATION: length/linear_thermal_transmittance are BASE fields (rendered
    // by the main element form, not Advanced Fields) in both Core and FHS, and
    // junction_type is deliberately deleted from advancedProperties (rendered
    // manually elsewhere, richer labels + psi autofill -- see
    // `shouldRenderJunctionTypeManually` in AdvancedFieldsEditor.tsx) in FHS. FHS's
    // Advanced Fields property set for ThermalBridgeLinear is therefore EMPTY --
    // confirming junction_type never leaks into the generic grid, and the flat walk
    // handles an all-filtered-out schema without crashing.
    const { container } = renderEditor({
      elementType: 'ThermalBridgeLinear',
      useFHSSchema: true,
      currentDataExtra: { length: 2.5, linear_thermal_transmittance: 0.09 },
      extraJson: { junction_type: 'E16' },
    });
    const keys = fieldKeys(container);
    expect(keys).toEqual([]);
    expect(keys).not.toContain('junction_type');
  });

  it('config 10 -- System, SpaceHeatSystem, FHS: layout-spec mode, single plant + two-plant label prefixing + nested-path edit round-trip', async () => {
    // Real single-plant fixture (packages/geometry-editor/src/geometry/__fixtures__/
    // example_semi_detached.csv, also data/defaults/defaults_template.json under
    // "zone 1 radiators"), trimmed to the fields exercised here.
    const singlePlant = {
      'Zone 1 circuit': {
        type: 'WetDistribution',
        Zone: 'Zone 1',
        temp_diff_emit_dsgn: 10,
        variable_flow: true,
        min_flow_rate: 3,
        max_flow_rate: 18,
        HeatSource: { name: 'hp', temp_flow_limit_upper: 65 },
        ecodesign_controller: {
          ecodesign_control_class: 2,
          min_outdoor_temp: -4,
          max_outdoor_temp: 20,
          min_flow_temp: 30,
        },
        design_flow_temp: 55,
      },
    };
    const singlePlantRows = [
      row('bypass_fraction_recirculated', 'Bypass Fraction Recirculated', TEXT('0')),
      row('design_flow_temp', 'Design Flow Temp', TEXT('20')),
      row('ecodesign_control_class', 'Ecodesign Controller · Ecodesign Control Class', SELECT),
      row('max_outdoor_temp', 'Ecodesign Controller · Max Outdoor Temp', TEXT('10')),
      row('min_flow_temp', 'Ecodesign Controller · Min Flow Temp', TEXT('20')),
      row('min_outdoor_temp', 'Ecodesign Controller · Min Outdoor Temp', TEXT('-60')),
      row('temp_flow_limit_upper', 'Temp Flow Limit Upper', TEXT('0', '0')),
      row('max_flow_rate', 'Max Flow Rate', TEXT('0', '0')),
      row('min_flow_rate', 'Min Flow Rate', TEXT('0', '0')),
      row('temp_diff_emit_dsgn', 'Temp Diff Emit Dsgn', TEXT('0', '0')),
      row('variable_flow', 'Variable Flow', CHECKBOX),
    ];

    const onChange = vi.fn();
    const { container } = assertDirectCharacterization(
      {
        elementType: 'System',
        subtype: 'SpaceHeatSystem',
        useFHSSchema: true,
        extraJson: { SpaceHeatSystem: singlePlant },
        onChange,
      },
      singlePlantRows,
    );

    // Nested-path edit round-trip: type into HeatSource.temp_flow_limit_upper (hoisted
    // -- scope #/properties/SpaceHeatSystem/properties/Zone 1 circuit/properties/
    // HeatSource/properties/temp_flow_limit_upper -> dot path "SpaceHeatSystem.Zone 1
    // circuit.HeatSource.temp_flow_limit_upper") and check the full onChange payload --
    // this is what actually exercises DirectAdvancedFields' Stage-2.1 nested
    // set/delete, not just its rendering.
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-field-key="temp_flow_limit_upper"]'));
    expect(rows.length).toBe(1);
    const input = within(rows[0]).getByRole('textbox');
    fireEvent.change(input, { target: { value: '70' } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0]).toEqual({
      type: 'System',
      extra_json: {
        SpaceHeatSystem: {
          'Zone 1 circuit': {
            type: 'WetDistribution',
            Zone: 'Zone 1',
            temp_diff_emit_dsgn: 10,
            variable_flow: true,
            min_flow_rate: 3,
            max_flow_rate: 18,
            HeatSource: { name: 'hp', temp_flow_limit_upper: 70 },
            ecodesign_controller: { ecodesign_control_class: 2, min_outdoor_temp: -4, max_outdoor_temp: 20, min_flow_temp: 30 },
            design_flow_temp: 55,
          },
        },
      },
    });
    cleanup();

    // Adversarial-review REAL finding (R4.3), still holds under R4.3b: with
    // ecodesign_control_class UNSET (the state every newly-added wet system starts
    // in), the picker renders EnumControl (integer+oneOf-const). Through R4.3 this
    // was GenericControl's rank-5 dispatch on the retired JsonForms mount, whose own
    // internal check was enum-BEFORE-type; R4.3b promoted that same enum-first rule
    // to be `pickDirectControl`'s OWN top-level rule (see its docstring in
    // DirectAdvancedFields.tsx), so this row is unaffected by the R4.3b reorder --
    // it already routed here either way. It includes the forwarded "is a required
    // property" error text (see `replicateRequiredError` in DirectAdvancedFields.tsx
    // -- this replication is permanent layout-spec-path behaviour, not a parity
    // shim). Row shape is identical to the set-value fixture above; only the runtime
    // value/error differs.
    const unsetClassPlant = {
      'Zone 1 circuit': {
        ...singlePlant['Zone 1 circuit'],
        ecodesign_controller: { min_outdoor_temp: -4, max_outdoor_temp: 20, min_flow_temp: 30 },
      },
    };
    const { container: unsetClassContainer } = assertDirectCharacterization(
      {
        elementType: 'System',
        subtype: 'SpaceHeatSystem',
        useFHSSchema: true,
        extraJson: { SpaceHeatSystem: unsetClassPlant },
      },
      singlePlantRows,
    );
    const unsetClassRow = unsetClassContainer.querySelector('[data-field-key="ecodesign_control_class"]');
    expect(unsetClassRow?.textContent).toContain('is a required property');
    cleanup();

    // Two plants (second plant synthesized -- no real two-plant SpaceHeatSystem
    // fixture exists in the repo, per the WarmAir shape used in
    // lib/__tests__/spaceHeatSystemSync.test.ts): buildSystemAdvancedUischema's
    // `multiPlant` flag flips on with 2+ plant keys, and EVERY control in EVERY plant
    // gets a `plantKey · label` prefix (leafControlLabel). R4.6b-1 start-cased the
    // SCHEMA-derived halves of that label — the nested-object prefix parts and the leaf
    // tail — while leaving the plant key exactly as the user typed it, which is why
    // "Living warm air" and "Zone 1 circuit" below are untouched but every tail after
    // them is now title case. Row order (Living warm air's fields before Zone 1 circuit's,
    // captured verbatim from the last A/B GREEN run) is whatever
    // buildSystemAdvancedUischema produces -- not naive data-insertion order.
    const twoPlants = {
      ...singlePlant,
      'Living warm air': { type: 'WarmAir', HeatSource: { name: 'a2a_hp' } },
    };
    assertDirectCharacterization(
      {
        elementType: 'System',
        subtype: 'SpaceHeatSystem',
        useFHSSchema: true,
        extraJson: { SpaceHeatSystem: twoPlants },
      },
      [
        row('frac_convective', 'Living warm air · Frac Convective', TEXT('0.1')),
        row('temp_flow_limit_upper', 'Living warm air · Temp Flow Limit Upper', TEXT('0', '0')),
        row('temp_diff_emit_dsgn', 'Living warm air · Temp Diff Emit Dsgn', TEXT(null)),
        row('bypass_fraction_recirculated', 'Zone 1 circuit · Bypass Fraction Recirculated', TEXT('0')),
        row('design_flow_temp', 'Zone 1 circuit · Design Flow Temp', TEXT('20')),
        row('ecodesign_control_class', 'Zone 1 circuit · Ecodesign Controller · Ecodesign Control Class', SELECT),
        row('max_outdoor_temp', 'Zone 1 circuit · Ecodesign Controller · Max Outdoor Temp', TEXT('10')),
        row('min_flow_temp', 'Zone 1 circuit · Ecodesign Controller · Min Flow Temp', TEXT('20')),
        row('min_outdoor_temp', 'Zone 1 circuit · Ecodesign Controller · Min Outdoor Temp', TEXT('-60')),
        row('temp_flow_limit_upper', 'Zone 1 circuit · Temp Flow Limit Upper', TEXT('0', '0')),
        row('max_flow_rate', 'Zone 1 circuit · Max Flow Rate', TEXT('0', '0')),
        row('min_flow_rate', 'Zone 1 circuit · Min Flow Rate', TEXT('0', '0')),
        row('temp_diff_emit_dsgn', 'Zone 1 circuit · Temp Diff Emit Dsgn', TEXT('0', '0')),
        row('variable_flow', 'Zone 1 circuit · Variable Flow', CHECKBOX),
      ],
    );
  });

  it('R4.3b: System plant keys containing "/" and "." round-trip through RFC-6901-escaped scopes (adjacent to configs 10/11)', async () => {
    // R4.3b FIX (see systemAdvancedUischema.ts + DirectAdvancedFields.tsx): plant
    // keys are raw user CSV names. A raw '/' in a plant key used to break
    // `resolveSchemaPointer` (it splits the ref on '/'); a raw '.' used to break this
    // component's own dot-path round-trip (`pathFromLayoutScope`/`leafKeyFromPath`,
    // now replaced by `segmentsFromLayoutScope`). Two synthesized plants below exercise
    // both: 'Kitchen/Diner rads' (a WetDistribution plant, same shape as config 10's
    // single-plant fixture) and 'Zone 1.5 circuit' (a WarmAir plant, same shape as
    // config 10's two-plant case) -- no real two-'/'-or-'.'-containing-key
    // SpaceHeatSystem fixture exists in the repo, synthesized the same way config 10's
    // second plant already is.
    const twoEscapedPlants = {
      'Kitchen/Diner rads': {
        type: 'WetDistribution',
        Zone: 'Zone 1',
        temp_diff_emit_dsgn: 10,
        variable_flow: true,
        min_flow_rate: 3,
        max_flow_rate: 18,
        HeatSource: { name: 'hp', temp_flow_limit_upper: 65 },
        ecodesign_controller: {
          ecodesign_control_class: 2,
          min_outdoor_temp: -4,
          max_outdoor_temp: 20,
          min_flow_temp: 30,
        },
        design_flow_temp: 55,
      },
      'Zone 1.5 circuit': { type: 'WarmAir', HeatSource: { name: 'a2a_hp' } },
    };

    const onChange = vi.fn();
    // Plant-key sort is alphabetical (`sortPropertyKeys` in systemAdvancedUischema.ts):
    // 'Kitchen/Diner rads' (K) sorts before 'Zone 1.5 circuit' (Z), same ordering rule
    // config 10's two-plant case already exercises ('Living warm air' before 'Zone 1
    // circuit').
    const { container } = assertDirectCharacterization(
      {
        elementType: 'System',
        subtype: 'SpaceHeatSystem',
        useFHSSchema: true,
        extraJson: { SpaceHeatSystem: twoEscapedPlants },
        onChange,
      },
      [
        row('bypass_fraction_recirculated', 'Kitchen/Diner rads · Bypass Fraction Recirculated', TEXT('0')),
        row('design_flow_temp', 'Kitchen/Diner rads · Design Flow Temp', TEXT('20')),
        row('ecodesign_control_class', 'Kitchen/Diner rads · Ecodesign Controller · Ecodesign Control Class', SELECT),
        row('max_outdoor_temp', 'Kitchen/Diner rads · Ecodesign Controller · Max Outdoor Temp', TEXT('10')),
        row('min_flow_temp', 'Kitchen/Diner rads · Ecodesign Controller · Min Flow Temp', TEXT('20')),
        row('min_outdoor_temp', 'Kitchen/Diner rads · Ecodesign Controller · Min Outdoor Temp', TEXT('-60')),
        row('temp_flow_limit_upper', 'Kitchen/Diner rads · Temp Flow Limit Upper', TEXT('0', '0')),
        row('max_flow_rate', 'Kitchen/Diner rads · Max Flow Rate', TEXT('0', '0')),
        row('min_flow_rate', 'Kitchen/Diner rads · Min Flow Rate', TEXT('0', '0')),
        row('temp_diff_emit_dsgn', 'Kitchen/Diner rads · Temp Diff Emit Dsgn', TEXT('0', '0')),
        row('variable_flow', 'Kitchen/Diner rads · Variable Flow', CHECKBOX),
        row('frac_convective', 'Zone 1.5 circuit · Frac Convective', TEXT('0.1')),
        row('temp_flow_limit_upper', 'Zone 1.5 circuit · Temp Flow Limit Upper', TEXT('0', '0')),
        row('temp_diff_emit_dsgn', 'Zone 1.5 circuit · Temp Diff Emit Dsgn', TEXT(null)),
      ],
    );

    // "Real field rows render, not junk 'properties' rows": the full ordered-key
    // comparison above already proves this (a broken pointer resolution would produce
    // wrong keys/labels or throw), but assert the negative directly too, and that no
    // control fell back to an opaque JSON blob anywhere in the grid.
    expect(fieldKeys(container)).not.toContain('properties');
    expect(container.textContent).not.toContain('[object Object]');

    // Labels carry the RAW plant-key prefix -- unescaped (escaping applies to scopes
    // only, per systemAdvancedUischema.ts's docstring) AND un-start-cased (R4.6b-1's
    // exclusion: a plant key is the user's own CSV name, not schema text). A user
    // reading this grid should see their own plant names back verbatim, so '/' survives
    // as '/' and the casing/spacing survives as typed, while the schema-derived tail
    // beside it is title-cased.
    expect(fieldLabelText(fieldRowByLabel(container, 'variable_flow', 'Kitchen/Diner rads'))).toBe(
      'Kitchen/Diner rads · Variable Flow',
    );
    expect(fieldLabelText(fieldRowByLabel(container, 'frac_convective', 'Zone 1.5 circuit'))).toBe(
      'Zone 1.5 circuit · Frac Convective',
    );

    // Edit round-trip #1: a NESTED field (HeatSource.temp_flow_limit_upper, hoisted)
    // under the '/'-containing plant key -- exercises the escaped scope AND the
    // multi-hop segment walk together.
    const kitchenNestedInput = within(
      fieldRowByLabel(container, 'temp_flow_limit_upper', 'Kitchen/Diner rads'),
    ).getByRole('textbox');
    fireEvent.change(kitchenNestedInput, { target: { value: '70' } });
    await waitFor(() =>
      expect((onChange.mock.calls[onChange.mock.calls.length - 1][0] as { extra_json: Record<string, unknown> })
        .extra_json).toMatchObject({
        SpaceHeatSystem: {
          'Kitchen/Diner rads': expect.objectContaining({
            HeatSource: { name: 'hp', temp_flow_limit_upper: 70 },
          }),
        },
      }),
    );
    expect(typeof (onChange.mock.calls[onChange.mock.calls.length - 1][0] as {
      extra_json: { SpaceHeatSystem: Record<string, { HeatSource: { temp_flow_limit_upper: unknown } }> };
    }).extra_json.SpaceHeatSystem['Kitchen/Diner rads'].HeatSource.temp_flow_limit_upper).toBe('number');

    // Edit round-trip #2: a TOP-LEVEL field under the '.'-containing plant key --
    // exercises single-hop segment safety for a plant key `pathFromLayoutScope`'s old
    // dot-join would have corrupted ("Zone 1.5 circuit".split('.') used to produce
    // ['Zone 1', '5 circuit'], two bogus hops instead of one real plant key).
    const zoneInput = within(fieldRowByLabel(container, 'frac_convective', 'Zone 1.5 circuit')).getByRole(
      'textbox',
    );
    fireEvent.change(zoneInput, { target: { value: '0.55' } });
    await waitFor(() => {
      const lastExtraJson = (onChange.mock.calls[onChange.mock.calls.length - 1][0] as {
        extra_json: { SpaceHeatSystem: Record<string, { frac_convective?: unknown }> };
      }).extra_json;
      expect(lastExtraJson.SpaceHeatSystem['Zone 1.5 circuit'].frac_convective).toBe(0.55);
    });
    // Both edits landed cumulatively (controlled harness re-feeds each onChange
    // payload back in as the next render's data) -- the nested Kitchen/Diner rads
    // edit from round-trip #1 is still present after round-trip #2's independent
    // top-level Zone 1.5 circuit edit.
    const finalExtraJson = (onChange.mock.calls[onChange.mock.calls.length - 1][0] as {
      extra_json: {
        SpaceHeatSystem: Record<string, { HeatSource?: { temp_flow_limit_upper?: unknown }; frac_convective?: unknown }>;
      };
    }).extra_json;
    expect(finalExtraJson.SpaceHeatSystem['Kitchen/Diner rads'].HeatSource?.temp_flow_limit_upper).toBe(70);
    expect(finalExtraJson.SpaceHeatSystem['Zone 1.5 circuit'].frac_convective).toBe(0.55);
  });

  it('config 11 -- System, HotWaterSource, FHS: HeatSource map is skipped (CHARACTERIZATION)', () => {
    // CHARACTERIZATION FINDING, correcting the brief's assumption: HotWaterSource's
    // `HeatSource` is NOT the same shape as SpaceHeatSystem's `HeatSource` (config
    // 10). SpaceHeatSystem's is a single fixed-shape object (`{name,
    // temp_flow_limit_upper}`) that `shouldRecurseIntoNestedObject` sees as having
    // static `properties`, so it recurses and hoists per Stage-2.3's contract.
    // HotWaterSource's `hw cylinder.HeatSource` (verified directly against
    // `$defs.Tank.properties.HeatSource` in input_fhs.schema.json) is a genuine
    // `additionalProperties` MAP keyed by heat-source name -- `expandSystemMergeMapSchemaForJsonForms`
    // only expands the OUTERMOST merge-map (`extra_json[subtype]` itself, i.e.
    // `HotWaterSource` -> `hw cylinder`), not a merge-map nested two levels further
    // in. `shouldRecurseIntoNestedObject` therefore sees no static `properties` on
    // this `HeatSource` schema and `buildSystemAdvancedUischema`'s own explicit guard
    // (`if (key === 'HeatSource' && !shouldRecurseIntoNestedObject(...)) continue`)
    // SKIPS it entirely -- "the Heat Source picker + hoisted per-heater controls
    // cover editing" per that guard's own comment, referring to
    // `DhwStorageHeatSourcePicker` (mounted separately by AdvancedFieldsEditor
    // outside the generic Advanced Fields grid, unaffected by this slice).
    const { container } = assertDirectCharacterization(
      {
        elementType: 'System',
        subtype: 'HotWaterSource',
        useFHSSchema: true,
        extraJson: {
          HotWaterSource: {
            'hw cylinder': {
              type: 'StorageTank',
              volume: 80,
              daily_losses: 1.68,
              init_temp: 55,
              ColdWaterSource: 'mains water',
              HeatSource: {
                hp: {
                  type: 'HeatSourceWet',
                  name: 'hp',
                  temp_flow_limit_upper: 65,
                  heater_position: 0.1,
                  thermostat_position: 0.33,
                },
              },
            },
          },
        },
      },
      [
        row('ColdWaterSource', 'Cold Water Source', SELECT),
        row('daily_losses', 'Daily Losses', TEXT('0.001')),
        row('init_temp', 'Init Temp', TEXT('1')),
        row('volume', 'Volume', TEXT('1')),
      ],
    );

    expect(fieldKeys(container)).not.toContain('HeatSource');
    // No opaque "[object Object]" blob leaks through anywhere in the grid either.
    expect(container.textContent).not.toContain('[object Object]');
  });

  describe('Stage 2.5: const-only / type-less properties are dropped in flat mode', () => {
    // No live HEM Advanced Field property is actually const-only-and-type-less
    // (checked directly against both schema files: every `const` found sits inside an
    // `if`/`allOf` conditional block, never as a standalone Advanced Field property),
    // so this is a synthetic schema exercising `schemaEmitsControl`'s gate directly --
    // matching the pattern the $ref probe test in
    // AdvancedFieldsEditor.electricBattery.test.tsx already uses for an isolated
    // DirectAdvancedFields mount, since no real element type reaches it.
    const syntheticSchema = {
      type: 'object',
      properties: {
        // Const-only, no `type`/`enum`/`properties`/`items` -- this shape derives no
        // type at all (see `schemaEmitsControl`'s own docstring in
        // DirectAdvancedFields.tsx, verified against the real `@jsonforms/core`
        // generator this gate was built to match before R4.5 deleted that dependency).
        mode_marker: { const: 'v1' },
        battery_age: { type: 'number', title: 'Battery Age' },
      },
    };

    it('DirectAdvancedFields: mode_marker is skipped, battery_age still renders', () => {
      const onDataChange = vi.fn();
      const store = createGeometryStore({ defaultDefaultsPath: null });
      const { container } = render(
        <GeometryEditorServicePortsProvider
          schemaPort={canonicalGeometrySchemaPort}
          workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
        >
          <GeometryStoreProvider store={store}>
            <DirectAdvancedFields
              schema={syntheticSchema}
              data={{ mode_marker: 'v1', battery_age: 5 }}
              config={{ advancedEditor: true, elementType: 'ElectricBattery' }}
              onDataChange={onDataChange}
            />
          </GeometryStoreProvider>
        </GeometryEditorServicePortsProvider>,
      );
      const keys = Array.from(container.querySelectorAll('[data-field-key]')).map((el) =>
        el.getAttribute('data-field-key'),
      );
      expect(keys).toEqual(['battery_age']);
    });

    it('R4.3b bugfix (adversarial review round 2): empty-alternatives string properties fall through to a free-text input, not a zero-option dropdown', () => {
      // REACHABLE state, not synthetic-only: `lib/systemHotWaterAdvancedSchema.ts`'s
      // `inlineHotWaterSourceHeatSourceWetEnumOnHotWaterSubschema` manufactures
      // exactly `HeatSourceWet: {type:'string', oneOf: []}` on an FHS
      // CombiBoiler/HIU/HeatBattery `hw cylinder` whenever the project has ZERO wet
      // heat-source plants defined yet -- its own hint text asks the user to type a
      // name ("No defined heat source (wet) names yet. Add a Heat source (wet)
      // system that defines a plant key, then link here."). The shared
      // `schemaHasEnum`/`schemaHasConstAlternatives` predicates WERE vacuously true on
      // an empty array, which was harmless under R4.3's type-first `pickDirectControl`
      // order but would route this straight to a ZERO-OPTION EnumControl dropdown
      // under R4.3b's enum-first order without the `isNonEmptyEnumLike` guard --
      // permanently uneditable, right next to help text asking for exactly the input
      // it no longer accepts. R4.6b-2 moved the guard INTO those two predicates
      // (`lib/schemaShape.ts`), so there is no longer a loose form of them to guard
      // against; what this test pins is the OUTCOME, which is why it is unchanged by
      // that move. Exercises `pickDirectControl` directly (unit-level, the
      // fastest signal) AND through a full DirectAdvancedFields mount (DOM-level, the
      // signal that would have actually caught this in the field).
      expect(pickDirectControl({ type: 'string', oneOf: [] })).toBe('text');
      expect(pickDirectControl({ type: 'string', enum: [] })).toBe('text');
      // Non-empty alternatives still win as EnumControl -- this guard is about
      // emptiness, not a blanket demotion of oneOf/enum.
      expect(pickDirectControl({ type: 'string', oneOf: [{ const: 'a' }] })).toBe('enum');

      const zeroNamesSchema = {
        type: 'object',
        properties: {
          // `oneOf: []` -- the exact manufactured shape from
          // inlineHotWaterSourceHeatSourceWetEnumOnHotWaterSubschema.
          HeatSourceWet: { type: 'string', oneOf: [], title: 'Heat source (wet)' },
          // `enum: []` -- cheap sibling case for the same guard, same failure mode.
          empty_enum_field: { type: 'string', enum: [], title: 'Empty Enum Field' },
        },
      };
      const onDataChange = vi.fn();
      const store = createGeometryStore({ defaultDefaultsPath: null });
      const { container } = render(
        <GeometryEditorServicePortsProvider
          schemaPort={canonicalGeometrySchemaPort}
          workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
        >
          <GeometryStoreProvider store={store}>
            <DirectAdvancedFields
              schema={zeroNamesSchema}
              data={{}}
              config={{ advancedEditor: true, elementType: 'System' }}
              onDataChange={onDataChange}
            />
          </GeometryStoreProvider>
        </GeometryEditorServicePortsProvider>,
      );

      for (const key of ['HeatSourceWet', 'empty_enum_field']) {
        const fieldRowEl = fieldRow(container, key);
        // Free-text input (TextControl), NOT a select and NOT a checkbox -- reuses
        // the same `inputSignatureForRow` classifier every other config in this file
        // asserts against.
        expect(inputSignatureForRow(fieldRowEl)).toEqual(TEXT(null));
      }
    });
  });
});

/**
 * R4.5: `DirectSpecFields` interprets the EXPLICIT uischema-spec trees web's
 * SnippetEditor (`lib/jsonFormsPresentUi.ts`) and SimplifiedFabricEditor
 * (`components/SimplifiedFabricEditor.tsx`'s `ui` memo, parent repo) build by hand --
 * distinct from every config above, which exercises `DirectAdvancedFields`' own
 * resolved-subschema walk. Fixtures below are shaped to match those two builders
 * exactly (verified directly against both, parent repo, read-only), not invented.
 */

/**
 * `DirectSpecFields` is FULLY CONTROLLED: its `applyChange` closes over the `data`
 * PROP (`onDataChange(setAtPath(data, segments, value))`), so whatever the host feeds
 * back in is the base for the next edit. Both production hosts do feed it back — web's
 * `SnippetEditorShell`/`useSnippetShellData` owns the payload and re-renders with it.
 *
 * A bare `onDataChange` spy over a STATIC `data` prop looks equivalent and is not: the
 * component keeps rendering the original fixture, so a second consecutive interaction
 * is applied to PRE-EDIT state and silently discards the first edit, and nothing the
 * component itself wrote is ever read back. That is exactly the harness defect the
 * paired parent commit fixed on web's `SnippetEditor` test (a controlled wrapper
 * mirroring `JsonViewerModal`'s real mount); this is the same fix for the community
 * side. The spy is still passed straight through, so call-count and payload
 * assertions are unaffected.
 */
const ControlledDirectSpecFields: React.FC<{
  schema: Record<string, unknown>;
  initialData: Record<string, unknown>;
  config: Record<string, unknown>;
  spec: DirectSpecNode;
  onDataChange: (next: Record<string, unknown>) => void;
}> = ({ schema, initialData, config, spec, onDataChange }) => {
  const [data, setData] = React.useState(initialData);
  return (
    <DirectSpecFields
      schema={schema}
      data={data}
      config={config}
      spec={spec}
      onDataChange={(next) => {
        onDataChange(next);
        setData(next);
      }}
    />
  );
};

function renderDirectSpecFields(props: {
  schema: Record<string, unknown>;
  data: Record<string, unknown>;
  spec: DirectSpecNode;
  config?: Record<string, unknown>;
  onDataChange?: ReturnType<typeof vi.fn>;
}) {
  const onDataChange = props.onDataChange ?? vi.fn();
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const utils = render(
    <GeometryEditorServicePortsProvider
      schemaPort={canonicalGeometrySchemaPort}
      workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
    >
      <GeometryStoreProvider store={store}>
        <ControlledDirectSpecFields
          schema={props.schema}
          initialData={props.data}
          config={props.config ?? { advancedEditor: true, elementType: 'ThermalBridgeLinear' }}
          spec={props.spec}
          onDataChange={onDataChange}
        />
      </GeometryStoreProvider>
    </GeometryEditorServicePortsProvider>,
  );
  return { onDataChange, ...utils };
}

describe('DirectSpecFields (R4.5): interprets web\'s explicit uischema-spec trees directly', () => {
  it('flat snippet-style spec: rows render in SPEC order (not schema property-declaration order), an object-typed property JSON-blobs via TextControl, edits round-trip, and nothing fires on mount', () => {
    // Schema declares zeta/alpha/meta in THAT order; the snippet spec (mirroring
    // `buildPresentUiForJsonForms`'s `Object.keys(props).sort()`) lists them
    // alpha/meta/zeta -- deliberately different orders, so a DOM-order match proves
    // the walker follows the spec, not `Object.keys(schema.properties)`.
    const snippetSchema = {
      type: 'object',
      properties: {
        zeta: { type: 'number', title: 'Zeta' },
        alpha: { type: 'string', title: 'Alpha' },
        meta: { type: 'object' },
      },
    };
    // Snippet Controls carry no `options` at all (see `jsonFormsPresentUi.ts`) --
    // resolution falls through to the "walk contextSchema through the tokens"
    // branch, not `options.schemaOverride`.
    const snippetSpec: DirectSpecNode = {
      type: 'VerticalLayout',
      elements: ['alpha', 'meta', 'zeta'].map((key) => ({
        type: 'Control',
        scope: `#/properties/${key}`,
      })),
    };
    const initialData = { zeta: 5, alpha: 'hi', meta: { a: 1 } };
    const onDataChange = vi.fn();
    const { container } = renderDirectSpecFields({
      schema: snippetSchema,
      data: initialData,
      spec: snippetSpec,
      onDataChange,
    });

    expect(fieldKeys(container)).toEqual(['alpha', 'meta', 'zeta']);
    expect(onDataChange).not.toHaveBeenCalled();

    // meta: object-typed with no options.schemaOverride -- resolves via the walked
    // contextSchema, lands on TextControl's isJsonLike branch (JSON.stringify blob),
    // same as DirectAdvancedFields' own nested-object characterization elsewhere in
    // this file.
    const metaRow = fieldRow(container, 'meta');
    expect(fieldLabelText(metaRow)).toBe('Meta');
    const metaInput = within(metaRow).getByRole('textbox') as HTMLInputElement;
    expect(metaInput.value).toBe(JSON.stringify({ a: 1 }));

    // Edit round-trip on the plain string field, and confirm the sibling keys
    // (zeta, meta) survive untouched in the emitted payload.
    const alphaRow = fieldRow(container, 'alpha');
    expect(fieldLabelText(alphaRow)).toBe('Alpha');
    const alphaInput = within(alphaRow).getByRole('textbox');
    fireEvent.change(alphaInput, { target: { value: 'bye' } });
    expect(onDataChange).toHaveBeenCalledWith({ zeta: 5, alpha: 'bye', meta: { a: 1 } });
  });

  it('fabric-style spec: a Group with schemaOverride/pathOverride/openInitially renders an open accordion, and its Controls resolve against their own schemaOverride and write to pathOverride-prefixed segments (enum Control routes to EnumControl, R4.3b enum-first)', () => {
    const junctionTypeSchema = { type: 'string', enum: ['E1', 'E2'], title: 'Junction Type' };
    const lengthSchema = { type: 'number', title: 'Length' };
    // Mirrors SimplifiedFabricEditor's `ui` memo: every leaf Control carries its OWN
    // `options.schemaOverride` (the exact resolved per-field schema), and the
    // enclosing Group carries `schemaOverride` (the section's own object schema) +
    // `pathOverride` (the dot-joined ABSOLUTE instance path) + `openInitially`.
    const fabricSpec: DirectSpecNode = {
      type: 'VerticalLayout',
      elements: [
        {
          type: 'Group',
          label: 'Thermal bridge (linear)',
          elements: [
            {
              type: 'Control',
              label: 'Junction Type',
              scope: '#/properties/junction_type',
              options: { schemaOverride: junctionTypeSchema },
            },
            {
              type: 'Control',
              label: 'Length',
              scope: '#/properties/length',
              options: { schemaOverride: lengthSchema },
            },
          ],
          options: {
            schemaOverride: {
              type: 'object',
              properties: { junction_type: junctionTypeSchema, length: lengthSchema },
            },
            pathOverride: 'ThermalBridging.TB_linear',
            openInitially: true,
          },
        },
      ],
    };
    const initialData = { ThermalBridging: { TB_linear: { junction_type: 'E1', length: 2.5 } } };
    const onDataChange = vi.fn();
    const { container } = renderDirectSpecFields({
      schema: { type: 'object', properties: {} },
      data: initialData,
      spec: fabricSpec,
      onDataChange,
    });

    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(true);
    const summary = details!.querySelector('summary')!;
    expect(summary.textContent).toContain('Thermal bridge (linear)');
    expect(summary.textContent).toContain('2'); // count badge (2 elements in the Group)

    // Data-path resolution: the leaf field keys are 'junction_type'/'length' (path
    // segments end there), prefixed by the Group's pathOverride.
    expect(fieldKeys(container)).toEqual(['junction_type', 'length']);

    // junction_type: schemaOverride carries a non-empty enum -> EnumControl
    // (R4.3b enum-first `pickDirectControl`), a real <select>, not a checkbox/textbox.
    const junctionRow = fieldRow(container, 'junction_type');
    const select = within(junctionRow).getByRole('combobox');
    const optionValues = Array.from(select.querySelectorAll('option')).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(optionValues).toEqual(expect.arrayContaining(['E1', 'E2']));

    // length: plain number schemaOverride -> NumberControl (textbox).
    const lengthRow = fieldRow(container, 'length');
    within(lengthRow).getByRole('textbox');

    // Edit round-trip: the write lands at the pathOverride-prefixed nested segments,
    // not at the top of `data`.
    fireEvent.change(select, { target: { value: 'E2' } });
    expect(onDataChange).toHaveBeenCalledWith({
      ThermalBridging: { TB_linear: { junction_type: 'E2', length: 2.5 } },
    });
  });

  it('array-shaped fabric spec: self-rooted per-item Groups bind values per index; editing one item preserves the other byte-for-byte; unset leaves siblings intact (R4.5 review round 1 fix -- setAtPath/getAtPath array-hop support)', () => {
    // REGRESSION, caught in adversarial review round 1: `setAtPath` used to treat
    // every array CHILD as "not a valid container" and silently replace the WHOLE
    // array with `{}` on any nested write under it -- an edit under a per-item
    // Group's `pathOverride` (e.g. 'sec.list.0') would have destroyed every sibling
    // item. Fixed in `setAtPathNode` (array hop preserved via `.slice()` + index
    // write when the existing child is an array and the segment is a canonical
    // non-negative integer); `getAtPath` gets the matching read-side.
    //
    // Shape: the PAIRED web PR changes its array-of-objects builder to emit
    // SELF-ROOTED per-item Groups -- each item is its own Group
    // (`options: {schemaOverride: itemSchema, pathOverride: 'sec.list.<i>'}`) whose
    // children are single-hop Controls scoped `#/properties/<leaf>` relative to that
    // item's OWN schema (not accumulated through an outer basePtr the way a nested
    // -object Group's children are elsewhere in this file) -- exactly the shape this
    // fixture reproduces.
    const nameSchema = { type: 'string', title: 'Name' };
    const valueSchema = { type: 'number', title: 'Value' };
    const itemSchema = { type: 'object', properties: { name: nameSchema, value: valueSchema } };

    function itemGroup(index: number): DirectSpecNode {
      return {
        type: 'Group',
        label: `Item ${index}`,
        elements: [
          {
            type: 'Control',
            label: `Item ${index} · Name`,
            scope: '#/properties/name',
            options: { schemaOverride: nameSchema },
          },
          {
            type: 'Control',
            label: `Item ${index} · Value`,
            scope: '#/properties/value',
            options: { schemaOverride: valueSchema },
          },
        ],
        options: { schemaOverride: itemSchema, pathOverride: `sec.list.${index}`, openInitially: true },
      };
    }
    const arraySpec: DirectSpecNode = {
      type: 'VerticalLayout',
      elements: [itemGroup(0), itemGroup(1)],
    };
    const initialData = {
      sec: { list: [{ name: 'Alpha', value: 1 }, { name: 'Beta', value: 2 }] },
    };
    const onDataChange = vi.fn();
    const { container } = renderDirectSpecFields({
      schema: { type: 'object', properties: {} },
      data: initialData,
      spec: arraySpec,
      onDataChange,
    });

    // Both items render, values bound per index -- not both showing item 0's values,
    // and not the whole-array-replaced-with-{} failure mode (which would render zero
    // rows or throw resolving `sec.list.<i>` against a plain object).
    const item0NameInput = within(fieldRowByLabel(container, 'name', 'Item 0')).getByRole('textbox') as HTMLInputElement;
    const item1NameInput = within(fieldRowByLabel(container, 'name', 'Item 1')).getByRole('textbox') as HTMLInputElement;
    expect(item0NameInput.value).toBe('Alpha');
    expect(item1NameInput.value).toBe('Beta');

    // Edit round-trip: editing item 0's name preserves item 1 BYTE-FOR-BYTE (the old
    // whole-array-replacement bug would have dropped item 1 entirely).
    fireEvent.change(item0NameInput, { target: { value: 'Alpha 2' } });
    expect(onDataChange).toHaveBeenLastCalledWith({
      sec: { list: [{ name: 'Alpha 2', value: 1 }, { name: 'Beta', value: 2 }] },
    });

    // SECOND CONSECUTIVE EDIT, against data the component itself wrote. This is the
    // half the old (uncontrolled) harness could not express at all, and it closes the
    // loop `getAtPath`'s docstring states as a contract -- "both must agree, or a value
    // written via one would read back as undefined via the other". Everything above
    // only ever exercised the write side against the pristine fixture; the read side
    // was only ever exercised at mount, against that same fixture. Here the array that
    // `setAtPath`'s array branch produced (a `.slice()` clone, one index rewritten) is
    // what `getAtPath` must now index back into.
    expect(item0NameInput.value).toBe('Alpha 2');
    expect(item1NameInput.value).toBe('Beta');
    fireEvent.change(item1NameInput, { target: { value: 'Beta 2' } });
    expect(onDataChange).toHaveBeenLastCalledWith({
      sec: { list: [{ name: 'Alpha 2', value: 1 }, { name: 'Beta 2', value: 2 }] },
    });
    // Still a real array after two writes through the array hop, not an object with
    // numeric keys -- the shape `JSON.stringify` has to emit for a HEM list.
    const afterTwoEdits = onDataChange.mock.calls[onDataChange.mock.calls.length - 1][0] as {
      sec: { list: unknown };
    };
    expect(Array.isArray(afterTwoEdits.sec.list)).toBe(true);

    // Unset (reset-to-undefined) on item 0's `value`. R4.6a COMMENT CORRECTION: this
    // exercises the RECORD branch of `setAtPathNode`, not the array branch -- the leaf
    // being unset is a key inside the item OBJECT at index 0 (`sec.list.0.value`), so
    // index 0 keeps its object, minus that key, and the array itself is untouched.
    // The old wording here ("leaving a hole at index 0 (not a splice that would shift
    // item 1 down)") described the ARRAY-INDEX-leaf case, which this fixture never
    // reaches and which R4.6a changed to a splice anyway -- see the dedicated
    // array-index-leaf test below and `setAtPathNode`'s docstring. Everything asserted
    // here is unchanged by that fix. It now runs as the THIRD consecutive interaction,
    // against the twice-rewritten array rather than the fixture (hence `'Beta 2'`).
    const resetButton = within(fieldRowByLabel(container, 'value', 'Item 0')).getByRole('button', {
      name: 'Reset to default',
    });
    fireEvent.click(resetButton);
    const lastCall = onDataChange.mock.calls[onDataChange.mock.calls.length - 1][0] as {
      sec: { list: Array<Record<string, unknown> | undefined> };
    };
    expect(lastCall.sec.list.length).toBe(2);
    expect(lastCall.sec.list[1]).toEqual({ name: 'Beta 2', value: 2 });
    expect(lastCall.sec.list[0]).toEqual({ name: 'Alpha 2' });
    expect(Object.prototype.hasOwnProperty.call(lastCall.sec.list[0] ?? {}, 'value')).toBe(false);
  });

  it('R4.6a: unsetting a leaf that IS an array index splices the item out — no `null` hole in the serialised JSON', () => {
    // R4.5 REVIEW NOTE, closed. `setAtPathNode` used to `delete arr[i]` here, on the
    // stated grounds that it mirrored `lodash/fp/unset` -- the contract that mattered
    // while JsonForms' `UPDATE_DATA` reducer was the reference implementation. R4.4/R4.5
    // deleted that reducer; a hole serialises as `null` through `JSON.stringify`, and
    // `null` is not valid HEM input for any list this walker can reach
    // (`window_part_list`, `edge_insulation`, `treatment` are all lists OF OBJECTS).
    //
    // UNREACHABLE FROM TODAY'S UI, and the fixture now says so for the RIGHT reason (an
    // earlier version of this comment claimed no production spec binds a Control
    // straight to an array index, which is false). Web's `SimplifiedFabricEditor`
    // (`buildControls`, parent repo) does exactly that -- a `Control` scoped
    // `#/properties/<i>` inside a Group whose `pathOverride` ends at the array -- chosen
    // per item for items that are not objects. What makes it dead is the DATA: every
    // array those fabric sections can reach in today's schemas holds OBJECTS
    // (`treatment` / `shading` / `window_part_list` / `edge_insulation`), so the
    // per-item Group branch is taken instead and every live array path ends at a leaf
    // inside an item object -- the test immediately above. Nor is it the reset
    // affordance holding it back: that renders for any non-blank value even under the
    // fabric editor's `config={{}}` mount, and clicking it commits `undefined`, which is
    // precisely what this fixture drives. See `setAtPathNode`'s docstring for the full
    // reasoning and for the two routes that genuinely do not apply. This is a
    // self-rooted `Group` over a primitive list, the minimal shape that reaches the
    // array branch's leaf-unset at all, and the reason to have it is that the next
    // array-shaped builder inherits this behaviour whether or not anyone re-derives the
    // argument.
    const itemSchema = { type: 'number' };
    const primitiveListSpec: DirectSpecNode = {
      type: 'VerticalLayout',
      elements: [
        {
          type: 'Group',
          label: 'Readings',
          elements: [0, 1, 2].map((index) => ({
            type: 'Control' as const,
            label: `Reading ${index}`,
            scope: `#/properties/${index}`,
            options: { schemaOverride: itemSchema },
          })),
          options: {
            schemaOverride: { type: 'object', properties: { 0: itemSchema, 1: itemSchema, 2: itemSchema } },
            pathOverride: 'sec.list',
            openInitially: true,
          },
        },
      ],
    };
    const onDataChange = vi.fn();
    const { container } = renderDirectSpecFields({
      schema: { type: 'object', properties: {} },
      data: { sec: { list: [10, 20, 30] }, sibling: 'untouched' },
      spec: primitiveListSpec,
      onDataChange,
    });

    // Values bind per index (10/20/30), which is what makes the post-unset shift below
    // meaningful rather than an artefact of everything reading index 0.
    expect(
      ['0', '1', '2'].map((key) => (within(fieldRow(container, key)).getByRole('textbox') as HTMLInputElement).value),
    ).toEqual(['10', '20', '30']);

    fireEvent.click(within(fieldRow(container, '0')).getByRole('button', { name: 'Reset to default' }));

    const next = onDataChange.mock.calls[onDataChange.mock.calls.length - 1][0] as {
      sec: { list: unknown };
      sibling: string;
    };
    // Item removed, later items shifted down, still an array, siblings intact.
    expect(Array.isArray(next.sec.list)).toBe(true);
    expect(next.sec.list).toEqual([20, 30]);
    expect(next.sibling).toBe('untouched');
    // The assertion the old `delete` semantics failed: a hole stringifies as `null`,
    // and `[null,20,30]` is what used to reach the exported HEM input.
    expect(JSON.stringify(next.sec.list)).toBe('[20,30]');
  });
});

describe('GroupAccordion (R4.5): plain collapsible chrome extracted from the retired Group registry renderer', () => {
  it('openInitially false starts closed, toggling opens it, and no add-field affordance ever renders', () => {
    const { container } = render(
      <GroupAccordion label="Section" count={3} openInitially={false}>
        <div data-testid="accordion-child">child content</div>
      </GroupAccordion>,
    );

    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(container.querySelector('[data-testid="accordion-child"]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).not.toContain('Add field');

    // Native <details>/<summary> toggling: a real click flips `.open` and fires a
    // 'toggle' event on the <details> element; jsdom does not reliably synthesize
    // that from a click, so this drives the same event GroupAccordion's own
    // `onToggle` handler listens for directly.
    details.open = true;
    fireEvent(details, new Event('toggle'));

    expect(details.open).toBe(true);
    expect(container.querySelector('[data-testid="accordion-child"]')).not.toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).not.toContain('Add field');
  });
});

/**
 * Ported from the deleted web `jsonformsRenderers.test.tsx` (parent repo, R4.5 —
 * that file mounted through `<JsonForms renderers={[...standardRenderers,
 * ...materialRenderers]}>`, which no longer exists anywhere; the paired parent PR
 * deletes the whole file). Per this repo's test-move policy, coverage for community
 * code lives IN community, so these two are re-seated here as direct
 * `WindowPartListControl` mounts (this file's own established `GeometryStoreProvider`
 * + `GeometryEditorServicePortsProvider` harness — `WindowPartListControl` reads the
 * current window element's `base_height`/`height` off the geometry store directly,
 * not off its own props, and renders a field label via `useGeometrySchemaPort()`)
 * instead of through the deleted registry. Assertions and fixture values are
 * unchanged from the original.
 */
describe('WindowPartListControl interactions (ported from the deleted web registry test, R4.5)', () => {
  function renderWindowPartListControl({
    data,
    handleChange,
    baseHeightM,
    heightM,
  }: {
    data: unknown;
    handleChange: ReturnType<typeof vi.fn>;
    baseHeightM: number;
    heightM: number;
  }) {
    const store = createGeometryStore({ defaultDefaultsPath: null });
    const windowElement = {
      id: 'window-1',
      name: 'window-1',
      type: 'BuildingElementTransparent',
      zoneId: 'zone-1',
      parent_element: null,
      coordinates: [],
      base_height: baseHeightM,
      height: heightM,
      width: 1.0,
    } as unknown as Element;
    act(() => {
      store.setState({
        selection: { type: 'element', id: 'window-1' },
        elementsById: { 'window-1': windowElement },
        elementIds: ['window-1'],
      });
    });
    const utils = render(
      <GeometryEditorServicePortsProvider
        schemaPort={canonicalGeometrySchemaPort}
        workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
      >
        <GeometryStoreProvider store={store}>
          <WindowPartListControl
            data={data}
            handleChange={handleChange}
            path="window_part_list"
            propKey="window_part_list"
            label="Window Part List"
            config={{ advancedEditor: true, elementType: 'BuildingElementTransparent' }}
          />
        </GeometryStoreProvider>
      </GeometryEditorServicePortsProvider>,
    );
    return { store, ...utils };
  }

  it('preserves midpoint-above-base when window base height changes', async () => {
    const handleChange = vi.fn();
    const { store } = renderWindowPartListControl({
      data: [{ mid_height_air_flow_path: 1.5 }],
      handleChange,
      baseHeightM: 1.0,
      heightM: 1.2,
    });

    handleChange.mockClear();

    act(() => {
      store.setState({
        // A freshly-created `selection` object (same id, same shape) is what forces
        // `WindowPartListControl`'s `useGeometryStore((state) => state.selection)`
        // subscription to see a change and re-render with fresh `elementsById` --
        // mirrors the original (deleted) test's own identical trick against the
        // singleton `useGeometryStore.setState`.
        selection: { type: 'element', id: 'window-1' },
        elementsById: {
          'window-1': { ...(store.getState().elementsById['window-1'] as Element), base_height: 1.2 },
        },
      });
    });

    await waitFor(() => {
      expect(handleChange).toHaveBeenCalled();
    });

    expect(handleChange).toHaveBeenLastCalledWith('window_part_list', [{ mid_height_air_flow_path: 1.7 }]);
  });

  it('preserves decimal-zero window part midpoint drafts above the window base', async () => {
    const handleChange = vi.fn();
    const { container } = renderWindowPartListControl({
      data: [{ mid_height_air_flow_path: 1.5 }],
      handleChange,
      baseHeightM: 1.0,
      heightM: 1.2,
    });

    const midpointInput = within(container).getByLabelText(
      'Window part 1 midpoint in metres above window base',
    ) as HTMLInputElement;
    expect(midpointInput).toHaveAttribute('type', 'text');

    fireEvent.change(midpointInput, { target: { value: '0.0' } });
    await waitFor(() => expect(handleChange).toHaveBeenCalled());
    expect(midpointInput.value).toBe('0.0');

    fireEvent.change(midpointInput, { target: { value: '0.05' } });
    await waitFor(() => {
      expect(handleChange).toHaveBeenLastCalledWith('window_part_list', [{ mid_height_air_flow_path: 1.05 }]);
    });
    expect(midpointInput.value).toBe('0.05');
  });
});

/**
 * Per-property validation on a **System** Advanced Field was a NO-OP on every row, on both
 * profiles. `resolveFhsElementSubschemaFromRoot` / `resolveCoreElementSubschemaFromRoot`
 * deliberately return System rows as a wrapper — `{ properties: { [subtype]: inner } }`, because
 * `extra_json` is shaped `{ HeatSourceWet: { … } }` — so `subschema.properties[key]` never found a
 * leaf, and both arms' "key not found" branch answered `{ valid: true }`. Any shape at all
 * committed silently, which is how a `'[]'` placeholder reached a user's saved model.
 *
 * Read against the REAL published schemas (`data/schemas/*`), like the rest of this file, so a
 * schema change that moves these leaves shows up here instead of being re-mocked.
 */
describe('System Advanced Fields: per-property validation descends the subtype wrapper', () => {
  /** The shapes probed on the no-op: all four were accepted on both profiles before the fix. */
  const NON_NUMERIC_SHAPES: ReadonlyArray<readonly [string, unknown]> = [
    ['an array', []],
    ['an object', {}],
    ['a string', 'not an object'],
    ['a boolean', true],
  ];

  const check = (mode: 'core' | 'fhs', subtype: string, key: string, value: unknown) =>
    validatePropertyValueForMode(mode === 'fhs', 'System', subtype, key, value);

  it.each(['core', 'fhs'] as const)(
    '%s: the resolver still hands back the subtype WRAPPER (the Advanced Fields walk depends on it)',
    (mode) => {
      const subschema = getElementSubschemaForMode(mode === 'fhs', 'System', 'InfiltrationVentilation');
      expect(Object.keys(subschema?.properties ?? {})).toEqual(['InfiltrationVentilation']);
      // The leaf is one level down -- which is exactly why the direct lookup missed it.
      expect(subschema?.properties?.ach_max_static_calcs).toBeUndefined();
    },
  );

  describe('numeric leaf: InfiltrationVentilation.ach_max_static_calcs', () => {
    it.each(['core', 'fhs'] as const)('%s: rejects every non-numeric shape', (mode) => {
      for (const [label, value] of NON_NUMERIC_SHAPES) {
        const result = check(mode, 'InfiltrationVentilation', 'ach_max_static_calcs', value);
        expect(result.valid, `${mode}: ${label} must be rejected`).toBe(false);
        expect(result.errors?.join(' ')).toContain('must be number');
      }
    });

    it.each(['core', 'fhs'] as const)('%s: accepts a plausible number, and the coerced string form', (mode) => {
      expect(check(mode, 'InfiltrationVentilation', 'ach_max_static_calcs', 2)).toEqual({ valid: true });
      // Pre-existing coercion path (`coerceValueToSchemaType`): a numeric string is coerced, not
      // rejected. Asserted as measured -- the descent reuses that path rather than replacing it.
      expect(check(mode, 'InfiltrationVentilation', 'ach_max_static_calcs', '2')).toEqual({ valid: true });
    });

    it.each(['core', 'fhs'] as const)('%s: still treats unset values as valid', (mode) => {
      for (const unset of [undefined, null, '']) {
        expect(check(mode, 'InfiltrationVentilation', 'ach_max_static_calcs', unset)).toEqual({ valid: true });
      }
    });
  });

  describe("the '[]'-commit incident class: object-typed leaves", () => {
    it.each(['core', 'fhs'] as const)(
      '%s: InfiltrationVentilation.MechanicalVentilation rejects [] and accepts an object',
      (mode) => {
        // Core publishes this leaf nullable-wrapped (`anyOf: [ object-map, null ]`), FHS bare;
        // the descent sees through the wrapper, so both reject the array.
        const rejected = check(mode, 'InfiltrationVentilation', 'MechanicalVentilation', []);
        expect(rejected.valid).toBe(false);
        expect(rejected.errors?.join(' ')).toContain('must be object');
        // THIS map's entries are `additionalProperties` with no `minProperties`, so an empty map
        // is a legitimate value here. Not a general rule about maps -- see the `Other` case below.
        expect(check(mode, 'InfiltrationVentilation', 'MechanicalVentilation', {})).toEqual({ valid: true });
      },
    );

    it.each(['core', 'fhs'] as const)('%s: HotWaterDemand.Bath rejects [] and accepts an object', (mode) => {
      const rejected = check(mode, 'HotWaterDemand', 'Bath', []);
      expect(rejected.valid).toBe(false);
      expect(rejected.errors?.join(' ')).toContain('must be object');
      // `Bath` carries no `minProperties` on either profile.
      expect(check(mode, 'HotWaterDemand', 'Bath', {})).toEqual({ valid: true });
    });

    it('HotWaterDemand.Other: {} is valid on core but NOT on FHS, which sets minProperties: 1', () => {
      // Enforced rather than described: "the entries are `additionalProperties`, so `{}` is fine"
      // is false one property away, and the verdict has to come from the leaf's own node.
      expect(check('core', 'HotWaterDemand', 'Other', {})).toEqual({ valid: true });
      const rejected = check('fhs', 'HotWaterDemand', 'Other', {});
      expect(rejected.valid).toBe(false);
      expect(rejected.errors?.join(' ')).toContain('must NOT have fewer than 1 properties');
      // `[]` is still rejected on both, for the ordinary reason.
      expect(check('core', 'HotWaterDemand', 'Other', []).valid).toBe(false);
      expect(check('fhs', 'HotWaterDemand', 'Other', []).valid).toBe(false);
    });

    it('core: HotWaterDemand.Distribution accepts [] because the schema declares an array there', () => {
      // Not a blanket "arrays are wrong" rule -- the verdict comes from the leaf's own node.
      expect(check('core', 'HotWaterDemand', 'Distribution', [])).toEqual({ valid: true });
      expect(check('core', 'HotWaterDemand', 'Distribution', 'not an object').valid).toBe(false);
      // FHS has no `Distribution` under HotWaterDemand, so there is nothing to validate against
      // and the row keeps its "no verdict" pass.
      expect(check('fhs', 'HotWaterDemand', 'Distribution', [])).toEqual({ valid: true });
    });
  });

  /**
   * Pins the DOCUMENTED non-goal in `validateSystemSubtypePropertyValue`, so a future change to it
   * is deliberate. The gap is DEPTH, not dictionaries: a verdict is reached only one segment below
   * the subtype. With only `(subtype, key)` we cannot tell a user plant NAME from a leaf inside
   * some plant, and validating a leaf against the plant-object schema would false-error live FHS
   * `HeatSourceWet` rows.
   */
  describe('depth >= 2 stays unvalidated (documented gap)', () => {
    it.each(['core', 'fhs'] as const)('%s: every row under a dictionary subtype', (mode) => {
      // `HeatSourceWet` (also `SpaceCoolSystem`, `SpaceHeatSystem`, `WWHRS`, Core `HotWaterSource`)
      // is a plant map, so BOTH readings of the key are depth >= 2.
      expect(check(mode, 'HeatSourceWet', 'my hp', [])).toEqual({ valid: true });
      expect(check(mode, 'HeatSourceWet', 'rated_power', 'not a number')).toEqual({ valid: true });
    });

    it('fhs: and rows under a PROPERTIES-carrying subtype, one level down', () => {
      // The gap is not confined to the plant maps. `Leaks` is a direct leaf of
      // `InfiltrationVentilation` and does get a verdict...
      expect(check('fhs', 'InfiltrationVentilation', 'Leaks', []).valid).toBe(false);
      // ...but its own children do not: FHS declares `test_pressure` as
      // `enum: ["Standard","Pulse test only"]`, and the Core-shaped value 50 still commits.
      expect(check('fhs', 'InfiltrationVentilation', 'test_pressure', 50)).toEqual({ valid: true });
      // Same one level down from FHS `HotWaterSource`, whose single property is a blob...
      expect(check('fhs', 'HotWaterSource', 'hw cylinder', []).valid).toBe(false);
      // ...whose children are again out of reach.
      expect(check('fhs', 'HotWaterSource', 'type', 'not-a-declared-enum-member')).toEqual({ valid: true });
    });
  });

  it('reaches the same verdict through the control-facing port path (validateAdvancedFieldPrimitive)', () => {
    const config = {
      schemaPort: canonicalGeometrySchemaPort,
      subtype: 'InfiltrationVentilation',
      useFHSSchemaForValidation: true,
    } as Parameters<typeof validateAdvancedFieldPrimitive>[0];

    expect(
      validateAdvancedFieldPrimitive(config, 'System', 'ach_max_static_calcs', []).valid,
    ).toBe(false);
    expect(
      validateAdvancedFieldPrimitive(config, 'System', 'ach_max_static_calcs', 2),
    ).toEqual({ valid: true });
  });

  it('leaves the non-System direct lookup exactly as it was', () => {
    for (const [, value] of NON_NUMERIC_SHAPES) {
      expect(
        validatePropertyValueForMode(false, 'BuildingElementOpaque', undefined, 'u_value', value).valid,
      ).toBe(false);
    }
    expect(
      validatePropertyValueForMode(false, 'BuildingElementOpaque', undefined, 'u_value', 0.3),
    ).toEqual({ valid: true });
    expect(
      validatePropertyValueForMode(false, 'BuildingElementOpaque', undefined, 'u_value', '0.3'),
    ).toEqual({ valid: true });
  });
});
