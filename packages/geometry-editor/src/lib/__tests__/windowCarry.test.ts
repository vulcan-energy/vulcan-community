// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import { createGeometryStore } from '../../stores/geometryStore';
import { unavailableGeometrySchemaPort } from '../../../../geometry-editor-host/src/schemaPort';
import { carryChangeLabel, carryChanges, carryPatch, matchingOpenings, openingCarry, openingCarrySummary, openingKind } from '../windowCarry';

const line = [{ x: 0, y: 0, z: 0 }, { x: 1.1, y: 0, z: 0 }];
const shape = [{ x: 0, y: 0, z: 3 }, { x: 1, y: 0, z: 3 }, { x: 1, y: 1, z: 3 }, { x: 0, y: 1, z: 3 }];
const win = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `Window ${id}`, type: 'BuildingElementTransparent', zoneId: 'z', coordinates: line,
  width: 1.1, height: 1.2, base_height: 0.9, parent_element: 'Wall (S)', orientation360: 180, pitch: 90,
  extra_json: { window_sections: [{ window_type: 'half opening top' }], glazing_type: 'double', frame_material: 'PVC', glazing_gap: '16mm', overhang: 'common roof', _name_auto_sync: false },
  ...over,
}) as unknown as Element;

describe('openingCarry', () => {
  it('carries what was stated, never name, host, position or width', () => {
    expect(openingCarry(win('1'))).toEqual({
      height: 1.2, base_height: 0.9,
      extra_json: { window_sections: [{ window_type: 'half opening top' }], glazing_type: 'double', frame_material: 'PVC', glazing_gap: '16mm', overhang: 'common roof' },
    });
  });

  it('a rooflight carries no size or sill: its shape gives them', () => {
    const rooflight = win('r', { coordinates: shape });
    expect(openingKind(rooflight)).toBe('rooflight');
    expect(openingCarry(rooflight)).not.toHaveProperty('height');
    expect(openingCarry(rooflight)).not.toHaveProperty('base_height');
  });

  it('an automatic security risk stays with the storey; a changed one carries', () => {
    const ground = win('g', { extra_json: { security_risk: true } });
    expect(openingCarry(ground)).not.toHaveProperty('extra_json');
    const changed = win('c', { _windowSecurityRiskUserOverride: true, extra_json: { security_risk: false } });
    expect(openingCarry(changed)).toMatchObject({ _windowSecurityRiskUserOverride: true, extra_json: { security_risk: false } });
    // An older file states it with the marker only.
    expect(openingCarry(win('m', { extra_json: { security_risk: true, _window_security_risk_user_override: true } })))
      .toMatchObject({ _windowSecurityRiskUserOverride: true, extra_json: { security_risk: true } });
  });

  it('a stated security risk drawn on another storey stays as stated', () => {
    const store = createGeometryStore({ defaultDefaultsPath: null, schemaPort: unavailableGeometrySchemaPort });
    const upstairs = win('u', { coordinates: [{ x: 0, y: 0, z: 1 }, { x: 1.1, y: 0, z: 1 }], parent_element: null, extra_json: { security_risk: true } });
    // Same value as the placeholder holds: only the stated flag keeps it from the storey default.
    store.setState({ elementsById: { u: upstairs }, elementIds: ['u'] });
    store.getState().updateElement('u', openingCarry(win('g', { _windowSecurityRiskUserOverride: true, extra_json: { security_risk: true } }))!);
    expect(store.getState().elementsById.u?.extra_json?.security_risk).toBe(true);
  });

  it('a rooflight keeps its own free area height', () => {
    expect(openingCarry(win('r2', { coordinates: shape, free_area_height: 1.2 }))).not.toHaveProperty('free_area_height');
  });

  it('a door never carries into a window', () => {
    const door = { ...win('d'), type: 'BuildingElementOpaque', is_external_door: true } as unknown as Element;
    expect(openingKind(door)).toBeNull();
    expect(openingCarry(door)).toBeNull();
  });

  it('a window with nothing stated carries nothing', () => {
    expect(openingCarry(win('e', { height: undefined, base_height: undefined, extra_json: {} }))).toBeNull();
  });

  it('names a carried trickle vent and a changed security risk too', () => {
    expect(openingCarrySummary({ extra_json: { has_trickle_vent: true, security_risk: false } } as never)).toBe('trickle vent · security risk: no');
  });

  it('summarises for the toolbar', () => {
    expect(openingCarrySummary(openingCarry(win('1'))!)).toBe('1.20 m high · sill 0.90 m · Half opening top · Double, PVC, 16mm · shading: Common roof');
  });
});

