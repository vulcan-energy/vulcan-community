// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import * as THREE from 'three';
import { CANVAS_CONSTANTS } from './canvasConstants';

/**
 * Props for {@link https://threejs.org/docs/#api/en/materials/MeshStandardMaterial MeshStandardMaterial}
 * so off-floor 3D meshes stay de-emphasized without relying on stacked alpha transparency.
 *
 * Classification comes from {@link ./elementCanvasFloor.ts} via mapper `isCurrentFloor` on primitives.
 * Floors above the active storey render as wireframe-only so interior geometry stays visible.
 */
export function meshStandardFloorDimmingProps(isCurrentFloor: boolean, isAboveCurrentFloor: boolean = false): {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  wireframe: boolean;
} {
  if (isAboveCurrentFloor) {
    return {
      opacity: 0.38,
      transparent: true,
      depthWrite: false,
      wireframe: true,
    };
  }
  return {
    opacity: 1,
    transparent: false,
    depthWrite: true,
    wireframe: false,
  };
}

/**
 * Blend off-floor mesh colors toward a cool neutral so they read as context without stacked alpha artifacts.
 */
export function floorDimmedMeshColor(color: string, isCurrentFloor: boolean): string {
  if (isCurrentFloor) return color;
  const base = new THREE.Color(color);
  const muted = base.lerp(new THREE.Color('#7b8190'), 0.68);
  return `#${muted.getHexString()}`;
}

/**
 * When a primitive already has a per-element opacity (e.g. oriented-box decals), multiply with floor dimming.
 */
export function meshStandardFloorDimmingPropsWithBaseOpacity(
  isCurrentFloor: boolean,
  baseOpacity: number,
  isAboveCurrentFloor: boolean = false,
): {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  wireframe: boolean;
} {
  const clamped = Math.min(1, Math.max(0, baseOpacity));
  if (isAboveCurrentFloor) {
    return {
      opacity: Math.min(0.38, clamped),
      transparent: true,
      depthWrite: false,
      wireframe: true,
    };
  }
  const floorOpacity = isCurrentFloor
    ? CANVAS_CONSTANTS.OPACITY.CURRENT_FLOOR
    : CANVAS_CONSTANTS.OPACITY.OTHER_FLOORS;
  const opacity = floorOpacity * clamped;
  if (opacity >= 1) {
    return {
      opacity: 1,
      transparent: false,
      depthWrite: true,
      wireframe: false,
    };
  }
  return {
    opacity,
    transparent: true,
    depthWrite: true,
    wireframe: false,
  };
}

/**
 * Planar faces split into two dimming strategies: solid opaque wall faces (profiled-top walls
 * rendered as prisms) dim like ordinary walls, while everything else — dormer cheeks and
 * profiled window openings, including opening prisms, which stay translucent glass — keeps
 * multiplying in its own base opacity.
 */
export function planarFaceFloorDimmingProps(
  isSolidWallFace: boolean,
  isCurrentFloor: boolean,
  baseOpacity: number,
  isAboveCurrentFloor: boolean = false,
): {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  wireframe: boolean;
} {
  return isSolidWallFace
    ? meshStandardFloorDimmingProps(isCurrentFloor, isAboveCurrentFloor)
    : meshStandardFloorDimmingPropsWithBaseOpacity(isCurrentFloor, baseOpacity, isAboveCurrentFloor);
}

/**
 * Draw dimmed storeys first, then the active floor; openings slightly above their own shell.
 * Reduces sorting artifacts when many semi-transparent layers overlap.
 */
export function meshRenderOrderForFloor(isCurrentFloor: boolean, isOpening: boolean): number {
  const layer = isCurrentFloor ? 10 : 0;
  return layer + (isOpening ? 2 : 0);
}

/** Scale factor (0–1) for child overlays so they match parent mesh dimming. */
export function floorDimmingOverlayScale(isCurrentFloor: boolean): number {
  return isCurrentFloor ? 1 : CANVAS_CONSTANTS.OPACITY.OTHER_FLOORS;
}
