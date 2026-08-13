// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * R4.2/R4.3 characterization: ElectricBattery Advanced Fields, DirectAdvancedFields
 * (ON, default since R4.3) vs. JsonForms (OFF, legacy fallback behind
 * `vulcan:advanced-fields-jsonforms-fallback`). Harness combines the schema-loading
 * pattern from `lib/__tests__/modelAuthoringFieldAudit.test.ts` with the
 * control-mounting pattern from `jsonformsRenderers.units.test.tsx`.
 *
 * R4.3 flag inversion: the R4.2 spike's key (`vulcan:direct-render-advanced-fields`,
 * default OFF) has been REPLACED by `vulcan:advanced-fields-jsonforms-fallback`
 * (default OFF = direct-render is now the default; setting it to '1' restores the
 * legacy JsonForms mount). See `lib/directRenderAdvancedFieldsFlag.ts`.
 *
 * SPIKE FINDING (applies to every JsonForms-path onChange assertion below):
 * `@jsonforms/react`'s `JsonFormsStateProvider` emits the `<JsonForms onChange>`
 * callback through `debounce((...args) => onChangeRef.current?.(...args), 10)` (see
 * node_modules/@jsonforms/react .../jsonforms-react.esm.js, `debouncedEmit`). The
 * JsonForms path therefore only calls `onChange` ~10ms after the LAST edit in a burst.
 * DirectAdvancedFields has no such debounce -- `handleChange` -> `onDataChange` ->
 * `handleJsonFormsChange` -> `onChange` all run synchronously inside the same event.
 * Every JsonForms-path interaction below is followed by `await waitFor(...)` for this
 * reason; the direct-render path never needs it (asserting immediately still passes).
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import React from 'react';
// Raw JsonForms import — allowed HERE ONLY, for the probe-5b comparison mount. No
// other file in this spike imports @jsonforms/*.
import { JsonForms } from '@jsonforms/react';
import { materialRenderers } from '@jsonforms/material-renderers';
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
import { getAjvInstance } from '../../lib/ajvCache';
import { standardRenderers } from '../jsonformsRenderers';
import { AdvancedFieldsEditor } from '../AdvancedFieldsEditor';
import { DirectAdvancedFields } from '../DirectAdvancedFields';
import { ADVANCED_FIELDS_JSONFORMS_FALLBACK_STORAGE_KEY } from '../../lib/directRenderAdvancedFieldsFlag';

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
  localStorage.removeItem(ADVANCED_FIELDS_JSONFORMS_FALLBACK_STORAGE_KEY);
});

const CORE_ADVANCED_FIELD_KEYS = [
  'battery_age',
  'grid_charging_possible',
  'maximum_charge_rate_one_way_trip',
  'maximum_discharge_rate_one_way_trip',
  'minimum_charge_rate_one_way_trip',
];
const CORE_BASE_FIELD_KEYS = ['capacity', 'battery_location', 'charge_discharge_efficiency_round_trip'];
const FHS_ADVANCED_FIELD_KEYS = [
  'maximum_charge_rate_one_way_trip',
  'maximum_discharge_rate_one_way_trip',
  'minimum_charge_rate_one_way_trip',
];

/**
 * `enabled: true` sets the fallback flag, restoring the legacy JsonForms mount.
 * `enabled: false` clears it, the default state, which is now direct-render.
 */
function setJsonformsFallbackFlag(enabled: boolean): void {
  if (enabled) localStorage.setItem(ADVANCED_FIELDS_JSONFORMS_FALLBACK_STORAGE_KEY, '1');
  else localStorage.removeItem(ADVANCED_FIELDS_JSONFORMS_FALLBACK_STORAGE_KEY);
}

/**
 * Controlled wrapper feeding each `onChange` payload back into `currentData`, the way
 * the real host (AdvancedFieldsEditor's caller, backed by the geometry store)
 * re-renders with fresh element data after every edit. Without this, a *second*
 * interaction in the same test would still see the *original* `extra_json` --
 * DirectAdvancedFields (see SPIKE FINDING in the file banner) is fully controlled and
 * has no state of its own, unlike JsonForms's internal store (below).
 */
