// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Normalise `extra_json.fancoil_test_data` for FHS wet fancoil emitters
 * (`fan_speed_data[]` + `fan_power_W[]` per input_fhs).
 */

export type FancoilSpeedRow = { temperature_diff: number; power_output: number[] };

export type FancoilTestDataValue = {
  fan_speed_data: FancoilSpeedRow[];
  fan_power_W: number[];
};

function num(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = parseFloat(String(v ?? '').trim());
  return Number.isFinite(n) ? n : fallback;
}

function parsePowerOutputArray(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [0];
  const out = raw.map((x) => Math.max(0, num(x, 0)));
  return out.length > 0 ? out : [0];
}

/** Minimal valid defaults (matches batch smoke defaults). */
export function defaultFancoilTestData(): FancoilTestDataValue {
  return {
    fan_speed_data: [{ temperature_diff: 1, power_output: [0] }],
    fan_power_W: [1],
  };
}

export function parseFancoilTestData(raw: unknown): FancoilTestDataValue {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaultFancoilTestData();
  }
  const o = raw as Record<string, unknown>;
  const rows: FancoilSpeedRow[] = [];
  if (Array.isArray(o.fan_speed_data)) {
    for (const item of o.fan_speed_data) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const r = item as Record<string, unknown>;
      const temperature_diff = num(r.temperature_diff, NaN);
      if (!Number.isFinite(temperature_diff) || temperature_diff <= 0) continue;
      rows.push({
        temperature_diff,
        power_output: parsePowerOutputArray(r.power_output),
      });
    }
  }
  let fan_power_W: number[] = [];
  if (Array.isArray(o.fan_power_W)) {
    fan_power_W = o.fan_power_W.map((x) => num(x, NaN)).filter((n) => Number.isFinite(n) && n > 0);
  }
  if (rows.length === 0) {
    return defaultFancoilTestData();
  }
  if (fan_power_W.length === 0) {
    fan_power_W = [1];
  }
  return { fan_speed_data: rows, fan_power_W };
}

export function serialiseFancoilTestData(v: FancoilTestDataValue): FancoilTestDataValue {
  const fan_speed_data = (v.fan_speed_data || []).map((row) => ({
    temperature_diff: Math.max(1e-9, num(row.temperature_diff, 1)),
    power_output: parsePowerOutputArray(row.power_output),
  }));
  const fan_power_W = (v.fan_power_W || []).map((x) => Math.max(1e-9, num(x, 1)));
  if (fan_speed_data.length === 0) return defaultFancoilTestData();
  if (fan_power_W.length === 0) return { fan_speed_data, fan_power_W: [1] };
  return { fan_speed_data, fan_power_W };
}
