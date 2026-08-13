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
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
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
import { AdvancedFieldsEditor } from '../AdvancedFieldsEditor';
import {
  DirectAdvancedFields,
  DirectSpecFields,
  pickDirectControl,
  type DirectSpecNode,
} from '../DirectAdvancedFields';
import { GroupAccordion } from '../jsonformsRenderers';

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
        row('u_value', 'U-Value', TEXT(null)),
        row('thermal_resistance_construction', 'Thermal Resistance Construction', TEXT(null)),
        row('solar_absorption_coeff', 'Solar Absorption Coeff', TEXT('0')),
      ],
    );

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
      row('ecodesign_control_class', 'ecodesign_controller · ecodesign_control_class', SELECT),
      row('max_outdoor_temp', 'ecodesign_controller · max_outdoor_temp', TEXT('10')),
      row('min_flow_temp', 'ecodesign_controller · min_flow_temp', TEXT('20')),
      row('min_outdoor_temp', 'ecodesign_controller · min_outdoor_temp', TEXT('-60')),
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
    // gets a `plantKey · label` prefix (leafControlLabel, unchanged/not-touched by
    // this slice). Row order (Living warm air's fields before Zone 1 circuit's,
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
        row('frac_convective', 'Living warm air · frac_convective', TEXT('0.1')),
        row('temp_flow_limit_upper', 'Living warm air · temp_flow_limit_upper', TEXT('0', '0')),
        row('temp_diff_emit_dsgn', 'Living warm air · temp_diff_emit_dsgn', TEXT(null)),
        row('bypass_fraction_recirculated', 'Zone 1 circuit · bypass_fraction_recirculated', TEXT('0')),
        row('design_flow_temp', 'Zone 1 circuit · design_flow_temp', TEXT('20')),
        row('ecodesign_control_class', 'Zone 1 circuit · ecodesign_controller · ecodesign_control_class', SELECT),
        row('max_outdoor_temp', 'Zone 1 circuit · ecodesign_controller · max_outdoor_temp', TEXT('10')),
        row('min_flow_temp', 'Zone 1 circuit · ecodesign_controller · min_flow_temp', TEXT('20')),
        row('min_outdoor_temp', 'Zone 1 circuit · ecodesign_controller · min_outdoor_temp', TEXT('-60')),
        row('temp_flow_limit_upper', 'Zone 1 circuit · temp_flow_limit_upper', TEXT('0', '0')),
        row('max_flow_rate', 'Zone 1 circuit · max_flow_rate', TEXT('0', '0')),
        row('min_flow_rate', 'Zone 1 circuit · min_flow_rate', TEXT('0', '0')),
        row('temp_diff_emit_dsgn', 'Zone 1 circuit · temp_diff_emit_dsgn', TEXT('0', '0')),
        row('variable_flow', 'Zone 1 circuit · variable_flow', CHECKBOX),
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
        row('bypass_fraction_recirculated', 'Kitchen/Diner rads · bypass_fraction_recirculated', TEXT('0')),
        row('design_flow_temp', 'Kitchen/Diner rads · design_flow_temp', TEXT('20')),
        row('ecodesign_control_class', 'Kitchen/Diner rads · ecodesign_controller · ecodesign_control_class', SELECT),
        row('max_outdoor_temp', 'Kitchen/Diner rads · ecodesign_controller · max_outdoor_temp', TEXT('10')),
        row('min_flow_temp', 'Kitchen/Diner rads · ecodesign_controller · min_flow_temp', TEXT('20')),
        row('min_outdoor_temp', 'Kitchen/Diner rads · ecodesign_controller · min_outdoor_temp', TEXT('-60')),
        row('temp_flow_limit_upper', 'Kitchen/Diner rads · temp_flow_limit_upper', TEXT('0', '0')),
        row('max_flow_rate', 'Kitchen/Diner rads · max_flow_rate', TEXT('0', '0')),
        row('min_flow_rate', 'Kitchen/Diner rads · min_flow_rate', TEXT('0', '0')),
        row('temp_diff_emit_dsgn', 'Kitchen/Diner rads · temp_diff_emit_dsgn', TEXT('0', '0')),
        row('variable_flow', 'Kitchen/Diner rads · variable_flow', CHECKBOX),
        row('frac_convective', 'Zone 1.5 circuit · frac_convective', TEXT('0.1')),
        row('temp_flow_limit_upper', 'Zone 1.5 circuit · temp_flow_limit_upper', TEXT('0', '0')),
        row('temp_diff_emit_dsgn', 'Zone 1.5 circuit · temp_diff_emit_dsgn', TEXT(null)),
      ],
    );

    // "Real field rows render, not junk 'properties' rows": the full ordered-key
    // comparison above already proves this (a broken pointer resolution would produce
    // wrong keys/labels or throw), but assert the negative directly too, and that no
    // control fell back to an opaque JSON blob anywhere in the grid.
    expect(fieldKeys(container)).not.toContain('properties');
    expect(container.textContent).not.toContain('[object Object]');

    // Labels carry the RAW plant-key prefix (unescaped) -- escaping applies to scopes
    // only, per systemAdvancedUischema.ts's docstring; a user reading this grid should
    // see their own plant names, not pointer-escaped ones.
    expect(fieldLabelText(fieldRowByLabel(container, 'variable_flow', 'Kitchen/Diner rads'))).toBe(
      'Kitchen/Diner rads · variable_flow',
    );
    expect(fieldLabelText(fieldRowByLabel(container, 'frac_convective', 'Zone 1.5 circuit'))).toBe(
      'Zone 1.5 circuit · frac_convective',
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
      // `schemaHasEnum`/`schemaHasConstAlternatives` predicates are vacuously true on
      // an empty array, which was harmless under R4.3's type-first `pickDirectControl`
      // order but would route this straight to a ZERO-OPTION EnumControl dropdown
      // under R4.3b's enum-first order without the `isNonEmptyEnumLike` guard --
      // permanently uneditable, right next to help text asking for exactly the input
      // it no longer accepts. Exercises `pickDirectControl` directly (unit-level, the
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
        <DirectSpecFields
          schema={props.schema}
          data={props.data}
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
