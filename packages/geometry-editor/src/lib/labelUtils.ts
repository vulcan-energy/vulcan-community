// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from 'react';
import type { Element, ElementType } from '../geometry/types';
import { getElementTypeBaseName } from './displayNames';

export const SMART_LABEL_METRICS = {
  labelHeight: 18,
  padding: 5,
  spacing: 2,
  nameFontSize: 10,
  pillFontSize: 8,
  pillHeight: 12,
  nameCharWidth: 6,
  pillCharWidth: 4.8,
  pillPadding: 4
};

export interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
}

/** Lower places first in layout and paints on top. */
export const ANNOTATION_PRIORITY = { selected: 0, warning: 1, label: 2 } as const;

/**
 * One canvas annotation (chip, badge, pill, label) painted in the single annotations group above
 * all geometry. Producers return these; obstacles such as handles and snap dots omit `render`.
 */
export interface CanvasAnnotation {
  key: string;
  /** Canvas rect at the current view; a movable item's preferred slot. */
  rect: RectBounds;
  priority: number;
  /** Layout may move it to a free slot or hide it; fixed items stay put and are avoided. */
  movable: boolean;
  /** Movable only: slots to try in order; defaults to small nudges around `rect`. */
  candidates?: RectBounds[];
  /** Movable only: the owning element's canvas bounds; a loser hides only while these are fully on canvas. */
  ownerBounds?: RectBounds;
  render?: (rect: RectBounds) => ReactNode;
}

/** Where layout put a movable annotation, as an offset from its `rect` so it survives a pan. */
export interface AnnotationPlacement {
  dx: number;
  dy: number;
  /** No free slot: drawn only while its element is hovered. Selected-priority items never hide. */
  hidden: boolean;
}

/**
 * Back to front (priority 0 paints on top; ties keep producer order), each at its placed rect.
 * A hidden loser is dropped unless `revealKey` names it (its element is hovered).
 */
export function resolveAnnotationPaint(
  items: readonly CanvasAnnotation[],
  placements: ReadonlyMap<string, AnnotationPlacement>,
  revealKey: string | null,
): Array<{ item: CanvasAnnotation; rect: RectBounds }> {
  return items
    .filter((item) => item.render)
    .sort((a, b) => b.priority - a.priority)
    .flatMap((item) => {
      const rect = placedAnnotationRect(item, placements) ?? (item.key === revealKey ? item.rect : null);
      return rect ? [{ item, rect }] : [];
    });
}

/** Where an annotation is drawn: its laid-out slot, its own rect if unplaced, null if hidden. */
export function placedAnnotationRect(
  item: CanvasAnnotation,
  placements: ReadonlyMap<string, AnnotationPlacement>,
): RectBounds | null {
  const placement = placements.get(item.key);
  if (!placement) return item.rect;
  if (placement.hidden) return null;
  return { ...item.rect, x: item.rect.x + placement.dx, y: item.rect.y + placement.dy };
}

function nudgeCandidates(rect: RectBounds): RectBounds[] {
  const dx = rect.width / 2 + 8;
  const dy = rect.height + 4;
  return [[0, 0], [0, -dy], [0, dy], [dx, 0], [-dx, 0], [dx, -dy], [-dx, -dy], [dx, dy], [-dx, dy]]
    .map(([ox, oy]) => ({ ...rect, x: rect.x + ox, y: rect.y + oy }));
}

/** One canvas's layout memory: its last pass, and each movable item's last slot (tried first next pass). */
export interface AnnotationLayoutState {
  last: { signature: string; placements: Map<string, AnnotationPlacement> } | null;
  slots: Map<string, number>;
}

export function createAnnotationLayoutState(): AnnotationLayoutState {
  return { last: null, slots: new Map() };
}

/**
 * One layout pass: fixed items (chips, badges, handles, snap dots, point icons) claim their rects,
 * then movable items, by priority, take their first in-canvas slot that overlaps nothing placed.
 * A loser hides unless it has selected priority, which keeps its preferred rect and still blocks.
 * ponytail: linear overlap scan, ~3 ms for 280 labels plus their dots on one canvas; bucket the
 * occupied rects in a grid if scenes grow well past that.
 */
