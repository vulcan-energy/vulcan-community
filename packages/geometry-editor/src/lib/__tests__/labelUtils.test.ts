// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import type { Element } from '../../geometry/types';
import {
  ANNOTATION_PRIORITY,
  layoutCanvasAnnotations,
  placeCanvasAnnotations,
  resolveAnnotationPaint,
  type CanvasAnnotation,
  calculateMemoizedLabelPositions,
  getSmartLabelPillTexts,
  rectsOverlap,
  transformCachedLabelPosition,
} from '../labelUtils';

describe('getSmartLabelPillTexts', () => {
  it('shows radiator unit count alongside line length', () => {
    const pills = getSmartLabelPillTexts(
      {
        id: 'rad-1',
        name: 'Radiator',
        type: 'WetEmitter',
        subcategory: 'radiator',
        unit_number: 3,
        parent_element: null,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 },
        ],
      } as any,
      { showLineDimensions: false },
    );

    expect(pills).toEqual(['3 units', '2.0m']);
  });

  it('does not show a unit-count pill for underfloor heating', () => {
    const pills = getSmartLabelPillTexts(
      {
        id: 'ufh-1',
        name: 'UFH',
        type: 'WetEmitter',
        subcategory: 'ufh',
        unit_number: 3,
        area: 12,
        parent_element: null,
        coordinates: [
          { x: 0, y: 0, z: 0 },
          { x: 3, y: 0, z: 0 },
          { x: 3, y: 4, z: 0 },
        ],
      } as any,
      { showLineDimensions: false },
    );

    expect(pills).toEqual(['12.0m²']);
  });

  it('recalculates cached label bounds when derived line dimension text changes', () => {
    const projectIdentity = (
      coord: { x: number; y: number },
    ): { x: number; y: number } => ({ x: coord.x, y: coord.y });
    const baseElement = {
      id: 'label-cache-line-dimensions',
      name: 'Wall',
      type: 'BuildingElementOpaque',
      parent_element: null,
      coordinates: [
        { x: 0, y: 100, z: 0 },
        { x: 10, y: 100, z: 0 },
      ],
    } as any;

    const smallHeightPositions = calculateMemoizedLabelPositions(
      [{ ...baseElement, height: 2 }],
      { width: 800, height: 600 },
      true,
      projectIdentity,
      1,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    );
    const smallWidth = smallHeightPositions.get(baseElement.id)?.rect.width ?? 0;

    const largeHeightPositions = calculateMemoizedLabelPositions(
      [{ ...baseElement, height: 12345 }],
      { width: 800, height: 600 },
      true,
      projectIdentity,
      1,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    );

    expect(largeHeightPositions.get(baseElement.id)?.rect.width ?? 0).toBeGreaterThan(smallWidth);
  });

  it('recalculates label placement when coordinates move labels into collision', () => {
    const projectIdentity = (
      coord: { x: number; y: number },
    ): { x: number; y: number } => ({ x: coord.x, y: coord.y });
    const elementA = {
      id: 'label-cache-move-a',
      name: 'Wall A',
      type: 'BuildingElementOpaque',
      parent_element: null,
      coordinates: [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
    } as any;
    const elementBFar = {
      id: 'label-cache-move-b',
      name: 'Wall B',
      type: 'BuildingElementOpaque',
      parent_element: null,
      coordinates: [
        { x: 200, y: 100, z: 0 },
        { x: 210, y: 100, z: 0 },
      ],
    } as any;

    calculateMemoizedLabelPositions(
      [elementA, elementBFar],
      { width: 800, height: 600 },
      false,
      projectIdentity,
      1,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    );

    const elementBNear = {
      ...elementBFar,
      coordinates: [
        { x: 0, y: 100, z: 0 },
        { x: 10, y: 100, z: 0 },
      ],
    };
    const movedPositions = calculateMemoizedLabelPositions(
      [elementA, elementBNear],
      { width: 800, height: 600 },
      false,
      projectIdentity,
      1,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    );
    const labelA = movedPositions.get(elementA.id);
    const labelB = movedPositions.get(elementBNear.id);
    expect(labelA).toBeTruthy();
    expect(labelB).toBeTruthy();

    const rectA = transformCachedLabelPosition(labelA!, elementA, projectIdentity, 1, { x: 0, y: 0 }, { x: 0, y: 0 });
    const rectB = transformCachedLabelPosition(labelB!, elementBNear, projectIdentity, 1, { x: 0, y: 0 }, { x: 0, y: 0 });

    expect(rectsOverlap(rectA, rectB)).toBe(false);
  });

  it('places priority labels first and marks unplaceable ones as colliding instead of stacking them', () => {
    const projectIdentity = (coord: { x: number; y: number }) => ({ x: coord.x, y: coord.y });
    const stacked: Element[] = Array.from({ length: 30 }, (_, index): Element => ({
      id: `stack-${String(index).padStart(2, '0')}`,
      name: 'Light',
      type: 'Lighting',
      parent_element: null,
      coordinates: [{ x: 200, y: 200, z: 0 }],
    }) as Element);
    const priorityId = 'stack-29';

    const positions = calculateMemoizedLabelPositions(
      stacked,
      { width: 800, height: 600 },
      false,
      projectIdentity,
      1,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      [],
      new Set([priorityId]),
    );

    expect(positions.get(priorityId)?.rect.collides).toBeUndefined();
    const placed = stacked.map((e) => positions.get(e.id)!.rect).filter((rect) => !rect.collides);
    expect(placed.length).toBeLessThan(stacked.length);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(rectsOverlap(placed[i], placed[j])).toBe(false);
      }
    }
  });

  it('keeps the visible fallback for an element that is off-canvas at layout time', () => {
    const projectIdentity = (coord: { x: number; y: number }) => ({ x: coord.x, y: coord.y });
    const offCanvas = {
      id: 'off-canvas-light',
      name: 'Light',
      type: 'Lighting',
      parent_element: null,
      coordinates: [{ x: 2000, y: 200, z: 0 }],
    } as Element;

    const positions = calculateMemoizedLabelPositions(
      [offCanvas],
      { width: 800, height: 600 },
      false,
      projectIdentity,
      1,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    );

    expect(positions.get(offCanvas.id)?.rect.collides).toBeUndefined();
  });
});

