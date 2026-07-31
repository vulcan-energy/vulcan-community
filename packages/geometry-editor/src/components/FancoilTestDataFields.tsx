// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useMemo } from 'react';
import { StandardInput } from './StandardInput';
import { renderFieldLabelWithTooltip } from './jsonformsRenderers';
import { ResolvedFieldLabel } from './ResolvedFieldLabel';
import { useGeometrySchemaPort } from '../../../geometry-editor-host/src/editorServicePorts';
import { useGeometryStore } from '../stores/geometryStore';
import { fieldUnitForAdornment, resolveFieldPresentation } from '../lib/fieldPresentation';
import {
  defaultFancoilTestData,
  parseFancoilTestData,
  serialiseFancoilTestData,
  type FancoilTestDataValue,
} from '../lib/fancoilTestData';
import { useKeyedState } from '../hooks/useKeyedState';

export interface FancoilTestDataFieldsProps {
  value: unknown;
  onChange: (next: FancoilTestDataValue) => void;
  elementType: string;
  flat?: boolean;
}

const ROW_MARGIN = (compact: boolean) => (compact ? '6px 0' : '10px 0');

function powerOutputToText(powers: number[]): string {
  return powers.map((p) => String(p)).join(', ');
}

function textToPowerOutput(text: string): number[] {
  const parts = text.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return [0];
  return parts.map((p) => {
    const n = parseFloat(p);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  });
}

