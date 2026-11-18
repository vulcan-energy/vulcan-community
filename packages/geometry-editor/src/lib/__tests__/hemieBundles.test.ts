// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementGround, BuildingElementOpaque, Element } from '../../geometry/types';
import {
  bayCoveredAbove,
  bayParameters,
  bayParametersProblem,
  buildBayBundleDraft,
  buildConservatoryBundleDraft,
  bundleMemberNames,
  conservatoryParameters,
  conservatoryParametersProblem,
  detachHemieBundle,
  drawHemieBundle,
  getHemieBundle,
  getHemieBundleMembers,
  hemieBundleDeletion,
  hemieBundleHostProblem,
  hemieBundleMissing,
  hemieBundleParts,
  planBundleUpdate,
  windowSections,
  withWindowSections,
  type BayParameters,
  type ConservatoryParameters,
  type HemieBundleMemberDraft,
} from '../hemieBundles';
import { getMaxLineWallHeightOnFloor } from '../zoneDerivation';
import { createGeometryStore } from '../../stores/geometryStore';

/** A south-facing wall, west to east, on floor `level`. */
const host = (level = 0): BuildingElementOpaque => ({
  id: `h${level}`,
  name: level ? 'Wall (S) 1' : 'Wall (S)',
  type: 'BuildingElementOpaque',
  zoneId: 'z',
  parent_element: null,
  coordinates: [{ x: 0, y: 0, z: level }, { x: 6, y: 0, z: level }],
  width: 6,
  height: 2.8,
  area: 16.8,
  pitch: 90,
  orientation360: 180,
  base_height: 2.8 * level,
});

const role = (members: { role: string }[], r: string) => members.find((m) => m.role === r)!;
const roles = (members: { role: string }[]) => members.map((m) => m.role);
const asElements = (members: HemieBundleMemberDraft[]) => members.map((m, i) => ({
  id: `m${i}`, name: m.name, type: m.type, zoneId: 'z', parent_element: m.parent_element, ...m.updates,
})) as unknown as Element[];

/** What placement draws: the opening and the projection, nothing else. */
const DRAWN_BAY: BayParameters = { centre: 3, openingWidth: 2, depth: 0.6 };
/** A bay as it was saved before placement drew it: every size stated. */
const SAVED_BAY = {
  centre: 3, openingWidth: 2, depth: 0.6, frontWidth: 0.8, roof: 'flat', sideWindows: true, sillHeight: 0.8, windowHeight: 1.3,
};

