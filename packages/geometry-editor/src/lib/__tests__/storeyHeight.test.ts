// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element, Floor } from '../../geometry/types';
import { getStoreyHeight, storeyWallHeightPatches } from '../zoneDerivation';
import { isUnderRoof, storeyCopyName } from '../storeyCopy';

const wall = (id: string, z: number, height: number, extra: Partial<Element> = {}): Element => ({
  id,
  name: id,
  type: 'BuildingElementOpaque',
  width: 4,
  height,
  area: 4 * height,
  pitch: 90,
  coordinates: [{ x: 0, y: 0, z }, { x: 4, y: 0, z }],
  parent_element: null,
  ...extra,
} as Element);

const floor = (zIndex: number, height = 0, typed = false): Floor => ({
  id: `f${zIndex}`,
  name: String(zIndex),
  zIndex,
  height,
  isRoofSpace: false,
  ...(typed ? { heightUserOverride: true } : {}),
});

describe('getStoreyHeight', () => {
  it('takes the typed storey height first', () => {
    expect(getStoreyHeight(0, [floor(0, 2.5, true)], [wall('a', 0, 2.8)])).toBe(2.5);
  });

  it('else the height most of its walls stand at, by length, so a stair or knee wall does not set it', () => {
    const elements = [wall('a', 0, 2.4), wall('b', 0, 2.4), wall('stair', 0, 2.9), wall('knee', 0, 1.2)];
    expect(getStoreyHeight(0, [floor(0)], elements)).toBe(2.4);
  });

  it('breaks a tie towards the taller height', () => {
    expect(getStoreyHeight(0, [floor(0)], [wall('a', 0, 2.4), wall('b', 0, 2.6)])).toBe(2.6);
  });

  it('ignores doors and other storeys', () => {
    const door = wall('door', 0, 2.1, { is_external_door: true } as Partial<Element>);
    expect(getStoreyHeight(0, [floor(0), floor(1)], [door, door, wall('a', 0, 2.5), wall('b', 1, 2.7)])).toBe(2.5);
  });

  it('an empty storey takes the height of the storey below', () => {
    expect(getStoreyHeight(1, [floor(0, 2.5, true), floor(1)], [])).toBe(2.5);
    expect(getStoreyHeight(2, [floor(0), floor(1), floor(2)], [wall('a', 0, 2.7)])).toBe(2.7);
  });

  it('is 0 with nothing to go on', () => {
    expect(getStoreyHeight(0, [], [])).toBe(0);
  });
});

describe('storeyWallHeightPatches', () => {
  it('moves the walls at the old storey height and their area; others stay', () => {
    const elements = [wall('a', 0, 2.5), wall('b', 0, 3.1), wall('c', 1, 2.5)];
    expect(storeyWallHeightPatches(0, 2.5, 2.7, elements)).toEqual([
      { elementId: 'a', patch: { height: 2.7, area: 10.8 } },
    ]);
  });

  it('does nothing without an old height', () => {
    expect(storeyWallHeightPatches(0, 0, 2.7, [wall('a', 0, 0)])).toEqual([]);
  });
});

describe('storey copy', () => {
  it('names copies with the new storey', () => {
    expect(storeyCopyName('Wall (S) F2', 1, 2)).toBe('Wall (S) F3');
    expect(storeyCopyName('Wall (S)', 1, 2)).toBe('Wall (S) F3');
    expect(storeyCopyName('F20 store', 1, 2)).toBe('F20 store F3');
  });

  it('finds a roof rising through a storey base; an extension roof below it does not count', () => {
    const roof = (base: number, x = 0) => wall('Roof', 0, 4, {
      pitch: 30, base_height: base, coordinates: [{ x, y: -1, z: 0 }, { x: x + 4, y: -1, z: 0 }, { x: x + 4, y: 3, z: 0 }],
    } as Partial<Element>);
    const walls = [wall('a', 1, 2.5)];
    expect(isUnderRoof(5, [roof(5)], walls)).toBe(true);
    expect(isUnderRoof(5, [roof(2.5)], walls)).toBe(false);
    expect(isUnderRoof(5, [roof(7)], walls)).toBe(false);
    // A lean-to beside the walls rises through the base but does not cover them.
    expect(isUnderRoof(2.5, [roof(2.4, 4)], walls)).toBe(false);
    expect(isUnderRoof(2.5, [roof(2.4)], walls)).toBe(true);
  });
});
