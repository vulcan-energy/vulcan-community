// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Real prepared models. The Core examples are read from the pinned hem_engine_upstream
// submodule. The FHS model is trimmed from the target's `preprocess` output for
// hem_fhs_upstream examples/input/future_homes_standard/demo_FHS_hp_with_advancedstart.json
// (MIT licence, Copyright (c) Crown Copyright). The design heat loss figures are the
// target's `design_heat_loss` output for the same models (Core: London EPW).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sizeHeating, type DesignHeatLoss } from '../heatingSizing';

const coreExample = (name: string) =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../../../../../hem_engine_upstream/examples/input/core/short/${name}.json`), 'utf8'),
  ) as Record<string, unknown>;

const zone = (htcWPerK: number, designLossKw: number) => ({
  htcWPerK,
  fabricWPerK: 0,
  thermalBridgesWPerK: 0,
  ventilationWPerK: 0,
  designLossKw,
});

// Two radiators c 0.08 n 1.2 and c 0.1 n 1.3, by hand at a mean water temperature above 21 C.
const pair = (meanC: number) => 0.08 * (meanC - 21) ** 1.2 + 0.1 * (meanC - 21) ** 1.3;
/** kW per K of drop at `lPerMin`: 1 kg/l x 4.184 kJ/kg K / 60 s, as the engine. */
const carries = (lPerMin: number) => (lPerMin * 4.184) / 60;

const hpRows = [
  ['A', 35, 8.4, -7], ['B', 35, 8.3, 2], ['C', 35, 8.3, 7], ['D', 35, 8.2, 12], ['F', 35, 8.4, -7],
  ['A', 55, 8.8, -7], ['B', 55, 8.6, 2], ['C', 55, 8.5, 7], ['D', 55, 8.5, 12], ['F', 55, 8.8, -7],
].map(([test_letter, design_flow_temp, capacity, temp_test]) => ({
  test_letter, design_flow_temp, capacity, temp_test, cop: 3, temp_outlet: design_flow_temp, temp_source: temp_test,
}));

const fhsPrepared = {
  HeatSourceWet: {
    hp: {
      type: 'HeatPump', EnergySupply: 'mains elec', backup_ctrl_type: 'TopUp', sink_type: 'Water', source_type: 'OutsideAir',
      modulating_control: true, min_modulation_rate_35: 0.35, min_modulation_rate_55: 0.4, power_max_backup: 3.0,
      test_data_EN14825: hpRows,
    },
  },
  SpaceHeatSystem: {
    radiators: {
      type: 'WetDistribution',
      HeatSource: { name: 'hp', temp_flow_limit_upper: 65.0 },
      Zone: 'whole dwelling',
      design_flow_temp: 55.0,
      temp_diff_emit_dsgn: 10.0,
      variable_flow: true,
      min_flow_rate: 3.0,
      max_flow_rate: 18.0,
      ecodesign_controller: { ecodesign_control_class: 2, min_outdoor_temp: -4.0, max_outdoor_temp: 20.0, min_flow_temp: 30.0 },
      emitters: [0.08, 0.1, 0.08, 0.1].map((c, i) => ({
        wet_emitter_type: 'radiator', c, n: i % 2 ? 1.3 : 1.2, frac_convective: 0.4,
        thermal_mass: null, thermal_mass_per_m: null, c_per_m: null, length: null,
      })),
    },
    backup: { type: 'InstantElecHeater', rated_power: 12.0, EnergySupply: 'mains elec', frac_convective: 0.35 },
  },
  Zone: { 'whole dwelling': { SpaceHeatSystem: ['radiators', 'backup'] } },
};

describe('sizeHeating on real prepared models', () => {
  it('FHS preprocessed heat pump: point A at 55 C falls short; radiators cover the loss', () => {
    const loss: DesignHeatLoss = {
      coldestHourC: -6.5,
      setpointC: 21,
      weatherName: 'Bedford',
      zones: { 'whole dwelling': zone(330.1189154595861, 9.078270175138618) },
    };
    const { systems, heatSources } = sizeHeating(fhsPrepared, loss);
    const [radiators, backup] = systems;
    // -6.5 C is below min_outdoor_temp -4 C, so the flow is design_flow_temp.
    expect(radiators).toMatchObject({ status: 'ok', verdict: 'ok', flowTempAtDesignC: 55 });
    // 2 x pair(50) = 25.0 kW would need 25.0 / (10 K x 0.0697) = 36 l/min, above max_flow_rate 18, so the
    // rate stays at 18 l/min and the output P solves P = 2 pair(55 - P / (2 x 1.255)): 21.3 kW.
    const p = radiators.outputAtDesignKw!;
    expect(p).toBeCloseTo(2 * pair(55 - p / (2 * carries(18))), 9);
    expect(p).toBeCloseTo(21.29, 2);
    // 9.08 kW runs at 13.0 l/min, inside 3..18, so the drop is the design 10 K and the flow is mean + 5 K.
    expect(radiators.minFlowC).toBe(39);
    // At 39 C the heat pump gives 8.48 kW, below 9.08 kW: no lower flow is suggested.
    expect(radiators.suggestedFlowC).toBeNull();
    expect(backup).toMatchObject({ zone: 'whole dwelling', status: 'unsupported', designLossKw: 9.078270175138618 });
    expect(heatSources[0]).toMatchObject({
      status: 'ok', verdict: 'too-small', maxKw: 8.8, hasBackupHeater: true, otherSystemsInZone: true, testPointC: -7, designBelowTestPointK: null,
    });
    expect(heatSources[0].minKw).toBeCloseTo(0.4 * 8.8, 9);
    expect(heatSources[0].shortfallKw).toBeCloseTo(9.078270175138618 - 8.8, 9);
    expect(heatSources[0].balancePointC).toBeCloseTo(21 - 8800 / 330.1189154595861, 9);
  });

  it('Core heat pump demo: the design day is 0.2 K below the coldest declared point', () => {
    const loss: DesignHeatLoss = {
      coldestHourC: -7.2,
      setpointC: 21,
      weatherName: 'London',
      zones: {
        zone1_livingroom: zone(22.497391377745206, 0.6344264368524147),
        zone2_restofdwelling: zone(58.243869127930324, 1.642477109407635),
      },
    };
    const { systems, heatSources } = sizeHeating(coreExample('demo_hp_no_variable_flow'), loss);
    expect(systems[0]).toMatchObject({ status: 'ok', verdict: 'ok' });
    // Fixed flow at 12 l/min: P solves P = pair(55 - P / (2 x 0.837)).
    const p = systems[0].outputAtDesignKw!;
    expect(p).toBeCloseTo(pair(55 - p / (2 * carries(12))), 9);
    expect(p).toBeCloseTo(11.50, 2);
    expect(systems[1]).toMatchObject({ status: 'unsupported', reason: expect.stringMatching(/Underfloor heating is not sized yet/) });
    // A and F are both declared at -7 C; F at 55 C is 8.8 kW. 0.4 x 8.8 kW is above 2.28 kW.
    expect(heatSources[0]).toMatchObject({ status: 'ok', verdict: 'too-big', maxKw: 8.8, testPointC: -7 });
    expect(heatSources[0].designLossKw).toBeCloseTo(0.6344264368524147 + 1.642477109407635, 12);
    expect(heatSources[0].designBelowTestPointK).toBeCloseTo(0.2, 12);
    expect(heatSources[0].minKw).toBeCloseTo(0.4 * 8.8, 12);
  });

  it('Core combi boiler demo: 30% of 24 kW is above the design loss', () => {
    const loss: DesignHeatLoss = { coldestHourC: -7.2, setpointC: 21, weatherName: 'London', zones: { 'zone 1': zone(100.20768463832593, 2.825856706800791) } };
    const { systems, heatSources } = sizeHeating(coreExample('demo_combiBoiler'), loss);
    expect(systems[0].outputAtDesignKw).toBeCloseTo(12.51, 2);
    // 2.83 kW runs at 4.1 l/min, inside 3..18: the drop is 10 K. pair(30) = 2.86 kW covers it with
    // the mean water at 29.9 C, so the flow is 29.9 + 5 = 34.9 C, rounded up to 35 C.
    expect(systems[0].minFlowC).toBe(35);
    expect(heatSources[0]).toMatchObject({ kind: 'Boiler', status: 'ok', verdict: 'too-big', maxKw: 24 });
    expect(heatSources[0].minKw).toBeCloseTo(7.2, 9);
  });
});
