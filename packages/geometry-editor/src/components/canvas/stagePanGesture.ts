// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

export type StagePanGestureInput = {
  drawMode: string;
  mouseButton: number;
  panModifierHeld: boolean;
  pointerAvailable: boolean;
  viewMode: '2d' | '3d';
};

export function shouldStartStagePanGesture(input: StagePanGestureInput): boolean {
  if (!input.pointerAvailable || input.viewMode !== '2d') return false;
  if (input.mouseButton === 1) return true;
  return input.drawMode !== 'none' && input.panModifierHeld;
}
