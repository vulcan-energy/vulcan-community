// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'vitest';

import {
  hasGeometryCanvasModelRenderStateChanged,
  hasGeometryCanvasSelectionRenderStateChanged,
  shouldMarkGeometryCanvasModelRenderState,
} from '../geometryCanvasRenderState';

describe('hasGeometryCanvasModelRenderStateChanged', () => {
  test('does not mark unchanged geometry model slice references', () => {
    const state = {
      elementIds: ['wall-1'],
      elementsById: { 'wall-1': { id: 'wall-1' } },
      floors: [{ id: 'floor-1' }],
      spaceLabelIds: ['space-label-1'],
      spaceLabelsById: { 'space-label-1': { id: 'space-label-1' } },
      zones: [{ id: 'zone-1' }],
    };

    expect(hasGeometryCanvasModelRenderStateChanged(state, state)).toBe(false);
  });

  test('marks element coordinate commits even when ids stay stable', () => {
    const previous = {
      elementIds: ['wall-1'],
      elementsById: { 'wall-1': { id: 'wall-1', coordinates: [{ x: 0, y: 0 }] } },
      floors: [{ id: 'floor-1' }],
      spaceLabelIds: ['space-label-1'],
      spaceLabelsById: { 'space-label-1': { id: 'space-label-1' } },
      zones: [{ id: 'zone-1' }],
    };
    const next = {
      ...previous,
      elementsById: { 'wall-1': { id: 'wall-1', coordinates: [{ x: 1, y: 0 }] } },
    };

    expect(hasGeometryCanvasModelRenderStateChanged(previous, next)).toBe(true);
  });

  test('marks space-label and floor model changes', () => {
    const previous = {
      elementIds: ['wall-1'],
      elementsById: { 'wall-1': { id: 'wall-1' } },
      floors: [{ id: 'floor-1' }],
      spaceLabelIds: ['space-label-1'],
      spaceLabelsById: { 'space-label-1': { id: 'space-label-1' } },
      zones: [{ id: 'zone-1' }],
    };

    expect(hasGeometryCanvasModelRenderStateChanged(previous, {
      ...previous,
      floors: [{ id: 'floor-2' }],
    })).toBe(true);
    expect(hasGeometryCanvasModelRenderStateChanged(previous, {
      ...previous,
      spaceLabelsById: { 'space-label-1': { id: 'space-label-1', x: 2 } },
    })).toBe(true);
  });

  test('marks the first observed non-empty model render for load attribution', () => {
    const loaded = {
      elementIds: ['wall-1'],
      elementsById: { 'wall-1': { id: 'wall-1' } },
      floors: [{ id: 'floor-1' }],
      spaceLabelIds: [],
      spaceLabelsById: {},
      zones: [{ id: 'zone-1' }],
    };

    expect(shouldMarkGeometryCanvasModelRenderState({
      hasObservedModelRenderState: false,
      next: loaded,
      previous: loaded,
    })).toBe(true);
    expect(shouldMarkGeometryCanvasModelRenderState({
      hasObservedModelRenderState: true,
      next: loaded,
      previous: loaded,
    })).toBe(false);
  });

  test('does not mark the first observed empty model render', () => {
    const empty = {
      elementIds: [],
      elementsById: {},
      floors: [],
      spaceLabelIds: [],
      spaceLabelsById: {},
      zones: [],
    };

    expect(shouldMarkGeometryCanvasModelRenderState({
      hasObservedModelRenderState: false,
      next: empty,
      previous: empty,
    })).toBe(false);
  });
});

describe('hasGeometryCanvasSelectionRenderStateChanged', () => {
  test('does not mark unchanged selection state references', () => {
    const state = {
      selectedElementIds: ['wall-1'],
      selection: { type: 'element', id: 'wall-1' },
    };

    expect(hasGeometryCanvasSelectionRenderStateChanged(state, state)).toBe(false);
  });

  test('marks changed selected element id references', () => {
    const previous = {
      selectedElementIds: ['wall-1'],
      selection: null,
    };
    const next = {
      selectedElementIds: ['wall-1', 'wall-2'],
      selection: null,
    };

    expect(hasGeometryCanvasSelectionRenderStateChanged(previous, next)).toBe(true);
  });

  test('marks changed single selection references', () => {
    const previous = {
      selectedElementIds: ['wall-1'],
      selection: null,
    };
    const next = {
      selectedElementIds: previous.selectedElementIds,
      selection: { type: 'element', id: 'wall-1' },
    };

    expect(hasGeometryCanvasSelectionRenderStateChanged(previous, next)).toBe(true);
  });
});