export const FancoilTestDataFields: React.FC<FancoilTestDataFieldsProps> = ({
  value,
  onChange,
  elementType,
  flat = false,
}) => {
  const schemaPort = useGeometrySchemaPort();
  const useFHSSchema = useGeometryStore((state) => !!state.complianceSettings?.complianceValidationEnabled);
  const valueKey = useMemo(() => JSON.stringify(value ?? null), [value]);
  const parsed = parseFancoilTestData(value);
  const [draft, setDraft] = useKeyedState(valueKey, {
    form: parsed,
    /** Draft strings for power_output per row — committed on blur so commas survive while typing. */
    powerOutput: parsed.fan_speed_data.map((row) => powerOutputToText(row.power_output)),
  });
  const { form, powerOutput: poDraft } = draft;
  const setForm = useCallback((next: FancoilTestDataValue) => {
    setDraft((current) => ({ ...current, form: next }));
  }, [setDraft]);
  const setPoDraft = useCallback<React.Dispatch<React.SetStateAction<string[]>>>((action) => {
    setDraft((current) => ({
      ...current,
      powerOutput: typeof action === 'function' ? action(current.powerOutput) : action,
    }));
  }, [setDraft]);

  const compact = Boolean(flat);
  const resolveFancoilField = (propertyKey: string, label: string) => resolveFieldPresentation({
    mode: useFHSSchema ? 'fhs' : 'core',
    propertyKey,
    elementType,
    subtype: 'fancoil',
    label,
  }, schemaPort);
  const temperaturePresentation = resolveFancoilField('temperature_diff', 'ΔT (K)');
  const outputPresentation = resolveFancoilField('power_output', 'Power output (kW)');
  const fanPowerPresentation = resolveFancoilField('fan_power_W', 'Fan power (W)');

  const commit = useCallback(
    (next: FancoilTestDataValue) => {
      const ser = serialiseFancoilTestData(next);
      setForm(ser);
      onChange(ser);
    },
    [onChange, setForm],
  );

  const addSpeedRow = () => {
    const nextRows = [...form.fan_speed_data, { temperature_diff: 1, power_output: [0] }];
    setPoDraft((p) => [...p, '0']);
    commit({ ...form, fan_speed_data: nextRows });
  };

  const removeSpeedRow = (index: number) => {
    if (form.fan_speed_data.length <= 1) return;
    const nextRows = form.fan_speed_data.filter((_, i) => i !== index);
    setPoDraft((p) => p.filter((_, i) => i !== index));
    commit({ ...form, fan_speed_data: nextRows });
  };

  const updateFanPower = (index: number, w: number) => {
    const next = [...form.fan_power_W];
    next[index] = w > 0 ? w : 1;
    commit({ ...form, fan_power_W: next });
  };

  const addFanPower = () => {
    commit({ ...form, fan_power_W: [...form.fan_power_W, 1] });
  };

  const removeFanPower = (index: number) => {
    if (form.fan_power_W.length <= 1) return;
    commit({ ...form, fan_power_W: form.fan_power_W.filter((_, i) => i !== index) });
  };

  return (
    <div data-field-key="fancoil_test_data" style={{ width: '100%', marginBottom: compact ? '8px' : '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
        {renderFieldLabelWithTooltip('Fancoil test data', elementType)}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: '8px' }}>
        Per FHS: each test point has a flow/return temperature difference (K) and one or more heat outputs (kW).
        Fan power (W) entries align with test indices. Use comma-separated kW values for multiple outputs at one ΔT.
      </div>

      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>Fan speed test points</div>
      {form.fan_speed_data.map((row, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr auto',
            gap: 8,
            alignItems: 'end',
            margin: ROW_MARGIN(compact),
          }}
        >
          <div>
            <div style={{ fontSize: 11, marginBottom: 4, color: 'var(--text-secondary)' }}>
              <ResolvedFieldLabel presentation={temperaturePresentation} useFHSSchema={useFHSSchema} />
            </div>
            <StandardInput
              type="number"
              unit={fieldUnitForAdornment(temperaturePresentation)}
              value={String(row.temperature_diff)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                const td = Number.isFinite(v) && v > 0 ? v : 1;
                const nextRows = form.fan_speed_data.map((r, j) => (j === i ? { ...r, temperature_diff: td } : r));
                commit({ ...form, fan_speed_data: nextRows });
              }}
              step="0.1"
              min="0.01"
              variant="ghost"
              size="md"
            />
          </div>
          <div>
            <div style={{ fontSize: 11, marginBottom: 4, color: 'var(--text-secondary)' }}>
              <ResolvedFieldLabel presentation={outputPresentation} useFHSSchema={useFHSSchema} />
            </div>
            <StandardInput
              type="text"
              unit={fieldUnitForAdornment(outputPresentation)}
              value={poDraft[i] ?? powerOutputToText(row.power_output)}
              onChange={(e) => {
                const text = e.target.value;
                setPoDraft((d) => {
                  const copy = [...d];
                  copy[i] = text;
                  return copy;
                });
              }}
              onBlur={() => {
                const text = poDraft[i] ?? powerOutputToText(row.power_output);
                const powers = textToPowerOutput(text);
                const nextRows = form.fan_speed_data.map((r, j) =>
                  j === i ? { ...r, power_output: powers } : r,
                );
                setPoDraft((d) => {
                  const copy = [...d];
                  copy[i] = powerOutputToText(powers);
                  return copy;
                });
                commit({ ...form, fan_speed_data: nextRows });
              }}
              placeholder="e.g. 0, 1.2, 2.5"
              variant="ghost"
              size="md"
            />
          </div>
          <button
            type="button"
            className="btn btn-nav btn-small"
            disabled={form.fan_speed_data.length <= 1}
            onClick={() => removeSpeedRow(i)}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-nav btn-small" style={{ marginTop: 4 }} onClick={addSpeedRow}>
        Add test point
      </button>

      <div style={{ fontWeight: 600, fontSize: 12, margin: '12px 0 4px' }}>
        <ResolvedFieldLabel presentation={fanPowerPresentation} useFHSSchema={useFHSSchema} />
      </div>
      {form.fan_power_W.map((w, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 8,
            alignItems: 'end',
            margin: ROW_MARGIN(compact),
          }}
        >
          <StandardInput
            type="number"
            unit={fieldUnitForAdornment(fanPowerPresentation)}
            value={String(w)}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              updateFanPower(i, Number.isFinite(v) ? v : 1);
            }}
            step="0.1"
            min="0.01"
            variant="ghost"
            size="md"
          />
          <button
            type="button"
            className="btn btn-nav btn-small"
            disabled={form.fan_power_W.length <= 1}
            onClick={() => removeFanPower(i)}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-nav btn-small" style={{ marginTop: 4 }} onClick={addFanPower}>
        Add fan power step
      </button>

      <button
        type="button"
        className="btn btn-nav btn-small"
        style={{ marginTop: 10 }}
        onClick={() => {
          const d = defaultFancoilTestData();
          setPoDraft(d.fan_speed_data.map((r) => powerOutputToText(r.power_output)));
          commit(d);
        }}
      >
        Reset to minimal example
      </button>
    </div>
  );
};
