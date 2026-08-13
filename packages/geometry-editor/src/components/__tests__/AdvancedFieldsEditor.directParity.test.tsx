// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * R4.3: parameterized parity matrix, DirectAdvancedFields (ON, default) vs. JsonForms
 * (OFF, fallback flag) across every element type family in Advanced Fields, not just
 * ElectricBattery (see `AdvancedFieldsEditor.electricBattery.test.tsx` for the
 * detailed single-type characterization this generalizes from).
 *
 * DESIGN AMENDMENT (Baz-approved, post-review): this slice must not change ANY form's
 * resulting UI. `DirectAdvancedFields.tsx`'s `pickDirectControl` was rewritten from a
 * "written tester table" port to an "executed tester table" port specifically so that
 * every field renders the SAME control component on both paths (see that file's
 * docstring for the full executed-vs-written analysis). There are therefore no
 * "signed-off divergence" assertions in this file — every assertion below is a
 * straight equality. If a genuine, untraceable DOM difference is ever found, it is a
 * real finding to report, not something to paper over with an inverted assertion.
 *
 * Every configuration below asserts, in order:
 *  (a) unsorted field-key set equality (`fieldKeys`, sorted only for the SET
 *      comparison — order itself is asserted unsorted separately where called out,
 *      per the "ordering is load-bearing" project note).
 *  (b) unsorted label-set equality (`fieldLabelText`).
 *  (c) per-field input-signature equality (`inputSignatureForRow`: select /
 *      checkbox / textbox+min/data-exclusive-minimum) — a quick, readable diagnostic.
 *  (d) per-field row-level DOM equality (`normalizedRowHtml`), id/for/aria-describedby
 *      normalized away (both paths mint different React-generated ids for the same
 *      control) — the actual "resulting UI is unchanged" evidence. This subsumes (c)
 *      but (c) is kept for a clearer first failure message.
 * The OUTER wrapper (JsonForms' MUI Grid vs DirectAdvancedFields' plain divs) is
 * deliberately NOT compared — only `[data-field-key]` rows and inward, which is what
 * `renderAdvancedFieldRow` builds identically regardless of what wraps it.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// Raw JsonForms import — allowed HERE ONLY, for the const-only-skip comparison mount
// below (matches the pattern in AdvancedFieldsEditor.electricBattery.test.tsx's own
// $ref probe). No other file in this test suite imports @jsonforms/*.
import { JsonForms } from '@jsonforms/react';
import { materialRenderers } from '@jsonforms/material-renderers';
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
import { AdvancedFieldsEditor } from '../AdvancedFieldsEditor';
import { DirectAdvancedFields } from '../DirectAdvancedFields';
import { standardRenderers } from '../jsonformsRenderers';
import { getAjvInstance } from '../../lib/ajvCache';
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

function setJsonformsFallbackFlag(enabled: boolean): void {
  if (enabled) localStorage.setItem(ADVANCED_FIELDS_JSONFORMS_FALLBACK_STORAGE_KEY, '1');
  else localStorage.removeItem(ADVANCED_FIELDS_JSONFORMS_FALLBACK_STORAGE_KEY);
}

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

/**
 * Row DOM, normalized for the id/for/aria-describedby churn that comes from
 * React-generated ids (`useId`) differing between the two mount trees -- these are
 * wiring, not UI. Everything else (tag names, classes, inline styles, text content,
 * option lists, attribute values) is compared verbatim.
 */
function normalizedRowHtml(row: HTMLElement): string {
  return row.outerHTML
    .replace(/\bid="[^"]*"/g, 'id="X"')
    .replace(/\bfor="[^"]*"/g, 'for="X"')
    .replace(/\baria-describedby="[^"]*"/g, 'aria-describedby="X"');
}

/**
 * Mounts OFF (fallback flag set) then ON (unset) for the same configuration and
 * asserts field-set / label-set / per-row parity. Returns the still-mounted ON
 * `container` plus both key lists so callers can layer config-specific assertions
 * (interaction payloads, ordering, label-prefix content, …) on top without a third
 * mount. The OFF container is unmounted internally, its snapshot already captured.
 *
 * Rows are paired by DOM ORDER (index), not by re-querying `data-field-key` -- that
 * attribute is the LEAF property key only (`renderAdvancedFieldRow`'s `propKey`,
 * shared verbatim by both paths), so a System layout with the same leaf name nested
 * under two different plants (e.g. two plants each hoisting a `HeatSource.name`
 * control) produces two rows with an IDENTICAL `data-field-key` -- a lookup-by-key
 * would silently re-compare the first occurrence twice and never validate the
 * second. Index-based pairing sidesteps that entirely and, as a side effect, IS the
 * ordering assertion: it only passes if both walks enumerate fields in the same
 * unsorted sequence (load-bearing per project convention -- ordering drift is the one
 * bug class that has survived review in this area before).
 */
