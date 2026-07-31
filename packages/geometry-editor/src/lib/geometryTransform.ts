// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export const PIXELS_PER_METER = 50;

export interface ModelPoint2D {
  x: number;
  y: number;
}

export interface CanvasTransform {
  scale: number;
  panOffset: { x: number; y: number };
  canvasCenter: { x: number; y: number };
}

// Model (x,y) -> Canvas (x,y) for 2D editor.
// Keep plan handedness aligned with the Three.js ground plane: +Y (north) renders upward.
export function modelToCanvas2D(worldCoord: ModelPoint2D, transform: CanvasTransform): ModelPoint2D {
  const { scale, panOffset, canvasCenter } = transform;
  return {
    x: (worldCoord.x * PIXELS_PER_METER * scale) + canvasCenter.x + panOffset.x,
    y: canvasCenter.y + panOffset.y - (worldCoord.y * PIXELS_PER_METER * scale),
  };
}

// Canvas (x,y) -> Model (x,y) for 2D editor interactions.
export function canvasToModel2D(canvasCoord: ModelPoint2D, transform: CanvasTransform): ModelPoint2D {
  const { scale, panOffset, canvasCenter } = transform;
  return {
    x: (canvasCoord.x - canvasCenter.x - panOffset.x) / (PIXELS_PER_METER * scale),
    y: (canvasCenter.y + panOffset.y - canvasCoord.y) / (PIXELS_PER_METER * scale),
  };
}

// Model ground plane (x,y) -> Three ground plane (x,z).
// Mirror Y onto world Z so 3D matches the 2D canvas handedness.
export function modelXYToThreeXZ(point: [number, number]): [number, number] {
  return [point[0], -point[1]];
}

export function threeXZToModelXY(point: [number, number]): [number, number] {
  return [point[0], -point[1]];
}

// Shape-space coordinates for THREE.ExtrudeGeometry before rotateX(-PI/2).
// With that rotation, world Z becomes -shapeY, so using model Y here keeps
// world mapping consistent with modelXYToThreeXZ.
export function modelXYToExtrudeShapeXY(point: [number, number]): [number, number] {
  return [point[0], point[1]];
}

// Yaw (rotation.y in radians) so a BoxGeometry with length on local +X aligns with the
// segment in Three.js world XZ. Model (x,y) maps to ground (x,-y) as (x,z); Three.js Ry(θ)
// sends local +X to (cos θ, 0, -sin θ), which must equal normalize(Δx, -Δy). Hence
// θ = atan2(Δy, Δx) — **not** atan2(Δz, Δx) after mirroring (that negates Δy and skews diagonals).
export function modelSegmentToThreeYaw(start: [number, number], end: [number, number]): number {
  return Math.atan2(end[1] - start[1], end[0] - start[0]);
}
