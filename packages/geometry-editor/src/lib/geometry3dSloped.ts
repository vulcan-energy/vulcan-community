// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import * as THREE from 'three';
import { ShapeUtils } from 'three';

/**
 * Sloped polygon convention (matches 2D draw preview): coords[0]→coords[1] is the low eaves edge;
 * the surface pitches upward into the polygon interior. Inward normal is chosen so the polygon
 * centroid lies on the inward side of the infinite line through that edge.
 */
export function computeSlopedPolygonInwardNormal2D(
  points: Array<[number, number]>,
): [number, number] | null {
  if (points.length < 3) return null;
  const ax = points[0][0];
  const ay = points[0][1];
  const bx = points[1][0];
  const by = points[1][1];
  const ex = bx - ax;
  const ey = by - ay;
  const len = Math.hypot(ex, ey);
  if (len < 1e-9) return null;
  // Unit perpendicular (CCW from plan: edge direction → left normal)
  let nx = -ey / len;
  let ny = ex / len;
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p[0];
    cy += p[1];
  }
  cx /= points.length;
  cy /= points.length;
  const midx = (ax + bx) / 2;
  const midy = (ay + by) / 2;
  const vx = cx - midx;
  const vy = cy - midy;
  if (vx * nx + vy * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return [nx, ny];
}

export function elevationAtSlopedVertexM(
  vertex: [number, number],
  eavesAnchor: [number, number],
  inwardNormal2D: [number, number],
  baseElevationM: number,
  pitchDeg: number,
): number {
  const tanP = Math.tan((pitchDeg * Math.PI) / 180);
  const d =
    (vertex[0] - eavesAnchor[0]) * inwardNormal2D[0] +
    (vertex[1] - eavesAnchor[1]) * inwardNormal2D[1];
  const dClamped = Math.max(0, d);
  return baseElevationM + dClamped * tanP;
}

/**
 * Closed prism from a pair of matching rings. `capTriangles` index into the ring (as produced by
 * THREE.ShapeUtils.triangulateShape over the ring's 2D contour). Earcut emits cap triangles in
 * the contour's overall CCW orientation, while the side quads follow raw ring order — so when the
 * 2D contour is clockwise (ShapeUtils.area(contour) < 0) the side winding must be reversed to
 * keep every face outward; otherwise concave rings render with caps and sides disagreeing and
 * computeVertexNormals() averages contradictory normals at every vertex.
 */
export function buildClosedPrismGeometry(
  top: THREE.Vector3[],
  bottom: THREE.Vector3[],
  capTriangles: number[][],
  reverseSideWinding: boolean,
): THREE.BufferGeometry {
  const n = top.length;
  const positions: number[] = [];
  const indices: number[] = [];

  const pushVert = (v: THREE.Vector3) => {
    positions.push(v.x, v.y, v.z);
    return positions.length / 3 - 1;
  };

  const topIdx: number[] = top.map((v) => pushVert(v));
  const botIdx: number[] = bottom.map((v) => pushVert(v));

  for (const t of capTriangles) {
    const [i, j, k] = t;
    indices.push(topIdx[i], topIdx[j], topIdx[k]);
  }
  for (const t of capTriangles) {
    const [i, j, k] = t;
    indices.push(botIdx[i], botIdx[k], botIdx[j]);
  }

  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const t0 = topIdx[i];
    const t1 = topIdx[j];
    const b0 = botIdx[i];
    const b1 = botIdx[j];
    if (reverseSideWinding) {
      indices.push(t0, t1, b0);
      indices.push(t1, b1, b0);
    } else {
      indices.push(t0, b0, t1);
      indices.push(t1, b0, b1);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/**
 * Thick sloped slab: top surface pitched, bottom offset along interior plane normal by thicknessM.
 */
export function buildSlopedPolygonBufferGeometry(
  points: Array<[number, number]>,
  eavesAnchor: [number, number],
  inwardNormal2D: [number, number],
  baseElevationM: number,
  pitchDeg: number,
  thicknessM: number,
): THREE.BufferGeometry {
  const top: THREE.Vector3[] = points.map(([x, y]) => {
    const h = elevationAtSlopedVertexM([x, y], eavesAnchor, inwardNormal2D, baseElevationM, pitchDeg);
    return new THREE.Vector3(x, h, -y);
  });

  const contour = points.map((p) => new THREE.Vector2(p[0], p[1]));
  const tri = ShapeUtils.triangulateShape(contour, []) as number[][];
  if (tri.length === 0) {
    return new THREE.BufferGeometry();
  }

  const n3 = new THREE.Vector3(0, 1, 0);
  for (const t of tri) {
    const a = top[t[0]];
    const b = top[t[1]];
    const c = top[t[2]];
    const cr = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    if (cr.lengthSq() > 1e-12) {
      cr.normalize();
      n3.copy(cr);
      break;
    }
  }
  if (n3.y < 0) {
    n3.multiplyScalar(-1);
  }

  const bottom = top.map((v) => v.clone().addScaledVector(n3, -Math.max(thicknessM, 0.02)));

  return buildClosedPrismGeometry(top, bottom, tri, ShapeUtils.area(contour) < 0);
}