async function assertGenericParity(args: MountArgs): Promise<{ container: HTMLElement; offKeys: string[]; onKeys: string[] }> {
  setJsonformsFallbackFlag(true);
  const off = renderEditor({ ...args, onChange: vi.fn() });
  const offRowEls = Array.from(off.container.querySelectorAll<HTMLElement>('[data-field-key]'));
  const offKeys = offRowEls.map((el) => el.getAttribute('data-field-key') as string);
  const offLabels = offRowEls.map((el) => fieldLabelText(el)).sort();
  const offSignatures = offRowEls.map((el) => inputSignatureForRow(el));
  const offRowHtml = offRowEls.map((el) => normalizedRowHtml(el));
  off.unmount();
  cleanup();

  setJsonformsFallbackFlag(false);
  const on = renderEditor({ ...args, onChange: vi.fn() });
  // AdvancedFieldsEditor has its OWN early return (`if (!hasAdvancedFields) return
  // null`) before the JsonForms/DirectAdvancedFields branch is ever reached -- when a
  // configuration's advancedProperties end up empty (e.g. every schema property is
  // filtered out as a base field), NEITHER path mounts a container at all. Only
  // require the direct-render testid when there is at least one field to show; the
  // "both sides render nothing" case is asserted by the empty-keys checks below
  // instead (see configs 8/9, which exercise this deliberately).
  if (offKeys.length > 0) {
    expect(on.container.querySelector('[data-testid="direct-advanced-fields"]')).not.toBeNull();
  }
  const onRowEls = Array.from(on.container.querySelectorAll<HTMLElement>('[data-field-key]'));
  const onKeys = onRowEls.map((el) => el.getAttribute('data-field-key') as string);
  const onLabels = onRowEls.map((el) => fieldLabelText(el)).sort();

  // Ordering parity, UNSORTED: both walks must enumerate the SAME keys in the SAME
  // sequence, not just the same set.
  expect(onKeys).toEqual(offKeys);
  expect(onLabels).toEqual(offLabels);
  expect(onRowEls.length).toEqual(offRowEls.length);

  for (let i = 0; i < offRowEls.length; i += 1) {
    expect(inputSignatureForRow(onRowEls[i])).toEqual(offSignatures[i]);
    expect(normalizedRowHtml(onRowEls[i])).toEqual(offRowHtml[i]);
  }

  return { container: on.container, offKeys, onKeys };
}

