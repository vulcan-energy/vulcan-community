// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import { getHemieBundle, hemieBundleDeletion, hemieBundleParts } from '../hemieBundles';
import {
  drawRoofPart,
  fitRoofPart,
  handDrawnRoofOver,
  roofBlankNotice,
  roofOutlineChanged,
  roofParameters,
  roofShape,
  shapeEdges,
  storeyOutline,
  turnedEdges,
  type RoofParameters,
} from '../roofPart';
import { createGeometryStore } from '../../stores/geometryStore';

let n = 0;
const wall = (name: string, a: [number, number], b: [number, number], level = 0, type: Element['type'] = 'BuildingElementOpaque') => ({
  id: `w${(n += 1)}`, name, type, zoneId: 'z', parent_element: null,
  coordinates: [{ x: a[0], y: a[1], z: level }, { x: b[0], y: b[1], z: level }],
  width: Math.hypot(b[0] - a[0], b[1] - a[1]), height: 2.5, area: 1, pitch: 90, orientation360: 0, base_height: 2.5 * level,
}) as unknown as Element;

/** A semi, 8 × 5, its party wall on the west; a 3 cm jog in the front wall. */
const semi = (level = 0): Element[] => [
  wall('Front', [0, 0], [4, 0], level),
  wall('Front jog', [4, 0], [4, 0.03], level),
  wall('Front 2', [4, 0.03], [8, 0.03], level),
  wall('East', [8, 0.03], [8, 5], level),
  wall('Rear', [8, 5], [0, 5], level),
  wall('Party', [0, 5], [0, 0], level, 'BuildingElementPartyWall'),
];
const at = { x: 4, y: 2.5 };

