// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  canvasFloorToFhsStorey,
  fhsFloorCodeForCanvasFloor,
  fhsFloorDescriptorForCanvasFloor,
  fhsFloorLabelForCanvasFloor,
  fhsStoreyToCanvasFloor,
} from '../storeySemantics';

describe('storeySemantics', () => {
  it('keeps canvas floor indexes zero-based while exposing FHS storeys as one-based', () => {
    expect(canvasFloorToFhsStorey(0)).toBe(1);
    expect(canvasFloorToFhsStorey(1)).toBe(2);
    expect(canvasFloorToFhsStorey(-1)).toBe(0);

    expect(fhsStoreyToCanvasFloor(1)).toBe(0);
    expect(fhsStoreyToCanvasFloor(2)).toBe(1);
    expect(fhsStoreyToCanvasFloor(0)).toBe(-1);
  });

  it('formats floor labels using FHS storey numbers', () => {
    expect(fhsFloorCodeForCanvasFloor(0)).toBe('F1');
    expect(fhsFloorCodeForCanvasFloor(1)).toBe('F2');
    expect(fhsFloorCodeForCanvasFloor(-1)).toBe('F0');
    expect(fhsFloorCodeForCanvasFloor(-2)).toBe('F-1');

    expect(fhsFloorDescriptorForCanvasFloor(0)).toBe('Ground');
    expect(fhsFloorDescriptorForCanvasFloor(1)).toBeUndefined();
    expect(fhsFloorDescriptorForCanvasFloor(-1)).toBe('Basement 1');
    expect(fhsFloorDescriptorForCanvasFloor(-2)).toBe('Basement 2');

    expect(fhsFloorLabelForCanvasFloor(0)).toBe('F1: Ground');
    expect(fhsFloorLabelForCanvasFloor(1)).toBe('F2');
    expect(fhsFloorLabelForCanvasFloor(-1)).toBe('F0: Basement 1');
    expect(fhsFloorLabelForCanvasFloor(-2)).toBe('F-1: Basement 2');
  });
});
