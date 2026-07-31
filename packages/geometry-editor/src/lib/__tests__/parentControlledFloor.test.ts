// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element, Floor } from '../../geometry/types';
import {
  getFloorControlParentElement,
  getParentControlledFloorZ,
  isElementFloorControlledByParent,
  preservesCoordinateZForParentControlledFloor,
} from '../parentControlledFloor';

const floors: Pick<Floor, 'id' | 'zIndex'>[] = [
  { id: 'floor-ground', zIndex: 0 },
  { id: 'floor-l1', zIndex: 1 },
];

function externalWall(overrides: Record<string, unknown> = {}): Element {
  return {
    id: 'wall-1',
    name: 'External Wall 1',
    type: 'BuildingElementOpaque',
    coordinates: [
      { x: 0, y: 0, z: 1 },
      { x: 4, y: 0, z: 1 },
    ],
    is_external_door: false,
    parent_element: null,
    ...overrides,
  } as unknown as Element;
}

function mvhrTerminal(overrides: Record<string, unknown> = {}): Element {
  return {
    id: 'terminal-1',
    name: 'MVHR intake terminal',
    type: 'MechanicalVentilationTerminal',
    terminal_type: 'intake',
    parent_element: 'MVHR 1',
    host_element: 'External Wall 1',
    coordinates: [{ x: 1, y: 0, z: 2.2 }],
    floorId: 'floor-ground',
    ...overrides,
  } as unknown as Element;
}

describe('parentControlledFloor', () => {
  it('treats hosted MVHR terminals as floor-controlled by their mounted host', () => {
    const host = externalWall();
    const terminal = mvhrTerminal();
    const elementsById = {
      [host.id]: host,
      [terminal.id]: terminal,
    };

    expect(getFloorControlParentElement(terminal, elementsById)).toBe(host);
    expect(isElementFloorControlledByParent(terminal, elementsById)).toBe(true);
    expect(getParentControlledFloorZ(terminal, elementsById, floors)).toBe(1);
    expect(preservesCoordinateZForParentControlledFloor(terminal)).toBe(true);
  });

  it('does not floor-control an MVHR terminal from a non-host reference', () => {
    const door = externalWall({
      id: 'door-1',
      name: 'External Door 1',
      is_external_door: true,
    });
    const terminal = mvhrTerminal({ host_element: 'External Door 1' });

    expect(getFloorControlParentElement(terminal, {
      [door.id]: door,
      [terminal.id]: terminal,
    })).toBeNull();
  });
});
