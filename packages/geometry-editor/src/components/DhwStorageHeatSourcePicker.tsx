// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { useGeometryStore } from '../stores/geometryStore';
import { StandardDropdown } from './StandardDropdown';
import { readRecord } from '../lib/jsonTypes';
import { collectHeatSourceWetNameLabelsFromProject, collectHeatSourceWetNamesFromProject } from '../lib/heatSourceWetNamesFromProject';
import type { Element, System } from '../geometry/types';

const IMMERSION_VALUE = '__dhw_immersion__';
const HEATER_KINDS: Readonly<Record<string, string>> = { ImmersionHeater: 'Immersion heater', HeatPump_HWOnly: 'Hot-water-only heat pump', HeatSourceWet: 'Coil', SolarThermalSystem: 'Solar thermal' };
const HWOHP_VALUE = '__dhw_hwonly_heat_pump__';

// FHS states a heater's and its thermostat's positions in the tank. HEM:EPC leaves them blank: the
// heater position takes its default, shown on the field, and the thermostat position has none, so
// the converter asks for it on the heater.
const FHS_POSITIONS = { heater_position: 0.1, thermostat_position: 0.33 };

function defaultImmersionHeater(powerKw: number, epcDefaulted: boolean): Record<string, unknown> {
  return {
    type: 'ImmersionHeater',
    power: powerKw,
    EnergySupply: 'mains elec',
    ...(epcDefaulted ? {} : FHS_POSITIONS),
  };
}

// Generic example data, not a product: upstream FHS example DESN-H-End-02-HP-cMEV-HWOHP.json,
// `HotWaterSource."hw cylinder".HeatSource.hwo_hps` (renamed `hwo_hp`), epb-hem-wrapper-fhs rev
// c5ba2673fbd886cfe4fb528f61b376bdf406ebbd (pinned at hem_fhs_upstream/). Copyright (c) 2026 Crown
// Copyright (Ministry of Housing, Communities and Local Government), MIT licence. Same values as
// the shipped `hot_water_source/hwo_heat_pump_cylinder` preset.
const HWOHP_KEY = 'hwo_hp';
// The FHS schema requires the cylinder's own coil area once its only heater is a HeatPump_HWOnly;
// the same example's cylinder value.
const DEFAULT_HWOHP_CYLINDER_HEAT_EXCHANGER_AREA = 1.0;
const defaultHwohp = (epcDefaulted: boolean): Record<string, unknown> => ({
  type: 'HeatPump_HWOnly',
  EnergySupply: 'mains elec',
  power_max: 5.0,
  tank_volume_declared: 100.0,
  daily_losses_declared: 1.05,
  heat_exchanger_surface_area_declared: 1.5,
  in_use_factor_mismatch: 0.6,
  ...(epcDefaulted ? {} : FHS_POSITIONS),
  test_data: {
    M: {
      cop_dhw: 2.5,
      energy_input_measured: 2.338,
      hw_tapping_prof_daily_total: 5.845,
      hw_vessel_loss_daily: 2.0,
      power_standby: 0.02,
    },
  },
});

function defaultWetHeaterSource(name: string, flowLimit: boolean, epcDefaulted: boolean): Record<string, unknown> {
  return {
    type: 'HeatSourceWet',
    name,
    ...(flowLimit ? { temp_flow_limit_upper: 65 } : {}),
    ...(epcDefaulted ? {} : FHS_POSITIONS),
  };
}

