// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';

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

// Label positioning and rendering utilities

export interface LabelPosition {
  x: number;
  y: number;
  anchor: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LabelRect extends LabelPosition, RectBounds {}

export interface ElementBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
}

// In-memory stickiness cache: stores a placement choice per element
// We cache the candidate index and a small offset (dx, dy) rather than absolute canvas coords
// so positions naturally recompute from current element bounds on pan/zoom.
const labelChoiceCache: Map<string, { idx: number; dx: number; dy: number; anchor: LabelPosition['anchor'] }>
  = new Map();

// Smart memoization cache for label positions
interface LabelPositionCache {
  positions: Map<string, { rect: LabelRect; elementCenter: { x: number, y: number } }>;
  lastElementHash: string;
  lastCanvasBounds: { width: number, height: number };
}

const labelPositionCache: LabelPositionCache = {
  positions: new Map(),
  lastElementHash: '',
  lastCanvasBounds: { width: 0, height: 0 }
};

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

export function getSmartLabelLayoutSignature(
  element: Element,
  options: { showLineDimensions: boolean },
): string {
  const coords = element.coordinates || [];
  return JSON.stringify([
    element.id,
    coords.map((coord) => [
      Number(coord.x),
      Number(coord.y),
      Number(coord.z),
    ]),
    element.name || '',
    element.type || '',
    !!element.isPlaceholder,
    getSmartLabelPillTexts(element, options),
  ]);
}

export function calculateSmartLabelPosition(
  element: Element,
  canvasCoords: Array<{x: number, y: number}>,
  existingLabels: LabelRect[],
  canvasBounds: {width: number, height: number},
  showLineDimensions: boolean,
  avoidRects?: Array<{ x: number, y: number, width: number, height: number }>
): LabelRect {
  const bounds = calculateElementBounds(canvasCoords);
  const labelHeight = SMART_LABEL_METRICS.labelHeight;
  const margin = 8; // Smaller margin for tighter clustering

  // Estimate label width using same logic as renderer
  const padding = SMART_LABEL_METRICS.padding;
  const spacing = SMART_LABEL_METRICS.spacing;
  const baseName = element.isPlaceholder ? '…' : (element.name && element.name.trim() ? element.name : (element.type || ''));
  const baseNameWidth = (baseName || '').length * SMART_LABEL_METRICS.nameCharWidth;
  const pillTexts = getSmartLabelPillTexts(element, { showLineDimensions });
  const pillWidth = (text: string) =>
    text.length * SMART_LABEL_METRICS.pillCharWidth + SMART_LABEL_METRICS.pillPadding * 2;

  let totalContentWidth = baseNameWidth;
  for (const text of pillTexts) {
    totalContentWidth += spacing + pillWidth(text);
  }
  const labelWidth = Math.max(
    68,
    totalContentWidth + padding * 2
  );

  // Start with position to the right of center
  const rightOfCenterX = bounds.centerX + 20; // 20px to the right of center
  const centerY = bounds.centerY - labelHeight / 2;

  // Generate positions starting to the right of center
  const positions: Array<{anchor: LabelPosition['anchor'], x: number, y: number}> = [
    // Start to the right of center
    { anchor: 'center', x: rightOfCenterX, y: centerY },

    // Small offsets around right-of-center position
    { anchor: 'center', x: rightOfCenterX + 10, y: centerY },
    { anchor: 'center', x: rightOfCenterX - 10, y: centerY },
    { anchor: 'center', x: rightOfCenterX, y: centerY - 10 },
    { anchor: 'center', x: rightOfCenterX, y: centerY + 10 },
    { anchor: 'center', x: rightOfCenterX + 15, y: centerY - 15 },
    { anchor: 'center', x: rightOfCenterX - 15, y: centerY + 15 },
    { anchor: 'center', x: rightOfCenterX + 15, y: centerY + 15 },
    { anchor: 'center', x: rightOfCenterX - 15, y: centerY - 15 },

    // Slightly larger offsets
    { anchor: 'center', x: rightOfCenterX + 20, y: centerY },
    { anchor: 'center', x: rightOfCenterX - 20, y: centerY },
    { anchor: 'center', x: rightOfCenterX, y: centerY - 20 },
    { anchor: 'center', x: rightOfCenterX, y: centerY + 20 },

    // Fallback to center if right positioning doesn't work
    { anchor: 'center', x: bounds.centerX - labelWidth / 2, y: centerY },

    // Edge positions as final fallback
    { anchor: 'top-right', x: bounds.maxX + margin, y: bounds.minY - margin },
    { anchor: 'top-left', x: bounds.minX - labelWidth - margin, y: bounds.minY - margin },
    { anchor: 'bottom-right', x: bounds.maxX + margin, y: bounds.maxY + margin },
    { anchor: 'bottom-left', x: bounds.minX - labelWidth - margin, y: bounds.maxY + margin }
  ];

  // 1) Try cached choice first (stickiness)
  const cached = labelChoiceCache.get(element.id);
  if (cached && positions[cached.idx]) {
    const cachedPos = positions[cached.idx];
    const cx = cachedPos.x + (cached.dx || 0);
    const cy = cachedPos.y + (cached.dy || 0);
    const cachedRect: LabelRect = { x: cx, y: cy, width: labelWidth, height: labelHeight, anchor: cached.anchor || cachedPos.anchor };
    const inBoundsCached = cachedRect.x >= 0 && cachedRect.x + cachedRect.width <= canvasBounds.width &&
      cachedRect.y >= 0 && cachedRect.y + cachedRect.height <= canvasBounds.height;
    if (inBoundsCached) {
      let cachedOverlaps = false;
      for (const ex of existingLabels) { if (rectsOverlap(cachedRect, ex)) { cachedOverlaps = true; break; } }
      if (!cachedOverlaps) {
        return cachedRect;
      }
    }
  }

  // Use consistent positioning regardless of selection state
  // Selected elements get center position first, but positioning doesn't change when selection changes
  const priorityPositions = positions;

  // Find first position that doesn't overlap and stays within canvas bounds
  for (let i = 0; i < priorityPositions.length; i++) {
    const pos = priorityPositions[i];
    const rect: LabelRect = { x: pos.x, y: pos.y, width: labelWidth, height: labelHeight, anchor: pos.anchor };
    const inBounds = rect.x >= 0 && rect.x + rect.width <= canvasBounds.width && rect.y >= 0 && rect.y + rect.height <= canvasBounds.height;
    if (!inBounds) continue;
    let overlaps = false;
    for (const ex of existingLabels) { if (rectsOverlap(rect, ex)) { overlaps = true; break; } }
    if (!overlaps && Array.isArray(avoidRects) && avoidRects.length > 0) {
      for (const av of avoidRects) { if (rectsOverlap(rect, av)) { overlaps = true; break; } }
    }
    if (!overlaps) {
      // Cache the successful choice (no offset used yet)
      labelChoiceCache.set(element.id, { idx: i, dx: 0, dy: 0, anchor: pos.anchor });
      return rect;
    }
  }

  // Fallback: use center position (may overlap, but at least visible)
  return { anchor: 'center', x: bounds.centerX - labelWidth / 2, y: centerY, width: labelWidth, height: labelHeight };
}