describe('roof part', () => {
  it('fits a semi hipped with a party gable, with no clicks', () => {
    const outline = storeyOutline(semi(), 0, at)!;
    expect(outline.edges.map((e) => [e.wall, e.fixed])).toEqual([
      ['Front', null], ['East', null], ['Rear', null], ['Party', 'party'],
    ]);
    expect(outline.eaves).toBe(2.5);
    const p: RoofParameters = { level: 0, at };
    expect(roofShape(outline, p)).toBe('hipped');
    const fit = fitRoofPart(outline, p);
    expect('faces' in fit && fit.faces).toHaveLength(3);
    // Turn is hidden: the party wall fixes the roof.
    expect(turnedEdges(outline, p)).toBeNull();
  });

  it('gable ends sit on the short sides; Turn moves them round', () => {
    const detached = semi().map((e) => (e.name === 'Party' ? { ...e, type: 'BuildingElementOpaque' } as Element : e));
    const outline = storeyOutline(detached, 0, at)!;
    const fit = fitRoofPart(outline, { level: 0, at });
    const edges = shapeEdges(outline, 'faces' in fit ? fit : null, 'gable');
    expect(edges).toEqual({ Front: 'eaves', East: 'gable', Rear: 'eaves', Party: 'gable' });
    expect(roofShape(outline, { level: 0, at, edges })).toBe('gable');
    expect(turnedEdges(outline, { level: 0, at, edges })).toEqual({ Front: 'gable', East: 'eaves', Rear: 'gable', Party: 'eaves' });
  });

  it('a mansard is drawn, and tagged, only with its break height and upper pitch', () => {
    const outline = storeyOutline(semi(), 0, at)!;
    const p: RoofParameters = { level: 0, at, mansard: true };
    expect(roofShape(outline, p)).toBe('hipped');
    // The Shape field still shows what was picked.
    expect(roofShape(outline, p, true)).toBe('mansard');
    expect(roofBlankNotice('Roof 1', outline, p)).toBe('Give Roof 1 a break height and an upper pitch.');
    expect(roofBlankNotice('Roof 1', outline, { ...p, breakHeight: 2 })).toBe('Give Roof 1 an upper pitch.');
    const full = { ...p, breakHeight: 2, upperPitch: 30 };
    expect(roofShape(outline, full)).toBe('mansard');
    expect(roofBlankNotice('Roof 1', outline, full)).toBeNull();
    expect(roofBlankNotice('Roof 1', outline, { level: 0, at, edges: { East: 'half-hip' } })).toBe('Give Roof 1 a half-hip height.');
  });

  it('Turn is only offered on a four-edge outline', () => {
    const lPlan = [
      wall('A', [0, 0], [10, 0]), wall('B', [10, 0], [10, 5]), wall('C', [10, 5], [7, 5]), wall('D', [7, 5], [7, 9]),
      wall('E', [7, 9], [3, 9]), wall('F', [3, 9], [3, 5]), wall('G', [3, 5], [0, 5]), wall('H', [0, 5], [0, 0]),
    ];
    const outline = storeyOutline(lPlan, 0, { x: 5, y: 2 })!;
    expect(outline.edges).toHaveLength(8);
    expect(turnedEdges(outline, { level: 0, at, edges: { E: 'gable', H: 'gable', B: 'gable' } })).toBeNull();
    const mono = Object.fromEntries(outline.edges.map((e) => [e.wall, e.wall === 'A' ? 'eaves' : 'gable'] as const));
    expect(roofShape(outline, { level: 0, at, edges: mono })).toBe('mono');
    expect(turnedEdges(outline, { level: 0, at, edges: mono })).toBeNull();
  });

  it('a one-storey wing stops at the main wall, which it abuts', () => {
    const house = [
      ...semi(1),
      wall('G front', [0, 0], [8, 0]), wall('G east', [8, 0], [8, 8]), wall('G rear', [8, 8], [0, 8]), wall('G west', [0, 8], [0, 0]),
    ];
    const outline = storeyOutline(house, 0, { x: 4, y: 6.5 })!;
    expect(outline.edges.find((e) => e.fixed === 'abuts')).toBeTruthy();
    expect(storeyOutline(house, 0, { x: 4, y: 2 })).toBeNull();
  });

  it('draws, refits by role, shows an outline change and deletes whole', () => {
    const store = createGeometryStore();
    store.getState().addElements(semi().map((e) => ({ ...e, id: undefined })) as never);
    const placed = drawRoofPart(store.getState(), { level: 0, at, pitchChoice: 'Steep' });
    if ('problem' in placed) throw new Error(placed.problem);
    const members = () => Object.values(store.getState().elementsById).filter((e) => getHemieBundle(e)?.kind === 'roof');
    expect(members()).toHaveLength(3);
    const anchor = store.getState().elementsById[placed.anchorId];
    expect(getHemieBundle(anchor)).toMatchObject({ shape: 'hipped', pitch_choice: 'Steep', bundle_name: 'Roof 1' });
    expect(members().every((m) => m.pitch === 55 && m.coordinates[0].z === 1 && (m as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof)).toBe(true);
    expect(members().every((m) => (m as { base_height?: number }).base_height === 2.5)).toBe(true);

    const fabric = members()[1];
    store.getState().updateElement(fabric.id, { u_value: 0.2 } as never);
    const again = drawRoofPart(store.getState(), { level: 0, at, pitchChoice: 30 }, store.getState().elementsById[placed.anchorId]);
    expect('anchorId' in again).toBe(true);
    expect(members()).toHaveLength(3);
    expect((store.getState().elementsById[fabric.id] as { u_value?: number }).u_value).toBe(0.2);
    expect(getHemieBundle(members()[0])?.pitch_choice).toBe(30);

    const all = () => Object.values(store.getState().elementsById);
    const east = all().find((e) => e.name === 'East')!;
    expect(roofOutlineChanged(store.getState().elementsById[placed.anchorId], all())).toBe(false);
    store.getState().updateElement(east.id, { coordinates: [{ x: 9, y: 0.03, z: 0 }, { x: 9, y: 5, z: 0 }] } as never);
    expect(roofOutlineChanged(store.getState().elementsById[placed.anchorId], all())).toBe(true);

    expect(hemieBundleDeletion(store.getState().elementsById, [fabric.id]).ids).toHaveLength(3);
  });

  it('a slope a refit adds takes the fabric the others agree on', () => {
    const store = createGeometryStore();
    store.getState().addElements(semi().map((e) => ({ ...e, id: undefined })) as never);
    const placed = drawRoofPart(store.getState(), { level: 0, at, edges: { East: 'gable' } });
    if ('problem' in placed) throw new Error(placed.problem);
    const members = () => Object.values(store.getState().elementsById).filter((e) => getHemieBundle(e)?.kind === 'roof');
    expect(members()).toHaveLength(2);
    store.getState().updateElementsBulk(Object.fromEntries(members().map((m) => [m.id, { u_value: 0.2 }])) as never);
    drawRoofPart(store.getState(), { level: 0, at, edges: {} }, store.getState().elementsById[placed.anchorId]);
    expect(members()).toHaveLength(3);
    expect(members().map((m) => (m as { u_value?: number }).u_value)).toEqual([0.2, 0.2, 0.2]);
  });

  it('fitted over heated hand-drawn planes: vaulted, their fabric, and their roof window moves to a new slope', () => {
    const store = createGeometryStore();
    const plane = (name: string, y0: number, y1: number) => ({
      name, type: 'BuildingElementOpaque', zoneId: 'z', parent_element: null, pitch: 30, orientation360: 0, base_height: 2.5,
      width: 8, height: 2.5, area: 20, u_value: 0.3, is_unheated_pitched_roof: false,
      coordinates: [{ x: 0, y: y0, z: 1 }, { x: 8, y: y0, z: 1 }, { x: 8, y: y1, z: 1 }, { x: 0, y: y1, z: 1 }],
    });
    store.getState().addElements([
      ...semi().map((e) => ({ ...e, id: undefined })),
      plane('Hand front', 0, 2.5),
      plane('Hand rear', 2.5, 5),
      {
        name: 'Roof window', type: 'BuildingElementTransparent', zoneId: 'z', parent_element: 'Hand front', pitch: 30, orientation360: 0,
        base_height: 2.8, width: 2, height: 1, area: 2,
        coordinates: [{ x: 3, y: 0.5, z: 1 }, { x: 5, y: 0.5, z: 1 }, { x: 5, y: 1.5, z: 1 }, { x: 3, y: 1.5, z: 1 }],
      },
    ] as never);
    const all = Object.values(store.getState().elementsById);
    const outline = storeyOutline(all, 0, at)!;
    const replace = handDrawnRoofOver(all, outline, 0);
    expect(replace.map((e) => e.name)).toEqual(['Hand front', 'Hand rear', 'Roof window']);
    const placed = drawRoofPart(store.getState(), { level: 0, at }, undefined, replace);
    if ('problem' in placed) throw new Error(placed.problem);
    const members = Object.values(store.getState().elementsById).filter((e) => getHemieBundle(e)?.kind === 'roof');
    expect(members).toHaveLength(3);
    expect(roofParameters(store.getState().elementsById[placed.anchorId])?.use).toBe('vaulted');
    expect(members.every((m) => (m as { u_value?: number }).u_value === 0.3 && (m as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof === false)).toBe(true);
    const window = Object.values(store.getState().elementsById).find((e) => e.name === 'Roof window')!;
    const host = members.find((m) => m.name === window.parent_element)!;
    expect(host.name).toBe('Roof 1 Front slope');
    expect(window.pitch).toBe(45);
    // Its foot lies in the slope's plane: 0.5 m in from the eaves at 45°.
    expect((window as { base_height?: number }).base_height).toBeCloseTo(3, 1);
    expect((window as { orientation360?: number }).orientation360).toBe((host as { orientation360?: number }).orientation360);
    expect(Object.values(store.getState().elementsById).some((e) => e.name.startsWith('Hand '))).toBe(false);
  });

  describe('room in the roof', () => {
    // Detached, 8 × 5 and square.
    const detached = () => [wall('Front', [0, 0], [8, 0]), wall('East', [8, 0], [8, 5]), wall('Rear', [8, 5], [0, 5]), wall('Party', [0, 5], [0, 0])];
    const gables = { East: 'gable', Party: 'gable' } as const;
    const room = (walls: Element[], p: Partial<RoofParameters>) => {
      const store = createGeometryStore();
      store.getState().addElements(walls.map((e) => ({ ...e, id: undefined })) as never);
      const placed = drawRoofPart(store.getState(), { level: 0, at, use: 'room', ...p } as RoofParameters);
      if ('problem' in placed) throw new Error(placed.problem);
      const all = () => Object.values(store.getState().elementsById);
      const members = () => all().filter((e) => getHemieBundle(e)?.kind === 'roof');
      const role = (m: Element) => getHemieBundle(m)!.role.split(':')[0];
      const of = (r: string) => members().filter((m) => role(m) === r);
      return { store, placed, all, members, of };
    };
    const num = (e: Element, key: string) => (e as unknown as Record<string, number>)[key];

    it('set in: pitch from the measurements; room, void and ceiling slopes, sheltered knee walls, gables between them', () => {
      // w 5, wᵢ 2.8, h_v 2.1, w_c 0.8, h_w 1.1: tan θ = 2(2.1 − 1.1)/(2.8 − 0.8) = 1.
      // The physical pitch the measurements give, not HEM:EPC's (which adds its 0.25 m floor gap): HEM:EPC accepts this room.
      const { of, all } = room(detached(), { edges: gables, roomWalls: 'set-in', roomWidth: 2.8, maxCeilingHeight: 2.1, ceilingWidth: 0.8, kneeWallHeight: 1.1 });
      expect(of('slope').map((m) => num(m, 'pitch'))).toEqual([45, 45]);
      expect(of('slope').every((m) => (m as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof === false)).toBe(true);
      expect(of('void')).toHaveLength(2);
      expect(of('over')).toHaveLength(2);
      expect([...of('void'), ...of('over')].every((m) => (m as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof)).toBe(true);
      // The slope rises from the eaves on the walls (1.1 m in, at 45°, it is 1.1 m up).
      expect(of('void').map((m) => num(m, 'base_height'))).toEqual([2.5, 2.5]);
      expect(of('slope').map((m) => num(m, 'base_height'))).toEqual([3.6, 3.6]);
      expect(of('over').map((m) => num(m, 'base_height'))).toEqual([4.6, 4.6]);
      const knees = of('knee');
      expect(knees.map((k) => [k.type, num(k, 'height'), num(k, 'base_height'), k.coordinates[0].z])).toEqual([
        ['BuildingElementAdjacentUnconditionedSpace_Simple', 1.1, 2.5, 1],
        ['BuildingElementAdjacentUnconditionedSpace_Simple', 1.1, 2.5, 1],
      ]);
      const gable = of('gable');
      expect(gable).toHaveLength(2);
      // Between the knee walls (2.8 m), up to the flat ceiling at 2.1 m.
      expect(gable.map((g) => num(g, 'width'))).toEqual([2.8, 2.8]);
      const profile = (gable[0].extra_json as { geometry_face: { top_profile: Array<{ h: number }> } }).geometry_face.top_profile;
      expect(Math.max(...profile.map((q) => q.h))).toBeCloseTo(2.1, 6);
      expect(Math.min(...profile.map((q) => q.h))).toBeCloseTo(1.1, 6);
      // The room's walls do not change the outline under the roof.
      expect(storeyOutline(all(), 0, at)!.edges.every((e) => e.fixed === null)).toBe(true);
    });

    it('set in, the slope meeting the floor short of the storey walls: the eaves stay, and the void runs from them to the knee wall tops', () => {
      // A 7 m deep semi; wᵢ 4.0, h_v 2.4, h_w 1.0, w_c 1.0: tan θ = 2(1.4)/3, so a slope from the
      // eaves would pass 0.4 m over the knee wall tops, 1.5 m in.
      const deep = () => [wall('Front', [0, 0], [8, 0]), wall('East', [8, 0], [8, 7]), wall('Rear', [8, 7], [0, 7]), wall('Party', [0, 7], [0, 0])];
      const { of } = room(deep(), { at: { x: 4, y: 3.5 }, edges: gables, roomWalls: 'set-in', roomWidth: 4, maxCeilingHeight: 2.4, ceilingWidth: 1, kneeWallHeight: 1 });
      const pitch = (Math.atan(2.8 / 3) * 180) / Math.PI;
      expect(of('slope').map((m) => num(m, 'pitch'))).toEqual([pitch, pitch].map((x) => Math.round(x * 100) / 100));
      // The room's slope from the knee wall tops to the max height; the void from the eaves, at atan(1.0/1.5).
      expect(of('void').map((m) => [num(m, 'base_height'), num(m, 'pitch')])).toEqual([[2.5, 33.69], [2.5, 33.69]]);
      expect(of('slope').map((m) => num(m, 'base_height'))).toEqual([3.5, 3.5]);
      expect(of('over').map((m) => num(m, 'base_height'))).toEqual([4.9, 4.9]);
      expect(of('knee').map((k) => [num(k, 'height'), k.coordinates[0].y])).toEqual([[1, 1.5], [1, 5.5]]);
      const profile = (of('gable')[0].extra_json as { geometry_face: { top_profile: Array<{ h: number }> } }).geometry_face.top_profile;
      expect([Math.min(...profile.map((q) => q.h)), Math.max(...profile.map((q) => q.h))]).toEqual([1, 2.4]);
    });

    it('common: the storey walls run on up as external knee walls; the eaves rise by the knee height', () => {
      const { of } = room(detached(), { edges: gables, roomWalls: 'common', maxCeilingHeight: 2.1, kneeWallHeight: 1.1 });
      // tan θ = 2(2.1 − 1.1)/5.
      expect(num(of('slope')[0], 'pitch')).toBeCloseTo((Math.atan(0.4) * 180) / Math.PI, 1);
      expect(of('void')).toHaveLength(0);
      expect(of('over')).toHaveLength(0);
      expect(of('slope').map((m) => num(m, 'base_height'))).toEqual([3.6, 3.6]);
      expect(of('knee').map((k) => [k.type, num(k, 'width')])).toEqual([['BuildingElementOpaque', 8], ['BuildingElementOpaque', 8]]);
      expect(of('gable').map((g) => num(g, 'width'))).toEqual([5, 5]);
    });

    it('set in, then common: the knee walls become external walls', () => {
      const p = { edges: gables, roomWalls: 'set-in' as const, roomWidth: 2.8, maxCeilingHeight: 2.1, kneeWallHeight: 1.1 };
      const { store, placed, of } = room(detached(), p);
      drawRoofPart(store.getState(), { level: 0, at, use: 'room', ...p, roomWalls: 'common', roomWidth: undefined }, store.getState().elementsById[placed.anchorId]);
      expect(of('knee').map((k) => k.type)).toEqual(['BuildingElementOpaque', 'BuildingElementOpaque']);
    });

    it('a hipped semi: a party gable, a knee wall under the hip, drawn as a loft until the measurements are given', () => {
      const blank = room(semi(), { roomWalls: 'set-in' });
      expect(blank.of('knee')).toHaveLength(0);
      expect(roofBlankNotice('Roof 1', storeyOutline(blank.all(), 0, at)!, roofParameters(blank.store.getState().elementsById[blank.placed.anchorId])!))
        .toBe('Give Roof 1 a width and a max ceiling height.');
      const { of } = room(semi(), { roomWalls: 'set-in', roomWidth: 2.8, maxCeilingHeight: 2.1, kneeWallHeight: 1.1 });
      expect(of('knee')).toHaveLength(3);
      expect(of('gable').map((g) => g.type)).toEqual(['BuildingElementPartyWall']);
    });

    it('common walls need a knee wall height: until given, a hipped roof is a loft and the notice names it', () => {
      const blank = room(detached(), { maxCeilingHeight: 2.1 });
      expect(blank.of('knee')).toHaveLength(0);
      expect(blank.of('slope').every((m) => (m as { is_unheated_pitched_roof?: boolean }).is_unheated_pitched_roof)).toBe(true);
      expect(roofBlankNotice('Roof 1', storeyOutline(blank.all(), 0, at)!, roofParameters(blank.store.getState().elementsById[blank.placed.anchorId])!))
        .toBe('Give Roof 1 a knee wall height.');
      // Hipped all round, its knee walls are the room's only walls.
      const { of } = room(detached(), { maxCeilingHeight: 2.1, kneeWallHeight: 1.1 });
      expect(of('knee').map((k) => k.type)).toEqual(Array(4).fill('BuildingElementOpaque'));
      expect(of('gable')).toHaveLength(0);
      // With no knee walls and no gable the room would have no walls at all.
      expect(fitRoofPart(storeyOutline(detached(), 0, at)!, { level: 0, at, use: 'room', maxCeilingHeight: 2.1, kneeWallHeight: 0 }))
        .toEqual({ problem: 'A room under a hipped roof needs knee walls: give a knee wall height above 0.' });
    });

    it('a party and an external gable in one row are not Mixed', () => {
      const { members } = room(semi(), { edges: { East: 'gable' }, maxCeilingHeight: 2.1, kneeWallHeight: 1.1 });
      const gableRow = hemieBundleParts(members()).find((part) => part.label === '2 gables')!;
      expect(gableRow.mixed).toBe(false);
    });

    it('measurements that do not fit are a problem, and draw nothing', () => {
      const outline = storeyOutline(detached(), 0, at)!;
      // No knee wall, and the slope reaches the floor short of the storey walls: the void would be flat.
      const p: RoofParameters = { level: 0, at, edges: gables, use: 'room', roomWalls: 'set-in', roomWidth: 2.8, maxCeilingHeight: 2.1, kneeWallHeight: 0 };
      const short = { problem: 'The slope from these measurements meets the floor between the room and the storey walls: give a knee wall height of at least 0.3 m, or check the width.' };
      expect(fitRoofPart(outline, p)).toEqual(short);
      // A knee wall under 0.3 m would leave the void from the eaves to it near flat.
      expect(fitRoofPart(outline, { ...p, kneeWallHeight: 0.2 })).toEqual(short);
      expect('problem' in fitRoofPart(outline, { ...p, kneeWallHeight: 0.3 })).toBe(false);
      expect(fitRoofPart(outline, { ...p, kneeWallHeight: 2.5 })).toEqual({ problem: 'Make the max ceiling height more than the knee wall height.' });
    });
  });
});
