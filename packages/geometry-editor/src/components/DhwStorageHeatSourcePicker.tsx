// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { useGeometryStore } from '../stores/geometryStore';
import { StandardDropdown } from './StandardDropdown';
import { readRecord } from '../lib/jsonTypes';
import { collectHeatSourceWetNameLabelsFromProject, collectHeatSourceWetNamesFromProject } from '../lib/heatSourceWetNamesFromProject';
import type { Element, System } from '../geometry/types';

const IMMERSION_VALUE = '__dhw_immersion__';
const HWOHP_VALUE = '__dhw_hwonly_heat_pump__';

function defaultImmersionHeater(powerKw: number): Record<string, unknown> {
  return {
    type: 'ImmersionHeater',
    power: powerKw,
    EnergySupply: 'mains elec',
    heater_position: 0.1,
    thermostat_position: 0.33,
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
const DEFAULT_HWOHP = {
  type: 'HeatPump_HWOnly',
  EnergySupply: 'mains elec',
  power_max: 5.0,
  tank_volume_declared: 100.0,
  daily_losses_declared: 1.05,
  heat_exchanger_surface_area_declared: 1.5,
  in_use_factor_mismatch: 0.6,
  heater_position: 0.1,
  thermostat_position: 0.33,
  test_data: {
    M: {
      cop_dhw: 2.5,
      energy_input_measured: 2.338,
      hw_tapping_prof_daily_total: 5.845,
      hw_vessel_loss_daily: 2.0,
      power_standby: 0.02,
    },
  },
};

function defaultWetHeaterSource(name: string): Record<string, unknown> {
  return {
    type: 'HeatSourceWet',
    name,
    temp_flow_limit_upper: 65,
    heater_position: 0.1,
    thermostat_position: 0.33,
  };
}

export const DhwStorageHeatSourcePicker: React.FC<{
  elementsById: Record<string, Element>;
  systemElement: System;
  onPatchExtraJson: (fn: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  flat?: boolean;
}> = ({ elementsById, systemElement, onPatchExtraJson, flat }) => {
  const setSelection = useGeometryStore((state) => state.setSelection);
  const [choice, setChoice] = React.useState('');
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
  const addHeater = (tankName: string) => {
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
      const heater = choice === IMMERSION_VALUE ? defaultImmersionHeater(3)
        : choice === HWOHP_VALUE ? structuredClone(DEFAULT_HWOHP) : defaultWetHeaterSource(choice.slice(4));
      return { ...prev, HotWaterSource: { ...sources, [tankName]: {
        ...(choice === HWOHP_VALUE ? { heat_exchanger_surface_area: DEFAULT_HWOHP_CYLINDER_HEAT_EXCHANGER_AREA } : {}),
        ...tank, HeatSource: { ...heaters, [name]: heater },
      } } };
    });
    setChoice('');
  };
  if (!tanks.length) return null;
  return <div style={{ marginBottom: flat ? 10 : 'var(--spacing-md)' }}>
    {tanks.map(([tankName, value]) => {
      const heaters = readRecord(readRecord(value).HeatSource);
      return <div key={tankName}>
        <div style={{ marginBottom: 8 }}>{tanks.length > 1 ? `${tankName} · Cylinder heaters` : 'Cylinder heaters'}</div>
        {Object.entries(heaters).map(([name, value]) => {
          const heater = readRecord(value);
          return <div key={name} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{name} · {({ ImmersionHeater: 'Immersion heater', HeatPump_HWOnly: 'Hot-water-only heat pump', HeatSourceWet: 'Linked heat source' }[String(heater.type)] ?? String(heater.type ?? 'Unknown heater'))}</span>
              <button type="button" className="btn btn-nav btn-small" aria-label={`Remove heater ${name}`} onClick={() => patchHeaters(tankName, (current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== name)))}>Remove</button>
            </div>
            {heater.type === 'HeatSourceWet' && (() => {
              const linked = Object.values(elementsById).find((element) => !element.isPlaceholder && Object.prototype.hasOwnProperty.call(readRecord(readRecord(element.extra_json).HeatSourceWet), String(heater.name)));
              return linked ? <button type="button" className="btn btn-nav btn-small" onClick={() => setSelection({ type: 'element', id: linked.id })}>Edit {linked.name}</button> : <p role="alert">Linked heat source “{String(heater.name ?? '')}” is missing.</p>;
            })()}
            {heater.type === 'HeatPump_HWOnly' && <>
              <button type="button" className="btn btn-nav btn-small" onClick={() => patchHeaters(tankName, (current) => {
                const data = readRecord(readRecord(current[name]).test_data);
                const testData = Object.prototype.hasOwnProperty.call(data, 'L') ? Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'L')) : { ...data, L: {} };
                return { ...current, [name]: { ...readRecord(current[name]), test_data: testData } };
              })}>{Object.prototype.hasOwnProperty.call(readRecord(heater.test_data), 'L') ? 'Remove profile L' : 'Add profile L'}</button>
            </>}
          </div>;
        })}
        {!Object.keys(heaters).length && <p role="alert">No cylinder heater configured. Add a heater before calculating.</p>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <StandardDropdown value={choice} onChange={(value) => setChoice(value || '')} aria-label={`Heater to add to ${tankName}`} options={[
            { value: IMMERSION_VALUE, label: 'Immersion heater' },
            { value: HWOHP_VALUE, label: 'Hot-water-only heat pump (sample)' },
            ...wetNames.map((name) => ({ value: `wet:${name}`, label: `Linked: ${wetLabels[name] ?? name}` })),
          ]} placeholder="Choose heater…" size="md" variant="ghost" />
          <button type="button" className="btn btn-nav btn-small" disabled={!choice} onClick={() => addHeater(tankName)}>Add heater</button>
        </div>
      </div>;
    })}
  </div>;
};
