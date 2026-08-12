// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  floorDimmedMeshColor,
  floorDimmingOverlayScale,
  meshRenderOrderForFloor,
  meshStandardFloorDimmingProps,
  meshStandardFloorDimmingPropsWithBaseOpacity,
  planarFaceFloorDimmingProps,
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

// `planarFaceFloorDimmingProps` is the material-selection branch introduced for the
// profiled-wall-3d fix: planar faces with a solid `thicknessM` (opaque profiled-top walls
// rendered as prisms) must dim like ordinary walls, while faces without one (dormer cheeks,
// profiled window openings) keep multiplying in their own base opacity.
describe('planarFaceFloorDimmingProps', () => {
  it('with thicknessM: off-floor stays fully opaque (wall-style dimming), ignoring baseOpacity', () => {
    expect(planarFaceFloorDimmingProps(true, false, 0.28)).toEqual({
      opacity: 1,
      transparent: false,
      depthWrite: true,
      wireframe: false,
    });
    expect(planarFaceFloorDimmingProps(true, true, 0.28)).toEqual({
      opacity: 1,
      transparent: false,
      depthWrite: true,
      wireframe: false,
    });
  });

  it('with thicknessM: above the active floor renders wireframe at the standard 0.38 opacity', () => {
    expect(planarFaceFloorDimmingProps(true, false, 0.28, true)).toEqual({
      opacity: 0.38,
      transparent: true,
      depthWrite: false,
      wireframe: true,
    });
  });

  it('without thicknessM: off-floor multiplies in baseOpacity (flat-sheet path unchanged)', () => {
    expect(planarFaceFloorDimmingProps(false, false, 0.72)).toEqual({
      opacity: 0.144,
      transparent: true,
      depthWrite: true,
      wireframe: false,
    });
    expect(planarFaceFloorDimmingProps(false, true, 0.72)).toEqual({
      opacity: 0.72,
      transparent: true,
      depthWrite: true,
      wireframe: false,
    });
  });

  it('without thicknessM: above the active floor still caps at 0.38 wireframe', () => {
    expect(planarFaceFloorDimmingProps(false, false, 0.72, true)).toEqual({
      opacity: 0.38,
      transparent: true,
      depthWrite: false,
      wireframe: true,
    });
  });
});
