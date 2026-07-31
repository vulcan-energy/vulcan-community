// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  computeRuIso6946,
  initialRuCalculatorStateV1,
  parseRuCalculatorStateV1,
  sumAeUeFromAreaAndU,
  ruFromCorridorTable,
  ruFromGarageTable,
  ruFromStairwellTable,
} from '../unheatedSpaceRu';

describe('computeRuIso6946', () => {
  it('matches a worked garage-style check (order of magnitude)', () => {
    const ru = computeRuIso6946({
      areaInterfaceM2: 41.4,
      sumAeUeWperK: 41.4 * 1.6,
      volumeM3: 46.8,
      nAirChangesPerHour: 3,
    });
    expect(ru).not.toBeNull();
    expect(ru!).toBeGreaterThan(0.34);
    expect(ru!).toBeLessThan(0.38);
  });

  it('returns null for non-positive denominator', () => {
    expect(
      computeRuIso6946({
        areaInterfaceM2: 10,
        sumAeUeWperK: 0,
        volumeM3: 0,
        nAirChangesPerHour: 0,
      }),
    ).toBeNull();
  });
});

describe('tables', () => {
  it('garage inside/outside', () => {
    expect(ruFromGarageTable('single_full_three', 'inside')).toBe(0.7);
    expect(ruFromGarageTable('single_full_three', 'outside')).toBe(0.35);
  });

  it('stairwell', () => {
    expect(ruFromStairwellTable('exposed')).toBe(2.1);
    expect(ruFromStairwellTable('not_exposed')).toBe(2.5);
  });

  it('corridor', () => {
    expect(ruFromCorridorTable('exp_above_below')).toBe(0.6);
    expect(ruFromCorridorTable('not_exp_above_or_below')).toBe(0.7);
  });
});

describe('sumAeUeFromAreaAndU', () => {
  it('multiplies area and U', () => {
    expect(sumAeUeFromAreaAndU(10, 0.35)).toBeCloseTo(3.5);
  });

  it('returns null for invalid inputs', () => {
    expect(sumAeUeFromAreaAndU(-1, 1)).toBeNull();
    expect(sumAeUeFromAreaAndU(1, -1)).toBeNull();
  });
});

describe('parseRuCalculatorStateV1 + initialRuCalculatorStateV1', () => {
  it('round-trips formula snapshot', () => {
    const raw = {
      v: 1,
      mode: 'formula' as const,
      formula: {
        sumMode: 'split' as const,
        ai: '12',
        sumAeUe: '',
        exposedAe: '20',
        uManual: '0.3',
        exposedAssemblyId: 'wall-1',
        vol: '30',
        n: '2',
      },
      table: {
        tableCategory: 'stairwell' as const,
        garageRow: 'single_full_three' as const,
        garageEnvelope: 'outside' as const,
        stairwellFacing: 'exposed' as const,
        corridorRow: 'exp_above_below' as const,
      },
    };
    const parsed = parseRuCalculatorStateV1(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.formula.exposedAssemblyId).toBe('wall-1');
    expect(parsed!.table.tableCategory).toBe('stairwell');
  });

  it('prefills A_i from element area when saved ai is empty', () => {
    const persisted = parseRuCalculatorStateV1({
      v: 1,
      mode: 'formula',
      formula: {
        sumMode: 'combined',
        ai: '',
        sumAeUe: '1',
        exposedAe: '',
        uManual: '',
        exposedAssemblyId: '',
        vol: '2',
        n: '3',
      },
      table: {
        tableCategory: 'garage_single',
        garageRow: 'single_full_three',
        garageEnvelope: 'outside',
        stairwellFacing: 'exposed',
        corridorRow: 'exp_above_below',
      },
    });
    const merged = initialRuCalculatorStateV1(persisted, 15.5);
    expect(merged.formula.ai).toBe('15.5');
  });

  it('overwrites saved A_i with the current element area', () => {
    const persisted = parseRuCalculatorStateV1({
      v: 1,
      mode: 'formula',
      formula: {
        sumMode: 'combined',
        ai: '99',
        sumAeUe: '1',
        exposedAe: '',
        uManual: '',
        exposedAssemblyId: '',
        vol: '2',
        n: '3',
      },
      table: {
        tableCategory: 'garage_single',
        garageRow: 'single_full_three',
        garageEnvelope: 'outside',
        stairwellFacing: 'exposed',
        corridorRow: 'exp_above_below',
      },
    });
    const merged = initialRuCalculatorStateV1(persisted, 15.5);
    expect(merged.formula.ai).toBe('15.5');
  });
});
