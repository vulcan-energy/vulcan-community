// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Appliance, Element, System } from '../../types';
import { detectMissingElements } from '../detectMissingElements';

function system(overrides: Partial<System>): System {
  return {
    id: 'system-1',
    name: 'Hot water',
    type: 'System',
    subcategory: 'HotWaterSource',
    parent_element: null,
    coordinates: [{ x: 0, y: 0, z: 0 }],
    isPlaceholder: false,
    ...overrides,
  };
}

function appliance(appliancekey: Appliance['appliancekey']): Appliance {
  return {
    id: `appliance-${appliancekey}`,
    name: appliancekey,
    type: 'Appliance',
    appliancekey,
    parent_element: null,
    coordinates: [{ x: 0, y: 0, z: 0 }],
    isPlaceholder: false,
  };
}

function byId(elements: Element[]): Record<string, Element> {
  return Object.fromEntries(elements.map((element) => [element.id, element]));
}

describe('detectMissingElements FHS payload rules', () => {
  it('keeps the HotWaterSource finding for a category-only system shell', () => {
    const hollowHotWaterSource = system({ extra_json: undefined });

    const findings = detectMissingElements([], byId([hollowHotWaterSource]), true);

    expect(findings.some((finding) => finding.path === '/HotWaterSource')).toBe(true);
  });

  it('accepts a wrapped StorageTank HotWaterSource payload', () => {
    const storageTank = system({
      extra_json: {
        HotWaterSource: {
          'hw cylinder': {
            type: 'StorageTank',
          },
        },
      },
    });

    const findings = detectMissingElements([], byId([storageTank]), true);

    expect(findings.some((finding) => finding.path === '/HotWaterSource')).toBe(false);
  });

  it('does not count a HotWaterSource-shaped payload on a subcategory the builder ignores', () => {
    const unrelatedSystem = system({
      subcategory: 'SpaceCoolSystem',
      extra_json: {
        HotWaterSource: {
          'hw cylinder': {
            type: 'StorageTank',
          },
        },
      },
    });

    const findings = detectMissingElements([], byId([unrelatedSystem]), true);

    expect(findings.some((finding) => finding.path === '/HotWaterSource')).toBe(true);
  });

  it('requires a Fridge or Fridge-Freezer when another appliance is authored', () => {
    const findings = detectMissingElements([], byId([appliance('Oven')]), true);

    expect(findings).toContainEqual(expect.objectContaining({
      type: 'Appliance',
      path: '/Appliances/FridgeOrFridgeFreezer',
      requiredBy: 'fhs',
    }));
  });

  it.each(['Fridge', 'Fridge-Freezer'] as const)(
    'accepts %s as the required refrigeration appliance',
    (appliancekey) => {
      const findings = detectMissingElements([], byId([appliance(appliancekey)]), true);

      expect(
        findings.some((finding) => finding.path === '/Appliances/FridgeOrFridgeFreezer'),
      ).toBe(false);
    },
  );

  it('offers primary pipework for a heat source and cylinder with none, planned as a batch', () => {
    const floors = [{ id: 'f0', name: '0', zIndex: 0, height: 2.5, heightUserOverride: true, isRoofSpace: false }];
    const ground = { id: 'g', name: 'Ground', type: 'BuildingElementGround', coordinates: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 8, z: 0 }] } as unknown as Element;
    const heatPump = system({ id: 'hp', name: 'Heat Pump', subcategory: 'HeatSourceWet', extra_json: { HeatSourceWet: { hp: { type: 'HeatPump' } } } });
    const cylinder = (type: string) => system({ id: 'cyl', name: 'Cylinder', coordinates: [{ x: 6, y: 1, z: 0 }],
      extra_json: { HotWaterSource: { 'hw cylinder': { type, HeatSource: { hp: { type: 'HeatSourceWet', name: 'hp' } } } } } });
    const row = (elements: Element[]) => detectMissingElements([], byId(elements), true, undefined, undefined, floors)
      .find((finding) => finding.type === 'WaterPipework');

    expect(row(['StorageTank'].map(cylinder).concat(ground, heatPump))).toMatchObject({
      requiredBy: 'fhs', message: 'FHS: Cylinder has no primary pipework', pillQualifier: 'Primary',
      batchPlan: { summary: '2 pipework elements' },
    });
    expect(row([cylinder('CombiBoiler'), ground, heatPump])).toBeUndefined();
    // The row names the cylinder of the first pair that plans pipes: 'a' sits 2 cm from the heat pump.
    const tooClose = { ...cylinder('StorageTank'), id: 'a', name: 'Next to the heat pump', coordinates: [{ x: 0.02, y: 0, z: 0 }] };
    expect(row([tooClose, { ...cylinder('StorageTank'), id: 'b' }, ground, heatPump])?.message).toBe('FHS: Cylinder has no primary pipework');
  });
});