describe('bay bundle', () => {
  const draft = buildBayBundleDraft({
    host: host(),
    parameters: bayParameters(SAVED_BAY as never),
    existingNames: ['Wall (S)'],
    globalOrientationOffset: 0,
  });

  it('projects outward from its host with the opening netted from the host', () => {
    const front = role(draft.members, 'front-wall');
    expect(front.parent_element).toBe('Wall (S)');
    expect(front.updates.extra_json.parent_netting_area).toBe(5.6);
    // 45° sides 0.6 m deep: the front is 0.8 m, 0.6 m outside (south of) the wall.
    expect(front.updates.coordinates).toEqual([{ x: 2.6, y: -0.6, z: 0 }, { x: 3.4, y: -0.6, z: 0 }]);
    expect(front.updates.orientation360).toBe(180);
    const left = role(draft.members, 'left-wall');
    expect(left.updates.coordinates[0]).toEqual({ x: 2, y: 0, z: 0 });
    expect(left.updates.orientation360).toBe(225);
  });

  it('reads a saved bay as entered: the same windows, side windows, floor and flat roof', () => {
    expect(roles(draft.members)).toEqual([
      'front-wall', 'left-wall', 'right-wall', 'front-window', 'left-window', 'right-window', 'floor', 'roof',
    ]);
    expect(bayParameters(SAVED_BAY as never)).toMatchObject({ windowWidth: 0.6, windowHeight: 1.3, sideWindowWidth: 0.649, sideWindowHeight: 1.3, sillHeight: 0.8 });
    expect(role(draft.members, 'front-window').parent_element).toBe('Bay 1 front');
    expect(role(draft.members, 'front-window').updates).toMatchObject({ width: 0.6, height: 1.3, base_height: 0.8 });
    expect(role(draft.members, 'left-window').updates).toMatchObject({ width: 0.649, height: 1.3 });
    expect(role(draft.members, 'floor').updates.area).toBe(0.84);
    expect(role(draft.members, 'roof').updates).toMatchObject({ pitch: 0, base_height: 2.8 });
    expect(getHemieBundle({ extra_json: role(draft.members, 'roof').updates.extra_json } as Element)).toMatchObject({
      kind: 'bay', role: 'roof', host_wall: 'Wall (S)', bundle_id: draft.bundleId,
    });
  });

  it('draws only what was drawn: a box bay with no window and no roof until they are given', () => {
    const drawn = buildBayBundleDraft({ host: host(), parameters: DRAWN_BAY, existingNames: [], globalOrientationOffset: 0 });
    expect(roles(drawn.members)).toEqual(['front-wall', 'left-wall', 'right-wall', 'floor']);
    expect(role(drawn.members, 'front-wall').updates.width).toBe(2);
    const anchor = asElements(drawn.members)[0];
    expect(hemieBundleMissing(anchor, [host(), ...asElements(drawn.members)])).toBe('Give Bay 1 a roof and a front window width and height.');
  });

  it('centres the window on the bay height unless a sill is given', () => {
    const p = { ...DRAWN_BAY, roof: 'flat' as const, windowWidth: 1.2, windowHeight: 1.4 };
    const centred = role(buildBayBundleDraft({ host: host(), parameters: p, existingNames: [], globalOrientationOffset: 0 }).members, 'front-window');
    expect(centred.updates).toMatchObject({ width: 1.2, height: 1.4, base_height: 0.7 });
    expect(centred.updates.coordinates[0]).toMatchObject({ x: 2.4, y: -0.6 });
    const sill = role(buildBayBundleDraft({ host: host(), parameters: { ...p, sillHeight: 0.9 }, existingNames: [], globalOrientationOffset: 0 }).members, 'front-window');
    expect(sill.updates.base_height).toBe(0.9);
    expect(bayParametersProblem(host(), { ...p, windowWidth: 2.1 })).toMatch(/front window/);
    expect(bayParametersProblem(host(), { ...p, sillHeight: 1.5 })).toMatch(/above the bay walls/);
  });

  it('gives both sides the same window when asked', () => {
    const p = { ...DRAWN_BAY, frontWidth: 0.8, roof: 'flat' as const, windowWidth: 0.6, windowHeight: 1.3, sideWindows: true, sideWindowWidth: 0.5, sideWindowHeight: 1.3 };
    const members = buildBayBundleDraft({ host: host(), parameters: p, existingNames: [], globalOrientationOffset: 0 }).members;
    expect(role(members, 'left-window').updates).toMatchObject({ width: 0.5, height: 1.3 });
    expect(role(members, 'right-window').updates).toMatchObject({ width: 0.5, height: 1.3 });
    expect(bayParametersProblem(host(), { ...p, sideWindowWidth: 0.9 })).toMatch(/side window/);
    const noSize = { ...p, sideWindowWidth: undefined };
    const anchor = asElements(buildBayBundleDraft({ host: host(), parameters: noSize, existingNames: [], globalOrientationOffset: 0 }).members)[0];
    expect(hemieBundleMissing(anchor, [host(), anchor])).toBe('Give Bay 1 a side window width and height.');
  });

  it('takes a front width, from a side angle on a bay saved with one, and a lower bay wall height', () => {
    const { frontWidth, ...saved } = SAVED_BAY;
    expect(bayParameters({ ...saved, sideAngle: 45 } as never).frontWidth).toBe(frontWidth);
    expect(bayParameters({ ...saved, sideAngle: 90 } as never).frontWidth).toBe(2);
    const low = buildBayBundleDraft({ host: host(), parameters: { ...bayParameters(SAVED_BAY as never), wallHeight: 2.4 }, existingNames: [], globalOrientationOffset: 0 });
    expect(role(low.members, 'front-wall').updates.height).toBe(2.4);
    expect(role(low.members, 'roof').updates.base_height).toBe(2.4);
    expect(bayParametersProblem(host(), { ...DRAWN_BAY, wallHeight: 3 })).toMatch(/bay wall height/);
    expect(bayParametersProblem(host(), { ...DRAWN_BAY, frontWidth: 2.1 })).toMatch(/front facet width/);
  });

  it('has no floor over a lower bay and no roof under a bay above', () => {
    const lower = buildBayBundleDraft({ host: host(0), parameters: { ...DRAWN_BAY, roof: 'flat' }, existingNames: [], globalOrientationOffset: 0 });
    const upper = buildBayBundleDraft({ host: host(1), parameters: { ...DRAWN_BAY, roof: 'flat' }, existingNames: ['Bay 1 front'], globalOrientationOffset: 0 });
    expect(roles(upper.members)).not.toContain('floor');
    expect(roles(upper.members)).toContain('roof');
    const elements = [host(0), host(1), ...asElements(lower.members), ...asElements(upper.members).map((e) => ({ ...e, id: `u${e.id}` }))];
    expect(bayCoveredAbove(host(0), DRAWN_BAY, elements)).toBe(true);
    expect(bayCoveredAbove(host(1), DRAWN_BAY, elements)).toBe(false);
    const covered = buildBayBundleDraft({ host: host(0), parameters: { ...DRAWN_BAY, roof: 'flat' }, covered: true, existingNames: [], globalOrientationOffset: 0 });
    expect(roles(covered.members)).not.toContain('roof');
    // A covered bay needs no roof.
    const anchor = asElements(covered.members)[0];
    expect(hemieBundleMissing(anchor, elements.filter((e) => !e.id.startsWith('m')).concat(asElements(covered.members)))).toBe('Give Bay 1 a front window width and height.');
  });

  it('keeps names and what the user set when regenerated', () => {
    const members = asElements(draft.members);
    members[3].extra_json = { ...members[3].extra_json, window_sections: [{ window_type: 'closed' }] };
    Object.assign(members[6], { floor_type: 'Suspended_floor', extra_json: { ...members[6].extra_json, u_value: 0.5 } });
    const next = buildBayBundleDraft({
      host: host(),
      parameters: { ...bayParameters(SAVED_BAY as never), sideWindows: false, roof: 'pitched' },
      groundFloor: { floor_type: 'Slab_no_edge_insulation', extra_json: { u_value: 0.2 } } as unknown as BuildingElementGround,
      existingNames: [],
      globalOrientationOffset: 0,
      bundleId: draft.bundleId,
      bundleName: 'Bay 1',
      names: bundleMemberNames(members),
    });
    const plan = planBundleUpdate(members, next);
    expect(plan.add).toEqual([]);
    expect(plan.remove).toEqual(['m4', 'm5']);
    expect(plan.update.m3.extra_json).toMatchObject({ window_sections: [{ window_type: 'closed' }] });
    expect(plan.update.m1.extra_json).toHaveProperty('geometry_face');
    expect(plan.update.m7).toMatchObject({ pitch: 35 });
    expect(plan.update.m6).not.toHaveProperty('floor_type');
    expect(plan.update.m6.extra_json).toMatchObject({ u_value: 0.5, hemie_bundle: { role: 'floor' } });
  });
});

