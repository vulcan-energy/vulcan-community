// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { defaultFancoilTestData, parseFancoilTestData, serialiseFancoilTestData } from '../fancoilTestData';

describe('fancoilTestData', () => {
  it('parses minimal object and fills fan_power_W', () => {
    const v = parseFancoilTestData({
      fan_speed_data: [{ temperature_diff: 2, power_output: [0.5, 1] }],
      fan_power_W: [],
    });
    expect(v.fan_speed_data).toHaveLength(1);
    expect(v.fan_speed_data[0].temperature_diff).toBe(2);
    expect(v.fan_speed_data[0].power_output).toEqual([0.5, 1]);
    expect(v.fan_power_W.length).toBeGreaterThan(0);
  });

  it('serialises and keeps temperature_diff > 0', () => {
    const s = serialiseFancoilTestData({
      fan_speed_data: [{ temperature_diff: 5, power_output: [1, 2] }],
      fan_power_W: [10, 20],
    });
    expect(s.fan_speed_data[0].temperature_diff).toBe(5);
    expect(s.fan_power_W).toEqual([10, 20]);
  });

  it('defaults invalid input', () => {
    const d = defaultFancoilTestData();
    expect(parseFancoilTestData(null)).toEqual(d);
    expect(parseFancoilTestData('x')).toEqual(d);
  });
});
