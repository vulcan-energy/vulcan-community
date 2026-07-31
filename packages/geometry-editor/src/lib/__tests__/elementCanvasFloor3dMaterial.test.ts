// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  floorDimmedMeshColor,
  floorDimmingOverlayScale,
  meshRenderOrderForFloor,
  meshStandardFloorDimmingProps,
  meshStandardFloorDimmingPropsWithBaseOpacity,
} from '../elementCanvasFloor3dMaterial';

describe('elementCanvasFloor3dMaterial', () => {
  it('meshStandardFloorDimmingProps keeps 3D shell meshes opaque', () => {
    expect(meshStandardFloorDimmingProps(true)).toEqual({
      opacity: 1,
      transparent: false,
      depthWrite: true,
      wireframe: false,
    });
    expect(meshStandardFloorDimmingProps(false)).toEqual({
      opacity: 1,
      transparent: false,
      depthWrite: true,
      wireframe: false,
    });
    expect(meshStandardFloorDimmingProps(false, true)).toEqual({
      opacity: 0.38,
      transparent: true,
      depthWrite: false,
      wireframe: true,
    });
  });

  it('floorDimmedMeshColor mutes off-floor colors without changing current floor colors', () => {
    expect(floorDimmedMeshColor('#c6d2dc', true)).toBe('#c6d2dc');
    expect(floorDimmedMeshColor('#c6d2dc', false)).not.toBe('#c6d2dc');
  });

  it('meshStandardFloorDimmingPropsWithBaseOpacity multiplies decal opacity', () => {
    expect(meshStandardFloorDimmingPropsWithBaseOpacity(true, 0.5)).toEqual({
      opacity: 0.5,
      transparent: true,
      depthWrite: true,
      wireframe: false,
    });
    expect(meshStandardFloorDimmingPropsWithBaseOpacity(false, 0.5)).toEqual({
      opacity: 0.1,
      transparent: true,
      depthWrite: true,
      wireframe: false,
    });
    expect(meshStandardFloorDimmingPropsWithBaseOpacity(false, 0.5, true)).toEqual({
      opacity: 0.38,
      transparent: true,
      depthWrite: false,
      wireframe: true,
    });
  });

  it('meshRenderOrderForFloor draws active floor and openings above dimmed shell', () => {
    expect(meshRenderOrderForFloor(false, false)).toBe(0);
    expect(meshRenderOrderForFloor(false, true)).toBe(2);
    expect(meshRenderOrderForFloor(true, false)).toBe(10);
    expect(meshRenderOrderForFloor(true, true)).toBe(12);
  });

  it('floorDimmingOverlayScale scales ventilation overlays with mesh', () => {
    expect(floorDimmingOverlayScale(true)).toBe(1);
    expect(floorDimmingOverlayScale(false)).toBe(0.2);
  });
});
