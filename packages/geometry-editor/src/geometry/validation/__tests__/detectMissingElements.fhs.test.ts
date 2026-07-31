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
});
