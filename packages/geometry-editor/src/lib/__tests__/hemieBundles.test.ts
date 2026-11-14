// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { BuildingElementGround, BuildingElementOpaque, Element } from '../../geometry/types';
import {
  BAY_DEFAULTS,
  bayParameters,
  bayParametersProblem,
  CONSERVATORY_DEFAULTS,
  buildBayBundleDraft,
  buildConservatoryBundleDraft,
  bundleMemberNames,
  getHemieBundle,
  hemieBundleHostProblem,
  planBundleUpdate,
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

describe('bay bundle', () => {
  const draft = buildBayBundleDraft({
    host: host(),
    parameters: { ...BAY_DEFAULTS, centre: 3 },
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

  it('has a front window, side windows, a ground floor of its footprint and a flat roof', () => {
    expect(draft.members.map((m) => m.role)).toEqual([
      'front-wall', 'left-wall', 'right-wall', 'front-window', 'left-window', 'right-window', 'floor', 'roof',
    ]);
    expect(role(draft.members, 'front-window').parent_element).toBe('Bay 1 front');
    expect(role(draft.members, 'floor').updates.area).toBe(0.84);
    expect(role(draft.members, 'roof').updates).toMatchObject({ pitch: 0, base_height: 2.8 });
    expect(getHemieBundle({ extra_json: role(draft.members, 'roof').updates.extra_json } as Element)).toMatchObject({
      kind: 'bay', role: 'roof', host_wall: 'Wall (S)', bundle_id: draft.bundleId,
    });
  });

  it('refuses side windows on sides too short for them', () => {
    expect(bayParametersProblem(host(), { ...BAY_DEFAULTS, centre: 3, depth: 0.15, frontWidth: 2 })).toMatch(/too short for side windows/);
    expect(bayParametersProblem(host(), { ...BAY_DEFAULTS, centre: 3, depth: 0.15, frontWidth: 2, sideWindows: false })).toBeNull();
    expect(bayParametersProblem(host(), { ...BAY_DEFAULTS, centre: 3, frontWidth: 2.1 })).toMatch(/front width/);
  });

  it('takes a front width, from a side angle on a bay saved with one, and a lower bay wall height', () => {
    const { frontWidth, ...saved } = BAY_DEFAULTS;
    expect(bayParameters({ ...saved, centre: 3, sideAngle: 45 } as never).frontWidth).toBe(frontWidth);
    expect(bayParameters({ ...saved, centre: 3, sideAngle: 90 } as never).frontWidth).toBe(2);
    const low = buildBayBundleDraft({ host: host(), parameters: { ...BAY_DEFAULTS, centre: 3, wallHeight: 2.4 }, existingNames: [], globalOrientationOffset: 0 });
    expect(role(low.members, 'front-wall').updates.height).toBe(2.4);
    expect(role(low.members, 'roof').updates.base_height).toBe(2.4);
    expect(bayParametersProblem(host(), { ...BAY_DEFAULTS, centre: 3, wallHeight: 3 })).toMatch(/bay wall height/);
  });

  it('has no floor over a lower bay', () => {
    const upper = buildBayBundleDraft({
      host: host(1),
      parameters: { ...BAY_DEFAULTS, centre: 3, roof: 'none' },
      existingNames: [],
      globalOrientationOffset: 0,
    });
    expect(upper.members.map((m) => m.role)).not.toContain('floor');
    expect(upper.members.map((m) => m.role)).not.toContain('roof');
  });

  it('keeps names and what the user set when regenerated', () => {
    const members = draft.members.map((m, i) => ({
      id: `m${i}`, name: m.name, type: m.type, parent_element: m.parent_element, ...m.updates,
    })) as unknown as Element[];
    members[3].extra_json = { ...members[3].extra_json, window_sections: [{ window_type: 'closed' }] };
    Object.assign(members[6], { floor_type: 'Suspended_floor', extra_json: { ...members[6].extra_json, u_value: 0.5 } });
    const next = buildBayBundleDraft({
      host: host(),
      parameters: { ...BAY_DEFAULTS, centre: 3, sideWindows: false, roof: 'pitched' },
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

describe('conservatory bundle', () => {
  const draft = (conservatoryType: 'non-separated' | 'separated') => buildConservatoryBundleDraft({
    host: host(),
    parameters: { ...CONSERVATORY_DEFAULTS, centre: 3, conservatoryType },
    existingNames: [],
    globalOrientationOffset: 0,
  });

  it('nets the wall it adjoins only when non-separated', () => {
    expect(role(draft('non-separated').members, 'front-wall').updates.extra_json.parent_netting_area).toBe(8.4);
    expect(role(draft('separated').members, 'front-wall').updates.extra_json).not.toHaveProperty('parent_netting_area');
    expect(role(draft('separated').members, 'floor').updates.extra_json.hemie_bundle).toMatchObject({
      conservatory_type: 'separated',
    });
  });

  it('glazes each wall above the dwarf wall and the roof with a rooflight', () => {
    const members = draft('non-separated').members;
    const glazing = role(members, 'front-glazing');
    expect(glazing.parent_element).toBe('Conservatory 1 front');
    expect(glazing.updates).toMatchObject({ base_height: 0.6, height: 1.7, width: 2.8 });
    const roof = role(members, 'roof');
    expect(roof.updates).toMatchObject({ pitch: 20, orientation360: 180, base_height: 2.4 });
    expect(role(members, 'roof-glazing')).toMatchObject({ parent_element: 'Conservatory 1 roof' });
    // Glazed throughout: the rooflight is the whole plane.
    expect(role(members, 'roof-glazing').updates).toMatchObject({ width: roof.updates.width, height: roof.updates.height });
    // The lean-to's sides rise to the wall: a profiled top, highest at the host.
    expect(role(members, 'left-wall').updates.extra_json.geometry_face).toMatchObject({
      top_profile: [{ t: 0, h: 2.4 + 1.092 }, { t: 1, h: 2.4 }],
    });
  });

  it('has a dual-pitch roof: two slopes from a ridge to a front gable', () => {
    const members = buildConservatoryBundleDraft({
      host: host(),
      parameters: { ...CONSERVATORY_DEFAULTS, centre: 3, roof: 'dual' },
      existingNames: [],
      globalOrientationOffset: 0,
    }).members;
    // Slopes face west and east, each over half the 3 m width; each has a rooflight.
    expect(role(members, 'roof').updates).toMatchObject({ pitch: 20, orientation360: 270, width: 3 });
    expect(role(members, 'roof-2').updates).toMatchObject({ pitch: 20, orientation360: 90, width: 3 });
    expect(role(members, 'roof-glazing-2').parent_element).toBe('Conservatory 1 roof right');
    expect(role(members, 'front-wall').updates.extra_json.geometry_face).toMatchObject({
      top_profile: [{ t: 0, h: 2.4 }, { t: 0.5, h: 2.4 + 0.546 }, { t: 1, h: 2.4 }],
    });
    expect(role(members, 'left-wall').updates.extra_json).not.toHaveProperty('geometry_face');
  });

  it('states the unheated space on an unheated conservatory', () => {
    const members = buildConservatoryBundleDraft({
      host: host(),
      parameters: { ...CONSERVATORY_DEFAULTS, centre: 3, conservatoryType: 'unheated', adjacentSpaceType: 'garage' },
      existingNames: [],
      globalOrientationOffset: 0,
    }).members;
    expect(role(members, 'left-wall').updates.extra_json.hemie_bundle).toMatchObject({ adjacent_space_type: 'garage' });
  });

  it('names a bundle whose host wall moved', () => {
    const members = draft('non-separated').members.map((m, i) => ({
      id: `m${i}`, name: m.name, type: m.type, parent_element: m.parent_element, ...m.updates,
    })) as unknown as Element[];
    const anchor = members[0];
    expect(hemieBundleHostProblem(anchor, [host(), ...members])).toBeNull();
    const moved = { ...host(), coordinates: [{ x: 0, y: -1, z: 0 }, { x: 6, y: -1, z: 0 }] };
    expect(hemieBundleHostProblem(anchor, [moved, ...members])).toMatch(/no longer sits on its host wall 'Wall \(S\)'/);
    expect(hemieBundleHostProblem(anchor, members)).toMatch(/is gone/);
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
      parameters: { ...BAY_DEFAULTS, centre: 1.5, roof: 'pitched' },
      existingNames: [wall.name],
      globalOrientationOffset: 0,
    });
    const conservatory = buildConservatoryBundleDraft({
      host: wall,
      parameters: { ...CONSERVATORY_DEFAULTS, centre: 4.5, wallHeight: 2.8 },
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