/** What a heated, open conservatory states once its fields are filled. */
const FILLED: ConservatoryParameters = {
  centre: 3, width: 3, depth: 3, conservatoryType: 'non-separated',
  wallHeight: 2.4, wallGlazingFraction: 0.75, roof: 'lean-to', roofGlazingFraction: 0.5,
};

describe('conservatory bundle', () => {
  const draft = (p: Partial<ConservatoryParameters> = {}) => buildConservatoryBundleDraft({
    host: host(),
    parameters: { ...FILLED, ...p },
    existingNames: [],
    globalOrientationOffset: 0,
  });

  it('nets the wall it adjoins only when non-separated', () => {
    expect(role(draft().members, 'front-wall').updates.extra_json.parent_netting_area).toBe(8.4);
    expect(role(draft({ conservatoryType: 'separated' }).members, 'front-wall').updates.extra_json).not.toHaveProperty('parent_netting_area');
    expect(role(draft({ conservatoryType: 'separated' }).members, 'floor').updates.extra_json.hemie_bundle).toMatchObject({
      conservatory_type: 'separated',
    });
  });

  it('glazes each wall from its glazing fraction to the eaves, and the roof to its glazing fraction', () => {
    const members = draft().members;
    const glazing = role(members, 'front-glazing');
    expect(glazing.parent_element).toBe('Conservatory 1 front');
    // A 0.75 glazing fraction of 2.4 m: a 0.6 m dwarf wall, glazed to the eaves.
    expect(glazing.updates).toMatchObject({ base_height: 0.6, height: 1.8, width: 2.8 });
    const roof = role(members, 'roof');
    // A blank pitch is drawn at 20°.
    expect(roof.updates).toMatchObject({ pitch: 20, orientation360: 180, base_height: 2.4 });
    expect(role(members, 'roof-glazing')).toMatchObject({ parent_element: 'Conservatory 1 roof' });
    const light = role(members, 'roof-glazing').updates;
    expect(light.width).toBe(roof.updates.width);
    expect(light.height).toBeCloseTo((roof.updates.height as number) * 0.5, 3);
    // The lean-to's sides rise to the wall: a profiled top, highest at the host.
    expect(role(members, 'left-wall').updates.extra_json.geometry_face).toMatchObject({
      top_profile: [{ t: 0, h: 2.4 + 1.092 }, { t: 1, h: 2.4 }],
    });
  });

  it('draws only what was drawn and answered: walls at the host height, no glazing, no roof', () => {
    const drawn = buildConservatoryBundleDraft({
      host: host(),
      parameters: { centre: 3, width: 3, depth: 3, conservatoryType: 'non-separated' },
      existingNames: [],
      globalOrientationOffset: 0,
    });
    expect(roles(drawn.members)).toEqual(['front-wall', 'left-wall', 'right-wall', 'floor']);
    expect(role(drawn.members, 'front-wall').updates.height).toBe(2.8);
    const anchor = asElements(drawn.members)[0];
    expect(hemieBundleMissing(anchor, [host(), anchor])).toBe(
      'Give Conservatory 1 a wall height to eaves, a wall glazing fraction, a roof and a roof glazing fraction.',
    );
    // Not entered in the EPC: nothing is required.
    const separated = asElements(draft({ conservatoryType: 'separated', wallHeight: undefined, roof: undefined }).members)[0];
    expect(hemieBundleMissing(separated, [host(), separated])).toBeNull();
    const unanswered = asElements(draft({ conservatoryType: undefined }).members)[0];
    expect(hemieBundleMissing(unanswered, [host(), unanswered])).toBe('Choose Separated or Unheated for Conservatory 1.');
  });

  it('refuses a glazing fraction outside 0 to 1', () => {
    expect(conservatoryParametersProblem(host(), { ...FILLED, wallGlazingFraction: 0 })).toMatch(/wall glazing fraction/);
    expect(conservatoryParametersProblem(host(), { ...FILLED, roofGlazingFraction: 1.2 })).toMatch(/roof glazing fraction/);
    expect(conservatoryParametersProblem(host(), FILLED)).toBeNull();
  });

  it('has a dual-pitch roof: two slopes from a ridge to a front gable', () => {
    const members = draft({ roof: 'dual', roofPitch: 20 }).members;
    // Slopes face west and east, each over half the 3 m width; each has a rooflight.
    expect(role(members, 'roof').updates).toMatchObject({ pitch: 20, orientation360: 270, width: 3 });
    expect(role(members, 'roof-2').updates).toMatchObject({ pitch: 20, orientation360: 90, width: 3 });
    expect(role(members, 'roof-glazing-2').parent_element).toBe('Conservatory 1 roof right');
    expect(role(members, 'front-wall').updates.extra_json.geometry_face).toMatchObject({
      top_profile: [{ t: 0, h: 2.4 }, { t: 0.5, h: 2.4 + 0.546 }, { t: 1, h: 2.4 }],
    });
    expect(role(members, 'left-wall').updates.extra_json).not.toHaveProperty('geometry_face');
  });

  it('reads a saved conservatory: its dwarf wall as a glazing fraction, its roof glazing from the rooflight', () => {
    const saved = { centre: 3, width: 3, depth: 3, wallHeight: 2.4, dwarfWallHeight: 0.6, roof: 'lean-to', roofPitch: 20, conservatoryType: 'non-separated' };
    const members = asElements(buildConservatoryBundleDraft({ host: host(), parameters: { ...FILLED, roofGlazingFraction: 0.4, roofPitch: 20 }, existingNames: [], globalOrientationOffset: 0 }).members);
    const read = conservatoryParameters(saved as never, members);
    expect(read).toEqual({ centre: 3, width: 3, depth: 3, wallHeight: 2.4, wallGlazingFraction: 0.75, roof: 'lean-to', roofPitch: 20, roofGlazingFraction: 0.4, conservatoryType: 'non-separated' });
    // A new one is read as it is.
    expect(conservatoryParameters(FILLED, members)).toBe(FILLED);
  });

  it('states the unheated space on an unheated conservatory', () => {
    const members = draft({ conservatoryType: 'unheated', adjacentSpaceType: 'garage' }).members;
    expect(role(members, 'left-wall').updates.extra_json.hemie_bundle).toMatchObject({ adjacent_space_type: 'garage' });
  });

  it('names a bundle whose host wall moved', () => {
    const members = asElements(draft().members);
    const anchor = members[0];
    expect(hemieBundleHostProblem(anchor, [host(), ...members])).toBeNull();
    const moved = { ...host(), coordinates: [{ x: 0, y: -1, z: 0 }, { x: 6, y: -1, z: 0 }] };
    expect(hemieBundleHostProblem(anchor, [moved, ...members])).toMatch(/no longer sits on its host wall 'Wall \(S\)'/);
    expect(hemieBundleHostProblem(anchor, members)).toMatch(/is gone/);
  });
});

