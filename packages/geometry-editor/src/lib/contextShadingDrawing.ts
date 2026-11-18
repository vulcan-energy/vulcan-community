// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { ContextShading } from '../geometry/types';
import { DRAW_MODE_TOOLTIP_PILL_HEIGHT, getDrawModeTooltipPillWidth } from './drawModeTooltipPill';

type PlanPoint = { x: number; y: number };

/**
 * The stretch of a part's measured wall line that lies beyond the wall's end, from the wall's
 * nearer end to where the distance starts. Null when the distance starts on the wall.
 */
export function wallExtension(wall: readonly [PlanPoint, PlanPoint], from: PlanPoint): [PlanPoint, PlanPoint] | null {
  const [a, b] = wall;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return null;
  const t = ((from.x - a.x) * dx + (from.y - a.y) * dy) / lengthSq;
  if (t >= -1e-9 && t <= 1 + 1e-9) return null;
  return [t < 0 ? a : b, from];
}

/** A part's distance pill on the plan: its text, its rect at the middle of the measured line and whether the distance is positive. */
export function contextShadingPartPill(
  part: { from: PlanPoint; to: PlanPoint; distance: number },
  project: (point: PlanPoint) => PlanPoint,
) {
  const from = project(part.from);
  const to = project(part.to);
  const text = `${part.distance.toFixed(2)}m`;
  const width = getDrawModeTooltipPillWidth(text);
  return {
    text,
    positive: part.distance > 0,
    rect: {
      x: (from.x + to.x) / 2 - width / 2,
      y: (from.y + to.y) / 2 - DRAW_MODE_TOOLTIP_PILL_HEIGHT / 2,
      width,
      height: DRAW_MODE_TOOLTIP_PILL_HEIGHT,
    },
  };
}

export type DirectionField = 'start_angle' | 'end_angle' | 'distance';

const gap = (from: number, to: number) => (((to - from) % 360) + 360) % 360;

/**
 * What a stored row (no drawing) writes when one cell of one part changes: the part and the
 * envelope. Null when the converter would reject it: on a row with one range, a distance of 0 or
 * less or From equal to To in whole degrees; with parts, a part with no width, parts that overlap
 * or run out of clockwise order, or a total over 360 degrees.
 */
export function editStoredRow(
  element: Pick<ContextShading, 'start_angle' | 'end_angle' | 'distance' | 'parts'>,
  index: number,
  field: DirectionField,
  value: number,
): Partial<ContextShading> | null {
  if (!element.parts?.length) {
    if (field === 'distance') return value > 0 ? { distance: value } : null;
    const whole = (angle: number) => ((Math.round(angle) % 360) + 360) % 360;
    const other = field === 'start_angle' ? element.end_angle : element.start_angle;
    return Number.isFinite(other) && whole(value) === whole(other) ? null : { [field]: value };
  }
  const parts = element.parts.map((part, i) => (i === index ? { ...part, [field]: value } : part));
  if (field !== 'distance') {
    const widths = parts.map((part) => gap(part.start_angle, part.end_angle));
    const swept = widths.reduce((sum, width, i) => sum + width + (i ? gap(parts[i - 1].end_angle, parts[i].start_angle) : 0), 0);
    if (widths.includes(0) || widths.reduce((a, b) => a + b, 0) > 360 + 1e-9 || swept > 360 + 1e-9) return null;
  }
  return {
    parts,
    start_angle: parts[0].start_angle,
    end_angle: parts[parts.length - 1].end_angle,
    distance: Math.min(...parts.map((part) => part.distance)),
  };
}
