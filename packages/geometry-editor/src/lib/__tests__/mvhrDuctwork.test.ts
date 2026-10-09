// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type {
  Element,
  ElementDraft,
  Floor,
  MechanicalVentilation,
  MechanicalVentilationDuctwork,
  MechanicalVentilationTerminal,
  SpaceLabel,
} from '../../geometry/types';
import { findLinearThermalBridgeIssues } from '../../geometry/thermalBridge/findLinearThermalBridgeIssues';
import {
  collectMvhrDuctTopologyWarnings,
  planAutoDucts,
  deriveMechanicalVentilationTerminalPosition,
  getMvhrDuctRoleStyle,
  isMvhrTerminalHost,
  looseDuctRunEndNearestUnit,
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

  it('treats a near-miss duct end as disconnected', () => {
    const warnings = collectMvhrDuctTopologyWarnings(
      [
        { name: 'Supply A', duct_type: 'supply', coordinates: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] },
        { name: 'Supply B', duct_type: 'supply', coordinates: [{ x: 1.01, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }] },
      ],
      { unitPoint: { x: 0, y: 0.01, z: 0 } },
    );

    expect(warnings.map((warning) => warning.kind)).toEqual(['disconnected-role', 'role-not-connected-to-unit']);
  });

  it('marks a loose run at its free end nearest the unit, never at an interior joint', () => {
    const unit = { type: 'MechanicalVentilation', id: 'mv', name: 'MV', vent_type: 'MVHR', coordinates: [{ x: 0, y: 0, z: 0 }] };
    const duct = (id: string, a: [number, number], b: [number, number]) => ({
      type: 'MechanicalVentilationDuctwork', id, name: id, parent_element: 'MV', duct_type: 'supply',
      coordinates: [{ x: a[0], y: a[1], z: 0 }, { x: b[0], y: b[1], z: 0 }],
    });
    const legA = duct('a', [3, 0], [0.5, 0.5]);
    const elements = [unit, legA, duct('b', [0.5, 0.5], [3, 5])] as unknown as Element[];

    expect(looseDuctRunEndNearestUnit(legA as unknown as MechanicalVentilationDuctwork, elements))
      .toEqual({ x: 3, y: 0, z: 0 });
  });
});