export const DhwStorageHeatSourcePicker: React.FC<{
  elementsById: Record<string, Element>;
  systemElement: System;
  onPatchExtraJson: (fn: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  flat?: boolean;
  /** HEM:EPC: a heat pump's coil leaves its upper flow limit blank for the converter's default
   * (`apply_desnz_defaults`, assumption pending DESNZ), and an immersion heater or coil its
   * positions for the default. */
  epcDefaulted?: boolean;
}> = ({ elementsById, systemElement, onPatchExtraJson, flat, epcDefaulted = false }) => {
  const setSelection = useGeometryStore((state) => state.setSelection);
  // The heater picked to add: a keyboard moving through a closed select changes it, so adding waits for "Add".
  const [choices, setChoices] = React.useState<Record<string, string>>({});
  const wetNames = collectHeatSourceWetNamesFromProject(elementsById);
  const wetLabels = collectHeatSourceWetNameLabelsFromProject(elementsById);
  const tanks = Object.entries(readRecord(readRecord(systemElement.extra_json).HotWaterSource))
    .filter(([, tank]) => readRecord(tank).type === 'StorageTank');
  const patchHeaters = (tankName: string, update: (heaters: Record<string, unknown>) => Record<string, unknown>) => {
    onPatchExtraJson((prev) => {
      const sources = readRecord(prev.HotWaterSource);
      const tank = readRecord(sources[tankName]);
      return { ...prev, HotWaterSource: { ...sources, [tankName]: { ...tank, HeatSource: update(readRecord(tank.HeatSource)) } } };
    });
  };
  const isHeatPump = (name: string) => Object.values(elementsById)
    .some((element) => readRecord(readRecord(readRecord(element.extra_json).HeatSourceWet)[name]).type === 'HeatPump');
  const addHeater = (tankName: string, choice: string) => {
    if (!choice) return;
    onPatchExtraJson((prev) => {
      const sources = readRecord(prev.HotWaterSource);
      const tank = readRecord(sources[tankName]);
      const heaters = readRecord(tank.HeatSource);
      const usedNames = new Set(Object.values(elementsById).flatMap((element) =>
        Object.values(readRecord(readRecord(element.extra_json).HotWaterSource)).flatMap((source) => Object.keys(readRecord(readRecord(source).HeatSource))),
      ));
      Object.values(sources).forEach((source) => Object.keys(readRecord(readRecord(source).HeatSource)).forEach((key) => usedNames.add(key)));
      const base = choice === IMMERSION_VALUE ? 'immersion' : choice === HWOHP_VALUE ? HWOHP_KEY : 'linked_heat_source';
      let name = base;
      for (let i = 2; usedNames.has(name); i++) name = `${base}_${i}`;
      const heater = choice === IMMERSION_VALUE ? defaultImmersionHeater(3, epcDefaulted)
        : choice === HWOHP_VALUE ? defaultHwohp(epcDefaulted) : defaultWetHeaterSource(choice.slice(4), !(epcDefaulted && isHeatPump(choice.slice(4))), epcDefaulted);
      return { ...prev, HotWaterSource: { ...sources, [tankName]: {
        ...(choice === HWOHP_VALUE ? { heat_exchanger_surface_area: DEFAULT_HWOHP_CYLINDER_HEAT_EXCHANGER_AREA } : {}),
        ...tank, HeatSource: { ...heaters, [name]: heater },
      } } };
    });
    setChoices((current) => ({ ...current, [tankName]: '' }));
  };
  if (!tanks.length) return null;
  return <div style={{ marginBottom: flat ? 10 : 'var(--spacing-md)' }}>
    {tanks.map(([tankName, value]) => {
      const heaters = readRecord(readRecord(value).HeatSource);
      const none = !Object.keys(heaters).length;
      return <div key={tankName} data-cylinder-heaters style={{ display: 'grid', gap: 6 }}>
        <div className="element-label">{tanks.length > 1 ? `${tankName} · Heated by` : 'Heated by'}</div>
        {/* One row per heater: a coil reads "Coil from <its heat source>", the source a link to it. */}
        {Object.entries(heaters).map(([name, value]) => {
          const heater = readRecord(value);
          const linked = heater.type === 'HeatSourceWet'
            ? Object.values(elementsById).find((element) => !element.isPlaceholder && Object.prototype.hasOwnProperty.call(readRecord(readRecord(element.extra_json).HeatSourceWet), String(heater.name)))
            : undefined;
          return <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ flex: 1, overflowWrap: 'anywhere' }}>
              {HEATER_KINDS[String(heater.type)] ?? String(heater.type ?? 'Unknown heater')}
              {linked ? <> from <button type="button" className="field-source-note__link" onClick={() => setSelection({ type: 'element', id: linked.id })}>{linked.name}</button></> : null}
            </span>
            {heater.type === 'HeatPump_HWOnly' && <button type="button" className="btn btn-nav btn-small" onClick={() => patchHeaters(tankName, (current) => {
              const data = readRecord(readRecord(current[name]).test_data);
              const testData = Object.prototype.hasOwnProperty.call(data, 'L') ? Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'L')) : { ...data, L: {} };
              return { ...current, [name]: { ...readRecord(current[name]), test_data: testData } };
            })}>{Object.prototype.hasOwnProperty.call(readRecord(heater.test_data), 'L') ? 'Remove profile L' : 'Add profile L'}</button>}
            <button type="button" className="btn btn-nav btn-small" aria-label={`Remove heater ${name}`} title="Remove" onClick={() => patchHeaters(tankName, (current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== name)))}>×</button>
            {heater.type === 'HeatSourceWet' && !linked && <p role="alert" style={{ flexBasis: '100%', margin: 0 }}>Linked heat source “{String(heater.name ?? '')}” is missing.</p>}
          </div>;
        })}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <StandardDropdown value={choices[tankName] ?? ''} onChange={(value) => setChoices((current) => ({ ...current, [tankName]: value || '' }))} aria-label={`Heater to add to ${tankName}`} options={[
          { value: IMMERSION_VALUE, label: 'Immersion heater' },
          { value: HWOHP_VALUE, label: 'Hot-water-only heat pump' },
          ...wetNames.map((name) => ({ value: `wet:${name}`, label: `Coil from ${wetLabels[name] ?? name}` })),
        ]} placeholder={none ? 'Choose a heater…' : 'Add a heater…'} size="md" variant="ghost" />
        {choices[tankName] ? <button type="button" className="btn btn-nav btn-small" onClick={() => addHeater(tankName, choices[tankName]!)}>Add</button> : null}
        </div>
        {none && <p role="alert" style={{ margin: 0 }}>Choose what heats the cylinder.</p>}
      </div>;
    })}
  </div>;
};