describe('bundle parts', () => {
  const members = asElements(buildConservatoryBundleDraft({ host: host(), parameters: FILLED, existingNames: [], globalOrientationOffset: 0 }).members);

  it('lists walls, roof and floor, the wall glazing as one row and the rooflights as another', () => {
    expect(hemieBundleParts(members).map((part) => [part.label, part.ids.length, part.mixed])).toEqual([
      ['Front', 1, false], ['Left side', 1, false], ['Right side', 1, false], ['Roof', 1, false], ['Floor', 1, false], ['3 glazing', 3, false], ['Roof glazing', 1, false],
    ]);
  });

  it('says Mixed when the members of a row differ in what the user set', () => {
    const glazing = members.filter((m) => m.type === 'BuildingElementTransparent');
    // The editor's own bookkeeping is not a difference.
    glazing[1] = { ...glazing[1], floorId: 'other', _v: 2 } as never;
    expect(hemieBundleParts(members.map((m) => (m.id === glazing[1].id ? glazing[1] : m))).find((part) => part.label === '3 glazing')!.mixed).toBe(false);
    glazing[0].extra_json = { ...glazing[0].extra_json, u_value: 1.4 };
    expect(hemieBundleParts(members).find((part) => part.label === '3 glazing')!.mixed).toBe(true);
  });
});