describe('planAutoDucts', () => {
  const floors = [
    { id: 'f0', name: '0', zIndex: 0, height: 2.5, isRoofSpace: false },
    { id: 'f1', name: '1', zIndex: 1, height: 2.5, isRoofSpace: false },
  ] as Floor[];
  const unit = (vent_type: MechanicalVentilation['vent_type'] = 'MVHR') => ({
    id: 'mv', name: 'MV', type: 'MechanicalVentilation', vent_type, parent_element: null, floorId: 'f0',
    coordinates: [{ x: 0, y: 0, z: 0 }],
  }) as MechanicalVentilation;
  const host = (id: string, type: string, a: [number, number], b: [number, number]) => ({
    id, name: id, type, parent_element: null, floorId: 'f0',
    coordinates: [{ x: a[0], y: a[1], z: 0 }, { x: b[0], y: b[1], z: 0 }],
  }) as Element;
  const hosts = [host('Wall N', 'BuildingElementOpaque', [-5, -2], [5, -2]), host('Win E', 'BuildingElementTransparent', [7, -5], [7, 5])];
  const room = (id: string, room_type: string, storey: number, x: number, y: number) => ({
    id, name: id, zoneId: 'z', storey, room_type,
    coordinates: [{ x, y, z: 0 }, { x: x + 2, y, z: 0 }, { x: x + 2, y: y + 2, z: 0 }, { x, y: y + 2, z: 0 }],
  }) as SpaceLabel;
  const rooms = [
    room('b-kitchen', 'kitchen', 0, 4, 2), // centre (5, 3): L, x first
    room('e-bath', 'bathroom', 0, 8, 2), // centre (9, 3): first leg overlaps the kitchen's
    room('a-living', 'living_room', 0, -4, -1), // centre (-3, 0): on-axis, one leg
    room('c-bed', 'bedroom', 1, 0, 4), // centre (1, 5), upstairs: L then a riser
    room('d-hall', 'hall', 0, 0, 8), // no role
  ];
  const segs = (drafts: ElementDraft[], role: string) =>
    drafts.filter((d) => d.duct_type === role).map((d) => d.coordinates);
  const asElements = (drafts: ElementDraft[]) =>
    drafts.map((d, i) => ({ ...d, id: `p${i}`, name: `P${i}` }) as Element);

  it('routes MVHR extract to wet rooms, supply to habitable rooms, and intake/exhaust to the nearest free hosts', () => {
    const drafts = planAutoDucts(unit(), [unit(), ...hosts], rooms, floors);
    expect(segs(drafts, 'extract')).toEqual([
      [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }], [{ x: 5, y: 0, z: 0 }, { x: 5, y: 3, z: 0 }],
      [{ x: 0, y: 0, z: 0 }, { x: 9, y: 0, z: 0 }], [{ x: 9, y: 0, z: 0 }, { x: 9, y: 3, z: 0 }],
    ]);
    expect(segs(drafts, 'supply')).toEqual([
      [{ x: 0, y: 0, z: 0 }, { x: -3, y: 0, z: 0 }],
      [{ x: 0, y: 0, z: 0 }, { x: 0, y: 5, z: 0 }], [{ x: 0, y: 5, z: 0 }, { x: 1, y: 5, z: 0 }],
      [{ x: 1, y: 5, z: 0 }, { x: 1, y: 5, z: 2.5 }],
    ]);
    expect(drafts.filter((d) => d.duct_type === 'supply').map((d) => d.floorId)).toEqual(['f0', 'f0', 'f0', 'f1']);
    expect(segs(drafts, 'intake')).toEqual([[{ x: 0, y: 0, z: 0 }, { x: 0, y: -2, z: 0 }]]);
    expect(segs(drafts, 'exhaust')).toEqual([[{ x: 0, y: 0, z: 0 }, { x: 7, y: 0, z: 0 }]]);
    expect(drafts.filter((d) => d.type === 'MechanicalVentilationTerminal')).toEqual([
      expect.objectContaining({ terminal_type: 'intake', host_element: 'Wall N', parent_element: 'MV', coordinates: [{ x: 0, y: -2, z: 0 }] }),
      expect.objectContaining({ terminal_type: 'exhaust', host_element: 'Win E', parent_element: 'MV', coordinates: [{ x: 7, y: 0, z: 0 }] }),
    ]);
    expect(drafts.filter((d) => d.type === 'MechanicalVentilationDuctwork').every((d) => d.parent_element === 'MV' && d.length! > 0)).toBe(true);
  });

  it('plans a connected network with no topology warnings or overlap errors, and fills only gaps on re-run', () => {
    const drafts = planAutoDucts(unit(), [unit(), ...hosts], rooms, floors);
    const ducts = drafts.filter((d) => d.type === 'MechanicalVentilationDuctwork') as unknown as MechanicalVentilationDuctwork[];
    expect(collectMvhrDuctTopologyWarnings(ducts, { unitPoint: { x: 0, y: 0, z: 0 } })).toEqual([]);
    const all = [unit(), ...hosts, ...asElements(drafts)];
    const overlaps = (els: Element[]) => findLinearThermalBridgeIssues(els).filter((i) => i.kind === 'overlap_duplicate_colinear_segment');
    expect(overlaps(all)).toEqual([]);
    expect(overlaps(all.slice(1))).not.toEqual([]); // the kitchen and bath legs overlap; only the unit exempts them

    expect(planAutoDucts(unit(), all, rooms, floors)).toEqual([]);
    const withoutBath = all.filter((el) => !(el.type === 'MechanicalVentilationDuctwork' && el.coordinates.some((p) => p.x === 9)));
    expect(segs(planAutoDucts(unit(), withoutBath, rooms, floors), 'extract')).toEqual(segs(drafts, 'extract').slice(2));
  });

  it('gives centralised MEV extract and exhaust only, and other unit types nothing', () => {
    const drafts = planAutoDucts(unit('Centralised continuous MEV'), hosts, rooms, floors);
    expect([...new Set(drafts.map((d) => d.duct_type ?? d.terminal_type))]).toEqual(['extract', 'exhaust']);
    expect(drafts.find((d) => d.type === 'MechanicalVentilationTerminal')?.host_element).toBe('Wall N');
    expect(planAutoDucts(unit('Decentralised continuous MEV'), hosts, rooms, floors)).toEqual([]);
    expect(planAutoDucts(unit('Intermittent MEV'), hosts, rooms, floors)).toEqual([]);
  });

  it('returns nothing without a unit point, and only intake/exhaust without space labels', () => {
    expect(planAutoDucts({ ...unit(), coordinates: [] }, hosts, rooms, floors)).toEqual([]);
    expect(planAutoDucts(unit(), [], [], floors)).toEqual([]);
    const drafts = planAutoDucts(unit(), hosts, [], floors);
    expect(drafts.map((d) => d.duct_type ?? d.terminal_type)).toEqual(['intake', 'intake', 'exhaust', 'exhaust']);
  });

  it('is deterministic whatever the label order', () => {
    expect(planAutoDucts(unit(), hosts, [...rooms].reverse(), floors)).toEqual(planAutoDucts(unit(), hosts, rooms, floors));
  });
});
