// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

/** R6 fence for the single-element paths that share Lighting/TB field semantics. */
import { describe, expect, it, vi } from 'vitest';
import type { Element } from '../../../geometry/types';
import { lightingFormModule } from '../lighting';
import { thermalBridgePointFormModule } from '../thermalBridgePoint';

const lighting = (fields: Record<string, unknown> = {}): Element => ({
  id: 'light', type: 'Lighting', name: 'light', coordinates: [{ x: 0, y: 0, z: 0 }], ...fields,
} as Element);

type LightingField = 'efficacy' | 'count' | 'power';
type LightingInput = 'efficacyInput' | 'countInput' | 'powerInput';

function hydrateLightingField(element: Element, input: LightingInput) {
  const state = {
    setLightingEntryMode: vi.fn(),
    setLightingGrade: vi.fn(),
    setLightingLampType: vi.fn(),
    efficacyInput: { setValue: vi.fn() },
    countInput: { setValue: vi.fn() },
    powerInput: { setValue: vi.fn() },
  };
  lightingFormModule.hydrate(state as never, element);
  const setValue = state[input].setValue;
  expect(setValue).toHaveBeenCalledTimes(1);
  return setValue.mock.calls[0]?.[0];
}

function lightingPrecedenceElement(
  field: LightingField,
  direct: number | null | undefined | 'omitted',
  led: number | null | undefined | 'omitted',
): Element {
  return lighting({
    ...(direct === 'omitted' ? {} : { [field]: direct }),
    bulbs: {
      led: led === 'omitted' ? {} : { [field]: led },
      incandescent: { [field]: 60 },
    },
  });
}

describe('R6 single-element field semantics', () => {
  it.each([
    ['efficacy', 'efficacyInput'],
    ['count', 'countInput'],
    ['power', 'powerInput'],
  ] as const)('hydrates %s once with exact direct/LED precedence and no incandescent fall-through', (field, input) => {
    const cases: Array<[
      string,
      number | null | undefined | 'omitted',
      number | null | undefined | 'omitted',
      number | '' | typeof Number.NaN,
    ]> = [
      ['direct value', 120, 80, 120],
      ['direct null', null, 80, 80],
      ['direct own undefined', undefined, 80, 80],
      ['direct omitted', 'omitted', 80, 80],
      ['direct NaN', Number.NaN, 80, Number.NaN],
      ['LED null', 'omitted', null, ''],
      ['LED own undefined', 'omitted', undefined, ''],
      ['LED omitted', 'omitted', 'omitted', ''],
      ['LED NaN', 'omitted', Number.NaN, Number.NaN],
    ];
    for (const [label, direct, led, expected] of cases) {
      const actual = hydrateLightingField(lightingPrecedenceElement(field, direct, led), input);
      if (typeof expected === 'number' && Number.isNaN(expected)) {
        expect(actual, label).toBeNaN();
      } else {
        expect(actual, label).toBe(expected);
      }
    }

    const incandescentOnly = hydrateLightingField(lighting({
      bulbs: { incandescent: { [field]: 60 } },
    }), input);
    expect(incandescentOnly).toBe(60);
  });

  it('normalises non-positive detailed values instead of persisting zero or negatives', () => {
    const state = {
      lightingEntryMode: 'detailed', lightingGrade: 'unknown', lightingLampType: 'LED',
      efficacyInput: { value: 0 }, countInput: { value: -1 }, powerInput: { value: 0 },
    };
    const data = lightingFormModule.buildElementData(state as never, {
      baseData: { id: 'new-light', type: 'Lighting', name: 'new-light' }, elementZoneId: 'zone',
    });
    expect(data).toMatchObject({ efficacy: undefined, count: undefined, power: undefined });
    expect(data.bulbs).toEqual({ led: { count: undefined, power: undefined, efficacy: undefined } });
    expect(Object.prototype.hasOwnProperty.call(data, 'efficacy')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(data, 'count')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(data, 'power')).toBe(true);
  });

  it('keeps the ThermalBridgePoint persisted model key and JSON byte shape', () => {
    const data = thermalBridgePointFormModule.buildElementData(
      { heatTransferCoeffInput: { value: 5.25 } } as never,
      { baseData: { id: 'point', type: 'ThermalBridgePoint', name: 'point' }, elementZoneId: 'zone' },
    );
    expect(data).toEqual({ id: 'point', type: 'ThermalBridgePoint', name: 'point', heat_transfer_coeff: 5.25 });
    expect(Object.keys(data)).toEqual(['id', 'type', 'name', 'heat_transfer_coeff']);
    expect(JSON.stringify(data)).toBe('{"id":"point","type":"ThermalBridgePoint","name":"point","heat_transfer_coeff":5.25}');
  });
});
