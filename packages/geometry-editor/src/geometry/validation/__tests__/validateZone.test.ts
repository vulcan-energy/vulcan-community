// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { validateZone } from '../validateZone';
import type { Element, Zone } from '../../types';

const NO_TB_WARNING =
  'No thermal bridging — junction heat loss is 0; tick Simplified ψ or add thermal bridges';

const zone: Zone = {
  id: 'z1',
  name: 'Living',
  floorArea: 30,
  height: 2.4,
  volume: 72,
  simplifiedThermalBridging: false,
};
const wall = { id: 'w1', name: 'Wall', type: 'BuildingElementOpaque', zoneId: 'z1' } as Element;
const bridge = { id: 'tb1', name: 'E1', type: 'ThermalBridgeLinear', zoneId: 'z1' } as Element;

const tbWarnings = (z: Zone, elementsById: Record<string, Element>, compliance = false) =>
  validateZone(z, { elementsById, complianceValidationEnabled: compliance })
    .warnings.filter((w) => w.fieldKey === 'simplifiedThermalBridging')
    .map((w) => w.message);

describe('validateZone thermal bridging', () => {
  it('warns that junction heat loss is 0 when a zone has no TB and simplified is off', () => {
    expect(tbWarnings(zone, { w1: wall })).toEqual([NO_TB_WARNING]);
  });

  it('does not warn when simplified ψ is ticked or bridges exist', () => {
    expect(tbWarnings({ ...zone, simplifiedThermalBridging: true }, { w1: wall })).toEqual([]);
    expect(tbWarnings(zone, { w1: wall, tb1: bridge })).toEqual([]);
  });

  it('leaves compliance mode to its FHS issue', () => {
    const result = validateZone(zone, { elementsById: { w1: wall }, complianceValidationEnabled: true });
    expect(result.issues.map((i) => i.message)).toContain('FHS: Simplified ψ or TB elements required');
    expect(tbWarnings(zone, { w1: wall }, true)).toEqual([]);
  });
});
