// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * R4.2/R4.3/R4.4 characterization: ElectricBattery Advanced Fields via
 * DirectAdvancedFields, the only render path since R4.4 retired the legacy JsonForms
 * mount and its fallback flag (formerly `vulcan:advanced-fields-jsonforms-fallback`,
 * `lib/directRenderAdvancedFieldsFlag.ts`, now deleted). Harness combines the
 * schema-loading pattern from `lib/__tests__/modelAuthoringFieldAudit.test.ts` with the
 * control-mounting pattern from `jsonformsRenderers.units.test.tsx`.
 *
 * The `$ref probe` describe block below is the one place this file still mounts raw
 * `<JsonForms>` directly (not through AdvancedFieldsEditor, which no longer offers
 * that path) -- it documents behaviour web/'s SnippetEditor and SimplifiedFabricEditor
 * still depend on via the shared `jsonformsRenderers.tsx` registry until R4.5.
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
 * Controlled wrapper feeding each `onChange` payload back into `currentData`, the way
 * the real host (AdvancedFieldsEditor's caller, backed by the geometry store)
 * re-renders with fresh element data after every edit. Without this, a *second*
 * interaction in the same test would still see the *original* `extra_json` --
 * DirectAdvancedFields is fully controlled and has no state of its own.
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

describe('AdvancedFieldsEditor: ElectricBattery direct-render (R4.2 spike / R4.3 rollout / R4.4 sole path)', () => {
  it('direct-render characterization: Core mode field set, base-field hiding, onChange wiring, and error presentation', async () => {
    const onChange = vi.fn();
    const { container } = renderEditor({ onChange, extraJson: {} });

    expect(container.querySelector('[data-testid="direct-advanced-fields"]')).not.toBeNull();

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
    // as a NUMBER (coerced by useNumericDraftInput's commit). DirectAdvancedFields'
    // handleChange -> onDataChange -> handleJsonFormsChange -> onChange all run
    // synchronously inside the same event; `waitFor` below is kept for harness
    // consistency, not because it's needed.
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
    // localError text -- plain useState inside NumberControl, visible synchronously.
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
    // handleChange(path, undefined). Record what shape that leaves in extra_json --
    // the key is dropped entirely (explicit `delete`), not left present-with-`undefined`.
    const resetButton = within(fieldRow(container, 'grid_charging_possible')).getByRole('button', {
      name: 'Reset to default',
    });
    fireEvent.click(resetButton);
    await waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(3));
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as { extra_json: Record<string, unknown> };
    expect(Object.prototype.hasOwnProperty.call(lastCall.extra_json, 'grid_charging_possible')).toBe(false);
  });

  it('renders the direct wrapper by default', () => {
    const { container } = renderEditor({});
    expect(container.querySelector('[data-testid="direct-advanced-fields"]')).not.toBeNull();
    expect(fieldKeys(container)).toContain('battery_age');
  });

  it('direct-render characterization: field set/labels + onChange payloads for entry / toggle / unset', async () => {
    const sharedExtraJson = {
      battery_age: 5,
      grid_charging_possible: true,
      maximum_charge_rate_one_way_trip: 2,
      maximum_discharge_rate_one_way_trip: 2,
      minimum_charge_rate_one_way_trip: 1,
    };

    const onChange = vi.fn();
    const { container } = renderEditor({ onChange, extraJson: sharedExtraJson });
    expect(container.querySelector('[data-testid="direct-advanced-fields"]')).not.toBeNull();

    // Field set / label / ordering characterization, captured verbatim from the last
    // A/B GREEN run (before R4.4 deleted the JsonForms comparator). Ordering is
    // load-bearing (see the project convention noted throughout this file).
    expect(fieldKeys(container)).toEqual(CORE_ADVANCED_FIELD_KEYS);
    expect(CORE_ADVANCED_FIELD_KEYS.map((key) => fieldLabelText(fieldRow(container, key)))).toEqual([
      'Battery Age',
      'Grid Charging Possible',
      'Maximum Charge Rate One Way Trip',
      'Maximum Discharge Rate One Way Trip',
      'Minimum Charge Rate One Way Trip',
    ]);

    const batteryAgeInput = within(fieldRow(container, 'battery_age')).getByRole('textbox');
    fireEvent.change(batteryAgeInput, { target: { value: '9' } });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        type: 'ElectricBattery',
        extra_json: {
          battery_age: 9,
          grid_charging_possible: true,
          maximum_charge_rate_one_way_trip: 2,
          maximum_discharge_rate_one_way_trip: 2,
          minimum_charge_rate_one_way_trip: 1,
        },
      }),
    );

    const gridCharging = within(fieldRow(container, 'grid_charging_possible')).getByRole('checkbox');
    fireEvent.click(gridCharging);
    await waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0]).toEqual({
      type: 'ElectricBattery',
      extra_json: {
        battery_age: 9,
        grid_charging_possible: false,
        maximum_charge_rate_one_way_trip: 2,
        maximum_discharge_rate_one_way_trip: 2,
        minimum_charge_rate_one_way_trip: 1,
      },
    });

    const resetButton = within(fieldRow(container, 'battery_age')).getByRole('button', {
      name: 'Reset to default',
    });
    fireEvent.click(resetButton);
    await waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(3));
    const unsetCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as {
      extra_json: Record<string, unknown>;
    };
    // Unset: the key is dropped entirely (verified with hasOwnProperty, not just
    // toEqual, since toEqual alone would treat a present-but-undefined key the same
    // as an absent one and mask a real regression).
    expect(unsetCall).toEqual({
      type: 'ElectricBattery',
      extra_json: {
        grid_charging_possible: false,
        maximum_charge_rate_one_way_trip: 2,
        maximum_discharge_rate_one_way_trip: 2,
        minimum_charge_rate_one_way_trip: 1,
      },
    });
    expect(Object.prototype.hasOwnProperty.call(unsetCall.extra_json, 'battery_age')).toBe(false);
  });

  it('FHS mode: three rate fields render as number inputs with schema-derived min/exclusiveMinimum attributes', () => {
    // FHS battery fields have NO schema `title` (unlike Core), so this is the one
    // place startCaseKey's own label derivation is exercised, rather than the
    // schema-`title` branch the Core test above hits.
    const { container } = renderEditor({ useFHSSchema: true });

    expect(container.querySelector('[data-testid="direct-advanced-fields"]')).not.toBeNull();
    expect(fieldKeys(container).sort()).toEqual([...FHS_ADVANCED_FIELD_KEYS].sort());

    // Ordering + label characterization, captured verbatim from the last A/B GREEN
    // run (see ordering note in the test above).
    const orderedKeys = [
      'minimum_charge_rate_one_way_trip',
      'maximum_charge_rate_one_way_trip',
      'maximum_discharge_rate_one_way_trip',
    ];
    expect(fieldKeys(container)).toEqual(orderedKeys);
    expect(orderedKeys.map((key) => fieldLabelText(fieldRow(container, key)))).toEqual([
      'Minimum Charge Rate One Way Trip',
      'Maximum Charge Rate One Way Trip',
      'Maximum Discharge Rate One Way Trip',
    ]);

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

  describe('$ref probe: DirectAdvancedFields vs the shared JsonForms registry (web/ still depends on the registry until R4.5)', () => {
    it('DirectAdvancedFields resolves battery_location $ref to an inside/outside dropdown via EnumControl (R4.3b), emitting a coerced string', () => {
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

      // R4.3b CHARACTERIZATION CHANGE (was TextControl through R4.3, see below):
      // `pickDirectControl`'s enum-first dispatch (DirectAdvancedFields.tsx) now
      // checks enum-like BEFORE type -- the resolved battery_location schema carries
      // `.enum` (`['inside', 'outside']`, BatteryLocation's own declared shape,
      // dereferenced), so it now routes to EnumControl outright, ahead of its also-true
      // `type: 'string'` match. Same combobox, same options, SAME emitted value
      // ('outside', a string): EnumControl's `coerceDropdownValue` coerces by the
      // enum's inferred value type, which is 'string' here (every enum member is a
      // string) -- so this assertion is unchanged even though the CONTROL behind it
      // changed. (Through R4.3, rule (c) routed this to TextControl instead, EVEN
      // THOUGH the resolved schema also carried `.enum` -- that dropdown was
      // TextControl's OWN `extractOptions` fallback, the exact same underlying
      // `<StandardDropdown>` component the raw JsonForms registry test below still
      // exercises via ITS OWN TextControl-wins dispatch quirk, verified next -- these
      // two tests intentionally diverge now: this one shows the direct path's new
      // enum-first behaviour, the other documents the registry's unchanged one.)
      const select = within(fieldRow(container, 'battery_location')).getByRole('combobox');
      const optionValues = Array.from(select.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
      expect(optionValues).toEqual(expect.arrayContaining(['inside', 'outside']));

      fireEvent.change(select, { target: { value: 'outside' } });
      expect(onDataChange).toHaveBeenCalledWith({ battery_location: 'outside' });
    });

    it('raw JsonForms registry mount renders the same $ref property via the identical TextControl enum fallback -- documents behaviour web/\'s SnippetEditor/SimplifiedFabricEditor still depend on until R4.5', async () => {
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
      // uischema/schema/context for this control), which R4.3's executed-table
      // `pickDirectControl` deliberately reproduces (see the test above):
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
      // This is why DirectAdvancedFields' `pickDirectControl` checks the resolved
      // property's type list BEFORE checking enum-ness (rule (c): 'string' ->
      // TextControl, unconditionally): so for battery_location it ALSO lands on
      // TextControl, the exact same component, exercising the exact same
      // `extractOptions` dropdown fallback this raw JsonForms registry mount does.
      // web/'s SnippetEditor and SimplifiedFabricEditor still mount this same
      // `standardRenderers`/`materialRenderers` registry through their own
      // `<JsonForms>` usage (see `jsonformsRenderers.tsx`) -- this test is the
      // community-side guarantee that the registry keeps behaving this way until
      // R4.5 migrates them too.
      const row = fieldRow(container, 'battery_location');
      const select = within(row).getByRole('combobox');
      expect(select.tagName).toBe('SELECT');
      const optionValues = Array.from(select.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
      expect(optionValues).toEqual(expect.arrayContaining(['inside', 'outside']));

      // ~10ms debounce: `@jsonforms/react`'s `JsonFormsStateProvider` emits the
      // `<JsonForms onChange>` callback through `debounce(..., 10)` (see
      // node_modules/@jsonforms/react .../jsonforms-react.esm.js, `debouncedEmit`).
      fireEvent.change(select, { target: { value: 'outside' } });
      await waitFor(() =>
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ battery_location: 'outside' })),
      );
    });
  });
});
