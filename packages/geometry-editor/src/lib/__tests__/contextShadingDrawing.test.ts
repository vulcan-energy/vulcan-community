// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { wallExtension } from '../contextShadingDrawing';

const wall: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 0, y: 0 }, { x: 8, y: 0 }];

describe('wallExtension', () => {
  it('is null while the measurement starts on the wall', () => {
    expect(wallExtension(wall, { x: 0, y: 0 })).toBeNull();
    expect(wallExtension(wall, { x: 5, y: 0 })).toBeNull();
    expect(wallExtension(wall, { x: 8, y: 0 })).toBeNull();
  });

  it('runs from the wall end it overshoots to the start of the measurement', () => {
    expect(wallExtension(wall, { x: 11, y: 0 })).toEqual([{ x: 8, y: 0 }, { x: 11, y: 0 }]);
    expect(wallExtension(wall, { x: -2.5, y: 0 })).toEqual([{ x: 0, y: 0 }, { x: -2.5, y: 0 }]);
  });

  it('ignores a wall with no length', () => {
    expect(wallExtension([{ x: 1, y: 1 }, { x: 1, y: 1 }], { x: 3, y: 1 })).toBeNull();
  });
});
