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
  defaultMvhrTerminalZ,
  planAutoDucts,
  deriveMechanicalVentilationTerminalPosition,
  getMvhrDuctRoleStyle,
  hostedMvhrTerminalDraft,
  isMvhrTerminalHost,
  looseDuctRunEndNearestUnit,
  MVHR_DUCT_ROLE_STYLES,
  planPrimaryPipework,
  primaryPipeRunGap,
  terminalConnectsToDuctEndpoint,
} from '../mvhrDuctwork';
import { networkPoint3 } from '../elementCanvasFloor';

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

    expect(looseDuctRunEndNearestUnit(legA as unknown as MechanicalVentilationDuctwork, elements, []))
      .toEqual({ x: 3, y: 0, z: 0 });
  });

  it('connects a terminal only to a duct end within the 5 mm rule', () => {
    const terminal = { coordinates: [{ x: 1, y: 0, z: 2.4 }] } as MechanicalVentilationTerminal;
    const duct = (z: number) => ({ coordinates: [{ x: 0, y: 0, z: 0 }, { x: 1.004, y: 0, z }] }) as MechanicalVentilationDuctwork;
    expect(terminalConnectsToDuctEndpoint(terminal, [duct(2.404)])).toBe(true);
    expect(terminalConnectsToDuctEndpoint(terminal, [duct(2.2)])).toBe(false); // within the old 0.35 m, now loose
  });
});

describe('storey-index points in metres', () => {
  // A basement, a ground floor, and a first floor whose base is overridden (a split level).
  const floors = [
    { id: 'b', name: 'B', zIndex: -1, height: 2.6, isRoofSpace: false },
    { id: 'g', name: 'G', zIndex: 0, height: 2.5, isRoofSpace: false },
    { id: 'u', name: 'U', zIndex: 1, height: 2.5, isRoofSpace: false, baseHeight: 3.1, baseHeightUserOverride: true },
  ] as Floor[];
  const point = (type: string, z: number, floorId?: string) =>
    ({ id: type, name: type, type, floorId, coordinates: [{ x: 1, y: 2, z }] }) as unknown as Element;

  it('places a unit or plant at its storey base height and leaves metre-z types alone', () => {
    expect(networkPoint3(point('MechanicalVentilation', 0, 'g'), floors)).toEqual({ x: 1, y: 2, z: 0 });
    expect(networkPoint3(point('MechanicalVentilation', 1, 'u'), floors)).toEqual({ x: 1, y: 2, z: 3.1 });
    expect(networkPoint3(point('System', -1), floors)).toEqual({ x: 1, y: 2, z: -2.6 });
    expect(networkPoint3(point('MechanicalVentilationTerminal', 2.4, 'u'), floors)).toEqual({ x: 1, y: 2, z: 2.4 });
    expect(networkPoint3(point('ThermalBridgePoint', 0.5, 'u'), floors)).toEqual({ x: 1, y: 2, z: 0.5 });
  });

  it('puts a new terminal 2.4 m above its storey base', () => {
    expect(defaultMvhrTerminalZ(0)).toBe(2.4);
    expect(defaultMvhrTerminalZ(3.1)).toBe(5.5);
    expect(defaultMvhrTerminalZ(-2.6)).toBe(-0.2);
    const wallUp = { id: 'w', name: 'W', type: 'BuildingElementOpaque', floorId: 'u', coordinates: [{ x: 0, y: 0, z: 1 }, { x: 4, y: 0, z: 1 }] } as Element;
    const draft = hostedMvhrTerminalDraft('intake', 'MV', wallUp, { x: 1.234, y: 0 }, floors);
    expect(draft.coordinates).toEqual([{ x: 1.234, y: 0, z: 5.5 }]);
    // mid_height_air_flow_path follows the terminal's z.
    expect(deriveMechanicalVentilationTerminalPosition(draft as MechanicalVentilationTerminal, wallUp)?.mid_height_air_flow_path).toBe(5.5);
  });
});