// Memoized label position calculation for performance optimization
export function calculateMemoizedLabelPositions(
  elements: Element[],
  canvasBounds: { width: number, height: number },
  showLineDimensions: boolean,
  worldToCanvas: (coord: {x: number, y: number}, scale: number, panOffset: {x: number, y: number}, canvasCenter: {x: number, y: number}) => {x: number, y: number},
  scale: number,
  panOffset: {x: number, y: number},
  canvasCenter: {x: number, y: number},
  avoidRects: Array<{ x: number, y: number, width: number, height: number }> = []
): Map<string, { rect: LabelRect; elementCenter: { x: number, y: number } }> {
  // Create stable hash of elements that affect positioning
  const avoidRectsHash = avoidRects
    .map((r) => `${Math.round(r.x)}:${Math.round(r.y)}:${Math.round(r.width)}:${Math.round(r.height)}`)
    .join('|');
  const elementHash = elements
    .map(e => getSmartLabelLayoutSignature(e, { showLineDimensions }))
    .join('|') + `|lineDims:${showLineDimensions ? '1' : '0'}|avoid:${avoidRectsHash}`;

  // Check if canvas bounds changed significantly (only recalculate if bounds change dramatically)
  // Increased threshold from 200px to 500px to reduce recalculations during pan/zoom
  const boundsChanged = Math.abs(canvasBounds.width - labelPositionCache.lastCanvasBounds.width) > 500 ||
                       Math.abs(canvasBounds.height - labelPositionCache.lastCanvasBounds.height) > 500;

  // Only recalculate if elements changed or canvas bounds changed significantly
  if (elementHash !== labelPositionCache.lastElementHash || boundsChanged) {
    // Clear cache and recalculate
    labelPositionCache.positions.clear();
    labelPositionCache.lastElementHash = elementHash;
    labelPositionCache.lastCanvasBounds = canvasBounds;

    // Sort elements for consistent ordering
    const sortedElements = [...elements].sort((a, b) => {
      const az = a.coordinates?.[0]?.z || 0;
      const bz = b.coordinates?.[0]?.z || 0;
      if (az !== bz) return az - bz;
      if ((a.type || '') !== (b.type || '')) return (a.type || '').localeCompare(b.type || '');
      return (a.id || '').localeCompare(b.id || '');
    });

    // Calculate positions with overlap detection
    const existingLabels: LabelRect[] = [];

    sortedElements.forEach(element => {
      const canvasCoords = (element.coordinates || []).map(coord =>
        worldToCanvas(coord, scale, panOffset, canvasCenter)
      );

      const labelRect = calculateSmartLabelPosition(
        element,
        canvasCoords,
        existingLabels,
        canvasBounds,
        showLineDimensions,
        avoidRects
      );

      const elementBounds = calculateElementBounds(canvasCoords);
      labelPositionCache.positions.set(element.id, {
        rect: labelRect,
        elementCenter: { x: elementBounds.centerX, y: elementBounds.centerY }
      });
      existingLabels.push(labelRect);
    });
  }

  return labelPositionCache.positions;
}

// Transform cached label position to current canvas space
export function transformCachedLabelPosition(
  cachedData: { rect: LabelRect; elementCenter: { x: number, y: number } },
  element: Element,
  worldToCanvas: (coord: {x: number, y: number}, scale: number, panOffset: {x: number, y: number}, canvasCenter: {x: number, y: number}) => {x: number, y: number},
  scale: number,
  panOffset: {x: number, y: number},
  canvasCenter: {x: number, y: number}
): LabelRect {
  // Calculate current element bounds
  const currentCanvasCoords = (element.coordinates || []).map(coord =>
    worldToCanvas(coord, scale, panOffset, canvasCenter)
  );
  const currentBounds = calculateElementBounds(currentCanvasCoords);

  // Calculate the offset from cached position to cached element center
  const offsetX = cachedData.rect.x - cachedData.elementCenter.x;
  const offsetY = cachedData.rect.y - cachedData.elementCenter.y;

  // Apply the same offset to current element center
  return {
    x: currentBounds.centerX + offsetX,
    y: currentBounds.centerY + offsetY,
    width: cachedData.rect.width,
    height: cachedData.rect.height,
    anchor: cachedData.rect.anchor
  };
}
