// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element, MechanicalVentilationTerminal } from '../../geometry/types';
import {
  collectMvhrDuctTopologyWarnings,
  deriveMechanicalVentilationTerminalPosition,
  getMvhrDuctRoleStyle,
  isMvhrTerminalHost,
  MVHR_DUCT_ROLE_STYLES,
} from '../mvhrDuctwork';

describe('mvhrDuctwork helpers', () => {
  it('defines the required MVHR duct role styles', () => {
    expect(MVHR_DUCT_ROLE_STYLES).toEqual({
      supply: { stroke: '#4ADE80', strokeWidth: 2, dash: [] },
      extract: { stroke: '#22C55E', strokeWidth: 2, dash: [6, 4] },
      intake: { stroke: '#86EFAC', strokeWidth: 2, dash: [12, 5] },
      exhaust: { stroke: '#15803D', strokeWidth: 2, dash: [10, 4, 2, 4] },
    });
    expect(getMvhrDuctRoleStyle('unknown')).toEqual(MVHR_DUCT_ROLE_STYLES.supply);
  });

  it('derives terminal position from the mounted host and terminal z height', () => {
    const host = {
      id: 'window-1',
      name: 'Kitchen Window',
      type: 'BuildingElementTransparent',
      orientation360: 123.456,
      pitch: 88.889,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
    } as Element;
    const terminal = {
      id: 'terminal-1',
      name: 'Intake terminal',
      type: 'MechanicalVentilationTerminal',
      terminal_type: 'intake',
      parent_element: 'MVHR',
      host_element: 'Kitchen Window',
      coordinates: [{ x: 1, y: 0, z: 2.345 }],
    } as MechanicalVentilationTerminal;

    expect(isMvhrTerminalHost(host)).toBe(true);
    expect(deriveMechanicalVentilationTerminalPosition(terminal, host)).toEqual({
      mid_height_air_flow_path: 2.35,
      orientation360: 123.46,
      pitch: 88.89,
    });
  });

  it('derives a manually positioned terminal without a mounted host', () => {
    const terminal = {
      id: 'terminal-manual',
      name: 'Manual intake terminal',
      type: 'MechanicalVentilationTerminal',
      terminal_type: 'intake',
      parent_element: 'MVHR',
      host_element: null,
      orientation360: 315,
      pitch: 90,
      coordinates: [{ x: 12, y: 8, z: 4.2 }],
    } as MechanicalVentilationTerminal;

    expect(deriveMechanicalVentilationTerminalPosition(terminal, undefined)).toEqual({
      mid_height_air_flow_path: 4.2,
      orientation360: 315,
      pitch: 90,
    });
  });

  it('does not treat external doors as MVHR terminal hosts', () => {
    expect(
      isMvhrTerminalHost({
        id: 'door-1',
        name: 'External Door',
        type: 'BuildingElementOpaque',
        is_external_door: true,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
      } as Element),
    ).toBe(false);
  });

  it('collects MVHR duct topology warnings in 3D', () => {
    const warnings = collectMvhrDuctTopologyWarnings(
      [
        {
          name: 'Supply A',
          duct_type: 'supply',
          coordinates: [{ x: 0, y: 0, z: 2.4 }, { x: 1, y: 0, z: 2.4 }],
        },
        {
          name: 'Supply B',
          duct_type: 'supply',
          coordinates: [{ x: 10, y: 0, z: 2.4 }, { x: 11, y: 0, z: 2.4 }],
        },
        {
          name: 'Exhaust',
          duct_type: 'exhaust',
          coordinates: [{ x: 1, y: 0, z: 2.4 }, { x: 2, y: 0, z: 2.4 }],
        },
      ],
      {
        unitPoint: { x: 0, y: 0, z: 2.4 },
        unitLabel: 'MVHR 1',
      },
    );

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'disconnected-role', role: 'supply' }),
      expect.objectContaining({ kind: 'role-not-connected-to-unit', role: 'supply' }),
      expect.objectContaining({ kind: 'cross-role-endpoint-overlap' }),
    ]));
  });
});
