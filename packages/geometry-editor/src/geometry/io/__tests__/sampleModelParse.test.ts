// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { parseSemiDetachedSample } from '../../__fixtures__/semiDetachedWithDormer';

// Replaces a smoke test that parsed a model held outside this boundary and asserted a wall
// count. The sample this editor ships is the model a new user opens, so a parse regression
// in it is the one that reaches people first — and asserting the elements by name says
// what the model is, where a bare count only says how many of something there were.
describe('the shipped sample model', () => {
  const parsed = parseSemiDetachedSample();

  it('parses into its single declared zone', () => {
    expect(parsed.zones.map((zone) => zone.name)).toEqual(['Zone 1']);
  });

  it('parses the exterior fabric of both storeys and the roof', () => {
    const opaque = (parsed.elements as { type: string; name: string }[])
      .filter((element) => element.type === 'BuildingElementOpaque')
      .map((element) => element.name);

    expect(opaque).toEqual([
      'Wall (S)',
      'Wall (N)',
      'Wall (W)',
      'Door',
      'Door 1',
      'Wall (S) 1',
      'Wall (N) 1',
      'Wall (W) 1',
      'Pitched Roof (S)',
      'Pitched Roof (N)',
    ]);
  });

  it('parses the full element vocabulary the sample exercises', () => {
    const types = new Set(
      (parsed.elements as { type: string }[]).map((element) => element.type),
    );
    // A semi-detached dwelling: a party wall, ground floor, glazing and its shading, and
    // the services the FHS profile requires. If the parser silently drops a section, the
    // type it contributed disappears from here.
    for (const type of [
      'BuildingElementOpaque',
      'BuildingElementTransparent',
      'BuildingElementGround',
      'BuildingElementPartyWall',
      'BuildingElementAdjacentConditionedSpace',
      'WindowShading',
      'MechanicalVentilation',
      'WetEmitter',
      'HotWaterDemand',
      'System',
    ]) {
      expect(types, type).toContain(type);
    }
  });
});
