// SPDX-FileCopyrightText: 2026 Home Energy Foundry Limited and contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from 'vitest';
import type { Element } from '../../geometry/types';
import { coerceElementToStrictestNumericTyping } from '../schemaCoercion';

describe('schema coercion capability', () => {
  it('uses the supplied schema capability instead of a hidden schema cache', () => {
    const getStrictestIntegerKeysForElementType = vi.fn(() => new Set(['pitch']));
    const element = {
      id: 'wall-1',
      name: 'Wall',
      type: 'BuildingElementOpaque',
      pitch: 90.6,
      orientation360: 181.234,
      extra_json: { pitch: 44.7 },
    } as unknown as Element;

    coerceElementToStrictestNumericTyping(element, {
      availability: 'available',
      getStrictestIntegerKeysForElementType,
    } as never);

    expect(getStrictestIntegerKeysForElementType).toHaveBeenCalledWith(
      'BuildingElementOpaque',
      undefined,
    );
    expect(element.pitch).toBe(91);
    expect(element.extra_json?.pitch).toBe(45);
    expect(element.orientation360).toBe(181.23);
  });
});