describe('bundle store edits', () => {
  const store = () => {
    const s = createGeometryStore({ defaultDefaultsPath: null });
    s.getState().addZone({ name: 'Dwelling', floorArea: 36, height: 2.8, volume: 100.8 });
    const zoneId = s.getState().zones[0]!.id;
    s.getState().addElements([{ ...host(), zoneId }] as never);
    const wall = Object.values(s.getState().elementsById)[0] as BuildingElementOpaque;
    const placed = drawHemieBundle(s.getState(), 'bay', wall, { ...DRAWN_BAY, roof: 'flat' });
    if ('problem' in placed) throw new Error(placed.problem);
    return { s, wall, anchorId: placed.anchorId };
  };

  it('adds a roof in one step, and drops it under a bay placed above', () => {
    const s = createGeometryStore({ defaultDefaultsPath: null });
    s.getState().addZone({ name: 'Dwelling', floorArea: 36, height: 2.8, volume: 100.8 });
    const zoneId = s.getState().zones[0]!.id;
    s.getState().addElements([{ ...host(0), zoneId }, { ...host(1), zoneId }] as never);
    const [lower, upper] = Object.values(s.getState().elementsById) as BuildingElementOpaque[];
    const placed = drawHemieBundle(s.getState(), 'bay', lower, DRAWN_BAY);
    if ('problem' in placed) throw new Error(placed.problem);
    const roofOf = (anchorId: string) => {
      const all = Object.values(s.getState().elementsById);
      return getHemieBundleMembers(all, getHemieBundle(s.getState().elementsById[anchorId])!.bundle_id)
        .filter((m) => getHemieBundle(m)!.role === 'roof').length;
    };
    drawHemieBundle(s.getState(), 'bay', lower, { ...DRAWN_BAY, roof: 'flat' }, s.getState().elementsById[placed.anchorId]);
    expect(roofOf(placed.anchorId)).toBe(1);
    drawHemieBundle(s.getState(), 'bay', upper, { ...DRAWN_BAY, roof: 'flat' });
    expect(roofOf(placed.anchorId)).toBe(0);
  });

  it('gives a new bay its own id after an earlier one was renamed', () => {
    const { s, wall, anchorId } = store();
    const anchor = s.getState().elementsById[anchorId];
    s.getState().updateElement(anchorId, { extra_json: { ...anchor.extra_json, hemie_bundle: { ...getHemieBundle(anchor)!, bundle_name: 'Porch' } } });
    for (const m of Object.values(s.getState().elementsById)) {
      if (getHemieBundle(m)) s.getState().updateElement(m.id, { name: m.name.replace('Bay 1', 'Porch') });
    }
    const second = drawHemieBundle(s.getState(), 'bay', wall, { ...DRAWN_BAY, centre: 5, openingWidth: 1 });
    if ('problem' in second) throw new Error(second.problem);
    expect(getHemieBundle(s.getState().elementsById[second.anchorId])!.bundle_id).not.toBe(getHemieBundle(anchor)!.bundle_id);
  });

  it('refuses a bay above the ground floor with no bay below', () => {
    const s = createGeometryStore({ defaultDefaultsPath: null });
    s.getState().addZone({ name: 'Dwelling', floorArea: 36, height: 2.8, volume: 100.8 });
    s.getState().addElements([{ ...host(1), zoneId: s.getState().zones[0]!.id }] as never);
    const upper = Object.values(s.getState().elementsById)[0] as BuildingElementOpaque;
    expect(drawHemieBundle(s.getState(), 'bay', upper, DRAWN_BAY)).toMatchObject({ problem: expect.stringMatching(/bay below/) });
    // One left alone when the bay below goes: a blocking issue on it.
    const lone = asElements(buildBayBundleDraft({ host: host(1), parameters: { ...DRAWN_BAY, roof: 'flat' }, existingNames: [], globalOrientationOffset: 0 }).members);
    expect(hemieBundleMissing(lone[0], [host(1), ...lone])).toMatch(/no bay below it/);
  });

  it('keeps a saved bay with no roof as entered', () => {
    const p = bayParameters({ ...SAVED_BAY, roof: 'none' } as never);
    expect(p.roof).toBe('none');
    const members = buildBayBundleDraft({ host: host(), parameters: p, existingNames: [], globalOrientationOffset: 0 }).members;
    expect(roles(members)).not.toContain('roof');
    const anchor = asElements(members)[0];
    expect(hemieBundleMissing(anchor, [host(), anchor])).toBeNull();
  });

  it('moves a bay with its host wall', () => {
    const { s, wall, anchorId } = store();
    s.getState().updateElement(wall.id, { coordinates: [{ x: 0, y: -1, z: 0 }, { x: 6, y: -1, z: 0 }] });
    const all = Object.values(s.getState().elementsById);
    const anchor = s.getState().elementsById[anchorId];
    expect(anchor.coordinates[0].y).toBeCloseTo(-1.6, 6);
    expect(hemieBundleHostProblem(anchor, all)).toBeNull();
  });

  it('follows a renamed host wall', () => {
    const { s, wall, anchorId } = store();
    s.getState().updateElement(wall.id, { name: 'Front wall' });
    expect(getHemieBundle(s.getState().elementsById[anchorId])?.host_wall).toBe('Front wall');
  });

  it('detaches into ordinary elements, and deletes with its host', () => {
    const { s, wall, anchorId } = store();
    const tag = getHemieBundle(s.getState().elementsById[anchorId])!;
    expect(hemieBundleDeletion(s.getState().elementsById, [wall.id])).toMatchObject({ names: ['Bay 1'] });
    expect(hemieBundleDeletion(s.getState().elementsById, [wall.id]).ids).toHaveLength(6);
    detachHemieBundle(s.getState(), tag.bundle_id);
    const all = Object.values(s.getState().elementsById);
    expect(all.filter((e) => getHemieBundle(e))).toEqual([]);
    expect(all).toHaveLength(6);
  });
});

