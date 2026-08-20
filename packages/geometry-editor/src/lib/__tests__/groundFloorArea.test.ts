// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { deriveAutomaticGroundTotalAreas, groundTotalAreaMismatch } from '../groundFloorArea';

describe('ground floor total area derivation', () => {
  it('uses the selected object area even when another object is on the same storey', () => {
    const groundA = { id: 'ground-a', floorId: 'floor-0', area: 20 };
    const groundB = { id: 'ground-b', floorId: 'floor-0', area: 22.37 };

    const totals = deriveAutomaticGroundTotalAreas([groundA, groundB]);
    expect(totals.get('ground-a')).toBe(20);
    expect(totals.get('ground-b')).toBe(22.37);
  });

  it('sums same-storey fragments across zones in a multi-zone model', () => {
    const totals = deriveAutomaticGroundTotalAreas([
      { id: 'ground-a', zoneId: 'zone-a', floorId: 'floor-0', area: 20 },
      { id: 'ground-b', zoneId: 'zone-b', floorId: 'floor-0', area: 22.37 },
      { id: 'ground-c', zoneId: 'zone-b', floorId: 'floor-1', area: 31 },
    ]);

    expect(totals.get('ground-a')).toBe(42.37);
    expect(totals.get('ground-b')).toBe(42.37);
    expect(totals.get('ground-c')).toBe(31);
  });

  it('flags a manual value that differs from the auto-derived total', () => {
    expect(groundTotalAreaMismatch(45, 42.37)).toBe(true);
    expect(groundTotalAreaMismatch(42.375, 42.37)).toBe(false);
  });
});