describe('matchingOpenings', () => {
  it('matches width and carried values only, not name, host or position', () => {
    const a = win('1');
    const b = win('2', { parent_element: 'Wall (N)', orientation360: 0, coordinates: [{ x: 5, y: 5, z: 0 }, { x: 6.1, y: 5, z: 0 }] });
    const wider = win('3', { width: 1.5 });
    const otherGlazing = win('4', { extra_json: { ...(win('4').extra_json as object), glazing_type: 'triple' } });
    const rooflight = win('5', { coordinates: shape });
    expect(matchingOpenings(a, [a, b, wider, otherGlazing, rooflight]).map((el) => el.id)).toEqual(['2']);
  });

  it('a shaped window never matches a plain one', () => {
    const face = { kind: 'profiled-line-face', top_profile: [{ t: 0, h: 1 }, { t: 0.5, h: 1.2 }, { t: 1, h: 1 }], bottom_profile: [{ t: 0, h: 0 }, { t: 1, h: 0 }] };
    const a = win('1');
    const shaped = win('2', { extra_json: { ...(win('2').extra_json as object), geometry_face: face } });
    expect(matchingOpenings(a, [a, shaped])).toEqual([]);
  });
});

describe('after-edit apply', () => {
  it('names the carried values an edit changed', () => {
    const before = win('1');
    expect(carryChanges(before, win('1', { height: 1.3 }))).toEqual(['height']);
    expect(carryChanges(before, win('1', { height: 1.3, base_height: 1 }))).toEqual(['height', 'base_height']);
    expect(carryChanges(before, win('1', { width: 2, name: 'Other' }))).toEqual([]);
    expect(carryChanges(before, win('1', { extra_json: { ...(before.extra_json as object), glazing_type: 'triple' } }))).toEqual(['extra.glazing_type']);
  });

  it('offers nothing once the outline changed: its height belongs to the shape', () => {
    const face = { kind: 'profiled-line-face', top_profile: [{ t: 0, h: 1.2 }, { t: 0.5, h: 1.5 }, { t: 1, h: 1.2 }], bottom_profile: [{ t: 0, h: 0 }, { t: 1, h: 0 }] };
    const shaped = win('1', { height: 1.5, extra_json: { ...(win('1').extra_json as object), geometry_face: face } });
    expect(carryChanges(win('1'), shaped)).toEqual([]);
    expect(carryChanges(shaped, win('1'))).toEqual([]);
  });

  it('copies a changed security risk as stated', () => {
    const source = win('1', { _windowSecurityRiskUserOverride: true, extra_json: { security_risk: true } } as never);
    expect(carryPatch(win('2', { extra_json: { security_risk: true } }), source, ['_windowSecurityRiskUserOverride', 'extra.security_risk']))
      .toEqual({ _windowSecurityRiskUserOverride: true, extra_json: { security_risk: true } });
    const older = win('1', { extra_json: { security_risk: true, _window_security_risk_user_override: true } });
    expect(carryPatch(win('2'), older, ['_windowSecurityRiskUserOverride'])).toEqual({ _windowSecurityRiskUserOverride: true });
  });

  it('labels one change with its value, several by name', () => {
    expect(carryChangeLabel(['height'], win('1', { height: 1.3 }))).toBe('Height 1.3 m');
    expect(carryChangeLabel(['height', 'base_height'], win('1'))).toBe('Height and sill');
    expect(carryChangeLabel(['extra.glazing_type', 'extra.frame_material', 'extra.overhang', 'height'], win('1'))).toBe('Height, glazing and close shading');
  });

  it('copies only the changed values, keeping the target\'s own', () => {
    const source = win('1', { height: 1.3, extra_json: { ...(win('1').extra_json as object), overhang: undefined, glazing_type: 'triple' } });
    const target = win('2', { base_height: 0.8, extra_json: { ...(win('2').extra_json as object), frame_material: 'wood', _name_auto_sync: true } });
    expect(carryPatch(target, source, ['height', 'extra.glazing_type', 'extra.overhang'])).toEqual({
      height: 1.3,
      extra_json: { window_sections: [{ window_type: 'half opening top' }], glazing_type: 'triple', frame_material: 'wood', glazing_gap: '16mm', _name_auto_sync: true },
    });
  });
});
