// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { parseSemiDetachedSample } from '../../geometry/__fixtures__/semiDetachedWithDormer';
import { modelSegmentToThreeYaw } from '../geometryTransform';

// Roof polygons and wall segments are authored in different sections and reach the 3D view
// through different paths, so a sign or winding error in the model-to-three transform shows
// up as a roof that renders rotated against the wall it sits on. The check is that a roof
// edge and the wall directly beneath it resolve to the same line.
//
// The sample model carries the relationship under test: the south pitched roof's eaves
// edge sits above the south wall.
describe('geometryTransform fixture alignment', () => {
  it('keeps a roof eaves edge aligned with the wall beneath it', () => {
    const parsed = parseSemiDetachedSample();
    const byName = (name: string) =>
      (parsed.elements as { name: string; coordinates?: { x: number; y: number }[] }[])
        .find((element) => element.name === name);

    const roof = byName('Pitched Roof (S)');
    const wall = byName('Wall (S)');
    expect(roof?.coordinates?.length).toBeGreaterThanOrEqual(4);
    expect(wall?.coordinates?.length).toBeGreaterThanOrEqual(2);

    const roofPoints = roof!.coordinates!;
    const wallPoints = wall!.coordinates!;

    // The eaves edge: the roof polygon's first edge, which runs along the south elevation.
    const roofYaw = modelSegmentToThreeYaw(
      [roofPoints[0].x, roofPoints[0].y],
      [roofPoints[1].x, roofPoints[1].y],
    );
    const wallYaw = modelSegmentToThreeYaw(
      [wallPoints[0].x, wallPoints[0].y],
      [wallPoints[1].x, wallPoints[1].y],
    );

    // Directionless: the two are drawn in whichever winding their section produced, so a
    // half-turn between them is the same line, not a misalignment.
    const signed = Math.abs(Math.atan2(Math.sin(roofYaw - wallYaw), Math.cos(roofYaw - wallYaw)));
    expect(Math.min(signed, Math.abs(Math.PI - signed))).toBeLessThan(0.01);
  });

  it('resolves a perpendicular roof edge as perpendicular', () => {
    // Guards the assertion above against a transform that collapses every segment to the
    // same yaw, which would satisfy it for the wrong reason.
    const parsed = parseSemiDetachedSample();
    const roof = (parsed.elements as { name: string; coordinates?: { x: number; y: number }[] }[])
      .find((element) => element.name === 'Pitched Roof (S)');
    const points = roof!.coordinates!;

    const eavesYaw = modelSegmentToThreeYaw(
      [points[0].x, points[0].y],
      [points[1].x, points[1].y],
    );
    const rakeYaw = modelSegmentToThreeYaw(
      [points[1].x, points[1].y],
      [points[2].x, points[2].y],
    );
    const signed = Math.abs(Math.atan2(Math.sin(eavesYaw - rakeYaw), Math.cos(eavesYaw - rakeYaw)));
    expect(Math.min(signed, Math.abs(Math.PI - signed))).toBeCloseTo(Math.PI / 2, 2);
  });
});
