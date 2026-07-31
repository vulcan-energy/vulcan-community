// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { resolveTargetZoneIdForNewCanvasElement } from '../resolveTargetZoneForNewElement';
import type { Zone } from '../../geometry/types';

describe('resolveTargetZoneIdForNewCanvasElement', () => {
  const z1: Zone = {
    id: 'a',
    name: 'A',
    floorArea: 10,
    height: 2.4,
    simplifiedThermalBridging: false,
    isPlaceholder: false,
  };
  const z2: Zone = {
    id: 'b',
    name: 'B',
    floorArea: 8,
    height: 2.4,
    simplifiedThermalBridging: false,
    isPlaceholder: false,
  };

  it('uses selected zone when selection is a zone', () => {
    expect(
      resolveTargetZoneIdForNewCanvasElement(
        [z1, z2],
        { type: 'zone', id: 'b' },
        {},
        () => 'new'
      )
    ).toBe('b');
  });

  it('uses zone of selected element', () => {
    expect(
      resolveTargetZoneIdForNewCanvasElement(
        [z1, z2],
        { type: 'element', id: 'wall-1' },
        { 'wall-1': { zoneId: 'b' } },
        () => 'new'
      )
    ).toBe('b');
  });

  it('uses zone of selected global element when set (e.g. System)', () => {
    expect(
      resolveTargetZoneIdForNewCanvasElement(
        [z1, z2],
        { type: 'global', id: 'sys-1' },
        { 'sys-1': { zoneId: 'b' } },
        () => 'new'
      )
    ).toBe('b');
  });

  it('prefers first non-placeholder zone over zones[0] when no selection', () => {
    const ph: Zone = { ...z1, id: 'ph', isPlaceholder: true };
    expect(
      resolveTargetZoneIdForNewCanvasElement(
        [ph, z2],
        null,
        {},
        () => 'new'
      )
    ).toBe('b');
  });

  it('creates a zone when list is empty', () => {
    expect(resolveTargetZoneIdForNewCanvasElement([], null, {}, () => 'fresh')).toBe('fresh');
  });
});