describe('canvas annotation layout', () => {
  const canvas = { width: 400, height: 300 };
  const rect = (x: number, y: number, width = 40, height = 20) => ({ x, y, width, height });
  const fixedChip = (x: number, y: number): CanvasAnnotation =>
    ({ key: `chip-${x}-${y}`, rect: rect(x, y), priority: ANNOTATION_PRIORITY.warning, movable: false, render: () => null });
  const label = (key: string, slots: ReturnType<typeof rect>[], priority: number = ANNOTATION_PRIORITY.label): CanvasAnnotation =>
    ({ key, rect: slots[0], candidates: slots, priority, movable: true, render: () => null });

  it('gives the contested slot to the higher priority item, whatever the input order', () => {
    const slots = [rect(100, 100), rect(100, 140)];
    const placements = placeCanvasAnnotations(
      [label('order-label', slots), label('order-selected', slots, ANNOTATION_PRIORITY.selected)],
      canvas,
    );
    expect(placements.get('order-selected')).toEqual({ dx: 0, dy: 0, hidden: false });
    expect(placements.get('order-label')).toEqual({ dx: 0, dy: 40, hidden: false });
  });

  it('hides a loser with no free slot, except a selected one, and reveals it on hover', () => {
    const items = [
      fixedChip(100, 100),
      label('loser-label', [rect(110, 105)]),
      label('loser-selected', [rect(120, 105)], ANNOTATION_PRIORITY.selected),
    ];
    const placements = placeCanvasAnnotations(items, canvas);
    expect(placements.get('loser-label')?.hidden).toBe(true);
    expect(placements.get('loser-selected')).toEqual({ dx: 0, dy: 0, hidden: false });
    expect(resolveAnnotationPaint(items, placements, null).map(({ item }) => item.key)).not.toContain('loser-label');
    expect(resolveAnnotationPaint(items, placements, 'loser-label').map(({ item }) => item.key)).toContain('loser-label');
  });

  it('places an item that a pan brings on canvas, and reuses the last pass while frozen', () => {
    const at = (panX: number) => [fixedChip(100 + panX, 100), label('pan-label', [rect(110 + panX, 105), rect(110 + panX, 140)])];
    // Off canvas: every slot fails the bounds check, so the item is left visible and unplaced.
    expect(layoutCanvasAnnotations(at(1000), canvas).get('pan-label')).toEqual({ dx: 0, dy: 0, hidden: false });
    // Settled pan: a fresh pass moves it clear of the chip.
    expect(layoutCanvasAnnotations(at(0), canvas).get('pan-label')).toEqual({ dx: 0, dy: 35, hidden: false });
    // Mid-drag the previous pass is reused.
    expect(layoutCanvasAnnotations(at(1000), canvas, true).get('pan-label')).toEqual({ dx: 0, dy: 35, hidden: false });
  });

  it('draws a moved click-to-edit pill (and the hit rect it renders) at its placed slot', () => {
    const drawnAt: Array<{ x: number; y: number }> = [];
    const pill: CanvasAnnotation = {
      key: 'distance-pill',
      rect: rect(100, 100),
      priority: ANNOTATION_PRIORITY.selected,
      movable: true,
      render: (placed) => {
        drawnAt.push({ x: placed.x, y: placed.y });
        return null;
      },
    };
    const items = [fixedChip(100, 100), pill];
    for (const { item, rect: placed } of resolveAnnotationPaint(items, placeCanvasAnnotations(items, canvas), null)) {
      item.render?.(placed);
    }
    // The default nudges try straight up first: clear of the chip, still on canvas.
    expect(drawnAt).toEqual([{ x: 100, y: 76 }]);
  });
});
