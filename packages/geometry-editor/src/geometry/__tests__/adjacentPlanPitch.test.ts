// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { normalizeHorizontalAdjacentPlanPitch } from '../adjacentPlanPitch';

describe('normalizeHorizontalAdjacentPlanPitch', () => {
  const horizontalLoop = [
    { x: -5.5, y: -2.98, z: 1 },
    { x: 0.5, y: -2.98, z: 1 },
    { x: 0.5, y: 3.02, z: 1 },
    { x: -5.5, y: 3.02, z: 1 },
  ];

  it('maps wall-default 90 to 0 for coplanar horizontal polygons', () => {
    expect(normalizeHorizontalAdjacentPlanPitch(90, horizontalLoop)).toBe(0);
  });

  it('leaves 90 for vertical (varying z) party-style geometry', () => {
    const vertical = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 2.4 },
      { x: 0, y: 1, z: 2.4 },
    ];
    expect(normalizeHorizontalAdjacentPlanPitch(90, vertical)).toBe(90);
  });

  it('leaves non-90 pitch unchanged', () => {
    expect(normalizeHorizontalAdjacentPlanPitch(0, horizontalLoop)).toBe(0);
    expect(normalizeHorizontalAdjacentPlanPitch(180, horizontalLoop)).toBe(180);
  });
});
