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
// Raw JsonForms import — allowed HERE ONLY, for the Stage 2.5 raw-registry comparison
// mount below (matches the pattern in AdvancedFieldsEditor.electricBattery.test.tsx's
// own $ref probe). No other file in this test suite imports @jsonforms/*.
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

  it('config 3 -- BuildingElementTransparent, FHS: window_part_list + security_risk direct-render characterization', () => {
    const { container } = assertDirectCharacterization(
      {
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
      },
      [
        row('treatment', 'Blinds / curtains', OTHER('DIV')),
        row('u_value', 'U Value', TEXT('0.01')),
        row('g_value', 'G Value', TEXT('0')),
        row('security_risk', 'Security Risk?', CHECKBOX),
        row('window_part_list', 'Window Part List', TEXT(null)),
      ],
    );

    // window_part_list: an explicit, readable marker that the control which rendered
    // is WindowPartListControl (a composite row, not a select/checkbox/plain textbox).
    const windowPartRow = fieldRow(container, 'window_part_list');
    expect(windowPartRow.querySelector('select')).toBeNull();
    expect(windowPartRow.querySelector('input[type="checkbox"]')).toBeNull();

    // security_risk: with the R4.3 executed-table pickDirectControl, this is a plain
    // checkbox (BooleanControl wins on type before enum is ever consulted).
    const securityRow = fieldRow(container, 'security_risk');
    expect(securityRow.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(securityRow.querySelector('select')).toBeNull();
  });

  it('config 4 -- BuildingElementGround, Suspended_floor, FHS: shield_fact_location dropdown + area_per_perimeter_vent direct-render characterization', () => {
    const { container } = assertDirectCharacterization(
      {
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
      },
      [
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
      ],
    );

    // shield_fact_location: inlined as a plain string enum with WIND_SHIELD_LOCATION_ENUM
    // by AdvancedFieldsEditor's own subschema memo -- a dropdown, since the resolved
    // schema is `{type:'string', enum:[...]}` and TextControl's own `extractOptions`
    // fallback renders it (see the reworded comment at the inline site).
    const shieldRow = fieldRow(container, 'shield_fact_location');
    expect(shieldRow.querySelector('select')).not.toBeNull();

    // area_per_perimeter_vent: plain `{type:'number'}` in FHS -- NumberControl,
    // confirmed by the generic row check above.
    const ventRow = fieldRow(container, 'area_per_perimeter_vent');
    expect(ventRow.querySelector('select')).toBeNull();
    expect(ventRow.querySelector('input[type="checkbox"]')).toBeNull();
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

    // Adversarial-review REAL finding (R4.3): with ecodesign_control_class UNSET (the
    // state every newly-added wet system starts in), the picker renders EnumControl
    // (integer+oneOf-const reaches rank-5 GenericControl, whose dispatch is
    // enum-BEFORE-type) including its forwarded "is a required property" error text
    // (see `replicateRequiredError` in DirectAdvancedFields.tsx -- this replication is
    // now permanent layout-spec-path behaviour, not an A/B parity shim). Row shape is
    // identical to the set-value fixture above; only the runtime value/error differs.
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

    it('raw JsonForms registry mount (generated uischema, no explicit uischema prop): mode_marker is ALSO skipped -- confirms schemaEmitsControl matches @jsonforms/core\'s own generator, documenting behaviour web/\'s JsonForms mount still depends on until R4.5', () => {
      // Mounts the shared jsonformsRenderers REGISTRY directly (not AdvancedFieldsEditor,
      // which no longer offers a JsonForms path since R4.4) -- this is the same
      // registry web/'s SnippetEditor and SimplifiedFabricEditor still import via
      // `standardRenderers`/`jsonformsRenderers.tsx`. It verifies DirectAdvancedFields'
      // own `schemaEmitsControl` gate was built to match @jsonforms/core's real
      // `generateUISchema` behaviour, not a guess -- see the `schemaEmitsControl`
      // docstring in DirectAdvancedFields.tsx.
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