describe('planAutoDucts', () => {
  const floors = [
    { id: 'f0', name: '0', zIndex: 0, height: 2.5, isRoofSpace: false },
    { id: 'f1', name: '1', zIndex: 1, height: 2.5, isRoofSpace: false },
  ] as Floor[];
  const unit = (vent_type: MechanicalVentilation['vent_type'] = 'MVHR', x = 0, y = 0) => ({
    id: 'mv', name: 'MV', type: 'MechanicalVentilation', vent_type, parent_element: null, floorId: 'f0',
    coordinates: [{ x, y, z: 0 }],
  }) as MechanicalVentilation;
  const host = (id: string, type: string, a: [number, number], b: [number, number]) => ({
    id, name: id, type, parent_element: null, floorId: 'f0',
    coordinates: [{ x: a[0], y: a[1], z: 0 }, { x: b[0], y: b[1], z: 0 }],
  }) as Element;
  const hosts = [host('Wall N', 'BuildingElementOpaque', [-5, -2], [5, -2]), host('Win E', 'BuildingElementTransparent', [7, -5], [7, 5])];
  const room = (id: string, room_type: string, storey: number, x: number, y: number, w = 2) => ({
    id, name: id, zoneId: 'z', storey, room_type,
    coordinates: [{ x, y, z: 0 }, { x: x + w, y, z: 0 }, { x: x + w, y: y + 2, z: 0 }, { x, y: y + 2, z: 0 }],
  }) as SpaceLabel;
  const rooms = [
    room('b-kitchen', 'kitchen', 0, 4, 2), // extract run 0: centre (5, 3), L with x first
    room('e-bath', 'bathroom', 0, 8, 2), // extract run 1: staggered to (9.05, 3.05)
    room('a-living', 'living_room', 0, -4, -1), // run 2 (indices span roles): (-3, 0) staggered to (-2.9, 0.1)
    room('c-bed', 'bedroom', 1, 0, 4), // first floor: L at the unit height, riser at the room end
    room('d-hall', 'hall', 0, 0, 8), // no role
  ];
  const p = (x: number, y: number, z = 0) => ({ x, y, z });
  const segs = (drafts: ElementDraft[], role: string) =>
    drafts.filter((d) => d.duct_type === role).map((d) => d.coordinates);
  const asElements = (drafts: ElementDraft[]) =>
    drafts.map((d, i) => ({ ...d, id: `p${i}`, name: `P${i}` }) as Element);
  const overlaps = (els: Element[]) =>
    findLinearThermalBridgeIssues(els, floors).filter((i) => i.kind === 'overlap_duplicate_colinear_segment');
  const ducts = (drafts: ElementDraft[]) =>
    drafts.filter((d) => d.type === 'MechanicalVentilationDuctwork') as unknown as MechanicalVentilationDuctwork[];

  it('routes extract to wet rooms and supply to habitable rooms on the unit storey, with staggered room ends', () => {
    const drafts = planAutoDucts(unit(), [unit(), ...hosts], rooms, floors);
    expect(segs(drafts, 'extract')).toEqual([
      [p(0, 0), p(5, 0)], [p(5, 0), p(5, 3)],
      [p(0, 0), p(9.05, 0)], [p(9.05, 0), p(9.05, 3.05)],
    ]);
    expect(segs(drafts, 'supply')).toEqual([
      [p(0, 0), p(-2.9, 0)], [p(-2.9, 0), p(-2.9, 0.1)],
      [p(0, 0), p(0, 5.15)], [p(0, 5.15), p(1.15, 5.15)], [p(1.15, 5.15), p(1.15, 5.15, 2.5)],
    ]);
    expect(drafts.every((d) => d.parent_element === 'MV')).toBe(true);
    // The riser belongs to the room's storey, every leg at the unit's height to the unit's.
    expect(drafts.filter((d) => d.floorId === 'f1').map((d) => d.coordinates)).toEqual([[p(1.15, 5.15), p(1.15, 5.15, 2.5)]]);
  });

  it('builds terminals like the unit panel and ends each terminal duct on the terminal point', () => {
    const drafts = planAutoDucts(unit(), [unit(), ...hosts], rooms, floors);
    expect(segs(drafts, 'intake')).toEqual([[p(0, 0), p(0, -2)], [p(0, -2), p(0, -2, 2.4)]]);
    expect(segs(drafts, 'exhaust')).toEqual([[p(0, 0), p(7, 0)], [p(7, 0), p(7, 0, 2.4)]]);
    expect(drafts.filter((d) => d.type === 'MechanicalVentilationTerminal')).toEqual([
      expect.objectContaining({ terminal_type: 'intake', host_element: 'Wall N', coordinates: [p(0, -2, 2.4)] }),
      expect.objectContaining({ terminal_type: 'exhaust', host_element: 'Win E', coordinates: [p(7, 0, 2.4)] }),
    ]);
    // A host taken by any unit's terminal is skipped; an existing terminal without a duct gets one.
    const other = { id: 't', name: 'T', type: 'MechanicalVentilationTerminal', terminal_type: 'intake', parent_element: 'Other', host_element: 'Wall N', coordinates: [p(1, -2, 2.4)] } as Element;
    const own = { ...other, id: 'o', name: 'O', terminal_type: 'exhaust', parent_element: 'MV', host_element: null, coordinates: [p(-3, 4, 1.5)] } as Element;
    const filled = planAutoDucts(unit(), [unit(), ...hosts, other, own], [], floors);
    expect(filled.find((d) => d.type === 'MechanicalVentilationTerminal')).toMatchObject({ terminal_type: 'intake', host_element: 'Win E' });
    expect(segs(filled, 'exhaust')).toEqual([[p(0, 0), p(0, 4)], [p(0, 4), p(-3, 4)], [p(-3, 4), p(-3, 4, 1.5)]]);
  });

  it('plans a connected network with no topology warnings or overlap errors, and fills only gaps on re-run', () => {
    const drafts = planAutoDucts(unit(), [unit(), ...hosts], rooms, floors);
    expect(collectMvhrDuctTopologyWarnings(ducts(drafts), { unitPoint: p(0, 0) })).toEqual([]);
    const all = [unit(), ...hosts, ...asElements(drafts)];
    expect(overlaps(all)).toEqual([]);
    expect(overlaps(all.slice(1))).not.toEqual([]); // the kitchen and bath legs overlap; only the unit exempts them
    expect(planAutoDucts(unit(), all, rooms, floors)).toEqual([]);
    const withoutBath = all.filter((el) => !(el.type === 'MechanicalVentilationDuctwork' && el.coordinates.some((q) => q.x === 9.05)));
    expect(segs(planAutoDucts(unit(), withoutBath, rooms, floors), 'extract')).toEqual(segs(drafts, 'extract').slice(2));

    // Colinear rooms: the kitchen run ends where the bath's elbow would be without the stagger.
    const colinear = [room('k', 'kitchen', 0, 8, -1), room('m', 'bathroom', 0, 8, 2)];
    const plan = planAutoDucts(unit(), [unit()], colinear, floors);
    expect(collectMvhrDuctTopologyWarnings(ducts(plan), { unitPoint: p(0, 0) })).toEqual([]);
    expect(overlaps([unit(), ...asElements(plan)])).toEqual([]);
  });

  it('counts only free run ends as serving a room', () => {
    const joint = [
      { id: 'j1', name: 'J1', type: 'MechanicalVentilationDuctwork', duct_type: 'extract', parent_element: 'MV', coordinates: [p(0, 0), p(5, 3)] },
      { id: 'j2', name: 'J2', type: 'MechanicalVentilationDuctwork', duct_type: 'extract', parent_element: 'MV', coordinates: [p(5, 3), p(12, 3)] },
    ] as Element[];
    // The room is still unserved; its run staggers off the existing joint rather than ending on it.
    expect(segs(planAutoDucts(unit(), [unit(), ...joint], [rooms[0]!], floors), 'extract')).toEqual([[p(0, 0), p(5.05, 0)], [p(5.05, 0), p(5.05, 3.05)]]);
  });

  it('plans nothing for non-MVHR units, without a unit point, or for unreachable rooms', () => {
    expect(planAutoDucts(unit('Centralised continuous MEV'), hosts, rooms, floors)).toEqual([]);
    expect(planAutoDucts({ ...unit(), coordinates: [] }, hosts, rooms, floors)).toEqual([]);
    expect(planAutoDucts(unit(), [], [], floors)).toEqual([]);
    expect(planAutoDucts(unit(), hosts, [], floors).map((d) => d.duct_type ?? d.terminal_type))
      .toEqual(['intake', 'intake', 'intake', 'exhaust', 'exhaust', 'exhaust']);
    expect(planAutoDucts(unit('MVHR', 5, 3), [], [rooms[0]!], floors)).toEqual([]); // unit on the room point
    expect(planAutoDucts(unit(), [], [room('n', 'kitchen', 0, 4, 2, 0.15)], floors)).toEqual([]); // no point 0.1 m inside
  });

  it('serves a room only from its own storey, and keeps terminals on the unit storey', () => {
    // A free supply end on storey 1 above the living room does not serve it.
    const upstairs = { id: 'u', name: 'U', type: 'MechanicalVentilationDuctwork', duct_type: 'supply', parent_element: 'MV', floorId: 'f1', coordinates: [p(0, 0, 2.5), p(-3, 0, 2.5)] } as Element;
    expect(segs(planAutoDucts(unit(), [unit(), upstairs], [rooms[2]!], floors), 'supply')).toEqual([[p(0, 0), p(-3, 0)]]);
    // An exhaust terminal on storey 1: no duct to it and no second terminal.
    const wallUp = { ...hosts[0]!, id: 'wu', name: 'Wall Up', floorId: 'f1', coordinates: [p(-5, -3, 1), p(5, -3, 1)] } as Element;
    const terminalUp = { id: 't', name: 'T', type: 'MechanicalVentilationTerminal', terminal_type: 'exhaust', parent_element: 'MV', host_element: 'Wall Up', floorId: 'f1', coordinates: [p(2, -3, 2.4)] } as Element;
    expect(planAutoDucts(unit(), [unit(), wallUp, terminalUp], [], floors)).toEqual([]);
  });

  it('plans every room of a large dwelling, however small', () => {
    const many = Array.from({ length: 18 }, (_, i) => room(`r${String(i).padStart(2, '0')}`, 'bedroom', 0, i * 5, 0, i === 17 ? 1.6 : 3));
    const ends = segs(planAutoDucts({ ...unit(), coordinates: [p(-50, -50)] }, [], many, floors), 'supply').map((c) => c[1]!);
    expect(many.every((r) => ends.some((e) => e.x > r.coordinates[0]!.x && e.x < r.coordinates[1]!.x && e.y > 0 && e.y < 2))).toBe(true);
  });

  it('routes from a basement unit, reading a label storey as an index into the floors', () => {
    const withBasement = [{ id: 'fb', name: 'B', zIndex: -1, height: 2.6, isRoofSpace: false }, ...floors] as Floor[];
    const basementUnit = { ...unit(), floorId: 'fb', coordinates: [p(0, 0, -1)] } as MechanicalVentilation;
    // storey 1 is floors[1], the ground floor (zIndex 0), not zIndex 1.
    const drafts = planAutoDucts(basementUnit, [basementUnit], [room('k', 'kitchen', 1, 4, 2)], withBasement);
    expect(segs(drafts, 'extract')).toEqual([[p(0, 0, -2.6), p(5, 0, -2.6)], [p(5, 0, -2.6), p(5, 3, -2.6)], [p(5, 3, -2.6), p(5, 3, 0)]]);
    expect(drafts.map((d) => d.floorId)).toEqual(['fb', 'fb', 'f0']);
  });

  it('starts at an upper-storey unit in metres and rises to an overridden storey base', () => {
    const split = [floors[0]!, { ...floors[1]!, baseHeight: 3.1, baseHeightUserOverride: true }, { id: 'f2', name: '2', zIndex: 2, height: 2.4, isRoofSpace: false }] as Floor[];
    const upUnit = { ...unit(), floorId: 'f1', coordinates: [p(0, 0, 1)] } as MechanicalVentilation;
    const drafts = planAutoDucts(upUnit, [upUnit], [room('k', 'kitchen', 1, 4, 2), room('w', 'wc', 2, 4, 2)], split);
    expect(segs(drafts, 'extract')).toEqual([
      [p(0, 0, 3.1), p(5, 0, 3.1)], [p(5, 0, 3.1), p(5, 3, 3.1)],
      // The WC above the kitchen: the same centroid, so its stagger keeps the runs apart, then a riser to 3.1 + 2.5.
      [p(0, 0, 3.1), p(5.05, 0, 3.1)], [p(5.05, 0, 3.1), p(5.05, 3.05, 3.1)], [p(5.05, 3.05, 3.1), p(5.05, 3.05, 5.6)],
    ]);
  });

  it('keeps stacked rooms on different storeys apart, with no topology warnings or overlap errors', () => {
    const stacked = [0, 1, 2, 3, 4].map((i) => room(`r${i}`, i % 2 ? 'bathroom' : 'kitchen', i % 2, 4, 2));
    const drafts = planAutoDucts(unit(), [unit()], stacked, floors);
    expect(segs(drafts, 'extract').filter((c) => c[0]!.z !== c[1]!.z)).toHaveLength(2); // two risers to storey 1
    expect(collectMvhrDuctTopologyWarnings(ducts(drafts), { unitPoint: p(0, 0) })).toEqual([]);
    expect(overlaps([unit(), ...asElements(drafts)])).toEqual([]);
    expect(planAutoDucts(unit(), [unit(), ...asElements(drafts)], stacked, floors)).toEqual([]);
  });

  it('is deterministic whatever the label order', () => {
    expect(planAutoDucts(unit(), hosts, [...rooms].reverse(), floors)).toEqual(planAutoDucts(unit(), hosts, rooms, floors));
  });
});

