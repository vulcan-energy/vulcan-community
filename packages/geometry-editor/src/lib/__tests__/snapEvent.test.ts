// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { snapEventsEqual, type SnapEvent } from '../snapEvent';

describe('snapEventsEqual', () => {
  const base: SnapEvent = {
    kind: 'corner',
    sourceElementId: 'wall-1',
    sourceVertexOrder: 2,
  };

  it('treats nulls and field-identical events as equal', () => {
    expect(snapEventsEqual(null, null)).toBe(true);
    expect(snapEventsEqual(base, { ...base })).toBe(true);
    expect(snapEventsEqual(
      { ...base, position: { x: 1, y: 2 } },
      { ...base, position: { x: 1, y: 2 } },
    )).toBe(true);
  });

  it.each([
    { ...base, kind: 'parent-edge' as const },
    { ...base, sourceElementId: 'wall-2' },
    { ...base, sourceVertexOrder: 1 },
    { ...base, sourceEdgeIndex: 3 },
    { ...base, value: 90 },
    { ...base, position: { x: 1, y: 2 } },
  ])('detects a changed snap field: %o', (changed) => {
    expect(snapEventsEqual(base, changed)).toBe(false);
  });

  it('detects either snapped-position coordinate changing', () => {
    const positioned = { ...base, position: { x: 1, y: 2 } };
    expect(snapEventsEqual(positioned, { ...positioned, position: { x: 1.1, y: 2 } })).toBe(false);
    expect(snapEventsEqual(positioned, { ...positioned, position: { x: 1, y: 2.1 } })).toBe(false);
  });

  it('treats engage and disengage as changes', () => {
    expect(snapEventsEqual(base, null)).toBe(false);
    expect(snapEventsEqual(null, base)).toBe(false);
  });
});
