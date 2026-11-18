// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import { getHemieBundle, hemieBundleDeletion } from '../hemieBundles';
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
});
