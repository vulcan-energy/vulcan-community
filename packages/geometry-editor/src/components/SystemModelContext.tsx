// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react';
import type { Element } from '../geometry/types';
import { readRecord } from '../lib/jsonTypes';
import { useGeometryStore } from '../stores/geometryStore';
import { StandardDropdown } from './StandardDropdown';
import { renderFieldLabelWithTooltip } from './jsonformsRenderers';

export function SystemModelContext({ extraJson, subtype, useFHSSchema, elementsById }: {
  extraJson: unknown; subtype?: string; useFHSSchema: boolean; elementsById: Record<string, Element>;
}) {
  const control = useGeometryStore((state) => state.complianceSettings.HeatingControlType);
  const setComplianceSettings = useGeometryStore((state) => state.setComplianceSettings);
  const setSelection = useGeometryStore((state) => state.setSelection);
  const sources = Object.values(readRecord(readRecord(extraJson).HeatSourceWet)).map(readRecord);
  const exhaustPumps = sources.filter((source) => source.type === 'HeatPump' && ['ExhaustAirMEV', 'ExhaustAirMVHR', 'ExhaustAirMixed'].includes(String(source.source_type)));
  const ventilation = Object.values(elementsById).filter((element) => !element.isPlaceholder).flatMap((element) => {
    const extra = readRecord(element.extra_json);
    if (element.type === 'MechanicalVentilation') return [{ id: element.id, name: element.name, data: { ...extra, vent_type: element.vent_type ?? extra.vent_type } }];
    if (element.type === 'System' && element.subcategory === 'InfiltrationVentilation') return Object.entries(readRecord(readRecord(extra.InfiltrationVentilation).MechanicalVentilation)).map(([name, data]) => ({ id: element.id, name, data: readRecord(data) }));
    return [];
  });
  return <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 10 }}>
    {useFHSSchema && subtype === 'SpaceHeatSystem' && <div title="Whole-dwelling setting, shared with Global Settings">
      <StandardDropdown label={renderFieldLabelWithTooltip('Heating Control Type', 'System', true)} aria-label="Heating control type (whole dwelling)" value={control ?? ''} onChange={(value) => setComplianceSettings({ HeatingControlType: value as 'SeparateTempControl' | 'SeparateTimeAndTempControl' })} options={[
        { value: 'SeparateTempControl', label: 'Separate Temperature Control' },
        { value: 'SeparateTimeAndTempControl', label: 'Separate Time and Temperature Control' },
      ]} placeholder="Select control type…" variant="ghost" size="md" />
    </div>}
    {exhaustPumps.length > 0 && <>
      {ventilation.map((vent, index) => <div key={`${vent.id}-${index}`} style={{ marginBottom: 6 }}>
        <button type="button" className="btn btn-nav btn-small" onClick={() => setSelection({ type: 'element', id: vent.id })}>Inspect {vent.name}</button>
        {' '}{String(vent.data.vent_type ?? 'Ventilation')} · {typeof vent.data.design_outdoor_air_flow_rate === 'number' ? `${vent.data.design_outdoor_air_flow_rate} m³/h` : 'airflow not set'}
      </div>)}
      {ventilation.length !== 1 && <p role="alert">{ventilation.length === 0 ? 'Add compatible mechanical ventilation.' : 'Multiple ventilation units: check heat-pump airflow.'}</p>}
      {exhaustPumps.some((pump) => {
        const flows = Array.isArray(pump.test_data_EN14825) ? pump.test_data_EN14825.map((point) => readRecord(point).air_flow_rate).filter((flow): flow is number => typeof flow === 'number' && Number.isFinite(flow)) : [];
        return ventilation.length === 1 && flows.length > 0 && typeof ventilation[0].data.design_outdoor_air_flow_rate === 'number' && ventilation[0].data.design_outdoor_air_flow_rate < Math.min(...flows);
      }) && <p role="alert">Ventilation airflow is below the lowest test airflow.</p>}
    </>}
  </div>;
}
