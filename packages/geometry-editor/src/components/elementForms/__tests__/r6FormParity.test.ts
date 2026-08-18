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

describe('R6 single-element field semantics', () => {
  it('reads direct Lighting values first, then prefers the LED record over incandescent', () => {
    const hydrate = (element: Element) => {
      const state = {
        setLightingEntryMode: vi.fn(),
        setLightingGrade: vi.fn(),
        setLightingLampType: vi.fn(),
        efficacyInput: { setValue: vi.fn() },
        countInput: { setValue: vi.fn() },
        powerInput: { setValue: vi.fn() },
      };
      lightingFormModule.hydrate(state as never, element);
      return state;
    };
    expect(hydrate(lighting({ efficacy: 120, bulbs: {
      led: { efficacy: 80 }, incandescent: { efficacy: 60 },
    } })).efficacyInput.setValue).toHaveBeenCalledWith(120);
    expect(hydrate(lighting({ bulbs: {
      led: { efficacy: 80 }, incandescent: { efficacy: 60 },
    } })).efficacyInput.setValue).toHaveBeenCalledWith(80);
    expect(hydrate(lighting({ efficacy: null, bulbs: {
      led: { efficacy: 80 }, incandescent: { efficacy: 60 },
    } })).efficacyInput.setValue).toHaveBeenCalledWith(80);
    expect(hydrate(lighting({ efficacy: undefined, bulbs: {
      led: { efficacy: 80 }, incandescent: { efficacy: 60 },
    } })).efficacyInput.setValue).toHaveBeenCalledWith(80);
    expect(hydrate(lighting({ bulbs: {
      incandescent: { efficacy: 60 },
    } })).efficacyInput.setValue).toHaveBeenCalledWith(60);
    expect(hydrate(lighting({ bulbs: {
      led: { count: 2 }, incandescent: { efficacy: 60 },
    } })).efficacyInput.setValue).toHaveBeenCalledWith('');
    const nonFinite = hydrate(lighting({ efficacy: Number.NaN, bulbs: {
      led: { efficacy: 80 },
    } }));
    expect(nonFinite.efficacyInput.setValue.mock.calls[0]?.[0]).toBeNaN();
  });

  it.each([
    ['count', 'countInput', 4, 2, 1],
    ['power', 'powerInput', 8, 6, 3],
  ] as const)(
    'reads direct %s first, then prefers the LED record, while retaining direct NaN',
    (field, inputKey, direct, led, incandescent) => {
      const hydrate = (element: Element) => {
        const state = {
          setLightingEntryMode: vi.fn(),
          setLightingGrade: vi.fn(),
          setLightingLampType: vi.fn(),
          efficacyInput: { setValue: vi.fn() },
          countInput: { setValue: vi.fn() },
          powerInput: { setValue: vi.fn() },
        };
        lightingFormModule.hydrate(state as never, element);
        return state[inputKey].setValue;
      };
      expect(hydrate(lighting({
        [field]: direct,
        bulbs: { led: { [field]: led }, incandescent: { [field]: incandescent } },
      }))).toHaveBeenCalledWith(direct);
      expect(hydrate(lighting({
        [field]: null,
        bulbs: { led: { [field]: led }, incandescent: { [field]: incandescent } },
      }))).toHaveBeenCalledWith(led);
      expect(hydrate(lighting({
        [field]: undefined,
        bulbs: { led: { [field]: led }, incandescent: { [field]: incandescent } },
      }))).toHaveBeenCalledWith(led);
      expect(hydrate(lighting({
        bulbs: { incandescent: { [field]: incandescent } },
      }))).toHaveBeenCalledWith(incandescent);
      const unrelatedLedField = field === 'count' ? { power: 6 } : { count: 2 };
      expect(hydrate(lighting({
        bulbs: { led: unrelatedLedField, incandescent: { [field]: incandescent } },
      }))).toHaveBeenCalledWith('');
      const nonFinite = hydrate(lighting({
        [field]: Number.NaN,
        bulbs: { led: { [field]: led } },
      }));
      expect(nonFinite.mock.calls[0]?.[0]).toBeNaN();
    },
  );

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