function ControlledHarness({
  useFHSSchema,
  initialExtraJson,
  onChange,
}: {
  useFHSSchema: boolean;
  initialExtraJson: Record<string, unknown>;
  onChange: (data: { type: string; extra_json: Record<string, unknown> }) => void;
}) {
  const [currentData, setCurrentData] = React.useState<{ type: string; extra_json: Record<string, unknown> }>({
    type: 'ElectricBattery',
    extra_json: initialExtraJson,
  });
  return (
    <AdvancedFieldsEditor
      elementType="ElectricBattery"
      currentData={currentData}
      onChange={(next) => {
        const record = next as { type: string; extra_json: Record<string, unknown> };
        onChange(record);
        setCurrentData(record);
      }}
      collapsible={false}
      useFHSSchema={useFHSSchema}
    />
  );
}

function renderEditor({
  useFHSSchema = false,
  extraJson = {},
  onChange = vi.fn(),
}: {
  useFHSSchema?: boolean;
  extraJson?: Record<string, unknown>;
  onChange?: ReturnType<typeof vi.fn>;
} = {}) {
  const store = createGeometryStore({ defaultDefaultsPath: null });
  const utils = render(
    <GeometryEditorServicePortsProvider
      schemaPort={canonicalGeometrySchemaPort}
      workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
    >
      <GeometryStoreProvider store={store}>
        <ControlledHarness useFHSSchema={useFHSSchema} initialExtraJson={extraJson} onChange={onChange} />
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
 * The visible label text for a row, excluding the StatusPill sibling that shares the
 * same header wrapper. DOM shape (see `renderAdvancedFieldRow` /
 * `renderAdvancedFieldLabelRow` in jsonformsRenderers.tsx):
 *   [data-field-key] > div (fullWidthHeader wrapper)
 *                        > div (ADVANCED_CTRL_LABEL_ROW)
 *                            > div (label content -- what we want)
 *                            > div (StatusPill)
 */
function fieldLabelText(row: HTMLElement): string {
  return row.children[0]?.children[0]?.children[0]?.textContent?.trim() ?? '';
}

function hasVisibleInlineError(container: HTMLElement): boolean {
  return Array.from(container.querySelectorAll('div')).some((el) => el.style.color === 'var(--error)');
}

describe('AdvancedFieldsEditor: ElectricBattery direct-render (R4.2 spike / R4.3 rollout)', () => {
  it('JsonForms-path characterization (fallback flag set): Core mode field set, base-field hiding, onChange wiring, and error presentation', async () => {
    setJsonformsFallbackFlag(true);
    const onChange = vi.fn();
    const { container } = renderEditor({ onChange, extraJson: {} });

    expect(container.querySelector('[data-testid="direct-advanced-fields"]')).toBeNull();

    const keys = fieldKeys(container);
    for (const key of CORE_ADVANCED_FIELD_KEYS) {
      expect(keys).toContain(key);
    }
    for (const key of CORE_BASE_FIELD_KEYS) {
      expect(keys).not.toContain(key);
    }

    // Empty-field error presentation: on mount, with every required field unset,
    // no control surfaces an error. NumberControl/TextControl never even destructure
    // the ControlProps `errors` field, and BooleanControl doesn't accept it at all --
    // only their own self-managed `localError` (set on change/blur) is ever shown.
    expect(hasVisibleInlineError(container)).toBe(false);

    // battery_age: typing a valid number fires onChange with extra_json.battery_age
    // as a NUMBER (coerced by useNumericDraftInput's commit, not by anything
    // JsonForms-specific). Debounced ~10ms by JsonFormsStateProvider -- see file banner.
    const batteryAgeInput = within(fieldRow(container, 'battery_age')).getByRole('textbox');
    fireEvent.change(batteryAgeInput, { target: { value: '5' } });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ extra_json: expect.objectContaining({ battery_age: 5 }) }),
      ),
    );

    // Invalid value (schema: battery_age minimum 0): typing "-5" is a syntactically
    // complete number so it commits, but validateAdvancedFieldPrimitive
    // (schemaPort-backed AJV validation) flags it and NumberControl shows its own
    // localError text. This is plain useState inside NumberControl -- NOT wired
    // through JsonForms' onChange/debounce at all -- so it's visible synchronously.
    fireEvent.change(batteryAgeInput, { target: { value: '-5' } });
    expect(hasVisibleInlineError(container)).toBe(true);

    // grid_charging_possible: toggling the checkbox fires onChange with the boolean.
    const gridCharging = within(fieldRow(container, 'grid_charging_possible')).getByRole('checkbox');
    fireEvent.click(gridCharging);
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ extra_json: expect.objectContaining({ grid_charging_possible: true }) }),
      ),
    );

    // Reset/unset payload shape: with no defaults configured, any field holding a
    // meaningful value shows a "Reset to default" button; clicking it calls
    // handleChange(path, undefined). Record what shape that leaves in extra_json.
    const resetButton = within(fieldRow(container, 'grid_charging_possible')).getByRole('button', {
      name: 'Reset to default',
    });
    fireEvent.click(resetButton);
    await waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(3));
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as { extra_json: Record<string, unknown> };
    // Reset/unset: JsonForms' own core reducer drops the key entirely (verified
    // empirically -- NOT left present-with-`undefined`, despite a plain object spread
    // ordinarily preserving `undefined`-valued keys; JsonForms' `Resolve`-based data
    // update evidently deletes rather than assigns `undefined`). This is the same
    // shape DirectAdvancedFields' own `handleChange` produces (explicit `delete`) --
    // see the "Unset parity" assertion in the parity test below.
    expect(Object.prototype.hasOwnProperty.call(lastCall.extra_json, 'grid_charging_possible')).toBe(false);
  });

  it('fallback flag set: direct-advanced-fields testid absent, JsonForms path renders', () => {
    setJsonformsFallbackFlag(true);
    const { container } = renderEditor({});
    expect(container.querySelector('[data-testid="direct-advanced-fields"]')).toBeNull();
    expect(fieldKeys(container)).toContain('battery_age');
  });

  it('parity direct-render vs JsonForms: same field set/labels, same onChange payloads for entry / toggle / unset', async () => {
    const sharedExtraJson = {
      battery_age: 5,
      grid_charging_possible: true,
      maximum_charge_rate_one_way_trip: 2,
      maximum_discharge_rate_one_way_trip: 2,
      minimum_charge_rate_one_way_trip: 1,
    };

    async function exercise(container: HTMLElement, onChange: ReturnType<typeof vi.fn>) {
      // Captured while mounted — the JsonForms container is emptied by unmount/cleanup
      // before the cross-path assertions run.
      const keys = fieldKeys(container);
      const labels = CORE_ADVANCED_FIELD_KEYS.map((key) => fieldLabelText(fieldRow(container, key))).sort();

      const batteryAgeInput = within(fieldRow(container, 'battery_age')).getByRole('textbox');
      fireEvent.change(batteryAgeInput, { target: { value: '9' } });
      await waitFor(() => expect(onChange).toHaveBeenCalled());
      const numberEntryCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];

      const gridCharging = within(fieldRow(container, 'grid_charging_possible')).getByRole('checkbox');
      fireEvent.click(gridCharging);
      await waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(2));
      const toggleCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];

      const resetButton = within(fieldRow(container, 'battery_age')).getByRole('button', {
        name: 'Reset to default',
      });
      fireEvent.click(resetButton);
      await waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(3));
      const unsetCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];

      return { keys, labels, numberEntryCall, toggleCall, unsetCall };
    }

    setJsonformsFallbackFlag(true);
    const offOnChange = vi.fn();
    const off = renderEditor({ onChange: offOnChange, extraJson: sharedExtraJson });
    const offResult = await exercise(off.container, offOnChange);
    off.unmount();
    cleanup();

    setJsonformsFallbackFlag(false);
    const onOnChange = vi.fn();
    const on = renderEditor({ onChange: onOnChange, extraJson: sharedExtraJson });
    expect(on.container.querySelector('[data-testid="direct-advanced-fields"]')).not.toBeNull();
    const onResult = await exercise(on.container, onOnChange);

    // Field set / label parity: DirectAdvancedFields' title-or-startCase label logic
    // matches what JsonForms' generated uischema + deriveLabel produce.
    expect(onResult.labels).toEqual(offResult.labels);

    // Ordering parity, UNSORTED: the direct walk must enumerate exactly the order
    // JsonForms' generated uischema does (Object.keys insertion order on the same
    // filtered properties object). Ordering is load-bearing (see the module comment)
    // and every other assertion in this file sorts or uses toContain — this is the
    // one that would catch a reordered walk.
    expect(onResult.keys.length).toBeGreaterThan(0);
    expect(onResult.keys).toEqual(offResult.keys);

    // Number entry parity: identical payload shape (both paths run the SAME NumberControl).
    expect(onResult.numberEntryCall).toEqual(offResult.numberEntryCall);

    // Boolean toggle parity: identical payload shape (both paths run the SAME BooleanControl).
    expect(onResult.toggleCall).toEqual(offResult.toggleCall);

    // Unset parity: both drop the key entirely (verified with hasOwnProperty, not
    // just toEqual, since toEqual alone would treat a present-but-undefined key the
    // same as an absent one and mask a real divergence -- see test 1's
    // characterization, which found the JsonForms path also deletes rather than
    // nulls it).
    expect(onResult.unsetCall).toEqual(offResult.unsetCall);
    const offHasKey = Object.prototype.hasOwnProperty.call(
      (offResult.unsetCall as { extra_json: Record<string, unknown> }).extra_json,
      'battery_age',
    );
    const onHasKey = Object.prototype.hasOwnProperty.call(
      (onResult.unsetCall as { extra_json: Record<string, unknown> }).extra_json,
      'battery_age',
    );
    expect(offHasKey).toBe(false);
    expect(onHasKey).toBe(false);
  });

  it('FHS mode, default (fallback flag unset): three rate fields render as number inputs with schema-derived min/exclusiveMinimum attributes', () => {
    // FHS battery fields have NO schema `title` (unlike Core), so this comparison is
    // the one place startCaseKey is exercised against JsonForms' own
    // lodash-startCase-derived labels — the Core parity test only ever hits the
    // title branch.
    setJsonformsFallbackFlag(true);
    const off = renderEditor({ useFHSSchema: true });
    const offKeys = fieldKeys(off.container);
    const offLabels = offKeys.map((key) => fieldLabelText(fieldRow(off.container, key)));
    off.unmount();
    cleanup();

    setJsonformsFallbackFlag(false);
    const { container } = renderEditor({ useFHSSchema: true });

    expect(container.querySelector('[data-testid="direct-advanced-fields"]')).not.toBeNull();
    expect(fieldKeys(container).sort()).toEqual([...FHS_ADVANCED_FIELD_KEYS].sort());

    // Unsorted key AND label parity against the JsonForms path (see ordering note in
    // the Core parity test).
    expect(fieldKeys(container)).toEqual(offKeys);
    expect(offKeys.map((key) => fieldLabelText(fieldRow(container, key)))).toEqual(offLabels);

    // minimum_charge_rate_one_way_trip: schema declares `minimum: 0` (not exclusive).
    const minInput = within(fieldRow(container, 'minimum_charge_rate_one_way_trip')).getByRole('textbox');
    expect(minInput).toHaveAttribute('min', '0');
    expect(minInput).not.toHaveAttribute('data-exclusive-minimum');

    // maximum_charge_rate_one_way_trip / maximum_discharge_rate_one_way_trip: schema
    // declares `exclusiveMinimum: 0` -- numericInputAttributesFromSchema falls back to
    // exclusiveMinimum for the HTML `min` attribute AND separately records the
    // exclusive constraint as a data attribute (HTML has no native exclusive-min).
    for (const key of ['maximum_charge_rate_one_way_trip', 'maximum_discharge_rate_one_way_trip']) {
      const input = within(fieldRow(container, key)).getByRole('textbox');
      expect(input).toHaveAttribute('min', '0');
      expect(input).toHaveAttribute('data-exclusive-minimum', '0');
    }
  });

  describe('$ref probe: cross-path component parity (R4.3 executed-table amendment)', () => {
    it('DirectAdvancedFields resolves battery_location $ref to an inside/outside dropdown via TextControl, emitting an uncoerced string', () => {
      const unfiltered = canonicalGeometrySchemaPort.getElementSubschema('core', 'ElectricBattery') as Record<
        string,
        unknown
      >;
      const properties = unfiltered.properties as Record<string, { $ref?: string }>;
      expect(properties.battery_location.$ref).toBe('#/$defs/BatteryLocation');

      const rootSchema = canonicalGeometrySchemaPort.getRootSchema('core') as Record<string, unknown>;
      const onDataChange = vi.fn();
      const store = createGeometryStore({ defaultDefaultsPath: null });
      const { container } = render(
        <GeometryEditorServicePortsProvider
          schemaPort={canonicalGeometrySchemaPort}
          workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
        >
          <GeometryStoreProvider store={store}>
            <DirectAdvancedFields
              schema={unfiltered}
              data={{}}
              config={{
                advancedEditor: true,
                elementType: 'ElectricBattery',
                schemaPort: canonicalGeometrySchemaPort,
                $defs: rootSchema.$defs,
              }}
              onDataChange={onDataChange}
            />
          </GeometryStoreProvider>
        </GeometryEditorServicePortsProvider>,
      );

      // R4.3 amendment: pickDirectControl is now an EXECUTED-table port (see the
      // DirectAdvancedFields.tsx docstring) -- the resolved battery_location schema
      // has `type: 'string'` (BatteryLocation's own declared type, dereferenced), so
      // rule (c) routes it to TextControl, EVEN THOUGH the resolved schema also
      // carries `.enum`. This dropdown is therefore TextControl's OWN `extractOptions`
      // fallback (`<StandardDropdown>`), not EnumControl -- the exact same component
      // and code path the OFF (JsonForms) test below exercises, verified next.
      const select = within(fieldRow(container, 'battery_location')).getByRole('combobox');
      const optionValues = Array.from(select.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
      expect(optionValues).toEqual(expect.arrayContaining(['inside', 'outside']));

      fireEvent.change(select, { target: { value: 'outside' } });
      expect(onDataChange).toHaveBeenCalledWith({ battery_location: 'outside' });
    });

    it('raw JsonForms renders the same $ref property via the identical TextControl enum fallback -- cross-path component parity is exact', async () => {
      const unfiltered = canonicalGeometrySchemaPort.getElementSubschema('core', 'ElectricBattery') as Record<
        string,
        unknown
      >;
      const rootSchema = canonicalGeometrySchemaPort.getRootSchema('core') as Record<string, unknown>;
      const onChange = vi.fn();
      const store = createGeometryStore({ defaultDefaultsPath: null });

      const { container } = render(
        <GeometryEditorServicePortsProvider
          schemaPort={canonicalGeometrySchemaPort}
          workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
        >
          <GeometryStoreProvider store={store}>
            <JsonForms
              schema={unfiltered as never}
              data={{}}
              renderers={[...standardRenderers, ...materialRenderers]}
              ajv={getAjvInstance()}
              config={{
                advancedEditor: true,
                elementType: 'ElectricBattery',
                schemaPort: canonicalGeometrySchemaPort,
                $defs: rootSchema.$defs,
              }}
              onChange={({ data }) => onChange(data)}
            />
          </GeometryStoreProvider>
        </GeometryEditorServicePortsProvider>,
      );

      // SPIKE FINDING (probe 5b -- verified empirically by evaluating every
      // standardRenderers/materialRenderers tester against the real
      // uischema/schema/context for this control), now the DESIGN R4.3's
      // executed-table `pickDirectControl` deliberately reproduces:
      //
      // JsonForms' renderer-registry DISPATCH passes each Control's TESTER the
      // *unresolved* parent object schema (jsonforms-react's
      // `mapStateToJsonFormsRendererProps`: `schema: ownProps.schema || getSchema(state)`,
      // passed unchanged to every child via `renderLayoutElements`). Confirmed:
      // `schema.enum === undefined`, `schema.type === 'object'` at the point our
      // testers run for `battery_location`. Our own rank-1000/1100 EnumControl
      // testers (`schemaHasEnum`/`schemaHasConstAlternatives`) read `.enum` directly
      // off THAT schema and so never see the enum hidden behind the `$ref` -- they
      // never match (verified: rank -1 for both).
      //
      // The tester that actually wins is our OWN rank-80 TextControl entry
      // (`isStringControl(u,s,c) && !schemaHasEnum(rawParentSchema)`): `isStringControl`
      // is `@jsonforms/core`'s own tester, which DOES resolve $ref internally via
      // `schemaMatches` -> `resolveSchema` (true, since BatteryLocation.type ===
      // 'string'), and the `!schemaHasEnum(rawParentSchema)` gate is trivially true
      // (the *parent* object has no top-level `enum`). Material's own
      // `materialEnumControlTester` (`isEnumControl`, which ALSO correctly resolves
      // $ref) only ranks 2 -- far below our rank-80 TextControl -- so it never gets a
      // chance. Verified via direct rank evaluation: standardRenderers TextControl
      // (rank 80) wins; materialEnumControlTester scores rank 2.
      //
      // BUT: once TextControl is the winning renderer, `withJsonFormsControlProps`'
      // OWN `mapStateToControlProps` does its own, SEPARATE resolution
      // (`Resolve.schema(ownProps.schema, controlElement.scope, rootSchema)`) before
      // handing TextControl its props -- so TextControl's `schema` PROP (unlike what
      // its tester saw) IS the resolved `{enum: ['inside','outside'], type: 'string',
      // ...}`. TextControl has its own dropdown fallback (`extractOptions(s)`, checked
      // before its plain-input branch) that renders `<StandardDropdown>` whenever the
      // schema it receives carries `.enum`/oneOf-const alternatives -- the exact same
      // underlying component EnumControl uses, hence the identical CSS classes.
      //
      // R4.3 (this test's whole point, updated from the R4.2 spike's "accidental
      // parity" framing): DirectAdvancedFields' `pickDirectControl` now checks the
      // resolved property's type list BEFORE checking enum-ness (rule (c): 'string' ->
      // TextControl, unconditionally) -- so for battery_location it ALSO lands on
      // TextControl, the exact same component, exercising the exact same
      // `extractOptions` dropdown fallback as this JsonForms mount. The parity is no
      // longer accidental cross-component convergence; it is the SAME component on
      // both paths, by explicit design (see the "executed-table port" docstring on
      // `pickDirectControl` in DirectAdvancedFields.tsx). EnumControl is never reached
      // for this property on EITHER path.
      const row = fieldRow(container, 'battery_location');
      const select = within(row).getByRole('combobox');
      expect(select.tagName).toBe('SELECT');
      const optionValues = Array.from(select.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
      expect(optionValues).toEqual(expect.arrayContaining(['inside', 'outside']));

      // Same ~10ms debounce as every other raw-<JsonForms> onChange in this file
      // (JsonFormsStateProvider's debouncedEmit) -- see file banner.
      fireEvent.change(select, { target: { value: 'outside' } });
      await waitFor(() =>
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ battery_location: 'outside' })),
      );
    });
  });
});