export function placeCanvasAnnotations(
  items: readonly CanvasAnnotation[],
  canvasBounds: { width: number; height: number },
  slots: Map<string, number> = new Map(),
): Map<string, AnnotationPlacement> {
  const occupied = items.flatMap((item) => (item.movable ? [] : [item.rect]));
  const placements = new Map<string, AnnotationPlacement>();
  const fits = (rect: RectBounds) =>
    rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= canvasBounds.width && rect.y + rect.height <= canvasBounds.height &&
    !occupied.some((other) => rectsOverlap(rect, other));
  const movable = items.filter((item) => item.movable).sort((a, b) => a.priority - b.priority);
  for (const item of movable) {
    const candidates = item.candidates ?? nudgeCandidates(item.rect);
    const sticky = slots.get(item.key);
    let chosen = sticky !== undefined && sticky < candidates.length && fits(candidates[sticky]) ? sticky : -1;
    for (let index = 0; chosen < 0 && index < candidates.length; index += 1) {
      if (fits(candidates[index])) chosen = index;
    }
    if (chosen >= 0) {
      const slot = candidates[chosen];
      slots.set(item.key, chosen);
      occupied.push(slot);
      placements.set(item.key, { dx: slot.x - item.rect.x, dy: slot.y - item.rect.y, hidden: false });
      continue;
    }
    const revealed = item.priority === ANNOTATION_PRIORITY.selected;
    if (revealed) occupied.push(item.rect);
    // Only a loser whose element is wholly on canvas hides; one straddling the edge (or off it)
    // keeps its preferred rect, and a later pan-end pass places it.
    const owner = item.ownerBounds ?? item.rect;
    const ownerOnCanvas = owner.x >= 0 && owner.y >= 0 &&
      owner.x + owner.width <= canvasBounds.width && owner.y + owner.height <= canvasBounds.height;
    placements.set(item.key, { dx: 0, dy: 0, hidden: !revealed && ownerOnCanvas });
  }
  return placements;
}

/**
 * `placeCanvasAnnotations`, re-run only when an item's rect, priority or the canvas changes: the
 * canvas commits pan and zoom once they settle, so this runs per scene, zoom and pan end.
 * `frozen` (an active drag) reuses the previous result; placements are offsets, so they follow.
 */
export function layoutCanvasAnnotations(
  state: AnnotationLayoutState,
  items: readonly CanvasAnnotation[],
  canvasBounds: { width: number; height: number },
  frozen = false,
): Map<string, AnnotationPlacement> {
  if (frozen && state.last) return state.last.placements;
  const signature = `${canvasBounds.width}x${canvasBounds.height}|` + items
    .map(({ key, rect, priority, movable }) =>
      `${key}:${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}:${priority}${movable ? 'm' : ''}`)
    .join('|');
  if (state.last?.signature !== signature) {
    // Keep slot memory only for items still in the scene, so it cannot grow without bound.
    const keys = new Set(items.map((item) => item.key));
    for (const key of state.slots.keys()) if (!keys.has(key)) state.slots.delete(key);
    state.last = { signature, placements: placeCanvasAnnotations(items, canvasBounds, state.slots) };
  }
  return state.last.placements;
}

export function calculateElementBounds(canvasCoords: Array<{x: number, y: number}>): ElementBounds {
  if (canvasCoords.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, centerX: 0, centerY: 0 };
  }

  const xs = canvasCoords.map(c => c.x);
  const ys = canvasCoords.map(c => c.y);

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
    centerX: (Math.min(...xs) + Math.max(...xs)) / 2,
    centerY: (Math.min(...ys) + Math.max(...ys)) / 2
  };
}

export function rectsOverlap(a: RectBounds, b: RectBounds): boolean {
  return !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
}

const getElementField = (element: Element, key: string): unknown =>
  (element as unknown as Record<string, unknown>)[key];

