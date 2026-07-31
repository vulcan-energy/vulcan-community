// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { SpaceLabel } from '../../../geometry/types';
import {
  pointInPolygon,
  polygonCentroid2d,
  remapZoneSpaceLabelsFromInference,
} from '../remapInferredSpaceLabels';
import type { InferredSpaceFootprint } from '../types';

const ZONE = 'z1';
let idSeq = 0;
const nid = () => `id-${++idSeq}`;

describe('remapZoneSpaceLabelsFromInference', () => {
  it('creates one label per footprint on empty prev (multi-storey)', () => {
    idSeq = 0;
    const fp: InferredSpaceFootprint[] = [
      {
        storeyIndex: 0,
        wallZIndex: 0,
        ring: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 2 },
        ],
        areaM2: 4,
      },
      {
        storeyIndex: 1,
        wallZIndex: 1,
        ring: [
          { x: 10, y: 10 },
          { x: 12, y: 10 },
          { x: 12, y: 12 },
          { x: 10, y: 12 },
        ],
        areaM2: 4,
      },
    ];
    const { labels, roomTypesCleared } = remapZoneSpaceLabelsFromInference([], fp, ZONE, nid);
    expect(labels.length).toBe(2);
    expect(roomTypesCleared).toBe(0);
    expect(labels[0].storey).toBe(0);
    expect(labels[1].storey).toBe(1);
    expect(labels[0].coordinates.every((c) => c.z === 0)).toBe(true);
    expect(labels[1].coordinates.every((c) => c.z === 1)).toBe(true);
  });

  it('strong match preserves room_type when footprint moves slightly', () => {
    idSeq = 0;
    const prev: SpaceLabel[] = [
      {
        id: 'keep',
        name: 'Bedroom 1',
        zoneId: ZONE,
        storey: 0,
        room_type: 'bedroom',
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 },
          { x: 2, y: 2, z: 0 },
          { x: 0, y: 2, z: 0 },
        ],
        _nameAutoSync: true,
      },
    ];
    const fp: InferredSpaceFootprint[] = [
      {
        storeyIndex: 0,
        wallZIndex: 0,
        ring: [
          { x: 0.05, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 2 },
        ],
        areaM2: 4,
      },
    ];
    const { labels, roomTypesCleared } = remapZoneSpaceLabelsFromInference(prev, fp, ZONE, nid);
    expect(labels.length).toBe(1);
    expect(labels[0].id).toBe('keep');
    expect(labels[0].room_type).toBe('bedroom');
    expect(roomTypesCleared).toBe(0);
  });

  it('weak match clears room_type', () => {
    idSeq = 0;
    const prev: SpaceLabel[] = [
      {
        id: 'w',
        name: 'Kitchen 1',
        zoneId: ZONE,
        storey: 0,
        room_type: 'kitchen',
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 },
          { x: 2, y: 2, z: 0 },
          { x: 0, y: 2, z: 0 },
        ],
        _nameAutoSync: true,
      },
    ];
    const fp: InferredSpaceFootprint[] = [
      {
        storeyIndex: 0,
        wallZIndex: 0,
        ring: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 2 },
          { x: 0, y: 2 },
        ],
        areaM2: 20,
      },
    ];
    const { labels, roomTypesCleared } = remapZoneSpaceLabelsFromInference(prev, fp, ZONE, nid);
    expect(labels.length).toBe(1);
    expect(labels[0].id).toBe('w');
    expect(labels[0].room_type).toBe('');
    expect(roomTypesCleared).toBe(1);
  });
});

describe('pointInPolygon / polygonCentroid2d', () => {
  it('centroid inside unit square', () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const c = polygonCentroid2d(ring);
    expect(pointInPolygon(c, ring)).toBe(true);
  });
});
