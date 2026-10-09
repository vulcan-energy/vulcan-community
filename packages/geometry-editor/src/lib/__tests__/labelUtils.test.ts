// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_PRIORITY,
  layoutCanvasAnnotations,
  placeCanvasAnnotations,
  resolveAnnotationPaint,
  type CanvasAnnotation,
  getSmartLabelCandidates,
  getSmartLabelPillTexts,
  getSmartLabelWidth,
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

  it('widens the label when the derived line dimension text grows', () => {
    const wall = {
      id: 'label-width-line-dimensions',
      name: 'Wall',
      type: 'BuildingElementOpaque',
      parent_element: null,
      coordinates: [{ x: 0, y: 100, z: 0 }, { x: 10, y: 100, z: 0 }],
    } as any;

    expect(getSmartLabelWidth({ ...wall, height: 12345 }, false, true))
      .toBeGreaterThan(getSmartLabelWidth({ ...wall, height: 2 }, false, true));
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

describe('getSmartLabelCandidates', () => {
  it('keeps every slot next to a diagonal element, never at an empty bounding-box corner', () => {
    const coords = [{ x: 0, y: 400 }, { x: 400, y: 0 }];
    const duct = { id: 'diag', name: 'Diagonal', type: 'MechanicalVentilationDuctwork', parent_element: null,
      coordinates: coords.map((c) => ({ ...c, z: 0 })) } as any;
    // Nearest distance from a slot rect to the element's vertices or centre.
    const anchors = [...coords, { x: 200, y: 200 }];
    const gap = (r: { x: number; y: number; width: number; height: number }) => Math.min(...anchors.map((p) =>
      Math.hypot(Math.max(r.x - p.x, 0, p.x - r.x - r.width), Math.max(r.y - p.y, 0, p.y - r.y - r.height))));

    for (const slot of getSmartLabelCandidates(duct, coords, false, false)) {
      expect(gap(slot)).toBeLessThanOrEqual(40);
    }
  });
});
