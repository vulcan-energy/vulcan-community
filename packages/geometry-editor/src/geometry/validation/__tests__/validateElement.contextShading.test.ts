// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { unavailableGeometrySchemaPort } from '../../../../../geometry-editor-host/src/schemaPort';
import type { ContextShading, Element } from '../../types';
import { validateElementCore } from '../validateElement';
import { CONTEXT_SHADING_DEFAULT_CENTRE } from '../../../lib/contextShadingGeometry';
import { DEVELOPMENT_CONTEXT_SHADING_META_KEY } from '../../../lib/developmentContextShading';

type P = { x: number; y: number };
const at = (points: number[][]) => points.map(([x, y]) => ({ x, y, z: 0 }));
// 4 x 4 m ground floor, centre (2, 2), no wall thickness.
const ground = { id: 'g', name: 'Ground', type: 'BuildingElementGround', thickness_walls: 0, coordinates: at([[0, 0], [4, 0], [4, 4], [0, 4]]) } as unknown as Element;
const shading = (id: string, coordinates: P[] | undefined, extra: Partial<ContextShading> = {}) => ({
  id, name: id, type: 'ContextShading', shading_type: 'obstacle', start_angle: 0, end_angle: 10, distance: 1, height: 5,
  parent_element: CONTEXT_SHADING_DEFAULT_CENTRE, coordinates: coordinates && at(coordinates.map(({ x, y }) => [x, y])), ...extra,
}) as ContextShading;
const validate = (element: Element, others: Element[] = []) => validateElementCore(element, {
  schemaPort: unavailableGeometrySchemaPort,
  elementsById: Object.fromEntries([ground, element, ...others].map((e) => [e.id, e])),
  floors: [],
  globalOrientationOffset: 0,
});
const pts = (points: number[][]): P[] => points.map(([x, y]) => ({ x, y }));