const getFiniteElementNumber = (element: Element, key: string): number | undefined => {
  const value = getElementField(element, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const calculatePolygonAreaFromCoords = (coords: Array<{ x: number; y: number }>): number => {
  if (coords.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < coords.length; i++) {
    const a = coords[i];
    const b = coords[(i + 1) % coords.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
};

function formatWetEmitterUnitCount(value: unknown): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const rounded = Number.isInteger(numeric)
    ? numeric.toString()
    : numeric.toFixed(1).replace(/\.0$/, '');
  return `${rounded} ${numeric === 1 ? 'unit' : 'units'}`;
}

export function calculateElementWidth(element: Element): number {
  const coords = element.coordinates || [];
  if (coords.length < 2) return 0;

  if (coords.length === 2) {
    // Line element - distance between points
    const [a, b] = coords;
    return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  } else {
    // Polygon element - perimeter
    let perimeter = 0;
    for (let i = 0; i < coords.length; i++) {
      const a = coords[i];
      const b = coords[(i + 1) % coords.length];
      perimeter += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    }
    return perimeter;
  }
}

export function getSmartLabelPillTexts(
  element: Element,
  options: { showLineDimensions: boolean }
): string[] {
  const pills: string[] = [];
  const pitch = getFiniteElementNumber(element, 'pitch');
  if (typeof pitch === 'number' && pitch !== 90 && pitch !== 0 && pitch !== 180) {
    pills.push(`${Math.round(pitch)}°`);
  }

  const coords = element.coordinates || [];
  const isLine = coords.length === 2;
  const isPolygon = coords.length >= 3;
  const elementWidth = calculateElementWidth(element);

  if (element.type === 'ContextShading') {
    const start = element.start_angle;
    const end = element.end_angle;
    const distance = element.distance;
    if (Number.isFinite(start) && Number.isFinite(end)) {
      pills.push(`${Math.round(start)}°-${Math.round(end)}°`);
    }
    if (Number.isFinite(distance) && distance > 0) {
      pills.push(`${Number(distance).toFixed(1)}m`);
    }
    return pills;
  }

  if (element.type === 'ThermalBridgeLinear') {
    const psi = element.linear_thermal_transmittance;
    if (Number.isFinite(psi)) {
      pills.push(`${Number(psi).toFixed(3)} W/mK`);
    }
    return pills;
  }

  if (element.type === 'ThermalBridgePoint') {
    const wk = element.heat_transfer_coeff;
    if (Number.isFinite(wk)) {
      pills.push(`${Number(wk).toFixed(3)} W/K`);
    }
    return pills;
  }

  if (element.type === 'WetEmitter') {
    const subcategory = element.subcategory;
    if (subcategory === 'radiator' || subcategory === 'fancoil') {
      const countText = formatWetEmitterUnitCount(element.unit_number);
      if (countText) pills.push(countText);
    }
  }

  if (isLine && elementWidth > 0) {
    const height = getFiniteElementNumber(element, 'height');
    const showLineDims = options.showLineDimensions && height !== undefined && height > 0;
    if (showLineDims) {
      pills.push(`${elementWidth.toFixed(1)}w`);
      pills.push(`${height.toFixed(1)}h`);
    } else {
      pills.push(`${elementWidth.toFixed(1)}m`);
    }
    return pills;
  }

  if (isPolygon) {
    const areaFromElement = getFiniteElementNumber(element, 'area');
    const area = areaFromElement !== undefined && areaFromElement > 0
      ? areaFromElement
      : calculatePolygonAreaFromCoords(coords.map(c => ({ x: c.x, y: c.y })));
    if (Number.isFinite(area) && area > 0) {
      pills.push(`${area.toFixed(1)}m²`);
    }
  }

  return pills;
}

/** The label's name: truncated unless the element is selected, else its type's display name. */
export function getSmartLabelDisplayName(element: Element, isHighlighted: boolean): string {
  if (element.isPlaceholder) return '…';
  const name = element.name?.trim() ? element.name : '';
  if (!name) return getElementTypeBaseName(element.type as ElementType);
  const maxLength = isHighlighted ? 40 : 20;
  return name.length > maxLength ? `${name.substring(0, maxLength)}…` : name;
}

/** Label width from the same character metrics renderSmartLabel draws with. */
export function getSmartLabelWidth(element: Element, isHighlighted: boolean, showLineDimensions: boolean): number {
  let width = getSmartLabelDisplayName(element, isHighlighted).length * SMART_LABEL_METRICS.nameCharWidth;
  for (const text of getSmartLabelPillTexts(element, { showLineDimensions })) {
    width += SMART_LABEL_METRICS.spacing + text.length * SMART_LABEL_METRICS.pillCharWidth + SMART_LABEL_METRICS.pillPadding * 2;
  }
  return Math.max(68, width + SMART_LABEL_METRICS.padding * 2);
}

/** Label slots around an element, preferred first: right of centre, nudges, centred, then the corners. */
export function getSmartLabelCandidates(
  element: Element,
  canvasCoords: Array<{ x: number; y: number }>,
  isHighlighted: boolean,
  showLineDimensions: boolean,
): RectBounds[] {
  const bounds = calculateElementBounds(canvasCoords);
  const height = SMART_LABEL_METRICS.labelHeight;
  const width = getSmartLabelWidth(element, isHighlighted, showLineDimensions);
  // Clears the 14px handle reserve on selected vertices, so a selected line's edge slots stay usable.
  const margin = 16;
  const x = bounds.centerX + 20;
  const y = bounds.centerY - height / 2;
  return [
    [x, y], [x + 10, y], [x - 10, y], [x, y - 10], [x, y + 10],
    [x + 15, y - 15], [x - 15, y + 15], [x + 15, y + 15], [x - 15, y - 15],
    [x + 20, y], [x - 20, y], [x, y - 20], [x, y + 20],
    [bounds.centerX - width / 2, y],
    // Corner slots hang off the vertex nearest each bounding-box corner, so a diagonal element
    // never gets a slot at an empty box corner far from its geometry.
    ...([[1, -1], [-1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) => {
      const corner = { x: sx > 0 ? bounds.maxX : bounds.minX, y: sy > 0 ? bounds.maxY : bounds.minY };
      const vertex = canvasCoords.reduce((best, point) =>
        Math.hypot(point.x - corner.x, point.y - corner.y) < Math.hypot(best.x - corner.x, best.y - corner.y) ? point : best);
      return [sx > 0 ? vertex.x + margin : vertex.x - width - margin, vertex.y + sy * margin];
    }),
  ].map(([cx, cy]) => ({ x: cx, y: cy, width, height }));
}
