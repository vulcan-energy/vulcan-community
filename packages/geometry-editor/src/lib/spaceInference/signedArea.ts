// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { PlanarPoint2 } from './types';

/** Signed area / 2 for CCW positive (y up). */
export function signedShoelaceArea2(ring: PlanarPoint2[]): number {
  if (ring.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    s += ring[i].x * ring[j].y - ring[j].x * ring[i].y;
  }
  return s / 2;
}
