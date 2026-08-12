// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import type { Element } from '../geometry/types';
import { normalizeOrientation360Deg, roundToTwoDecimals } from '../geometry/constants';
import type { GeometrySchemaPort } from '../../../geometry-editor-host/src/schemaPort';

/**
 * Determine schema subtype for strictest typing lookups.
 *
 * This is intentionally narrow: it only exists to select the correct subschema
 * (e.g. BuildingElementGround floor_type discriminator) for numeric typing.
 */
export function getSubtypeForStrictestTyping(element: Element): string | undefined {
  if (element.type === 'BuildingElementGround') return element.floor_type;
  if (element.type === 'MechanicalVentilation') return element.vent_type;
  if (element.type === 'WetEmitter') return element.subcategory;
  if (element.type === 'HotWaterDemand') return element.subcategory;
  return undefined;
}

export function coerceIntegerLike(v: unknown): unknown {
  if (v === null || v === undefined || v === '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return v;
}

/**
 * Mutates the element in place to enforce strictest numeric typing across Core/FHS.
 *
 * "Strictest" means: if either schema declares a property as integer, it will be
 * coerced to an integer here (both on the element and at top-level in extra_json).
 */
export function coerceElementToStrictestNumericTyping(
  element: Element,
  schemaPort: GeometrySchemaPort,
): Element {
  if (schemaPort.availability !== 'available') {
    throw new Error('Strict numeric typing requires an available GeometrySchemaPort');
  }
  const subtype = getSubtypeForStrictestTyping(element);
  const intKeys = schemaPort.getStrictestIntegerKeysForElementType(element.type, subtype);
  if (intKeys.size === 0) return element;

  const elementRecord = element as unknown as Record<string, unknown>;
  for (const key of intKeys) {
    if (Object.prototype.hasOwnProperty.call(elementRecord, key)) {
      elementRecord[key] = coerceIntegerLike(elementRecord[key]);
    }
  }

  const extra = element.extra_json;
  if (extra) {
    for (const key of intKeys) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) {
        extra[key] = coerceIntegerLike(extra[key]);
      }
    }
  }

  const snapOrientation = (target: Record<string, unknown>) => {
    if (!Object.prototype.hasOwnProperty.call(target, 'orientation360')) return;
    const v = target.orientation360;
    if (typeof v === 'number' && Number.isFinite(v)) {
      target.orientation360 = roundToTwoDecimals(normalizeOrientation360Deg(v));
    }
  };
  snapOrientation(elementRecord);
  if (extra) snapOrientation(extra);

  return element;
}