describe('planPrimaryPipework', () => {
  const p = (x: number, y: number, z = 0) => ({ x, y, z });
  const floors = [0, 1].map((zIndex) => ({ id: `f${zIndex}`, name: String(zIndex), zIndex, height: 2.5, heightUserOverride: true, isRoofSpace: false })) as Floor[];
  const ground = { id: 'g', name: 'Ground', type: 'BuildingElementGround', coordinates: [p(0, 0), p(10, 0), p(10, 8), p(0, 8)] } as unknown as Element;
  const heatPump = { id: 'hp', name: 'Heat Pump', type: 'System', subcategory: 'HeatSourceWet', floorId: 'f0',
    coordinates: [p(12, 2)], extra_json: { HeatSourceWet: { hp: { type: 'HeatPump' } } } } as unknown as Element;
  const cylinder = (storey = 0, type = 'StorageTank') => ({ id: 'cyl', name: 'Cylinder', type: 'System', subcategory: 'HotWaterSource',
    floorId: `f${storey}`, coordinates: [p(3, 6, storey)],
    extra_json: { HotWaterSource: { 'hw cylinder': { type, HeatSource: { hp: { type: 'HeatSourceWet', name: 'hp' } } } } } }) as unknown as Element;
  const pipes = (drafts: ElementDraft[]) => drafts.map((d, i) => ({ ...d, id: `pipe${i}` }) as unknown as Element);
  const legs = (drafts: ElementDraft[]) => drafts.map((d) => [(d as { location: string }).location, d.length, d.floorId, d.coordinates]);

  it('routes an L from the heat source to the cylinder, external outside the footprint, split at the wall', () => {
    expect(legs(planPrimaryPipework([ground, heatPump, cylinder()], floors))).toEqual([
      ['external', 2, 'f0', [p(12, 2), p(10, 2)]],
      ['internal', 7, 'f0', [p(10, 2), p(3, 2)]],
      ['internal', 4, 'f0', [p(3, 2), p(3, 6)]],
    ]);
  });

  it('rises at the cylinder to an upper storey, and the riser belongs to that storey', () => {
    const drafts = planPrimaryPipework([ground, heatPump, cylinder(1)], floors);
    expect(legs(drafts).slice(2)).toEqual([['internal', 4, 'f0', [p(3, 2), p(3, 6)]], ['internal', 2.5, 'f1', [p(3, 6), p(3, 6, 2.5)]]]);
    expect(primaryPipeRunGap(pipes(drafts)[0]!, [ground, heatPump, cylinder(1), ...pipes(drafts)], floors)).toBeNull();
  });

  it('plans nothing for a combi, a served pair or a model without a footprint, and is deterministic', () => {
    expect(planPrimaryPipework([ground, heatPump, cylinder(0, 'CombiBoiler')], floors)).toEqual([]);
    expect(planPrimaryPipework([heatPump, cylinder()], floors)).toEqual([]);
    const drafts = planPrimaryPipework([ground, heatPump, cylinder()], floors);
    expect(planPrimaryPipework([ground, heatPump, cylinder(), ...pipes(drafts)], floors)).toEqual([]);
    expect(planPrimaryPipework([cylinder(), heatPump, ground], floors)).toEqual(drafts);
  });

  it('warns on a run that misses its cylinder, marking the free end nearest it', () => {
    const run = pipes(planPrimaryPipework([ground, heatPump, cylinder()], floors)).slice(0, 2);
    expect(primaryPipeRunGap(run[0]!, [ground, heatPump, cylinder(), ...run], floors)).toEqual({
      message: 'Primary pipework run is not connected to Cylinder', looseEnd: p(3, 2),
    });
  });
});