describe('External shading validation', () => {
  it('flags each part that touches the dwelling, by its directions', () => {
    // An L: its east arm stands against the east wall, its north arm 1 m off the north wall.
    const l = shading('L', pts([[4, 0], [5, 0], [5, 6], [-2, 6], [-2, 5], [4, 5]]));
    const { issues } = validate(l);
    expect(issues).toEqual([expect.objectContaining({
      fieldKey: 'parts.1.distance',
      message: "L (ContextShading): Direction 34°–135°: distance is 0 m. The object touches or overlaps the dwelling's closest wall. HEM needs a distance above 0. Move it away from the wall.",
    })]);
  });

  it('checks a generated neighbour on the parts it keeps: its parts at 0 m are left out, so not flagged', () => {
    // The same L, written by the Development sync from a neighbouring model.
    const meta = { version: 1, projectId: 'p', activeStem: 'a', sourceStem: 'b' };
    const l = shading('L', pts([[4, 0], [5, 0], [5, 6], [-2, 6], [-2, 5], [4, 5]]), {
      extra_json: { [DEVELOPMENT_CONTEXT_SHADING_META_KEY]: meta },
    });
    expect(validate(l).issues).toEqual([]);
  });

  it('reports an object over the centre, a crossing outline and one narrower than 1 degree', () => {
    expect(validate(shading('Over', pts([[1, 1], [3, 1], [3, 3], [1, 3]]))).issues.map((i) => i.message))
      .toContain("Over (ContextShading): The object covers the shading centre. Draw it outside the dwelling.");
    expect(validate(shading('Bow', pts([[6, 0], [8, 2], [8, 0], [6, 2]]))).issues.map((i) => i.fieldKey)).toContain('coordinates');
    expect(validate(shading('Far', pts([[2, 400], [2.5, 400], [2.5, 401], [2, 401]]))).issues.map((i) => i.message))
      .toContain("Far (ContextShading): This object is narrower than 1° seen from the shading centre, so HEM can't take it.");
  });

  it('refuses a parent that is not a floor, and warns when objects use different centres', () => {
    const wall = { id: 'w', name: 'Wall', type: 'BuildingElementOpaque', pitch: 90, coordinates: at([[0, 0], [4, 0]]) } as unknown as Element;
    const onWall = shading('A', pts([[1, 6], [3, 6]]), { parent_element: 'Wall' });
    expect(validate(onWall, [wall]).issues.map((i) => i.message)).toContain('A (ContextShading): The shading centre must be a floor of the dwelling.');
    const other = shading('B', pts([[1, 8], [3, 8]]), { parent_element: 'Ground' });
    expect(validate(shading('C', pts([[1, 6], [3, 6]])), [other]).warnings.map((w) => w.message))
      .toContain('C (ContextShading): External shading objects use different shading centres. Choose one centre for all of them.');
    expect(validate(shading('C', pts([[1, 6], [3, 6]]), { parent_element: 'Ground' }), [other]).warnings.map((w) => w.fieldKey)).not.toContain('parent_element');
  });

  it('refuses an element named as the default centre, and asks for a centre when the parent is blank', () => {
    const named = { ...ground, id: 'g2', name: CONTEXT_SHADING_DEFAULT_CENTRE } as Element;
    expect(validate(named).issues).toContainEqual(expect.objectContaining({
      fieldKey: 'name', message: `${CONTEXT_SHADING_DEFAULT_CENTRE} (BuildingElementGround): ${CONTEXT_SHADING_DEFAULT_CENTRE} is kept for the default shading centre. Rename this element.`,
    }));
    // A blank parent keeps the values the row states: nothing is derived, so the centre is asked for.
    const blank = shading('Blank', pts([[1, 6], [3, 6]]), { parent_element: null });
    expect(validate(blank).issues.map((i) => i.message)).toEqual(['Blank (ContextShading): Choose a shading centre.']);
  });

  it('flags a single-part object that touches the dwelling', () => {
    const line = shading('Line', pts([[1, 4], [3, 4]]));
    expect(validate(line).issues.map((i) => i.message)).toEqual([
      "Line (ContextShading): Distance is 0 m. The object touches or overlaps the dwelling's closest wall. HEM needs a distance above 0. Move it away from the wall.",
    ]);
  });

  it('accepts a typed row with no drawing, with or without a centre: it converts as typed', () => {
    expect(validate(shading('Typed', undefined)).issues).toEqual([]);
    expect(validate(shading('Typed', undefined, { parent_element: null })).issues).toEqual([]);
    expect(validate(shading('Typed', undefined, { distance: undefined })).issues.map((i) => i.fieldKey)).toEqual(['distance']);
  });

  it('asks for a floor when the default centre has none', () => {
    const lone = shading('Lone', pts([[1, 6], [3, 6]]));
    const issues = validateElementCore(lone, {
      schemaPort: unavailableGeometrySchemaPort, elementsById: { [lone.id]: lone }, floors: [], globalOrientationOffset: 0,
    }).issues;
    expect(issues.map((i) => i.message)).toEqual(['Lone (ContextShading): The default shading centre needs a floor of the dwelling. Draw a floor.']);
  });

  it('checks the parts a row without coordinates states, and explains an unreadable parts cell', () => {
    const typed = shading('Typed', undefined, { parts: [{ start_angle: 220, end_angle: 264, distance: 4.97 }, { start_angle: 264, end_angle: 335, distance: 0 }] });
    expect(validate(typed).issues).toEqual([expect.objectContaining({
      fieldKey: 'parts.1.distance',
      message: "Typed (ContextShading): Direction 264°–335°: distance is 0 m. The object touches or overlaps the dwelling's closest wall. HEM needs a distance above 0. Enter a distance above 0.",
    })]);
    const unreadable = { ...shading('Bad', undefined), nonNumericCells: { parts: '220-264' } } as ContextShading;
    expect(validate(unreadable).issues.map((i) => i.message))
      .toContain("Bad (ContextShading): Parts is '220-264'. Write start:end:distance for each part, separated by semicolons.");
  });
});
