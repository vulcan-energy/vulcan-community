// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import {
  setLiveContextShadingCoordinates,
  useAnyLiveContextShadingCoordinates,
  useLiveContextShadingCoordinates,
} from '../contextShadingLiveCoordinates';

afterEach(() => act(() => setLiveContextShadingCoordinates(null)));

it('gives an element that is not Context Shading nothing during a drag, so it does not re-render per move', () => {
  const renders = { none: 0, other: 0, dragged: 0, any: 0 };
  const none = renderHook(() => { renders.none += 1; return useLiveContextShadingCoordinates(undefined); });
  const other = renderHook(() => { renders.other += 1; return useLiveContextShadingCoordinates('b'); });
  const dragged = renderHook(() => { renders.dragged += 1; return useLiveContextShadingCoordinates('a'); });
  const any = renderHook(() => { renders.any += 1; return useAnyLiveContextShadingCoordinates(); });
  for (const x of [1, 2, 3]) act(() => setLiveContextShadingCoordinates({ elementId: 'a', coordinates: [{ x, y: 0, z: 0 }] }));
  expect(none.result.current).toBeNull();
  expect(other.result.current).toBeNull();
  expect(dragged.result.current?.coordinates[0].x).toBe(3);
  expect(any.result.current?.elementId).toBe('a');
  expect(renders.none).toBe(1);
  expect(renders.other).toBe(1);
  expect(renders.dragged).toBe(4);
  expect(renders.any).toBe(4);
});
