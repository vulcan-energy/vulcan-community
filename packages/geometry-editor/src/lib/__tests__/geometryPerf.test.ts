// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from 'vitest';

import { geometryPerf } from '../geometryPerf';

describe('geometryPerf', () => {
  afterEach(() => {
    geometryPerf.reset();
    geometryPerf.disable();
    vi.restoreAllMocks();
  });

  it('takes a silent snapshot with retained samples for drop-window deltas', () => {
    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => undefined);
    geometryPerf.reset();
    geometryPerf.enable({ slowThresholdMs: 9999 });

    geometryPerf.record('GeometryCanvas.layer', 2);
    geometryPerf.record('GeometryCanvas.layer', 3);
    geometryPerf.record('GeometryCanvas.small', 1);

    const rows = geometryPerf.snapshot({ sortBy: 'total', includeSamples: true });

    expect(tableSpy).not.toHaveBeenCalled();
    expect(rows).toEqual([
      {
        name: 'GeometryCanvas.layer',
        calls: 0,
        samples: 2,
        totalMs: 5,
        avgMs: 2.5,
        maxMs: 3,
        minMs: 2,
        p95Ms: 3,
        lastMs: 3,
        samplesMs: [2, 3],
      },
      {
        name: 'GeometryCanvas.small',
        calls: 0,
        samples: 1,
        totalMs: 1,
        avgMs: 1,
        maxMs: 1,
        minMs: 1,
        p95Ms: 1,
        lastMs: 1,
        samplesMs: [1],
      },
    ]);
  });
});