describe('AdvancedFieldsEditor: direct-render parity matrix (R4.3)', () => {
  it('config 1 -- ElectricBattery, Core and FHS (regression anchor)', async () => {
    await assertGenericParity({
      elementType: 'ElectricBattery',
      useFHSSchema: false,
      extraJson: {
        battery_age: 5,
        grid_charging_possible: true,
        maximum_charge_rate_one_way_trip: 2,
        maximum_discharge_rate_one_way_trip: 2,
        minimum_charge_rate_one_way_trip: 1,
      },
    });
    cleanup();
    await assertGenericParity({
      elementType: 'ElectricBattery',
      useFHSSchema: true,
      extraJson: {
        maximum_charge_rate_one_way_trip: 2,
        maximum_discharge_rate_one_way_trip: 2,
        minimum_charge_rate_one_way_trip: 1,
      },
    });
  });

  it('config 2 -- BuildingElementOpaque, wall, Core and FHS + interaction parity (number-entry / unset)', async () => {
    const coreExtraJson = {
      u_value: 1.2,
      areal_heat_capacity: 100000,
      mass_distribution_class: 'I',
      solar_absorption_coeff: 0.6,
      is_unheated_pitched_roof: false,
    };
    await assertGenericParity({
      elementType: 'BuildingElementOpaque',
      subtype: 'wall',
      useFHSSchema: false,
      extraJson: coreExtraJson,
    });
    cleanup();

    // Interaction parity (brief: "one number-entry + one unset each on configs 2 and
    // 5"). solar_absorption_coeff is a plain `{type:'number'}` field in Core -- a
    // genuine NumberControl on both paths (not one of the anyOf-nullable/$ref-enum
    // fields already exercised by the generic row check above).
    async function exerciseNumberEntryAndUnset(container: HTMLElement, onChange: ReturnType<typeof vi.fn>) {
      const input = within(fieldRow(container, 'solar_absorption_coeff')).getByRole('textbox');
      fireEvent.change(input, { target: { value: '0.4' } });
      await waitFor(() => expect(onChange).toHaveBeenCalled());
      const numberEntryCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];

      const resetButton = within(fieldRow(container, 'solar_absorption_coeff')).getByRole('button', {
        name: 'Reset to default',
      });
      fireEvent.click(resetButton);
      await waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(2));
      const unsetCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      return { numberEntryCall, unsetCall };
    }

    setJsonformsFallbackFlag(true);
    const offOnChange = vi.fn();
    const off = renderEditor({
      elementType: 'BuildingElementOpaque',
      subtype: 'wall',
      useFHSSchema: false,
      extraJson: coreExtraJson,
      onChange: offOnChange,
    });
    const offResult = await exerciseNumberEntryAndUnset(off.container, offOnChange);
    off.unmount();
    cleanup();

    setJsonformsFallbackFlag(false);
    const onOnChange = vi.fn();
    const on = renderEditor({
      elementType: 'BuildingElementOpaque',
      subtype: 'wall',
      useFHSSchema: false,
      extraJson: coreExtraJson,
      onChange: onOnChange,
    });
    const onResult = await exerciseNumberEntryAndUnset(on.container, onOnChange);

    expect(onResult.numberEntryCall).toEqual(offResult.numberEntryCall);
    expect(onResult.unsetCall).toEqual(offResult.unsetCall);
    const offHasKey = Object.prototype.hasOwnProperty.call(
      (offResult.unsetCall as { extra_json: Record<string, unknown> }).extra_json,
      'solar_absorption_coeff',
    );
    const onHasKey = Object.prototype.hasOwnProperty.call(
      (onResult.unsetCall as { extra_json: Record<string, unknown> }).extra_json,
      'solar_absorption_coeff',
    );
    expect(offHasKey).toBe(false);
    expect(onHasKey).toBe(false);
    cleanup();

    await assertGenericParity({
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
    });
  });

  it('config 3 -- BuildingElementTransparent, FHS: window_part_list + security_risk render identically on both paths', async () => {
    const { container } = await assertGenericParity({
      elementType: 'BuildingElementTransparent',
      useFHSSchema: true,
      extraJson: {
        frame_area_fraction: 0.3,
        g_value: 0.5,
        free_area_height: 0.5,
        mid_height: 1.2,
        max_window_open_area: 0.5,
        security_risk: false,
        window_part_list: [{ mid_height_air_flow_path: 1.5 }],
      },
    });

    // window_part_list: the generic row-DOM check above already proved OFF and ON
    // render byte-identical rows; this is an explicit, readable marker that the
    // control which rendered is WindowPartListControl (a composite row, not a
    // select/checkbox/plain textbox) on the (default, direct-render) path.
    const row = fieldRow(container, 'window_part_list');
    expect(row.querySelector('select')).toBeNull();
    expect(row.querySelector('input[type="checkbox"]')).toBeNull();

    // security_risk: with the R4.3 executed-table pickDirectControl, this is a plain
    // checkbox on BOTH paths (BooleanControl wins on type before enum is ever
    // consulted) -- no divergence, unlike the R4.2 spike's original expectation.
    const securityRow = fieldRow(container, 'security_risk');
    expect(securityRow.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(securityRow.querySelector('select')).toBeNull();
  });

  it('config 4 -- BuildingElementGround, Suspended_floor, FHS: shield_fact_location dropdown + area_per_perimeter_vent render identically on both paths', async () => {
    const { container } = await assertGenericParity({
      elementType: 'BuildingElementGround',
      subtype: 'Suspended_floor',
      useFHSSchema: true,
      extraJson: {
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
      },
    });

    // shield_fact_location: inlined as a plain string enum with WIND_SHIELD_LOCATION_ENUM
    // by AdvancedFieldsEditor's own subschema memo (unconditional on ON/OFF) -- a
    // dropdown on both paths regardless of pickDirectControl's table, since the
    // resolved schema is `{type:'string', enum:[...]}` -> rule (c) TextControl on ON,
    // and OFF's built-in isStringControl resolves the same plain string type -> rank-80
    // TextControl -- SAME component, dropdown via its own enum fallback, both sides.
    const shieldRow = fieldRow(container, 'shield_fact_location');
    expect(shieldRow.querySelector('select')).not.toBeNull();

    // area_per_perimeter_vent: plain `{type:'number'}` in FHS (verified directly,
    // not anyOf-nullable as the R4.2 spike's docstring assumed) -- NumberControl on
    // both paths already, confirmed by the generic row-DOM check above.
    const ventRow = fieldRow(container, 'area_per_perimeter_vent');
    expect(ventRow.querySelector('select')).toBeNull();
    expect(ventRow.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('config 5 -- MechanicalVentilation, MVHR, FHS: measured + sfp fan modes, + interaction parity (number-entry / unset)', async () => {
    const measuredExtraJson = {
      EnergySupply: 'mains elec',
      design_outdoor_air_flow_rate: 120,
      mvhr_eff: 0.91,
      mvhr_location: 'inside',
      measured_fan_power: 44.16,
      measured_air_flow_rate: 120,
    };
    await assertGenericParity({
      elementType: 'MechanicalVentilation',
      useFHSSchema: true,
      currentDataExtra: { vent_type: 'MVHR' },
      extraJson: { vent_type: 'MVHR', ...measuredExtraJson },
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
    await assertGenericParity({
      elementType: 'MechanicalVentilation',
      useFHSSchema: true,
      currentDataExtra: { vent_type: 'MVHR' },
      extraJson: { vent_type: 'MVHR', ...sfpExtraJson },
    });
    cleanup();

    // Interaction parity: design_outdoor_air_flow_rate is present regardless of fan
    // mode (a plain exclusiveMinimum-0 NumberControl) -- number-entry + unset there.
    async function exerciseNumberEntryAndUnset(container: HTMLElement, onChange: ReturnType<typeof vi.fn>) {
      const input = within(fieldRow(container, 'design_outdoor_air_flow_rate')).getByRole('textbox');
      fireEvent.change(input, { target: { value: '150' } });
      await waitFor(() => expect(onChange).toHaveBeenCalled());
      const numberEntryCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];

      const resetButton = within(fieldRow(container, 'design_outdoor_air_flow_rate')).getByRole('button', {
        name: 'Reset to default',
      });
      fireEvent.click(resetButton);
      await waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(2));
      const unsetCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      return { numberEntryCall, unsetCall };
    }

    setJsonformsFallbackFlag(true);
    const offOnChange = vi.fn();
    const off = renderEditor({
      elementType: 'MechanicalVentilation',
      useFHSSchema: true,
      currentDataExtra: { vent_type: 'MVHR' },
      extraJson: { vent_type: 'MVHR', ...measuredExtraJson },
      onChange: offOnChange,
    });
    const offResult = await exerciseNumberEntryAndUnset(off.container, offOnChange);
    off.unmount();
    cleanup();

    setJsonformsFallbackFlag(false);
    const onOnChange = vi.fn();
    const on = renderEditor({
      elementType: 'MechanicalVentilation',
      useFHSSchema: true,
      currentDataExtra: { vent_type: 'MVHR' },
      extraJson: { vent_type: 'MVHR', ...measuredExtraJson },
      onChange: onOnChange,
    });
    const onResult = await exerciseNumberEntryAndUnset(on.container, onOnChange);

    expect(onResult.numberEntryCall).toEqual(offResult.numberEntryCall);
    expect(onResult.unsetCall).toEqual(offResult.unsetCall);
  });

  it('MechanicalVentilation, non-MVHR: position_exhaust nested-object blob (Stage 2.4 characterization, adjacent to config 5)', async () => {
    // Stage 2.4 CHARACTERIZATION (see DirectAdvancedFields.tsx module docstring): a
    // nested object-typed property gets ONE flat Control bound to the whole object on
    // the OFF path (the generator does not recurse past the schema root), which falls
    // through every typed tester to GenericControl's TextControl default ->
    // JSON.stringify blob. DirectAdvancedFields needs NO special-case code for this --
    // pickDirectControl already defaults to 'text' for an object-typed resolved
    // schema. Confirmed here end-to-end through the real AdvancedFieldsEditor mount
    // (not just the isolated DirectAdvancedFields probe used during development).
    // config 5's matrix entry is MVHR specifically (per the brief), which EXCLUDES
    // position-object mode entirely (`shouldRenderMechanicalVentilationPositionMode`
    // is false whenever vent_type === 'MVHR') -- 'Intermittent MEV' is required to
    // reach it.
    const { container } = await assertGenericParity({
      elementType: 'MechanicalVentilation',
      useFHSSchema: true,
      currentDataExtra: { vent_type: 'Intermittent MEV' },
      extraJson: {
        vent_type: 'Intermittent MEV',
        EnergySupply: 'mains elec',
        design_outdoor_air_flow_rate: 30,
        position_exhaust: { mid_height_air_flow_path: 2.4, orientation360: 270, pitch: 90 },
      },
    });
    const row = fieldRow(container, 'position_exhaust');
    const input = within(row).getByRole('textbox');
    expect((input as HTMLInputElement).value).toBe(
      JSON.stringify({ mid_height_air_flow_path: 2.4, orientation360: 270, pitch: 90 }),
    );
  });

  it('config 6 -- WetEmitter, radiator, FHS: per_metre and lumped thermal-mode pruning render identically on both paths', async () => {
    await assertGenericParity({
      elementType: 'WetEmitter',
      subtype: 'radiator',
      useFHSSchema: true,
      extraJson: { frac_convective: 0.4, n: 1.2, c_per_m: 0.0112, length: 1.44, thermal_mass_per_m: 0.019 },
    });
    cleanup();

    await assertGenericParity({
      elementType: 'WetEmitter',
      subtype: 'radiator',
      useFHSSchema: true,
      extraJson: { frac_convective: 0.4, n: 1.2, c: 0.08, thermal_mass: 5 },
    });
  });

  it('config 7 -- Lighting (simple flat) -- CHARACTERIZATION: no Advanced Fields UI exists in either schema mode', async () => {
    // CHARACTERIZATION FINDING, not the brief's original expectation: Lighting has NO
    // Advanced Fields UI at all, in EITHER mode. Core has no dedicated Lighting
    // subschema (`getElementSubschema('core','Lighting')` returns null, verified
    // directly). FHS DOES have a Lighting subschema (`bulbs`, a required array), but
    // `bulbs` is itself listed in `getBaseFieldsForElementType('Lighting')` for BOTH
    // modes (verified directly) -- so it is filtered OUT of advancedProperties before
    // either path ever sees it, leaving zero properties. AdvancedFieldsEditor's own
    // `if (!hasAdvancedFields) return null` then makes the WHOLE component (container
    // included) render nothing on both paths, in both modes. This is trivially
    // "parity" (both sides agree on nothing) but not the "simple flat" positive case
    // the brief expected -- per "prefer dropping an assertion over building
    // scaffolding", this config just confirms the degenerate case is stable and
    // identical, and config 8 below carries the real positive flat-field coverage
    // this config was meant to provide.
    for (const useFHSSchema of [false, true]) {
      const { onKeys, offKeys } = await assertGenericParity({
        elementType: 'Lighting',
        useFHSSchema,
        extraJson: useFHSSchema ? { bulbs: [{ count: 4, power: 8, efficacy: 90 }] } : {},
      });
      expect(offKeys).toEqual([]);
      expect(onKeys).toEqual([]);
      cleanup();
    }
  });

  it('config 8 -- OnSiteGeneration, Core (base-field filtering, zero fields) and FHS (real flat fields)', async () => {
    // Core: subschema.properties is EMPTY after base-field filtering (every property
    // is a base field -- verified directly). Both paths render zero rows; this
    // confirms the degenerate case holds identically (no stray control, no crash).
    const { onKeys, offKeys } = await assertGenericParity({
      elementType: 'OnSiteGeneration',
      useFHSSchema: false,
      extraJson: {},
    });
    expect(offKeys).toEqual([]);
    expect(onKeys).toEqual([]);
    cleanup();

    // FHS: real advanced fields survive filtering (ventilation_strategy enum,
    // EnergySupply string, shading $ref-object blob, inverter_* fields) -- the
    // "simple flat, positive fields" case config 7 (Lighting) turned out not to have.
    await assertGenericParity({
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
    });
  });

  it('config 9 -- ThermalBridgeLinear (junction_type stays manual/absent from both paths)', async () => {
    // CHARACTERIZATION: length/linear_thermal_transmittance are BASE fields (rendered
    // by the main element form, not Advanced Fields) in both Core and FHS, and
    // junction_type is deliberately deleted from advancedProperties (rendered
    // manually elsewhere, richer labels + psi autofill -- see
    // `shouldRenderJunctionTypeManually` in AdvancedFieldsEditor.tsx) in FHS. FHS's
    // Advanced Fields property set for ThermalBridgeLinear is therefore EMPTY on both
    // paths too -- confirming junction_type never leaks into the generic grid either
    // way, and the flat walk handles an all-filtered-out schema without crashing.
    const { onKeys, offKeys } = await assertGenericParity({
      elementType: 'ThermalBridgeLinear',
      useFHSSchema: true,
      currentDataExtra: { length: 2.5, linear_thermal_transmittance: 0.09 },
      extraJson: { junction_type: 'E16' },
    });
    expect(offKeys).toEqual([]);
    expect(onKeys).toEqual([]);
    expect(offKeys).not.toContain('junction_type');
    expect(onKeys).not.toContain('junction_type');
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
    await assertGenericParity({
      elementType: 'System',
      subtype: 'SpaceHeatSystem',
      useFHSSchema: true,
      extraJson: { SpaceHeatSystem: singlePlant },
    });
    cleanup();

    // Two plants (second plant synthesized -- no real two-plant SpaceHeatSystem
    // fixture exists in the repo, per the WarmAir shape used in
    // lib/__tests__/spaceHeatSystemSync.test.ts): buildSystemAdvancedUischema's
    // `multiPlant` flag flips on with 2+ plant keys, and EVERY control in EVERY plant
    // gets a `plantKey · label` prefix (leafControlLabel, unchanged/not-touched by
    // this slice) -- assert that label-set parity (already covered generically by
    // assertGenericParity) actually contains the prefixed form, so this test would
    // fail loudly if the prefixing logic silently stopped firing on the direct path.
    const twoPlants = {
      ...singlePlant,
      'Living warm air': { type: 'WarmAir', HeatSource: { name: 'a2a_hp' } },
    };
    const { container: twoPlantContainer } = await assertGenericParity({
      elementType: 'System',
      subtype: 'SpaceHeatSystem',
      useFHSSchema: true,
      extraJson: { SpaceHeatSystem: twoPlants },
    });
    const twoPlantLabels = Array.from(twoPlantContainer.querySelectorAll('[data-field-key]')).map((el) =>
      fieldLabelText(el as HTMLElement),
    );
    expect(twoPlantLabels.some((label) => label.startsWith('Zone 1 circuit · '))).toBe(true);
    expect(twoPlantLabels.some((label) => label.startsWith('Living warm air · '))).toBe(true);
    cleanup();

    // Nested-path edit round-trip (single plant): type into HeatSource.temp_flow_limit_upper
    // (hoisted -- scope
    // #/properties/SpaceHeatSystem/properties/Zone 1 circuit/properties/HeatSource/properties/temp_flow_limit_upper
    // -> dot path "SpaceHeatSystem.Zone 1 circuit.HeatSource.temp_flow_limit_upper")
    // on both paths and compare the full onChange payload deep-equal -- this is what
    // actually exercises DirectAdvancedFields' Stage-2.1 nested set/delete, not just
    // its rendering.
    async function editNestedField(container: HTMLElement, onChange: ReturnType<typeof vi.fn>) {
      const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-field-key="temp_flow_limit_upper"]'));
      expect(rows.length).toBe(1);
      const input = within(rows[0]).getByRole('textbox');
      fireEvent.change(input, { target: { value: '70' } });
      await waitFor(() => expect(onChange).toHaveBeenCalled());
      return onChange.mock.calls[onChange.mock.calls.length - 1][0];
    }

    setJsonformsFallbackFlag(true);
    const offOnChange = vi.fn();
    const off = renderEditor({
      elementType: 'System',
      subtype: 'SpaceHeatSystem',
      useFHSSchema: true,
      extraJson: { SpaceHeatSystem: singlePlant },
      onChange: offOnChange,
    });
    const offPayload = await editNestedField(off.container, offOnChange);
    off.unmount();
    cleanup();

    setJsonformsFallbackFlag(false);
    const onOnChange = vi.fn();
    const on = renderEditor({
      elementType: 'System',
      subtype: 'SpaceHeatSystem',
      useFHSSchema: true,
      extraJson: { SpaceHeatSystem: singlePlant },
      onChange: onOnChange,
    });
    const onPayload = await editNestedField(on.container, onOnChange);

    expect(onPayload).toEqual(offPayload);
    // Sanity: the edit actually reached the nested leaf, on both paths, and the
    // surrounding structure (sibling plant fields, other HeatSource keys) is intact.
    const offSpaceHeat = (offPayload as { extra_json: Record<string, unknown> }).extra_json
      .SpaceHeatSystem as Record<string, unknown>;
    const onSpaceHeat = (onPayload as { extra_json: Record<string, unknown> }).extra_json
      .SpaceHeatSystem as Record<string, unknown>;
    const offZone = offSpaceHeat['Zone 1 circuit'] as Record<string, unknown>;
    const onZone = onSpaceHeat['Zone 1 circuit'] as Record<string, unknown>;
    expect((offZone.HeatSource as Record<string, unknown>).temp_flow_limit_upper).toBe(70);
    expect((onZone.HeatSource as Record<string, unknown>).temp_flow_limit_upper).toBe(70);
    expect((offZone.HeatSource as Record<string, unknown>).name).toBe('hp');
    expect((onZone.HeatSource as Record<string, unknown>).name).toBe('hp');
  });

  it('config 11 -- System, HotWaterSource, FHS: HeatSource map is skipped identically on both paths (CHARACTERIZATION)', async () => {
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
    // outside the generic Advanced Fields grid, unaffected by this slice). Since this
    // schema shape is upstream of BOTH paths (same `subschema`/`layout`, whichever
    // mode consumes it), the skip is identical either way -- confirmed below by
    // asserting `HeatSource` never becomes a field on EITHER path, rather than
    // asserting the "hoisted, not a blob" behavior the brief expected.
    const { container, offKeys, onKeys } = await assertGenericParity({
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
    });

    expect(offKeys).not.toContain('HeatSource');
    expect(onKeys).not.toContain('HeatSource');
    expect(offKeys).toEqual(['ColdWaterSource', 'daily_losses', 'init_temp', 'volume']);
    expect(onKeys).toEqual(offKeys);
    // No opaque "[object Object]" blob leaks through anywhere in the grid either.
    expect(container.textContent).not.toContain('[object Object]');
  });

  describe('Stage 2.5: const-only / type-less properties are dropped in flat mode, on both paths', () => {
    // No live HEM Advanced Field property is actually const-only-and-type-less
    // (checked directly against both schema files: every `const` found sits inside an
    // `if`/`allOf` conditional block, never as a standalone Advanced Field property),
    // so this is a synthetic schema exercising `schemaEmitsControl`'s gate directly --
    // matching the pattern the $ref probe tests in
    // AdvancedFieldsEditor.electricBattery.test.tsx already use for isolated
    // DirectAdvancedFields/JsonForms mounts, since no real element type reaches it.
    const syntheticSchema = {
      type: 'object',
      properties: {
        // Const-only, no `type`/`enum`/`properties`/`items` -- @jsonforms/core's
        // generator derives no type for this and emits no control at all.
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

    it('raw JsonForms (generated uischema, no explicit uischema prop): mode_marker is ALSO skipped -- confirms this matches the OFF-path generator, not just an assumption', () => {
      const store = createGeometryStore({ defaultDefaultsPath: null });
      const { container } = render(
        <GeometryEditorServicePortsProvider
          schemaPort={canonicalGeometrySchemaPort}
          workspaceResourcePort={unavailableGeometryWorkspaceResourcePort}
        >
          <GeometryStoreProvider store={store}>
            <JsonForms
              schema={syntheticSchema as never}
              data={{ mode_marker: 'v1', battery_age: 5 }}
              renderers={[...standardRenderers, ...materialRenderers]}
              ajv={getAjvInstance()}
              config={{ advancedEditor: true, elementType: 'ElectricBattery' }}
              onChange={() => {}}
            />
          </GeometryStoreProvider>
        </GeometryEditorServicePortsProvider>,
      );
      const keys = Array.from(container.querySelectorAll('[data-field-key]')).map((el) =>
        el.getAttribute('data-field-key'),
      );
      expect(keys).toEqual(['battery_age']);
    });
  });
});
