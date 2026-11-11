// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildGeometry3DPrimitives } from '../geometry3dMapper';
import { buildSlopedPolygonBufferGeometry } from '../geometry3dSloped';
import { deriveWallEdgeFromRoofs } from '../wallEdgeFromRoofs';
import type { BuildingElementOpaque, Element } from '../../geometry/types';

// Front roof 8 m × 3 m in plan at 45°; a box dormer 3 m × 2 m in plan stands on it to the ridge.
const roof = {
  id: 'roof', name: 'Front roof', type: 'BuildingElementOpaque', zoneId: 'z', pitch: 45, base_height: 5,
  coordinates: [[0, 0], [8, 0], [8, 3], [0, 3]].map(([x, y]) => ({ x, y, z: 0 })),
} as BuildingElementOpaque;

const wall = (name: string, a: [number, number], b: [number, number]): BuildingElementOpaque => {
  const plain = {
    id: name, name, type: 'BuildingElementOpaque', zoneId: 'z', pitch: 90, base_height: 5, height: 4,
    coordinates: [{ x: a[0], y: a[1], z: 0 }, { x: b[0], y: b[1], z: 0 }],
  } as BuildingElementOpaque;
  const top = [{ t: 0, h: 4 }, { t: 1, h: 4 }];
  const bottom = deriveWallEdgeFromRoofs(plain, [roof], [], 0, 'bottom', top)!.profile;
  return { ...plain, extra_json: { geometry_face: { kind: 'profiled-line-face', top_profile: top, bottom_profile: bottom, bottom_mode: 'roof' } } };
};

describe('3D roof with a cut-out', () => {
  it('draws no roof surface inside the part covered by walls standing on it', () => {
    const elements: Element[] = [roof, wall('Dormer front', [2, 1], [5, 1]), wall('Cheek L', [2, 3], [2, 1]), wall('Cheek R', [5, 1], [5, 3])];
    const elementsById = Object.fromEntries(elements.map((e) => [e.id, e]));
    const primitive = buildGeometry3DPrimitives({ elementsById, elementIds: ['roof'], floors: [], globalOrientationOffset: 0 })
      .find((p) => p.kind === 'polygon-sloped')!;
    if (primitive.kind !== 'polygon-sloped') throw new Error('roof is not sloped');
    const geometry = buildSlopedPolygonBufferGeometry(
      primitive.points, primitive.hingeAnchorXY, primitive.inwardNormal2D, primitive.baseElevationM,
      primitive.pitchDeg, primitive.thicknessM, primitive.surface,
    );
    // Top and bottom faces: triangles parallel to the roof plane.
    const pos = geometry.getAttribute('position');
    const index = geometry.getIndex()!;
    const up = new THREE.Vector3(0, 1, 1).normalize();
    let faces = 0;
    for (let k = 0; k < index.count; k += 3) {
      const [a, b, c] = [0, 1, 2].map((m) => new THREE.Vector3().fromBufferAttribute(pos, index.getX(k + m)));
      const cross = new THREE.Vector3().crossVectors(b!.clone().sub(a!), c!.clone().sub(a!));
      if (Math.abs(cross.clone().normalize().dot(up)) > 0.999) faces += cross.length() / 2;
    }
    expect(faces / 2).toBeCloseTo((24 - 6) / Math.cos(Math.PI / 4), 3);
  });
});