describe('bundle walls after a CSV round trip', () => {
  it('leave the storey height at the host wall height', () => {
    const source = createGeometryStore({ defaultDefaultsPath: null });
    source.getState().addZone({ name: 'Dwelling', floorArea: 36, height: 2.8, volume: 100.8 });
    const zoneId = source.getState().zones[0]!.id;
    const wall = { ...host(), zoneId };
    const bay = buildBayBundleDraft({
      host: wall,
      parameters: { ...bayParameters(SAVED_BAY as never), centre: 1.5, roof: 'pitched' },
      existingNames: [wall.name],
      globalOrientationOffset: 0,
    });
    const conservatory = buildConservatoryBundleDraft({
      host: wall,
      parameters: { ...FILLED, centre: 4.5, wallHeight: 2.8, roofPitch: 20 },
      existingNames: [wall.name],
      globalOrientationOffset: 0,
    });
    source.getState().addElements([
      wall,
      ...[...bay.members, ...conservatory.members].map((m) => ({
        ...m.updates, name: m.name, type: m.type, zoneId, parent_element: m.parent_element,
      })),
    ] as never);

    const loaded = createGeometryStore({ defaultDefaultsPath: null });
    loaded.getState().loadFromCSV(source.getState().generateCSV({ allowUnresolvedMigration: true }));
    const elements = Object.values(loaded.getState().elementsById);
    // The profiled side walls come back with their mean height, above the host's.
    const side = elements.find((element) => element.name === 'Conservatory 1 left side')!;
    expect(side.height).toBeGreaterThan(2.8);
    expect(getMaxLineWallHeightOnFloor(0, elements)).toBe(2.8);
  });
});

describe('window sections', () => {
  it('states an opening angle on each part of a section, and reads it back', () => {
    const window = { extra_json: {} } as unknown as Element;
    const extra = withWindowSections(window, [
      { windowType: 'closed', widthFraction: 0.4 },
      { windowType: 'top dual air flow path', openingAngle: 'restricted' },
      { windowType: 'full opening', openingAngle: 'standard' },
    ]);
    expect(extra.window_sections).toEqual([
      { window_type: 'closed', width_fraction: 0.4 },
      { window_type: 'top dual air flow path', window_part_list: [{ opening_angle_category: 'restricted' }, { opening_angle_category: 'restricted' }] },
      { window_type: 'full opening' },
    ]);
    expect(windowSections({ extra_json: extra } as unknown as Element)).toEqual([
      { windowType: 'closed', widthFraction: 0.4 },
      { windowType: 'top dual air flow path', openingAngle: 'restricted' },
      { windowType: 'full opening' },
    ]);
  });
});
